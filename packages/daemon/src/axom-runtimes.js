// GROOVE — Axom Runtime Model (the redesign's one entity)
// FSL-1.1-Apache-2.0 — see LICENSE
//
// A `runtime` is the single thing the GUI reasons about: a named Axom with a
// URL and a control mode. Everything else (connector endpoints, spawned
// instances, SSH lifecycle, tunnels) is a backend behind this model.
//
//   control: 'local' — a process THIS daemon spawns/kills (AxomServerManager)
//   control: 'ssh'   — start/stop over SSH on a machine the user owns
//   control: 'none'  — someone else's runtime; connect-only
//
// States, each owning one recovery action (plans/axom-runtime-flow-redesign.md):
//   connected → events flowing        (verb: stop / disconnect)
//   running   → /about answers, WS catching up   (no verb needed)
//   stopped   → reachable, no runtime            (verb: start, if controllable)
//   unreachable → can't reach the URL/host       (verb: heal tunnel / retry)
// `unknown` appears only when probing itself failed — never guessed away.

import { validateEndpoint } from './axom-connector.js';
import { validateRemote } from './axom-remote.js';
import { saveConfig } from './firstrun.js';

// The blessed launch spec's env (SPARK_DEV_SETUP.md / §10). These change
// runtime BEHAVIOUR, not just paths — a spec missing AXOM_MAX_CTX boots a
// 2048-ctx runtime that looks fine and answers worse. Applied as DEFAULTS
// only: a value the user set in their own spec always wins, because "GROOVE
// never edits a spec's flags" is the standing ruling.
export const BLESSED_ENV = { AXOM_MAX_CTX: '8192' };

function withBlessedEnv(launch) {
  if (!launch?.command) return launch;
  return { ...launch, env: { ...BLESSED_ENV, ...(launch.env || {}) } };
}

// A chat title is the opening message, trimmed to a glanceable length. It is
// a QUOTE, not a summary: GROOVE has no business paraphrasing what the user
// said, and an em-dash ellipsis makes the truncation visible rather than
// pretending the sentence ended there.
const TITLE_MAX = 48;
export function summarizeForTitle(text) {
  if (typeof text !== 'string') return null;
  const flat = text.replace(/\s+/g, ' ').trim();
  if (!flat) return null;
  if (flat.length <= TITLE_MAX) return flat;
  // Prefer a word boundary so titles don't end mid-word.
  const cut = flat.slice(0, TITLE_MAX);
  const space = cut.lastIndexOf(' ');
  return `${(space > TITLE_MAX * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

// Single-quote for a POSIX shell. The spec is the user's own, but it crosses
// an ssh command line — an unquoted path or value must not be able to end the
// command and start another.
function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

export function validateRuntime(rt) {
  if (!rt || typeof rt !== 'object') return 'runtime must be an object';
  if (!rt.id || !/^[a-zA-Z0-9_-]{1,40}$/.test(rt.id)) return 'invalid runtime id';
  if (!rt.name || typeof rt.name !== 'string' || rt.name.length > 60) return 'invalid runtime name';
  if (!['local', 'ssh', 'none'].includes(rt.control)) return 'control must be local, ssh, or none';
  if (rt.control !== 'local' || rt.url) {
    // local runtimes get their URL from the spawned port; others must have one
    const problem = validateEndpoint({ name: rt.id, url: rt.url });
    if (rt.control !== 'local' && problem) return problem;
  }
  if (rt.control === 'ssh') {
    const problem = validateRemote({ port: undefined, ...rt.ssh });
    if (problem) return `ssh config: ${problem}`;
  }
  if (rt.launch !== undefined) {
    if (typeof rt.launch !== 'object' || typeof rt.launch.command !== 'string'
      || rt.launch.command.length === 0 || rt.launch.command.length > 500) {
      return 'launch.command must be a non-empty string of at most 500 chars';
    }
    if (rt.launch.cwd !== undefined && typeof rt.launch.cwd !== 'string') {
      return 'launch.cwd must be a string';
    }
    if (rt.launch.env !== undefined) {
      if (typeof rt.launch.env !== 'object' || rt.launch.env === null || Array.isArray(rt.launch.env)) {
        return 'launch.env must be an object of name/value pairs';
      }
      for (const [k, v] of Object.entries(rt.launch.env)) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) return `invalid env var name "${k}"`;
        if (typeof v !== 'string' && typeof v !== 'number') return `env var "${k}" must be a string or number`;
      }
    }
  }
  return null;
}

export class AxomRuntimes {
  constructor(daemon) {
    this.daemon = daemon;
  }

  // ── Config ────────────────────────────────────────────────────────────────

  _cfg() {
    if (!this.daemon.config.axom) this.daemon.config.axom = {};
    return this.daemon.config.axom;
  }

  list() {
    return this._cfg().runtimes || [];
  }

  get(id) {
    return this.list().find((r) => r.id === id) || null;
  }

  activeId() {
    const cfg = this._cfg();
    return cfg.activeRuntimeId && this.get(cfg.activeRuntimeId)
      ? cfg.activeRuntimeId
      : this.list()[0]?.id || null;
  }

  // One-time, idempotent: fold the four legacy keys into runtimes[]. Old keys
  // are kept until the model proves out — compat routes still read them.
  migrate() {
    const cfg = this._cfg();
    // Marker, not mere presence of the array: an earlier migration could write
    // an EMPTY runtimes[] and then never retry, stranding a configured host
    // behind a first-run splash forever. Re-run until it produces something or
    // there is genuinely nothing legacy left to fold.
    if (cfg.runtimesMigrated) return false;
    if (Array.isArray(cfg.runtimes) && cfg.runtimes.length) {
      cfg.runtimesMigrated = true;
      return false;
    }
    const runtimes = [];
    const remote = cfg.remote || null;
    const ep = (cfg.endpoints || [])[0] || null;
    // A remote host is a configured runtime whether or not an endpoint entry
    // survives beside it — the endpoint list gets cleared by a disconnect, and
    // dropping the host on that basis would strand a machine the user set up
    // and show them a first-run splash instead.
    if (remote?.host && (!ep || ep.url.endsWith(`:${remote.port || 8737}`))) {
      runtimes.push({
        id: 'spark', name: remote.host.split('.')[0] || 'Remote',
        url: ep?.url || `http://127.0.0.1:${remote.port || 8737}`,
        control: 'ssh',
        ssh: { host: remote.host, user: remote.user, sshPort: remote.sshPort, autoTunnel: true },
        launch: remote.command ? { command: remote.command } : undefined,
        logPath: remote.logPath,
      });
    } else if (ep) {
      let name = 'Axom';
      try { name = new URL(ep.url).hostname; } catch { /* keep default */ }
      runtimes.push({ id: ep.name || 'axom', name, url: ep.url, control: 'none' });
    }
    cfg.runtimes = runtimes;
    if (runtimes.length) {
      cfg.runtimesMigrated = true;
      if (!cfg.activeRuntimeId) cfg.activeRuntimeId = runtimes[0].id;
    }
    return true;
  }

  _save() {
    saveConfig(this.daemon.grooveDir, this.daemon.config);
  }

  start() {
    // Persist it: an unsaved migration re-derives on every boot, so a runtime
    // the user later removed would come back from the legacy keys each time.
    if (this.migrate()) this._save();
    this._syncConnector();
  }

  // Every runtime with a URL becomes a connector endpoint — the connector
  // stays the single owner of event streams.
  _syncConnector() {
    const entries = this.list()
      .filter((r) => r.url)
      .map((r) => ({ name: r.id, url: r.url }));
    this.daemon.axom.configure(entries);
  }

  add(rt) {
    const problem = validateRuntime(rt);
    if (problem) throw new Error(problem);
    if (this.get(rt.id)) throw new Error(`runtime "${rt.id}" already exists`);
    this._cfg().runtimes = [...this.list(), rt];
    if (!this._cfg().activeRuntimeId) this._cfg().activeRuntimeId = rt.id;
    this._save();
    this._syncConnector();
    this.broadcastStatus();
    return rt;
  }

  update(id, patch) {
    const existing = this.get(id);
    if (!existing) throw new Error(`no runtime "${id}"`);
    const next = { ...existing, ...patch, id };
    const problem = validateRuntime(next);
    if (problem) throw new Error(problem);
    this._cfg().runtimes = this.list().map((r) => (r.id === id ? next : r));
    this._save();
    this._syncConnector();
    this.broadcastStatus();
    return next;
  }

  remove(id) {
    if (!this.get(id)) throw new Error(`no runtime "${id}"`);
    this._cfg().runtimes = this.list().filter((r) => r.id !== id);
    if (this._cfg().activeRuntimeId === id) {
      this._cfg().activeRuntimeId = this.list()[0]?.id || null;
    }
    this._save();
    this._syncConnector();
    this.broadcastStatus();
  }

  activate(id) {
    if (!this.get(id)) throw new Error(`no runtime "${id}"`);
    this._cfg().activeRuntimeId = id;
    this._save();
    this.broadcastStatus();
  }

  // ── State derivation ──────────────────────────────────────────────────────

  async state(id) {
    const rt = this.get(id);
    if (!rt) throw new Error(`no runtime "${id}"`);
    const ep = rt.url ? this.daemon.axom.endpoints.get(rt.id) : null;

    if (ep?.status === 'connected') {
      return { state: 'connected', detail: null };
    }
    // Probe the URL directly — the connector's backoff may simply not have
    // caught up yet, and "running" beats a stale "error".
    if (rt.url) {
      try {
        const res = await fetch(`${rt.url}/about`, { signal: AbortSignal.timeout(3000) });
        if (res.ok) {
          // It answers — pull the connector in NOW instead of letting its
          // backoff stretch the 'running' limbo into a felt stall.
          this.daemon.axom.nudge?.(rt.id);
          return { state: 'running', detail: 'connecting to event stream' };
        }
      } catch (err) {
        const refused = /ECONNREFUSED/.test(err.cause?.code || err.message || '');
        if (refused && rt.control !== 'ssh') {
          return { state: 'stopped', detail: null };
        }
      }
    }
    if (rt.control === 'ssh') {
      // The host knows more than the tunnel does.
      const remote = await this.daemon.axomRemote.status(this._sshCfg(rt));
      if (remote.running === true) return { state: 'unreachable', detail: 'runtime is up on the host — the tunnel is down' };
      if (remote.running === false) return { state: 'stopped', detail: null };
      return { state: 'unreachable', detail: remote.error || `can't reach ${rt.ssh.host}` };
    }
    if (rt.control === 'local') {
      const inst = this.daemon.axomServer.list().find((i) => i.id === rt.id);
      if (inst?.status === 'running') return { state: 'running', detail: 'connecting to event stream' };
      return { state: 'stopped', detail: inst?.error || null };
    }
    return { state: 'unreachable', detail: 'nothing answers at this endpoint' };
  }

  _broadcasting = false;
  async broadcastStatus() {
    if (this._broadcasting) return; // status() probes; don't stampede
    this._broadcasting = true;
    try {
      this.daemon.broadcast({ type: 'axom:runtimes', data: await this.status() });
    } catch { /* next state change rebroadcasts */ } finally {
      this._broadcasting = false;
    }
  }

  async status() {
    const runtimes = await Promise.all(this.list().map(async (rt) => {
      let derived;
      try {
        derived = await this.state(rt.id);
      } catch (err) {
        derived = { state: 'unknown', detail: err.message };
      }
      const ep = this.daemon.axom.endpoints.get(rt.id);
      return {
        id: rt.id,
        name: rt.name,
        control: rt.control,
        url: rt.url || null,
        ...derived,
        about: ep?.about || null,
        error: ep?.error || null,
        canStart: rt.control !== 'none' && derived.state === 'stopped',
        canStop: rt.control !== 'none' && (derived.state === 'connected' || derived.state === 'running'),
        canHeal: rt.control === 'ssh' && derived.state === 'unreachable',
        ...this.generation(rt.id),
      };
    }));
    return { runtimes, activeRuntimeId: this.activeId() };
  }

  // ── Mono-Axom (§10) ───────────────────────────────────────────────────────
  //
  // One Axom per user per machine. Every hook — a selector entry, a tab, a new
  // chat — is a fresh SESSION on the one runtime, never a second process. The
  // §14 lockfile is the enforcement mechanism, so racing hooks are safe: the
  // loser is refused cleanly and joins the winner's runtime.

  // Until multi-sequence lands, hooks share ONE generation slot. Concurrent
  // work queues, and the UI is required to say so rather than looking hung.
  generation(id) {
    const ep = this.daemon.axom.endpoints.get(id);
    const busySession = (ep?.sessions ? [...ep.sessions.values()] : []).find((s) => s.live);
    return {
      generationBusy: !!busySession,
      generationHolder: busySession?.id || null,
      // The holder's human name, if it is a chat this GROOVE minted. A session
      // opened elsewhere (the REPL, another client) has none — the UI says
      // "another session" rather than inventing one.
      generationHolderLabel: busySession ? (this.getChat(busySession.id)?.label || null) : null,
    };
  }

  // ── Chats — the persistent hook list ─────────────────────────────────────
  //
  // A chat is a named hook. It lives in daemon config, not the browser: tunnel
  // ports move, tabs reload, and a chat list that evaporates on refresh reads
  // as data loss even though the ledger kept everything.

  chats() {
    return (this._cfg().chats || []).filter((c) => !c.hidden);
  }

  getChat(session) {
    return (this._cfg().chats || []).find((c) => c.session === session) || null;
  }

  _putChat(chat) {
    const all = this._cfg().chats || [];
    const i = all.findIndex((c) => c.session === chat.session);
    this._cfg().chats = i >= 0 ? all.map((c) => (c.session === chat.session ? chat : c)) : [...all, chat];
    this._save();
  }

  // A chat titles itself from what it started with — "Chat 3" tells you
  // nothing when you have six of them. Only ever replaces a PLACEHOLDER title:
  // a name the user typed, or one already derived from the opening message, is
  // never overwritten by a later turn.
  titleFromFirstMessage(session, text) {
    const chat = this.getChat(session);
    if (!chat || chat.titled || chat.renamed) return null;
    const title = summarizeForTitle(text);
    if (!title) return null;
    this._putChat({ ...chat, label: title, titled: true });
    this.broadcastChats();
    return title;
  }

  renameChat(session, label) {
    const chat = this.getChat(session);
    if (!chat) throw new Error(`no chat "${session}"`);
    if (typeof label !== 'string' || !label.trim() || label.length > 80) {
      throw new Error('label must be a non-empty string of at most 80 chars');
    }
    // `renamed` is sticky: once the user names a chat, no later auto-title
    // may take it back.
    this._putChat({ ...chat, label: label.trim(), renamed: true });
    this.broadcastChats();
    return this.getChat(session);
  }

  // Hide, never delete. The conversation lives in the runtime's ledger and is
  // the user's memory — GROOVE tidying its own list must never be able to
  // destroy it. The session id is REMEMBERED so the connector's /sessions poll
  // can't resurrect the row the user just cleared away.
  hideChat(session) {
    const chat = this.getChat(session);
    if (!chat) throw new Error(`no chat "${session}"`);
    this._putChat({ ...chat, hidden: true });
    this._forgetPrompts(session);
    this._save();
    this.broadcastChats();
    return { hidden: true, session, note: 'removed from the list; the conversation remains in Axom\'s memory' };
  }

  // ── Prompts — what GROOVE sent, remembered where the events are ──────────
  //
  // The runtime's `pipeline_start` carries no prompt text, so the user's own
  // words exist only in GROOVE. Keeping them in the browser meant a reload
  // replayed every turn from the daemon's ring with its bubble gone — the
  // answer with no question above it. This is OUR record of what WE sent, not
  // invented telemetry, so the daemon is the right place for it.
  recordPrompt(session, ref, text) {
    if (!session || !ref) return null;
    const all = this._cfg().prompts || {};
    const forSession = (all[session] || []).filter((p) => p.ref !== ref);
    // Bounded per session: a transcript this long is scrollback, not memory.
    const next = [...forSession, { ref, text, ts: Date.now() }].slice(-200);
    this._cfg().prompts = { ...all, [session]: next };
    this._save();
    return { ref, text };
  }

  prompts(session) {
    return (this._cfg().prompts || {})[session] || [];
  }

  // A hidden chat's prompts go with it — the list is tidied, the ledger keeps
  // the conversation itself.
  _forgetPrompts(session) {
    const all = this._cfg().prompts || {};
    if (!all[session]) return;
    const next = { ...all };
    delete next[session];
    this._cfg().prompts = next;
  }

  broadcastChats() {
    this.daemon.broadcast({ type: 'axom:chats', data: { chats: this.chats() } });
  }

  // Idempotent by design: if the runtime already answers, this is a no-op. We
  // never start a second process to satisfy a hook.
  async ensureRunning(id) {
    const { state } = await this.state(id);
    if (state === 'connected' || state === 'running') return { started: false, alreadyRunning: true };
    const rt = this.get(id);
    if (rt.control === 'none') {
      throw new Error(`"${rt.name}" runs on another machine — start it there, then hook in`);
    }
    try {
      const result = await this.startRuntime(id);
      return { ...result, started: result.started !== false };
    } catch (err) {
      // A racing hook that lost the §14 lock has NOT failed: the runtime it
      // wanted is up, someone else just got there first. Re-derive rather
      // than surfacing a lock error the user can do nothing about.
      const after = await this.state(id);
      if (after.state === 'connected' || after.state === 'running') {
        return { started: false, alreadyRunning: true, wonBy: 'another hook' };
      }
      throw err;
    }
  }

  async hook(id, { session, label } = {}) {
    const rt = this.get(id || this.activeId());
    if (!rt) throw new Error('no Axom runtime configured');
    const launch = await this.ensureRunning(rt.id);
    // §9: a hook mints its own session id — its own recency thread under the
    // one identity. Callers may pass one to rejoin an existing thread.
    const sessionId = session || `s-${Math.random().toString(36).slice(2, 10)}`;
    // Persist the hook as a chat so the list survives a refresh. Rejoining an
    // existing session must NOT un-hide a chat the user cleared away.
    const existing = this.getChat(sessionId);
    if (!existing) {
      this._putChat({
        session: sessionId,
        runtimeId: rt.id,
        label: label || `Chat ${this.chats().length + 1}`,
        createdAt: Date.now(),
      });
    } else if (label && !existing.hidden) {
      this._putChat({ ...existing, label });
    }
    this.broadcastChats();
    this.broadcastStatus();
    return {
      runtimeId: rt.id,
      name: rt.name,
      url: rt.url,
      session: sessionId,
      label: this.getChat(sessionId)?.label || null,
      launched: !!launch.started,
      ...this.generation(rt.id),
    };
  }

  // ── Verbs — dispatch on control, never guess ─────────────────────────────

  // A launch spec must mean exactly one thing in every control mode. The local
  // path gets {cwd, env} as real spawn options; SSH has only a command string,
  // so compose them INTO it here rather than dropping them — a spec whose env
  // is silently ignored launches a subtly different runtime (wrong context
  // window, wrong tree) while reporting success. Found in the wild: a spec
  // without AXOM_MAX_CTX booted a 2048-ctx instance.
  _sshCommand(rt) {
    const launch = withBlessedEnv(rt.launch);
    if (!launch?.command) return undefined;
    const parts = [];
    // `export`, not a `VAR=x prog` prefix: real specs are COMPOUND shell lines
    // ("cd /x && prog"), and a prefix binds only to the first word — the var
    // would decorate `cd` and never reach the runtime. Caught by its own test.
    for (const [k, v] of Object.entries(launch.env || {})) {
      parts.push(`export ${k}=${shellQuote(String(v))}; `);
    }
    if (launch.cwd) parts.push(`cd ${shellQuote(launch.cwd)} && `);
    return `${parts.join('')}${launch.command}`;
  }

  _sshCfg(rt) {
    let port = 8737;
    try { port = Number(new URL(rt.url).port) || 8737; } catch { /* default */ }
    return {
      ...rt.ssh,
      port,
      command: this._sshCommand(rt),
      logPath: rt.logPath,
    };
  }

  async startRuntime(id) {
    const rt = this.get(id);
    if (!rt) throw new Error(`no runtime "${id}"`);
    if (rt.control === 'none') throw new Error(`"${rt.name}" is not controlled by GROOVE — start it where it runs`);
    if (rt.control === 'ssh') {
      const result = await this.daemon.axomRemote.start(this._sshCfg(rt));
      if (rt.ssh?.autoTunnel !== false) await this.daemon.axomRemote.ensureTunnel(this._sshCfg(rt));
      this._syncConnector();
      this.daemon.axom.nudge?.(rt.id);
      this.broadcastStatus();
      return result;
    }
    // local: the spawned port becomes the runtime's URL.
    const instance = await this.daemon.axomServer.start(rt.id, {
      launch: withBlessedEnv(rt.launch) || { env: { ...BLESSED_ENV } },
      dataDir: rt.dataDir,
    });
    this.update(id, { url: `http://127.0.0.1:${instance.port}` });
    this.daemon.axom.nudge?.(rt.id);
    return { started: true, port: instance.port };
  }

  async stopRuntime(id, { force = false } = {}) {
    const rt = this.get(id);
    if (!rt) throw new Error(`no runtime "${id}"`);
    if (rt.control === 'none') throw new Error(`"${rt.name}" is not controlled by GROOVE`);
    let result;
    if (rt.control === 'ssh') {
      result = await this.daemon.axomRemote.stop({ force }, this._sshCfg(rt));
    } else {
      await this.daemon.axomServer.stop(rt.id);
      result = { stopped: true };
    }
    // The connector still believes 'connected' until its next poll fails —
    // re-probe now so the runtime card moves with the verb, not the poll.
    this.daemon.axom.recheck?.(rt.id);
    this.broadcastStatus();
    return result;
  }

  async heal(id) {
    const rt = this.get(id);
    if (!rt) throw new Error(`no runtime "${id}"`);
    if (rt.control !== 'ssh') throw new Error('only ssh runtimes have a tunnel to heal');
    const result = await this.daemon.axomRemote.ensureTunnel(this._sshCfg(rt));
    this.daemon.axom.nudge?.(rt.id);
    this.broadcastStatus();
    return result;
  }
}
