// GROOVE — Axom Remote Runtime Control (SSH)
// FSL-1.1-Apache-2.0 — see LICENSE
//
// Start and stop an `axom serve` on a machine you own, over SSH, from the
// GROOVE that talks to it. Deliberately MANUAL: nothing here auto-starts, and
// nothing supervises or restarts a runtime that stops. The user decides when
// the workhorse is working (Ryan, 2026-07-25: "I will turn it off and on as I
// need... I just need the control").
//
// Only ever runs commands the user configured, on a host the user configured,
// with their own SSH credentials. GROOVE holds no keys of its own.

import { execFile, spawn } from 'child_process';
import { AXOM_DEFAULT_PORT } from './axom-connector.js';

const SSH_OPTS = [
  '-o', 'ConnectTimeout=8',
  '-o', 'StrictHostKeyChecking=accept-new',
  '-o', 'BatchMode=yes',
];

function validateHost(host) {
  // Hostname or IP only — no user@, no flags, no shell metacharacters. The
  // value reaches execFile as a single argv entry, never a shell string.
  return typeof host === 'string' && /^[a-zA-Z0-9._-]{1,253}$/.test(host);
}

function validateUser(user) {
  return typeof user === 'string' && /^[a-zA-Z0-9._-]{1,32}$/.test(user);
}

export function validateRemote(remote) {
  if (!remote || typeof remote !== 'object') return 'remote config must be an object';
  if (!validateHost(remote.host)) return 'invalid host';
  if (!validateUser(remote.user)) return 'invalid user';
  if (remote.sshPort !== undefined && !(Number.isInteger(remote.sshPort) && remote.sshPort > 0 && remote.sshPort < 65536)) {
    return 'invalid sshPort';
  }
  if (remote.port !== undefined && !(Number.isInteger(remote.port) && remote.port > 0 && remote.port < 65536)) {
    return 'invalid port';
  }
  if (remote.command !== undefined && (typeof remote.command !== 'string' || remote.command.length > 500)) {
    return 'command must be a string of at most 500 chars';
  }
  return null;
}

export class AxomRemote {
  constructor(daemon, opts = {}) {
    this.daemon = daemon;
    this.exec = opts.exec || execFile; // tests inject
  }

  _config() {
    return this.daemon.config?.axom?.remote || null;
  }

  _ssh(command, timeoutMs = 30000) {
    const cfg = this._config();
    if (!cfg) return Promise.reject(new Error('no remote Axom host configured'));
    const problem = validateRemote(cfg);
    if (problem) return Promise.reject(new Error(`remote config invalid: ${problem}`));

    const args = [...SSH_OPTS, '-p', String(cfg.sshPort || 22), `${cfg.user}@${cfg.host}`, command];
    return new Promise((resolve, reject) => {
      this.exec('ssh', args, { encoding: 'utf8', timeout: timeoutMs }, (err, stdout, stderr) => {
        if (err && !stdout) return reject(new Error((stderr || err.message || '').trim().split('\n').pop()));
        resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') });
      });
    });
  }

  // Is a runtime listening on the remote port right now?
  async status() {
    const cfg = this._config();
    if (!cfg) return { configured: false, running: null };
    const port = cfg.port || AXOM_DEFAULT_PORT;
    try {
      const { stdout } = await this._ssh(
        `curl -sf --max-time 4 http://127.0.0.1:${port}/about >/dev/null 2>&1 && echo UP || echo DOWN`,
        15000,
      );
      return {
        configured: true,
        host: cfg.host,
        user: cfg.user,
        port,
        running: stdout.includes('UP'),
        error: null,
      };
    } catch (err) {
      // Unreachable host is not "not running" — we genuinely do not know.
      return { configured: true, host: cfg.host, user: cfg.user, port, running: null, error: err.message };
    }
  }

  async start() {
    const cfg = this._config();
    if (!cfg) throw new Error('no remote Axom host configured');
    const port = cfg.port || AXOM_DEFAULT_PORT;
    const already = await this.status();
    if (already.running) return { started: false, alreadyRunning: true, port };

    const command = cfg.command
      || `axom serve --port ${port} --data-dir ~/axom-serve/data --model-dir ~/axom-serve/models`;
    // Detached from this SSH session so it survives the connection closing.
    // No supervisor, no restart-on-exit: manual control means manual.
    const log = cfg.logPath || '~/axom-serve/serve.log';
    await this._ssh(`nohup ${command} >> ${log} 2>&1 < /dev/null & disown; echo STARTED`, 30000);

    // Confirm it actually came up rather than reporting optimism.
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const s = await this.status();
      if (s.running) {
        this.daemon.audit.log('axom.remote.start', { host: cfg.host, port });
        this._broadcast();
        return { started: true, port, logPath: log };
      }
    }
    throw new Error(`started the command but nothing answered on port ${port} within 60s — check ${log} on ${cfg.host}`);
  }

  async stop({ force = false } = {}) {
    const cfg = this._config();
    if (!cfg) throw new Error('no remote Axom host configured');
    const port = cfg.port || AXOM_DEFAULT_PORT;

    // Prefer the contract's own verb (§14): it flushes the ledger and
    // releases the lockfile. Fall back to a signal only if the runtime
    // predates the verb.
    try {
      const { stdout } = await this._ssh(
        `curl -s -o /dev/null -w '%{http_code}' --max-time 8 -X POST `
        + `-H 'Content-Type: application/json' -d '{"force":${force ? 'true' : 'false'}}' `
        + `http://127.0.0.1:${port}/shutdown`,
        20000,
      );
      const code = parseInt(stdout.trim().slice(-3), 10);
      if (code === 202) {
        this.daemon.audit.log('axom.remote.stop', { host: cfg.host, port, via: 'shutdown' });
        this._broadcast();
        return { stopped: true, via: 'shutdown' };
      }
      if (code === 409) return { stopped: false, turnInFlight: true };
      if (code !== 404) throw new Error(`shutdown returned HTTP ${code}`);
    } catch (err) {
      if (!/HTTP 404/.test(err.message)) throw err;
    }

    // Pre-§14 runtime: signal the process that owns the port. Still the
    // user's own machine, still an explicit action they asked for.
    await this._ssh(`PID=$(lsof -t -i:${port} 2>/dev/null | head -1); [ -n "$PID" ] && kill $PID && echo KILLED || echo NOTFOUND`, 20000);
    this.daemon.audit.log('axom.remote.stop', { host: cfg.host, port, via: 'signal' });
    this._broadcast();
    return { stopped: true, via: 'signal' };
  }

  // ── Reachability (the port-forward), distinct from runtime lifecycle ──────
  //
  // The runtime is the user's workhorse and is never touched automatically.
  // The TUNNEL is plumbing: it dies on every sleep/wake (ssh's keepalive exits
  // on resume and nothing respawns it), costs the remote machine nothing, and
  // its death looks identical to "Axom is down" from the GUI. So we heal it on
  // demand — but only ever a tunnel GROOVE opened, and only after a health
  // check proves the port is genuinely dead (an unconditional teardown kills
  // slow-but-working tunnels — learned by fullstack-3 the hard way).

  async _portAnswers(port, timeoutMs = 2500) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/about`, { signal: AbortSignal.timeout(timeoutMs) });
      return res.ok;
    } catch {
      return false;
    }
  }

  async ensureTunnel() {
    const cfg = this._config();
    if (!cfg) return { tunneled: false, reason: 'no remote configured' };
    const problem = validateRemote(cfg);
    if (problem) return { tunneled: false, reason: problem };
    const port = cfg.port || AXOM_DEFAULT_PORT;

    if (await this._portAnswers(port)) return { tunneled: true, healed: false, port };

    // Port is genuinely dead. If a tunnel process of ours is lingering, drop
    // it before opening another (a stale forward holds the local port and the
    // new ssh would fail with "address already in use").
    if (this._tunnelProc && !this._tunnelProc.killed) {
      try { this._tunnelProc.kill(); } catch { /* already gone */ }
      this._tunnelProc = null;
    }

    const args = [
      '-N', '-L', `127.0.0.1:${port}:localhost:${port}`,
      ...SSH_OPTS,
      '-o', 'ServerAliveInterval=30',
      '-o', 'ExitOnForwardFailure=yes',
      '-p', String(cfg.sshPort || 22),
      `${cfg.user}@${cfg.host}`,
    ];
    const proc = spawn('ssh', args, { stdio: 'ignore', detached: false });
    this._tunnelProc = proc;
    proc.on('exit', () => { if (this._tunnelProc === proc) this._tunnelProc = null; });

    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 500));
      if (await this._portAnswers(port, 1500)) {
        this.daemon.audit.log('axom.remote.tunnel', { host: cfg.host, port });
        return { tunneled: true, healed: true, port };
      }
      if (proc.exitCode !== null) break;
    }
    // Honest failure: the forward may be up while the runtime is down — say
    // what we know (port silent) rather than asserting a cause.
    return { tunneled: false, healed: false, port, reason: `nothing answers on 127.0.0.1:${port} after opening the forward — the runtime may be stopped` };
  }

  closeTunnel() {
    if (this._tunnelProc && !this._tunnelProc.killed) {
      try { this._tunnelProc.kill(); } catch { /* already gone */ }
    }
    this._tunnelProc = null;
  }

  _broadcast() {
    this.status().then((s) => this.daemon.broadcast({ type: 'axom:remote', data: s })).catch(() => {});
  }
}
