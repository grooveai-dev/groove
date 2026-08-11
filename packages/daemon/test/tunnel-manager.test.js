// GROOVE — TunnelManager Tests
// FSL-1.1-Apache-2.0 — see LICENSE
//
// Regression coverage for wake-from-sleep recovery. The failure these guard
// against: an SSH tunnel cut by a laptop sleep leaves a local listener that
// still ACCEPTS TCP connections but never forwards them. A TCP-connect probe
// calls that healthy, so the dead tunnel was handed out forever and the remote
// GUI loaded a port that hung instead of failing — a black window that only a
// full app restart cleared.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { resolve } from 'path';
import { createServer } from 'net';
import { TunnelManager } from '../src/tunnel-manager.js';

function makeDaemon(grooveDir) {
  const broadcasts = [];
  return {
    broadcasts,
    grooveDir,
    projectDir: process.cwd(),
    audit: { log() {} },
    broadcast(m) { broadcasts.push(m); },
  };
}

// A tunnel wedged by sleep: the socket is accepted and then ignored forever.
function startWedgedListener() {
  const sockets = [];
  const server = createServer((sock) => { sockets.push(sock); });
  return new Promise((res) => {
    server.listen(0, '127.0.0.1', () => {
      res({
        port: server.address().port,
        close: () => { for (const s of sockets) s.destroy(); server.close(); },
      });
    });
  });
}

// A tunnel that works — answers /api/health like the remote daemon would.
function startHealthyListener() {
  const server = createServer((sock) => {
    sock.on('data', () => {
      const body = '{"ok":true}';
      sock.end(
        'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n'
        + `Content-Length: ${body.length}\r\nConnection: close\r\n\r\n${body}`,
      );
    });
  });
  return new Promise((res) => {
    server.listen(0, '127.0.0.1', () => {
      res({ port: server.address().port, close: () => server.close() });
    });
  });
}

describe('TunnelManager — wake-from-sleep recovery', () => {
  let daemon, mgr, grooveDir;

  beforeEach(() => {
    grooveDir = mkdtempSync(resolve(tmpdir(), 'groove-tunnel-'));
    daemon = makeDaemon(grooveDir);
    mgr = new TunnelManager(daemon);
  });

  afterEach(() => {
    mgr.shutdown();
    try { rmSync(grooveDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('a TCP-accept probe cannot tell a wedged tunnel from a live one', async () => {
    const wedged = await startWedgedListener();
    try {
      // This is what the old code trusted — and why the bug survived.
      assert.equal(await mgr._isPortInUse(wedged.port), true);
    } finally { wedged.close(); }
  });

  it('_tunnelResponds rejects a tunnel that accepts but never answers', async () => {
    const wedged = await startWedgedListener();
    try {
      assert.equal(await mgr._tunnelResponds(wedged.port, 1500), false);
    } finally { wedged.close(); }
  });

  it('_tunnelResponds accepts a tunnel that actually serves', async () => {
    const live = await startHealthyListener();
    try {
      assert.equal(await mgr._tunnelResponds(live.port, 3000), true);
    } finally { live.close(); }
  });

  it('connect() rebuilds instead of handing back a wedged tunnel', async () => {
    const wedged = await startWedgedListener();
    try {
      mgr.saved.set('s19', {
        id: 's19', name: 'S19 Agency', host: 'example.invalid',
        user: 'ops', port: 22, lastConnected: new Date().toISOString(),
      });
      mgr.active.set('s19', {
        pid: 999999, localPort: wedged.port, healthy: true, failCount: 0,
        startedAt: new Date().toISOString(),
      });

      // Host is unreachable, so the rebuild fails — the point is that it TRIED
      // rather than returning the dead port as if it were usable.
      await assert.rejects(
        () => mgr.connect('s19', { skipTest: false }),
        (err) => !/^$/.test(err.message),
      );
      assert.equal(mgr.active.has('s19'), false, 'the dead tunnel was torn down');
    } finally { wedged.close(); }
  });

  it('connect() reuses a tunnel that is genuinely alive', async () => {
    const live = await startHealthyListener();
    try {
      mgr.saved.set('spark', { id: 'spark', name: 'DGX Spark', host: '10.0.0.5', user: 'rok', port: 22 });
      mgr.active.set('spark', {
        pid: 12345, localPort: live.port, healthy: true, failCount: 0,
        startedAt: new Date().toISOString(),
      });

      const res = await mgr.connect('spark');
      assert.equal(res.localPort, live.port, 'a working tunnel is reused, not rebuilt');
      assert.equal(mgr.active.has('spark'), true);
    } finally { live.close(); }
  });

  it('the health pass reaps a dead tunnel so the next connect starts clean', async () => {
    const wedged = await startWedgedListener();
    try {
      mgr.saved.set('s19', { id: 's19', name: 'S19 Agency', host: 'example.invalid', user: 'ops', port: 22 });
      mgr.active.set('s19', {
        pid: 999999, localPort: wedged.port, healthy: true,
        failCount: 99, // already past the failure limit
        startedAt: new Date().toISOString(),
      });

      await mgr._healthCheckAll();

      assert.equal(mgr.active.has('s19'), false, 'dead tunnel removed from active');
      assert.ok(
        daemon.broadcasts.some((b) => b.type === 'tunnel.unhealthy'),
        'the GUI is told the tunnel went unhealthy',
      );
    } finally { wedged.close(); }
  });

  it('treats a long timer gap as a sleep and drops the failure tolerance', async () => {
    const wedged = await startWedgedListener();
    try {
      mgr.saved.set('s19', { id: 's19', name: 'S19 Agency', host: 'example.invalid', user: 'ops', port: 22 });
      mgr.active.set('s19', {
        pid: 999999, localPort: wedged.port, healthy: true, failCount: 0,
        startedAt: new Date().toISOString(),
      });

      // Last check was 10 minutes ago — the machine was asleep.
      mgr._lastHealthCheck = Date.now() - 10 * 60 * 1000;
      await mgr._healthCheckAll();

      const conn = mgr.active.get('s19');
      assert.equal(conn?.healthy, false, 'one failure after a sleep gap is enough');
    } finally { wedged.close(); }
  });

  it('_waitForPortFree reports a released port', async () => {
    const live = await startHealthyListener();
    assert.equal(await mgr._waitForPortFree(live.port, 600), false, 'still held while listening');
    live.close();
    assert.equal(await mgr._waitForPortFree(live.port, 3000), true, 'free once closed');
  });

  it('_waitForExit returns true for a pid that does not exist', async () => {
    assert.equal(await mgr._waitForExit(999999, 500), true);
  });
});
