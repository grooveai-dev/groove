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
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { resolve } from 'path';
import { createServer } from 'net';
import { TunnelManager, resolveBestAddress } from '../src/tunnel-manager.js';

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
    // Shrink probe timeouts (production: 5s routine / 15s confirm) so the
    // wedged-listener tests don't burn real minutes waiting them out.
    mgr.healthTimeout = 400;
    mgr.confirmTimeout = 1200;
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
      assert.equal(await mgr._tunnelResponds(wedged.port, 800), false);
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

  it('the health pass reaps a proc-dead tunnel and tries to rebuild it', async () => {
    const wedged = await startWedgedListener();
    try {
      mgr.saved.set('s19', { id: 's19', name: 'S19 Agency', host: 'example.invalid', user: 'ops', port: 22 });
      mgr.active.set('s19', {
        pid: 999999, // no such process → verdict 'proc-dead', reap on first confirm
        localPort: wedged.port, healthy: true,
        failCount: 99, // already past the failure limit
        startedAt: new Date().toISOString(),
      });

      const rebuilds = [];
      mgr.connect = async (id, opts) => { rebuilds.push({ id, opts }); throw new Error('host unreachable'); };

      await mgr._healthCheckAll();

      assert.equal(mgr.active.has('s19'), false, 'dead tunnel removed from active');
      assert.equal(rebuilds.length, 1, 'an automatic rebuild was attempted');
      assert.equal(rebuilds[0].opts.preferredPort, wedged.port, 'rebuild asks for the same port');
      assert.ok(
        daemon.broadcasts.some((b) => b.type === 'tunnel.unhealthy'),
        'the GUI is told the tunnel went unhealthy',
      );
    } finally { wedged.close(); }
  });

  it('a slow-but-alive tunnel is never reaped — the long confirm probe clears it', async () => {
    // Answers /api/health slower than the routine probe allows but inside the
    // confirmation window. This is a busy DGX, not a dead tunnel.
    const sockets = [];
    const slow = createServer((sock) => {
      sockets.push(sock);
      sock.on('data', () => setTimeout(() => {
        const body = '{"ok":true}';
        try {
          sock.end('HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n'
            + `Content-Length: ${body.length}\r\nConnection: close\r\n\r\n${body}`);
        } catch { /* closed */ }
      }, 700));
    });
    await new Promise((r) => slow.listen(0, '127.0.0.1', r));
    const port = slow.address().port;
    try {
      mgr.saved.set('dgx', { id: 'dgx', name: 'Axom Spark', host: 'edgexpert.local', user: 'rok', port: 22 });
      mgr.active.set('dgx', {
        pid: process.pid, // definitely alive
        localPort: port, healthy: true, failCount: 99,
        startedAt: new Date().toISOString(),
      });

      mgr.connect = async () => { throw new Error('rebuild must not be attempted'); };
      await mgr._healthCheckAll();

      const conn = mgr.active.get('dgx');
      assert.ok(conn, 'the tunnel survived');
      assert.equal(conn.healthy, true, 'confirmed alive by the long probe');
      assert.equal(conn.failCount, 0, 'failure count reset');
    } finally {
      for (const s of sockets) s.destroy();
      slow.close();
    }
  });

  it('a wedged tunnel needs two consecutive confirmations before it is reaped', { timeout: 30000 }, async () => {
    const wedged = await startWedgedListener();
    try {
      mgr.saved.set('s19', { id: 's19', name: 'S19 Agency', host: 'example.invalid', user: 'ops', port: 22 });
      mgr.active.set('s19', {
        pid: process.pid, // ssh "alive" → verdict is 'wedged', not 'proc-dead'
        localPort: wedged.port, healthy: true, failCount: 99,
        startedAt: new Date().toISOString(),
      });
      mgr.connect = async () => { throw new Error('unreachable'); };

      await mgr._healthCheckAll();
      assert.equal(mgr.active.has('s19'), true, 'first wedged verdict only flags it');
      assert.equal(mgr.active.get('s19').healthy, false);

      mgr.active.get('s19').failCount = 99; // still failing next tick
      await mgr._healthCheckAll();
      assert.equal(mgr.active.has('s19'), false, 'second wedged verdict reaps it');
    } finally { wedged.close(); }
  });

  it('a timer gap fast-tracks confirmation but cannot kill a live tunnel', async () => {
    const live = await startHealthyListener();
    try {
      mgr.saved.set('dgx', { id: 'dgx', name: 'Axom Spark', host: 'edgexpert.local', user: 'rok', port: 22 });
      mgr.active.set('dgx', {
        pid: process.pid, localPort: live.port, healthy: true, failCount: 0,
        startedAt: new Date().toISOString(),
      });

      // 10-minute gap: sleep — or just a blocked event loop on a busy daemon.
      mgr._lastHealthCheck = Date.now() - 10 * 60 * 1000;
      mgr.connect = async () => { throw new Error('rebuild must not be attempted'); };
      await mgr._healthCheckAll();

      const conn = mgr.active.get('dgx');
      assert.ok(conn, 'live tunnel survived the suspicious gap');
      assert.equal(conn.healthy, true);
    } finally { live.close(); }
  });

  it('remote-down (fast refusal through a live tunnel) starts the daemon, not a rebuild', async () => {
    // ssh alive + port listens + connections REFUSED at the far end: ssh relays
    // the refusal as an immediate close, so the probe fails fast rather than
    // hanging. The tunnel is fine; only the remote daemon needs starting.
    const refusing = createServer((sock) => sock.destroy());
    await new Promise((r) => refusing.listen(0, '127.0.0.1', r));
    const port = refusing.address().port;
    try {
      mgr.saved.set('dgx', { id: 'dgx', name: 'Axom Spark', host: 'edgexpert.local', user: 'axom', port: 22 });
      mgr.active.set('dgx', {
        pid: process.pid, localPort: port, healthy: true, failCount: 99,
        startedAt: new Date().toISOString(),
      });

      const started = [];
      mgr.autoStart = async (id) => { started.push(id); };
      mgr.connect = async () => { throw new Error('rebuild must not be attempted'); };

      await mgr._healthCheckAll();

      assert.deepEqual(started, ['dgx'], 'the remote daemon was started over ssh');
      assert.equal(mgr.active.has('dgx'), true, 'the healthy tunnel was NOT torn down');
    } finally { refusing.close(); }
  });

  it('re-adopts a surviving tunnel after a daemon restart instead of forgetting it', async () => {
    const live = await startHealthyListener();
    try {
      mgr.saved.set('s19', { id: 's19', name: 'S19 Agency', host: '3.22.211.238', user: 'ubuntu', port: 22 });
      mgr._save(); // the new daemon loads configs from disk
      mgr.active.set('s19', {
        pid: process.pid, localPort: live.port,
        startedAt: new Date().toISOString(), healthy: true, failCount: 0,
      });
      mgr._saveActive();
      mgr.shutdown(); // daemon going down — must NOT kill the tunnel

      // "New daemon" after restart. The stand-in pid is node, not ssh, so the
      // identity gate is stubbed — everything else runs for real.
      const daemon2 = makeDaemon(grooveDir);
      const mgr2 = new TunnelManager(daemon2);
      mgr2.healthTimeout = 400;
      mgr2._looksLikeOurSsh = (pid, port) => pid === process.pid && port === live.port;

      await mgr2._readopt();

      assert.equal(mgr2.active.has('s19'), true, 'the surviving tunnel was re-adopted');
      assert.equal(mgr2.active.get('s19').localPort, live.port, 'on its original port');
      assert.ok(
        daemon2.broadcasts.some((b) => b.type === 'tunnel.connected'),
        'the GUI is told the tunnel is (still) connected',
      );
      mgr2.shutdown();
    } finally { live.close(); }
  });

  it('does not re-adopt a dead or hijacked pid', async () => {
    const live = await startHealthyListener();
    try {
      mgr.saved.set('s19', { id: 's19', name: 'S19 Agency', host: '3.22.211.238', user: 'ubuntu', port: 22 });
      mgr._save();
      mgr.active.set('s19', {
        pid: 999999, localPort: live.port, // no such process
        startedAt: new Date().toISOString(), healthy: true, failCount: 0,
      });
      mgr._saveActive();
      mgr.shutdown();

      const daemon2 = makeDaemon(grooveDir);
      const mgr2 = new TunnelManager(daemon2);
      mgr2.healthTimeout = 400;
      await mgr2._readopt();

      assert.equal(mgr2.active.has('s19'), false, 'a dead pid is not adopted');
      mgr2.shutdown();
    } finally { live.close(); }
  });

  it('shutdown persists state and does not kill the tunnel process', async () => {
    const live = await startHealthyListener();
    try {
      mgr.saved.set('s19', { id: 's19', name: 'S19', host: 'x', user: 'u', port: 22 });
      mgr.active.set('s19', {
        pid: process.pid, localPort: live.port,
        startedAt: new Date().toISOString(), healthy: true, failCount: 0,
      });
      mgr.shutdown();

      // Our stand-in "tunnel process" (this test runner) must still be alive —
      // shutdown killing it would have killed the test.
      assert.doesNotThrow(() => process.kill(process.pid, 0));
      const persisted = JSON.parse(readFileSync(resolve(grooveDir, 'tunnels-active.json'), 'utf8'));
      assert.equal(persisted.length, 1);
      assert.equal(persisted[0].id, 's19');
      assert.equal(persisted[0].localPort, live.port);
    } finally { live.close(); }
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

describe('resolveBestAddress — multi-homed host selection', () => {
  // The failure this guards: an mDNS name advertising both a wired and a weak
  // Wi-Fi interface. ssh took whichever address the resolver listed first, so
  // tunnels randomly landed on the bad link and died of keepalive timeout.

  it('passes literal IPs through untouched', async () => {
    assert.equal(await resolveBestAddress('10.0.0.205', 22), '10.0.0.205');
    assert.equal(await resolveBestAddress('::1', 22), '::1');
  });

  it('falls back to the name when it does not resolve', async () => {
    assert.equal(
      await resolveBestAddress('no-such-host-zzz.invalid', 22, 500),
      'no-such-host-zzz.invalid',
    );
  });

  it('picks the address that actually answers when others are dead', async () => {
    // 'localhost' resolves to both ::1 and 127.0.0.1 on typical systems. Bind
    // only the IPv4 side: the resolver must pick 127.0.0.1, not the dead ::1.
    const srv = createServer(() => {});
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const port = srv.address().port;
    try {
      const best = await resolveBestAddress('localhost', port, 800);
      // On single-address systems resolution is a passthrough — accept that too.
      assert.ok(
        best === '127.0.0.1' || best === 'localhost',
        `picked ${best} — expected the listening 127.0.0.1 (or passthrough)`,
      );
    } finally { srv.close(); }
  });

  it('falls back to the name when no candidate answers', async () => {
    // Nobody listens on this port on any of localhost's addresses.
    const srv = createServer(() => {});
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const deadPort = srv.address().port;
    await new Promise((r) => srv.close(r)); // free it — now guaranteed dead
    assert.equal(await resolveBestAddress('localhost', deadPort, 500), 'localhost');
  });
});
