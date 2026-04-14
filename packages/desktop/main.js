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

  async open(projectDir) {
    const forbidden = this._rejectIfUnsafe(projectDir);
    if (forbidden) {
      dialog.showErrorBox('Cannot open this folder', forbidden);
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
  const lastProject = workspaces.recentProjects[0]?.dir;
  if (lastProject && !workspaces._rejectIfUnsafe(lastProject)) {
    try { await workspaces.open(lastProject); return; } catch { /* fall through to picker */ }
  }
  await workspaces._openFolderDialog();
});

app.on('activate', () => {
  const instances = workspaces?.getAll() || [];
  const visible = instances.find(i => i.window && !i.window.isDestroyed());
  if (visible) {
    visible.window.show();
    visible.window.focus();
  } else {
    workspaces?._openFolderDialog();
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
