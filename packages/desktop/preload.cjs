// FSL-1.1-Apache-2.0 — see LICENSE
// NOTE: preload must use CommonJS — Electron requirement
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('groove', {
  platform: process.platform,
  getVersion: () => ipcRenderer.invoke('get-version'),
  getInstanceInfo: () => ipcRenderer.invoke('get-instance-info'),
  openFolder: () => ipcRenderer.invoke('open-folder'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  quit: () => ipcRenderer.send('app-quit'),
  folders: {
    select: (options) => ipcRenderer.invoke('select-folder', options),
    setProjectDir: (dir) => ipcRenderer.invoke('set-project-dir', dir),
  },
  home: {
    getRecents: () => ipcRenderer.invoke('home-get-recents'),
    openRecent: (dir) => ipcRenderer.invoke('home-open-recent', dir),
    openFolder: () => ipcRenderer.invoke('home-open-folder'),
  },
  auth: {
    login: () => ipcRenderer.invoke('auth-login'),
    logout: () => ipcRenderer.invoke('auth-logout'),
    status: () => ipcRenderer.invoke('auth-status'),
    onChanged: (cb) => {
      const handler = (_e, data) => cb(data);
      ipcRenderer.on('auth-changed', handler);
      return () => ipcRenderer.removeListener('auth-changed', handler);
    },
    onSubscriptionStatus: (cb) => {
      const handler = (_e, data) => cb(data);
      ipcRenderer.on('subscription-status', handler);
      return () => ipcRenderer.removeListener('subscription-status', handler);
    },
  },
  onDaemonCrashed: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('daemon-crashed', handler);
    return () => ipcRenderer.removeListener('daemon-crashed', handler);
  },
  integrations: {
    oauthStart: (url) => ipcRenderer.invoke('integration-oauth-start', url),
  },
  subscription: {
    check: () => ipcRenderer.invoke('subscription-check'),
  },
  update: {
    installUpdate: () => ipcRenderer.invoke('install-update'),
    onUpdateAvailable: (cb) => {
      const h = (_e, d) => cb(d);
      ipcRenderer.on('update-available', h);
      return () => ipcRenderer.removeListener('update-available', h);
    },
    onUpdateDownloaded: (cb) => {
      const h = (_e, d) => cb(d);
      ipcRenderer.on('update-downloaded', h);
      return () => ipcRenderer.removeListener('update-downloaded', h);
    },
  },
});
