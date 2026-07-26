// FSL-1.1-Apache-2.0 — see LICENSE
//
// Axom provider state. Everything rendered from this slice is
// telemetry-grounded: interrupt/stop UI states flip on EVENTS from the
// runtime, never on our own optimism (contract §2/§7 — fail-deceptive is
// worse than fail-open).

import { api } from '../../lib/api';

const EVENT_BUFFER = 2000;
// How long a sent prompt stays eligible to claim the next turn. Past this,
// it is more likely orphaned than starting, and claiming would misattribute.
const PROMPT_CORRELATION_WINDOW_S = 120;

const sessionKey = (endpoint, session) => `${endpoint}/${session}`;

export const createAxomSlice = (set, get) => ({
  // ── Axom Provider ─────────────────────────────────────────
  axomStatus: { endpoints: [] },
  axomSelected: null, // { endpoint, session }
  axomEvents: {}, // sessionKey -> [envelope] (bounded)
  // Local interrupt ledger: id -> {text, state}. state: 'sent' (POST accepted,
  // not yet seen on the stream) | 'heard' (interrupt event arrived) |
  // 'acked' (interrupt_ack arrived). Rollup states come from pipeline_done.
  axomInterrupts: {}, // sessionKey -> { [id]: {text, state, truncated} }
  // Stop states: null | 'pending' (POST sent, nothing effected yet) |
  // 'effected' (stop_effected seen) | 'resolved-before-stop' (§7 edge:
  // pipeline_done arrived with no stop_effected).
  axomStops: {}, // sessionKey -> state
  // Contract-violation log (§8): e.g. an interrupt_ack without interrupt_id.
  // A fallback that fires must announce itself — never degrade silently.
  axomAnomalies: {}, // sessionKey -> [{eventId, message}]
  // Prompts WE sent, per session — GROOVE's own record of its own action,
  // not telemetry (the runtime's pipeline_start carries no prompt text). Each
  // entry attaches to the next pipeline_start envelope so a turn can show
  // what was asked. Prompts sent by another client (the REPL, a second
  // GROOVE) are not ours to know: those turns render without a user bubble
  // rather than with a guessed one.
  axomPrompts: {}, // sessionKey -> [{ text, ts, attachedTo: evId|null }]
  axomInstances: [], // managed local instances (contract §11)
  axomInstall: { phase: 'idle', file: null, receivedBytes: 0, totalBytes: 0, error: null },
  axomHardware: null, // machine readiness report for local inference
  axomMyEndpoint: null, // this GROOVE's own Axom endpoint (share/copy)

  async fetchAxomStatus() {
    try {
      const data = await api.get('/axom/status');
      set({ axomStatus: data || { endpoints: [] } });
      if (data?.remote?.configured) get().fetchAxomRemote();
      const instances = await api.get('/axom/instances');
      set({ axomInstances: instances || [] });
    } catch { /* daemon predates the axom routes */ }
  },

  // ── Remote runtime (the machine GROOVE can start/stop over SSH) ─────────
  // `running: null` means the host is UNREACHABLE — we do not know the
  // runtime's state and must never render it as stopped.
  axomRemote: { configured: false, running: null },
  axomRemoteBusy: null, // 'starting' | 'stopping' | 'tunneling' | null

  async fetchAxomRemote() {
    try {
      const data = await api.get('/axom/remote');
      set({ axomRemote: data });
      return data;
    } catch { /* daemon predates the route */ return null; }
  },

  async startAxomRuntime() {
    set({ axomRemoteBusy: 'starting' });
    try {
      const result = await api.post('/axom/remote/start', {});
      await get().fetchAxomRemote();
      await get().fetchAxomStatus();
      return result;
    } finally {
      set({ axomRemoteBusy: null });
    }
  },

  async stopAxomRuntime({ force = false } = {}) {
    set({ axomRemoteBusy: 'stopping' });
    try {
      const result = await api.post('/axom/remote/stop', { force });
      await get().fetchAxomRemote();
      await get().fetchAxomStatus();
      return result; // { stopped } | { stopped:false, turnInFlight:true }
    } finally {
      set({ axomRemoteBusy: null });
    }
  },

  // Reachability only — heals the SSH forward, never touches the runtime.
  async healAxomTunnel() {
    set({ axomRemoteBusy: 'tunneling' });
    try {
      const result = await api.post('/axom/remote/tunnel', {});
      await get().fetchAxomStatus();
      return result;
    } finally {
      set({ axomRemoteBusy: null });
    }
  },

  async fetchAxomHardware() {
    try {
      const data = await api.get('/axom/hardware');
      set({ axomHardware: data });
    } catch { /* daemon predates the route */ }
    try {
      const me = await api.get('/axom/my-endpoint');
      set({ axomMyEndpoint: me });
    } catch { /* daemon predates the route */ }
    try {
      // Availability ("Coming soon" on builds with no distribution) must be
      // known before the welcome page offers an install action.
      const install = await api.get('/axom/install');
      set((s) => ({ axomInstall: { ...s.axomInstall, ...install } }));
    } catch { /* daemon predates the route */ }
  },

  async startAxomInstall(manifestUrl) {
    await api.post('/axom/install', manifestUrl ? { manifestUrl } : {});
  },

  // §14: end the RUNTIME (not a turn). Contract statuses are returned rather
  // than thrown — 409 (turn in flight) and 501 (runtime predates the verb)
  // are things the UI must SAY, not failures to swallow.
  async shutdownAxomRuntime(endpoint, { force = false } = {}) {
    try {
      await api.post('/axom/shutdown', { endpoint, force });
      await get().fetchAxomStatus();
      return { stopping: true };
    } catch (err) {
      if (err.status === 409) return { turnInFlight: true };
      if (err.status === 501) return { unsupported: true };
      throw err;
    }
  },

  async startAxomInstance(id = 'default') {
    const instance = await api.post('/axom/instances', { id });
    await get().fetchAxomStatus();
    return instance;
  },

  async stopAxomInstance(id) {
    await api.delete(`/axom/instances/${encodeURIComponent(id)}`);
    await get().fetchAxomStatus();
  },

  async saveAxomEndpoints(endpoints) {
    const data = await api.patch('/axom/config', { endpoints });
    await get().fetchAxomStatus();
    return data;
  },

  async selectAxomSession(endpoint, session) {
    set({ axomSelected: { endpoint, session } });
    // Backfill from the daemon's ring so a freshly opened tab has history.
    try {
      const data = await api.get(`/axom/sessions/${encodeURIComponent(session)}/events?endpoint=${encodeURIComponent(endpoint)}`);
      const key = sessionKey(endpoint, session);
      set((s) => {
        const existing = s.axomEvents[key] || [];
        const seen = new Set(existing.map((e) => e.id));
        const merged = [...(data.events || []).filter((e) => !seen.has(e.id)), ...existing]
          .sort((a, b) => (a.id < b.id ? -1 : 1))
          .slice(-EVENT_BUFFER);
        return { axomEvents: { ...s.axomEvents, [key]: merged } };
      });
    } catch { /* session may have no ring yet — live events still flow */ }
  },

  ingestAxomEvent(endpoint, session, envelope) {
    const key = sessionKey(endpoint, session);
    set((s) => {
      const buf = s.axomEvents[key] || [];
      if (buf.length && buf[buf.length - 1].id === envelope.id) return {}; // WS echo guard
      const updates = {
        axomEvents: { ...s.axomEvents, [key]: [...buf, envelope].slice(-EVENT_BUFFER) },
      };

      // Correlate our sent prompt with the turn it started.
      //
      // The runtime's pipeline_start carries no client reference (§12 has no
      // echo field yet), so correlation is inference, and inference here can
      // LIE: another client (the REPL, a second GROOVE) opening a turn on this
      // session would otherwise adopt our text as its prompt — displaying our
      // words above someone else's turn. Confidently wrong is worse than
      // silent, so we only attach when the inference is unambiguous:
      //   - exactly one prompt of ours is pending (two in flight = we cannot
      //     tell which turn is which), and
      //   - it was sent recently (a stale pending prompt is more likely
      //     orphaned than finally starting).
      // Anything else stays unattached and renders as "started elsewhere" —
      // honest silence. A client_ref echo in pipeline_start would make this
      // exact; requested from the Axom side.
      if (envelope.kind === 'pipeline_start') {
        const prompts = s.axomPrompts[key] || [];
        const pending = prompts.filter((p) => p.attachedTo === null);
        const ref = envelope.payload?.client_ref;
        // §15: when the runtime echoes our ref, correlation is EXACT — match
        // on it and never guess. A ref that is present but not ours means the
        // turn belongs to another client: attach nothing.
        let claim = null;
        if (typeof ref === 'string' && ref) {
          claim = pending.find((p) => p.ref === ref) || null;
        } else if (ref === undefined) {
          // Pre-§15 runtime: fall back to the bounded inference above.
          claim = (pending.length === 1
            && (Date.now() / 1000) - pending[0].ts < PROMPT_CORRELATION_WINDOW_S)
            ? pending[0] : null;
        }
        if (claim) {
          const idx = prompts.indexOf(claim);
          const next = prompts.slice();
          next[idx] = { ...next[idx], attachedTo: envelope.id };
          updates.axomPrompts = { ...s.axomPrompts, [key]: next };
        }
      }

      // Interrupt lifecycle — driven only by what the runtime says happened.
      // §8 pins interrupt_ack.payload.interrupt_id as ALWAYS present; the
      // oldest-pending fallback stays as defense but surfaces as an anomaly
      // when it fires — an ack without an id is a runtime bug to expose.
      if (envelope.kind === 'interrupt' || envelope.kind === 'interrupt_ack') {
        const ledger = { ...(s.axomInterrupts[key] || {}) };
        const evId = envelope.payload?.interrupt_id ?? envelope.payload?.id;
        const nextState = envelope.kind === 'interrupt' ? 'heard' : 'acked';
        if (evId && ledger[evId]) {
          ledger[evId] = { ...ledger[evId], state: nextState };
        } else if (evId) {
          // Known id, not ours — an interrupt posted by another client (e.g.
          // typed straight into the REPL). Normal; it lives in the ticker,
          // our ledger stays untouched.
        } else {
          // No id at all — a shape violation per §8. Advance the oldest
          // pending entry as defense, and announce that the fallback fired.
          const pending = Object.entries(ledger).find(([, v]) => v.state !== nextState && v.state !== 'acked');
          if (pending) ledger[pending[0]] = { ...pending[1], state: nextState };
          updates.axomAnomalies = {
            ...s.axomAnomalies,
            [key]: [
              ...(s.axomAnomalies[key] || []),
              { eventId: envelope.id, message: `${envelope.kind} arrived without an interrupt id (§8 violation)${pending ? ` — fallback advanced "${pending[1].text?.slice(0, 40)}"` : ''}` },
            ].slice(-50),
          };
        }
        updates.axomInterrupts = { ...s.axomInterrupts, [key]: ledger };
      }

      if (envelope.kind === 'stop_effected' && s.axomStops[key] === 'pending') {
        updates.axomStops = { ...s.axomStops, [key]: 'effected' };
      }
      // §7 stop edge: the run can resolve before stop lands. Release the
      // sticky pressed state on pipeline_done and say what actually happened.
      if (envelope.kind === 'pipeline_done' && s.axomStops[key] === 'pending') {
        updates.axomStops = { ...s.axomStops, [key]: 'resolved-before-stop' };
      }
      return updates;
    });
  },

  // §12: message starts a turn on a caller-chosen session id (first message
  // creates the session). 409 means a turn is in flight — steer instead.
  async sendAxomMessage(text) {
    const sel = get().axomSelected;
    if (!sel) throw new Error('No Axom session selected');
    // §15: an opaque per-message ref the runtime echoes in pipeline_start,
    // making prompt→turn correlation exact instead of inferred.
    const ref = `g-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
    try {
      await api.post(`/axom/sessions/${encodeURIComponent(sel.session)}/message`, {
        endpoint: sel.endpoint, text, clientRef: ref,
      });
      // Record only after the runtime ACCEPTED it (202) — a rejected prompt
      // never ran, so it must not appear in the transcript.
      const key = sessionKey(sel.endpoint, sel.session);
      set((s) => ({
        axomPrompts: {
          ...s.axomPrompts,
          [key]: [...(s.axomPrompts[key] || []), { text, ref, ts: Date.now() / 1000, attachedTo: null }].slice(-200),
        },
      }));
      await get().fetchAxomStatus();
      return { ok: true };
    } catch (err) {
      if (err.status === 409) return { busy: true };
      if (err.status === 413) return { tooLong: true, max: err.body?.max };
      throw err;
    }
  },

  async sendAxomInterrupt(text) {
    const sel = get().axomSelected;
    if (!sel) throw new Error('No Axom session selected');
    const result = await api.post(`/axom/sessions/${encodeURIComponent(sel.session)}/interrupt`, {
      endpoint: sel.endpoint, text,
    });
    const key = sessionKey(sel.endpoint, sel.session);
    set((s) => ({
      axomInterrupts: {
        ...s.axomInterrupts,
        [key]: {
          ...(s.axomInterrupts[key] || {}),
          [result.id]: { text, state: 'sent', truncated: !!result.truncated },
        },
      },
    }));
    return result;
  },

  async sendAxomStop() {
    const sel = get().axomSelected;
    if (!sel) throw new Error('No Axom session selected');
    const key = sessionKey(sel.endpoint, sel.session);
    set((s) => ({ axomStops: { ...s.axomStops, [key]: 'pending' } }));
    try {
      return await api.post(`/axom/sessions/${encodeURIComponent(sel.session)}/stop`, { endpoint: sel.endpoint });
    } catch (err) {
      // The POST failed — nothing was requested, so the button must not stay
      // pressed pretending it was.
      set((s) => ({ axomStops: { ...s.axomStops, [key]: null } }));
      throw err;
    }
  },
});

export { sessionKey as axomSessionKey };
