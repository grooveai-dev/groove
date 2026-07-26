// GROOVE — Cross-Daemon InnerChat Relay Tests
// FSL-1.1-Apache-2.0 — see LICENSE
//
// Two in-process daemons, each with a REAL federation keypair, relay to each
// other through an injected transport that mirrors the relay route's trust
// gates (configured-peer check + Ed25519 signature verify). This exercises the
// signing/verification path end-to-end with real keys, the guest-identity
// delivery, the blocking ask round trip, and the async tell → outbox → reply
// path — without binding two HTTP servers.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InnerChat } from '../src/innerchat.js';
import { RelayClient, parsePeerRef, validatePeer } from '../src/innerchat-relay.js';
import { Federation } from '../src/federation.js';

const result = (text) => ({ type: 'result', data: text });
const tick = () => new Promise((r) => setImmediate(r));

const tmpDirs = [];
function makeDaemon() {
  const grooveDir = mkdtempSync(join(tmpdir(), 'groove-relay-'));
  tmpDirs.push(grooveDir);

  const sent = [];
  const daemon = {
    grooveDir,
    host: '127.0.0.1',
    port: 31415,
    config: { innerchatPeers: [] },
    sent,
    registry: {
      _agents: new Map(),
      get(id) { return this._agents.get(id) || null; },
      getAll() { return [...this._agents.values()]; },
      add(a) { this._agents.set(a.id, a); return a; },
      remove(id) { this._agents.delete(id); },
      flushPendingRemovals() {},
      update() {},
    },
    locks: { release() {} },
    processes: {
      _loops: new Set(),
      _running: new Set(),
      hasAgentLoop(id) { return this._loops.has(id); },
      isRunning(id) { return this._running.has(id); },
      async sendMessage(id, msg) { sent.push({ id, msg }); return true; },
      queueMessage() {},
      sessionClock() { return null; },
    },
    broadcast() {},
    audit: { log() {} },
  };
  daemon.federation = new Federation(daemon);
  return daemon;
}

// A fetch stub that routes a relay POST to the target daemon, applying the same
// verification the /api/innerchat/relay route does.
function makeTransport(routes) {
  return async (url, opts) => {
    const body = JSON.parse(opts.body);
    const entry = routes.find((r) => url.startsWith(r.prefix));
    if (!entry) return reply(502, { error: 'no route' });
    const target = entry.daemon;
    const { payload, signature } = body;

    const peer = target.innerchat._peerByDaemonId(payload.fromDaemonId);
    if (!peer) return reply(403, { error: 'unknown daemon' });
    if (!target.federation.verify(payload.fromDaemonId, payload, signature)) {
      return reply(403, { error: 'bad signature' });
    }

    const path = new URL(url).pathname;
    if (path === '/api/innerchat/relay/outbox') {
      return reply(200, { entries: target.innerchat.drainOutbox(payload.fromDaemonId) });
    }
    try {
      const out = await target.innerchat.receiveRelay({ ...payload, peerAlias: peer.alias });
      return reply(200, out);
    } catch (err) {
      return reply(404, { error: err.message, availableAgents: err.availableAgents });
    }
  };
}

function reply(status, json) {
  return { ok: status < 400, status, json: () => Promise.resolve(json) };
}

// Cross-register a as a federation peer of b (b can verify a's signatures) and
// tell a it can reach b at `url` under `alias`.
function link(a, b, alias, url) {
  b.federation._savePeer({
    id: a.federation.getDaemonId(),
    name: alias,
    host: '127.0.0.1',
    port: 1,
    publicKey: a.federation.getPublicKeyPem(),
  });
  a.config.innerchatPeers.push({ alias, url, daemonId: b.federation.getDaemonId() });
}

describe('Cross-daemon InnerChat relay', () => {
  let A, B;

  beforeEach(() => {
    A = makeDaemon();
    B = makeDaemon();

    // A knows B as "bee" (and B trusts A's key); B knows A as "ay".
    link(A, B, 'bee', 'http://peer-b');
    link(B, A, 'ay', 'http://peer-a');

    const transport = makeTransport([
      { prefix: 'http://peer-b', daemon: B },
      { prefix: 'http://peer-a', daemon: A },
    ]);
    A.innerchat = new InnerChat(A, { relay: new RelayClient({ fetchImpl: transport }) });
    B.innerchat = new InnerChat(B, { relay: new RelayClient({ fetchImpl: transport }) });

    // One agent on each daemon, both running interactive loops.
    A.registry.add({ id: 'a1', name: 'Integration-Manager', role: 'fullstack', provider: 'claude-code' });
    A.processes._loops.add('a1'); A.processes._running.add('a1');
    B.registry.add({ id: 'b1', name: 'Architecture-Fable', role: 'architect', provider: 'claude-code' });
    B.processes._loops.add('b1'); B.processes._running.add('b1');
  });

  afterEach(() => {
    A.innerchat.stop();
    B.innerchat.stop();
  });

  it('parses local vs peer references', () => {
    assert.deepEqual(parsePeerRef('Architecture-Fable'), { name: 'Architecture-Fable', alias: null });
    assert.deepEqual(parsePeerRef('Architecture-Fable@spark'), { name: 'Architecture-Fable', alias: 'spark' });
    assert.equal(parsePeerRef('a@b@c'), null);
    assert.equal(A.innerchat.isRemoteRef('local-name'), false);
    assert.equal(A.innerchat.isRemoteRef('name@bee'), true);
  });

  it('relays a blocking ask and returns the peer agent\'s reply', async () => {
    const from = A.registry.get('a1');
    const p = A.innerchat.askRemote(from, 'Architecture-Fable', 'bee', 'What is the envelope shape?');
    await tick(); await tick();

    // B received the question delivered to its local agent, with a guest identity.
    const delivered = B.sent.at(-1);
    assert.equal(delivered.id, 'b1');
    assert.match(delivered.msg, /Integration-Manager@ay.*asking you a question/s);

    // B's agent answers → the reply rides back to A.
    B.innerchat.onAgentOutput('b1', result('It is an additive envelope.'));
    const out = await p;
    assert.equal(out.reply, 'It is an additive envelope.');
    assert.equal(out.remote, true);
    assert.equal(out.peer, 'bee');
  });

  it('rejects a relay from an unconfigured daemon', async () => {
    // B no longer lists A as an InnerChat peer — the config gate rejects it
    // before signature verification even runs.
    B.config.innerchatPeers = [];
    const from = A.registry.get('a1');
    await assert.rejects(
      A.innerchat.askRemote(from, 'Architecture-Fable', 'bee', 'hi'),
      /unknown daemon|refused/i,
    );
  });

  it('rejects a tampered signature', async () => {
    // Point A's relay client at a transport that mangles the signature.
    const good = makeTransport([{ prefix: 'http://peer-b', daemon: B }]);
    const tampering = async (url, opts) => {
      const body = JSON.parse(opts.body);
      body.signature = Buffer.from('nope').toString('base64');
      return good(url, { ...opts, body: JSON.stringify(body) });
    };
    A.innerchat.relay = new RelayClient({ fetchImpl: tampering });
    const from = A.registry.get('a1');
    await assert.rejects(
      A.innerchat.askRemote(from, 'Architecture-Fable', 'bee', 'hi'),
      /bad signature|refused/i,
    );
  });

  it('returns availableAgents when the peer has no such agent', async () => {
    const from = A.registry.get('a1');
    await assert.rejects(
      A.innerchat.askRemote(from, 'Nobody-Here', 'bee', 'hi'),
      (err) => /No agent named/.test(err.message),
    );
  });

  it('refuses a transitive (two-hop) relay target', async () => {
    await assert.rejects(
      B.innerchat.receiveRelay({
        fromName: 'X', fromDaemonId: A.federation.getDaemonId(), peerAlias: 'ay',
        toName: 'Architecture-Fable@somewhere', message: 'hi', kind: 'ask',
      }),
      /one hop only/i,
    );
  });

  it('relays a tell, queues the reply in the outbox, and routes it back on drain', async () => {
    const from = A.registry.get('a1');
    const res = await A.innerchat.tellRemote(from, 'Architecture-Fable', 'bee', 'FYI: spec landed.');
    assert.equal(res.delivered, true);

    // B's agent answers asynchronously → queued in B's outbox for A.
    B.innerchat.onAgentOutput('b1', result('Acknowledged, thanks.'));
    const forA = B.innerchat.drainOutbox(A.federation.getDaemonId());
    assert.equal(forA.length, 1);
    assert.equal(forA[0].text, 'Acknowledged, thanks.');
    assert.equal(forA[0].toName, 'Integration-Manager');

    // Draining removes it (at-least-once).
    assert.equal(B.innerchat.drainOutbox(A.federation.getDaemonId()).length, 0);

    // A routes the queued reply to its local sender.
    await A.innerchat._deliverRemoteReply(A.config.innerchatPeers[0], forA[0]);
    const routed = A.sent.at(-1);
    assert.equal(routed.id, 'a1');
    assert.match(routed.msg, /InnerChat reply from Architecture-Fable@bee/);
    assert.match(routed.msg, /Acknowledged, thanks\./);
  });

  it('surfaces a helpful error for an unknown peer alias', async () => {
    const from = A.registry.get('a1');
    await assert.rejects(
      A.innerchat.askRemote(from, 'Architecture-Fable', 'no-such-peer', 'hi'),
      /No configured InnerChat peer "no-such-peer".*Known peers: bee/s,
    );
  });

  it('validates peer config shape', () => {
    assert.equal(validatePeer({ alias: 'spark', url: 'http://localhost:62686', daemonId: 'a1b2c3d4e5f6' }), null);
    assert.match(validatePeer({ alias: 'sp ace', url: 'http://x', daemonId: 'a1b2c3d4e5f6' }), /alias/);
    assert.match(validatePeer({ alias: 'ok', url: 'ftp://x', daemonId: 'a1b2c3d4e5f6' }), /http/);
    assert.match(validatePeer({ alias: 'ok', url: 'http://u:p@x', daemonId: 'a1b2c3d4e5f6' }), /credentials/);
    assert.match(validatePeer({ alias: 'ok', url: 'http://x', daemonId: 'NOTHEX' }), /daemonId/);
  });
});

// Clean up temp federation dirs.
process.on('exit', () => {
  for (const d of tmpDirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ } }
});
