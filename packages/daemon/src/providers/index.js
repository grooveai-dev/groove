// GROOVE — Provider Registry
// FSL-1.1-Apache-2.0 — see LICENSE

import { execSync } from 'child_process';
import { dirname as pathDirname } from 'path';
import { ClaudeCodeProvider } from './claude-code.js';
import { CodexProvider } from './codex.js';
import { GeminiProvider } from './gemini.js';
import { OllamaProvider } from './ollama.js';
import { LocalProvider } from './local.js';
import { GrooveNetworkProvider } from './groove-network.js';

// Electron forks may not inherit the full shell PATH, causing `which` to miss
// globally-installed CLI tools. Augment PATH with common npm global bin dirs.
// Custom provider paths from config are prepended when setProviderPaths() is called.
let _providerPaths = {};

export function setProviderPaths(paths) {
  _providerPaths = paths || {};
  _augmentPathWithCustomPaths();
}

function _augmentPathWithCustomPaths() {
  const cur = process.env.PATH || '';
  const dirs = [];
  for (const p of Object.values(_providerPaths)) {
    if (p && typeof p === 'string') {
      const dir = pathDirname(p);
      if (dir && !cur.split(':').includes(dir)) dirs.push(dir);
    }
  }
  if (dirs.length) process.env.PATH = [...dirs, cur].join(':');
}

export function getProviderPath(id) {
  return (_providerPaths && _providerPaths[id]) || null;
}

(function augmentPath() {
  const extra = ['/usr/local/bin', '/opt/homebrew/bin'];
  try {
    const npmPrefix = execSync('npm config get prefix 2>/dev/null', { encoding: 'utf8', timeout: 5000 }).trim();
    const npmGlobal = npmPrefix ? `${npmPrefix}/bin` : '';
    if (npmGlobal) extra.push(npmGlobal);
  } catch { /* npm itself may not be in PATH yet */ }
  const home = process.env.HOME || '';
  if (home) extra.push(`${home}/.npm-global/bin`);
  const cur = process.env.PATH || '';
  const toAdd = extra.filter(p => p && !cur.split(':').includes(p));
  if (toAdd.length) process.env.PATH = [...toAdd, cur].join(':');
})();

const providers = {
  'claude-code': new ClaudeCodeProvider(),
  'codex': new CodexProvider(),
  'gemini': new GeminiProvider(),
  'ollama': new OllamaProvider(),
  'local': new LocalProvider(),
  'groove-network': new GrooveNetworkProvider(),
};

const installCache = new Map();

export function isProviderInstalled(providerId) {
  if (installCache.has(providerId)) return installCache.get(providerId);
  const p = providers[providerId];
  if (!p) return false;
  const result = p.constructor.isInstalled();
  installCache.set(providerId, result);
  return result;
}

export function clearInstallCache() {
  installCache.clear();
}

export function getProvider(name) {
  return providers[name] || null;
}

// Providers hidden from UI but kept for backward compatibility
// (existing agents with provider='ollama' still resolve via getProvider)
const HIDDEN_PROVIDERS = new Set(['ollama']);

export function listProviders() {
  return Object.entries(providers)
    .filter(([key]) => !HIDDEN_PROVIDERS.has(key))
    .map(([key, p]) => ({
      id: key,
      name: p.constructor.displayName,
      installed: isProviderInstalled(key),
      authType: p.constructor.authType,
      envKey: p.constructor.envKey || null,
      authHint: p.constructor.authHint || null,
      authStatus: p.constructor.isAuthenticated?.() || null,
      models: p.constructor.models,
      installCommand: p.constructor.installCommand(),
      canHotSwap: p.switchModel ? p.switchModel() : false,
      hardwareRequirements: p.constructor.hardwareRequirements?.() || null,
    }));
}

export function getInstalledProviders() {
  return listProviders().filter((p) => p.installed);
}

export function getProviderMetadata(id) {
  const p = providers[id];
  if (!p) return null;
  return {
    id,
    setupGuide: p.constructor.setupGuide?.() || { installSteps: [], authMethods: [], authInstructions: {} },
    authMethods: p.constructor.authMethods?.() || [],
    installCommand: p.constructor.installCommand(),
  };
}
