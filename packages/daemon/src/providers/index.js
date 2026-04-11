// GROOVE — Provider Registry
// FSL-1.1-Apache-2.0 — see LICENSE

import { ClaudeCodeProvider } from './claude-code.js';
import { CodexProvider } from './codex.js';
import { GeminiProvider } from './gemini.js';
import { OllamaProvider } from './ollama.js';
import { LocalProvider } from './local.js';

const providers = {
  'claude-code': new ClaudeCodeProvider(),
  'codex': new CodexProvider(),
  'gemini': new GeminiProvider(),
  'ollama': new OllamaProvider(),
  'local': new LocalProvider(),
};

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
      installed: p.constructor.isInstalled(),
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
