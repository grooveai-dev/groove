// FSL-1.1-Apache-2.0 — see LICENSE

import { api } from '../../lib/api';
import { loadJSON, persistJSON } from '../helpers.js';

export const createProvidersSlice = (set, get) => ({
  // ── Providers ────────────────────────────────────────────
  _providerRefreshTick: 0,

  // ── Local Models (Ollama) ─────────────────────────────────
  ollamaStatus: { installed: false, serverRunning: false, hardware: null },
  ollamaInstalledModels: [],
  ollamaRunningModels: [],
  ollamaCatalog: [],
  ollamaPullProgress: {},

  // ── Provider Setup (Settings) ──────────────────────────────
  providerInstallProgress: {},

  // ── Model Lab ──────────────────────────────────────────────
  labRuntimes: loadJSON('groove:labRuntimes', []),
  labActiveRuntime: null,
  labModels: [],
  labActiveModel: null,
  labPresets: loadJSON('groove:labPresets', []),
  labActivePreset: null,
  labSessions: [],
  labActiveSession: null,
  labMetrics: {
    ttft: null, tokensPerSec: null, tokensPerSecHistory: [], ttftHistory: [],
    memory: null, peakMemory: null, totalTokens: 0, promptTokens: 0, completionTokens: 0,
    generationTime: null, generationCount: 0, sessionStartTime: null,
  },
  labParameters: loadJSON('groove:labParameters', {
    temperature: 0.7, topP: 0.9, topK: 40, minP: 0, repeatPenalty: 1.1,
    maxTokens: 2048, frequencyPenalty: 0, presencePenalty: 0,
    thinking: false, seed: null, stopSequences: [], jsonMode: false,
  }),
  labSystemPrompt: localStorage.getItem('groove:labSystemPrompt') || '',
  labStreaming: false,
  labAbortController: null,
  labLocalModels: [],
  labLaunching: null,
  labLlamaInstalled: null,
  labLaunchPhase: null,
  labLaunchError: null,
  labAssistantAgentId: localStorage.getItem('groove:labAssistantAgentId') || null,
  labAssistantMode: false,
  labAssistantBackend: localStorage.getItem('groove:labAssistantBackend') || null,

  // ── Provider Actions ──────────────────────────────────────

  async fetchProviders() {
    return api.get('/providers');
  },

  // ── Local Models (Ollama) ─────────────────────────────────

  async fetchOllamaStatus() {
    try {
      const check = await api.post('/providers/ollama/check');
      const updates = {
        ollamaStatus: { installed: check.installed, serverRunning: check.serverRunning, hardware: check.hardware },
      };
      if (check.installed) {
        try {
          const models = await api.get('/providers/ollama/models');
          updates.ollamaInstalledModels = models.installed || [];
          updates.ollamaCatalog = models.catalog || [];
        } catch {}
      }
      if (check.serverRunning) {
        try {
          const running = await api.get('/providers/ollama/running');
          updates.ollamaRunningModels = running.models || [];
        } catch {
          updates.ollamaRunningModels = [];
        }
      } else {
        updates.ollamaRunningModels = [];
      }
      set(updates);
      return updates.ollamaStatus;
    } catch {
      return get().ollamaStatus;
    }
  },

  async startOllamaServer() {
    try {
      const result = await api.post('/providers/ollama/serve');
      if (result.ok) {
        get().addToast('success', 'Ollama server started');
        await new Promise((r) => setTimeout(r, 2000));
        await get().fetchOllamaStatus();
      }
      return result;
    } catch (err) {
      get().addToast('error', 'Could not start server', err.message);
      throw err;
    }
  },

  async stopOllamaServer() {
    try {
      const result = await api.post('/providers/ollama/stop');
      if (result.ok) {
        get().addToast('info', 'Ollama server stopped');
        set((s) => ({
          ollamaStatus: { ...s.ollamaStatus, serverRunning: false },
          ollamaRunningModels: [],
        }));
      }
      return result;
    } catch (err) {
      get().addToast('error', 'Stop failed', err.message);
      throw err;
    }
  },

  async restartOllamaServer() {
    try {
      const result = await api.post('/providers/ollama/restart');
      if (result.ok) {
        get().addToast('success', 'Ollama server restarted');
        await new Promise((r) => setTimeout(r, 2000));
        await get().fetchOllamaStatus();
      }
      return result;
    } catch (err) {
      get().addToast('error', 'Restart failed', err.message);
      throw err;
    }
  },

  async pullOllamaModel(modelId) {
    try {
      set((s) => ({ ollamaPullProgress: { ...s.ollamaPullProgress, [modelId]: { status: 'pulling', progress: '' } } }));
      await api.post('/providers/ollama/pull', { model: modelId });
      set((s) => {
        const progress = { ...s.ollamaPullProgress };
        delete progress[modelId];
        return { ollamaPullProgress: progress };
      });
      get().addToast('success', `${modelId} ready to use`);
      get().fetchOllamaStatus();
    } catch (err) {
      set((s) => {
        const progress = { ...s.ollamaPullProgress };
        delete progress[modelId];
        return { ollamaPullProgress: progress };
      });
      get().addToast('error', `Pull failed: ${err.message}`);
    }
  },

  async deleteOllamaModel(modelId) {
    try {
      await api.delete(`/providers/ollama/models/${encodeURIComponent(modelId)}`);
      set((s) => ({ ollamaInstalledModels: s.ollamaInstalledModels.filter((m) => m.id !== modelId) }));
      get().addToast('success', `Removed ${modelId}`);
    } catch (err) {
      get().addToast('error', `Delete failed: ${err.message}`);
    }
  },

  async loadOllamaModel(modelId) {
    try {
      await api.post('/providers/ollama/load', { model: modelId });
      get().addToast('success', `${modelId} loaded into memory`);
      get().fetchOllamaStatus();
    } catch (err) {
      get().addToast('error', `Could not load model: ${err.message}`);
    }
  },

  async unloadOllamaModel(modelId) {
    try {
      await api.post('/providers/ollama/unload', { model: modelId });
      set((s) => ({ ollamaRunningModels: s.ollamaRunningModels.filter((m) => m.name !== modelId) }));
      get().addToast('info', `${modelId} unloaded`);
    } catch (err) {
      get().addToast('error', `Unload failed: ${err.message}`);
    }
  },

  spawnFromModel(modelId) {
    get().openDetail({ type: 'spawn', presetProvider: 'ollama', presetModel: modelId });
  },

  // ── Onboarding ────────────────────────────────────────────

  async fetchOnboardingStatus() {
    try {
      const data = await api.get('/onboarding/status');
      if (data?.complete) {
        set({ onboardingComplete: true });
        localStorage.setItem('groove:onboardingComplete', 'true');
      }
      return data;
    } catch {
      return null;
    }
  },

  dismissOnboarding() {
    set({ onboardingComplete: true });
    localStorage.setItem('groove:onboardingComplete', 'true');
    api.post('/onboarding/dismiss').catch(() => {});
  },

  // ── Provider Setup (Settings) ──────────────────────────────

  async installProvider(providerId) {
    const update = (patch) => set((s) => ({
      providerInstallProgress: {
        ...s.providerInstallProgress,
        [providerId]: { ...s.providerInstallProgress[providerId], ...patch },
      },
    }));

    update({ installing: true, percent: 0, message: 'Starting install...', error: null, done: false });

    try {
      const res = await fetch(`/api/providers/${encodeURIComponent(providerId)}/install`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(err || `Install failed (${res.status})`);
      }

      let body;
      try {
        body = await res.text();
      } catch (e) {
        throw new Error(`Failed to read response: ${e.message}`);
      }

      let lastError = null;
      let completed = false;
      for (const line of body.split('\n')) {
        if (!line.trim()) continue;
        try {
          const ev = JSON.parse(line);
          const isError = ev.status === 'error';
          const isDone = ev.status === 'complete';
          if (isError) lastError = ev.output || 'Install failed';
          if (isDone) completed = true;
          update({
            percent: ev.progress ?? get().providerInstallProgress[providerId]?.percent ?? 0,
            message: ev.output || get().providerInstallProgress[providerId]?.message,
            error: isError ? (ev.output || 'Install failed') : null,
            done: isDone,
            installing: !isDone && !isError,
          });
        } catch { /* skip malformed line */ }
      }

      if (lastError) throw new Error(lastError);
      if (!completed) throw new Error(body.slice(0, 500) || 'Install ended without confirmation');

      update({ installing: false, percent: 100, message: 'Installed', error: null, done: true });
      set({ _providerRefreshTick: Date.now() });
      get().addToast('success', `${providerId} installed`);
    } catch (err) {
      update({ installing: false, percent: 0, message: null, error: err.message, done: false });
      get().addToast('error', `Install failed: ${providerId}`, err.message);
      throw err;
    }
  },

  async loginProvider(providerId, body) {
    try {
      const data = await api.post(`/providers/${encodeURIComponent(providerId)}/login`, body);
      if (data?.url && !data?.browserOpened) window.open(data.url, '_blank');
      return data;
    } catch (err) {
      get().addToast('error', `Login failed`, err.message);
      throw err;
    }
  },

  async setProviderPath(providerId, path) {
    try {
      await api.post(`/providers/${encodeURIComponent(providerId)}/set-path`, { path });
      get().addToast('success', `Custom path set for ${providerId}`);
    } catch (err) {
      get().addToast('error', 'Failed to set path', err.message);
      throw err;
    }
  },

  async verifyProvider(providerId) {
    try {
      const data = await api.post(`/providers/${encodeURIComponent(providerId)}/verify`);
      return data;
    } catch (err) {
      get().addToast('error', `Verification failed`, err.message);
      throw err;
    }
  },

  async setDefaultProvider(provider, model) {
    try {
      await api.post('/onboarding/set-default', { provider, model });
      get().addToast('success', `Default set to ${provider} (${model})`);
    } catch (err) {
      get().addToast('error', 'Failed to set default', err.message);
      throw err;
    }
  },

  // ── Model Lab Actions ──────────────────────────────────────

  setLabParameter(key, value) {
    const params = { ...get().labParameters, [key]: value };
    set({ labParameters: params });
    persistJSON('groove:labParameters', params);
  },

  setLabSystemPrompt(text) {
    set({ labSystemPrompt: text });
    localStorage.setItem('groove:labSystemPrompt', text);
  },

  async fetchLabRuntimes() {
    try {
      const raw = await api.get('/lab/runtimes');
      const data = raw.map((rt) => ({
        ...rt,
        status: rt.online === true ? 'connected' : rt.online === false ? 'error' : rt.status,
      }));
      set({ labRuntimes: data });
      persistJSON('groove:labRuntimes', data);
      if (data.length > 0 && !get().labActiveRuntime) {
        get().setLabActiveRuntime(data[0].id);
      } else if (get().labActiveRuntime) {
        get().fetchLabModels(get().labActiveRuntime);
      }
    } catch { /* backend may not have lab endpoints yet */ }
  },

  async fetchLabLocalModels() {
    try {
      const data = await api.get('/lab/local-models');
      set({ labLocalModels: data });
    } catch { set({ labLocalModels: [] }); }
  },

  async checkLlamaStatus() {
    try {
      const data = await api.get('/llama/status');
      set({ labLlamaInstalled: !!data.installed });
    } catch { set({ labLlamaInstalled: false }); }
  },

  async launchLocalModel(modelId) {
    set({ labLaunching: modelId, labLaunchPhase: 'starting', labLaunchError: null });
    try {
      const result = await api.post('/lab/launch-local', { modelId });
      const raw = await api.get('/lab/runtimes');
      const runtimes = raw.map((rt) => ({
        ...rt,
        status: rt.online === true ? 'connected' : rt.online === false ? 'error' : rt.status,
      }));
      set({ labRuntimes: runtimes });
      persistJSON('groove:labRuntimes', runtimes);
      get().setLabActiveRuntime(result.runtime.id);
      set({ labActiveModel: result.model, labLaunching: null, labLaunchPhase: 'ready' });
      get().addToast('success', `Launched ${result.model}`);
      setTimeout(() => { if (get().labLaunchPhase === 'ready') set({ labLaunchPhase: null }); }, 3000);
      return result;
    } catch (err) {
      set({ labLaunching: null, labLaunchPhase: 'error', labLaunchError: err.message });
      get().addToast('error', 'Failed to launch model', err.message);
      throw err;
    }
  },

  async addLabRuntime(runtime) {
    try {
      const created = await api.post('/lab/runtimes', runtime);
      const runtimes = [...get().labRuntimes, created];
      set({ labRuntimes: runtimes });
      persistJSON('groove:labRuntimes', runtimes);
      get().setLabActiveRuntime(created.id);
      get().addToast('success', `Runtime "${runtime.name}" added`);
      return created;
    } catch (err) {
      get().addToast('error', 'Failed to add runtime', err.message);
      throw err;
    }
  },

  async startLabRuntime(id) {
    try {
      get().addToast('info', 'Starting server...');
      await api.post(`/lab/runtimes/${id}/start`);
      await get().fetchLabRuntimes();
      get().setLabActiveRuntime(id);
      get().addToast('success', 'Server started');
    } catch (err) {
      get().addToast('error', 'Failed to start server', err.message);
    }
  },

  async stopLabRuntime(id) {
    try {
      await api.post(`/lab/runtimes/${id}/stop`);
      const runtimes = get().labRuntimes.map((r) =>
        r.id === id ? { ...r, status: 'error', latency: null } : r,
      );
      set({ labRuntimes: runtimes });
      persistJSON('groove:labRuntimes', runtimes);
      get().addToast('success', 'Server stopped');
    } catch (err) {
      get().addToast('error', 'Failed to stop server', err.message);
    }
  },

  async removeLabRuntime(id) {
    try {
      await api.delete(`/lab/runtimes/${id}`);
      const runtimes = get().labRuntimes.filter((r) => r.id !== id);
      const active = get().labActiveRuntime === id ? null : get().labActiveRuntime;
      set({ labRuntimes: runtimes, labActiveRuntime: active, labModels: active ? get().labModels : [] });
      persistJSON('groove:labRuntimes', runtimes);
      get().addToast('success', 'Runtime removed');
    } catch (err) {
      get().addToast('error', 'Failed to remove runtime', err.message);
    }
  },

  async testLabRuntime(id) {
    try {
      const result = await api.post(`/lab/runtimes/${id}/test`);
      const runtimes = get().labRuntimes.map((r) =>
        r.id === id ? { ...r, status: result.ok ? 'connected' : 'error', latency: result.latency } : r,
      );
      const updates = { labRuntimes: runtimes };
      if (result.ok && result.models && get().labActiveRuntime === id) {
        updates.labModels = result.models;
      }
      set(updates);
      persistJSON('groove:labRuntimes', runtimes);
      return result;
    } catch (err) {
      const runtimes = get().labRuntimes.map((r) =>
        r.id === id ? { ...r, status: 'error' } : r,
      );
      set({ labRuntimes: runtimes });
      persistJSON('groove:labRuntimes', runtimes);
      return { ok: false, error: err.message };
    }
  },

  setLabActiveRuntime(id) {
    set({ labActiveRuntime: id, labModels: [], labActiveModel: null });
    if (id) get().fetchLabModels(id);
  },

  setLabActiveModel(model) {
    set({ labActiveModel: model });
  },

  async fetchLabModels(runtimeId) {
    try {
      const data = await api.get(`/lab/runtimes/${runtimeId}/models`);
      const updates = { labModels: data };
      if (data.length === 1 && !get().labActiveModel) {
        updates.labActiveModel = data[0].id || data[0].name;
      }
      set(updates);
    } catch { set({ labModels: [] }); }
  },

  newLabSession() {
    const id = `lab-${Date.now()}`;
    const session = { id, messages: [], createdAt: Date.now() };
    set((s) => ({
      labSessions: [session, ...s.labSessions],
      labActiveSession: id,
      labMetrics: {
        ttft: null, tokensPerSec: null, tokensPerSecHistory: [], ttftHistory: [],
        memory: null, peakMemory: null, totalTokens: 0, promptTokens: 0, completionTokens: 0,
        generationTime: null, generationCount: 0, sessionStartTime: null,
      },
    }));
    return id;
  },

  loadLabSession(id) {
    set({ labActiveSession: id });
  },

  async sendLabMessage(text) {
    const st = get();
    if (st.labStreaming) return;
    let sessionId = st.labActiveSession;
    if (!sessionId) sessionId = get().newLabSession();

    const userMsg = { role: 'user', content: text, timestamp: Date.now() };
    set((s) => {
      const sessions = s.labSessions.map((sess) =>
        sess.id === sessionId ? { ...sess, messages: [...sess.messages, userMsg] } : sess,
      );
      return { labSessions: sessions, labStreaming: true };
    });

    const assistantMsg = { role: 'assistant', content: '', timestamp: Date.now(), metrics: null };
    set((s) => {
      const sessions = s.labSessions.map((sess) =>
        sess.id === sessionId ? { ...sess, messages: [...sess.messages, assistantMsg] } : sess,
      );
      return { labSessions: sessions };
    });

    const abortController = new AbortController();
    set({ labAbortController: abortController });

    const startTime = performance.now();
    let firstTokenTime = null;
    let tokenCount = 0;

    try {
      const p = st.labParameters;
      const parameters = {};
      if (p.temperature !== undefined) parameters.temperature = p.temperature;
      if (p.topP !== undefined) parameters.top_p = p.topP;
      if (p.topK !== undefined) parameters.top_k = p.topK;
      if (p.minP !== undefined && p.minP > 0) parameters.min_p = p.minP;
      if (p.repeatPenalty !== undefined) parameters.repeat_penalty = p.repeatPenalty;
      if (p.maxTokens !== undefined) parameters.max_tokens = p.maxTokens;
      if (p.frequencyPenalty !== undefined) parameters.frequency_penalty = p.frequencyPenalty;
      if (p.presencePenalty !== undefined) parameters.presence_penalty = p.presencePenalty;
      parameters.enable_thinking = !!p.thinking;
      if (p.seed != null) parameters.seed = p.seed;
      if (p.stopSequences?.length) parameters.stop = p.stopSequences;
      if (p.jsonMode) parameters.response_format = { type: 'json_object' };

      const messages = [];
      if (st.labSystemPrompt) messages.push({ role: 'system', content: st.labSystemPrompt });
      const sessionMsgs = get().labSessions.find((s) => s.id === sessionId)?.messages || [];
      for (const m of sessionMsgs) {
        if (m.role === 'assistant' && !m.content) continue;
        messages.push({ role: m.role, content: m.content });
      }

      const body = {
        runtimeId: st.labActiveRuntime,
        model: st.labActiveModel,
        messages,
        parameters,
        sessionId,
      };

      const res = await fetch('/api/lab/inference', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: abortController.signal,
      });

      if (!res.ok) {
        let errMsg;
        try { errMsg = (await res.json()).error || `HTTP ${res.status}`; } catch { errMsg = `HTTP ${res.status}`; }
        throw new Error(errMsg);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullContent = '';
      let fullReasoning = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6);
          if (payload === '[DONE]') continue;
          try {
            const parsed = JSON.parse(payload);

            // Support both raw OpenAI format (piped) and legacy wrapper format
            const delta = parsed.choices?.[0]?.delta;
            const reasoningText = delta?.reasoning_content || delta?.reasoning || (parsed.type === 'reasoning' ? parsed.content : null);
            let contentText = delta?.content || (parsed.type === 'token' ? parsed.content : null);

            // Raw fallback: if no known field matched, extract any string from delta
            if (!reasoningText && !contentText && delta) {
              for (const v of Object.values(delta)) {
                if (typeof v === 'string' && v) { contentText = v; break; }
              }
            }
            // Last resort: if the parsed object itself has text but no choices wrapper
            if (!reasoningText && !contentText && !delta && parsed.response) {
              contentText = typeof parsed.response === 'string' ? parsed.response : null;
            }
            if (!reasoningText && !contentText && !delta && typeof parsed.text === 'string') {
              contentText = parsed.text;
            }
            if (!reasoningText && !contentText && !delta && typeof parsed.output === 'string') {
              contentText = parsed.output;
            }

            if (reasoningText) {
              if (!firstTokenTime) firstTokenTime = performance.now();
              tokenCount++;
              fullReasoning += reasoningText;
              set((s) => {
                const sessions = s.labSessions.map((sess) => {
                  if (sess.id !== sessionId) return sess;
                  const msgs = [...sess.messages];
                  msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], reasoning: fullReasoning };
                  return { ...sess, messages: msgs };
                });
                return { labSessions: sessions };
              });
            }
            if (contentText) {
              if (!firstTokenTime) firstTokenTime = performance.now();
              tokenCount++;
              fullContent += contentText;
              set((s) => {
                const sessions = s.labSessions.map((sess) => {
                  if (sess.id !== sessionId) return sess;
                  const msgs = [...sess.messages];
                  msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], content: fullContent };
                  return { ...sess, messages: msgs };
                });
                return { labSessions: sessions };
              });
            }

            // Handle done event (legacy wrapper) or finish_reason (raw OpenAI)
            if (parsed.type === 'done' && parsed.metrics) {
              const elapsed = performance.now() - startTime;
              const ttft = firstTokenTime ? firstTokenTime - startTime : null;
              const tps = tokenCount > 0 && elapsed > 0 ? (tokenCount / (elapsed / 1000)) : null;
              const msgMetrics = { ttft, tokensPerSec: tps, tokens: tokenCount, generationTime: elapsed, ...parsed.metrics };

              set((s) => {
                const tpsHist = [...s.labMetrics.tokensPerSecHistory, tps].slice(-20);
                const ttftHist = [...s.labMetrics.ttftHistory, ttft].filter((v) => v != null).slice(-20);
                const mem = parsed.metrics.memoryUsage || s.labMetrics.memory;
                const sessions = s.labSessions.map((sess) => {
                  if (sess.id !== sessionId) return sess;
                  const msgs = [...sess.messages];
                  msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], metrics: msgMetrics };
                  return { ...sess, messages: msgs };
                });
                return {
                  labSessions: sessions,
                  labMetrics: {
                    ...s.labMetrics,
                    ttft, tokensPerSec: tps, tokensPerSecHistory: tpsHist, ttftHistory: ttftHist,
                    memory: mem, peakMemory: Math.max(mem || 0, s.labMetrics.peakMemory || 0) || null,
                    totalTokens: s.labMetrics.totalTokens + (parsed.metrics.totalTokens || tokenCount),
                    promptTokens: s.labMetrics.promptTokens + (parsed.metrics.promptTokens || 0),
                    completionTokens: s.labMetrics.completionTokens + (parsed.metrics.completionTokens || tokenCount),
                    generationTime: parsed.metrics.generationTime || elapsed,
                    generationCount: s.labMetrics.generationCount + 1,
                    sessionStartTime: s.labMetrics.sessionStartTime || Date.now(),
                  },
                };
              });
            }
            if (parsed.type === 'error') {
              throw new Error(parsed.error || 'Inference error');
            }
          } catch (e) {
            if (e.message && e.message !== 'Inference error' && !e.message.startsWith('HTTP ')) continue;
            throw e;
          }
        }
      }

      // Strip <think> tags from content — some models embed reasoning in content field
      if (fullContent && fullContent.includes('<think>')) {
        const stripped = fullContent.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
        const thinkMatch = fullContent.match(/<think>([\s\S]*?)<\/think>/);
        if (thinkMatch && !fullReasoning) fullReasoning = thinkMatch[1].trim();
        // If stripping left nothing, check for unclosed <think> (model still mid-thought)
        if (stripped) {
          fullContent = stripped;
        } else if (fullContent.includes('<think>') && !fullContent.includes('</think>')) {
          const afterTag = fullContent.replace(/<think>/, '').trim();
          if (!fullReasoning) fullReasoning = afterTag;
          fullContent = '';
        }
        set((s) => {
          const sessions = s.labSessions.map((sess) => {
            if (sess.id !== sessionId) return sess;
            const msgs = [...sess.messages];
            msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], content: fullContent || undefined, reasoning: fullReasoning || undefined };
            return { ...sess, messages: msgs };
          });
          return { labSessions: sessions };
        });
      }

      // If stream ended with reasoning but no content, promote reasoning as the response
      if (fullReasoning && !fullContent) {
        fullContent = fullReasoning;
        set((s) => {
          const sessions = s.labSessions.map((sess) => {
            if (sess.id !== sessionId) return sess;
            const msgs = [...sess.messages];
            msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], content: fullContent };
            return { ...sess, messages: msgs };
          });
          return { labSessions: sessions };
        });
      }

      // If stream ended with zero content at all, surface a fallback message
      if (!fullContent && !fullReasoning) {
        fullContent = '[Model returned an empty response — try a different prompt or check server logs]';
        set((s) => {
          const sessions = s.labSessions.map((sess) => {
            if (sess.id !== sessionId) return sess;
            const msgs = [...sess.messages];
            msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], content: fullContent };
            return { ...sess, messages: msgs };
          });
          return { labSessions: sessions };
        });
      }

      // Compute final metrics from client-side timing
      const elapsed = performance.now() - startTime;
      const ttft = firstTokenTime ? firstTokenTime - startTime : null;
      const tps = tokenCount > 0 && elapsed > 0 ? (tokenCount / (elapsed / 1000)) : null;
      if (tokenCount > 0) {
        set((s) => {
          const tpsHist = [...s.labMetrics.tokensPerSecHistory, tps].slice(-20);
          const ttftHist = [...s.labMetrics.ttftHistory, ttft].filter((v) => v != null).slice(-20);
          const sessions = s.labSessions.map((sess) => {
            if (sess.id !== sessionId) return sess;
            const msgs = [...sess.messages];
            const last = msgs[msgs.length - 1];
            if (!last?.metrics) {
              msgs[msgs.length - 1] = { ...last, metrics: { ttft, tokensPerSec: tps, tokens: tokenCount, generationTime: elapsed } };
            }
            return { ...sess, messages: msgs };
          });
          return {
            labSessions: sessions,
            labMetrics: {
              ...s.labMetrics, ttft, tokensPerSec: tps,
              tokensPerSecHistory: tpsHist, ttftHistory: ttftHist,
              totalTokens: s.labMetrics.totalTokens + tokenCount,
              completionTokens: s.labMetrics.completionTokens + tokenCount,
              generationTime: elapsed,
              generationCount: s.labMetrics.generationCount + 1,
              sessionStartTime: s.labMetrics.sessionStartTime || Date.now(),
            },
          };
        });
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        // User cancelled — keep whatever content was already streamed
      } else {
        set((s) => {
          const sessions = s.labSessions.map((sess) => {
            if (sess.id !== sessionId) return sess;
            const msgs = [...sess.messages];
            msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], content: `Error: ${err.message}`, error: true };
            return { ...sess, messages: msgs };
          });
          return { labSessions: sessions };
        });
      }
    } finally {
      set({ labStreaming: false, labAbortController: null });
    }
  },

  stopLabInference() {
    const ctrl = get().labAbortController;
    if (ctrl) ctrl.abort();
  },

  saveLabPreset(name) {
    const st = get();
    const preset = {
      id: `preset-${Date.now()}`,
      name,
      parameters: { ...st.labParameters },
      systemPrompt: st.labSystemPrompt,
      runtimeId: st.labActiveRuntime,
      model: st.labActiveModel,
      createdAt: Date.now(),
    };
    const presets = [...st.labPresets.filter((p) => p.name !== name), preset];
    set({ labPresets: presets, labActivePreset: preset.id });
    persistJSON('groove:labPresets', presets);
    get().addToast('success', `Preset "${name}" saved`);
    return preset;
  },

  loadLabPreset(id) {
    const preset = get().labPresets.find((p) => p.id === id);
    if (!preset) return;
    const defaults = {
      temperature: 0.7, topP: 0.9, topK: 40, minP: 0, repeatPenalty: 1.1,
      maxTokens: 2048, frequencyPenalty: 0, presencePenalty: 0,
      thinking: false, seed: null, stopSequences: [], jsonMode: false,
    };
    const merged = { ...defaults, ...preset.parameters };
    const updates = {
      labParameters: merged,
      labSystemPrompt: preset.systemPrompt || '',
      labActivePreset: id,
    };
    if (preset.model) updates.labActiveModel = preset.model;
    set(updates);
    persistJSON('groove:labParameters', merged);
    if (preset.systemPrompt !== undefined) localStorage.setItem('groove:labSystemPrompt', preset.systemPrompt);
  },

  deleteLabPreset(id) {
    const presets = get().labPresets.filter((p) => p.id !== id);
    set({ labPresets: presets, labActivePreset: get().labActivePreset === id ? null : get().labActivePreset });
    persistJSON('groove:labPresets', presets);
    get().addToast('success', 'Preset deleted');
  },

  async launchLabAssistant(backend, model) {
    const existing = get().labAssistantAgentId;
    if (existing) {
      const agent = get().agents.find((a) => a.id === existing);
      if (agent && agent.status === 'running') {
        set({ labAssistantMode: true });
        return;
      }
    }
    try {
      const body = { backend };
      if (model) body.model = { id: model.id, filename: model.filename, parameters: model.parameters, quantization: model.quantization };
      const data = await api.post('/lab/assistant', body);
      localStorage.setItem('groove:labAssistantAgentId', data.agentId);
      localStorage.setItem('groove:labAssistantBackend', backend);
      set({ labAssistantAgentId: data.agentId, labAssistantMode: true, labAssistantBackend: backend });
      get().addToast('info', `Lab Assistant started for ${backend}`);
    } catch (err) {
      get().addToast('error', 'Failed to start assistant', err.message);
    }
  },

  dismissLabAssistant() {
    set({ labAssistantMode: false });
  },

  clearLabAssistant() {
    const id = get().labAssistantAgentId;
    if (id) api.delete(`/agents/${encodeURIComponent(id)}`).catch(() => {});
    localStorage.removeItem('groove:labAssistantAgentId');
    localStorage.removeItem('groove:labAssistantBackend');
    set({ labAssistantAgentId: null, labAssistantMode: false, labAssistantBackend: null });
  },

  setLabAssistantMode(mode) {
    set({ labAssistantMode: mode });
  },

  async onLabAssistantComplete() {
    const prevIds = new Set(get().labRuntimes.map((r) => r.id));
    try {
      const raw = await api.get('/lab/runtimes');
      const data = raw.map((rt) => ({
        ...rt,
        status: rt.online === true ? 'connected' : rt.online === false ? 'error' : rt.status,
      }));
      set({ labRuntimes: data });
      persistJSON('groove:labRuntimes', data);
      const newRuntime = data.find((r) => !prevIds.has(r.id));
      if (newRuntime) {
        set({ labActiveRuntime: newRuntime.id, labModels: [], labActiveModel: null });
        try {
          const models = await api.get(`/lab/runtimes/${newRuntime.id}/models`);
          set({ labModels: models });
          if (models.length > 0) set({ labActiveModel: models[0].id || models[0].name });
        } catch { /* models may not be available yet */ }
      }
    } catch { /* ignore */ }
  },
});
