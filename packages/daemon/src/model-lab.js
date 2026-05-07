// GROOVE — Model Lab
// FSL-1.1-Apache-2.0 — see LICENSE

import { resolve } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import { randomUUID } from 'crypto';

const RUNTIME_TYPES = ['ollama', 'vllm', 'llama-cpp', 'tgi', 'openai-compatible'];
const DEFAULT_OLLAMA_ENDPOINT = 'http://localhost:11434';

export class ModelLab {
  constructor(daemon) {
    this.daemon = daemon;
    this.runtimesPath = resolve(daemon.grooveDir, 'lab-runtimes.json');
    this.presetsPath = resolve(daemon.grooveDir, 'lab-presets.json');
    this.sessionsDir = resolve(daemon.grooveDir, 'lab-sessions');
    this.runtimes = new Map();
    this.presets = new Map();
    this.sessions = new Map();
    this._ensureDirs();
    this._load();
  }

  _ensureDirs() {
    try { mkdirSync(this.sessionsDir, { recursive: true }); } catch { /* best-effort */ }
  }

  _load() {
    // Load runtimes
    if (existsSync(this.runtimesPath)) {
      try {
        const data = JSON.parse(readFileSync(this.runtimesPath, 'utf8'));
        if (Array.isArray(data)) {
          for (const rt of data) this.runtimes.set(rt.id, rt);
        }
      } catch { /* ignore corrupt file */ }
    }

    // Load presets
    if (existsSync(this.presetsPath)) {
      try {
        const data = JSON.parse(readFileSync(this.presetsPath, 'utf8'));
        if (Array.isArray(data)) {
          for (const p of data) this.presets.set(p.id, p);
        }
      } catch { /* ignore corrupt file */ }
    }

    // Load session index from disk
    try {
      for (const file of readdirSync(this.sessionsDir)) {
        if (!file.endsWith('.json')) continue;
        try {
          const session = JSON.parse(readFileSync(resolve(this.sessionsDir, file), 'utf8'));
          this.sessions.set(session.id, session);
        } catch { /* skip corrupt session */ }
      }
    } catch { /* dir may not exist yet */ }
  }

  _saveRuntimes() {
    writeFileSync(this.runtimesPath, JSON.stringify([...this.runtimes.values()], null, 2));
  }

  _savePresets() {
    writeFileSync(this.presetsPath, JSON.stringify([...this.presets.values()], null, 2));
  }

  _saveSession(session) {
    writeFileSync(
      resolve(this.sessionsDir, `${session.id}.json`),
      JSON.stringify(session, null, 2)
    );
  }

  // ─── Runtimes ───────────────────────────────────────────────

  async addRuntime({ name, type, endpoint, apiKey, models }) {
    const id = randomUUID().slice(0, 8);
    const runtime = {
      id,
      name,
      type,
      endpoint: endpoint.replace(/\/+$/, ''),
      apiKey: apiKey || null,
      models: models || [],
      createdAt: new Date().toISOString(),
    };
    this.runtimes.set(id, runtime);
    this._saveRuntimes();
    this.daemon.broadcast({ type: 'lab:runtime:added', data: runtime });
    this.daemon.audit.log('lab.runtime.add', { id, name, runtimeType: type });
    return runtime;
  }

  removeRuntime(id) {
    const rt = this.runtimes.get(id);
    if (!rt) return null;
    this.runtimes.delete(id);
    this._saveRuntimes();
    this.daemon.broadcast({ type: 'lab:runtime:removed', data: { id } });
    this.daemon.audit.log('lab.runtime.remove', { id, name: rt.name });
    return rt;
  }

  getRuntime(id) {
    return this.runtimes.get(id) || null;
  }

  listRuntimes() {
    return [...this.runtimes.values()];
  }

  async testRuntime(id) {
    const rt = this.runtimes.get(id);
    if (!rt) throw new Error('Runtime not found');

    const start = Date.now();
    const models = await this._discoverModels(rt);
    const latency = Date.now() - start;

    rt.models = models;
    rt.lastTested = new Date().toISOString();
    this._saveRuntimes();

    return { ok: true, latency, models };
  }

  async discoverModels(id) {
    const rt = this.runtimes.get(id);
    if (!rt) throw new Error('Runtime not found');
    const models = await this._discoverModels(rt);
    rt.models = models;
    this._saveRuntimes();
    return models;
  }

  async _discoverModels(rt) {
    if (rt.type === 'ollama') {
      return this._discoverOllamaModels(rt.endpoint);
    }
    return this._discoverOpenAIModels(rt.endpoint, rt.apiKey);
  }

  async _discoverOllamaModels(endpoint) {
    const resp = await fetch(`${endpoint}/api/tags`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) throw new Error(`Ollama /api/tags returned ${resp.status}`);
    const data = await resp.json();
    return (data.models || []).map((m) => ({
      id: m.name || m.model,
      name: m.name || m.model,
      size: m.size || null,
      modified: m.modified_at || null,
    }));
  }

  async _discoverOpenAIModels(endpoint, apiKey) {
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
    const resp = await fetch(`${endpoint}/v1/models`, {
      headers,
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) throw new Error(`/v1/models returned ${resp.status}`);
    const data = await resp.json();
    return (data.data || []).map((m) => ({
      id: m.id,
      name: m.id,
      owned_by: m.owned_by || null,
    }));
  }

  async getRuntimeStatus(rt) {
    try {
      const start = Date.now();
      if (rt.type === 'ollama') {
        const resp = await fetch(`${rt.endpoint}/api/tags`, {
          signal: AbortSignal.timeout(5000),
        });
        return { online: resp.ok, latency: Date.now() - start };
      }
      const headers = {};
      if (rt.apiKey) headers['Authorization'] = `Bearer ${rt.apiKey}`;
      const resp = await fetch(`${rt.endpoint}/v1/models`, {
        headers,
        signal: AbortSignal.timeout(5000),
      });
      return { online: resp.ok, latency: Date.now() - start };
    } catch {
      return { online: false, latency: null };
    }
  }

  async getOllamaMemoryUsage(endpoint) {
    try {
      const resp = await fetch(`${endpoint}/api/ps`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!resp.ok) return null;
      const data = await resp.json();
      return data.models || [];
    } catch {
      return null;
    }
  }

  // ─── Inference ──────────────────────────────────────────────

  async *streamInference({ runtimeId, model, messages, parameters, sessionId }) {
    const rt = this.runtimes.get(runtimeId);
    if (!rt) throw new Error('Runtime not found');
    if (!model) throw new Error('Model is required');
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error('Messages array is required');
    }

    // Build request body — all runtimes use OpenAI-compatible format
    const body = {
      model,
      messages,
      stream: true,
      ...this._buildParameterBody(parameters || {}),
    };

    const endpoint = rt.type === 'ollama'
      ? `${rt.endpoint}/v1/chat/completions`
      : `${rt.endpoint}/v1/chat/completions`;

    const headers = { 'Content-Type': 'application/json' };
    if (rt.apiKey) headers['Authorization'] = `Bearer ${rt.apiKey}`;

    const requestStart = Date.now();
    let ttft = null;
    let completionTokens = 0;
    let promptTokens = 0;
    let totalTokens = 0;
    let generationStart = null;
    let fullContent = '';

    const resp = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(300000),
    });

    if (!resp.ok) {
      let errorMsg;
      try { errorMsg = (await resp.json()).error?.message || `HTTP ${resp.status}`; } catch { errorMsg = `HTTP ${resp.status}`; }
      throw new Error(errorMsg);
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const payload = trimmed.slice(6);
          if (payload === '[DONE]') continue;

          try {
            const chunk = JSON.parse(payload);
            const delta = chunk.choices?.[0]?.delta;
            if (delta?.reasoning_content) {
              if (ttft === null) {
                ttft = Date.now() - requestStart;
                generationStart = Date.now();
              }
              completionTokens++;
              yield { type: 'reasoning', content: delta.reasoning_content };
            }
            if (delta?.content) {
              if (ttft === null) {
                ttft = Date.now() - requestStart;
                generationStart = Date.now();
              }
              fullContent += delta.content;
              completionTokens++;
              yield { type: 'token', content: delta.content };
            }
            // Capture usage from final chunk if provided
            if (chunk.usage) {
              promptTokens = chunk.usage.prompt_tokens || 0;
              totalTokens = chunk.usage.total_tokens || 0;
              if (chunk.usage.completion_tokens) {
                completionTokens = chunk.usage.completion_tokens;
              }
            }
          } catch { /* skip malformed chunk */ }
        }
      }
    } finally {
      reader.releaseLock();
    }

    const generationTime = generationStart ? Date.now() - generationStart : Date.now() - requestStart;
    const tokensPerSec = generationTime > 0 ? (completionTokens / (generationTime / 1000)) : 0;

    // Ollama memory usage
    let memoryUsage = null;
    if (rt.type === 'ollama') {
      memoryUsage = await this.getOllamaMemoryUsage(rt.endpoint);
    }

    // Persist to session if sessionId provided
    if (sessionId) {
      this._appendToSession(sessionId, messages, {
        role: 'assistant',
        content: fullContent,
      });
    }

    yield {
      type: 'done',
      metrics: {
        ttft,
        tokensPerSec: Math.round(tokensPerSec * 100) / 100,
        totalTokens: totalTokens || (promptTokens + completionTokens),
        promptTokens,
        completionTokens,
        generationTime,
        memoryUsage,
      },
    };
  }

  _buildParameterBody(params) {
    const body = {};
    if (params.temperature !== undefined) body.temperature = params.temperature;
    if (params.top_p !== undefined) body.top_p = params.top_p;
    if (params.top_k !== undefined) body.top_k = params.top_k;
    if (params.repeat_penalty !== undefined) body.repeat_penalty = params.repeat_penalty;
    if (params.max_tokens !== undefined) body.max_tokens = params.max_tokens;
    if (params.stop !== undefined) body.stop = params.stop;
    if (params.frequency_penalty !== undefined) body.frequency_penalty = params.frequency_penalty;
    if (params.presence_penalty !== undefined) body.presence_penalty = params.presence_penalty;
    return body;
  }

  // ─── Presets ────────────────────────────────────────────────

  listPresets() {
    return [...this.presets.values()];
  }

  getPreset(id) {
    return this.presets.get(id) || null;
  }

  createPreset({ name, runtimeId, model, parameters, systemPrompt }) {
    const id = randomUUID().slice(0, 8);
    const now = new Date().toISOString();
    const preset = {
      id,
      name,
      runtimeId: runtimeId || null,
      model: model || null,
      parameters: parameters || {},
      systemPrompt: systemPrompt || '',
      created: now,
      updated: now,
    };
    this.presets.set(id, preset);
    this._savePresets();
    this.daemon.broadcast({ type: 'lab:preset:created', data: preset });
    this.daemon.audit.log('lab.preset.create', { id, name });
    return preset;
  }

  updatePreset(id, updates) {
    const preset = this.presets.get(id);
    if (!preset) return null;
    const allowed = ['name', 'runtimeId', 'model', 'parameters', 'systemPrompt'];
    for (const key of allowed) {
      if (updates[key] !== undefined) preset[key] = updates[key];
    }
    preset.updated = new Date().toISOString();
    this.presets.set(id, preset);
    this._savePresets();
    this.daemon.broadcast({ type: 'lab:preset:updated', data: preset });
    this.daemon.audit.log('lab.preset.update', { id, name: preset.name });
    return preset;
  }

  deletePreset(id) {
    const preset = this.presets.get(id);
    if (!preset) return null;
    this.presets.delete(id);
    this._savePresets();
    this.daemon.broadcast({ type: 'lab:preset:deleted', data: { id } });
    this.daemon.audit.log('lab.preset.delete', { id, name: preset.name });
    return preset;
  }

  // ─── Sessions ───────────────────────────────────────────────

  listSessions() {
    return [...this.sessions.values()].map((s) => ({
      id: s.id,
      name: s.name,
      runtimeId: s.runtimeId,
      model: s.model,
      messageCount: s.messages.length,
      created: s.created,
      updated: s.updated,
    }));
  }

  getSession(id) {
    return this.sessions.get(id) || null;
  }

  _appendToSession(sessionId, inputMessages, assistantMessage) {
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = {
        id: sessionId,
        name: `Session ${sessionId.slice(0, 6)}`,
        runtimeId: null,
        model: null,
        messages: [],
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      };
    }

    // Add any new user messages not already in the session
    const existingCount = session.messages.length;
    const newMessages = inputMessages.slice(
      Math.max(0, existingCount)
    );
    session.messages.push(...newMessages);
    session.messages.push(assistantMessage);
    session.updated = new Date().toISOString();

    this.sessions.set(sessionId, session);
    this._saveSession(session);
  }

  // ─── Launch Local GGUF ───────────────────────────────────────

  async launchLocalModel(modelId) {
    const mm = this.daemon.modelManager;
    const ls = this.daemon.llamaServer;
    if (!mm || !ls) throw new Error('Local model serving not available');

    const model = mm.getModel(modelId);
    if (!model) throw new Error('Model not found in local store');

    const modelPath = mm.getModelPath(modelId);
    if (!modelPath) throw new Error('Model file not found on disk');

    const endpoint = await ls.ensureServer(modelPath);
    if (!endpoint) throw new Error('Failed to start inference server');

    const existing = [...this.runtimes.values()].find(
      (r) => r._localModelId === modelId,
    );
    if (existing) {
      existing.endpoint = endpoint;
      existing.models = [{ id: model.filename, name: model.filename, size: model.sizeBytes }];
      this._saveRuntimes();
      this.daemon.broadcast({ type: 'lab:runtime:updated', data: existing });
      return { runtime: existing, model: model.filename };
    }

    const label = model.filename.replace(/\.gguf$/i, '');
    const runtime = await this.addRuntime({
      name: `${label} (local)`,
      type: 'llama-cpp',
      endpoint,
      models: [{ id: model.filename, name: model.filename, size: model.sizeBytes }],
    });
    runtime._localModelId = modelId;
    this._saveRuntimes();

    return { runtime, model: model.filename };
  }

  listLocalModels() {
    const mm = this.daemon.modelManager;
    if (!mm) return [];
    return mm.getInstalled().filter((m) => m.exists);
  }

  // ─── Auto-detect Ollama ─────────────────────────────────────

  async autoDetectOllama() {
    try {
      const existing = [...this.runtimes.values()].find(
        (r) => r.type === 'ollama' && r.endpoint === DEFAULT_OLLAMA_ENDPOINT
      );
      if (existing) return existing;

      const resp = await fetch(`${DEFAULT_OLLAMA_ENDPOINT}/api/tags`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!resp.ok) return null;

      const data = await resp.json();
      const models = (data.models || []).map((m) => ({
        id: m.name || m.model,
        name: m.name || m.model,
        size: m.size || null,
        modified: m.modified_at || null,
      }));

      return this.addRuntime({
        name: 'Ollama (local)',
        type: 'ollama',
        endpoint: DEFAULT_OLLAMA_ENDPOINT,
        models,
      });
    } catch {
      return null;
    }
  }
}
