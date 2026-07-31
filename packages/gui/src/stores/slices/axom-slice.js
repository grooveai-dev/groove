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

// Threads are named "Chat N" per runtime — a hat, not an identity. The count
// walks past names already taken so a reopened list doesn't collide.
export function nextChatLabel(chats, runtimeId) {
  const taken = new Set((chats || []).filter((c) => c.runtimeId === runtimeId).map((c) => c.label));
  for (let n = 1; ; n += 1) {
    const candidate = `Chat ${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export const createAxomSlice = (set, get) => ({
  // ── Axom Provider ─────────────────────────────────────────
  axomStatus: { endpoints: [] },
  // "Haven't asked yet" is NOT "nothing configured". Without this, a refresh
  // shows the setup splash for the moment before status arrives, which reads
  // as "my connection was forgotten" and invites the user to re-enter an
  // endpoint they already have.
  axomStatusLoaded: false,
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
      set({ axomStatus: data || { endpoints: [] }, axomStatusLoaded: true });
      if (data?.remote?.configured) get().fetchAxomRemote();
      const instances = await api.get('/axom/instances');
      set({ axomInstances: instances || [] });
    } catch {
      // A daemon that predates these routes genuinely has no Axom config —
      // that IS a loaded answer, so the setup page is the correct render.
      set({ axomStatusLoaded: true });
    }
  },

  // ── Runtimes — the one entity (plans/axom-runtime-flow-redesign.md) ─────
  //
  // Everything the workspace reasons about comes from here: what runtimes
  // exist, which is active, what state each is in, and which single verb that
  // state permits. `canStart`/`canStop`/`canHeal` are the daemon's answer and
  // are never re-derived in the GUI — a client-side guess about what a verb
  // would do is how you get a button that lies.
  //
  // null (not []) until the first answer lands: "no runtimes configured" and
  // "we haven't asked yet" are different states, and only one of them may
  // render the first-run splash.
  axomRuntimes: null,
  axomActiveRuntimeId: null,
  axomRuntimeBusy: {}, // runtime id -> 'starting' | 'stopping' | 'healing'
  // Flips true on the first `axom:runtimes` broadcast. The GUI polls only
  // until it hears one — a daemon that predates the broadcast keeps the
  // fallback, and a daemon that sends them retires it without a redeploy.
  axomRuntimesLive: false,

  async fetchAxomRuntimes() {
    try {
      const data = await api.get('/axom/runtimes');
      set({
        axomRuntimes: data?.runtimes || [],
        axomActiveRuntimeId: data?.activeRuntimeId || null,
      });
      return data;
    } catch {
      // A daemon predating the runtimes model has none — an empty list is the
      // honest answer, and the splash is the correct render for it.
      set({ axomRuntimes: [], axomActiveRuntimeId: null });
      return null;
    }
  },

  // ── Hooks (§10 mono-Axom) ───────────────────────────────────────────────
  //
  // "Multiple Axoms" is an access-layer illusion the product maintains on
  // purpose. A hook — a selector entry, a tab, a new chat — is a fresh
  // session on the ONE runtime, never a second process. So this never routes
  // through spawn, and the labels below name the HAT (which thread you're in),
  // never a separate mind.
  //
  // The chat list is DAEMON-side and is the list of record. It survives
  // reload, tab close and daemon restart, and it remembers rows the user
  // cleared — so rows are never synthesized from the runtime's live session
  // list, which would resurrect a chat the user just removed.
  axomChats: null, // null until first answer; [] means genuinely none

  async fetchAxomChats() {
    try {
      const data = await api.get('/axom/chats');
      set({ axomChats: data?.chats || [] });
      return data?.chats || [];
    } catch {
      set({ axomChats: [] });
      return [];
    }
  },

  async hookAxom({ runtimeId, session, label } = {}) {
    const result = await api.post('/axom/hook', { runtimeId, session, label });
    await get().fetchAxomChats();
    await get().fetchAxomRuntimes();
    await get().selectAxomSession(result.runtimeId, result.session);
    return result;
  },

  async renameAxomChat(session, label) {
    await api.patch(`/axom/chats/${encodeURIComponent(session)}`, { label });
    await get().fetchAxomChats();
  },

  // Removes the ROW, never the conversation: the transcript stays in Axom's
  // ledger and the daemon remembers the row is hidden so the session poll
  // can't bring it back. Nothing here deletes anything.
  async hideAxomChat(session) {
    await api.delete(`/axom/chats/${encodeURIComponent(session)}`);
    await get().fetchAxomChats();
    if (get().axomSelected?.session === session) set({ axomSelected: null });
  },

  async addAxomRuntime(spec) {
    const rt = await api.post('/axom/runtimes', spec);
    await get().fetchAxomRuntimes();
    await get().fetchAxomStatus();
    return rt;
  },

  async updateAxomRuntime(id, patch) {
    const rt = await api.patch(`/axom/runtimes/${encodeURIComponent(id)}`, patch);
    await get().fetchAxomRuntimes();
    return rt;
  },

  async removeAxomRuntime(id) {
    await api.delete(`/axom/runtimes/${encodeURIComponent(id)}`);
    await get().fetchAxomRuntimes();
    await get().fetchAxomStatus();
  },

  async activateAxomRuntime(id) {
    await api.post(`/axom/runtimes/${encodeURIComponent(id)}/activate`, {});
    // The active runtime scopes the whole workspace — drop the old selection
    // so nothing from the previous runtime's session bleeds across.
    set({ axomSelected: null });
    await get().fetchAxomRuntimes();
    await get().fetchAxomStatus();
  },

  // ── Verbs — one per state, dispatched daemon-side on `control` ──────────

  async _runtimeVerb(id, verb, body) {
    set((s) => ({ axomRuntimeBusy: { ...s.axomRuntimeBusy, [id]: verb } }));
    try {
      const result = await api.post(`/axom/runtimes/${encodeURIComponent(id)}/${verb}`, body || {});
      await get().fetchAxomRuntimes();
      await get().fetchAxomStatus();
      return result;
    } finally {
      set((s) => {
        const next = { ...s.axomRuntimeBusy };
        delete next[id];
        return { axomRuntimeBusy: next };
      });
    }
  },

  startAxomRuntimeById(id) { return get()._runtimeVerb(id, 'start'); },
  // Returns the contract outcome ({turnInFlight}/{unsupported}) rather than
  // throwing it — those are things the UI must SAY, not failures to swallow.
  stopAxomRuntimeById(id, { force = false } = {}) { return get()._runtimeVerb(id, 'stop', { force }); },
  healAxomRuntimeById(id) { return get()._runtimeVerb(id, 'heal'); },

  // §16.4 epoch protocol: the runtime restarted and its event ids reset. The
  // transcript we hold describes a previous life of that process — keeping it
  // would splice two runs into one frankenstein history, and the monotonic
  // dedup would swallow the replay that should rebuild it. Drop everything
  // keyed to this session and let the replay refill it.
  resetAxomSession(endpoint, session) {
    const key = sessionKey(endpoint, session);
    set((s) => {
      const drop = (map) => {
        if (!(key in map)) return map;
        const next = { ...map };
        delete next[key];
        return next;
      };
      return {
        axomEvents: drop(s.axomEvents),
        axomInterrupts: drop(s.axomInterrupts),
        axomStops: drop(s.axomStops),
        axomPrompts: drop(s.axomPrompts),
        axomAnomalies: drop(s.axomAnomalies),
      };
    });
  },

  // ── Remote runtime (the machine GROOVE can start/stop over SSH) ─────────
  // DEPRECATED for the GUI: use the runtimes model above. Retained only
  // until the last call site migrates.
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

    // Restore OUR prompts from the daemon and re-pair them to their turns by
    // §15 ref. Without this a reload replayed every turn from the ring with no
    // bubble above it — the answer with the question missing. Turns started
    // elsewhere still have no entry, so they still render bubble-less, which
    // is the honest outcome rather than a fabricated placeholder.
    try {
      const key = sessionKey(endpoint, session);
      const { prompts = [] } = await api.get(`/axom/sessions/${encodeURIComponent(session)}/prompts`);
      set((s) => {
        const known = new Set((s.axomPrompts[key] || []).map((p) => p.ref));
        const events = s.axomEvents[key] || [];
        const restored = prompts.filter((p) => !known.has(p.ref)).map((p) => ({
          p,
          started: events.find((e) => e.kind === 'pipeline_start' && e.payload?.client_ref === p.ref),
        }))
          // Restore ONLY prompts whose turn is still in the ring. An older
          // prompt with nothing to attach to would sit at the transcript foot
          // reading "sent · awaiting turn" — a live claim about a turn that
          // finished hours ago — and one such orphan flips every unclaimed
          // turn to "prompt not identified". Silence beats a false pending.
          .filter((r) => r.started)
          .map((r) => ({ text: r.p.text, ref: r.p.ref, ts: r.p.ts / 1000, attachedTo: r.started.id }));
        if (!restored.length) return {};
        const merged = [...restored, ...(s.axomPrompts[key] || [])]
          .sort((a, b) => a.ts - b.ts)
          .slice(-200);
        return { axomPrompts: { ...s.axomPrompts, [key]: merged } };
      });
    } catch { /* no prompt record — turns render without bubbles, honestly */ }
  },

  ingestAxomEvent(endpoint, session, envelope) {
    const key = sessionKey(endpoint, session);
    set((s) => {
      const buf = s.axomEvents[key] || [];
      if (buf.length && buf[buf.length - 1].id === envelope.id) return {}; // WS echo guard
      // Streaming deltas are cosmetic and superseded by their terminal
      // `resolution`. Once it lands, drop that firing's deltas: they are worth
      // nothing afterwards, the daemon and runtime both omit them from replay
      // (so keeping them would make a live tab disagree with a reloaded one),
      // and a long answer's chunks would otherwise push real events out of the
      // buffer and flood the activity rail.
      const kept = envelope.kind === 'resolution'
        ? buf.filter((e) => !(e.kind === 'resolution_delta'
          && (e.payload?.firing_id ?? null) === (envelope.payload?.firing_id ?? envelope.firing_id ?? null)))
        : buf;
      const updates = {
        axomEvents: { ...s.axomEvents, [key]: [...kept, envelope].slice(-EVENT_BUFFER) },
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
    // A fresh runtime has NO sessions until a first message creates one
    // (§12: session ids are caller-chosen). Requiring a selection here made
    // the first message impossible — you could never create the session you
    // needed in order to send. So: if nothing is selected, open one.
    let sel = get().axomSelected;
    if (!sel) {
      const ep = (get().axomStatus?.endpoints || []).find((e) => e.status === 'connected')
        || (get().axomStatus?.endpoints || [])[0];
      if (!ep) throw new Error('No Axom runtime connected');
      const live = ep.sessions?.find((s) => s.live) || ep.sessions?.[0];
      sel = {
        endpoint: ep.name,
        session: live?.session || `s-${Math.random().toString(36).slice(2, 10)}`,
      };
      set({ axomSelected: sel });
    }
    // §15: an opaque per-message ref the runtime echoes in pipeline_start,
    // making prompt→turn correlation exact instead of inferred.
    const ref = `g-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
    const key = sessionKey(sel.endpoint, sel.session);
    // Record BEFORE the POST resolves. The runtime emits `pipeline_start` the
    // moment it accepts, and that WebSocket frame routinely beats the HTTP 202
    // back to us — so recording on success lost the race: the ref arrived with
    // no prompt to match, the turn rendered "prompt not identified", and the
    // answer sorted above the bubble that appeared later. A prompt in flight is
    // a true thing to show; the rejection paths below remove it again, which
    // preserves the rule that a REJECTED prompt never appears in a transcript.
    set((s) => ({
      axomPrompts: {
        ...s.axomPrompts,
        [key]: [...(s.axomPrompts[key] || []), { text, ref, ts: Date.now() / 1000, attachedTo: null }].slice(-200),
      },
    }));
    const forget = () => set((s) => ({
      axomPrompts: { ...s.axomPrompts, [key]: (s.axomPrompts[key] || []).filter((p) => p.ref !== ref) },
    }));
    try {
      await api.post(`/axom/sessions/${encodeURIComponent(sel.session)}/message`, {
        endpoint: sel.endpoint, text, clientRef: ref,
      });
      // Safety net for the same race: if `pipeline_start` already landed while
      // the POST was in flight, its handler found no prompt to claim. Attach
      // retroactively on the ref — still exact, never inferred.
      set((s) => {
        const prompts = s.axomPrompts[key] || [];
        const mine = prompts.find((p) => p.ref === ref);
        if (!mine || mine.attachedTo) return {};
        const started = (s.axomEvents[key] || []).find(
          (e) => e.kind === 'pipeline_start' && e.payload?.client_ref === ref,
        );
        if (!started) return {};
        return {
          axomPrompts: {
            ...s.axomPrompts,
            [key]: prompts.map((p) => (p.ref === ref ? { ...p, attachedTo: started.id } : p)),
          },
        };
      });
      await get().fetchAxomStatus();
      return { ok: true };
    } catch (err) {
      forget();
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
