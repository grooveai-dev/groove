// GROOVE — Conversation Manager
// FSL-1.1-Apache-2.0 — see LICENSE

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { randomUUID } from 'crypto';
import { spawn as cpSpawn } from 'child_process';
import { getProvider, getInstalledProviders, isProviderInstalled, resolveProviderCommand } from './providers/index.js';

export class ConversationManager {
  constructor(daemon) {
    this.daemon = daemon;
    this.filePath = resolve(daemon.grooveDir, 'conversations.json');
    this.conversations = new Map();
    this._modeChanging = new Set();
    this._load();
    this._listenForAgentExits();
  }

  _load() {
    if (!existsSync(this.filePath)) return;
    try {
      const data = JSON.parse(readFileSync(this.filePath, 'utf8'));
      if (Array.isArray(data)) {
        for (const conv of data) this.conversations.set(conv.id, conv);
      }
    } catch { /* ignore corrupt file */ }
  }

  _save() {
    writeFileSync(this.filePath, JSON.stringify([...this.conversations.values()], null, 2));
  }

  _listenForAgentExits() {
    this.daemon.registry.on('change', (delta) => {
      if (!delta?.changed) return;
      for (const agentId of delta.changed) {
        const agent = this.daemon.registry.get(agentId);
        if (!agent) continue;
        const conv = this._findByAgentId(agentId);
        if (!conv) continue;
        if (agent.status === 'completed' || agent.status === 'killed' || agent.status === 'crashed') {
          conv.agentStatus = agent.status;
          conv.updatedAt = new Date().toISOString();
          this._save();
          this.daemon.broadcast({ type: 'conversation:updated', data: conv });
        }
      }
    });
  }

  _findByAgentId(agentId) {
    for (const conv of this.conversations.values()) {
      if (conv.agentId === agentId) return conv;
    }
    return null;
  }

  _resolveAutoProviderModel(preferredProvider) {
    const priority = ['claude-code', 'codex', 'gemini', 'grok', 'ollama'];
    const candidates = preferredProvider ? [preferredProvider] : priority;

    for (const pid of candidates) {
      if (!isProviderInstalled(pid)) continue;
      const p = getProvider(pid);
      if (!p) continue;
      const models = p.constructor.models || [];
      const chatModel = models.find((m) => m.type !== 'image') || models[0];
      if (chatModel) return { provider: pid, model: chatModel.id };
    }

    return { provider: 'claude-code', model: 'claude-sonnet-4-6' };
  }

  async create(provider, model, title, mode = 'api', options = {}) {
    if (!provider && this.daemon.config?.defaultChatProvider) {
      provider = this.daemon.config.defaultChatProvider;
    }
    if (!model && this.daemon.config?.defaultChatModel) {
      model = this.daemon.config.defaultChatModel;
    }

    if (!provider || !model) {
      const resolved = this._resolveAutoProviderModel(provider);
      if (!provider) provider = resolved.provider;
      if (!model) model = resolved.model;
    }

    const id = randomUUID().slice(0, 12);
    const now = new Date().toISOString();

    let agentId = null;

    if (mode === 'agent') {
      const defaultTeam = this.daemon.teams.getDefault();
      const workingDir = defaultTeam?.workingDir || this.daemon.projectDir;

      const agent = await this.daemon.processes.spawn({
        role: 'chat',
        provider,
        model: model || null,
        workingDir,
        teamId: defaultTeam?.id || null,
        permission: 'full',
      });
      agentId = agent.id;
    }

    const conversation = {
      id,
      title: title || 'New Chat',
      agentId,
      provider,
      model: model || null,
      mode: mode === 'agent' ? 'agent' : 'api',
      reasoningEffort: options.reasoningEffort || null,
      verbosity: options.verbosity || null,
      previousResponseId: null,
      createdAt: now,
      updatedAt: now,
      pinned: false,
      archived: false,
    };

    this.conversations.set(id, conversation);
    this._save();
    this.daemon.broadcast({ type: 'conversation:created', data: conversation });
    return conversation;
  }

  get(id) {
    const conv = this.conversations.get(id);
    if (!conv) return null;
    if (conv.mode === 'api' || !conv.agentId) {
      return { ...conv, agentStatus: conv.agentStatus || null };
    }
    const agent = this.daemon.registry.get(conv.agentId);
    return {
      ...conv,
      agentStatus: agent?.status || conv.agentStatus || 'unknown',
    };
  }

  list() {
    const all = [...this.conversations.values()].map((conv) => {
      if (conv.mode === 'api' || !conv.agentId) {
        return { ...conv, agentStatus: conv.agentStatus || null };
      }
      const agent = this.daemon.registry.get(conv.agentId);
      return {
        ...conv,
        agentStatus: agent?.status || conv.agentStatus || 'unknown',
      };
    });
    all.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return new Date(b.updatedAt) - new Date(a.updatedAt);
    });
    return all;
  }

  rename(id, title) {
    const conv = this.conversations.get(id);
    if (!conv) throw new Error('Conversation not found');
    if (!title || typeof title !== 'string' || !title.trim()) {
      throw new Error('Title is required');
    }
    conv.title = title.trim().slice(0, 200);
    conv.updatedAt = new Date().toISOString();
    this._save();
    this.daemon.broadcast({ type: 'conversation:updated', data: conv });
    return conv;
  }

  pin(id, pinned) {
    const conv = this.conversations.get(id);
    if (!conv) throw new Error('Conversation not found');
    conv.pinned = !!pinned;
    conv.updatedAt = new Date().toISOString();
    this._save();
    this.daemon.broadcast({ type: 'conversation:updated', data: conv });
    return conv;
  }

  archive(id, archived) {
    const conv = this.conversations.get(id);
    if (!conv) throw new Error('Conversation not found');
    conv.archived = !!archived;
    conv.updatedAt = new Date().toISOString();
    this._save();
    this.daemon.broadcast({ type: 'conversation:updated', data: conv });
    return conv;
  }

  async delete(id) {
    const conv = this.conversations.get(id);
    if (!conv) throw new Error('Conversation not found');

    if (conv.agentId) {
      const agent = this.daemon.registry.get(conv.agentId);
      if (agent && (agent.status === 'running' || agent.status === 'starting')) {
        try { await this.daemon.processes.kill(conv.agentId); } catch { /* ignore */ }
      }
      if (agent) {
        this.daemon.registry.remove(conv.agentId);
      }
    }

    // Kill any active API mode streaming process
    this._killStreamingProcess(id);

    this.conversations.delete(id);
    this._save();
    this.daemon.broadcast({ type: 'conversation:deleted', data: { id } });
    return true;
  }

  touchUpdatedAt(id) {
    const conv = this.conversations.get(id);
    if (!conv) return;
    conv.updatedAt = new Date().toISOString();
    this._save();
  }

  autoTitle(id, message) {
    const conv = this.conversations.get(id);
    if (!conv) return;
    if (conv.title !== 'New Chat') return;
    const cleaned = message.trim().replace(/\s+/g, ' ').slice(0, 50);
    conv.title = cleaned || 'New Chat';
    conv.updatedAt = new Date().toISOString();
    this._save();
    this.daemon.broadcast({ type: 'conversation:updated', data: conv });
  }

  updateModel(id, provider, model) {
    const conv = this.conversations.get(id);
    if (!conv) throw new Error('Conversation not found');
    conv.provider = provider;
    conv.model = model;
    conv.updatedAt = new Date().toISOString();
    this._save();
    this.daemon.broadcast({ type: 'conversation:updated', data: conv });
    return conv;
  }

  updateReasoningSettings(id, reasoningEffort, verbosity) {
    const conv = this.conversations.get(id);
    if (!conv) throw new Error('Conversation not found');
    if (reasoningEffort !== undefined) conv.reasoningEffort = reasoningEffort || null;
    if (verbosity !== undefined) conv.verbosity = verbosity || null;
    conv.updatedAt = new Date().toISOString();
    this._save();
    this.daemon.broadcast({ type: 'conversation:updated', data: conv });
    return conv;
  }

  async setMode(id, mode) {
    const conv = this.conversations.get(id);
    if (!conv) throw new Error('Conversation not found');
    if (mode !== 'api' && mode !== 'agent') throw new Error('Mode must be "api" or "agent"');
    if (conv.mode === mode) return conv;

    if (this._modeChanging.has(id)) return conv;
    this._modeChanging.add(id);

    try {
      if (mode === 'agent') {
        const existingAgent = conv.agentId ? this.daemon.registry.get(conv.agentId) : null;
        const alive = existingAgent && (existingAgent.status === 'running' || existingAgent.status === 'starting');

        if (!alive) {
          const defaultTeam = this.daemon.teams.getDefault();
          const workingDir = defaultTeam?.workingDir || this.daemon.projectDir;
          const agent = await this.daemon.processes.spawn({
            role: 'chat',
            provider: conv.provider,
            model: conv.model || null,
            workingDir,
            teamId: defaultTeam?.id || null,
            permission: 'full',
          });
          conv.agentId = agent.id;
        }
      } else {
        // Switching to API mode — kill the agent if running
        this._killStreamingProcess(id);
        if (conv.agentId) {
          const agent = this.daemon.registry.get(conv.agentId);
          if (agent && (agent.status === 'running' || agent.status === 'starting')) {
            try { await this.daemon.processes.kill(conv.agentId); } catch { /* ignore */ }
          }
          if (agent) this.daemon.registry.remove(conv.agentId);
          conv.agentId = null;
        }
      }

      conv.mode = mode;
      conv.updatedAt = new Date().toISOString();
      this._save();
      this.daemon.broadcast({ type: 'conversation:updated', data: conv });
      return conv;
    } finally {
      this._modeChanging.delete(id);
    }
  }

  _buildHistoryPrompt(history, newMessage) {
    const parts = [];
    if (history && history.length > 0) {
      parts.push('Previous conversation:');
      for (const msg of history) {
        const role = msg.from === 'user' ? 'User' : 'Assistant';
        parts.push(`${role}: ${msg.text}`);
      }
      parts.push('');
    }
    parts.push(`User: ${newMessage}`);
    return parts.join('\n');
  }

  _getStreamingProcesses() {
    if (!this._streamingProcesses) this._streamingProcesses = new Map();
    return this._streamingProcesses;
  }

  _killStreamingProcess(conversationId) {
    const procs = this._getStreamingProcesses();
    const handle = procs.get(conversationId);
    if (!handle) return;
    if (handle.abort) {
      handle.abort();
    } else if (handle.kill && !handle.killed) {
      handle.kill();
    }
    procs.delete(conversationId);
  }

  _getApiKey(providerName) {
    const envMap = {
      'claude-code': 'ANTHROPIC_API_KEY',
      'codex': 'OPENAI_API_KEY',
      'gemini': 'GEMINI_API_KEY',
      'grok': 'XAI_API_KEY',
      'nano-banana': 'GEMINI_API_KEY',
    };
    const envVar = envMap[providerName];
    if (envVar && process.env[envVar]) return process.env[envVar];
    try {
      return this.daemon.credentials?.getKey(providerName) || null;
    } catch { return null; }
  }

  async sendMessage(id, message, history, { reasoningEffort, verbosity } = {}) {
    const conv = this.conversations.get(id);
    if (!conv) throw new Error('Conversation not found');
    if (conv.mode !== 'api') throw new Error('sendMessage only works in API mode');

    this._killStreamingProcess(id);

    let provider = getProvider(conv.provider);
    let modelId = conv.model;
    let providerName = conv.provider;

    if (!provider || !isProviderInstalled(conv.provider)) {
      const resolved = this._resolveAutoProviderModel(null);
      provider = getProvider(resolved.provider);
      if (!provider) throw new Error('No provider available for chat');
      providerName = resolved.provider;
      modelId = resolved.model;
    }

    if (!modelId) {
      const resolved = this._resolveAutoProviderModel(providerName);
      modelId = resolved.model;
    }

    // Build messages array for direct API call
    const messages = (history || []).map((m) => ({
      role: m.from === 'user' ? 'user' : 'assistant',
      content: m.text,
    }));
    messages.push({ role: 'user', content: message });

    const apiKey = this._getApiKey(providerName);

    const effectiveReasoningEffort = reasoningEffort || conv.reasoningEffort || null;
    const effectiveVerbosity = verbosity || conv.verbosity || null;

    // Trajectory capture for training data
    const tc = this.daemon.trajectoryCapture;
    let tcAgentId = null;
    let tcResponseText = '';
    if (tc) {
      try { tcAgentId = tc.onChatTurnStart(id, providerName, modelId, message); } catch { /* never block chat */ }
    }

    // Try direct API streaming first (sub-second latency)
    const controller = provider.streamChat(
      messages, modelId, apiKey,
      (text) => {
        if (tcAgentId) tcResponseText += text;
        this.daemon.broadcast({
          type: 'conversation:chunk',
          data: { conversationId: id, text },
        });
      },
      (result) => {
        if (result?.responseId) {
          conv.previousResponseId = result.responseId;
          this._save();
        }
        this._getStreamingProcesses().delete(id);
        if (tcAgentId && tc) {
          try {
            tc.onParsedOutput(tcAgentId, { type: 'activity', subtype: 'assistant', data: tcResponseText });
            tc.onParsedOutput(tcAgentId, { type: 'result', data: tcResponseText });
            tc.onAgentComplete(tcAgentId, { status: 'SUCCESS' });
            const count = (this.daemon.state.get('training_sessions_captured') || 0) + 1;
            this.daemon.state.set('training_sessions_captured', count);
          } catch { /* never block chat */ }
        }
        this.daemon.broadcast({
          type: 'conversation:complete',
          data: { conversationId: id },
        });
      },
      (err) => {
        this._getStreamingProcesses().delete(id);
        if (tcAgentId && tc) {
          try { tc.onAgentCrash(tcAgentId, err); } catch { /* never block chat */ }
        }
        this.daemon.broadcast({
          type: 'conversation:error',
          data: { conversationId: id, error: err.message },
        });
      },
      {
        reasoningEffort: effectiveReasoningEffort,
        verbosity: effectiveVerbosity,
        previousResponseId: conv.previousResponseId,
      },
    );

    if (controller) {
      this._getStreamingProcesses().set(id, controller);
      return;
    }

    // Fallback: headless CLI spawn (for providers without streamChat or missing API key)
    const prompt = this._buildHistoryPrompt(history, message);
    const headlessCmd = provider.buildHeadlessCommand(prompt, modelId);
    if (!headlessCmd) {
      if (tcAgentId && tc) {
        try { tc.onAgentCrash(tcAgentId, new Error('No API key for chat')); } catch { /* never block chat */ }
      }
      this.daemon.broadcast({
        type: 'conversation:error',
        data: { conversationId: id, error: `${providerName} requires an API key for chat` },
      });
      return;
    }
    const { command: rawCommand, args, env, stdin: stdinData, cwd } = headlessCmd;
    const command = resolveProviderCommand(providerName) || rawCommand;

    const spawnOpts = {
      env: { ...process.env, ...env },
      cwd: cwd || this.daemon.projectDir,
      stdio: stdinData ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
    };

    const proc = cpSpawn(command, args, spawnOpts);
    this._getStreamingProcesses().set(id, proc);

    proc.on('error', (err) => {
      this._getStreamingProcesses().delete(id);
      if (tcAgentId && tc) {
        try { tc.onAgentCrash(tcAgentId, err); } catch { /* never block chat */ }
      }
      this.daemon.broadcast({
        type: 'conversation:error',
        data: { conversationId: id, error: err.message },
      });
    });

    if (stdinData) {
      proc.stdin.write(stdinData);
      proc.stdin.end();
    }

    const emitChunk = (text) => {
      if (tcAgentId) tcResponseText += text;
      this.daemon.broadcast({
        type: 'conversation:chunk',
        data: { conversationId: id, text },
      });
    };

    proc.stdout.on('data', (data) => {
      const text = data.toString();
      const lines = text.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const json = JSON.parse(trimmed);
          if (json.type === 'assistant' && json.message?.content) {
            for (const block of json.message.content) {
              if (block.type === 'text' && block.text) {
                emitChunk(block.text);
              }
            }
            continue;
          }
          if (json.type === 'content_block_delta' && json.delta?.text) {
            emitChunk(json.delta.text);
            continue;
          }
          if (json.type === 'result' && json.result) continue;
          if (json.type === 'token' && json.text != null) {
            emitChunk(json.text);
            continue;
          }
          if ((json.type === 'done' || json.type === 'complete' || json.type === 'result') && json.text) {
            emitChunk(json.text);
            continue;
          }
          if (json.content?.[0]?.text) {
            emitChunk(json.content[0].text);
            continue;
          }
        } catch { /* not JSON */ }

        if (!trimmed.startsWith('{')) {
          emitChunk(trimmed);
        }
      }
    });

    proc.on('exit', (code) => {
      this._getStreamingProcesses().delete(id);
      if (tcAgentId && tc) {
        try {
          tc.onParsedOutput(tcAgentId, { type: 'activity', subtype: 'assistant', data: tcResponseText });
          tc.onParsedOutput(tcAgentId, { type: 'result', data: tcResponseText });
          if (code === 0 || code === null) {
            tc.onAgentComplete(tcAgentId, { status: 'SUCCESS' });
          } else {
            tc.onAgentCrash(tcAgentId, new Error(`Exit code ${code}`));
          }
          const count = (this.daemon.state.get('training_sessions_captured') || 0) + 1;
          this.daemon.state.set('training_sessions_captured', count);
        } catch { /* never block chat */ }
      }
      this.daemon.broadcast({
        type: 'conversation:complete',
        data: { conversationId: id, exitCode: code },
      });
    });

    const timeout = setTimeout(() => {
      if (!proc.killed) proc.kill();
    }, 120_000);
    proc.on('exit', () => clearTimeout(timeout));
  }

  stopStreaming(id) {
    this._killStreamingProcess(id);
    this.daemon.broadcast({
      type: 'conversation:complete',
      data: { conversationId: id, stopped: true },
    });
  }
}
