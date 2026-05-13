// FSL-1.1-Apache-2.0 — see LICENSE
import { app, BrowserWindow, Tray, Menu, shell, nativeImage, dialog, ipcMain, safeStorage } from 'electron';
import pkg from 'electron-updater';
const { autoUpdater } = pkg;
import { createHash, randomBytes } from 'crypto';
import { fork, spawn, execFileSync } from 'child_process';
import { basename, dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { writeFileSync, readFileSync, unlinkSync, existsSync, renameSync, readdirSync, rmSync, mkdirSync } from 'fs';
import { execSync } from 'child_process';
import { createServer, createConnection } from 'net';
import { getWelcomeHtml } from './splash.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Fedora/RHEL disable unprivileged user namespaces by default (sysctl or SELinux),
// which makes Electron's Chromium sandbox fail silently inside AppImages.
// Fall back to --no-sandbox at the Chromium level; sandbox:true stays in webPreferences for intent.
if (process.platform === 'linux') {
  let nsDisabled = false;
  try {
    const val = readFileSync('/proc/sys/kernel/unprivileged_userns_clone', 'utf8').trim();
    nsDisabled = val === '0';
  } catch {}
  if (nsDisabled || process.env.APPIMAGE) {
    app.commandLine.appendSwitch('no-sandbox');
  }
}

// Linux ARM64 GPU rendering fallback — escalating recovery:
//   Level 0: auto (Electron defaults — Ozone auto-detects Wayland/X11)
//   Level 1: force X11 via Ozone (fixes NVIDIA ARM + Wayland blank screen)
//   Level 2: full software rendering (no GPU at all)
// On blank paint or GPU crash, escalate one level and relaunch. A marker file
// persists the level so subsequent launches start at the right point.
// Override: GROOVE_GPU=1 resets to level 0, GROOVE_GPU=0 jumps to level 2.
let _gpuFallbackPath = null;
let _gpuFallbackLevel = 0;

if (process.platform === 'linux' && process.arch === 'arm64') {
  let udPath;
  try { udPath = app.getPath('userData'); } catch { udPath = join(process.env.HOME || '/tmp', '.config', 'Groove'); }
  _gpuFallbackPath = join(udPath, '.gpu-fallback');

  const gpuEnv = process.env.GROOVE_GPU;
  if (gpuEnv === '0') {
    _gpuFallbackLevel = 2;
  } else if (gpuEnv === '1') {
    _gpuFallbackLevel = 0;
    try { unlinkSync(_gpuFallbackPath); } catch {}
  } else {
    try {
      const level = readFileSync(_gpuFallbackPath, 'utf8').trim();
      if (level === '1') _gpuFallbackLevel = 1;
      else if (level === '2') _gpuFallbackLevel = 2;
    } catch {}
  }

  if (_gpuFallbackLevel === 1) {
    app.commandLine.appendSwitch('ozone-platform', 'x11');
  } else if (_gpuFallbackLevel === 2) {
    app.disableHardwareAcceleration();
    app.commandLine.appendSwitch('disable-gpu');
    app.commandLine.appendSwitch('disable-gpu-compositing');
    app.commandLine.appendSwitch('use-gl', 'swiftshader');
  }
}

function _escalateGpuFallback(reason) {
  if (!_gpuFallbackPath) return;
  const next = Math.min(_gpuFallbackLevel + 1, 2);
  const label = next === 1 ? 'X11' : 'software rendering';
  process.stderr.write(`[groove] GPU ${reason} on Linux ARM64 — restarting with ${label}\n`);
  try { mkdirSync(dirname(_gpuFallbackPath), { recursive: true }); } catch {}
  try { writeFileSync(_gpuFallbackPath, String(next)); } catch {}
  app.relaunch();
  app.exit(0);
}

function _isBlankCapture(nativeImage) {
  if (nativeImage.isEmpty()) return true;
  const { width, height } = nativeImage.getSize();
  if (width < 10 || height < 10) return true;
  const bitmap = nativeImage.toBitmap();
  if (!bitmap || bitmap.length < 16) return true;
  const stride = width * 4;
  const points = [
    [Math.floor(width * 0.25), Math.floor(height * 0.25)],
    [Math.floor(width * 0.75), Math.floor(height * 0.25)],
    [Math.floor(width * 0.5),  Math.floor(height * 0.5)],
    [Math.floor(width * 0.25), Math.floor(height * 0.75)],
    [Math.floor(width * 0.75), Math.floor(height * 0.75)],
  ];
  const i0 = points[0][1] * stride + points[0][0] * 4;
  const r0 = bitmap[i0], g0 = bitmap[i0 + 1], b0 = bitmap[i0 + 2];
  for (let p = 1; p < points.length; p++) {
    const idx = points[p][1] * stride + points[p][0] * 4;
    if (Math.abs(bitmap[idx] - r0) > 8 || Math.abs(bitmap[idx + 1] - g0) > 8 || Math.abs(bitmap[idx + 2] - b0) > 8) {
      return false;
    }
  }
  return true;
}

if (_gpuFallbackPath && _gpuFallbackLevel < 2) {
  app.on('child-process-gone', (_e, details) => {
    if (details.type === 'GPU') _escalateGpuFallback(`gpu-crash:${details.reason}`);
  });

  let gpuVerified = false;
  app.on('browser-window-created', (_e, win) => {
    if (gpuVerified) return;
    win.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        if (gpuVerified || win.isDestroyed()) return;
        win.webContents.capturePage().then(img => {
          if (gpuVerified || win.isDestroyed()) return;
          if (_isBlankCapture(img)) {
            _escalateGpuFallback('blank-paint');
          } else {
            gpuVerified = true;
            try { unlinkSync(_gpuFallbackPath); } catch {}
          }
        }).catch(() => {});
      }, 4000);
    });
  });
}

const IS_MAC = process.platform === 'darwin';
const STUDIO_URL = 'https://studio.groovedev.ai';
const SUBSCRIPTION_POLL_MS = 5 * 60 * 1000;
let _lastSubCheck = 0;

function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

// macOS Electron apps launched from Finder inherit a minimal PATH missing user
// shell additions. Resolve the real PATH and API key env vars once at startup
// so forked daemons can find CLI tools and use API keys as fallback.
(function fixElectronEnv() {
  if (!IS_MAC) return;
  const shell = process.env.SHELL || '/bin/zsh';
  const apiKeyVars = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'ELEVENLABS_API_KEY'];
  const envVars = ['SSH_AUTH_SOCK'];
  try {
    const allVars = [...apiKeyVars, ...envVars];
    const printCmd = ['echo "PATH=$PATH"', ...allVars.map(v => `echo "${v}=$${v}"`)].join('; ');
    const output = execSync(`${shell} -ilc '${printCmd}'`, { encoding: 'utf8', timeout: 5000 }).trim();
    for (const line of output.split('\n')) {
      const eq = line.indexOf('=');
      if (eq < 1) continue;
      const key = line.slice(0, eq);
      const val = line.slice(eq + 1);
      if (key === 'PATH' && val) { process.env.PATH = val; }
      else if (apiKeyVars.includes(key) && val && !process.env[key]) { process.env[key] = val; }
      else if (envVars.includes(key) && val) { process.env[key] = val; }
    }
  } catch {
    const home = app.getPath('home');
    const extra = [
      '/usr/local/bin', '/opt/homebrew/bin', `${home}/.local/bin`,
      `${home}/.npm-global/bin`,
    ];
    const cur = process.env.PATH || '';
    const toAdd = extra.filter(p => !cur.split(':').includes(p));
    if (toAdd.length) process.env.PATH = [...toAdd, cur].join(':');
  }
})();

let tray = null;
let isQuitting = false;
let pendingAuthState = null;
let subscriptionTimer = null;
let workspaces = null;

function resolveResourcePath(...segments) {
  if (app.isPackaged) {
    return join(process.resourcesPath, ...segments);
  }
  return resolve(__dirname, '..', ...segments);
}

// --- WorkspaceManager: one daemon + one window per project ---

class WorkspaceManager {
  constructor() {
    this.instances = new Map();
    this._daemonProcesses = new Map();
    this.recentProjects = this._loadRecents();
    this.sshConnections = this._loadSSH();
    this._sshTunnels = new Map();
    this._homeWindow = null;
  }

  _instanceId(projectDir) {
    return createHash('sha256').update(projectDir).digest('hex').slice(0, 8);
  }

  _rejectIfUnsafe(projectDir) {
    if (!projectDir || typeof projectDir !== 'string') return 'Invalid folder path.';
    const dir = resolve(projectDir);
    const home = app.getPath('home');
    const forbidden = new Set([home, '/', '/Users', '/Applications', '/System', '/Library', '/private', '/var', '/tmp', '/etc', '/usr', '/opt', '/bin', '/sbin', app.getPath('desktop'), app.getPath('documents'), app.getPath('downloads')]);
    if (forbidden.has(dir)) {
      return `Groove cannot open "${dir}" as a project — it's a system or top-level folder. Choose a specific project directory instead.`;
    }
    return null;
  }

  _loadRecents() {
    try {
      const p = join(app.getPath('userData'), 'recent-projects.json');
      return JSON.parse(readFileSync(p, 'utf8'));
    } catch { return []; }
  }

  _saveRecents() {
    const p = join(app.getPath('userData'), 'recent-projects.json');
    writeFileSync(p, JSON.stringify(this.recentProjects.slice(0, 20)), { mode: 0o600 });
  }

  _touchRecent(projectDir, name) {
    this.recentProjects = this.recentProjects.filter(r => r.dir !== projectDir);
    this.recentProjects.unshift({
      dir: projectDir,
      name: name || basename(projectDir),
      lastOpened: new Date().toISOString(),
    });
    this._saveRecents();
  }

  async open(projectDir, options = {}) {
    const forbidden = this._rejectIfUnsafe(projectDir);
    if (forbidden) {
      if (options.showDialogs !== false) dialog.showErrorBox('Cannot open this folder', forbidden);
      throw new Error(forbidden);
    }
    const id = this._instanceId(projectDir);

    if (this.instances.has(id)) {
      const inst = this.instances.get(id);
      if (inst.window && !inst.window.isDestroyed()) {
        inst.window.show();
        inst.window.focus();
        return inst;
      }
    }

    let port;
    try {
      port = await this._startDaemon(id, projectDir);
    } catch (err) {
      if (options.showDialogs !== false) {
        dialog.showErrorBox('Failed to open project',
          `${err.message}\n\nTry reinstalling Groove from groovedev.ai or rebuild with ./promote-local.sh`);
      }
      throw err;
    }
    const name = basename(projectDir);
    const window = this._createWindow(id, port, projectDir);

    const inst = { id, port, projectDir, name, daemon: this._getDaemon(id), window };
    this.instances.set(id, inst);
    this._touchRecent(projectDir, name);
    this._updateTrayMenu();

    return inst;
  }

  openRemote(localPort, name) {
    const id = `remote-${localPort}`;

    if (this.instances.has(id)) {
      const inst = this.instances.get(id);
      if (inst.window && !inst.window.isDestroyed()) {
        inst.window.show();
        inst.window.focus();
        return inst;
      }
    }

    const win = new BrowserWindow({
      width: 1440,
      height: 900,
      minWidth: 900,
      minHeight: 600,
      titleBarStyle: IS_MAC ? 'hiddenInset' : 'default',
      backgroundColor: '#0a0a0a',
      title: `${name} — Groove (Remote)`,
      show: false,
      webPreferences: {
        preload: join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });

    win.webContents.session.setPermissionRequestHandler((wc, permission, callback) => {
      const url = wc.getURL();
      const isLocal = url.startsWith('http://localhost') || url.startsWith('http://127.0.0.1');
      if (isLocal && (permission === 'media' || permission === 'microphone' || permission === 'audio-capture')) {
        callback(true);
        return;
      }
      if (!isLocal) { callback(false); return; }
      callback(true);
    });

    win.webContents.session.setPermissionCheckHandler((wc, permission) => {
      if (!wc) return false;
      const url = wc.getURL();
      const isLocal = url.startsWith('http://localhost') || url.startsWith('http://127.0.0.1');
      if (isLocal && (permission === 'media' || permission === 'microphone' || permission === 'audio-capture')) {
        return true;
      }
      return isLocal;
    });

    const remoteUrl = `http://localhost:${localPort}?instance=${encodeURIComponent(name)}`;

    const guiErrorHtml = 'data:text/html,' + encodeURIComponent([
      '<!DOCTYPE html><html><head><style>',
      '*{margin:0;padding:0;box-sizing:border-box}',
      'body{background:#0f1115;color:#e6e6e6;font-family:-apple-system,BlinkMacSystemFont,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:16px}',
      '.icon{width:64px;height:64px;border-radius:50%;background:rgba(251,191,36,0.1);display:flex;align-items:center;justify-content:center;margin-bottom:8px}',
      'h2{font-size:18px;font-weight:600}',
      'p{font-size:13px;color:#6e7681;max-width:400px;text-align:center;line-height:1.5}',
      '.hint{font-size:12px;color:#505862}',
      'button{margin-top:8px;padding:10px 24px;border-radius:8px;border:1px solid rgba(51,175,188,0.4);background:rgba(51,175,188,0.1);color:#33afbc;font-size:13px;font-weight:500;cursor:pointer}',
      'button:hover{background:rgba(51,175,188,0.2)}',
      '</style></head><body>',
      '<div class="icon"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div>',
      '<h2>Remote GUI Not Available</h2>',
      '<p>The remote Groove daemon is running but its GUI files are missing. This usually means the remote version needs to be updated.</p>',
      '<p class="hint">Try disconnecting and reconnecting — Groove will automatically update the remote.</p>',
      `<button onclick="location.href='${remoteUrl.replace(/'/g, "\\'")}'">Retry</button>`,
      '<p class="hint" style="margin-top:12px">If retry doesn\'t work, close this window and click the server again in the welcome screen to reconnect.</p>',
      '</body></html>',
    ].join(''));

    win.webContents.on('did-finish-load', () => {
      const loadedUrl = win.webContents.getURL();
      if (loadedUrl.startsWith('data:')) return;
      win.webContents.executeJavaScript('(function(){ var el = document.querySelector("pre"); return el ? el.textContent : null; })()')
        .then(text => {
          if (!text) return;
          try {
            const json = JSON.parse(text);
            if (json.error) win.webContents.loadURL(guiErrorHtml);
          } catch {}
        })
        .catch(() => {});
    });

    let loadRetries = 0;
    const MAX_LOAD_RETRIES = 3;
    const RETRY_DELAY_MS = 2000;

    win.webContents.on('did-fail-load', (_e, code, desc) => {
      if (code === -3) return;
      if (loadRetries < MAX_LOAD_RETRIES) {
        loadRetries++;
        setTimeout(() => {
          if (!win.isDestroyed()) win.loadURL(remoteUrl);
        }, RETRY_DELAY_MS);
        return;
      }
      const failHtml = 'data:text/html,' + encodeURIComponent([
        '<!DOCTYPE html><html><head><style>',
        '*{margin:0;padding:0;box-sizing:border-box}',
        'body{background:#0f1115;color:#e6e6e6;font-family:-apple-system,BlinkMacSystemFont,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:16px}',
        'h2{font-size:18px;font-weight:600}',
        'p{font-size:13px;color:#6e7681;max-width:400px;text-align:center;line-height:1.5}',
        'button{margin-top:8px;padding:10px 24px;border-radius:8px;border:1px solid rgba(51,175,188,0.4);background:rgba(51,175,188,0.1);color:#33afbc;font-size:13px;font-weight:500;cursor:pointer}',
        'button:hover{background:rgba(51,175,188,0.2)}',
        '</style></head><body>',
        '<h2>Connection Failed</h2>',
        `<p>${(desc || 'Could not reach the remote Groove daemon.').replace(/[<>"&]/g, '')}</p>`,
        `<button onclick="location.href='${remoteUrl.replace(/'/g, "\\'")}'">Retry</button>`,
        '</body></html>',
      ].join(''));
      win.webContents.loadURL(failHtml);
    });

    win.webContents.on('did-finish-load', () => { loadRetries = 0; });

    // Clear HTTP cache before loading remote GUI — prevents stale bundles after npm update
    win.webContents.session.clearCache().then(() => {
      win.loadURL(remoteUrl);
    });
    win.once('ready-to-show', () => win.show());

    win.webContents.setWindowOpenHandler(({ url }) => {
      try {
        const parsed = new URL(url);
        if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
          shell.openExternal(url);
        }
      } catch {}
      return { action: 'deny' };
    });

    win.on('close', (e) => {
      if (IS_MAC && !isQuitting) {
        e.preventDefault();
        win.hide();
        this._showHomeIfNeeded(win);
      }
    });

    win.on('closed', () => {
      this.instances.delete(id);
      this._updateTrayMenu();
    });

    const inst = { id, port: localPort, projectDir: null, name, daemon: null, window: win, remote: true };
    this.instances.set(id, inst);
    this._closeHomeWindow();
    this._updateTrayMenu();

    return inst;
  }

  async close(id) {
    const inst = this.instances.get(id);
    if (!inst) return;
    if (inst.window && !inst.window.isDestroyed()) inst.window.close();
    if (inst.daemon && !inst.daemon.killed) {
      inst.daemon.kill('SIGTERM');
      await new Promise(r => {
        const t = setTimeout(() => {
          try { inst.daemon.kill('SIGKILL'); } catch {}
          r();
        }, 2000);
        inst.daemon.on('exit', () => { clearTimeout(t); r(); });
      });
    }
    this.instances.delete(id);
    this._updateTrayMenu();
  }

  async shutdownAll() {
    await Promise.all([...this.instances.keys()].map(id => this.close(id)));
  }

  getAll() {
    return Array.from(this.instances.values());
  }

  // --- SSH Connections (stored in Electron userData, independent of any daemon) ---

  _loadSSH() {
    try {
      const connections = JSON.parse(readFileSync(join(app.getPath('userData'), 'ssh-connections.json'), 'utf8'));
      let migrated = false;
      for (const c of connections) {
        if (c.keyPath && !c.sshKeyPath) {
          c.sshKeyPath = c.keyPath;
          delete c.keyPath;
          migrated = true;
        }
      }
      if (migrated) {
        writeFileSync(
          join(app.getPath('userData'), 'ssh-connections.json'),
          JSON.stringify(connections, null, 2),
          { mode: 0o600 },
        );
      }
      return connections;
    } catch { return []; }
  }

  _saveSSH() {
    writeFileSync(
      join(app.getPath('userData'), 'ssh-connections.json'),
      JSON.stringify(this.sshConnections, null, 2),
      { mode: 0o600 },
    );
  }

  addSSH(config) {
    const id = createHash('sha256').update(`${config.user}@${config.host}:${config.port || 22}`).digest('hex').slice(0, 8);
    const existing = this.sshConnections.find(c => c.id === id);
    if (existing) {
      Object.assign(existing, config, { id });
      if (existing.keyPath && !existing.sshKeyPath) { existing.sshKeyPath = existing.keyPath; delete existing.keyPath; }
      this._saveSSH();
      return existing;
    }
    const entry = { id, ...config, port: config.port || 22, createdAt: new Date().toISOString() };
    if (entry.keyPath && !entry.sshKeyPath) { entry.sshKeyPath = entry.keyPath; delete entry.keyPath; }
    this.sshConnections.unshift(entry);
    this._saveSSH();
    return entry;
  }

  removeSSH(id) {
    this.sshConnections = this.sshConnections.filter(c => c.id !== id);
    this._saveSSH();
  }

  syncSSHFromDaemon(port) {
    fetch(`http://localhost:${port}/api/tunnels`)
      .then(r => r.json())
      .then(tunnels => {
        if (!Array.isArray(tunnels)) return;
        const ids = new Set(this.sshConnections.map(c => c.id));
        let changed = false;
        for (const t of tunnels) {
          if (!ids.has(t.id)) {
            this.sshConnections.push({
              id: t.id, name: t.name, host: t.host, user: t.user,
              port: t.port || 22, sshKeyPath: t.sshKeyPath,
              createdAt: t.createdAt,
            });
            changed = true;
          }
        }
        if (changed) this._saveSSH();
      })
      .catch(() => {});
  }

  async connectSSH(id) {
    const conn = this.sshConnections.find(c => c.id === id);
    if (!conn) throw new Error('Connection not found');

    const localPort = await getAvailablePort();
    const knownHostsPath = join(app.getPath('userData'), 'ssh-known-hosts');
    const rawKey = conn.sshKeyPath || conn.keyPath;
    let sshKey = rawKey || null;
    if (sshKey) {
      sshKey = sshKey.replace(/^~(?=[/\\]|$)/, app.getPath('home'));
      if (!existsSync(sshKey)) {
        throw new Error(`SSH key file not found: ${sshKey}`);
      }
    }
    const keyArgs = sshKey ? ['-i', sshKey] : [];

    const spawnTunnel = () => {
      const sshArgs = [
        '-N', '-L', `${localPort}:localhost:31415`,
        ...keyArgs,
        '-p', String(conn.port || 22),
        '-o', 'StrictHostKeyChecking=accept-new',
        '-o', 'GSSAPIAuthentication=no',
        '-o', `UserKnownHostsFile=${knownHostsPath}`,
        '-o', 'ConnectTimeout=15',
        '-o', 'ServerAliveInterval=30',
        '-o', 'ServerAliveCountMax=3',
        '-o', 'ExitOnForwardFailure=yes',
        '-o', 'BatchMode=yes',
        `${conn.user}@${conn.host}`,
      ];
      const p = spawn('ssh', sshArgs, { stdio: ['ignore', 'pipe', 'pipe'], detached: true, windowsHide: true, shell: process.platform === 'win32' });
      const state = { proc: p, exited: false, exitCode: null, stderr: '' };
      p.stderr.on('data', (chunk) => { state.stderr += chunk.toString(); });
      p.on('exit', (code) => { state.exited = true; state.exitCode = code; });
      return state;
    };

    const removeStaleHostKey = () => {
      try {
        const hostSpec = (conn.port && conn.port !== 22)
          ? `[${conn.host}]:${conn.port}`
          : conn.host;
        execFileSync('ssh-keygen', ['-R', hostSpec, '-f', knownHostsPath], {
          stdio: 'pipe', timeout: 5000, shell: process.platform === 'win32',
        });
        return true;
      } catch { return false; }
    };

    const isPortInUse = (port) => new Promise((resolve) => {
      const sock = createConnection({ host: '127.0.0.1', port }, () => {
        sock.destroy();
        resolve(true);
      });
      sock.on('error', () => resolve(false));
      sock.setTimeout(500, () => { sock.destroy(); resolve(false); });
    });

    const waitForTunnel = async (state) => {
      for (let elapsed = 0; elapsed < 20000; elapsed += 500) {
        await new Promise(r => setTimeout(r, 500));
        if (state.exited) return false;
        if (await isPortInUse(localPort)) return true;
      }
      return false;
    };

    const enhancePermissionError = (errText) => {
      if (/permission denied/i.test(errText)) {
        if (sshKey) {
          return `${errText} — the SSH key "${rawKey}" was rejected by the server. Verify this is the correct key for ${conn.user}@${conn.host}.`;
        }
        return `${errText} — no SSH key configured for this connection. Edit the connection and add your SSH key, or ensure your SSH agent has the key loaded.`;
      }
      return errText;
    };

    let tunnel = spawnTunnel();
    let tunnelUp = await waitForTunnel(tunnel);

    if (!tunnelUp && tunnel.exited) {
      const errText = tunnel.stderr.trim();
      if (/host key verification failed|remote host identification has changed/i.test(errText)) {
        if (removeStaleHostKey()) {
          tunnel = spawnTunnel();
          tunnelUp = await waitForTunnel(tunnel);
          if (!tunnelUp) {
            if (tunnel.exited) {
              const retryErr = tunnel.stderr.trim() || 'unknown SSH error';
              throw new Error(`SSH tunnel failed after clearing stale host key: ${enhancePermissionError(retryErr)}`);
            }
            try { process.kill(tunnel.proc.pid); } catch {}
            throw new Error(`SSH tunnel started but port forward not active${tunnel.stderr.trim() ? ': ' + tunnel.stderr.trim() : ''}`);
          }
        } else {
          throw new Error(`SSH host key verification failed and could not clear stale entry: ${errText}`);
        }
      } else {
        const detail = enhancePermissionError(errText) || `exit code ${tunnel.exitCode}`;
        throw new Error(`SSH tunnel failed to establish: ${detail}`);
      }
    } else if (!tunnelUp) {
      try { process.kill(tunnel.proc.pid); } catch {}
      throw new Error(`SSH tunnel started but port forward not active${tunnel.stderr.trim() ? ': ' + tunnel.stderr.trim() : ''}`);
    }

    const proc = tunnel.proc;
    proc.unref();

    const sshExec = (cmd, timeout = 60000) => {
      const escaped = cmd.replace(/'/g, "'\\''");
      return execFileSync('ssh', [
        ...keyArgs, '-p', String(conn.port || 22),
        '-o', 'ConnectTimeout=10', '-o', 'BatchMode=yes',
        '-o', `UserKnownHostsFile=${knownHostsPath}`,
        `${conn.user}@${conn.host}`, `bash -lc '${escaped}'`,
      ], { timeout, stdio: 'pipe', shell: process.platform === 'win32' }).toString().trim();
    };

    const checkHealth = async (attempts = 4, delay = 2000) => {
      for (let i = 0; i < attempts; i++) {
        try {
          const resp = await fetch(`http://localhost:${localPort}/api/health`, { signal: AbortSignal.timeout(3000) });
          if (resp.ok) return true;
        } catch {}
        if (i < attempts - 1) await new Promise(r => setTimeout(r, delay));
      }
      return false;
    };

    const emitProgress = (msg) => {
      if (this._homeWindow && !this._homeWindow.isDestroyed()) {
        this._homeWindow.webContents.executeJavaScript(
          `document.getElementById('loading-text').textContent = ${JSON.stringify(msg)}`
        ).catch(() => {});
      }
    };

    let healthy = await checkHealth();

    if (!healthy) {
      let grooveInstalled = false;
      try {
        sshExec('groove --version', 10000);
        grooveInstalled = true;
      } catch {}

      if (!grooveInstalled) {
        emitProgress('Checking remote environment...');
        try {
          const envCheck = sshExec('which node && which npm || echo __NO_NODE__', 20000);
          if (envCheck.includes('__NO_NODE__')) {
            proc.kill();
            throw new Error('Node.js and npm are not installed on the remote server. Install Node.js 20+ first, then retry.');
          }
        } catch (envErr) {
          if (envErr.message.includes('not installed on the remote')) throw envErr;
          proc.kill();
          throw new Error(`Failed to check remote environment: ${envErr.message}`);
        }

        emitProgress('Installing Groove on remote server...');
        const isRoot = conn.user === 'root';
        const localVer = app.getVersion();
        const pinnedPkg = `groove-dev@${localVer}`;
        const latestPkg = 'groove-dev';
        const installCmd = (pkg) => isRoot ? `npm i -g ${pkg}` : `sudo npm i -g ${pkg}`;
        try {
          sshExec(installCmd(pinnedPkg), 120000);
        } catch (e) {
          emitProgress('Pinned version failed — trying latest...');
          try {
            sshExec(installCmd(latestPkg), 120000);
          } catch (e2) {
            proc.kill();
            throw new Error(`Failed to install Groove on remote server: ${e2.message || 'npm install failed'}`);
          }
        }
      }

      emitProgress('Starting remote daemon...');
      try {
        const startResult = sshExec('GROOVE_BIN=$(which groove) && nohup "$GROOVE_BIN" start > /tmp/groove-daemon.log 2>&1 < /dev/null & disown; sleep 4; curl -sf http://localhost:31415/api/health > /dev/null && echo __DAEMON_OK__ || echo __DAEMON_FAIL__', 60000);
        if (startResult.includes('__DAEMON_OK__')) {
          healthy = true;
        }
      } catch {}

      if (!healthy) {
        healthy = await checkHealth(5, 3000);
      }
    }

    let didUpgrade = false;

    if (!healthy) {
      proc.kill();
      throw new Error('Remote daemon started but not responding on port 31415 — check firewall settings or try again');
    }

    const localVersion = app.getVersion();
    try {
      const resp = await fetch(`http://localhost:${localPort}/api/status`, { signal: AbortSignal.timeout(3000) });
      if (resp.ok) {
        const status = await resp.json();
        const remoteVersion = status.version;
        if (remoteVersion && remoteVersion !== localVersion) {
          didUpgrade = true;
          emitProgress(`Updating remote Groove ${remoteVersion} → ${localVersion}...`);
          const upgradeCmd = (pkg) => conn.user === 'root' ? `npm i -g ${pkg}` : `sudo npm i -g ${pkg}`;
          try {
            sshExec(upgradeCmd(`groove-dev@${localVersion}`), 120000);
          } catch (e) {
            console.error('[ssh] Remote upgrade failed:', e.message);
            emitProgress('Pinned upgrade failed — trying latest...');
            try {
              sshExec(upgradeCmd('groove-dev'), 120000);
            } catch (e2) {
              console.error('[ssh] Unpinned upgrade also failed:', e2.message);
              emitProgress('Remote upgrade failed — running older version');
            }
          }
          healthy = false;
          try { sshExec('kill $(lsof -t -i:31415) 2>/dev/null || true', 10000); } catch {}
          await new Promise(r => setTimeout(r, 2000));
          try {
            const restartResult = sshExec('GROOVE_BIN=$(which groove) && nohup "$GROOVE_BIN" start > /tmp/groove-daemon.log 2>&1 < /dev/null & disown; sleep 4; curl -sf http://localhost:31415/api/health > /dev/null && echo __DAEMON_OK__ || echo __DAEMON_FAIL__', 60000);
            if (restartResult.includes('__DAEMON_OK__')) {
              healthy = true;
            }
          } catch {}
          if (!healthy && !await checkHealth(5, 3000)) {
            emitProgress('Remote updated but daemon slow to restart — retrying...');
            await new Promise(r => setTimeout(r, 5000));
            if (!await checkHealth(3, 3000)) {
              emitProgress('Remote daemon slow to start, attempting connection...');
            }
          }
        }
      }
    } catch {}

    if (didUpgrade && !await checkHealth(5, 3000)) {
      proc.kill();
      throw new Error('Remote daemon started but not responding on port 31415 — check firewall settings or try again');
    }

    this._sshTunnels = this._sshTunnels || new Map();
    this._sshTunnels.set(id, proc);

    conn.lastConnected = new Date().toISOString();
    this._saveSSH();

    return { localPort, name: conn.name };
  }

  _startDaemon(id, projectDir) {
    return new Promise((resolve, reject) => {
      const bridgePath = join(__dirname, 'daemon-bridge.js');
      const guiPath = app.isPackaged ? resolveResourcePath('gui') : resolveResourcePath('gui', 'dist');
      const daemonPath = resolveResourcePath('daemon', 'src', 'index.js');

      const proc = fork(bridgePath, [projectDir], {
        execArgv: ['--max-old-space-size=2048', '--max-semi-space-size=128'],
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
        env: {
          ...process.env,
          GROOVE_ELECTRON: '1',
          GROOVE_GUI_PATH: guiPath,
          GROOVE_DAEMON_PATH: daemonPath,
        },
      });

      this._daemonProcesses.set(id, proc);

      const timeout = setTimeout(() => reject(new Error('Daemon failed to start within 15 seconds')), 15000);

      proc.on('message', (msg) => {
        if (msg.type === 'ready') {
          clearTimeout(timeout);
          const token = loadStoredToken();
          if (token) proc.send({ type: 'auth-token', token });
          resolve(msg.port);
        } else if (msg.type === 'error') {
          clearTimeout(timeout);
          reject(new Error(msg.message));
        }
      });

      proc.stderr.on('data', (data) => process.stderr.write(`[daemon:${id}] ${data}`));

      proc.on('exit', (code) => {
        clearTimeout(timeout);
        this._daemonProcesses.delete(id);
        const inst = this.instances.get(id);
        if (inst && !isQuitting) {
          if (inst.window && !inst.window.isDestroyed()) {
            inst.window.webContents.send('daemon-crashed', { code });
          }
        }
      });
    });
  }

  _getDaemon(id) {
    return this._daemonProcesses.get(id) || null;
  }

  _createWindow(id, port, projectDir) {
    const name = basename(projectDir);
    const win = new BrowserWindow({
      width: 1440,
      height: 900,
      minWidth: 900,
      minHeight: 600,
      titleBarStyle: IS_MAC ? 'hiddenInset' : 'default',
      backgroundColor: '#0a0a0a',
      title: `${name} — Groove`,
      show: false,
      webPreferences: {
        preload: join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });

    win.webContents.session.setPermissionRequestHandler((wc, permission, callback) => {
      const url = wc.getURL();
      const isLocal = url.startsWith('http://localhost') || url.startsWith('http://127.0.0.1');
      if (isLocal && (permission === 'media' || permission === 'microphone' || permission === 'audio-capture')) {
        callback(true);
        return;
      }
      if (!isLocal) { callback(false); return; }
      callback(true);
    });

    win.webContents.session.setPermissionCheckHandler((wc, permission) => {
      if (!wc) return false;
      const url = wc.getURL();
      const isLocal = url.startsWith('http://localhost') || url.startsWith('http://127.0.0.1');
      if (isLocal && (permission === 'media' || permission === 'microphone' || permission === 'audio-capture')) {
        return true;
      }
      return isLocal;
    });

    win.loadURL(`http://localhost:${port}?instance=${encodeURIComponent(name)}`);
    win.once('ready-to-show', () => win.show());
    win.webContents.on('console-message', (event) => {
      const { level, message, lineNumber, sourceId } = event;
      if (level === 'error' || level === 'warning') {
        process.stderr.write(`[renderer:${level}] ${message} (${sourceId}:${lineNumber})\n`);
      }
    });
    win.webContents.on('render-process-gone', (_e, details) => {
      process.stderr.write(`[renderer-gone] ${JSON.stringify(details)}\n`);
    });

    win.webContents.setWindowOpenHandler(({ url }) => {
      try {
        const parsed = new URL(url);
        if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
          shell.openExternal(url);
        }
      } catch {}
      return { action: 'deny' };
    });

    win.on('close', (e) => {
      if (IS_MAC && !isQuitting) {
        e.preventDefault();
        win.hide();
        this._showHomeIfNeeded(win);
      }
    });

    win.on('closed', () => {
      const inst = this.instances.get(id);
      if (inst) inst.window = null;
    });

    win.on('focus', () => {
      const now = Date.now();
      if (now - _lastSubCheck < 60_000) return;
      _lastSubCheck = now;
      if (loadStoredToken()) checkSubscription();
    });

    return win;
  }

  _updateTrayMenu() {
    if (!tray) return;
    const instances = this.getAll();
    const instanceItems = instances.map(inst => ({
      label: inst.name || basename(inst.projectDir),
      click: () => {
        if (inst.window && !inst.window.isDestroyed()) {
          inst.window.show();
          inst.window.focus();
        }
      },
    }));

    const recentItems = this.recentProjects
      .filter(r => !instances.some(i => i.projectDir === r.dir))
      .slice(0, 5)
      .map(r => ({
        label: r.name || basename(r.dir),
        click: () => this.open(r.dir),
      }));

    const template = [
      ...instanceItems,
      ...(instanceItems.length > 0 ? [{ type: 'separator' }] : []),
      { label: 'Open Folder...', click: () => this._openFolderDialog() },
      ...(recentItems.length > 0 ? [
        { type: 'separator' },
        { label: 'Recent Projects', enabled: false },
        ...recentItems,
      ] : []),
      { type: 'separator' },
      { label: 'Quit Groove', click: () => { isQuitting = true; app.quit(); } },
    ];

    tray.setContextMenu(Menu.buildFromTemplate(template));
  }

  async _openFolderDialog(parentWindow = null) {
    const result = await dialog.showOpenDialog(parentWindow || BrowserWindow.getFocusedWindow(), {
      properties: ['openDirectory'],
      title: 'Open Project Folder',
    });
    if (!result.canceled && result.filePaths.length) {
      await this.open(result.filePaths[0]);
    }
  }

  _createHomeWindow() {
    if (this._homeWindow && !this._homeWindow.isDestroyed()) {
      this._homeWindow.show();
      this._homeWindow.focus();
      return;
    }

    const htmlPath = join(app.getPath('userData'), 'welcome.html');
    writeFileSync(htmlPath, getWelcomeHtml(), 'utf8');

    const win = new BrowserWindow({
      width: 1440,
      height: 900,
      minWidth: 900,
      minHeight: 600,
      resizable: true,
      titleBarStyle: IS_MAC ? 'hiddenInset' : 'default',
      backgroundColor: '#0a0a0a',
      title: 'Groove',
      show: false,
      webPreferences: {
        preload: join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });

    win.loadFile(htmlPath);
    win.once('ready-to-show', () => win.show());

    win.on('close', (e) => {
      if (IS_MAC && !isQuitting) {
        e.preventDefault();
        win.hide();
      }
    });

    win.on('closed', () => {
      this._homeWindow = null;
    });

    this._homeWindow = win;
  }

  _closeHomeWindow() {
    if (this._homeWindow && !this._homeWindow.isDestroyed()) {
      this._homeWindow.destroy();
    }
    this._homeWindow = null;
  }

  _showHomeIfNeeded(hiddenWin) {
    if (!IS_MAC || isQuitting) return;
    const hasVisible = [...this.instances.values()].some(
      i => i.window && !i.window.isDestroyed() && i.window.isVisible() && i.window !== hiddenWin
    );
    if (!hasVisible && (!this._homeWindow || this._homeWindow.isDestroyed())) {
      this._createHomeWindow();
    }
  }
}

// ── Desktop Splash Page ──────────────────────────────────────────────
// The splash page (getWelcomeHtml) lives in packages/desktop/splash.js
// — edit THAT file, not this one. It is ~1,100 lines of self-contained
// inline HTML/CSS/JS with zero dependencies on main.js.
//
// Do NOT confuse it with packages/gui/src/components/layout/welcome-splash.jsx
// — that is the WEB GUI splash page, not the desktop Electron one.
// ─────────────────────────────────────────────────────────────────────

// --- Instance lookup helper ---

function getInstanceForEvent(event) {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || !workspaces) return null;
  for (const inst of workspaces.instances.values()) {
    if (inst.window === win) return inst;
  }
  return null;
}

function broadcastToAllWindows(channel, data) {
  if (!workspaces) return;
  for (const inst of workspaces.instances.values()) {
    if (inst.window && !inst.window.isDestroyed()) {
      inst.window.webContents.send(channel, data);
    }
  }
  if (workspaces._homeWindow && !workspaces._homeWindow.isDestroyed()) {
    workspaces._homeWindow.webContents.send(channel, data);
  }
}

// --- IPC Handlers ---

ipcMain.on('app-quit', () => {
  isQuitting = true;
  app.quit();
});

ipcMain.handle('get-version', () => app.getVersion());
ipcMain.handle('install-update', async () => {
  isQuitting = true;

  if (workspaces) {
    for (const proc of workspaces._daemonProcesses.values()) {
      try { proc.disconnect(); } catch {}
      try { proc.kill('SIGKILL'); } catch {}
    }
    workspaces._daemonProcesses.clear();
  }

  if (IS_MAC) {
    const downloadedFile = autoUpdater.downloadedUpdateHelper?.file;
    if (!downloadedFile || !existsSync(downloadedFile)) {
      console.error('[updater] Downloaded file not found, falling back');
      autoUpdater.quitAndInstall();
      return;
    }

    try {
      const appBundlePath = resolve(dirname(process.execPath), '..', '..');
      if (!appBundlePath.endsWith('.app')) throw new Error('Cannot resolve .app bundle path');

      const targetVersion = autoUpdater.downloadedUpdateHelper?.versionInfo?.version || 'unknown';
      writeFileSync(join(app.getPath('userData'), 'update-pending.json'), JSON.stringify({ version: targetVersion, at: Date.now() }), { mode: 0o600 });

      const extractDir = join(app.getPath('temp'), `groove-update-${Date.now()}`);
      execFileSync('/usr/bin/ditto', ['-xk', downloadedFile, extractDir], { timeout: 60000 });

      const entries = readdirSync(extractDir);
      const newAppName = entries.find(e => e.endsWith('.app'));
      if (!newAppName) throw new Error('No .app found in update zip');

      const newAppPath = join(extractDir, newAppName);
      const backupPath = appBundlePath + '.bak';

      try { rmSync(backupPath, { recursive: true, force: true }); } catch {}

      renameSync(appBundlePath, backupPath);
      try {
        renameSync(newAppPath, appBundlePath);
      } catch (moveErr) {
        try { renameSync(backupPath, appBundlePath); } catch (rollbackErr) {
          console.error('[updater] Rollback also failed:', rollbackErr.message);
        }
        throw moveErr;
      }

      try { rmSync(backupPath, { recursive: true, force: true }); } catch {}
      try { rmSync(extractDir, { recursive: true, force: true }); } catch {}

      spawn('/bin/sh', ['-c', 'sleep 1 && open "$1"', '--', appBundlePath], {
        detached: true, stdio: 'ignore'
      }).unref();

      app.exit(0);
    } catch (err) {
      console.error('[updater] Manual update failed:', err.message);
      autoUpdater.quitAndInstall();
    }
  } else {
    autoUpdater.quitAndInstall();
  }
});

// Cached update state — survives the race between autoUpdater events and renderer load
let updateState = { available: null, progress: null, downloaded: null };

ipcMain.handle('check-for-update', async () => {
  if (!app.isPackaged) return { updateAvailable: false };
  try {
    const result = await autoUpdater.checkForUpdates();
    return { updateAvailable: !!result?.updateInfo };
  } catch { return { updateAvailable: false }; }
});

ipcMain.handle('get-update-status', () => updateState);

autoUpdater.on('update-available', (info) => {
  updateState.available = { version: info.version };
  broadcastToAllWindows('update-available', { version: info.version });
});
autoUpdater.on('download-progress', (info) => {
  updateState.progress = { percent: Math.round(info.percent) };
  broadcastToAllWindows('update-progress', { percent: Math.round(info.percent) });
});
autoUpdater.on('update-downloaded', (info) => {
  updateState.downloaded = { version: info.version };
  updateState.progress = null;
  broadcastToAllWindows('update-downloaded', { version: info.version });
});
autoUpdater.on('error', (err) => console.error('[auto-updater]', err.message));

ipcMain.handle('get-instance-info', (event) => {
  const inst = getInstanceForEvent(event);
  if (!inst) return null;
  return { id: inst.id, name: inst.name, projectDir: inst.projectDir, port: inst.port };
});

ipcMain.handle('open-folder', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  await workspaces?._openFolderDialog(win);
});

ipcMain.handle('subscription-check', async (event) => {
  await checkSubscription();
  const inst = getInstanceForEvent(event);
  if (!inst) return null;
  try {
    const resp = await fetch(`http://localhost:${inst.port}/api/subscription/status`);
    return await resp.json();
  } catch { return null; }
});

ipcMain.handle('open-external', (_event, url) => {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return;
    const allowed = ['groovedev.ai', 'studio.groovedev.ai', 'github.com', 'checkout.stripe.com', 'billing.stripe.com', 'appleid.apple.com', 'localhost'];
    if (!allowed.some(d => parsed.hostname === d || parsed.hostname.endsWith('.' + d))) return;
    return shell.openExternal(url);
  } catch {
    return;
  }
});

ipcMain.handle('select-folder', async (event, options = {}) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return null;
  let defaultPath = app.getPath('home');
  if (options.defaultPath && typeof options.defaultPath === 'string') {
    const resolved = resolve(options.defaultPath);
    if (!resolved.includes('..')) {
      defaultPath = resolved;
    }
  }
  const result = await dialog.showOpenDialog(win, {
    title: options.title || 'Select Folder',
    defaultPath,
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

ipcMain.handle('set-project-dir', async (event, dir) => {
  if (!dir || typeof dir !== 'string') return { error: 'dir required' };
  const inst = getInstanceForEvent(event);
  if (!inst) return { error: 'no instance' };
  try {
    const res = await fetch(`http://localhost:${inst.port}/api/project-dir`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dir }),
    });
    return await res.json();
  } catch (err) {
    return { error: err.message };
  }
});

// --- Remote window IPC ---

ipcMain.handle('open-remote-window', (_event, port, name) => {
  if (!workspaces || !port || !name) return { error: 'Invalid params' };
  try {
    workspaces.openRemote(Number(port), String(name));
    return { ok: true };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('close-remote-window', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && !win.isDestroyed()) win.close();
});

ipcMain.handle('close-remote-by-port', (_event, port) => {
  if (!workspaces || !port) return;
  const id = `remote-${port}`;
  const inst = workspaces.instances.get(id);
  if (inst?.window && !inst.window.isDestroyed()) inst.window.close();
});

// --- Home window IPC ---

ipcMain.handle('home-get-recents', () => {
  return workspaces?.recentProjects || [];
});

ipcMain.handle('home-open-recent', async (_event, dir) => {
  if (!dir || typeof dir !== 'string') throw new Error('Invalid directory');
  const forbidden = workspaces._rejectIfUnsafe(dir);
  if (forbidden) throw new Error(forbidden);

  const id = workspaces._instanceId(dir);

  if (workspaces.instances.has(id)) {
    const existing = workspaces.instances.get(id);
    if (existing.window && !existing.window.isDestroyed()) {
      existing.window.show();
      existing.window.focus();
      workspaces._closeHomeWindow();
      return { ok: true };
    }
  }

  let port;
  try {
    port = await workspaces._startDaemon(id, dir);
  } catch (err) {
    dialog.showErrorBox('Failed to open project',
      `${err.message}\n\nTry reinstalling Groove from groovedev.ai or rebuild with ./promote-local.sh`);
    return { error: err.message };
  }

  setTimeout(() => workspaces.syncSSHFromDaemon(port), 3000);

  const name = basename(dir);
  const win = workspaces._homeWindow;
  if (!win || win.isDestroyed()) throw new Error('Window was closed');

  win.setTitle(`${name} — Groove`);

  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        shell.openExternal(url);
      }
    } catch {}
    return { action: 'deny' };
  });

  win.webContents.removeAllListeners('console-message');
  win.webContents.removeAllListeners('render-process-gone');
  win.webContents.on('console-message', (event) => {
    const { level, message, lineNumber, sourceId } = event;
    if (level === 'error' || level === 'warning') {
      process.stderr.write(`[renderer:${level}] ${message} (${sourceId}:${lineNumber})\n`);
    }
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    process.stderr.write(`[renderer-gone] ${JSON.stringify(details)}\n`);
  });

  win.removeAllListeners('close');
  win.removeAllListeners('closed');
  win.on('close', (e) => {
    if (IS_MAC && !isQuitting) {
      e.preventDefault();
      win.hide();
      workspaces._showHomeIfNeeded(win);
    }
  });
  win.on('closed', () => {
    const inst = workspaces.instances.get(id);
    if (inst) inst.window = null;
  });
  win.on('focus', () => {
    const now = Date.now();
    if (now - _lastSubCheck < 60_000) return;
    _lastSubCheck = now;
    if (loadStoredToken()) checkSubscription();
  });

  const inst = { id, port, projectDir: dir, name, daemon: workspaces._getDaemon(id), window: win };
  workspaces.instances.set(id, inst);
  workspaces._touchRecent(dir, name);
  workspaces._homeWindow = null;
  workspaces._updateTrayMenu();

  win.webContents.session.setPermissionRequestHandler((wc, permission, callback) => {
    const url = wc.getURL();
    const isLocal = url.startsWith('http://localhost') || url.startsWith('http://127.0.0.1');
    if (isLocal && (permission === 'media' || permission === 'microphone' || permission === 'audio-capture')) {
      callback(true);
      return;
    }
    if (!isLocal) { callback(false); return; }
    callback(true);
  });

  win.webContents.session.setPermissionCheckHandler((wc, permission) => {
    if (!wc) return false;
    const url = wc.getURL();
    const isLocal = url.startsWith('http://localhost') || url.startsWith('http://127.0.0.1');
    if (isLocal && (permission === 'media' || permission === 'microphone' || permission === 'audio-capture')) {
      return true;
    }
    return isLocal;
  });

  win.loadURL(`http://localhost:${port}?instance=${encodeURIComponent(name)}`);
  return { ok: true };
});

ipcMain.handle('home-open-folder', async () => {
  const parentWin = workspaces?._homeWindow && !workspaces._homeWindow.isDestroyed()
    ? workspaces._homeWindow : null;
  const result = await dialog.showOpenDialog(parentWin, {
    properties: ['openDirectory'],
    title: 'Open Project Folder',
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

// --- Home SSH IPC ---

ipcMain.handle('home-get-ssh', () => {
  return workspaces?.sshConnections || [];
});

ipcMain.handle('home-add-ssh', (_event, config) => {
  if (!workspaces || !config?.host || !config?.user) return { error: 'Invalid config' };
  const entry = workspaces.addSSH(config);
  return entry;
});

ipcMain.handle('home-remove-recent', (_event, dir) => {
  workspaces.recentProjects = workspaces.recentProjects.filter(r => r.dir !== dir);
  workspaces._saveRecents();
  return workspaces.recentProjects;
});

ipcMain.handle('home-remove-ssh', (_event, id) => {
  if (!workspaces || !id) return { error: 'Invalid id' };
  workspaces.removeSSH(id);
  return workspaces.sshConnections;
});

ipcMain.handle('home-connect-ssh', async (_event, id) => {
  if (!workspaces || !id) throw new Error('Invalid id');
  const { localPort, name } = await workspaces.connectSSH(id);
  return { ok: true, localPort, name };
});

ipcMain.handle('home-pick-key', async () => {
  const parentWin = workspaces?._homeWindow && !workspaces._homeWindow.isDestroyed()
    ? workspaces._homeWindow : null;
  const result = await dialog.showOpenDialog(parentWin, {
    title: 'Select SSH Key',
    defaultPath: join(app.getPath('home'), '.ssh'),
    properties: ['openFile', 'showHiddenFiles'],
    filters: [{ name: 'All Files', extensions: ['*'] }],
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

ipcMain.handle('home-test-ssh', async (_event, config) => {
  if (!config?.host || !config?.user) return { reachable: false, error: 'Invalid config' };
  const target = `${config.user}@${config.host}`;
  let sshKey = config.sshKeyPath || null;
  if (sshKey) {
    sshKey = sshKey.replace(/^~(?=[/\\]|$)/, app.getPath('home'));
    if (!existsSync(sshKey)) return { reachable: false, error: `SSH key not found: ${sshKey}` };
  }
  const keyArgs = sshKey ? ['-i', sshKey] : [];
  const command = "bash -lc 'S=$(curl -sf http://localhost:31415/api/status 2>/dev/null); if [ -n \"$S\" ]; then echo __GROOVE_RUNNING__; else which groove >/dev/null 2>&1 && echo __GROOVE_INSTALLED__ || echo __GROOVE_NOT_FOUND__; fi'";
  try {
    const result = execFileSync('ssh', [
      ...keyArgs,
      '-p', String(config.port || 22),
      '-o', 'ConnectTimeout=5',
      '-o', 'StrictHostKeyChecking=accept-new',
      '-o', 'BatchMode=yes',
      target,
      command,
    ], { encoding: 'utf8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'] });
    if (result.includes('__GROOVE_RUNNING__')) {
      return { reachable: true, daemonRunning: true, grooveInstalled: true };
    }
    if (result.includes('__GROOVE_INSTALLED__')) {
      return { reachable: true, daemonRunning: false, grooveInstalled: true };
    }
    return { reachable: true, daemonRunning: false, grooveInstalled: false };
  } catch (err) {
    const stderr = err.stderr?.toString() || '';
    if (stderr.includes('Permission denied')) {
      return { reachable: false, error: 'SSH authentication failed' };
    }
    return { reachable: false, error: stderr || 'Connection failed' };
  }
});

ipcMain.handle('home-create-dir', async (_event, parentPath, name) => {
  if (!name || typeof name !== 'string') throw new Error('Name is required');
  if (/[/\\]/.test(name)) throw new Error('Name cannot contain / or \\');
  if (name === '.' || name === '..') throw new Error('Invalid directory name');
  if (name.length > 255) throw new Error('Name too long');
  const fullPath = join(parentPath, name);
  mkdirSync(fullPath, { recursive: true });
  return fullPath;
});

ipcMain.handle('home-get-cached-sub', async () => {
  // Primary source of truth: the daemon's subscription cache, written by the
  // daemon's authenticated poll of the backend. When a project is open we
  // query it live; otherwise we read the last value it wrote to disk.
  //
  // Splash-screen fallback: when no daemon is running and the disk cache is
  // stale/missing, we call the backend directly so a just-returning Pro user
  // isn't mis-classified as community until they open a project.
  const token = loadStoredToken();
  let sub = getCachedSubscription();

  let daemonQueried = false;
  try {
    const instances = workspaces?.getAll() || [];
    const inst = instances.find(i => i.daemon && !i.daemon.killed && i.port);
    if (inst) {
      daemonQueried = true;
      const resp = await fetch(`http://localhost:${inst.port}/api/subscription/status`, {
        signal: AbortSignal.timeout(3_000),
      });
      if (resp.ok) {
        const data = await resp.json();
        sub = {
          plan: data.plan || 'community',
          active: data.active === true || data.status === 'active' || data.status === 'trialing',
          features: data.features || [],
          seats: data.seats || 1,
          validatedAt: Date.now(),
        };
        cacheSubscription(sub);
      }
    }
  } catch {}

  const CACHE_TTL_MS = 60 * 60 * 1000;
  const cacheStale = !sub?.validatedAt || (Date.now() - sub.validatedAt) > CACHE_TTL_MS;
  if (token && !daemonQueried && cacheStale) {
    try {
      const resp = await fetch('https://docs.groovedev.ai/api/v1/subscription/status', {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(5_000),
      });
      if (resp.ok) {
        const data = await resp.json();
        sub = {
          plan: data.plan || 'community',
          active: data.active === true || data.status === 'active' || data.status === 'trialing',
          features: data.features || [],
          seats: data.seats || 1,
          validatedAt: Date.now(),
        };
        cacheSubscription(sub);
      }
    } catch {}
  }

  return {
    authenticated: !!token,
    plan: sub?.plan || 'community',
    active: sub?.active || false,
  };
});

// --- Auth flow ---

app.setAsDefaultProtocolClient('groove');

function tokenPath() {
  return join(app.getPath('userData'), 'auth-token');
}

function storeToken(jwt) {
  if (!safeStorage.isEncryptionAvailable()) {
    console.error('[security] Cannot store token — encryption unavailable');
    return;
  }
  writeFileSync(tokenPath(), safeStorage.encryptString(jwt), { mode: 0o600 });
  if (workspaces) {
    for (const inst of workspaces.instances.values()) {
      if (inst.daemon && inst.daemon.connected) {
        inst.daemon.send({ type: 'auth-token', token: jwt });
      }
    }
  }
}

function loadStoredToken() {
  try {
    if (!safeStorage.isEncryptionAvailable()) {
      console.error('[security] Cannot load token — encryption unavailable');
      return null;
    }
    const buf = readFileSync(tokenPath());
    return safeStorage.decryptString(buf);
  } catch { return null; }
}

function clearStoredToken() {
  try { unlinkSync(tokenPath()); } catch {}
  if (workspaces) {
    for (const inst of workspaces.instances.values()) {
      if (inst.daemon && inst.daemon.connected) {
        inst.daemon.send({ type: 'auth-token', token: null });
      }
    }
  }
}

function cacheSubscription(data) {
  try {
    writeFileSync(
      join(app.getPath('userData'), 'subscription-cache.json'),
      JSON.stringify(data), { mode: 0o600 },
    );
  } catch {}
}

function getCachedSubscription() {
  try {
    return JSON.parse(readFileSync(join(app.getPath('userData'), 'subscription-cache.json'), 'utf8'));
  } catch { return null; }
}

ipcMain.handle('auth-login', () => {
  pendingAuthState = randomBytes(32).toString('hex');
  setTimeout(() => { if (pendingAuthState) pendingAuthState = null; }, 10 * 60 * 1000);
  const url = `${STUDIO_URL}/#/login?return=electron&outer_state=${pendingAuthState}`;
  shell.openExternal(url);
  return { state: pendingAuthState };
});

ipcMain.handle('auth-logout', () => {
  clearStoredToken();
  stopSubscriptionPoll();
  return { ok: true };
});

ipcMain.handle('auth-status', () => {
  const token = loadStoredToken();
  return { authenticated: !!token };
});

ipcMain.handle('integration-oauth-start', async (_event, oauthUrl) => {
  try {
    shell.openExternal(oauthUrl);
    return { ok: true };
  } catch (err) {
    return { error: err.message };
  }
});

function handleAuthCallback(url) {
  try {
    const parsed = new URL(url);
    const token = parsed.searchParams.get('token');
    const state = parsed.searchParams.get('state');
    if (!token || !state) return;
    if (state !== pendingAuthState) {
      console.error('[auth] state mismatch — possible CSRF, rejecting callback');
      return;
    }
    pendingAuthState = null;
    storeToken(token);
    startSubscriptionPoll();
    broadcastToAllWindows('auth-changed', { authenticated: true });
    const instances = workspaces?.getAll() || [];
    const visible = instances.find(i => i.window && !i.window.isDestroyed());
    if (visible) {
      visible.window.show();
      visible.window.focus();
    }
  } catch (err) { console.error('[auth] Callback failed:', err.message); }
}

app.on('open-url', (event, url) => {
  event.preventDefault();
  if (url.startsWith('groove://auth/callback')) {
    handleAuthCallback(url);
  } else if (url.startsWith('groove://activate')) {
    checkSubscription();
  }
});

// --- Subscription polling ---

async function checkSubscription() {
  const instances = workspaces?.getAll() || [];
  const inst = instances.find(i => i.daemon && !i.daemon.killed);
  if (!inst) return;
  try {
    const resp = await fetch(`http://localhost:${inst.port}/api/subscription/status`);
    const data = await resp.json();
    const sub = {
      active: data.active || false,
      plan: data.plan || 'community',
      features: data.features || [],
      seats: data.seats || 1,
    };
    cacheSubscription(sub);
    broadcastToAllWindows('subscription-status', sub);
  } catch {}
}

function startSubscriptionPoll() {
  stopSubscriptionPoll();
  checkSubscription();
  subscriptionTimer = setInterval(checkSubscription, SUBSCRIPTION_POLL_MS);
}

function stopSubscriptionPoll() {
  if (subscriptionTimer) {
    clearInterval(subscriptionTimer);
    subscriptionTimer = null;
  }
}

// --- Tray ---

function createTray() {
  const trayIconPath = join(__dirname, 'assets', 'tray-icon.svg');
  const icon = nativeImage.createFromPath(trayIconPath).resize({ width: 22, height: 22 });
  tray = new Tray(icon);
  tray.setToolTip('Groove');
  tray.on('click', () => {
    const instances = workspaces?.getAll() || [];
    const visible = instances.find(i => i.window && !i.window.isDestroyed());
    if (visible) {
      visible.window.show();
      visible.window.focus();
    } else if (workspaces?._homeWindow && !workspaces._homeWindow.isDestroyed()) {
      workspaces._homeWindow.show();
      workspaces._homeWindow.focus();
    }
  });
  workspaces?._updateTrayMenu();
}

// --- App lifecycle ---

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {

app.on('second-instance', () => {
  if (!workspaces) return;
  const instances = workspaces.getAll();
  const visible = instances.find(i => i.window && !i.window.isDestroyed() && i.window.isVisible());
  if (visible) {
    if (visible.window.isMinimized()) visible.window.restore();
    visible.window.show();
    visible.window.focus();
  } else if (workspaces._homeWindow && !workspaces._homeWindow.isDestroyed()) {
    if (workspaces._homeWindow.isMinimized()) workspaces._homeWindow.restore();
    workspaces._homeWindow.show();
    workspaces._homeWindow.focus();
  } else {
    workspaces._createHomeWindow();
  }
});

app.whenReady().then(async () => {
  workspaces = new WorkspaceManager();
  createTray();
  const stored = loadStoredToken();
  if (stored) {
    storeToken(stored);
    startSubscriptionPoll();
  }
  workspaces._createHomeWindow();

  // Auto-updater setup — skip in dev mode
  if (app.isPackaged) {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = { info: (...a) => console.log('[updater]', ...a), warn: (...a) => console.warn('[updater]', ...a), error: (...a) => console.error('[updater]', ...a) };

    let skipAutoCheck = false;
    try {
      const marker = JSON.parse(readFileSync(join(app.getPath('userData'), 'update-pending.json'), 'utf8'));
      unlinkSync(join(app.getPath('userData'), 'update-pending.json'));
      if (marker.version !== app.getVersion()) {
        console.error('[updater] Update to ' + marker.version + ' failed, still on ' + app.getVersion());
        skipAutoCheck = true;
      }
    } catch {}

    if (!skipAutoCheck) {
      autoUpdater.checkForUpdates().catch(() => {});
    }
    setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 4 * 60 * 60 * 1000);
  }
});

app.on('activate', () => {
  const instances = workspaces?.getAll() || [];
  const visible = instances.find(i => i.window && !i.window.isDestroyed());
  if (visible) {
    visible.window.show();
    visible.window.focus();
  } else if (workspaces?._homeWindow && !workspaces._homeWindow.isDestroyed()) {
    workspaces._homeWindow.show();
    workspaces._homeWindow.focus();
  } else {
    workspaces?._createHomeWindow();
  }
});

app.on('window-all-closed', () => {
  if (!IS_MAC) {
    isQuitting = true;
    app.quit();
  }
});

app.on('before-quit', async () => {
  isQuitting = true;
  stopSubscriptionPoll();
  if (workspaces) await workspaces.shutdownAll();
});

} // end single-instance lock
