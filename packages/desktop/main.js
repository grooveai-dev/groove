// FSL-1.1-Apache-2.0 — see LICENSE
import { app, BrowserWindow, Tray, Menu, shell, nativeImage, dialog, ipcMain, safeStorage } from 'electron';
import { randomBytes } from 'crypto';
import { fork } from 'child_process';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { writeFileSync, readFileSync, unlinkSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 31415;
const IS_MAC = process.platform === 'darwin';
const STUDIO_URL = 'https://studio.groovedev.ai';
const SUBSCRIPTION_POLL_MS = 5 * 60 * 1000;

let mainWindow = null;
let tray = null;
let daemonProcess = null;
let isQuitting = false;
let pendingAuthState = null;
let subscriptionTimer = null;

function resolveResourcePath(...segments) {
  if (app.isPackaged) {
    return join(process.resourcesPath, ...segments);
  }
  return resolve(__dirname, '..', ...segments);
}

function startDaemon() {
  return new Promise((resolve, reject) => {
    const bridgePath = join(__dirname, 'daemon-bridge.js');
    const guiPath = resolveResourcePath('gui');
    const daemonPath = resolveResourcePath('daemon', 'src', 'index.js');

    daemonProcess = fork(bridgePath, [String(PORT), process.cwd()], {
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      env: {
        ...process.env,
        GROOVE_EDITION: 'pro',
        GROOVE_ELECTRON: '1',
        GROOVE_GUI_PATH: guiPath,
        GROOVE_DAEMON_PATH: daemonPath,
      },
    });

    const timeout = setTimeout(() => {
      reject(new Error('Daemon failed to start within 15 seconds'));
    }, 15000);

    daemonProcess.on('message', (msg) => {
      if (msg.type === 'ready') {
        clearTimeout(timeout);
        resolve(msg.port);
      } else if (msg.type === 'error') {
        clearTimeout(timeout);
        reject(new Error(msg.message));
      }
    });

    daemonProcess.on('exit', (code) => {
      clearTimeout(timeout);
      if (!isQuitting) {
        dialog.showErrorBox(
          'Groove Daemon Crashed',
          `The daemon exited unexpectedly (code ${code}). Please restart Groove.`
        );
        app.quit();
      }
    });

    daemonProcess.stderr.on('data', (data) => {
      process.stderr.write(`[daemon] ${data}`);
    });
  });
}

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: IS_MAC ? 'hiddenInset' : 'default',
    backgroundColor: '#0a0a0a',
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.loadURL(`http://localhost:${port}`);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('close', (e) => {
    if (IS_MAC && !isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  const trayIconPath = join(__dirname, 'assets', 'tray-icon.svg');
  const icon = nativeImage.createFromPath(trayIconPath).resize({ width: 22, height: 22 });
  tray = new Tray(icon);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Groove',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setToolTip('Groove');
  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

ipcMain.on('app-quit', () => {
  isQuitting = true;
  app.quit();
});

ipcMain.handle('get-version', () => app.getVersion());

ipcMain.handle('open-external', (_event, url) => {
  if (typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://'))) {
    return shell.openExternal(url);
  }
});

// --- Auth flow ---

app.setAsDefaultProtocolClient('groove');

function tokenPath() {
  return join(app.getPath('userData'), 'auth-token');
}

function storeToken(jwt) {
  if (safeStorage.isEncryptionAvailable()) {
    writeFileSync(tokenPath(), safeStorage.encryptString(jwt), { mode: 0o600 });
  }
  if (daemonProcess && daemonProcess.connected) {
    daemonProcess.send({ type: 'auth-token', token: jwt });
  }
}

function loadStoredToken() {
  try {
    const buf = readFileSync(tokenPath());
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(buf);
    }
  } catch { /* no stored token */ }
  return null;
}

function clearStoredToken() {
  try { unlinkSync(tokenPath()); } catch { /* already gone */ }
  if (daemonProcess && daemonProcess.connected) {
    daemonProcess.send({ type: 'auth-token', token: null });
  }
}

ipcMain.handle('auth-login', () => {
  pendingAuthState = randomBytes(32).toString('hex');
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
    if (mainWindow) {
      mainWindow.webContents.send('auth-changed', { authenticated: true });
      mainWindow.show();
      mainWindow.focus();
    }
  } catch { /* invalid URL */ }
}

app.on('open-url', (event, url) => {
  event.preventDefault();
  if (url.startsWith('groove://auth/callback')) {
    handleAuthCallback(url);
  }
});

// --- Subscription polling ---

async function checkSubscription() {
  try {
    const resp = await fetch(`http://localhost:${PORT}/api/auth/validate`, { method: 'POST' });
    const data = await resp.json();
    if (!data.authenticated) {
      if (mainWindow) {
        mainWindow.webContents.send('subscription-status', { active: false });
      }
    }
  } catch { /* daemon unreachable, skip */ }
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

app.whenReady().then(async () => {
  try {
    const port = await startDaemon();
    createWindow(port);
    createTray();
    const stored = loadStoredToken();
    if (stored) {
      storeToken(stored);
      startSubscriptionPoll();
    }
  } catch (err) {
    dialog.showErrorBox('Groove Failed to Start', err.message);
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
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
  if (daemonProcess && !daemonProcess.killed) {
    daemonProcess.kill('SIGTERM');
    await new Promise((resolve) => {
      const forceKill = setTimeout(() => {
        if (daemonProcess && !daemonProcess.killed) {
          daemonProcess.kill('SIGKILL');
        }
        resolve();
      }, 2000);
      daemonProcess.on('exit', () => {
        clearTimeout(forceKill);
        resolve();
      });
    });
  }
});
