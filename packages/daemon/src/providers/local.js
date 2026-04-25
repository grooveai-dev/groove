// GROOVE — Local Model Provider (Agent Loop Runtime)
// FSL-1.1-Apache-2.0 — see LICENSE
//
// Manages local inference backends (Ollama API, llama-server, any OpenAI-compatible endpoint).
// Unlike CLI providers (Claude Code, Codex, Gemini), this provider uses GROOVE's built-in
// agent loop instead of spawning a child process. Set via `useAgentLoop = true`.

import { execSync } from 'child_process';
import { Provider } from './base.js';
import { OllamaProvider } from './ollama.js';

// Context window sizes for models commonly run locally
// These are the *effective* context sizes used by default (not theoretical max)
const CONTEXT_WINDOWS = {
  // Qwen 2.5 Coder family — 32K default (can extend to 128K with YaRN)
  'qwen2.5-coder:7b': 32768,
  'qwen2.5-coder:14b': 32768,
  'qwen2.5-coder:32b': 32768,
  'qwen3-coder-next': 32768,
  // DeepSeek family — large native context
  'deepseek-r1:7b': 65536,
  'deepseek-r1:14b': 65536,
  'deepseek-r1:32b': 65536,
  'deepseek-coder-v2:16b': 65536,
  // Llama 3.1 — 128K context
  'llama3.1:8b': 131072,
  'llama3.1:70b': 131072,
  // Mistral family
  'mistral:7b': 32768,
  'mixtral:8x7b': 32768,
  'codestral': 32768,
  'devstral-small-2': 32768,
  // Google
  'gemma4:12b': 32768,
  'gemma4:26b': 32768,
  'codegemma': 8192,
  // Microsoft
  'phi3:mini': 128000,
  'phi3:medium': 128000,
};

const DEFAULT_CONTEXT_WINDOW = 32768;

// Models known to support native tool/function calling via the OpenAI API format
const TOOL_CALLING_MODELS = new Set([
  'qwen2.5-coder', 'qwen3-coder-next',
  'llama3.1', 'llama3.3',
  'mistral', 'mixtral', 'codestral', 'devstral-small-2',
  'gemma4',
  'phi3',
]);

export class LocalProvider extends Provider {
  static name = 'local';
  static displayName = 'Local Models';
  static command = 'ollama';
  static authType = 'local';
  static useAgentLoop = true;

  // Only return models that are actually installed and ready to use
  static get models() {
    const installed = [];

    // Ollama installed models
    if (LocalProvider._hasOllama()) {
      try {
        const ollamaModels = OllamaProvider.getInstalledModels();
        for (const m of ollamaModels) {
          installed.push({
            id: m.id, name: m.name || m.id,
            tier: m.tier || 'medium', category: m.category || 'general',
          });
        }
      } catch { /* Ollama not running */ }
    }

    // If nothing installed, show a hint instead of a blank list
    if (installed.length === 0) {
      return [{ id: '_none', name: 'No models installed — pull one with: ollama pull qwen2.5-coder:7b', tier: 'medium', disabled: true }];
    }

    return installed;
  }

  // Full catalog for the Models browser (includes uninstalled)
  static get catalog() {
    return OllamaProvider.catalog;
  }

  static isInstalled() {
    return LocalProvider._hasOllama() || LocalProvider._hasLlamaServer();
  }

  static _hasOllama() {
    try {
      const cmd = process.platform === 'win32' ? 'where ollama' : 'which ollama';
      execSync(cmd, { stdio: 'ignore' });
      return true;
    } catch { return false; }
  }

  static _hasLlamaServer() {
    try {
      const cmd = process.platform === 'win32' ? 'where llama-server' : 'which llama-server';
      execSync(cmd, { stdio: 'ignore' });
      return true;
    } catch { return false; }
  }

  static installCommand() {
    return OllamaProvider.installCommand();
  }

  static hardwareRequirements() {
    return OllamaProvider.hardwareRequirements();
  }

  static getSystemHardware() {
    return OllamaProvider.getSystemHardware();
  }

  static getInstalledModels() {
    return OllamaProvider.getInstalledModels();
  }

  /**
   * Get configuration for the agent loop runtime.
   * Called by ProcessManager when useAgentLoop is true.
   */
  normalizeConfig(config) {
    if (typeof config.temperature !== 'number' && typeof config.reasoningEffort === 'number') {
      config.temperature = 0.1 + (100 - config.reasoningEffort) * 0.008;
    }
    return config;
  }

  getLoopConfig(agent) {
    const model = agent.model || 'qwen2.5-coder:7b';
    const contextWindow = this.getContextWindow(model);

    // Determine API endpoint
    let apiBase = 'http://localhost:11434/v1'; // Ollama's OpenAI-compatible endpoint (default)

    // Custom endpoint override from agent config or daemon config
    if (agent.apiBase) {
      apiBase = agent.apiBase;
    }

    return {
      apiBase,
      model,
      contextWindow,
      temperature: typeof agent.temperature === 'number' ? agent.temperature : 0.1,
      maxResponseTokens: 4096,
      stream: true,
      headers: {},
      apiKey: agent.apiKey || null,
      introContext: agent.introContext || '',
    };
  }

  getContextWindow(modelId) {
    if (!modelId) return DEFAULT_CONTEXT_WINDOW;
    // Exact match first
    if (CONTEXT_WINDOWS[modelId]) return CONTEXT_WINDOWS[modelId];
    // Prefix match (e.g., 'qwen2.5-coder:7b-q4' matches 'qwen2.5-coder:7b')
    for (const [key, value] of Object.entries(CONTEXT_WINDOWS)) {
      if (modelId.startsWith(key)) return value;
    }
    return DEFAULT_CONTEXT_WINDOW;
  }

  /**
   * Check if a model supports native tool/function calling through the API.
   * Models without native support would need prompt-based tool injection (future).
   */
  supportsToolCalling(modelId) {
    if (!modelId) return false;
    const base = modelId.split(':')[0];
    return TOOL_CALLING_MODELS.has(base);
  }

  // --- Provider interface (backward compat) ---

  buildSpawnCommand(agent) {
    // Not used when useAgentLoop is true, but required by interface
    const model = agent.model || 'qwen2.5-coder:7b';
    return {
      command: 'ollama', args: ['run', model],
      env: { OLLAMA_API_BASE: 'http://localhost:11434' },
      stdin: agent.prompt || undefined,
    };
  }

  buildHeadlessCommand(prompt, model) {
    const m = model || 'qwen2.5-coder:7b';
    return { command: 'ollama', args: ['run', m], env: {}, stdin: prompt };
  }

  switchModel() {
    return false; // Needs rotation for model switch
  }

  streamChat(messages, model, apiKey, onChunk, onDone, onError) {
    const controller = new AbortController();
    let finished = false;
    const finish = () => { if (!finished) { finished = true; onDone(); } };
    fetch('http://localhost:11434/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model || 'qwen2.5-coder:7b',
        messages,
        stream: true,
      }),
      signal: controller.signal,
    }).then(async (res) => {
      if (!res.ok) {
        const t = await res.text();
        throw new Error(`Ollama API ${res.status}: ${t.slice(0, 200)}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const json = JSON.parse(line);
            if (json.done) { finish(); return; }
            if (json.message?.content) onChunk(json.message.content);
          } catch { /* skip malformed */ }
        }
      }
      finish();
    }).catch((err) => {
      if (err.name === 'AbortError') return;
      onError(err);
    });
    return controller;
  }

  parseOutput(line) {
    const trimmed = (line || '').trim();
    if (!trimmed) return null;
    // Try to parse structured log entries from agent loop
    try {
      const entry = JSON.parse(trimmed);
      if (entry.type) return entry;
    } catch { /* plain text */ }
    return { type: 'activity', data: trimmed };
  }
}
