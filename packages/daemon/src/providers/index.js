// GROOVE — Provider Registry
// FSL-1.1-Apache-2.0 — see LICENSE

import { ClaudeCodeProvider } from './claude-code.js';
import { CodexProvider } from './codex.js';
import { GeminiProvider } from './gemini.js';
import { AiderProvider } from './aider.js';
import { OllamaProvider } from './ollama.js';

const providers = {
  'claude-code': new ClaudeCodeProvider(),
  'codex': new CodexProvider(),
  'gemini': new GeminiProvider(),
  'aider': new AiderProvider(),
  'ollama': new OllamaProvider(),
};

export function getProvider(name) {
  return providers[name] || null;
}

export function listProviders() {
  return Object.entries(providers).map(([key, p]) => ({
    id: key,
    name: p.constructor.displayName,
    installed: p.constructor.isInstalled(),
    authType: p.constructor.authType,
    envKey: p.constructor.envKey || null,
    models: p.constructor.models,
    installCommand: p.constructor.installCommand(),
    canHotSwap: p.switchModel ? p.switchModel() : false,
    hardwareRequirements: p.constructor.hardwareRequirements?.() || null,
  }));
}

export function getInstalledProviders() {
  return listProviders().filter((p) => p.installed);
}
