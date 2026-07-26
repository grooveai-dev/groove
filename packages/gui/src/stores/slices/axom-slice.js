// FSL-1.1-Apache-2.0 — see LICENSE
//
// Axom provider state. Everything rendered from this slice is
// telemetry-grounded: interrupt/stop UI states flip on EVENTS from the
// runtime, never on our own optimism (contract §2/§7 — fail-deceptive is
// worse than fail-open).

import { api } from '../../lib/api';

const EVENT_BUFFER = 2000;

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
  axomInstances: [], // managed local instances (contract §11)
  axomInstall: { phase: 'idle', file: null, receivedBytes: 0, totalBytes: 0, error: null },
  axomHardware: null, // machine readiness report for local inference
  axomMyEndpoint: null, // this GROOVE's own Axom endpoint (share/copy)

  async fetchAxomStatus() {
    try {
      const data = await api.get('/axom/status');
      set({ axomStatus: data || { endpoints: [] } });
      const instances = await api.get('/axom/instances');
      set({ axomInstances: instances || [] });
    } catch { /* daemon predates the axom routes */ }
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
  },

  async startAxomInstall(manifestUrl) {
    await api.post('/axom/install', manifestUrl ? { manifestUrl } : {});
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
    try {
      await api.post(`/axom/sessions/${encodeURIComponent(sel.session)}/message`, {
        endpoint: sel.endpoint, text,
      });
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
