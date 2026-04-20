// GROOVE — Conversation Manager
// FSL-1.1-Apache-2.0 — see LICENSE

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { randomUUID } from 'crypto';

export class ConversationManager {
  constructor(daemon) {
    this.daemon = daemon;
    this.filePath = resolve(daemon.grooveDir, 'conversations.json');
    this.conversations = new Map();
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

  async create(provider, model, title) {
    const id = randomUUID().slice(0, 12);
    const now = new Date().toISOString();

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

    const conversation = {
      id,
      title: title || 'New Chat',
      agentId: agent.id,
      provider: agent.provider,
      model: agent.model,
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
    const agent = this.daemon.registry.get(conv.agentId);
    return {
      ...conv,
      agentStatus: agent?.status || conv.agentStatus || 'unknown',
    };
  }

  list() {
    const all = [...this.conversations.values()].map((conv) => {
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

    const agent = this.daemon.registry.get(conv.agentId);
    if (agent && (agent.status === 'running' || agent.status === 'starting')) {
      try { await this.daemon.processes.kill(conv.agentId); } catch { /* ignore */ }
    }
    if (agent) {
      this.daemon.registry.remove(conv.agentId);
    }

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
}
