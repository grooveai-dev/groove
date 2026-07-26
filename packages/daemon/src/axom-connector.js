// GROOVE — Axom Connector
// FSL-1.1-Apache-2.0 — see LICENSE
//
// Consumes the Axom provider protocol (GROOVE ⇄ Axom Integration Contract v0,
// Axom-Labs/Axom-Private docs/GROOVE_INTEGRATION.md):
//
//   GET  /about                          identity + KINDS schema handshake
//   GET  /sessions                       [{session, started, live}]
//   WS   /ws/session/{id}?since=<ev-id>  envelope stream, verbatim
//   POST /session/{id}/interrupt {text}  -> {id, truncated}
//   POST /session/{id}/stop      {}      -> {ok}
//
// The envelope schema is additive-only: unknown kinds are surfaced and passed
// through, never dropped. GROOVE consumes the protocol; it never imports Axom
// code. Host-agnostic by contract §5 — an endpoint is a URL, nothing here may
// assume where the runtime lives.

import { WebSocket } from 'ws';

export const AXOM_DEFAULT_PORT = 8737;

// The frozen KINDS enumeration from Axom's events.py, mirrored for the /about
// handshake. Drift (either direction) is surfaced on the endpoint status —
// new kinds still flow through; this list is for visibility, not filtering.
export const KNOWN_KINDS = Object.freeze([
  'pipeline_start', 'firing_start', 'step_start', 'firing_end', 'pipeline_done',
  'thought', 'text', 'action', 'observation', 'resolution',
  'delegate', 'yield', 'interrupt', 'interrupt_ack',
  'trace_other', 'tool_start', 'tool_end', 'recall_end',
  'swarm_start', 'swarm_weights', 'swarm_agent_done', 'swarm_agent_error',
  'swarm_memory_fused', 'swarm_fused', 'swarm_facts_extracted', 'swarm_done',
  'leaf_swap', 'stop_requested', 'stop_effected', 'candidate_banked',
  'narration', 'narration_dropped',
  'candidate_arrived', 'evidence_scored', 'champion_changed',
  'confidence_updated', 'verifier_verdict',
]);

const RING_SIZE = 4096;
const SESSION_POLL_MS = 15000;
const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 30000;
const FETCH_TIMEOUT_MS = 5000;

export function validateEndpoint(entry) {
  if (!entry || typeof entry !== 'object') return 'endpoint must be an object';
  const { name, url } = entry;
  if (!name || typeof name !== 'string' || !/^[a-zA-Z0-9_-]{1,40}$/.test(name)) {
    return 'endpoint name must be 1-40 chars (letters, digits, dash, underscore)';
  }
  if (!url || typeof url !== 'string') return 'endpoint url is required';
  let parsed;
  try { parsed = new URL(url); } catch { return `invalid url: ${url}`; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return 'endpoint url must be http(s)';
  }
  if (parsed.username || parsed.password) return 'credentials in the url are not allowed';
  return null;
}

function seqOf(eventId) {
  if (typeof eventId !== 'string' || !eventId.startsWith('ev-')) return null;
  const n = parseInt(eventId.slice(3), 10);
  return Number.isFinite(n) ? n : null;
}

export class AxomConnector {
  constructor(daemon, opts = {}) {
    this.daemon = daemon;
    this.ringSize = opts.ringSize || RING_SIZE;
    this.backoffBaseMs = opts.backoffBaseMs || BACKOFF_BASE_MS;
    this.sessionPollMs = opts.sessionPollMs || SESSION_POLL_MS;
    this.endpoints = new Map(); // name -> endpoint state
    this.destroyed = false;
  }

  start() {
    const configured = this.daemon.config?.axom?.endpoints || [];
    this.configure(configured);
  }

  // Reconcile live connections against a validated endpoint list. Persistence
  // is the caller's job (routes save config); this manages connections only.
  configure(entries) {
    const keep = new Set();
    for (const entry of entries) {
      if (validateEndpoint(entry)) continue; // routes validate; skip defensively
      keep.add(entry.name);
      const existing = this.endpoints.get(entry.name);
      if (existing && existing.url === entry.url.replace(/\/+$/, '')) continue;
      if (existing) this._teardownEndpoint(existing);
      this._connectEndpoint(entry);
    }
    for (const [name, ep] of this.endpoints) {
      if (!keep.has(name)) {
        this._teardownEndpoint(ep);
        this.endpoints.delete(name);
      }
    }
  }

  _connectEndpoint({ name, url }) {
    const ep = {
      name,
      url: url.replace(/\/+$/, ''),
      status: 'connecting', // connecting | connected | error
      error: null,
      about: null,
      drift: null, // {novel: [], missing: []} vs KNOWN_KINDS
      sessions: new Map(), // sessionId -> session state
      pollTimer: null,
      backoffMs: this.backoffBaseMs,
    };
    this.endpoints.set(name, ep);
    this._handshake(ep);
    return ep;
  }

  async _fetch(ep, path, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(`${ep.url}${path}`, { ...options, signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${path}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async _handshake(ep) {
    if (this.destroyed) return;
    try {
      const about = await this._fetch(ep, '/about');
      ep.about = about;
      // Mechanical schema handshake (contract §6): compare, surface, never drop.
      const remote = Array.isArray(about.kinds) ? about.kinds : [];
      ep.drift = {
        novel: remote.filter((k) => !KNOWN_KINDS.includes(k)),
        missing: remote.length ? KNOWN_KINDS.filter((k) => !remote.includes(k)) : [],
      };
      ep.status = 'connected';
      ep.error = null;
      ep.backoffMs = this.backoffBaseMs;
      this._broadcastStatus();
      await this._pollSessions(ep);
      ep.pollTimer = setInterval(() => {
        this._pollSessions(ep).catch(() => this._endpointLost(ep));
      }, this.sessionPollMs);
    } catch (err) {
      ep.status = 'error';
      ep.error = err.message;
      this._broadcastStatus();
      this._scheduleEndpointRetry(ep);
    }
  }

  _endpointLost(ep) {
    if (this.destroyed || ep.status === 'error') return;
    ep.status = 'error';
    ep.error = 'endpoint unreachable';
    if (ep.pollTimer) { clearInterval(ep.pollTimer); ep.pollTimer = null; }
    this._broadcastStatus();
    this._scheduleEndpointRetry(ep);
  }

  _scheduleEndpointRetry(ep) {
    if (this.destroyed) return;
    ep.retryTimer = setTimeout(() => {
      ep.backoffMs = Math.min(ep.backoffMs * 2, BACKOFF_MAX_MS);
      this._handshake(ep);
    }, ep.backoffMs);
  }

  async _pollSessions(ep) {
    const list = await this._fetch(ep, '/sessions');
    if (!Array.isArray(list)) return;
    let changed = false;
    for (const info of list) {
      const id = info.session;
      if (!id || typeof id !== 'string') continue;
      let s = ep.sessions.get(id);
      if (!s) {
        s = {
          id,
          started: info.started ?? null,
          live: !!info.live,
          ws: null,
          lastSeq: 0,
          epoch: null,
          ring: [],
          overflow: 0,
          unknownKinds: {},
          reconnectTimer: null,
        };
        ep.sessions.set(id, s);
        changed = true;
      }
      // §12: `live` means a turn is in flight; sessions persist between turns
      // and events can start at any moment — stay attached regardless.
      const wasLive = s.live;
      s.live = !!info.live;
      // A liveness change is news. Without this, the GUI's copy of `live`
      // stays true after a turn ends until something else happens to refetch
      // status — which is how a spinner outlives its turn.
      if (wasLive !== s.live) changed = true;
      if (!s.ws) this._watchSession(ep, s);
    }
    if (changed) this._broadcastStatus();
  }

  _watchSession(ep, s) {
    if (this.destroyed) return;
    // §16.4: reconnects carry both cursor and epoch; a stale epoch voids the
    // cursor runtime-side and we get a full replay instead of a silent gap.
    const params = [];
    if (s.lastSeq > 0) params.push(`since=ev-${String(s.lastSeq).padStart(6, '0')}`);
    if (s.epoch) params.push(`epoch=${encodeURIComponent(s.epoch)}`);
    const query = params.length ? `?${params.join('&')}` : '';
    const wsUrl = `${ep.url.replace(/^http/, 'ws')}/ws/session/${encodeURIComponent(s.id)}${query}`;
    const ws = new WebSocket(wsUrl);
    s.ws = ws;

    ws.on('message', (data) => {
      let envelope;
      try { envelope = JSON.parse(data.toString()); } catch { return; }
      // §16.4 handshake frame — transport metadata, never a transcript event.
      // A changed epoch means the runtime restarted and its event ids reset:
      // our monotonic dedup would silently swallow the entire replay, so the
      // cursor, ring, and GUI copy are all voided together.
      if (envelope.kind === 'ws_hello') {
        const epoch = envelope.payload?.epoch;
        if (epoch && s.epoch && epoch !== s.epoch) {
          s.lastSeq = 0;
          s.ring = [];
          s.overflow = 0;
          s.unknownKinds = {};
          this.daemon.broadcast({ type: 'axom:session:reset', endpoint: ep.name, session: s.id, epoch });
        }
        if (epoch) s.epoch = epoch;
        return;
      }
      const seq = seqOf(envelope.id);
      // Dedup on ring-buffer replay after reconnect — ids are monotonic.
      if (seq !== null && seq <= s.lastSeq) return;
      if (seq !== null) s.lastSeq = seq;
      if (s.ring.length >= this.ringSize) {
        s.ring.shift();
        // The ring bounds memory, not delivery: overflow is counted, never
        // silent, and every event still broadcasts — mirrors the runtime.
        s.overflow += 1;
      }
      s.ring.push(envelope);
      if (envelope.kind && !KNOWN_KINDS.includes(envelope.kind)) {
        s.unknownKinds[envelope.kind] = (s.unknownKinds[envelope.kind] || 0) + 1;
      }
      // Verbatim passthrough — the envelope is the contract, GROOVE adds
      // routing metadata around it, never inside it.
      this.daemon.broadcast({ type: 'axom:event', endpoint: ep.name, session: s.id, envelope });
    });

    const onGone = () => {
      if (s.ws !== ws) return;
      s.ws = null;
      // Identity check, not name check: after configure() replaces an
      // endpoint, a late close from the old socket must not re-arm a
      // reconnect loop on the orphaned object — destroy() could never reach
      // it (this exact leak wedged a test worker into an infinite loop).
      if (this.destroyed || this.endpoints.get(ep.name) !== ep) return;
      s.reconnectTimer = setTimeout(() => this._watchSession(ep, s), ep.backoffMs);
    };
    ws.on('close', onGone);
    ws.on('error', onGone);
  }

  // §12 message verb: starts a turn (interrupt steers, stop halts). Status is
  // part of the contract (202 accepted / 409 busy / 413 too_long) so this
  // returns {status, body} verbatim instead of throwing on non-2xx.
  async message(endpointName, sessionId, text, clientRef) {
    const ep = this._requireEndpoint(endpointName);
    const res = await fetch(`${ep.url}/session/${encodeURIComponent(sessionId)}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // §15: opaque, echoed back in pipeline_start. Omitted when absent so
      // pre-§15 runtimes see exactly today's payload.
      body: JSON.stringify(clientRef ? { text, client_ref: clientRef } : { text }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const body = await res.json().catch(() => ({}));
    // First message creates the session (caller-chosen id) — poll now so the
    // WS attaches before the turn's first events age out of nothing.
    if (res.status === 202) this._pollSessions(ep).catch(() => {});
    return { status: res.status, body };
  }

  // §14: ends the RUNTIME (distinct from stop, which halts a turn). 409 when
  // a turn is in flight unless forced; statuses pass through so the GUI can
  // say what happened rather than guess.
  async shutdown(endpointName, { force = false } = {}) {
    const ep = this._requireEndpoint(endpointName);
    const res = await fetch(`${ep.url}/shutdown`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  }

  async interrupt(endpointName, sessionId, text) {
    const ep = this._requireEndpoint(endpointName);
    return this._fetch(ep, `/session/${encodeURIComponent(sessionId)}/interrupt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
  }

  async stop(endpointName, sessionId) {
    const ep = this._requireEndpoint(endpointName);
    return this._fetch(ep, `/session/${encodeURIComponent(sessionId)}/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
  }

  _requireEndpoint(name) {
    // Single-endpoint convenience: an omitted name resolves iff unambiguous.
    if (!name && this.endpoints.size === 1) return this.endpoints.values().next().value;
    const ep = this.endpoints.get(name);
    if (!ep) throw new Error(`No Axom endpoint named "${name}"`);
    return ep;
  }

  events(endpointName, sessionId, sinceSeq = 0) {
    const ep = this._requireEndpoint(endpointName);
    const s = ep.sessions.get(sessionId);
    if (!s) throw new Error(`No session "${sessionId}" on endpoint "${ep.name}"`);
    const events = sinceSeq > 0 ? s.ring.filter((e) => (seqOf(e.id) || 0) > sinceSeq) : s.ring;
    return { session: s.id, overflow: s.overflow, events };
  }

  status() {
    // A runtime we spawned can be shut down; one we merely connected to
    // cannot (no signal reaches another machine's process). The GUI needs
    // this to avoid offering a kill switch it can't honor.
    const managed = new Set(
      (this.daemon.axomServer?.list?.() || [])
        .filter((i) => i.status === 'running')
        .map((i) => `http://127.0.0.1:${i.port}`),
    );
    // The remote host this GROOVE can start/stop over SSH, if configured.
    // Lets the GUI name who it is talking to ("Spark") instead of showing a
    // loopback URL that says nothing about where the runtime actually lives.
    const remoteCfg = this.daemon.config?.axom?.remote || null;
    const remotePort = remoteCfg?.port || AXOM_DEFAULT_PORT;
    const isLoopback = (u) => /^https?:\/\/(127\.0\.0\.1|localhost)\b/.test(u);

    return {
      remote: remoteCfg
        ? { configured: true, host: remoteCfg.host, user: remoteCfg.user, port: remotePort }
        : { configured: false },
      endpoints: [...this.endpoints.values()].map((ep) => ({
        name: ep.name,
        url: ep.url,
        status: ep.status,
        error: ep.error,
        about: ep.about,
        drift: ep.drift,
        managed: managed.has(ep.url),
        // Reached through the SSH forward to the configured remote host —
        // so the GUI can say "Spark" rather than "127.0.0.1".
        viaRemote: !!remoteCfg && isLoopback(ep.url) && ep.url.endsWith(`:${remotePort}`)
          && !managed.has(ep.url),
        remoteHost: (!!remoteCfg && isLoopback(ep.url) && ep.url.endsWith(`:${remotePort}`)
          && !managed.has(ep.url)) ? remoteCfg.host : null,
        instanceId: (this.daemon.axomServer?.list?.() || [])
          .find((i) => i.status === 'running' && `http://127.0.0.1:${i.port}` === ep.url)?.id || null,
        sessions: [...ep.sessions.values()].map((s) => ({
          session: s.id,
          started: s.started,
          live: s.live,
          watching: !!s.ws,
          lastEventId: s.lastSeq > 0 ? `ev-${String(s.lastSeq).padStart(6, '0')}` : null,
          buffered: s.ring.length,
          overflow: s.overflow,
          unknownKinds: s.unknownKinds,
        })),
      })),
    };
  }

  _broadcastStatus() {
    this.daemon.broadcast({ type: 'axom:status', data: this.status() });
    // Runtime-level state is derived from connector state — push it too so
    // the GUI's runtime cards move on events, not on a poll.
    this.daemon.axomRuntimes?.broadcastStatus?.();
  }

  // Collapse the 'running but not connected' window: when a runtime is known
  // to be answering /about, don't make the user wait out our backoff.
  nudge(name) {
    const ep = this.endpoints.get(name);
    if (!ep || ep.status === 'connected' || this.destroyed) return;
    if (ep.retryTimer) { clearTimeout(ep.retryTimer); ep.retryTimer = null; }
    ep.backoffMs = this.backoffBaseMs;
    this._handshake(ep);
  }

  // The inverse of nudge: after a deliberate stop, 'connected' is presumed
  // stale — re-probe now so the endpoint transitions (and broadcasts) with the
  // verb instead of lingering until the next scheduled poll fails.
  recheck(name) {
    const ep = this.endpoints.get(name);
    if (!ep || this.destroyed) return;
    if (ep.status === 'connected') {
      this._pollSessions(ep).catch(() => this._endpointLost(ep));
    } else {
      this.nudge(name);
    }
  }

  _teardownEndpoint(ep) {
    if (ep.pollTimer) clearInterval(ep.pollTimer);
    if (ep.retryTimer) clearTimeout(ep.retryTimer);
    for (const s of ep.sessions.values()) {
      if (s.reconnectTimer) clearTimeout(s.reconnectTimer);
      // terminate, not close: close() on a CONNECTING socket defers teardown
      // until the connect completes — a live handle that can outlast us.
      if (s.ws) { try { s.ws.terminate(); } catch { /* already gone */ } s.ws = null; }
    }
  }

  destroy() {
    this.destroyed = true;
    for (const ep of this.endpoints.values()) this._teardownEndpoint(ep);
    this.endpoints.clear();
  }
}
