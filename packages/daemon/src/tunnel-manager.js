// GROOVE — Tunnel Manager (SSH remote access)
// FSL-1.1-Apache-2.0 — see LICENSE

import { execFileSync, spawn } from 'child_process';
import { existsSync, writeFileSync, readFileSync, statSync } from 'fs';
import { resolve } from 'path';
import { createConnection, isIP } from 'net';
import { lookup } from 'dns/promises';
import crypto from 'crypto';

function getLocalVersion() {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    return pkg.version || '0.0.0';
  } catch { return '0.0.0'; }
}

const REMOTE_PORT = 31415;

// Every remote `groove start` must run from the directory of the daemon's
// EXISTING world (grooveDir is derived from cwd). The remote daemon records
// that directory in ~/.groove/last-run-dir on each boot; starting anywhere
// else boots a fresh empty .groove — which reads as "all my teams are gone".
// Falls back to $HOME (matching old behavior) when no anchor exists yet.
const ANCHOR_CD = `cd "$(cat "$HOME/.groove/last-run-dir" 2>/dev/null || echo "$HOME")" 2>/dev/null || cd "$HOME"; `;
const DEFAULT_LOCAL_PORT = 31416;
const MAX_PORT_ATTEMPTS = 10;
const HEALTH_INTERVAL = 30000;
const HEALTH_TIMEOUT = 5000;
const MAX_FAIL_COUNT = 3;
// Long-timeout probe used to CONFIRM death before killing a tunnel — a busy
// remote daemon can sit on /api/health well past the 5s routine probe.
const CONFIRM_TIMEOUT = 15000;
// At most one automatic rebuild per tunnel per window; beyond that it stays
// disconnected rather than thrashing against a host that keeps dying.
const REBUILD_COOLDOWN_MS = 10 * 60 * 1000;
// Restarting a crashed REMOTE daemon is cheaper and safer than a rebuild, so
// its cooldown is shorter — but still bounded: a daemon that dies right after
// every start has a real problem more starts won't fix.
const REMOTE_START_COOLDOWN_MS = 2 * 60 * 1000;

const INJECTION_CHARS = /[;|&`$(){}[\]<>!#\n\r\\]/;

function validateField(value, name) {
  if (!value || typeof value !== 'string' || !value.trim()) {
    throw new Error(`${name} is required`);
  }
  if (INJECTION_CHARS.test(value)) {
    throw new Error(`Invalid characters in ${name}`);
  }
}

function sshCmd(cmd) {
  const nvmProbe = 'export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"; ';
  const npmGlobalProbe = '[ -d "$HOME/.npm-global/bin" ] && export PATH="$HOME/.npm-global/bin:$PATH"; ';
  return `bash -lc '${nvmProbe}${npmGlobalProbe}${cmd}'`;
}

function npmGlobalInstall(pkg, user) {
  const base = `npm i -g --prefer-online ${pkg}`;
  if (user === 'root') return base;
  return `${base} || sudo -n ${base}`;
}

function isPermissionError(output) {
  return /EACCES|permission denied|sudo.*password/i.test(output);
}

const PERMISSION_HINT = 'npm global install requires write access. Either install Node via nvm (recommended) or configure passwordless sudo for npm on the remote server.';

// A hostname can resolve to several addresses on different interfaces — a
// dual-homed LAN box (wired + Wi-Fi) advertises all of them over mDNS, and ssh
// just takes the resolver's first pick. Landing on a weak Wi-Fi address gives
// a tunnel that dies of keepalive timeout minutes later, and every reconnect
// re-rolls the dice. Probe all candidates with a TCP handshake to the ssh port
// and take the fastest responder — on a LAN that reliably picks wired over
// Wi-Fi. Falls back to the original hostname if resolution or every probe
// fails, so behavior is unchanged for the cases that already worked.
export async function resolveBestAddress(host, port = 22, probeTimeoutMs = 2500) {
  if (isIP(host)) return host; // literal IP — nothing to choose
  let addrs;
  try {
    addrs = await lookup(host, { all: true, verbatim: true });
  } catch { return host; }
  if (!Array.isArray(addrs) || addrs.length <= 1) return host;

  const handshake = (address) => new Promise((res) => {
    const started = Date.now();
    let sock;
    try { sock = createConnection({ host: address, port }); } catch { return res(null); }
    sock.setTimeout(probeTimeoutMs);
    sock.on('connect', () => { sock.destroy(); res(Date.now() - started); });
    sock.on('error', () => res(null));
    sock.on('timeout', () => { sock.destroy(); res(null); });
  });

  // Median of three handshakes per address: one lucky round-trip can make a
  // weak link look fine, but a flaky link rarely wins three in a row — a
  // single retransmit (or drop, scored as the timeout) sinks its median.
  const probe = async (address) => {
    const times = [];
    for (let i = 0; i < 3; i++) times.push(await handshake(address));
    const scored = times.map((t) => (t === null ? probeTimeoutMs : t)).sort((a, b) => a - b);
    if (times.every((t) => t === null)) return null; // never connected at all
    return { address, ms: scored[1] };
  };

  const results = (await Promise.all(addrs.map((a) => probe(a.address)))).filter(Boolean);
  if (results.length === 0) return host;
  results.sort((a, b) => a.ms - b.ms);
  return results[0].address;
}

export class TunnelManager {
  constructor(daemon) {
    this.daemon = daemon;
    this.remotesPath = resolve(daemon.grooveDir, 'remotes.json');
    // Live tunnel state, persisted separately from the configs so a daemon
    // restart can re-adopt still-running ssh processes instead of forgetting
    // them (the configs file is user data; this is runtime state).
    this.activePath = resolve(daemon.grooveDir, 'tunnels-active.json');
    this.saved = new Map();
    this.active = new Map();
    this._healthInterval = null;
    this._load();
  }

  _load() {
    try {
      if (existsSync(this.remotesPath)) {
        const data = JSON.parse(readFileSync(this.remotesPath, 'utf8'));
        if (Array.isArray(data)) {
          for (const entry of data) {
            if (entry && entry.id) this.saved.set(entry.id, entry);
          }
        }
      }
    } catch { /* ignore corrupt file */ }
  }

  _save() {
    writeFileSync(
      this.remotesPath,
      JSON.stringify(Array.from(this.saved.values()), null, 2),
      { mode: 0o600 }
    );
  }

  async init() {
    await this._readopt();
    for (const [id, config] of this.saved) {
      if (config.autoConnect && !this.active.has(id)) {
        try {
          await this.connect(id);
        } catch (err) {
          this.daemon.broadcast({ type: 'tunnel.error', data: { id, error: err.message } });
        }
      }
    }
  }

  // Re-adopt tunnels whose detached ssh processes survived a daemon restart.
  // Without this, every daemon/app restart orphaned the ssh (or shutdown killed
  // it) and the new daemon started amnesiac — remote windows died mid-session
  // and the user had to reconnect everything by hand.
  async _readopt() {
    let entries = [];
    try {
      if (existsSync(this.activePath)) entries = JSON.parse(readFileSync(this.activePath, 'utf8'));
    } catch { /* corrupt — treat as none */ }
    if (!Array.isArray(entries) || entries.length === 0) return;

    let adopted = 0;
    for (const e of entries) {
      if (!e?.id || !e.pid || !e.localPort || !this.saved.has(e.id)) continue;
      // Only re-adopt what is provably OUR ssh still doing THIS job: the pid
      // must be alive, be an ssh process forwarding this port, and the port
      // must serve HTTP.
      let alive = false;
      try { process.kill(e.pid, 0); alive = true; } catch { /* gone */ }
      if (alive) alive = this._looksLikeOurSsh(e.pid, e.localPort);
      if (alive && await this._tunnelResponds(e.localPort)) {
        this.active.set(e.id, {
          pid: e.pid,
          localPort: e.localPort,
          startedAt: e.startedAt || new Date().toISOString(),
          lastPing: Date.now(),
          latencyMs: null,
          healthy: true,
          failCount: 0,
        });
        adopted++;
        const name = this.saved.get(e.id)?.name || e.id;
        console.log(`[Groove:Tunnel] Re-adopted live tunnel to ${name} on port ${e.localPort}`);
        this.daemon.broadcast({ type: 'tunnel.connected', data: { id: e.id, name, localPort: e.localPort, host: this.saved.get(e.id)?.host, url: `http://localhost:${e.localPort}?instance=${encodeURIComponent(name)}` } });
      } else if (alive) {
        // ssh survives but doesn't serve — a corpse from before the restart.
        try { process.kill(e.pid, 'SIGTERM'); } catch { /* gone */ }
      }
    }
    if (adopted > 0 && !this._healthInterval) {
      this._healthInterval = setInterval(() => this._healthCheckAll(), HEALTH_INTERVAL);
    }
    this._saveActive();
  }

  // Identity check for re-adoption: is this pid an ssh forwarding this port?
  // Guards against pid recycling handing us an unrelated process.
  _looksLikeOurSsh(pid, localPort) {
    try {
      const cmd = execFileSync('ps', ['-p', String(pid), '-o', 'command='], {
        encoding: 'utf8', timeout: 3000,
      }).trim();
      return cmd.includes('ssh') && cmd.includes(String(localPort));
    } catch { return false; }
  }

  _saveActive() {
    try {
      const entries = [...this.active.entries()].map(([id, c]) => ({
        id, pid: c.pid, localPort: c.localPort, startedAt: c.startedAt,
      }));
      writeFileSync(this.activePath, JSON.stringify(entries, null, 2), { mode: 0o600 });
    } catch { /* best effort */ }
  }

  getSaved() {
    return Array.from(this.saved.values()).map(s => ({
      ...this._sanitize(s),
      active: this.active.has(s.id),
      ...(this.active.get(s.id) || {}),
    }));
  }

  save({ name, host, user, port, sshKeyPath, autoStart, autoConnect, projectDir }) {
    validateField(name, 'name');
    validateField(host, 'host');
    validateField(user, 'user');

    const p = port != null ? Number(port) : 22;
    if (!Number.isInteger(p) || p < 1 || p > 65535) {
      throw new Error('port must be a number between 1 and 65535');
    }

    if (sshKeyPath) {
      if (!existsSync(sshKeyPath)) {
        throw new Error(`SSH key not found: ${sshKeyPath}`);
      }
      if (!statSync(sshKeyPath).isFile()) {
        throw new Error('sshKeyPath must be a file, not a directory');
      }
    }

    if (projectDir) {
      if (typeof projectDir !== 'string' || !projectDir.startsWith('/')) {
        throw new Error('projectDir must be an absolute path');
      }
      if (/[;|&`$(){}[\]<>!#\n\r\\]/.test(projectDir)) {
        throw new Error('Invalid characters in projectDir');
      }
    }

    const id = crypto.randomUUID().slice(0, 8);
    const entry = {
      id,
      name: name.trim(),
      host: host.trim(),
      user: user.trim(),
      port: p,
      sshKeyPath: sshKeyPath || null,
      autoStart: !!autoStart,
      autoConnect: !!autoConnect,
      projectDir: projectDir ? projectDir.trim() : null,
      createdAt: new Date().toISOString(),
    };

    this.saved.set(id, entry);
    this._save();
    this.daemon.audit.log('tunnel.save', { id, name: entry.name, host: entry.host });
    return entry;
  }

  update(id, config) {
    const existing = this.saved.get(id);
    if (!existing) throw new Error(`Remote ${id} not found`);

    const merged = { ...existing };

    if (config.name !== undefined) {
      validateField(config.name, 'name');
      merged.name = config.name.trim();
    }
    if (config.host !== undefined) {
      validateField(config.host, 'host');
      merged.host = config.host.trim();
    }
    if (config.user !== undefined) {
      validateField(config.user, 'user');
      merged.user = config.user.trim();
    }
    if (config.port !== undefined) {
      const p = Number(config.port);
      if (!Number.isInteger(p) || p < 1 || p > 65535) {
        throw new Error('port must be a number between 1 and 65535');
      }
      merged.port = p;
    }
    if (config.sshKeyPath !== undefined) {
      if (config.sshKeyPath) {
        if (!existsSync(config.sshKeyPath)) {
          throw new Error(`SSH key not found: ${config.sshKeyPath}`);
        }
        if (!statSync(config.sshKeyPath).isFile()) {
          throw new Error('sshKeyPath must be a file, not a directory');
        }
        merged.sshKeyPath = config.sshKeyPath;
      } else {
        merged.sshKeyPath = null;
      }
    }
    if (config.autoStart !== undefined) merged.autoStart = !!config.autoStart;
    if (config.autoConnect !== undefined) merged.autoConnect = !!config.autoConnect;
    if (config.projectDir !== undefined) {
      if (config.projectDir) {
        if (typeof config.projectDir !== 'string' || !config.projectDir.startsWith('/')) {
          throw new Error('projectDir must be an absolute path');
        }
        if (/[;|&`$(){}[\]<>!#\n\r\\]/.test(config.projectDir)) {
          throw new Error('Invalid characters in projectDir');
        }
        merged.projectDir = config.projectDir.trim();
      } else {
        merged.projectDir = null;
      }
    }

    this.saved.set(id, merged);
    this._save();
    this.daemon.audit.log('tunnel.update', { id, keys: Object.keys(config) });
    return merged;
  }

  async delete(id) {
    if (!this.saved.has(id)) throw new Error(`Remote ${id} not found`);
    if (this.active.has(id)) await this.disconnect(id);
    const name = this.saved.get(id).name;
    this.saved.delete(id);
    this._save();
    this.daemon.audit.log('tunnel.delete', { id, name });
  }

  async test(id) {
    const config = this.saved.get(id);
    if (!config) throw new Error(`Remote ${id} not found`);

    const target = `${config.user}@${await resolveBestAddress(config.host, config.port || 22)}`;
    const keyArgs = config.sshKeyPath ? ['-i', config.sshKeyPath] : [];

    try {
      const probeCmd = [
        `NV=$(node --version 2>/dev/null || echo "");`,
        `echo "__NODE__${`$\{NV\}`}__NODE_END__";`,
        `S=$(curl -sf http://localhost:${REMOTE_PORT}/api/status 2>/dev/null);`,
        `if [ -n "$S" ]; then echo "__GROOVE_RUNNING__$S__GROOVE_END__";`,
        `else which groove >/dev/null 2>&1 && echo __GROOVE_VER__$(groove --version 2>/dev/null || echo unknown)__GROOVE_STOPPED__ || echo __GROOVE_NOT_INSTALLED__; fi`,
      ].join(' ');

      const result = execFileSync('ssh', [
        ...keyArgs,
        '-p', String(config.port || 22),
        '-o', 'ConnectTimeout=5',
        '-o', 'StrictHostKeyChecking=accept-new',
        '-o', 'BatchMode=yes',
        target,
        sshCmd(probeCmd),
      ], {
        encoding: 'utf8',
        timeout: 15000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const nodeMatch = result.match(/__NODE__(.+?)__NODE_END__/);
      const nodeVersionRaw = nodeMatch ? nodeMatch[1].trim() : '';
      const nodeInstalled = nodeVersionRaw.startsWith('v');
      const nodeVersion = nodeInstalled ? nodeVersionRaw : null;

      if (result.includes('__GROOVE_NOT_INSTALLED__')) {
        return { reachable: true, daemonRunning: false, grooveInstalled: false, nodeInstalled, nodeVersion };
      }
      if (result.includes('__GROOVE_STOPPED__')) {
        const verMatch = result.match(/__GROOVE_VER__(.+?)__GROOVE_STOPPED__/);
        const remoteVersion = verMatch ? verMatch[1].trim() : null;
        return { reachable: true, daemonRunning: false, grooveInstalled: true, remoteVersion, nodeInstalled, nodeVersion };
      }
      const runMatch = result.match(/__GROOVE_RUNNING__(.+?)__GROOVE_END__/);
      let remoteVersion = null;
      if (runMatch) {
        try { remoteVersion = JSON.parse(runMatch[1]).version || null; } catch { /* ignore */ }
      }
      return { reachable: true, daemonRunning: true, grooveInstalled: true, remoteVersion, nodeInstalled, nodeVersion };
    } catch (err) {
      const stderr = err.stderr?.toString() || '';
      if (stderr.includes('Permission denied')) {
        return { reachable: false, error: 'SSH authentication failed' };
      }
      if (stderr.includes('Connection refused') || stderr.includes('Connection timed out') || stderr.includes('No route to host')) {
        return { reachable: false, error: 'Host unreachable' };
      }
      return { reachable: false, error: err.message };
    }
  }

  async connect(id, opts = {}) {
    const config = this.saved.get(id);
    if (!config) throw new Error(`Remote ${id} not found`);

    // An existing entry is only reusable if the tunnel actually still carries
    // traffic. After a laptop sleep the SSH client can survive with its forward
    // dead: the local port still ACCEPTS connections but never forwards them, so
    // handing this back returns a port that hangs forever instead of failing —
    // which is what left the remote GUI on a black screen. Probe before reusing,
    // and tear it down if it's a corpse.
    if (this.active.has(id)) {
      const existing = this.active.get(id);
      if (await this._tunnelResponds(existing.localPort)) {
        return { localPort: existing.localPort, pid: existing.pid, name: config.name };
      }
      console.log(`[Groove:Tunnel] ${config.name}: existing tunnel is not responding — rebuilding`);
      // Reuse the dead tunnel's port so any GUI window pointed at it heals.
      opts = { ...opts, preferredPort: opts.preferredPort || existing.localPort };
      await this.disconnect(id);
    }

    this.daemon.broadcast({ type: 'tunnel.status', data: { id, step: 'testing' } });

    // For known servers, skip the full test — tunnel first, check version after
    let testResult;
    if (opts.skipTest && opts.testResult) {
      testResult = opts.testResult;
    } else if (config.lastConnected && opts.skipTest !== false) {
      testResult = { reachable: true, daemonRunning: true, grooveInstalled: true, remoteVersion: null };
    } else {
      testResult = await this.test(id);
    }
    if (!testResult.reachable) {
      throw new Error(testResult.error || 'Host unreachable');
    }

    // First-time only: install groove if missing, start daemon if not running
    let preConnectHandled = false;
    if (!testResult.daemonRunning && !testResult.grooveInstalled) {
      this.daemon.broadcast({ type: 'tunnel.status', data: { id, step: 'installing' } });
      await this.remoteInstall(id);
      preConnectHandled = true;
    } else if (!testResult.daemonRunning && testResult.grooveInstalled) {
      this.daemon.broadcast({ type: 'tunnel.status', data: { id, step: 'starting' } });
      await this.autoStart(id);
      preConnectHandled = true;
    }

    // Establish SSH tunnel
    this.daemon.broadcast({ type: 'tunnel.status', data: { id, step: 'connecting' } });

    // A rebuild wants its old port back: the remote GUI window is pointed at it
    // and will self-heal over WebSocket retry only if the port stays the same.
    let localPort;
    if (opts.preferredPort && !(await this._isPortInUse(opts.preferredPort))) {
      localPort = opts.preferredPort;
    } else {
      localPort = await this._findAvailablePort();
    }
    // Multi-homed hosts (mDNS names especially): pick the address that actually
    // answers fastest instead of letting the resolver gamble on an interface.
    const connectHost = await resolveBestAddress(config.host, config.port || 22);
    if (connectHost !== config.host) {
      console.log(`[Groove:Tunnel] ${config.name}: ${config.host} → ${connectHost} (fastest responding address)`);
    }
    const target = `${config.user}@${connectHost}`;
    const keyArgs = config.sshKeyPath ? ['-i', config.sshKeyPath] : [];
    // Keep the host key pinned to the NAME when we connect by address, so every
    // address of the same box shares one known_hosts entry.
    const aliasArgs = connectHost !== config.host ? ['-o', `HostKeyAlias=${config.host}`] : [];

    const sshArgs = [
      '-N',
      '-L', `127.0.0.1:${localPort}:localhost:${REMOTE_PORT}`,
      '-p', String(config.port || 22),
      '-o', 'ServerAliveInterval=15',
      '-o', 'ServerAliveCountMax=4',
      '-o', 'ExitOnForwardFailure=yes',
      '-o', 'StrictHostKeyChecking=accept-new',
      '-o', 'GSSAPIAuthentication=no',
      ...aliasArgs,
      ...keyArgs,
      target,
    ];

    const tunnel = spawn('ssh', sshArgs, {
      stdio: ['ignore', 'ignore', 'pipe'],
      detached: true,
    });

    let stderrBuf = '';
    tunnel.stderr.on('data', (chunk) => { stderrBuf += chunk.toString(); });

    let tunnelUp = false;
    this.daemon.broadcast({ type: 'tunnel.status', data: { id, step: 'forwarding' } });
    for (let elapsed = 0; elapsed < 20000; elapsed += 500) {
      await new Promise((r) => setTimeout(r, 500));
      if (tunnel.exitCode !== null) {
        throw new Error(`Tunnel failed to start: ${stderrBuf.trim() || 'unknown error'}`);
      }
      tunnelUp = await this._isPortInUse(localPort);
      if (tunnelUp) break;
    }

    if (!tunnelUp) {
      // Remote daemon likely not running — start it and retry the port check
      this.daemon.broadcast({ type: 'tunnel.status', data: { id, step: 'starting' } });
      try { await this.autoStart(id); } catch { /* best effort */ }
      for (let elapsed = 0; elapsed < 15000; elapsed += 500) {
        await new Promise((r) => setTimeout(r, 500));
        if (tunnel.exitCode !== null) break;
        tunnelUp = await this._isPortInUse(localPort);
        if (tunnelUp) break;
      }
      if (!tunnelUp) {
        try { process.kill(tunnel.pid); } catch { /* ignore */ }
        throw new Error(`SSH tunnel started but remote daemon not reachable${stderrBuf.trim() ? ': ' + stderrBuf.trim() : ''}`);
      }
    }

    tunnel.unref();

    this.active.set(id, {
      pid: tunnel.pid,
      localPort,
      startedAt: new Date().toISOString(),
      lastPing: Date.now(),
      latencyMs: null,
      healthy: true,
      failCount: 0,
    });
    this._saveActive();

    // Verify daemon is reachable through tunnel, start if needed
    let remoteAlive = false;
    try {
      const probe = await fetch(`http://localhost:${localPort}/api/health`, {
        signal: AbortSignal.timeout(5000),
      });
      remoteAlive = probe.ok;
    } catch { /* not reachable */ }

    if (!remoteAlive) {
      this.daemon.broadcast({ type: 'tunnel.status', data: { id, step: 'starting' } });
      await this.autoStart(id);
      for (let i = 0; i < 5; i++) {
        await new Promise(r => setTimeout(r, 1000));
        try {
          const retry = await fetch(`http://localhost:${localPort}/api/health`, {
            signal: AbortSignal.timeout(3000),
          });
          if (retry.ok) { remoteAlive = true; break; }
        } catch { /* retry */ }
      }
    }

    // Auto-upgrade: check version through tunnel, upgrade if behind
    if (remoteAlive && !preConnectHandled) {
      await this._checkAndUpgradeRunning(id, config, localPort);
    }

    const remoteVer = testResult?.remoteVersion || null;
    const localVer = getLocalVersion();
    if (remoteVer) {
      this.daemon.broadcast({ type: 'tunnel.version-info', data: { id, localVersion: localVer, remoteVersion: remoteVer, match: remoteVer === localVer } });
    }

    config.lastConnected = new Date().toISOString();
    this.saved.set(id, config);
    this._save();

    const url = `http://localhost:${localPort}?instance=${encodeURIComponent(config.name)}`;

    this.daemon.audit.log('tunnel.connect', { id, name: config.name, host: config.host, localPort });
    this.daemon.broadcast({ type: 'tunnel.connected', data: { id, name: config.name, localPort, host: config.host, url } });

    if (!this._healthInterval) {
      this._healthInterval = setInterval(() => this._healthCheckAll(), HEALTH_INTERVAL);
    }

    return { localPort, pid: tunnel.pid, name: config.name, url };
  }

  // Does the tunnel actually serve a request, as opposed to merely holding an
  // open listening socket? A wedged forward passes a TCP connect test but never
  // answers, so only an HTTP round-trip proves it.
  async _tunnelResponds(localPort, timeoutMs = this.healthTimeout ?? HEALTH_TIMEOUT) {
    try {
      const res = await fetch(`http://localhost:${localPort}/api/health`, {
        signal: AbortSignal.timeout(timeoutMs),
      });
      return res.ok;
    } catch { return false; }
  }

  async disconnect(id) {
    const conn = this.active.get(id);
    if (!conn) return;

    const { pid, localPort } = conn;
    try {
      const cmd = execFileSync('ps', ['-p', String(pid), '-o', 'command='], {
        encoding: 'utf8',
        timeout: 3000,
      }).trim();
      if (cmd.includes('ssh')) {
        process.kill(pid, 'SIGTERM');
        // An SSH client stuck on a dead TCP session can sit on SIGTERM long
        // enough that the next connect() finds the port still bound. Give it a
        // moment, then stop asking politely — otherwise the leftover listener
        // keeps answering (and hanging) on the port we're about to reuse.
        const gone = await this._waitForExit(pid, 3000);
        if (!gone) {
          try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
          await this._waitForExit(pid, 2000);
        }
      }
    } catch { /* process already dead */ }

    if (localPort) await this._waitForPortFree(localPort, 3000);

    this.active.delete(id);
    this._saveActive();

    const config = this.saved.get(id);
    this.daemon.audit.log('tunnel.disconnect', { id, name: config?.name });
    this.daemon.broadcast({ type: 'tunnel.disconnected', data: { id, name: config?.name } });

    if (this.active.size === 0 && this._healthInterval) {
      clearInterval(this._healthInterval);
      this._healthInterval = null;
    }
  }

  async _checkAndUpgradeRunning(id, config, localPort) {
    try {
      this.daemon.broadcast({ type: 'tunnel.status', data: { id, step: 'checking' } });

      // Get remote daemon version through the already-open tunnel
      const resp = await fetch(`http://localhost:${localPort}/api/status`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!resp.ok) return;
      const status = await resp.json();
      const remoteVer = status.version;
      if (!remoteVer) return;

      // Check latest version on npm locally (same registry everywhere, no extra SSH)
      let npmVer;
      try {
        npmVer = execFileSync('npm', ['view', 'groove-dev', 'version'], {
          encoding: 'utf8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();
      } catch { return; }

      if (!npmVer || npmVer === remoteVer) {
        const localVer = getLocalVersion();
        this.daemon.broadcast({ type: 'tunnel.version-info', data: { id, localVersion: localVer, remoteVersion: remoteVer, match: remoteVer === localVer } });
        return;
      }

      // Remote is behind npm — upgrade
      this.daemon.broadcast({ type: 'tunnel.status', data: { id, step: 'upgrading', from: remoteVer, to: npmVer } });

      const target = `${config.user}@${config.host}`;
      const keyArgs = config.sshKeyPath ? ['-i', config.sshKeyPath] : [];
      const sshBase = [...keyArgs, '-p', String(config.port || 22), '-o', 'ConnectTimeout=10', '-o', 'BatchMode=yes', target];

      const installCmd = npmGlobalInstall(`groove-dev@${npmVer}`, config.user);
      const cleanupCmd = 'rm -rf $(npm root -g)/.groove-dev-* $(npm root -g)/groove-dev 2>/dev/null || true';

      try {
        execFileSync('ssh', [...sshBase, sshCmd(installCmd)], {
          encoding: 'utf8', timeout: 120000, stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (err) {
        const errOutput = err.stdout?.toString() || err.stderr?.toString() || err.message;
        if (errOutput.includes('ENOTEMPTY')) {
          execFileSync('ssh', [...sshBase, sshCmd(cleanupCmd)], { encoding: 'utf8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'] });
          execFileSync('ssh', [...sshBase, sshCmd(installCmd)], { encoding: 'utf8', timeout: 120000, stdio: ['pipe', 'pipe', 'pipe'] });
        } else {
          throw err;
        }
      }

      // Restart remote daemon — fire and forget the SSH, verify through the tunnel
      const cdPrefix = config.projectDir ? `cd "${config.projectDir}" && ` : ANCHOR_CD;
      try {
        execFileSync('ssh', [...sshBase, sshCmd(`kill $(lsof -t -i:${REMOTE_PORT}) 2>/dev/null || true; sleep 1; ${cdPrefix}GROOVE_BIN=$(which groove) && nohup "$GROOVE_BIN" start > /tmp/groove-daemon.log 2>&1 < /dev/null & disown`)], {
          encoding: 'utf8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch { /* SSH may close before nohup finishes — that's fine */ }

      // Wait for daemon to come back up through the existing tunnel
      this.daemon.broadcast({ type: 'tunnel.status', data: { id, step: 'starting' } });
      let daemonVer = null;
      for (let i = 0; i < 8; i++) {
        await new Promise(r => setTimeout(r, 2000));
        try {
          const check = await fetch(`http://localhost:${localPort}/api/status`, { signal: AbortSignal.timeout(3000) });
          if (check.ok) {
            daemonVer = (await check.json()).version || null;
            break;
          }
        } catch { /* not up yet */ }
      }

      if (config.projectDir && daemonVer) {
        try {
          await fetch(`http://localhost:${localPort}/api/project-dir`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: config.projectDir }),
            signal: AbortSignal.timeout(3000),
          });
        } catch { /* best effort */ }
      }

      const localVer = getLocalVersion();
      this.daemon.broadcast({ type: 'tunnel.version-info', data: { id, localVersion: localVer, remoteVersion: daemonVer || npmVer, match: (daemonVer || npmVer) === localVer } });
      this.daemon.audit.log('tunnel.upgrade', { id, from: remoteVer, to: daemonVer || npmVer });
    } catch (err) {
      // Upgrade failed but tunnel may still work — check before reporting failure
      try {
        const verify = await fetch(`http://localhost:${localPort}/api/status`, { signal: AbortSignal.timeout(5000) });
        if (verify.ok) {
          const verifyData = await verify.json();
          this.daemon.broadcast({ type: 'tunnel.version-info', data: { id, localVersion: getLocalVersion(), remoteVersion: verifyData.version, match: false } });
          return;
        }
      } catch { /* tunnel down */ }
      this.daemon.broadcast({ type: 'tunnel.upgrade-failed', data: { id, error: err.message } });
    }
  }

  async _remoteUpgrade(id, config) {
    const target = `${config.user}@${config.host}`;
    const keyArgs = config.sshKeyPath ? ['-i', config.sshKeyPath] : [];
    const sshBase = [...keyArgs, '-p', String(config.port || 22), '-o', 'ConnectTimeout=10', '-o', 'BatchMode=yes', target];
    const localVer = getLocalVersion();
    const pkg = localVer !== '0.0.0' ? `groove-dev@${localVer}` : 'groove-dev';
    const installCmd = npmGlobalInstall(pkg, config.user);

    let usedFallback = false;
    try {
      execFileSync('ssh', [...sshBase, sshCmd(installCmd)], {
        encoding: 'utf8',
        timeout: 120000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      const errOutput = err.stdout?.toString() || err.stderr?.toString() || err.message;
      if (errOutput.includes('ENOTEMPTY')) {
        try {
          execFileSync('ssh', [...sshBase, sshCmd('rm -rf $(npm root -g)/.groove-dev-* $(npm root -g)/groove-dev 2>/dev/null || true')], { encoding: 'utf8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'] });
          execFileSync('ssh', [...sshBase, sshCmd(installCmd)], { encoding: 'utf8', timeout: 120000, stdio: ['pipe', 'pipe', 'pipe'] });
        } catch (retryErr) {
          const retryOutput = retryErr.stdout?.toString() || retryErr.stderr?.toString() || retryErr.message;
          throw new Error(`Remote upgrade failed after cleanup: ${retryOutput.slice(-400)}`);
        }
      } else {
        if (localVer !== '0.0.0' && pkg.includes('@')) {
          const fallbackCmd = npmGlobalInstall('groove-dev', config.user);
          try {
            execFileSync('ssh', [...sshBase, sshCmd(fallbackCmd)], {
              encoding: 'utf8',
              timeout: 120000,
              stdio: ['pipe', 'pipe', 'pipe'],
            });
            usedFallback = true;
          } catch { /* fall through to original error */ }
        }
        if (!usedFallback) {
          if (isPermissionError(errOutput)) throw new Error(PERMISSION_HINT);
          throw new Error(`Remote upgrade failed: ${errOutput.slice(-400)}`);
        }
      }
    }

    const verOutput = execFileSync('ssh', [...sshBase, sshCmd('groove --version')], {
      encoding: 'utf8',
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    const installedVer = verOutput.replace(/[^0-9.]/g, '') || verOutput.trim();
    if (installedVer !== localVer) {
      this.daemon.broadcast({ type: 'tunnel.version-mismatch', data: { id, localVersion: localVer, remoteVersion: installedVer, message: usedFallback ? 'Pinned version not available on npm, installed latest' : 'Version mismatch after upgrade' } });
    }
  }

  async autoStart(id) {
    const config = this.saved.get(id);
    if (!config) throw new Error(`Remote ${id} not found`);

    const target = `${config.user}@${await resolveBestAddress(config.host, config.port || 22)}`;
    const keyArgs = config.sshKeyPath ? ['-i', config.sshKeyPath] : [];

    // Build the remote bash command:
    //   1. cd into the saved projectDir (if set) so the daemon inherits that cwd
    //   2. launch `groove start` detached via nohup
    //   3. poll /api/health until it responds
    //   4. explicitly POST /api/project-dir so the daemon's projectDir matches
    //      config.projectDir even if the backgrounded cwd didn't stick (this
    //      also updates the editor root used for /api/browse, /api/files/*)
    const cdPrefix = config.projectDir ? `cd "${config.projectDir}" && ` : ANCHOR_CD;
    const setProjectDir = config.projectDir
      ? `curl -sf -X POST -H 'Content-Type: application/json' --data '{"path":"${config.projectDir}"}' http://localhost:${REMOTE_PORT}/api/project-dir > /dev/null 2>&1 || true; `
      : '';
    const remoteCmd =
      `${cdPrefix}GROOVE_BIN=$(which groove) && nohup "$GROOVE_BIN" start > /tmp/groove-daemon.log 2>&1 < /dev/null & disown; ` +
      `sleep 5; ` +
      `curl -sf http://localhost:${REMOTE_PORT}/api/health > /dev/null ` +
      `&& (${setProjectDir}echo __DAEMON_OK__) ` +
      `|| (echo __DAEMON_FAIL__; tail -20 /tmp/groove-daemon.log 2>/dev/null)`;

    try {
      const result = execFileSync('ssh', [
        ...keyArgs,
        '-p', String(config.port || 22),
        '-o', 'ConnectTimeout=10',
        '-o', 'BatchMode=yes',
        target,
        sshCmd(remoteCmd),
      ], {
        encoding: 'utf8',
        timeout: 45000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      if (result.includes('__DAEMON_FAIL__')) {
        const logLines = result.split('__DAEMON_FAIL__')[1]?.trim() || '';
        const detail = logLines ? `: ${logLines.slice(-300)}` : '';
        throw new Error(`Remote daemon failed to start${detail}`);
      }
    } catch (err) {
      if (err.message.includes('Remote daemon failed')) throw err;
      const output = err.stdout?.toString() || err.stderr?.toString() || '';
      if (output.includes('__DAEMON_OK__')) return;
      throw new Error(`Failed to start remote daemon: ${(output || err.message).slice(-300)}`);
    }
  }

  async remoteInstall(id) {
    const config = this.saved.get(id);
    if (!config) throw new Error(`Remote ${id} not found`);

    const target = `${config.user}@${config.host}`;
    const keyArgs = config.sshKeyPath ? ['-i', config.sshKeyPath] : [];
    const sshBase = [
      ...keyArgs,
      '-p', String(config.port || 22),
      '-o', 'ConnectTimeout=10',
      '-o', 'BatchMode=yes',
      target,
    ];

    // Non-interactive SSH doesn't source shell profiles, so npm/node may not be on PATH.
    // Use a login shell (-l) to get the user's full environment.
    const remoteCmd = (cmd) => sshCmd(cmd);

    // Step 1: Check if node/npm are available
    try {
      const check = execFileSync('ssh', [
        ...sshBase,
        remoteCmd('which node && which npm || echo __NO_NODE__'),
      ], {
        encoding: 'utf8',
        timeout: 20000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      if (check.includes('__NO_NODE__')) {
        throw new Error('Node.js is not installed on the remote server. Install Node.js 20+ first, then retry.');
      }
    } catch (err) {
      if (err.message.includes('Node.js is not installed')) throw err;
      throw new Error(`Failed to check remote environment: ${err.message}`);
    }

    // Step 2: Install groove-dev globally (try user-space first, sudo fallback)
    const localVer = getLocalVersion();
    const pkg = localVer !== '0.0.0' ? `groove-dev@${localVer}` : 'groove-dev';
    const installCmd = npmGlobalInstall(pkg, config.user);

    try {
      execFileSync('ssh', [
        ...sshBase,
        remoteCmd(installCmd),
      ], {
        encoding: 'utf8',
        timeout: 120000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      const errOutput = err.stdout?.toString() || err.stderr?.toString() || err.message;
      if (errOutput.includes('ENOTEMPTY')) {
        try {
          execFileSync('ssh', [...sshBase, remoteCmd('rm -rf $(npm root -g)/.groove-dev-* $(npm root -g)/groove-dev 2>/dev/null || true')], { encoding: 'utf8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'] });
          execFileSync('ssh', [...sshBase, remoteCmd(installCmd)], { encoding: 'utf8', timeout: 120000, stdio: ['pipe', 'pipe', 'pipe'] });
        } catch (retryErr) {
          const retryOutput = retryErr.stdout?.toString() || retryErr.stderr?.toString() || retryErr.message;
          throw new Error(`npm install failed after cleanup: ${retryOutput.slice(-400)}`);
        }
      } else if (localVer !== '0.0.0' && pkg.includes('@')) {
        const fallbackCmd = npmGlobalInstall('groove-dev', config.user);
        try {
          execFileSync('ssh', [...sshBase, remoteCmd(fallbackCmd)], {
            encoding: 'utf8',
            timeout: 120000,
            stdio: ['pipe', 'pipe', 'pipe'],
          });
        } catch (err2) {
          const output = err2.stdout?.toString() || err2.stderr?.toString() || err2.message;
          if (isPermissionError(output)) throw new Error(PERMISSION_HINT);
          throw new Error(`npm install failed: ${output.slice(-400)}`);
        }
      } else {
        if (isPermissionError(errOutput)) throw new Error(PERMISSION_HINT);
        throw new Error(`npm install failed: ${errOutput.slice(-400)}`);
      }
    }

    // Step 3: Start the daemon in background
    try {
      const result = execFileSync('ssh', [
        ...sshBase,
        remoteCmd(`${ANCHOR_CD}GROOVE_BIN=$(which groove) && nohup "$GROOVE_BIN" start > /tmp/groove-daemon.log 2>&1 < /dev/null & disown; sleep 5; curl -sf http://localhost:${REMOTE_PORT}/api/health > /dev/null && echo __DAEMON_OK__ || (echo __DAEMON_FAIL__; tail -20 /tmp/groove-daemon.log 2>/dev/null)`),
      ], {
        encoding: 'utf8',
        timeout: 45000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      if (result.includes('__DAEMON_FAIL__')) {
        const logLines = result.split('__DAEMON_FAIL__')[1]?.trim() || '';
        const detail = logLines ? `: ${logLines.slice(-300)}` : '';
        throw new Error(`Groove installed but daemon failed to start${detail}`);
      }
    } catch (err) {
      if (err.message.includes('Groove installed')) throw err;
      const output = err.stdout?.toString() || err.stderr?.toString() || err.message;
      throw new Error(`Groove installed but failed to start: ${output.slice(-300)}`);
    }

    const verify = await this.test(id);
    return { installed: verify.grooveInstalled, daemonRunning: verify.daemonRunning };
  }

  async forceUpgrade(id) {
    const config = this.saved.get(id);
    if (!config) throw new Error(`Remote ${id} not found`);
    const conn = this.active.get(id);
    if (!conn) throw new Error(`Tunnel ${id} is not connected`);

    const localVer = getLocalVersion();
    if (localVer === '0.0.0') throw new Error('Cannot determine local version');

    const target = `${config.user}@${config.host}`;
    const keyArgs = config.sshKeyPath ? ['-i', config.sshKeyPath] : [];
    const sshBase = [...keyArgs, '-p', String(config.port || 22), '-o', 'ConnectTimeout=10', '-o', 'BatchMode=yes', target];
    const pinnedPkg = `groove-dev@${localVer}`;
    const installCmd = npmGlobalInstall(pinnedPkg, config.user);

    try {
      execFileSync('ssh', [...sshBase, sshCmd(installCmd)], {
        encoding: 'utf8',
        timeout: 120000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      const errOutput = err.stdout?.toString() || err.stderr?.toString() || err.message;
      if (errOutput.includes('ENOTEMPTY')) {
        try {
          execFileSync('ssh', [...sshBase, sshCmd('rm -rf $(npm root -g)/.groove-dev-* $(npm root -g)/groove-dev 2>/dev/null || true')], { encoding: 'utf8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'] });
          execFileSync('ssh', [...sshBase, sshCmd(installCmd)], { encoding: 'utf8', timeout: 120000, stdio: ['pipe', 'pipe', 'pipe'] });
        } catch (retryErr) {
          const retryOutput = retryErr.stdout?.toString() || retryErr.stderr?.toString() || retryErr.message;
          throw new Error(`npm install failed after cleanup: ${retryOutput.slice(-400)}`);
        }
      } else {
        const fallbackCmd = npmGlobalInstall('groove-dev', config.user);
        execFileSync('ssh', [...sshBase, sshCmd(fallbackCmd)], {
          encoding: 'utf8',
          timeout: 120000,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      }
    }

    const verOutput = execFileSync('ssh', [...sshBase, sshCmd('groove --version')], {
      encoding: 'utf8',
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    const installedVer = verOutput.replace(/[^0-9.]/g, '') || verOutput.trim();

    const restartCmd = `kill $(lsof -t -i:${REMOTE_PORT}) 2>/dev/null || true; sleep 2; ${ANCHOR_CD}GROOVE_BIN=$(which groove) && nohup "$GROOVE_BIN" start > /tmp/groove-daemon.log 2>&1 < /dev/null & disown; sleep 4; curl -sf http://localhost:${REMOTE_PORT}/api/status`;
    const restartResult = execFileSync('ssh', [...sshBase, sshCmd(restartCmd)], {
      encoding: 'utf8',
      timeout: 60000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let daemonVer = null;
    try { daemonVer = JSON.parse(restartResult.trim()).version || null; } catch { /* parse failed */ }

    for (let i = 0; i < 3; i++) {
      try {
        const check = await fetch(`http://localhost:${conn.localPort}/api/status`, {
          signal: AbortSignal.timeout(3000),
        });
        if (check.ok) {
          const checkData = await check.json();
          daemonVer = checkData.version || daemonVer;
          break;
        }
      } catch { /* retry */ }
      await new Promise(r => setTimeout(r, 2000));
    }

    if (!daemonVer) throw new Error('Daemon did not respond after restart');

    this.daemon.audit.log('tunnel.force-upgrade', { id, installed: installedVer, daemon: daemonVer });
    return { installedVersion: installedVer, daemonVersion: daemonVer, localVersion: localVer, match: daemonVer === localVer };
  }

  _sanitize(entry) {
    if (!entry) return entry;
    const { sshKeyPath, ...safe } = entry;
    safe.sshKeyDisplay = sshKeyPath ? sshKeyPath.split('/').pop() : null;
    return safe;
  }

  getStatus(id) {
    const saved = this.saved.get(id);
    if (!saved) return null;
    const active = this.active.get(id);
    return { ...this._sanitize(saved), active: !!active, ...(active || {}) };
  }

  getActive() {
    return Array.from(this.active.entries()).map(([id, conn]) => ({
      ...conn,
      ...this._sanitize(this.saved.get(id) || {}),
      id,
    }));
  }

  async _healthCheckAll() {
    // Reaping now awaits process death, which can outlast the interval — don't
    // let a second pass start on top of one already tearing a tunnel down.
    if (this._healthRunning) return;
    this._healthRunning = true;
    try { await this._healthCheckPass(); } finally { this._healthRunning = false; }
  }

  async _healthCheckPass() {
    // Timers don't fire while the machine is asleep, so an interval that should
    // have run every HEALTH_INTERVAL arriving far later means we PROBABLY just
    // woke up — but not certainly: this daemon also blocks its event loop for
    // long stretches (execFileSync ssh calls in test/upgrade paths), which
    // produces the same gap on a machine that never slept. So a gap only makes
    // tunnels *suspect* — it fast-tracks them to the confirmation ladder below.
    // It must never lower the bar for killing one (that misdiagnosis dropped a
    // healthy DGX tunnel twice in ten minutes).
    const now = Date.now();
    const gap = now - (this._lastHealthCheck || now);
    this._lastHealthCheck = now;
    const suspectAll = gap > HEALTH_INTERVAL * 3;
    if (suspectAll && this.active.size > 0) {
      console.log(`[Groove:Tunnel] ${Math.round(gap / 1000)}s timer gap (sleep or blocked loop) — verifying tunnels`);
    }

    for (const [id, conn] of this.active) {
      try {
        const start = Date.now();
        const res = await fetch(`http://localhost:${conn.localPort}/api/health`, {
          signal: AbortSignal.timeout(this.healthTimeout ?? HEALTH_TIMEOUT),
        });
        if (res.ok) {
          conn.latencyMs = Date.now() - start;
          conn.lastPing = Date.now();
          conn.healthy = true;
          conn.failCount = 0;
        } else {
          throw new Error('unhealthy response');
        }
      } catch {
        conn.failCount = (conn.failCount || 0) + 1;
        // A failed 5s probe is WEAK evidence: it can't distinguish a dead
        // tunnel from a remote daemon that's briefly busy or our own blocked
        // event loop. Never kill on it. Once failures accumulate (or a timer
        // gap makes everything suspect), run the confirmation ladder, which
        // can — a healthy verdict there resets the count.
        if (conn.failCount >= MAX_FAIL_COUNT || suspectAll) {
          const verdict = await this._confirmDead(conn);
          if (verdict === 'alive') {
            conn.failCount = 0;
            conn.healthy = true;
            conn._wedgedStreak = 0;
          } else if (verdict === 'remote-down') {
            // The tunnel is carrying traffic correctly — the far daemon is what
            // died (typically mid-upgrade). Rebuild would be useless; start it.
            conn.healthy = false;
            this.daemon.broadcast({ type: 'tunnel.unhealthy', data: { id } });
            await this._startRemoteDaemon(id, conn);
          } else {
            conn.healthy = false;
            this.daemon.broadcast({ type: 'tunnel.unhealthy', data: { id } });
            // 'wedged' (port accepts, HTTP silent even at long timeout) is the
            // one verdict with a false-positive path — a remote event loop
            // blocked 15s+ — so demand it twice in a row. proc-dead/port-dead
            // are unambiguous: the ssh client is gone or nothing is listening.
            conn._wedgedStreak = verdict === 'wedged' ? (conn._wedgedStreak || 0) + 1 : 0;
            if (verdict !== 'wedged' || conn._wedgedStreak >= 2) {
              await this._reapAndRebuild(id, conn, verdict);
              continue;
            }
          }
        }
      }
      this.daemon.broadcast({
        type: 'tunnel.health',
        data: { id, latencyMs: conn.latencyMs, healthy: conn.healthy },
      });
    }
  }

  // Escalating evidence that a tunnel is actually dead, not merely slow:
  //   'alive'       — answered a long-timeout HTTP probe; leave it alone
  //   'proc-dead'   — the ssh client process is gone
  //   'port-dead'   — nothing is listening on the local port
  //   'remote-down' — the tunnel forwards fine but the REMOTE end refuses:
  //                   the probe fails fast with a connection error, not a
  //                   timeout. Killing the tunnel won't fix that — the remote
  //                   daemon needs starting (e.g. it died during an upgrade).
  //   'wedged'      — port accepts TCP but HTTP hangs to timeout (dead forward)
  async _confirmDead(conn) {
    const started = Date.now();
    let probeErr = null;
    try {
      const res = await fetch(`http://localhost:${conn.localPort}/api/health`, {
        signal: AbortSignal.timeout(this.confirmTimeout ?? CONFIRM_TIMEOUT),
      });
      if (res.ok) return 'alive';
    } catch (err) { probeErr = err; }

    if (conn.pid) {
      try { process.kill(conn.pid, 0); } catch { return 'proc-dead'; }
    }
    if (!(await this._isPortInUse(conn.localPort))) return 'port-dead';

    // ssh is alive and its port listens. A hang (timeout) means the forward is
    // dead; a FAST connection-level error means ssh relayed the remote side's
    // refusal — the tunnel works, the far daemon doesn't.
    const failedFast = Date.now() - started < 2000;
    const timedOut = probeErr && (probeErr.name === 'TimeoutError' || probeErr.name === 'AbortError');
    if (failedFast && !timedOut) return 'remote-down';
    return 'wedged';
  }

  // The tunnel is healthy; the daemon on the far side is what's down. Start it
  // over ssh rather than pointlessly rebuilding the tunnel. Rate-limited: if
  // the remote daemon won't stay up, repeated starts won't save it.
  async _startRemoteDaemon(id, conn) {
    this._remoteStartAt = this._remoteStartAt || new Map();
    const last = this._remoteStartAt.get(id) || 0;
    if (Date.now() - last < REMOTE_START_COOLDOWN_MS) return;
    this._remoteStartAt.set(id, Date.now());

    console.log(`[Groove:Tunnel] ${id}: tunnel is fine but the remote daemon is down — starting it`);
    this.daemon.audit.log('tunnel.remote-daemon-start', { id });
    this.daemon.broadcast({ type: 'tunnel.status', data: { id, step: 'starting' } });
    try {
      await this.autoStart(id);
      // Confirm it came up; a success resets the failure counters immediately
      // instead of waiting out another health cycle.
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        if (await this._tunnelResponds(conn.localPort)) {
          conn.failCount = 0;
          conn.healthy = true;
          conn._wedgedStreak = 0;
          console.log(`[Groove:Tunnel] ${id}: remote daemon is back`);
          this.daemon.broadcast({ type: 'tunnel.health', data: { id, latencyMs: conn.latencyMs, healthy: true } });
          return;
        }
      }
      console.warn(`[Groove:Tunnel] ${id}: remote daemon did not come back after start`);
    } catch (err) {
      console.warn(`[Groove:Tunnel] ${id}: could not start remote daemon: ${err.message}`);
    }
  }

  // Tear down a confirmed-dead tunnel and immediately rebuild it on the SAME
  // local port. The remote GUI window points at that port and its WebSocket
  // retries every 2s, so a same-port rebuild heals an open window without the
  // user noticing. Only if the rebuild fails does this surface as a disconnect.
  // Rate-limited so a genuinely dead host degrades to disconnected instead of
  // thrashing reconnect attempts forever.
  async _reapAndRebuild(id, conn, reason) {
    const { localPort } = conn;
    console.log(`[Groove:Tunnel] Tunnel ${id} confirmed dead (${reason}) — rebuilding`);
    this.daemon.audit.log('tunnel.reap', { id, reason, failCount: conn.failCount });
    await this.disconnect(id);

    const lastRebuild = this._rebuildAt?.get(id) || 0;
    if (Date.now() - lastRebuild < REBUILD_COOLDOWN_MS) {
      console.log(`[Groove:Tunnel] ${id} already auto-rebuilt recently — leaving disconnected`);
      return;
    }
    this._rebuildAt = this._rebuildAt || new Map();
    this._rebuildAt.set(id, Date.now());

    try {
      this.daemon.broadcast({ type: 'tunnel.status', data: { id, step: 'reconnecting' } });
      await this.connect(id, { preferredPort: localPort });
      console.log(`[Groove:Tunnel] ${id} rebuilt on port ${localPort}`);
    } catch (err) {
      console.warn(`[Groove:Tunnel] Auto-rebuild of ${id} failed: ${err.message}`);
      // disconnect() above already broadcast tunnel.disconnected — the GUI is
      // consistent; the user can reconnect manually when the host is back.
    }
  }

  // Signal 0 only tests for existence — no signal is delivered.
  async _waitForExit(pid, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try { process.kill(pid, 0); } catch { return true; } // gone
      await new Promise((r) => setTimeout(r, 150));
    }
    try { process.kill(pid, 0); return false; } catch { return true; }
  }

  async _waitForPortFree(port, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!(await this._isPortInUse(port))) return true;
      await new Promise((r) => setTimeout(r, 200));
    }
    return !(await this._isPortInUse(port));
  }

  _isPortInUse(port) {
    return new Promise((resolve) => {
      const conn = createConnection({ host: '127.0.0.1', port });
      conn.setTimeout(3000);
      conn.on('connect', () => { conn.destroy(); resolve(true); });
      conn.on('error', () => resolve(false));
      conn.on('timeout', () => { conn.destroy(); resolve(false); });
    });
  }

  async _findAvailablePort() {
    for (let port = DEFAULT_LOCAL_PORT; port < DEFAULT_LOCAL_PORT + MAX_PORT_ATTEMPTS; port++) {
      if (!(await this._isPortInUse(port))) return port;
    }
    throw new Error(`No available local port found (tried ${DEFAULT_LOCAL_PORT}-${DEFAULT_LOCAL_PORT + MAX_PORT_ATTEMPTS - 1})`);
  }

  // Deliberately does NOT kill the ssh processes. They are spawned detached and
  // are the user's live sessions: killing them on every daemon restart (app
  // upgrade, promote, crash) is what nuked remote windows mid-session. State is
  // persisted; the next daemon re-adopts whatever is still alive and serving.
  // Explicit disconnect()/delete() remain the paths that actually kill a tunnel.
  shutdown() {
    if (this._healthInterval) {
      clearInterval(this._healthInterval);
      this._healthInterval = null;
    }
    this._saveActive();
    this.active.clear();
  }
}
