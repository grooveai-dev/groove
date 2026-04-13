// FSL-1.1-Apache-2.0 — see LICENSE
// NOTE: preload must use CommonJS — Electron requirement
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('groove', {
  platform: process.platform,
  getVersion: () => ipcRenderer.invoke('get-version'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  quit: () => ipcRenderer.send('app-quit'),
});
