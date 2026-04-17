// GROOVE — Tunnel Manager (SSH remote access)
// FSL-1.1-Apache-2.0 — see LICENSE

import { execFileSync, spawn } from 'child_process';
import { existsSync, writeFileSync, readFileSync, statSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createConnection } from 'net';
import crypto from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
function getLocalVersion() {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'package.json'), 'utf8'));
    return pkg.version || '0.0.0';
  } catch { return '0.0.0'; }
}

const REMOTE_PORT = 31415;
const DEFAULT_LOCAL_PORT = 31416;
const MAX_PORT_ATTEMPTS = 10;
const HEALTH_INTERVAL = 30000;
const HEALTH_TIMEOUT = 5000;
const MAX_FAIL_COUNT = 3;

const INJECTION_CHARS = /[;|&`$(){}[\]<>!#\n\r\\]/;

function validateField(value, name) {
  if (!value || typeof value !== 'string' || !value.trim()) {
    throw new Error(`${name} is required`);
  }
  if (INJECTION_CHARS.test(value)) {
    throw new Error(`Invalid characters in ${name}`);
  }
}

export class TunnelManager {
  constructor(daemon) {
    this.daemon = daemon;
    this.remotesPath = resolve(daemon.grooveDir, 'remotes.json');
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
    for (const [id, config] of this.saved) {
      if (config.autoConnect) {
        try {
          await this.connect(id);
        } catch (err) {
          this.daemon.broadcast({ type: 'tunnel.error', data: { id, error: err.message } });
        }
      }
    }
  }

  getSaved() {
    return Array.from(this.saved.values()).map(s => ({
      ...this._sanitize(s),
      active: this.active.has(s.id),
      ...(this.active.get(s.id) || {}),
    }));
  }

  save({ name, host, user, port, sshKeyPath, autoStart, autoConnect }) {
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

    const target = `${config.user}@${config.host}`;
    const keyArgs = config.sshKeyPath ? ['-i', config.sshKeyPath] : [];

    try {
      const result = execFileSync('ssh', [
        ...keyArgs,
        '-p', String(config.port || 22),
        '-o', 'ConnectTimeout=10',
        '-o', 'StrictHostKeyChecking=accept-new',
        '-o', 'BatchMode=yes',
        target,
        `bash -lc 'curl -sf http://localhost:${REMOTE_PORT}/api/health 2>/dev/null || (which groove >/dev/null 2>&1 && echo __GROOVE_VER__$(groove --version 2>/dev/null || echo unknown)__GROOVE_STOPPED__ || echo __GROOVE_NOT_INSTALLED__)'`,
      ], {
        encoding: 'utf8',
        timeout: 20000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      if (result.includes('__GROOVE_NOT_INSTALLED__')) {
        return { reachable: true, daemonRunning: false, grooveInstalled: false };
      }
      if (result.includes('__GROOVE_STOPPED__')) {
        const verMatch = result.match(/__GROOVE_VER__(.+?)__GROOVE_STOPPED__/);
        const remoteVersion = verMatch ? verMatch[1].trim() : null;
        return { reachable: true, daemonRunning: false, grooveInstalled: true, remoteVersion };
      }
      return { reachable: true, daemonRunning: true, grooveInstalled: true };
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

    if (this.active.has(id)) {
      const existing = this.active.get(id);
      return { localPort: existing.localPort, pid: existing.pid };
    }

    this.daemon.broadcast({ type: 'tunnel.status', data: { id, step: 'testing' } });

    let testResult;
    if (opts.skipTest && opts.testResult) {
      testResult = opts.testResult;
    } else {
      testResult = await this.test(id);
    }
    if (!testResult.reachable) {
      throw new Error(testResult.error || 'Host unreachable');
    }

    if (!testResult.daemonRunning && !testResult.grooveInstalled) {
      this.daemon.broadcast({ type: 'tunnel.status', data: { id, step: 'installing' } });
      await this.remoteInstall(id);
    } else if (!testResult.daemonRunning && testResult.grooveInstalled) {
      const localVer = getLocalVersion();
      if (testResult.remoteVersion && testResult.remoteVersion !== localVer) {
        this.daemon.broadcast({ type: 'tunnel.status', data: { id, step: 'upgrading', from: testResult.remoteVersion, to: localVer } });
        await this._remoteUpgrade(id, config);
      }
      this.daemon.broadcast({ type: 'tunnel.status', data: { id, step: 'starting' } });
      await this.autoStart(id);
    }

    this.daemon.broadcast({ type: 'tunnel.status', data: { id, step: 'connecting' } });

    const localPort = await this._findAvailablePort();
    const target = `${config.user}@${config.host}`;
    const keyArgs = config.sshKeyPath ? ['-i', config.sshKeyPath] : [];

    const sshArgs = [
      '-N',
      '-L', `127.0.0.1:${localPort}:localhost:${REMOTE_PORT}`,
      '-p', String(config.port || 22),
      '-o', 'ServerAliveInterval=30',
      '-o', 'ServerAliveCountMax=3',
      '-o', 'ExitOnForwardFailure=yes',
      '-o', 'StrictHostKeyChecking=accept-new',
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
    for (let elapsed = 0; elapsed < 8000; elapsed += 500) {
      await new Promise((r) => setTimeout(r, 500));
      if (tunnel.exitCode !== null) {
        throw new Error(`Tunnel failed to start: ${stderrBuf.trim() || 'unknown error'}`);
      }
      tunnelUp = await this._isPortInUse(localPort);
      if (tunnelUp) break;
    }

    if (!tunnelUp) {
      try { process.kill(tunnel.pid); } catch { /* ignore */ }
      throw new Error('Tunnel started but port forward not active');
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

    const url = `http://localhost:${localPort}?instance=${encodeURIComponent(config.name)}`;

    this.daemon.audit.log('tunnel.connect', { id, name: config.name, host: config.host, localPort });
    this.daemon.broadcast({ type: 'tunnel.connected', data: { id, name: config.name, localPort, host: config.host, url } });

    if (!this._healthInterval) {
      this._healthInterval = setInterval(() => this._healthCheckAll(), HEALTH_INTERVAL);
    }

    return { localPort, pid: tunnel.pid, name: config.name, url };
  }

  async disconnect(id) {
    const conn = this.active.get(id);
    if (!conn) return;

    const { pid } = conn;
    try {
      const cmd = execFileSync('ps', ['-p', String(pid), '-o', 'command='], {
        encoding: 'utf8',
        timeout: 3000,
      }).trim();
      if (cmd.includes('ssh')) {
        process.kill(pid, 'SIGTERM');
      }
    } catch { /* process already dead */ }

    this.active.delete(id);

    const config = this.saved.get(id);
    this.daemon.audit.log('tunnel.disconnect', { id, name: config?.name });
    this.daemon.broadcast({ type: 'tunnel.disconnected', data: { id, name: config?.name } });

    if (this.active.size === 0 && this._healthInterval) {
      clearInterval(this._healthInterval);
      this._healthInterval = null;
    }
  }

  async _remoteUpgrade(id, config) {
    const target = `${config.user}@${config.host}`;
    const keyArgs = config.sshKeyPath ? ['-i', config.sshKeyPath] : [];
    const sshBase = [...keyArgs, '-p', String(config.port || 22), '-o', 'ConnectTimeout=10', '-o', 'BatchMode=yes', target];
    const installCmd = config.user === 'root' ? 'npm i -g groove-dev' : 'sudo npm i -g groove-dev';

    try {
      execFileSync('ssh', [...sshBase, `bash -lc '${installCmd}'`], {
        encoding: 'utf8',
        timeout: 120000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      const output = err.stdout?.toString() || err.stderr?.toString() || err.message;
      throw new Error(`Remote upgrade failed: ${output.slice(-400)}`);
    }
  }

  async autoStart(id) {
    const config = this.saved.get(id);
    if (!config) throw new Error(`Remote ${id} not found`);

    const target = `${config.user}@${config.host}`;
    const keyArgs = config.sshKeyPath ? ['-i', config.sshKeyPath] : [];

    try {
      const result = execFileSync('ssh', [
        ...keyArgs,
        '-p', String(config.port || 22),
        '-o', 'ConnectTimeout=10',
        '-o', 'BatchMode=yes',
        target,
        `bash -lc 'nohup groove start > /tmp/groove-daemon.log 2>&1 < /dev/null & disown; sleep 5; curl -sf http://localhost:${REMOTE_PORT}/api/health > /dev/null && echo __DAEMON_OK__ || (echo __DAEMON_FAIL__; tail -20 /tmp/groove-daemon.log 2>/dev/null)'`,
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
      const output = err.stdout?.toString() || err.stderr?.toString() || err.message;
      throw new Error(`Failed to start remote daemon: ${output.slice(-300)}`);
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
    const remoteCmd = (cmd) => `bash -lc '${cmd}'`;

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

    // Step 2: Install groove-dev globally (use sudo if not root)
    const installCmd = config.user === 'root'
      ? 'npm i -g groove-dev'
      : 'sudo npm i -g groove-dev';

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
      const output = err.stdout?.toString() || err.stderr?.toString() || err.message;
      throw new Error(`npm install failed: ${output.slice(-400)}`);
    }

    // Step 3: Start the daemon in background
    try {
      const result = execFileSync('ssh', [
        ...sshBase,
        remoteCmd(`nohup groove start > /tmp/groove-daemon.log 2>&1 < /dev/null & disown; sleep 5; curl -sf http://localhost:${REMOTE_PORT}/api/health > /dev/null && echo __DAEMON_OK__ || (echo __DAEMON_FAIL__; tail -20 /tmp/groove-daemon.log 2>/dev/null)`),
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
    for (const [id, conn] of this.active) {
      try {
        const start = Date.now();
        const res = await fetch(`http://localhost:${conn.localPort}/api/health`, {
          signal: AbortSignal.timeout(HEALTH_TIMEOUT),
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
        if (conn.failCount >= MAX_FAIL_COUNT) {
          conn.healthy = false;
          this.daemon.broadcast({ type: 'tunnel.unhealthy', data: { id } });
        }
      }
      this.daemon.broadcast({
        type: 'tunnel.health',
        data: { id, latencyMs: conn.latencyMs, healthy: conn.healthy },
      });
    }
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

  shutdown() {
    if (this._healthInterval) {
      clearInterval(this._healthInterval);
      this._healthInterval = null;
    }
    for (const [id] of this.active) {
      try {
        const conn = this.active.get(id);
        if (conn?.pid) {
          const cmd = execFileSync('ps', ['-p', String(conn.pid), '-o', 'command='], {
            encoding: 'utf8',
            timeout: 3000,
          }).trim();
          if (cmd.includes('ssh')) {
            process.kill(conn.pid, 'SIGTERM');
          }
        }
      } catch { /* ignore */ }
    }
    this.active.clear();
  }
}
