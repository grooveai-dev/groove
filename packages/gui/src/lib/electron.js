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

export const electronAuth = {
  login: () => window.groove?.auth?.login(),
  logout: () => window.groove?.auth?.logout(),
  status: () => window.groove?.auth?.status(),
  onChanged: (cb) => window.groove?.auth?.onChanged(cb),
  onSubscriptionStatus: (cb) => window.groove?.auth?.onSubscriptionStatus(cb),
};
