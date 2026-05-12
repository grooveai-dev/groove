// GROOVE — Model Lab
// FSL-1.1-Apache-2.0 — see LICENSE

import { resolve } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import { randomUUID } from 'crypto';
import { homedir } from 'os';
import { spawn } from 'child_process';
import { LlamaServerManager } from './llama-server.js';
import { MLXServerManager } from './mlx-server.js';
const RUNTIME_TYPES = ['ollama', 'vllm', 'llama-cpp', 'mlx', 'tgi', 'openai-compatible'];
const DEFAULT_OLLAMA_ENDPOINT = 'http://localhost:11434';
const GLOBAL_GROOVE_DIR = resolve(homedir(), '.groove');

function localURL(endpoint) { return endpoint.replace('localhost', '127.0.0.1'); }

export class ModelLab {
  constructor(daemon) {
    this.daemon = daemon;
    this.runtimesPath = resolve(GLOBAL_GROOVE_DIR, 'lab-runtimes.json');
    this.presetsPath = resolve(daemon.grooveDir, 'lab-presets.json');
    this.sessionsDir = resolve(daemon.grooveDir, 'lab-sessions');
    this.runtimes = new Map();
    this.presets = new Map();
    this.sessions = new Map();
    this._processes = new Map();
    this._installedTools = null;
    this._ensureDirs();
    this._load();
    this._detectInstalledTools();
  }

  _ensureDirs() {
    try { mkdirSync(GLOBAL_GROOVE_DIR, { recursive: true }); } catch { /* best-effort */ }
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

  _detectInstalledTools() {
    // Detect installed inference tools (not running servers) on startup.
    // Results are cached and broadcast so the GUI can show "Start" buttons.
    try {
      const llamaInstalled = LlamaServerManager.isInstalled();
      const mlxInstalled = MLXServerManager.isInstalled();
      const mlxModels = MLXServerManager.scanModels();
      const mlxVersion = mlxInstalled ? MLXServerManager.getVersion() : null;

      this._installedTools = {
        llama: { installed: llamaInstalled },
        mlx: { installed: mlxInstalled, version: mlxVersion, models: mlxModels },
      };

      this.daemon?.broadcast({ type: 'lab:tools:detected', data: this._installedTools });
    } catch {
      this._installedTools = { llama: { installed: false }, mlx: { installed: false, version: null, models: [] } };
    }
  }

  getInstalledTools() {
    if (!this._installedTools) this._detectInstalledTools();
    return this._installedTools;
  }

  refreshInstalledTools() {
    this._detectInstalledTools();
    return this._installedTools;
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

  async addRuntime({ name, type, endpoint, apiKey, models, launchConfig }) {
    const id = randomUUID().slice(0, 8);
    const runtime = {
      id,
      name,
      type,
      endpoint: endpoint.replace(/\/+$/, ''),
      apiKey: apiKey || null,
      models: models || [],
      launchConfig: launchConfig || null,
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

    // Stop the llama-server process if this is a local GGUF runtime
    if (rt._localModelId) {
      const mm = this.daemon.modelManager;
      const ls = this.daemon.llamaServer;
      if (mm && ls) {
        const modelPath = mm.getModelPath(rt._localModelId);
        if (modelPath) ls.stopServer(modelPath).catch(() => {});
      }
    }

    // Stop the MLX server if this is an MLX runtime
    if (rt._mlxModelId) {
      const ms = this.daemon.mlxServer;
      if (ms) {
        const hfId = rt._mlxModelId.startsWith('mlx:') ? rt._mlxModelId.slice(4) : rt._mlxModelId;
        ms.stopServer(hfId).catch(() => {});
      }
    }

    // Stop any managed process
    const proc = this._processes.get(id);
    if (proc) {
      try { proc.kill('SIGTERM'); } catch {}
      this._processes.delete(id);
    }

    this.runtimes.delete(id);
    this._saveRuntimes();
    this.daemon.broadcast({ type: 'lab:runtime:removed', data: { id } });
    this.daemon.audit.log('lab.runtime.remove', { id, name: rt.name });
    return rt;
  }

  async startRuntime(id) {
    const rt = this.runtimes.get(id);
    if (!rt) throw new Error('Runtime not found');

    // MLX runtimes — use built-in MLXServerManager
    if (rt.type === 'mlx' && !rt.launchConfig) {
      const modelId = rt._mlxModelId || this._deriveModelId(rt, 'MLX - ');
      if (modelId) {
        const hfId = modelId.startsWith('mlx:') ? modelId.slice(4) : modelId;
        const ms = this.daemon.mlxServer;
        if (!ms) throw new Error('MLX server manager not available');
        const endpoint = await ms.ensureServer(hfId);
        rt.endpoint = endpoint;
        if (!rt._mlxModelId) { rt._mlxModelId = `mlx:${hfId}`; }
        this._saveRuntimes();
        this.daemon.broadcast({ type: 'lab:runtime:started', data: { id } });
        this.daemon.audit.log('lab.runtime.start', { id, name: rt.name });
        return rt;
      }
    }

    // llama-cpp runtimes — use built-in LlamaServerManager
    if (rt.type === 'llama-cpp' && rt._localModelId && !rt.launchConfig) {
      const mm = this.daemon.modelManager;
      const ls = this.daemon.llamaServer;
      if (!mm || !ls) throw new Error('llama-server not available');
      const modelPath = mm.getModelPath(rt._localModelId);
      if (!modelPath) throw new Error('Model file not found');
      const endpoint = await ls.ensureServer(modelPath);
      rt.endpoint = endpoint;
      this._saveRuntimes();
      this.daemon.broadcast({ type: 'lab:runtime:started', data: { id } });
      this.daemon.audit.log('lab.runtime.start', { id, name: rt.name });
      return rt;
    }

    // Generic launchConfig runtimes (vLLM, TGI, etc.)
    if (!rt.launchConfig) throw new Error('No launch config — use the assistant to set up this runtime first');
    if (this._processes.has(id)) throw new Error('Server already running');

    const lc = rt.launchConfig;
    const proc = spawn(lc.command, lc.args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...lc.env },
      detached: false,
    });

    if (!proc.pid) throw new Error('Failed to start server process');

    this._processes.set(id, proc);

    proc.on('exit', (code, signal) => {
      this._processes.delete(id);
      this.daemon?.broadcast({ type: 'lab:runtime:stopped', data: { id, code, signal } });
    });

    const endpoint = rt.endpoint.replace('localhost', '127.0.0.1');
    const healthUrl = rt.type === 'ollama' ? `${endpoint}/api/tags` : `${endpoint}/v1/models`;

    try {
      await this._waitForServer(healthUrl, 60000);
    } catch (err) {
      await this.stopRuntime(id);
      throw new Error(`Server failed to become healthy: ${err.message}`);
    }

    this.daemon.broadcast({ type: 'lab:runtime:started', data: { id } });
    this.daemon.audit.log('lab.runtime.start', { id, name: rt.name });
    return rt;
  }

  _deriveModelId(rt, prefix) {
    if (rt.name && rt.name.startsWith(prefix)) {
      return rt.name.slice(prefix.length).trim();
    }
    if (rt.models?.length > 0) {
      return rt.models[0].id || rt.models[0].name;
    }
    return null;
  }

  async _waitForServer(url, timeout) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
        if (res.ok) return;
      } catch { /* server still starting */ }
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error(`Health check timed out after ${timeout / 1000}s`);
  }

  async stopRuntime(id) {
    const rt = this.runtimes.get(id);
    if (!rt) throw new Error('Runtime not found');

    if (rt._localModelId) {
      const mm = this.daemon.modelManager;
      const ls = this.daemon.llamaServer;
      if (mm && ls) {
        const modelPath = mm.getModelPath(rt._localModelId);
        if (modelPath) await ls.stopServer(modelPath);
      }
    }

    if (rt._mlxModelId) {
      const ms = this.daemon.mlxServer;
      if (ms) {
        const hfId = rt._mlxModelId.startsWith('mlx:') ? rt._mlxModelId.slice(4) : rt._mlxModelId;
        await ms.stopServer(hfId);
      }
    }

    const proc = this._processes.get(id);
    if (proc) {
      await new Promise((resolve) => {
        const timeout = setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} }, 5000);
        proc.on('exit', () => { clearTimeout(timeout); resolve(); });
        try { proc.kill('SIGTERM'); } catch { clearTimeout(timeout); resolve(); }
      });
      this._processes.delete(id);
    }

    this.daemon.broadcast({ type: 'lab:runtime:stopped', data: { id } });
    this.daemon.audit.log('lab.runtime.stop', { id, name: rt.name });
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
      return this._discoverOllamaModels(localURL(rt.endpoint));
    }
    return this._discoverOpenAIModels(localURL(rt.endpoint), rt.apiKey);
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
      const ep = localURL(rt.endpoint);
      if (rt.type === 'ollama') {
        const resp = await fetch(`${ep}/api/tags`, {
          signal: AbortSignal.timeout(5000),
        });
        return { online: resp.ok, latency: Date.now() - start };
      }
      const headers = {};
      if (rt.apiKey) headers['Authorization'] = `Bearer ${rt.apiKey}`;
      const resp = await fetch(`${ep}/v1/models`, {
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

  async streamInference({ runtimeId, model, messages, parameters, sessionId }, onEvent) {
    const rt = this.runtimes.get(runtimeId);
    if (!rt) throw new Error('Runtime not found');
    if (!model) throw new Error('Model is required');
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error('Messages array is required');
    }

    const body = {
      model,
      messages,
      stream: true,
      ...this._buildParameterBody(parameters || {}),
    };

    const endpoint = rt.endpoint.replace('localhost', '127.0.0.1');
    const reqHeaders = { 'Content-Type': 'application/json' };
    if (rt.apiKey) reqHeaders['Authorization'] = `Bearer ${rt.apiKey}`;

    const requestStart = Date.now();
    let ttft = null;
    let completionTokens = 0;
    let promptTokens = 0;
    let totalTokens = 0;
    let generationStart = null;
    let fullContent = '';

    const resp = await fetch(`${endpoint}/v1/chat/completions`, {
      method: 'POST',
      headers: reqHeaders,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(300000),
    });

    if (!resp.ok) {
      let errMsg = `HTTP ${resp.status}`;
      try { const e = await resp.json(); errMsg = e.error?.message || errMsg; } catch { /* ignore */ }
      throw new Error(errMsg);
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta;
          if (delta?.reasoning_content) {
            if (ttft === null) { ttft = Date.now() - requestStart; generationStart = Date.now(); }
            completionTokens++;
            onEvent({ type: 'reasoning', content: delta.reasoning_content });
          }
          if (delta?.content) {
            if (ttft === null) { ttft = Date.now() - requestStart; generationStart = Date.now(); }
            fullContent += delta.content;
            completionTokens++;
            onEvent({ type: 'token', content: delta.content });
          }
          if (parsed.usage) {
            promptTokens = parsed.usage.prompt_tokens || 0;
            totalTokens = parsed.usage.total_tokens || 0;
            if (parsed.usage.completion_tokens) completionTokens = parsed.usage.completion_tokens;
          }
        } catch { /* skip malformed chunk */ }
      }
    }

    const generationTime = generationStart ? Date.now() - generationStart : Date.now() - requestStart;
    const tokensPerSec = generationTime > 0 ? (completionTokens / (generationTime / 1000)) : 0;

    if (sessionId) {
      this._appendToSession(sessionId, messages, { role: 'assistant', content: fullContent });
    }

    onEvent({
      type: 'done',
      metrics: {
        ttft,
        tokensPerSec: Math.round(tokensPerSec * 100) / 100,
        totalTokens: totalTokens || (promptTokens + completionTokens),
        promptTokens,
        completionTokens,
        generationTime,
        memoryUsage: null,
      },
    });

    if (rt.type === 'ollama') {
      try {
        const mem = await this.getOllamaMemoryUsage(localURL(rt.endpoint));
        if (mem) onEvent({ type: 'memory', usage: mem });
      } catch { /* ignore */ }
    }
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

  // ─── Launch Local Model ──────────────────────────────────────

  async launchLocalModel(modelId) {
    if (modelId.startsWith('mlx:')) {
      return this.launchMLXModel(modelId);
    }

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
    const models = [];

    // GGUF models from ModelManager
    const mm = this.daemon.modelManager;
    if (mm) {
      for (const m of mm.getInstalled().filter((m) => m.exists)) {
        models.push({ ...m, type: 'gguf', compatibleBackends: ['llama-cpp'] });
      }
    }

    // HuggingFace cache models (MLX + standard HF)
    try {
      const hfModels = MLXServerManager.scanModels();
      for (const m of hfModels) {
        models.push(m);
      }
    } catch { /* scan may fail */ }

    return models;
  }

  // ─── Model Suggestions ───────────────────────────────────────

  async suggestAlternativeModel(modelId, targetBackend) {
    const baseName = this._extractBaseName(modelId);
    if (!baseName) return null;

    const searchQueries = [];
    if (targetBackend === 'mlx') {
      searchQueries.push(`mlx-community/${baseName}`);
    } else if (targetBackend === 'llama-cpp') {
      searchQueries.push(baseName, `${baseName}-GGUF`);
    } else if (targetBackend === 'vllm' || targetBackend === 'tgi') {
      searchQueries.push(baseName);
    }

    for (const query of searchQueries) {
      try {
        const resp = await fetch(
          `https://huggingface.co/api/models?search=${encodeURIComponent(query)}&limit=5&sort=downloads`,
          { signal: AbortSignal.timeout(8000) },
        );
        if (!resp.ok) continue;
        const results = await resp.json();

        for (const r of results) {
          if (targetBackend === 'mlx' && !r.modelId?.includes('mlx')) continue;
          if (targetBackend === 'llama-cpp' && !r.modelId?.toLowerCase().includes('gguf')) continue;
          if (targetBackend === 'vllm' || targetBackend === 'tgi') {
            if (r.modelId?.includes('gguf') || r.modelId?.includes('mlx')) continue;
          }
          return {
            repoId: r.modelId,
            name: r.modelId?.split('/').pop() || r.modelId,
            downloads: r.downloads || 0,
          };
        }
      } catch { /* network error, skip */ }
    }
    return null;
  }

  _extractBaseName(modelId) {
    let name = modelId;
    if (name.startsWith('mlx:') || name.startsWith('hf:')) name = name.slice(name.indexOf(':') + 1);
    name = name.split('/').pop() || name;
    name = name
      .replace(/\.gguf$/i, '')
      .replace(/[-_](4bit|8bit|3bit|bf16|fp16|MLX|GGUF|Q\d_\w+)/gi, '')
      .replace(/-+$/, '');
    return name || null;
  }

  // ─── Launch MLX Model ────────────────────────────────────────

  async launchMLXModel(modelId) {
    const ms = this.daemon.mlxServer;
    if (!ms) throw new Error('MLX server manager not available');

    // modelId is "mlx:mlx-community/ModelName"
    const hfModelId = modelId.startsWith('mlx:') ? modelId.slice(4) : modelId;

    const endpoint = await ms.ensureServer(hfModelId);
    if (!endpoint) throw new Error('Failed to start MLX server');

    // Check if we already have a runtime for this model
    const existing = [...this.runtimes.values()].find(
      (r) => r._mlxModelId === modelId,
    );
    if (existing) {
      existing.endpoint = endpoint;
      this._saveRuntimes();
      this.daemon.broadcast({ type: 'lab:runtime:updated', data: existing });
      return { runtime: existing, model: hfModelId };
    }

    const shortName = hfModelId.split('/').pop() || hfModelId;
    const runtime = await this.addRuntime({
      name: `MLX - ${shortName}`,
      type: 'mlx',
      endpoint,
      models: [{ id: 'default', name: shortName }],
    });
    runtime._mlxModelId = modelId;
    this._saveRuntimes();

    return { runtime, model: hfModelId };
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
