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
  subscription: {
    check: () => ipcRenderer.invoke('subscription-check'),
  },
});
