// GROOVE — Axom Connector Tests
// FSL-1.1-Apache-2.0 — see LICENSE
//
// Runs the connector against a mock bridge speaking the Axom provider
// protocol (GROOVE ⇄ Axom Integration Contract v0). The mock is contract-
// faithful: /about with kinds, /sessions, per-session WS with ?since replay,
// interrupt with 2000-char truncation, sticky idempotent stop.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { AxomConnector, KNOWN_KINDS, validateEndpoint } from '../src/axom-connector.js';

function envelope(seq, kind, payload = {}, session = 's-test0001') {
  return {
    id: `ev-${String(seq).padStart(6, '0')}`,
    ts: 1753000000 + seq,
    session,
    firing_id: null,
    step: null,
    kind,
    payload,
  };
}

// Contract-faithful mock of `axom serve`'s bridge surface.
class MockBridge {
  constructor({ kinds = [...KNOWN_KINDS], sessions } = {}) {
    this.kinds = kinds;
    this.sessions = sessions || { 's-test0001': { started: 1753000000, live: true, events: [] } };
    this.interrupts = [];
    this.stops = [];
    this.sinceSeen = []; // ?since values observed on WS connects
    this.sockets = new Set();
  }

  async start(port = 0) {
    this.server = createServer((req, res) => this._http(req, res));
    this.wss = new WebSocketServer({ noServer: true });
    this.server.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url, 'http://localhost');
      const match = url.pathname.match(/^\/ws\/session\/([^/]+)$/);
      const session = match && this.sessions[decodeURIComponent(match[1])];
      if (!session) { socket.destroy(); return; }
      this.wss.handleUpgrade(req, socket, head, (ws) => {
        this.sockets.add(ws);
        ws.on('close', () => this.sockets.delete(ws));
        const since = url.searchParams.get('since');
        this.sinceSeen.push(since);
        // Ring replay: everything after `since`, then live.
        const from = since ? parseInt(since.slice(3), 10) : 0;
        for (const e of session.events) {
          if (parseInt(e.id.slice(3), 10) > from) ws.send(JSON.stringify(e));
        }
        session.socket = ws;
      });
    });
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(port, '127.0.0.1', resolve);
    });
    this.url = `http://127.0.0.1:${this.server.address().port}`;
  }

  emit(sessionId, env) {
    const session = this.sessions[sessionId];
    session.events.push(env);
    if (session.socket && session.socket.readyState === 1) {
      session.socket.send(JSON.stringify(env));
    }
  }

  _http(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const json = (code, body) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.method === 'GET' && url.pathname === '/about') {
      return json(200, {
        name: 'axom', version: '0.1.0', family: 'phi4mini-s1',
        record: { benchmark: 'HumanEval+', 'pass@1': '73.78%' },
        chassis: { model: 'phi4mini_stock_q8.gguf', loaded: true },
        leaves: [{ name: 'chat', loaded: true }, { name: 'agentic', loaded: true }],
        narrator: 'template',
        kinds: this.kinds,
      });
    }
    if (req.method === 'GET' && url.pathname === '/sessions') {
      return json(200, Object.entries(this.sessions).map(([id, s]) => ({
        session: id, started: s.started, live: s.live,
      })));
    }
    const interrupt = url.pathname.match(/^\/session\/([^/]+)\/interrupt$/);
    const stop = url.pathname.match(/^\/session\/([^/]+)\/stop$/);
    const message = url.pathname.match(/^\/session\/([^/]+)\/message$/);
    if (req.method === 'POST' && (interrupt || stop || message)) {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        if (interrupt) {
          const { text } = JSON.parse(body || '{}');
          this.interrupts.push({ session: interrupt[1], text });
          return json(200, { id: `int-${this.interrupts.length}`, truncated: text.length > 2000 });
        }
        if (message) {
          // §12 semantics: caller-chosen id, first message creates; one turn
          // at a time; hard max with 413, never truncation.
          const id = decodeURIComponent(message[1]);
          const { text } = JSON.parse(body || '{}');
          if (text.length > 32768) return json(413, { error: 'too_long', max: 32768 });
          let session = this.sessions[id];
          if (!session) { session = this.sessions[id] = { started: Date.now() / 1000, live: false, events: [] }; }
          if (session.live) return json(409, { error: 'busy' });
          session.live = true;
          return json(202, { session: id, accepted: true });
        }
        this.stops.push({ session: stop[1] });
        return json(200, { ok: true });
      });
      return;
    }
    json(404, { error: 'not found' });
  }

  async close() {
    for (const ws of this.sockets) ws.terminate();
    this.wss?.close();
    this.server.closeAllConnections?.();
    await new Promise((r) => this.server.close(r));
  }
}

function fakeDaemon() {
  const broadcasts = [];
  return {
    broadcasts,
    config: { axom: { endpoints: [] } },
    broadcast: (m) => broadcasts.push(m),
    audit: { log() {} },
  };
}

async function waitFor(predicate, ms = 3000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error('waitFor timed out');
}

describe('AxomConnector', () => {
  let bridge, daemon, connector;

  beforeEach(async () => {
    bridge = new MockBridge();
    await bridge.start();
    daemon = fakeDaemon();
    connector = new AxomConnector(daemon, { backoffBaseMs: 50, sessionPollMs: 100 });
  });

  afterEach(async () => {
    connector.destroy();
    await bridge.close();
  });

  function connect(name = 'local') {
    connector.configure([{ name, url: bridge.url }]);
  }

  it('handshakes via /about and reports a clean schema match', async () => {
    connect();
    await waitFor(() => connector.status().endpoints[0]?.status === 'connected');
    const ep = connector.status().endpoints[0];
    assert.equal(ep.about.family, 'phi4mini-s1');
    assert.equal(ep.about.narrator, 'template');
    assert.deepEqual(ep.drift, { novel: [], missing: [] });
  });

  it('surfaces schema drift in both directions without dropping anything', async () => {
    await bridge.close();
    bridge = new MockBridge({ kinds: [...KNOWN_KINDS.filter((k) => k !== 'leaf_swap'), 'brand_new_kind'] });
    await bridge.start();
    connect();
    await waitFor(() => connector.status().endpoints[0]?.status === 'connected');
    const ep = connector.status().endpoints[0];
    assert.deepEqual(ep.drift.novel, ['brand_new_kind']);
    assert.deepEqual(ep.drift.missing, ['leaf_swap']);
    assert.equal(ep.status, 'connected'); // drift is surfaced, never fatal
  });

  it('discovers live sessions and passes envelopes through verbatim', async () => {
    connect();
    await waitFor(() => connector.status().endpoints[0]?.sessions[0]?.watching);
    const env = envelope(1, 'pipeline_start', { firing_id: 'f-1' });
    bridge.emit('s-test0001', env);
    await waitFor(() => daemon.broadcasts.some((b) => b.type === 'axom:event'));
    const msg = daemon.broadcasts.find((b) => b.type === 'axom:event');
    assert.equal(msg.endpoint, 'local');
    assert.equal(msg.session, 's-test0001');
    assert.deepEqual(msg.envelope, env); // byte-faithful passthrough
  });

  it('tolerates unknown kinds — passed through and counted, never dropped', async () => {
    connect();
    await waitFor(() => connector.status().endpoints[0]?.sessions[0]?.watching);
    bridge.emit('s-test0001', envelope(1, 'kind_from_the_future', { x: 1 }));
    await waitFor(() => daemon.broadcasts.some((b) => b.type === 'axom:event'));
    assert.equal(daemon.broadcasts.find((b) => b.type === 'axom:event').envelope.kind, 'kind_from_the_future');
    const s = connector.status().endpoints[0].sessions[0];
    assert.equal(s.unknownKinds.kind_from_the_future, 1);
  });

  it('resumes with ?since after reconnect and dedups the ring replay', async () => {
    connect();
    await waitFor(() => connector.status().endpoints[0]?.sessions[0]?.watching);
    bridge.emit('s-test0001', envelope(1, 'pipeline_start'));
    bridge.emit('s-test0001', envelope(2, 'thought', { text: 'hm' }));
    await waitFor(() => daemon.broadcasts.filter((b) => b.type === 'axom:event').length === 2);

    // Kill the socket server-side; connector should reconnect with since=ev-000002.
    bridge.sessions['s-test0001'].socket.terminate();
    await waitFor(() => bridge.sinceSeen.length === 2);
    assert.equal(bridge.sinceSeen[1], 'ev-000002');

    // Replayed history must not re-broadcast; a genuinely new event must.
    bridge.emit('s-test0001', envelope(3, 'resolution'));
    await waitFor(() => daemon.broadcasts.filter((b) => b.type === 'axom:event').length === 3);
    const seqs = daemon.broadcasts.filter((b) => b.type === 'axom:event').map((b) => b.envelope.id);
    assert.deepEqual(seqs, ['ev-000001', 'ev-000002', 'ev-000003']);
  });

  it('proxies interrupt verbatim including the runtime truncation flag', async () => {
    connect();
    await waitFor(() => connector.status().endpoints[0]?.status === 'connected');
    const short = await connector.interrupt('local', 's-test0001', 'skip the auth module');
    assert.deepEqual(short, { id: 'int-1', truncated: false });
    const long = await connector.interrupt('local', 's-test0001', 'x'.repeat(2500));
    assert.equal(long.truncated, true); // the runtime is the truncation authority
    assert.equal(bridge.interrupts.length, 2);
  });

  it('proxies stop and resolves the endpoint when unambiguous', async () => {
    connect();
    await waitFor(() => connector.status().endpoints[0]?.status === 'connected');
    // Omitted endpoint name resolves with exactly one endpoint configured.
    const result = await connector.stop(undefined, 's-test0001');
    assert.deepEqual(result, { ok: true });
    assert.deepEqual(bridge.stops, [{ session: 's-test0001' }]);
  });

  it('counts ring overflow instead of dropping silently', async () => {
    connector.destroy();
    connector = new AxomConnector(daemon, { ringSize: 2, backoffBaseMs: 50, sessionPollMs: 100 });
    connect();
    await waitFor(() => connector.status().endpoints[0]?.sessions[0]?.watching);
    for (let i = 1; i <= 5; i++) bridge.emit('s-test0001', envelope(i, 'thought'));
    await waitFor(() => connector.status().endpoints[0].sessions[0].overflow === 3);
    const s = connector.status().endpoints[0].sessions[0];
    assert.equal(s.buffered, 2);
    assert.equal(s.overflow, 3);
    // All five still broadcast — the ring bounds memory, not delivery.
    assert.equal(daemon.broadcasts.filter((b) => b.type === 'axom:event').length, 5);
  });

  it('serves buffered events with a since cursor for GUI backfill', async () => {
    connect();
    await waitFor(() => connector.status().endpoints[0]?.sessions[0]?.watching);
    for (let i = 1; i <= 3; i++) bridge.emit('s-test0001', envelope(i, 'thought'));
    await waitFor(() => connector.status().endpoints[0].sessions[0].buffered === 3);
    const all = connector.events('local', 's-test0001');
    assert.equal(all.events.length, 3);
    const tail = connector.events('local', 's-test0001', 2);
    assert.deepEqual(tail.events.map((e) => e.id), ['ev-000003']);
  });

  it('isolates concurrent sessions — streams, backfill cursors, and rings never cross', async () => {
    connector.destroy();
    await bridge.close();
    bridge = new MockBridge({
      sessions: {
        's-alpha': { started: 1, live: true, events: [] },
        's-beta': { started: 2, live: true, events: [] },
      },
    });
    await bridge.start();
    connector = new AxomConnector(daemon, { ringSize: 2, backoffBaseMs: 50, sessionPollMs: 100 });
    connect();
    await waitFor(() => {
      const sessions = connector.status().endpoints[0]?.sessions || [];
      return sessions.length === 2 && sessions.every((s) => s.watching);
    });

    bridge.emit('s-alpha', envelope(1, 'pipeline_start', {}, 's-alpha'));
    bridge.emit('s-beta', envelope(1, 'thought', { text: 'b' }, 's-beta'));
    for (let i = 2; i <= 4; i++) bridge.emit('s-alpha', envelope(i, 'thought', {}, 's-alpha'));
    await waitFor(() => daemon.broadcasts.filter((b) => b.type === 'axom:event').length === 5);

    // Broadcast routing: every envelope tagged with its own session, only.
    for (const b of daemon.broadcasts.filter((x) => x.type === 'axom:event')) {
      assert.equal(b.envelope.session, b.session);
    }
    // Backfill cursors never leak across sessions.
    const alpha = connector.events('local', 's-alpha');
    const beta = connector.events('local', 's-beta');
    assert.ok(alpha.events.every((e) => e.session === 's-alpha'));
    assert.deepEqual(beta.events.map((e) => e.session), ['s-beta']);
    // Rings overflow independently: alpha (4 events, ring 2) overflowed, beta did not.
    assert.equal(alpha.overflow, 2);
    assert.equal(beta.overflow, 0);
  });

  it('passes a second stop through cleanly — sticky idempotence is preserved end to end', async () => {
    connect();
    await waitFor(() => connector.status().endpoints[0]?.status === 'connected');
    const first = await connector.stop('local', 's-test0001');
    const second = await connector.stop('local', 's-test0001');
    // The runtime's stop is sticky-idempotent; the proxy must neither error,
    // dedupe, nor add semantics — both calls land, both return {ok}.
    assert.deepEqual(first, { ok: true });
    assert.deepEqual(second, { ok: true });
    assert.equal(bridge.stops.length, 2);
  });

  it('survives a WS drop mid-flow with no gap and no duplicate when the producer never paused', async () => {
    connect();
    await waitFor(() => connector.status().endpoints[0]?.sessions[0]?.watching);
    for (let i = 1; i <= 3; i++) bridge.emit('s-test0001', envelope(i, 'thought'));
    await waitFor(() => daemon.broadcasts.filter((b) => b.type === 'axom:event').length === 3);

    // Drop the socket while the producer keeps firing into the runtime ring.
    bridge.sessions['s-test0001'].socket.terminate();
    for (let i = 4; i <= 6; i++) bridge.emit('s-test0001', envelope(i, 'thought'));

    // Reconnect replays 4-6 from the ring via ?since, then goes live for 7-8.
    await waitFor(() => bridge.sinceSeen.length === 2);
    bridge.emit('s-test0001', envelope(7, 'thought'));
    bridge.emit('s-test0001', envelope(8, 'resolution'));
    await waitFor(() => daemon.broadcasts.filter((b) => b.type === 'axom:event').length === 8);
    const ids = daemon.broadcasts.filter((b) => b.type === 'axom:event').map((b) => b.envelope.id);
    assert.deepEqual(ids, Array.from({ length: 8 }, (_, i) => `ev-${String(i + 1).padStart(6, '0')}`));
  });

  it('message creates a caller-chosen session (202) and the connector attaches to it', async () => {
    connect();
    await waitFor(() => connector.status().endpoints[0]?.status === 'connected');
    const result = await connector.message('local', 's-mine-0001', 'hello axom');
    assert.equal(result.status, 202);
    assert.deepEqual(result.body, { session: 's-mine-0001', accepted: true });
    // The post-202 poll discovers and watches the new session.
    await waitFor(() => {
      const s = connector.status().endpoints[0].sessions.find((x) => x.session === 's-mine-0001');
      return s && s.watching;
    });
  });

  it('mirrors §12 contract statuses verbatim — 409 busy, 413 too_long', async () => {
    connect();
    await waitFor(() => connector.status().endpoints[0]?.status === 'connected');
    await connector.message('local', 's-busy', 'first turn');
    const busy = await connector.message('local', 's-busy', 'second turn');
    assert.equal(busy.status, 409);
    assert.equal(busy.body.error, 'busy');
    const tooLong = await connector.message('local', 's-long', 'x'.repeat(40000));
    assert.equal(tooLong.status, 413);
    assert.equal(tooLong.body.max, 32768);
  });

  it('stays attached to a session between turns (live:false still watched)', async () => {
    connect();
    await waitFor(() => connector.status().endpoints[0]?.sessions[0]?.watching);
    bridge.sessions['s-test0001'].live = false;
    // Force a poll cycle; the watch must not drop on live:false (§12: events
    // for the next turn can start at any moment).
    await new Promise((r) => setTimeout(r, 250));
    const s = connector.status().endpoints[0].sessions.find((x) => x.session === 's-test0001');
    assert.equal(s.live, false);
    assert.equal(s.watching, true);
  });

  it('reports an unreachable endpoint honestly and recovers by retry', async () => {
    const deadUrl = bridge.url;
    const port = Number(new URL(deadUrl).port);
    await bridge.close();
    connector.configure([{ name: 'local', url: deadUrl }]);
    await waitFor(() => connector.status().endpoints[0]?.status === 'error');
    assert.ok(connector.status().endpoints[0].error);

    // Bring a bridge back on the same port; backoff retry should reconnect.
    bridge = new MockBridge();
    await bridge.start(port);
    await waitFor(() => connector.status().endpoints[0]?.status === 'connected', 5000);
  });
});

describe('validateEndpoint', () => {
  it('accepts a clean http endpoint', () => {
    assert.equal(validateEndpoint({ name: 'local', url: 'http://127.0.0.1:8737' }), null);
  });

  it('rejects bad names, schemes, and embedded credentials', () => {
    assert.ok(validateEndpoint({ name: 'bad name!', url: 'http://127.0.0.1:8737' }));
    assert.ok(validateEndpoint({ name: 'x', url: 'ftp://127.0.0.1' }));
    assert.ok(validateEndpoint({ name: 'x', url: 'javascript:alert(1)' }));
    assert.ok(validateEndpoint({ name: 'x', url: 'http://user:pass@host:8737' }));
    assert.ok(validateEndpoint({ name: 'x', url: 'not a url' }));
    assert.ok(validateEndpoint({ name: 'x' }));
    assert.ok(validateEndpoint(null));
  });
});
