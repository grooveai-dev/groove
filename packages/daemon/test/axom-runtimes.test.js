// GROOVE — Axom Runtime Model Tests
// FSL-1.1-Apache-2.0 — see LICENSE
//
// The model is exercised with faked backends: what matters here is that verbs
// dispatch on control mode, states derive honestly, and migration folds the
// legacy keys without forking anyone's ledger.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { AxomRuntimes, validateRuntime } from '../src/axom-runtimes.js';

function fakeDaemon() {
  const calls = { remote: [], server: [], connector: [], nudges: [], rechecks: [] };
  const broadcasts = [];
  return {
    calls,
    broadcasts,
    grooveDir: mkdtempSync(join(tmpdir(), 'groove-axrt-')),
    config: { axom: {} },
    broadcast(m) { broadcasts.push(m); },
    audit: { log() {} },
    axom: {
      endpoints: new Map(),
      configure(entries) { calls.connector.push(entries); },
      nudge(name) { calls.nudges.push(name); },
      recheck(name) { calls.rechecks.push(name); },
    },
    axomRemote: {
      async status(cfg) { calls.remote.push(['status', cfg]); return fakeDaemon._remoteStatus || { running: false }; },
      async start(cfg) { calls.remote.push(['start', cfg]); return { started: true }; },
      async stop(o, cfg) { calls.remote.push(['stop', o, cfg]); return { stopped: true, via: 'shutdown' }; },
      async ensureTunnel(cfg) { calls.remote.push(['tunnel', cfg]); return { tunneled: true }; },
    },
    axomServer: {
      instances: [],
      list() { return this.instances; },
      async start(id, opts) { calls.server.push(['start', id, opts]); return { id, port: 8737, status: 'running' }; },
      async stop(id) { calls.server.push(['stop', id]); },
    },
  };
}

const SSH_RT = {
  id: 'spark', name: 'Spark', url: 'http://127.0.0.1:8737', control: 'ssh',
  ssh: { host: 'spark.local', user: 'axom' },
  launch: { command: 'cd /x && PYTHONPATH=model python3 -u -m axom.cli serve --cpu' },
};

describe('AxomRuntimes', () => {
  let daemon, model;

  beforeEach(() => {
    daemon = fakeDaemon();
    model = new AxomRuntimes(daemon);
    // The real broadcastStatus probes runtime URLs; record the push instead so
    // these tests stay hermetic. The genuine payload has its own test below.
    model.broadcastStatus = async () => { daemon.broadcasts.push({ type: 'axom:runtimes' }); };
  });

  it('migrates the legacy endpoint+remote pair into one ssh runtime', () => {
    daemon.config.axom = {
      endpoints: [{ name: 'local', url: 'http://127.0.0.1:8737' }],
      remote: { host: 'edgexpert-aaa6.local', user: 'axom', port: 8737, command: 'python3 -m axom.cli serve', logPath: '/x.log' },
    };
    assert.equal(model.migrate(), true);
    const [rt] = model.list();
    assert.equal(rt.control, 'ssh');
    assert.equal(rt.url, 'http://127.0.0.1:8737');
    assert.equal(rt.ssh.host, 'edgexpert-aaa6.local');
    assert.equal(rt.launch.command, 'python3 -m axom.cli serve');
    assert.equal(model.activeId(), rt.id);
    assert.equal(model.migrate(), false); // idempotent
  });

  it('migrates a lone endpoint into a connect-only runtime', () => {
    daemon.config.axom = { endpoints: [{ name: 'other', url: 'http://127.0.0.1:9999' }] };
    model.migrate();
    assert.equal(model.list()[0].control, 'none');
  });

  it('start dispatches by control: ssh starts remotely and heals the tunnel', async () => {
    model.add(SSH_RT);
    await model.startRuntime('spark');
    const kinds = daemon.calls.remote.map((c) => c[0]);
    assert.ok(kinds.includes('start'));
    assert.ok(kinds.includes('tunnel')); // reachability follows lifecycle
    const cfg = daemon.calls.remote.find((c) => c[0] === 'start')[1];
    assert.equal(cfg.host, 'spark.local');
    assert.equal(cfg.command, SSH_RT.launch.command); // spec passed VERBATIM
  });

  it('start dispatches by control: local spawns and adopts the resulting port as its URL', async () => {
    model.add({ id: 'here', name: 'This machine', control: 'local', launch: { command: 'axom' }, dataDir: '/home/axom/axom-serve/data' });
    await model.startRuntime('here');
    const [, id, opts] = daemon.calls.server[0];
    assert.equal(id, 'here');
    assert.equal(opts.dataDir, '/home/axom/axom-serve/data'); // ADOPTS the ledger
    assert.equal(model.get('here').url, 'http://127.0.0.1:8737');
  });

  it('refuses lifecycle verbs on connect-only runtimes with an honest message', async () => {
    model.add({ id: 'theirs', name: 'Theirs', url: 'http://127.0.0.1:7000', control: 'none' });
    await assert.rejects(() => model.startRuntime('theirs'), /not controlled by GROOVE/);
    await assert.rejects(() => model.stopRuntime('theirs'), /not controlled by GROOVE/);
    await assert.rejects(() => model.heal('theirs'), /only ssh runtimes/);
  });

  it('derives ssh states honestly: tunnel-down vs stopped vs host-unreachable', async () => {
    model.add({ ...SSH_RT, url: 'http://127.0.0.1:1' }); // nothing listens on :1
    fakeDaemon._remoteStatus = { running: true };
    assert.equal((await model.state('spark')).state, 'unreachable'); // up on host, tunnel down
    fakeDaemon._remoteStatus = { running: false };
    assert.equal((await model.state('spark')).state, 'stopped');
    fakeDaemon._remoteStatus = { running: null, error: 'no route to host' };
    const s = await model.state('spark');
    assert.equal(s.state, 'unreachable');
    assert.match(s.detail, /no route/);
    delete fakeDaemon._remoteStatus;
  });

  it('reports connected when the connector has the stream', async () => {
    model.add(SSH_RT);
    daemon.axom.endpoints.set('spark', { status: 'connected' });
    assert.equal((await model.state('spark')).state, 'connected');
  });

  it('status exposes exactly the verbs each state supports', async () => {
    model.add({ id: 'theirs', name: 'Theirs', url: 'http://127.0.0.1:1', control: 'none' });
    const { runtimes } = await model.status();
    const theirs = runtimes.find((r) => r.id === 'theirs');
    assert.equal(theirs.canStart, false);
    assert.equal(theirs.canStop, false);
    assert.equal(theirs.canHeal, false);
  });

  it('keeps the connector in sync with the runtime list', () => {
    model.add(SSH_RT);
    model.remove('spark');
    const last = daemon.calls.connector.pop();
    assert.deepEqual(last, []);
  });

  // Axom-UX flag 1: the GUI's runtime cards must move on events, not a poll.
  it('pushes fresh runtime state on every mutation and lifecycle verb', async () => {
    const seen = () => daemon.broadcasts.filter((b) => b.type === 'axom:runtimes').length;
    model.add(SSH_RT);
    assert.ok(seen() >= 1);
    let n = seen();
    model.update('spark', { name: 'Spark 2' });
    assert.ok(seen() > n);
    n = seen();
    model.activate('spark');
    assert.ok(seen() > n);
    n = seen();
    await model.startRuntime('spark');
    assert.ok(seen() > n);
    // Axom-UX flag 3: start pulls the connector in NOW — 'running' must not
    // linger for a backoff cycle before becoming 'connected'.
    assert.deepEqual(daemon.calls.nudges, ['spark']);
    n = seen();
    await model.stopRuntime('spark');
    assert.ok(seen() > n);
    // ...and stop re-probes so a stale 'connected' collapses with the verb.
    assert.deepEqual(daemon.calls.rechecks, ['spark']);
    n = seen();
    model.remove('spark');
    assert.ok(seen() > n);
  });

  it('broadcastStatus emits the full axom:runtimes payload', async () => {
    const d = fakeDaemon();
    const m = new AxomRuntimes(d);
    m.add({ id: 'here', name: 'This machine', control: 'local' }); // no URL → no probe
    const deadline = Date.now() + 2000;
    while (!d.broadcasts.some((b) => b.type === 'axom:runtimes')) {
      if (Date.now() > deadline) throw new Error('no axom:runtimes broadcast');
      await new Promise((r) => setTimeout(r, 10));
    }
    const msg = d.broadcasts.find((b) => b.type === 'axom:runtimes');
    assert.equal(msg.data.activeRuntimeId, 'here');
    assert.equal(msg.data.runtimes[0].state, 'stopped');
    assert.equal(msg.data.runtimes[0].canStart, true);
  });
});

describe('validateRuntime', () => {
  it('accepts the three shapes and rejects garbage', () => {
    assert.equal(validateRuntime(SSH_RT), null);
    assert.equal(validateRuntime({ id: 'x', name: 'X', control: 'local' }), null); // url comes from spawn
    assert.equal(validateRuntime({ id: 'y', name: 'Y', url: 'http://127.0.0.1:1', control: 'none' }), null);
    assert.ok(validateRuntime({ id: 'z', name: 'Z', control: 'teleport' }));
    assert.ok(validateRuntime({ id: 'z', name: 'Z', control: 'none' })); // none requires url
    assert.ok(validateRuntime({ id: 'z', name: 'Z', control: 'ssh', url: 'http://127.0.0.1:1', ssh: { host: 'h;rm', user: 'u' } }));
  });
});
