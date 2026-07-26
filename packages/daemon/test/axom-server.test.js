// GROOVE — Axom Server Manager + Installer Tests
// FSL-1.1-Apache-2.0 — see LICENSE
//
// The server manager runs against a stub `axom` executable that honors the
// §11 CLI (serve --host --port --data-dir --model-dir) and serves /about.
// The installer runs against a local HTTP server hosting a §11 manifest.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'http';
import { createHash } from 'crypto';
import { mkdtempSync, writeFileSync, chmodSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { AxomServerManager } from '../src/axom-server.js';
import { AxomInstaller } from '../src/axom-install.js';

const STUB = `#!/usr/bin/env node
// Stub axom serve — §11 CLI, /about + /sessions, clean SIGTERM.
const http = require('http');
const args = process.argv.slice(2);
const get = (flag) => args[args.indexOf(flag) + 1];
if (args[0] !== 'serve') process.exit(2);
const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/about') return res.end(JSON.stringify({ name: 'axom', version: 'stub', kinds: [], instance: { port: Number(get('--port')), data_dir: get('--data-dir'), pid: process.pid } }));
  if (req.url === '/sessions') return res.end('[]');
  res.statusCode = 404; res.end('{}');
});
server.listen(Number(get('--port')), get('--host'));
process.on('SIGTERM', () => { server.close(); process.exit(0); });
`;

function fakeDaemon(grooveDir) {
  const broadcasts = [];
  return {
    grooveDir,
    broadcasts,
    config: { axom: {} },
    broadcast: (m) => broadcasts.push(m),
    audit: { log() {} },
    axom: {
      lastConfigured: null,
      endpoints: new Map(),
      configure(entries) { this.lastConfigured = entries; },
    },
  };
}

describe('AxomServerManager', () => {
  let daemon, manager, stubPath;

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), 'groove-axom-'));
    stubPath = join(dir, 'axom-stub');
    writeFileSync(stubPath, STUB);
    chmodSync(stubPath, 0o755);
    daemon = fakeDaemon(dir);
    // Lifecycle tests inject ample RAM — the floor guard has its own test
    // (and CI boxes/the 8GB dev Mac must not trip it on unrelated tests).
    manager = new AxomServerManager(daemon, { command: stubPath, totalRamGb: 32 });
  });

  afterEach(async () => {
    await manager.destroy();
  });

  it('starts an instance with its own port and sovereign data-dir, and registers the endpoint', async () => {
    const instance = await manager.start('proj-a');
    assert.equal(instance.status, 'running');
    assert.equal(instance.port, 8737);
    assert.ok(instance.dataDir.endsWith(join('axom', 'instances', 'proj-a')));
    assert.ok(existsSync(instance.dataDir));

    const about = await (await fetch(`http://127.0.0.1:${instance.port}/about`)).json();
    assert.equal(about.instance.data_dir, instance.dataDir);

    const ep = daemon.config.axom.endpoints.find((e) => e.name === 'local-proj-a');
    assert.equal(ep.url, 'http://127.0.0.1:8737');
    assert.deepEqual(daemon.axom.lastConfigured, daemon.config.axom.endpoints);
  });

  it('allocates distinct ports for concurrent instances', async () => {
    const a = await manager.start('a');
    const b = await manager.start('b');
    assert.equal(a.port, 8737);
    assert.equal(b.port, 8738);
    assert.notEqual(a.dataDir, b.dataDir); // ledgers never shared
  });

  it('stops an instance and deregisters its endpoint', async () => {
    await manager.start('gone');
    await manager.stop('gone');
    const instance = manager.list().find((i) => i.id === 'gone');
    assert.equal(instance.status, 'stopped');
    assert.ok(!daemon.config.axom.endpoints.some((e) => e.name === 'local-gone'));
  });

  it('refuses non-mock start below the RAM floor — the host stays up', async () => {
    manager = new AxomServerManager(daemon, { command: stubPath, totalRamGb: 8 });
    await assert.rejects(() => manager.start('x'), /below Axom's 12GB floor/);
    // Mock mode is weightless and exempt.
    daemon.config.axom.mock = true;
    const instance = await manager.start('x');
    assert.equal(instance.status, 'running');
  });

  it('reports a missing runtime binary honestly', async () => {
    manager = new AxomServerManager(daemon, { command: '/nonexistent/axom', totalRamGb: 32 });
    await assert.rejects(() => manager.start('x'), /not found — install the Axom runtime/);
    assert.equal(manager.list().find((i) => i.id === 'x').status, 'error');
  });
});

describe('AxomInstaller', () => {
  let daemon, installer, server, baseUrl, modelBytes, modelSha;

  beforeEach(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'groove-axom-inst-'));
    daemon = fakeDaemon(dir);
    installer = new AxomInstaller(daemon, { totalRamGb: 32 });
    modelBytes = Buffer.from('fake-gguf-weights-'.repeat(1000));
    modelSha = createHash('sha256').update(modelBytes).digest('hex');
    server = createServer((req, res) => {
      if (req.url === '/manifest.json') {
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({
          models: [{ file: 'chassis.gguf', url: `${baseUrl}/chassis.gguf`, sha256: modelSha, bytes: modelBytes.length }],
        }));
      }
      if (req.url === '/bad-manifest.json') {
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({
          models: [{ file: 'chassis.gguf', url: `${baseUrl}/chassis.gguf`, sha256: 'deadbeef'.repeat(8), bytes: modelBytes.length }],
        }));
      }
      if (req.url === '/chassis.gguf') return res.end(modelBytes);
      res.statusCode = 404; res.end();
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterEach(async () => {
    await new Promise((r) => server.close(r));
  });

  it('downloads, verifies sha256, and lands the model file', async () => {
    const result = await installer.install(`${baseUrl}/manifest.json`);
    assert.deepEqual(result, { ok: true, models: 1 });
    const landed = join(daemon.grooveDir, 'axom', 'models', 'chassis.gguf');
    assert.ok(existsSync(landed));
    assert.deepEqual(readFileSync(landed), modelBytes);
    assert.equal(installer.getStatus().phase, 'done');
    assert.ok(daemon.broadcasts.some((b) => b.type === 'axom:install:progress'));
  });

  it('refuses a sha256 mismatch — nothing lands, no partial left behind', async () => {
    await assert.rejects(() => installer.install(`${baseUrl}/bad-manifest.json`), /sha256 mismatch/);
    const modelDir = join(daemon.grooveDir, 'axom', 'models');
    assert.ok(!existsSync(join(modelDir, 'chassis.gguf')));
    assert.ok(!existsSync(join(modelDir, 'chassis.gguf.part')));
    assert.equal(installer.getStatus().phase, 'error');
  });

  it('refuses an unverifiable manifest entry (no sha256)', async () => {
    const s2 = createServer((req, res) => res.end(JSON.stringify({
      models: [{ file: 'x.gguf', url: `${baseUrl}/chassis.gguf` }],
    })));
    await new Promise((r) => s2.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${s2.address().port}/`;
    try {
      await assert.rejects(() => installer.install(url), /refusing unverifiable download/);
    } finally {
      await new Promise((r) => s2.close(r));
    }
  });

  it('errors without a configured manifest url — no hardcoded source exists', async () => {
    await assert.rejects(() => installer.install(undefined), /no install manifest configured/);
  });

  it('refuses to download weights below the RAM floor', async () => {
    installer = new AxomInstaller(daemon, { totalRamGb: 8 });
    await assert.rejects(() => installer.install(`${baseUrl}/manifest.json`), /below Axom's 12GB floor/);
  });
});
