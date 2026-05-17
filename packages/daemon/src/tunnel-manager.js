// GROOVE — Tunnel Manager (SSH remote access)
// FSL-1.1-Apache-2.0 — see LICENSE

import { execFileSync, spawn } from 'child_process';
import { existsSync, writeFileSync, readFileSync, statSync } from 'fs';
import { resolve } from 'path';
import { createConnection } from 'net';
import crypto from 'crypto';

function getLocalVersion() {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
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

function sshCmd(cmd) {
  const nvmProbe = 'export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"; ';
  return `bash -lc '${nvmProbe}${cmd}'`;
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

    const target = `${config.user}@${config.host}`;
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

    if (this.active.has(id)) {
      const existing = this.active.get(id);
      return { localPort: existing.localPort, pid: existing.pid, name: config.name };
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
      '-o', 'GSSAPIAuthentication=no',
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
      try { process.kill(tunnel.pid); } catch { /* ignore */ }
      throw new Error(`SSH tunnel started but port forward not active${stderrBuf.trim() ? ': ' + stderrBuf.trim() : ''}`);
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

    // Verify daemon is reachable through tunnel, start if needed
    let remoteAlive = false;
    try {
      const probe = await fetch(`http://localhost:${localPort}/api/health`, {
        signal: AbortSignal.timeout(5000),
      });
      remoteAlive = probe.ok;
    } catch { /* not reachable */ }

    if (!remoteAlive && config.autoStart) {
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
    } else if (!remoteAlive && !config.autoStart) {
      this.daemon.broadcast({ type: 'tunnel.status', data: { id, step: 'waiting', message: 'Remote daemon not running. Start it manually or enable auto-start.' } });
    }

    // Auto-upgrade: check version through tunnel, upgrade if behind (non-blocking)
    if (remoteAlive && !preConnectHandled) {
      this._checkAndUpgradeRunning(id, config, localPort).catch(() => {});
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

  async _checkAndUpgradeRunning(id, config, localPort) {
    try {
      // Get remote daemon version
      const resp = await fetch(`http://localhost:${localPort}/api/status`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!resp.ok) return;
      const status = await resp.json();
      const remoteVer = status.version;
      if (!remoteVer) return;

      // Check latest version on npm (from the remote server)
      const target = `${config.user}@${config.host}`;
      const keyArgs = config.sshKeyPath ? ['-i', config.sshKeyPath] : [];
      const sshBase = [...keyArgs, '-p', String(config.port || 22), '-o', 'ConnectTimeout=10', '-o', 'BatchMode=yes', target];

      let npmVer;
      try {
        npmVer = execFileSync('ssh', [...sshBase, sshCmd('npm view groove-dev version 2>/dev/null')], {
          encoding: 'utf8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();
      } catch { return; }

      if (!npmVer || npmVer === remoteVer) {
        const localVer = getLocalVersion();
        this.daemon.broadcast({ type: 'tunnel.version-info', data: { id, localVersion: localVer, remoteVersion: remoteVer, match: remoteVer === localVer } });
        return;
      }

      // Remote is behind npm — upgrade
      this.daemon.broadcast({ type: 'tunnel.status', data: { id, step: 'upgrading', from: remoteVer, to: npmVer } });

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

      // Restart remote daemon
      const cdPrefix = config.projectDir ? `cd "${config.projectDir}" && ` : '';
      const setProjectDir = config.projectDir
        ? `curl -sf -X POST -H 'Content-Type: application/json' --data '{"path":"${config.projectDir}"}' http://localhost:${REMOTE_PORT}/api/project-dir > /dev/null 2>&1 || true; `
        : '';
      const restartCmd = `kill $(lsof -t -i:${REMOTE_PORT}) 2>/dev/null || true; sleep 2; ${cdPrefix}GROOVE_BIN=$(which groove) && nohup "$GROOVE_BIN" start > /tmp/groove-daemon.log 2>&1 < /dev/null & disown; sleep 4; curl -sf http://localhost:${REMOTE_PORT}/api/status && (${setProjectDir}true) || true`;
      execFileSync('ssh', [...sshBase, sshCmd(restartCmd)], {
        encoding: 'utf8', timeout: 60000, stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Verify through tunnel
      let daemonVer = null;
      for (let i = 0; i < 3; i++) {
        try {
          const check = await fetch(`http://localhost:${localPort}/api/status`, {
            signal: AbortSignal.timeout(3000),
          });
          if (check.ok) {
            daemonVer = (await check.json()).version || null;
            break;
          }
        } catch { /* retry */ }
        await new Promise(r => setTimeout(r, 2000));
      }

      const localVer = getLocalVersion();
      if (daemonVer) {
        this.daemon.broadcast({ type: 'tunnel.version-info', data: { id, localVersion: localVer, remoteVersion: daemonVer, match: daemonVer === localVer } });
      } else {
        this.daemon.broadcast({ type: 'tunnel.upgrade-failed', data: { id, error: 'Daemon did not respond after restart', from: remoteVer, attempted: npmVer } });
      }

      this.daemon.audit.log('tunnel.upgrade', { id, from: remoteVer, to: daemonVer || npmVer });
    } catch (err) {
      try {
        const verify = await fetch(`http://localhost:${localPort}/api/status`, { signal: AbortSignal.timeout(5000) });
        if (verify.ok) {
          const verifyData = await verify.json();
          this.daemon.broadcast({ type: 'tunnel.version-info', data: { id, localVersion: getLocalVersion(), remoteVersion: verifyData.version, match: false } });
          return;
        }
      } catch { /* tunnel verification failed */ }
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

    const target = `${config.user}@${config.host}`;
    const keyArgs = config.sshKeyPath ? ['-i', config.sshKeyPath] : [];

    // Build the remote bash command:
    //   1. cd into the saved projectDir (if set) so the daemon inherits that cwd
    //   2. launch `groove start` detached via nohup
    //   3. poll /api/health until it responds
    //   4. explicitly POST /api/project-dir so the daemon's projectDir matches
    //      config.projectDir even if the backgrounded cwd didn't stick (this
    //      also updates the editor root used for /api/browse, /api/files/*)
    const cdPrefix = config.projectDir ? `cd "${config.projectDir}" && ` : '';
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
        remoteCmd(`GROOVE_BIN=$(which groove) && nohup "$GROOVE_BIN" start > /tmp/groove-daemon.log 2>&1 < /dev/null & disown; sleep 5; curl -sf http://localhost:${REMOTE_PORT}/api/health > /dev/null && echo __DAEMON_OK__ || (echo __DAEMON_FAIL__; tail -20 /tmp/groove-daemon.log 2>/dev/null)`),
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

    const restartCmd = `kill $(lsof -t -i:${REMOTE_PORT}) 2>/dev/null || true; sleep 2; GROOVE_BIN=$(which groove) && nohup "$GROOVE_BIN" start > /tmp/groove-daemon.log 2>&1 < /dev/null & disown; sleep 4; curl -sf http://localhost:${REMOTE_PORT}/api/status`;
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
