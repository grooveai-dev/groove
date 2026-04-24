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
    getSSH: () => ipcRenderer.invoke('home-get-ssh'),
    connectSSH: (id) => ipcRenderer.invoke('home-connect-ssh', id),
    addSSH: (config) => ipcRenderer.invoke('home-add-ssh', config),
    removeSSH: (id) => ipcRenderer.invoke('home-remove-ssh', id),
    removeRecent: (dir) => ipcRenderer.invoke('home-remove-recent', dir),
    pickKeyFile: () => ipcRenderer.invoke('home-pick-key'),
    getCachedSub: () => ipcRenderer.invoke('home-get-cached-sub'),
  },
  remote: {
    openWindow: (port, name) => ipcRenderer.invoke('open-remote-window', port, name),
    close: () => ipcRenderer.invoke('close-remote-window'),
    closeByPort: (port) => ipcRenderer.invoke('close-remote-by-port', port),
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
    checkForUpdate: () => ipcRenderer.invoke('check-for-update'),
    onUpdateAvailable: (cb) => {
      const h = (_e, d) => cb(d);
      ipcRenderer.on('update-available', h);
      return () => ipcRenderer.removeListener('update-available', h);
    },
    onUpdateProgress: (cb) => {
      const h = (_e, d) => cb(d);
      ipcRenderer.on('update-progress', h);
      return () => ipcRenderer.removeListener('update-progress', h);
    },
    onUpdateDownloaded: (cb) => {
      const h = (_e, d) => cb(d);
      ipcRenderer.on('update-downloaded', h);
      return () => ipcRenderer.removeListener('update-downloaded', h);
    },
  },
});
