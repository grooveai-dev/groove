// FSL-1.1-Apache-2.0 — see LICENSE

export function isElectron() {
  return !!(window.groove || navigator.userAgent.includes('Electron'));
}

export function getPlatform() {
  return window.groove?.platform || 'browser';
}

export function openExternal(url) {
  if (window.groove) {
    window.groove.openExternal(url);
  } else {
    window.open(url, '_blank');
  }
}
