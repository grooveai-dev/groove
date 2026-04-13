// FSL-1.1-Apache-2.0 — see LICENSE
// NOTE: preload must use CommonJS — Electron requirement
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('groove', {
  platform: process.platform,
  getVersion: () => ipcRenderer.invoke('get-version'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  quit: () => ipcRenderer.send('app-quit'),
  auth: {
    login: () => ipcRenderer.invoke('auth-login'),
    logout: () => ipcRenderer.invoke('auth-logout'),
    status: () => ipcRenderer.invoke('auth-status'),
    onChanged: (cb) => {
      ipcRenderer.on('auth-changed', (_e, data) => cb(data));
    },
    onSubscriptionStatus: (cb) => {
      ipcRenderer.on('subscription-status', (_e, data) => cb(data));
    },
  },
});
