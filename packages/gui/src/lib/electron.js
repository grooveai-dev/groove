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

export async function selectFolder(options = {}) {
  if (window.groove?.folders?.select) {
    return window.groove.folders.select(options);
  }
  return null;
}

export async function setProjectDir(dir) {
  if (window.groove?.folders?.setProjectDir) {
    return window.groove.folders.setProjectDir(dir);
  }
  const { api } = await import('./api.js');
  return api.post('/project-dir', { dir });
}

export async function integrationOAuth(url) {
  if (window.groove?.integrations?.oauthStart) {
    return window.groove.integrations.oauthStart(url);
  }
  window.open(url, '_blank', 'noopener');
}

export const electronAuth = {
  login: () => window.groove?.auth?.login(),
  logout: () => window.groove?.auth?.logout(),
  status: () => window.groove?.auth?.status(),
  onChanged: (cb) => window.groove?.auth?.onChanged(cb),
  onSubscriptionStatus: (cb) => window.groove?.auth?.onSubscriptionStatus(cb),
};
