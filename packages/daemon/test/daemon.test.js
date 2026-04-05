// GROOVE — Daemon Integration Tests
// FSL-1.1-Apache-2.0 — see LICENSE

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Daemon } from '../src/index.js';
import { mkdtempSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('Daemon', () => {
  let daemon;
  let tmpDir;

  afterEach(async () => {
    if (daemon) {
      try { await daemon.stop(); } catch {}
      daemon = null;
    }
  });

  function createDaemon(port) {
    tmpDir = mkdtempSync(join(tmpdir(), 'groove-test-'));
    daemon = new Daemon({
      port,
      projectDir: tmpDir,
      grooveDir: join(tmpDir, '.groove'),
    });
    return daemon;
  }

  it('should start and listen on the specified port', async () => {
    const d = createDaemon(0); // Port 0 = random available port
    await d.start();

    const addr = d.server.address();
    assert.ok(addr.port > 0);
  });

  it('should create .groove directory on startup', async () => {
    const d = createDaemon(0);
    assert.ok(existsSync(join(tmpDir, '.groove', 'logs')));
    assert.ok(existsSync(join(tmpDir, '.groove', 'context')));
  });

  it('should write and clean up PID file', async () => {
    const d = createDaemon(0);
    await d.start();

    const pidFile = join(tmpDir, '.groove', 'daemon.pid');
    assert.ok(existsSync(pidFile));

    const pid = parseInt(readFileSync(pidFile, 'utf8'), 10);
    assert.equal(pid, process.pid);

    await d.stop();
    daemon = null; // Prevent double-stop in afterEach

    assert.ok(!existsSync(pidFile));
  });

  it('should respond to health check', async () => {
    const d = createDaemon(0);
    await d.start();

    const port = d.server.address().port;
    const res = await fetch(`http://localhost:${port}/api/health`);
    const body = await res.json();

    assert.equal(body.status, 'ok');
    assert.ok(body.uptime >= 0);
  });

  it('should return empty agent list initially', async () => {
    const d = createDaemon(0);
    await d.start();

    const port = d.server.address().port;
    const res = await fetch(`http://localhost:${port}/api/agents`);
    const agents = await res.json();

    assert.deepEqual(agents, []);
  });

  it('should return daemon status', async () => {
    const d = createDaemon(0);
    await d.start();

    const port = d.server.address().port;
    const res = await fetch(`http://localhost:${port}/api/status`);
    const status = await res.json();

    assert.equal(status.pid, process.pid);
    assert.equal(status.agents, 0);
    assert.equal(status.running, 0);
    assert.equal(status.projectDir, tmpDir);
  });

  it('should list providers', async () => {
    const d = createDaemon(0);
    await d.start();

    const port = d.server.address().port;
    const res = await fetch(`http://localhost:${port}/api/providers`);
    const providers = await res.json();

    assert.ok(Array.isArray(providers));
    assert.ok(providers.length > 0);

    const cc = providers.find((p) => p.id === 'claude-code');
    assert.ok(cc);
    assert.equal(cc.name, 'Claude Code');
  });

  it('should return empty locks initially', async () => {
    const d = createDaemon(0);
    await d.start();

    const port = d.server.address().port;
    const res = await fetch(`http://localhost:${port}/api/locks`);
    const locks = await res.json();

    assert.deepEqual(locks, {});
  });

  it('should persist and restore state across restarts', async () => {
    const d = createDaemon(0);
    await d.start();

    // Add an agent directly to registry (bypassing process spawn)
    d.registry.add({ role: 'backend', scope: ['src/api/**'] });

    await d.stop();
    daemon = null;

    // Start a new daemon in same directory
    daemon = new Daemon({
      port: 0,
      projectDir: tmpDir,
      grooveDir: join(tmpDir, '.groove'),
    });
    await daemon.start();

    const agents = daemon.registry.getAll();
    assert.equal(agents.length, 1);
    assert.equal(agents[0].role, 'backend');
    assert.equal(agents[0].status, 'stopped'); // Restored agents are stopped
  });
});
