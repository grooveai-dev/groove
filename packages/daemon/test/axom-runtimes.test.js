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

  // Found in Ryan's live config: endpoints[] emptied by a disconnect, remote
  // host still configured — the old rule dropped it and showed a first-run
  // splash for a machine he had already set up.
  it('migrates a configured remote host even with no endpoint entry beside it', () => {
    daemon.config.axom = {
      endpoints: [],
      remote: { host: 'edgexpert-aaa6.local', user: 'axom', port: 8737, command: 'python3 -u -m axom.cli serve' },
    };
    model.migrate();
    const [rt] = model.list();
    assert.equal(rt.control, 'ssh');
    assert.equal(rt.ssh.host, 'edgexpert-aaa6.local');
    assert.equal(rt.url, 'http://127.0.0.1:8737');
  });

  it('retries a migration that produced nothing, but never re-derives a real one', () => {
    // An earlier build wrote an empty runtimes[] and then early-returned
    // forever on `Array.isArray` — the host stayed stranded across restarts.
    daemon.config.axom = {
      runtimes: [],
      remote: { host: 'spark.local', user: 'axom', port: 8737 },
    };
    assert.equal(model.migrate(), true);
    assert.equal(model.list().length, 1);
    // Now it is marked done: a runtime the user removes must not resurrect.
    assert.equal(model.migrate(), false);
    model.remove('spark');
    assert.equal(model.migrate(), false);
    assert.equal(model.list().length, 0);
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
    // Spec passed verbatim, with only the blessed env exported ahead of it.
    assert.ok(cfg.command.endsWith(SSH_RT.launch.command));
    assert.match(cfg.command, /^export AXOM_MAX_CTX='8192'; /);
  });

  // A spec must mean the same thing in every control mode. SSH previously
  // honoured only `command`, so structured cwd/env vanished — the class of bug
  // that boots a 2048-ctx runtime from a spec that asked for 8192.
  it('composes launch cwd and env into the ssh command instead of dropping them', async () => {
    model.add({
      ...SSH_RT,
      launch: {
        command: 'python3 -u -m axom.cli serve --cpu',
        cwd: '/home/axom/Desktop/Axom/axom-release',
        env: { PYTHONPATH: 'model', AXOM_MAX_CTX: '8192' },
      },
    });
    await model.startRuntime('spark');
    const { command } = daemon.calls.remote.find((c) => c[0] === 'start')[1];
    // export before cd: a `VAR=x` prefix would bind to `cd`, not the runtime.
    assert.match(command, /export PYTHONPATH='model';/);
    assert.match(command, /cd '\/home\/axom\/Desktop\/Axom\/axom-release' && python3/);
    assert.match(command, /AXOM_MAX_CTX='8192'/);
    assert.ok(command.endsWith('python3 -u -m axom.cli serve --cpu'));
  });

  it('rejects launch env that is not clean name/value pairs', () => {
    assert.ok(validateRuntime({ ...SSH_RT, launch: { command: 'x', env: ['A=1'] } }));
    assert.ok(validateRuntime({ ...SSH_RT, launch: { command: 'x', env: { 'BAD NAME': '1' } } }));
    assert.ok(validateRuntime({ ...SSH_RT, launch: { command: 'x', env: { A: { nested: 1 } } } }));
    assert.equal(validateRuntime({ ...SSH_RT, launch: { command: 'x', env: { AXOM_MAX_CTX: '8192' }, cwd: '/x' } }), null);
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

  // ── Mono-Axom (§10) ─────────────────────────────────────────────────────
  // One Axom per machine; hooks are sessions, never processes.

  it('a hook on a running runtime mints a session and starts nothing', async () => {
    model.add(SSH_RT);
    daemon.axom.endpoints.set('spark', { status: 'connected', sessions: new Map() });
    const a = await model.hook('spark');
    const b = await model.hook('spark');
    assert.match(a.session, /^s-/);
    assert.notEqual(a.session, b.session); // each hook is its own recency thread
    assert.equal(a.launched, false);
    assert.equal(daemon.calls.remote.filter((c) => c[0] === 'start').length, 0);
  });

  it('a hook launches from the blessed spec only when nothing is running', async () => {
    model.add({ ...SSH_RT, url: 'http://127.0.0.1:1' });
    fakeDaemon._remoteStatus = { running: false };
    const h = await model.hook('spark');
    delete fakeDaemon._remoteStatus;
    assert.equal(h.launched, true);
    assert.equal(daemon.calls.remote.filter((c) => c[0] === 'start').length, 1);
    // The blessed env rides the launch — a 2048-ctx boot is the bug it prevents.
    assert.match(daemon.calls.remote.find((c) => c[0] === 'start')[1].command, /AXOM_MAX_CTX='8192'/);
  });

  it('a hook that loses the lock race joins the winner instead of erroring', async () => {
    model.add({ ...SSH_RT, url: 'http://127.0.0.1:1' });
    let probes = 0;
    fakeDaemon._remoteStatus = { running: false };
    daemon.axomRemote.start = async () => { throw new Error('another instance holds the data-dir lock'); };
    // The loser re-derives: by the time it asks again, the winner is up.
    const realState = model.state.bind(model);
    model.state = async (id) => (++probes >= 2 ? { state: 'connected', detail: null } : realState(id));
    const h = await model.hook('spark');
    delete fakeDaemon._remoteStatus;
    assert.equal(h.launched, false);
    assert.equal(h.wonBy, undefined); // hook() reports the session, not the race
    assert.match(h.session, /^s-/);
  });

  it('a user-set env value beats the blessed default — GROOVE never edits a spec', async () => {
    model.add({ ...SSH_RT, launch: { command: 'serve', env: { AXOM_MAX_CTX: '4096' } } });
    await model.startRuntime('spark');
    const { command } = daemon.calls.remote.find((c) => c[0] === 'start')[1];
    assert.match(command, /AXOM_MAX_CTX='4096'/);
    assert.doesNotMatch(command, /8192/);
  });

  it('reports the shared generation slot so concurrent hooks can queue honestly', async () => {
    model.add(SSH_RT);
    const sessions = new Map([
      ['s-one', { id: 's-one', live: true }],
      ['s-two', { id: 's-two', live: false }],
    ]);
    daemon.axom.endpoints.set('spark', { status: 'connected', sessions });
    const { runtimes } = await model.status();
    assert.equal(runtimes[0].generationBusy, true);
    assert.equal(runtimes[0].generationHolder, 's-one');
    sessions.get('s-one').live = false;
    assert.equal(model.generation('spark').generationBusy, false);
  });

  it('refuses to hook a runtime on someone else\'s machine with an honest sentence', async () => {
    model.add({ id: 'theirs', name: 'Theirs', url: 'http://127.0.0.1:1', control: 'none' });
    await assert.rejects(() => model.hook('theirs'), /runs on another machine/);
  });

  // ── Chats — the persistent hook list ────────────────────────────────────

  it('records every hook as a chat that survives a reload', async () => {
    model.add(SSH_RT);
    daemon.axom.endpoints.set('spark', { status: 'connected', sessions: new Map() });
    const a = await model.hook('spark', { label: 'Research' });
    await model.hook('spark');
    assert.equal(a.label, 'Research');
    assert.equal(model.chats().length, 2);
    // A fresh model over the same config sees them — the list is daemon-side.
    assert.equal(new AxomRuntimes(daemon).chats().length, 2);
  });

  it('deleting a chat hides it and never touches the conversation', async () => {
    model.add(SSH_RT);
    daemon.axom.endpoints.set('spark', { status: 'connected', sessions: new Map() });
    const { session } = await model.hook('spark', { label: 'Scratch' });
    const result = model.hideChat(session);
    assert.equal(model.chats().length, 0);
    assert.match(result.note, /remains in Axom's memory/);
    // The row is REMEMBERED as hidden, so rejoining the same session — which
    // the connector's /sessions poll will keep reporting — can't resurrect it.
    await model.hook('spark', { session });
    assert.equal(model.chats().length, 0);
    assert.equal(model.getChat(session).hidden, true);
  });

  it('titles a chat from its opening message, quoting rather than paraphrasing', async () => {
    model.add(SSH_RT);
    daemon.axom.endpoints.set('spark', { status: 'connected', sessions: new Map() });
    const { session } = await model.hook('spark');
    assert.match(model.getChat(session).label, /^Chat /); // placeholder to start
    model.titleFromFirstMessage(session, '  Hey good morning\n  Axom!  ');
    assert.equal(model.getChat(session).label, 'Hey good morning Axom!');
    // Only the FIRST message titles it — later turns don't rewrite history.
    model.titleFromFirstMessage(session, 'something else entirely');
    assert.equal(model.getChat(session).label, 'Hey good morning Axom!');
  });

  it('truncates a long opening message visibly and never mid-word', async () => {
    model.add(SSH_RT);
    daemon.axom.endpoints.set('spark', { status: 'connected', sessions: new Map() });
    const { session } = await model.hook('spark');
    model.titleFromFirstMessage(session, 'Can you walk me through how the memory ledger graduation policy actually works');
    const { label } = model.getChat(session);
    assert.ok(label.endsWith('…'));       // truncation is visible, not silent
    assert.ok(label.length <= 49);
    assert.doesNotMatch(label, / …$/);     // no dangling space before the ellipsis
    assert.ok('Can you walk me through how the memory ledger graduation policy actually works'.startsWith(label.slice(0, -1)));
  });

  it('never lets an auto-title overwrite a name the user chose', async () => {
    model.add(SSH_RT);
    daemon.axom.endpoints.set('spark', { status: 'connected', sessions: new Map() });
    const { session } = await model.hook('spark');
    model.renameChat(session, 'Ledger work');
    model.titleFromFirstMessage(session, 'Hey good morning Axom!');
    assert.equal(model.getChat(session).label, 'Ledger work');
  });

  // The runtime's pipeline_start carries no prompt text, so the user's words
  // exist only in GROOVE. Browser-only storage meant a reload replayed turns
  // from the ring with their bubbles gone — the answer with no question.
  it('remembers sent prompts by ref so a reloaded tab can restore bubbles', () => {
    model.recordPrompt('s-1', 'g-aaa', 'Hey good morning Axom!');
    model.recordPrompt('s-1', 'g-bbb', 'second one');
    model.recordPrompt('s-2', 'g-ccc', 'other session');
    assert.deepEqual(model.prompts('s-1').map((p) => p.ref), ['g-aaa', 'g-bbb']);
    assert.equal(model.prompts('s-1')[0].text, 'Hey good morning Axom!');
    assert.equal(model.prompts('s-2').length, 1); // sessions never bleed
    // Survives a fresh model over the same config — that IS the reload case.
    assert.equal(new AxomRuntimes(daemon).prompts('s-1').length, 2);
    // Re-recording a ref replaces rather than duplicates.
    model.recordPrompt('s-1', 'g-aaa', 'Hey good morning Axom!');
    assert.equal(model.prompts('s-1').length, 2);
  });

  it('drops a hidden chat\'s prompts with it, and never another chat\'s', async () => {
    model.add(SSH_RT);
    daemon.axom.endpoints.set('spark', { status: 'connected', sessions: new Map() });
    const a = await model.hook('spark');
    const b = await model.hook('spark');
    model.recordPrompt(a.session, 'g-a', 'mine');
    model.recordPrompt(b.session, 'g-b', 'theirs');
    model.hideChat(a.session);
    assert.equal(model.prompts(a.session).length, 0);
    assert.equal(model.prompts(b.session).length, 1);
  });

  it('names the generation holder only when it is a chat we minted', async () => {
    model.add(SSH_RT);
    const sessions = new Map();
    daemon.axom.endpoints.set('spark', { status: 'connected', sessions });
    const { session } = await model.hook('spark', { label: 'Research' });
    sessions.set(session, { id: session, live: true });
    assert.equal(model.generation('spark').generationHolderLabel, 'Research');
    // A session opened elsewhere (REPL, another client) gets no invented name.
    sessions.clear();
    sessions.set('s-foreign', { id: 's-foreign', live: true });
    assert.equal(model.generation('spark').generationHolder, 's-foreign');
    assert.equal(model.generation('spark').generationHolderLabel, null);
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
