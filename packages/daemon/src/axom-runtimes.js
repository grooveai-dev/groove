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
    if (Array.isArray(cfg.runtimes)) return false;
    const runtimes = [];
    const remote = cfg.remote || null;
    const ep = (cfg.endpoints || [])[0] || null;
    if (ep && remote && ep.url.endsWith(`:${remote.port || 8737}`)) {
      runtimes.push({
        id: 'spark', name: remote.host.split('.')[0] || 'Remote', url: ep.url,
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
    if (runtimes.length && !cfg.activeRuntimeId) cfg.activeRuntimeId = runtimes[0].id;
    return true;
  }

  _save() {
    saveConfig(this.daemon.grooveDir, this.daemon.config);
  }

  start() {
    this.migrate();
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
      };
    }));
    return { runtimes, activeRuntimeId: this.activeId() };
  }

  // ── Verbs — dispatch on control, never guess ─────────────────────────────

  _sshCfg(rt) {
    let port = 8737;
    try { port = Number(new URL(rt.url).port) || 8737; } catch { /* default */ }
    return {
      ...rt.ssh,
      port,
      command: rt.launch?.command,
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
      launch: rt.launch,
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
