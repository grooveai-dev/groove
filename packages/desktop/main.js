// FSL-1.1-Apache-2.0 — see LICENSE
import { app, BrowserWindow, Tray, Menu, shell, nativeImage, dialog, ipcMain, safeStorage } from 'electron';
import { createHash, randomBytes } from 'crypto';
import { fork } from 'child_process';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { writeFileSync, readFileSync, unlinkSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const IS_MAC = process.platform === 'darwin';
const STUDIO_URL = 'https://studio.groovedev.ai';
const SUBSCRIPTION_POLL_MS = 5 * 60 * 1000;

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

    const port = await this._startDaemon(id, projectDir);
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
      width: 540,
      height: 600,
      minWidth: 400,
      minHeight: 400,
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
  font-family: system-ui, -apple-system, sans-serif;
  height: 100vh; display: flex; flex-direction: column;
  overflow: hidden; user-select: none;
}
.titlebar { -webkit-app-region: drag; height: 38px; flex-shrink: 0; }
.container {
  flex: 1; display: flex; flex-direction: column;
  align-items: center; padding: 0 40px 24px; overflow-y: auto;
}
.brand { display: flex; flex-direction: column; align-items: center; gap: 4px; margin-bottom: 32px; }
.brand h1 { font-size: 28px; font-weight: 700; letter-spacing: -0.5px; }
.brand p { font-size: 13px; color: #71717a; }
.section-label {
  font-size: 11px; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.5px; color: #71717a; width: 100%; max-width: 420px; margin-bottom: 8px;
}
.recents { width: 100%; max-width: 420px; display: flex; flex-direction: column; gap: 2px; margin-bottom: 16px; }
.recent-item {
  display: flex; align-items: center; gap: 12px; padding: 10px 14px;
  border-radius: 8px; cursor: pointer; transition: background 0.15s;
  -webkit-app-region: no-drag;
}
.recent-item:hover { background: #18181b; }
.recent-item:active { background: #27272a; }
.recent-icon {
  width: 32px; height: 32px; border-radius: 6px; background: #27272a;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.recent-icon svg { color: #71717a; }
.recent-info { flex: 1; min-width: 0; }
.recent-name { font-size: 13px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.recent-path { font-size: 11px; color: #52525b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.recent-time { font-size: 10px; color: #3f3f46; flex-shrink: 0; }
.actions { width: 100%; max-width: 420px; display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
.btn {
  display: flex; align-items: center; justify-content: center; gap: 8px;
  padding: 10px 20px; border-radius: 8px; border: 1px solid #27272a;
  background: #18181b; color: #fafafa; font-size: 13px; font-weight: 500;
  cursor: pointer; transition: all 0.15s; -webkit-app-region: no-drag;
}
.btn:hover { background: #27272a; border-color: #3f3f46; }
.btn:active { background: #3f3f46; }
.loading { display: none; flex-direction: column; align-items: center; gap: 12px; padding: 20px; }
.loading.active { display: flex; }
.spinner {
  width: 24px; height: 24px; border: 2px solid #27272a;
  border-top-color: #33afbc; border-radius: 50%; animation: spin .8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.loading-text { font-size: 13px; color: #71717a; }
.error-msg {
  display: none; width: 100%; max-width: 420px; padding: 12px 16px;
  border-radius: 8px; background: #1c1007; border: 1px solid #854d0e;
  color: #fbbf24; font-size: 12px; margin-bottom: 12px;
}
.error-msg.active { display: block; }
.empty { padding: 24px; text-align: center; color: #52525b; font-size: 13px; }
.version { margin-top: auto; padding-top: 16px; font-size: 11px; color: #3f3f46; }
</style>
</head>
<body>
<div class="titlebar"></div>
<div class="container">
  <div class="brand"><h1>Groove</h1><p>Agent Orchestration Layer</p></div>
  <div class="section-label" id="recents-label" style="display:none">Recent Projects</div>
  <div class="recents" id="recents"></div>
  <div class="error-msg" id="error"></div>
  <div class="loading" id="loading">
    <div class="spinner"></div>
    <div class="loading-text" id="loading-text">Starting daemon...</div>
  </div>
  <div class="actions" id="actions">
    <button class="btn" id="open-folder">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
      </svg>
      Open Project Folder
    </button>
  </div>
  <div class="version" id="version"></div>
</div>
<script>
(function() {
  var FOLDER = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
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
    document.getElementById('loading').className = on ? 'loading active' : 'loading';
    document.getElementById('actions').style.display = on ? 'none' : '';
    document.getElementById('recents').style.pointerEvents = on ? 'none' : '';
    document.getElementById('recents').style.opacity = on ? '0.5' : '';
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
    document.querySelector('.titlebar').style.display = 'none';
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
      c.innerHTML = '<div class="empty">No recent projects. Open a folder to get started.</div>';
      return;
    }
    l.style.display = '';
    c.innerHTML = recents.map(function(r) {
      return '<div class="recent-item" data-dir="' + esc(r.dir) + '">' +
        '<div class="recent-icon">' + FOLDER + '</div>' +
        '<div class="recent-info">' +
          '<div class="recent-name">' + esc(r.name || r.dir.split('/').pop()) + '</div>' +
          '<div class="recent-path">' + esc(shortenPath(r.dir)) + '</div>' +
        '</div>' +
        '<div class="recent-time">' + (r.lastOpened ? timeAgo(r.lastOpened) : '') + '</div>' +
      '</div>';
    }).join('');
    c.querySelectorAll('.recent-item').forEach(function(el) {
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
    const allowed = ['groovedev.ai', 'studio.groovedev.ai', 'github.com', 'checkout.stripe.com', 'billing.stripe.com', 'appleid.apple.com'];
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
  await workspaces.open(dir, { showDialogs: false });
  workspaces._closeHomeWindow();
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

app.whenReady().then(async () => {
  workspaces = new WorkspaceManager();
  createTray();
  const stored = loadStoredToken();
  if (stored) {
    storeToken(stored);
    startSubscriptionPoll();
  }
  workspaces._createHomeWindow();
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
