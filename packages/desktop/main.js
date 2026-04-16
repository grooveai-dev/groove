// FSL-1.1-Apache-2.0 — see LICENSE
import { app, BrowserWindow, Tray, Menu, shell, nativeImage, dialog, ipcMain, safeStorage } from 'electron';
import pkg from 'electron-updater';
const { autoUpdater } = pkg;
import { createHash, randomBytes } from 'crypto';
import { fork } from 'child_process';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'fs';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const IS_MAC = process.platform === 'darwin';
const STUDIO_URL = 'https://studio.groovedev.ai';
const SUBSCRIPTION_POLL_MS = 5 * 60 * 1000;

// macOS Electron apps launched from Finder inherit a minimal PATH missing user
// shell additions. Resolve the real PATH and API key env vars once at startup
// so forked daemons can find CLI tools and use API keys as fallback.
(function fixElectronEnv() {
  if (!IS_MAC) return;
  const shell = process.env.SHELL || '/bin/zsh';
  const apiKeyVars = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'ELEVENLABS_API_KEY'];
  try {
    const printCmd = ['echo "PATH=$PATH"', ...apiKeyVars.map(v => `echo "${v}=$${v}"`)].join('; ');
    const output = execSync(`${shell} -ilc '${printCmd}'`, { encoding: 'utf8', timeout: 5000 }).trim();
    for (const line of output.split('\n')) {
      const eq = line.indexOf('=');
      if (eq < 1) continue;
      const key = line.slice(0, eq);
      const val = line.slice(eq + 1);
      if (key === 'PATH' && val) { process.env.PATH = val; }
      else if (apiKeyVars.includes(key) && val && !process.env[key]) { process.env[key] = val; }
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
      name: name || projectDir.split('/').pop(),
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
    const name = projectDir.split('/').pop();
    const window = this._createWindow(id, port, projectDir);

    const inst = { id, port, projectDir, name, daemon: this._getDaemon(id), window };
    this.instances.set(id, inst);
    this._touchRecent(projectDir, name);
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

  _startDaemon(id, projectDir) {
    return new Promise((resolve, reject) => {
      const bridgePath = join(__dirname, 'daemon-bridge.js');
      const guiPath = app.isPackaged ? resolveResourcePath('gui') : resolveResourcePath('gui', 'dist');
      const daemonPath = resolveResourcePath('daemon', 'src', 'index.js');

      const proc = fork(bridgePath, ['0', projectDir], {
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
        env: {
          ...process.env,
          GROOVE_EDITION: 'pro',
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
    const name = projectDir.split('/').pop();
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
      if (loadStoredToken()) checkSubscription();
    });

    return win;
  }

  _updateTrayMenu() {
    if (!tray) return;
    const instances = this.getAll();
    const instanceItems = instances.map(inst => ({
      label: inst.name || inst.projectDir.split('/').pop(),
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
        label: r.name || r.dir.split('/').pop(),
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

function getWelcomeHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'">
<title>Groove</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  background: #0a0a0a; color: #fafafa;
  font-family: -apple-system, BlinkMacSystemFont, 'Inter', system-ui, sans-serif;
  height: 100vh; display: flex; overflow: hidden; user-select: none;
}

.shell { display: flex; width: 100%; height: 100%; }

.ab {
  width: 48px; background: #111; border-right: 1px solid #1e1e1e;
  display: flex; flex-direction: column; align-items: center; flex-shrink: 0;
}
.ab-drag { -webkit-app-region: drag; height: 52px; width: 100%; flex-shrink: 0; }
.ab-logo {
  width: 30px; height: 30px; border-radius: 8px;
  background: linear-gradient(135deg, #33afbc, #2a95a1);
  display: flex; align-items: center; justify-content: center;
  margin-bottom: 16px; flex-shrink: 0;
}
.ab-logo span { color: #fff; font-weight: 700; font-size: 14px; }
.ab-nav { display: flex; flex-direction: column; gap: 2px; align-items: center; }
.ab-ic {
  width: 36px; height: 36px; border-radius: 6px;
  display: flex; align-items: center; justify-content: center; color: #3f3f46;
}

.main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.topbar {
  -webkit-app-region: drag; height: 38px; border-bottom: 1px solid #1e1e1e;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.topbar span { font-size: 12px; color: #3f3f46; font-weight: 500; letter-spacing: 0.3px; }

.workspace { flex: 1; position: relative; background: #0e0e0e; }

.overlay {
  position: absolute; inset: 0; background: rgba(0,0,0,0.35);
  display: flex; align-items: center; justify-content: center; padding: 24px;
}

.modal {
  width: 100%; max-width: 440px; background: #141414;
  border: 1px solid #232323; border-radius: 12px;
  display: flex; flex-direction: column; max-height: min(520px, 80vh);
  position: relative; overflow: hidden;
  box-shadow: 0 24px 48px rgba(0,0,0,0.4);
}
.m-head {
  padding: 24px 24px 16px; display: flex; align-items: center; gap: 14px; flex-shrink: 0;
}
.m-icon {
  width: 36px; height: 36px; border-radius: 8px;
  background: rgba(51,175,188,0.1);
  display: flex; align-items: center; justify-content: center;
  color: #33afbc; flex-shrink: 0;
}
.m-title { font-size: 15px; font-weight: 600; letter-spacing: -0.2px; }
.m-sub { font-size: 12px; color: #52525b; margin-top: 1px; }
.m-div { height: 1px; background: #1e1e1e; margin: 0 24px; flex-shrink: 0; }

.error-msg {
  display: none; margin: 12px 16px 0; padding: 10px 14px;
  border-radius: 6px; background: #1c1007; border: 1px solid #854d0e;
  color: #fbbf24; font-size: 12px; flex-shrink: 0;
}
.error-msg.active { display: block; }

.m-body { flex: 1; overflow-y: auto; padding: 12px 8px; min-height: 0; }
.sec-label {
  font-size: 10px; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.5px; color: #52525b; padding: 4px 16px 8px;
}

.recents { display: flex; flex-direction: column; gap: 1px; }
.ri {
  display: flex; align-items: center; gap: 12px; padding: 8px 12px;
  border-radius: 6px; cursor: pointer; transition: background 0.12s;
  -webkit-app-region: no-drag;
}
.ri:hover { background: #1a1a1a; }
.ri:active { background: #222; }
.ri-ic {
  width: 28px; height: 28px; border-radius: 6px; background: #1e1e1e;
  display: flex; align-items: center; justify-content: center;
  color: #52525b; flex-shrink: 0;
}
.ri-info { flex: 1; min-width: 0; }
.ri-name { font-size: 13px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ri-path { font-size: 11px; color: #3f3f46; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 1px; }
.ri-time { font-size: 10px; color: #3f3f46; flex-shrink: 0; }

.empty { padding: 32px 16px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 8px; }
.empty-ic { color: #27272a; }
.empty-text { font-size: 13px; color: #52525b; }
.empty-hint { font-size: 11px; color: #3f3f46; }

.m-foot {
  padding: 12px 16px 16px; border-top: 1px solid #1e1e1e; flex-shrink: 0;
  display: flex; flex-direction: column; gap: 10px; align-items: center;
}
.btn-open {
  display: flex; align-items: center; justify-content: center; gap: 8px;
  width: 100%; padding: 10px; border-radius: 8px;
  border: 1px solid #27272a; background: #18181b;
  color: #fafafa; font-size: 13px; font-weight: 500;
  cursor: pointer; transition: all 0.12s;
  -webkit-app-region: no-drag; font-family: inherit;
}
.btn-open:hover { background: #27272a; border-color: #3f3f46; }
.btn-open:active { background: #333; }
.m-ver { font-size: 10px; color: #27272a; }

.m-loading {
  display: none; position: absolute; inset: 0; background: #141414;
  border-radius: 12px; flex-direction: column; align-items: center;
  justify-content: center; gap: 16px; z-index: 10;
}
.m-loading.active { display: flex; }
.spinner {
  width: 28px; height: 28px; border: 2.5px solid #27272a;
  border-top-color: #33afbc; border-radius: 50%; animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.loading-text { font-size: 13px; color: #71717a; }
</style>
</head>
<body>
<div class="shell">
  <div class="ab">
    <div class="ab-drag"></div>
    <div class="ab-logo"><span>G</span></div>
    <div class="ab-nav">
      <div class="ab-ic"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="12" cy="5" r="3"/><circle cx="5" cy="19" r="3"/><circle cx="19" cy="19" r="3"/><path d="M12 8v4M7.5 17.2 10 12M16.5 17.2 14 12"/></svg></div>
      <div class="ab-ic"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg></div>
      <div class="ab-ic"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/></svg></div>
      <div class="ab-ic"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg></div>
      <div class="ab-ic"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></div>
    </div>
  </div>
  <div class="main">
    <div class="topbar"><span>GROOVE</span></div>
    <div class="workspace">
      <div class="overlay">
        <div class="modal">
          <div class="m-head">
            <div class="m-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
              </svg>
            </div>
            <div>
              <div class="m-title">Connect to Project</div>
              <div class="m-sub">Select a workspace to open</div>
            </div>
          </div>
          <div class="m-div"></div>
          <div class="error-msg" id="error"></div>
          <div class="m-body">
            <div class="sec-label" id="recents-label" style="display:none">Recent Projects</div>
            <div class="recents" id="recents"></div>
          </div>
          <div class="m-foot">
            <button class="btn-open" id="open-folder">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
              </svg>
              Open Folder
            </button>
            <div class="m-ver" id="version"></div>
          </div>
          <div class="m-loading" id="loading">
            <div class="spinner"></div>
            <div class="loading-text" id="loading-text">Starting Groove...</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
<script>
(function() {
  var FOLDER = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
    ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function timeAgo(d) {
    var ms = Date.now() - new Date(d).getTime();
    var m = Math.floor(ms / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + 'm ago';
    var h = Math.floor(m / 60);
    if (h < 24) return h + 'h ago';
    var dy = Math.floor(h / 24);
    if (dy < 30) return dy + 'd ago';
    return Math.floor(dy / 30) + 'mo ago';
  }

  function shortenPath(p) {
    var m = p.match(/^(\\/Users\\/[^/]+|\\/home\\/[^/]+)/);
    return m ? '~' + p.slice(m[0].length) : p;
  }

  function setLoading(on, text) {
    document.getElementById('loading').className = on ? 'm-loading active' : 'm-loading';
    if (text) document.getElementById('loading-text').textContent = text;
  }

  function showError(msg) {
    var el = document.getElementById('error');
    el.textContent = msg;
    el.className = 'error-msg active';
  }

  function hideError() {
    document.getElementById('error').className = 'error-msg';
  }

  function openProject(dir) {
    setLoading(true, 'Opening ' + dir.split('/').pop() + '...');
    hideError();
    window.groove.home.openRecent(dir).catch(function(err) {
      setLoading(false);
      showError(err.message || 'Failed to open project');
    });
  }

  if (window.groove.platform !== 'darwin') {
    document.querySelector('.ab-drag').style.height = '12px';
  }

  document.getElementById('open-folder').addEventListener('click', function() {
    hideError();
    window.groove.home.openFolder().then(function(dir) {
      if (dir) openProject(dir);
    }).catch(function(err) {
      showError(err.message || 'Failed to open folder');
    });
  });

  window.groove.getVersion().then(function(v) {
    document.getElementById('version').textContent = 'v' + v;
  }).catch(function() {});

  window.groove.home.getRecents().then(function(recents) {
    var c = document.getElementById('recents');
    var l = document.getElementById('recents-label');
    if (!recents || !recents.length) {
      c.innerHTML = '<div class="empty">' +
        '<div class="empty-ic"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></div>' +
        '<div class="empty-text">No recent projects</div>' +
        '<div class="empty-hint">Open a folder to get started</div>' +
      '</div>';
      return;
    }
    l.style.display = '';
    c.innerHTML = recents.map(function(r) {
      return '<div class="ri" data-dir="' + esc(r.dir) + '">' +
        '<div class="ri-ic">' + FOLDER + '</div>' +
        '<div class="ri-info">' +
          '<div class="ri-name">' + esc(r.name || r.dir.split('/').pop()) + '</div>' +
          '<div class="ri-path">' + esc(shortenPath(r.dir)) + '</div>' +
        '</div>' +
        '<div class="ri-time">' + (r.lastOpened ? timeAgo(r.lastOpened) : '') + '</div>' +
      '</div>';
    }).join('');
    c.querySelectorAll('.ri').forEach(function(el) {
      el.addEventListener('click', function() {
        openProject(el.getAttribute('data-dir'));
      });
    });
  }).catch(function(err) {
    showError('Failed to load recent projects: ' + err.message);
  });
})();
</script>
</body>
</html>`;
}

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
}

// --- IPC Handlers ---

ipcMain.on('app-quit', () => {
  isQuitting = true;
  app.quit();
});

ipcMain.handle('get-version', () => app.getVersion());
ipcMain.handle('install-update', () => { autoUpdater.quitAndInstall(false, true); });

autoUpdater.on('update-available', (info) => broadcastToAllWindows('update-available', { version: info.version }));
autoUpdater.on('update-downloaded', (info) => broadcastToAllWindows('update-downloaded', { version: info.version }));
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

  const name = dir.split('/').pop();
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
  return new Promise((resolve) => {
    const oauthWin = new BrowserWindow({
      width: 800,
      height: 700,
      backgroundColor: '#0a0a0a',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    let resolved = false;

    function handleRedirect(url) {
      if (resolved) return;
      if (!url.includes('localhost:31415/api/integrations/oauth/callback')) return;
      resolved = true;
      oauthWin.webContents.stop();
      const parsed = new URL(url);
      const code = parsed.searchParams.get('code');
      const state = parsed.searchParams.get('state');
      const instances = workspaces?.getAll() || [];
      const inst = instances.find(i => i.port);
      const actualPort = inst ? inst.port : 31415;
      fetch(`http://localhost:${actualPort}/api/integrations/oauth/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`)
        .then(res => res.json())
        .then(() => {
          resolve({ ok: true });
        })
        .catch(err => {
          resolve({ error: err.message });
        })
        .finally(() => {
          if (!oauthWin.isDestroyed()) oauthWin.close();
        });
    }

    oauthWin.webContents.on('will-redirect', (_e, url) => handleRedirect(url));
    oauthWin.webContents.on('will-navigate', (_e, url) => handleRedirect(url));

    oauthWin.on('closed', () => {
      if (!resolved) {
        resolved = true;
        resolve({ error: 'cancelled' });
      }
    });

    oauthWin.loadURL(oauthUrl);
  });
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
    broadcastToAllWindows('subscription-status', {
      active: data.active || false,
      plan: data.plan || 'community',
      features: data.features || [],
      seats: data.seats || 1,
    });
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
    autoUpdater.logger = null;
    autoUpdater.checkForUpdates().catch(() => {});
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
