// GROOVE — Agent Registry
// FSL-1.1-Apache-2.0 — see LICENSE

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';

const SAFE_FIELDS = new Set(['status', 'pid', 'tokensUsed', 'contextUsage', 'lastActivity', 'model', 'provider', 'name', 'routingMode', 'routingReason', 'sessionId', 'skills', 'integrations', 'repos', 'workingDir', 'effort', 'costUsd', 'durationMs', 'turns', 'inputTokens', 'outputTokens', 'teamId', 'permission', 'scope', 'integrationApproval', 'personality', 'metadata']);

export class Registry extends EventEmitter {
  constructor(state) {
    super();
    this.state = state;
    this.agents = new Map();
    this._counters = new Map();
    this._initCounters();
  }

  _initCounters() {
    for (const agent of this.agents.values()) {
      const match = agent.name.match(/^(.+)-(\d+)$/);
      if (!match) continue;
      const role = match[1];
      const num = parseInt(match[2], 10);
      const current = this._counters.get(role) || 0;
      if (num > current) this._counters.set(role, num);
    }
  }

  add(config) {
    const role = config.role;
    const count = (this._counters.get(role) || 0) + 1;
    this._counters.set(role, count);
    let name = config.name || `${role}-${count}`;
    // Dedup: ensure name is globally unique (no two agents ever share a name)
    const existing = this.getAll();
    if (existing.some((a) => a.name === name)) {
      let suffix = 2;
      while (existing.some((a) => a.name === `${name}-${suffix}`)) suffix++;
      name = `${name}-${suffix}`;
    }
    const agent = {
      id: randomUUID().slice(0, 8),
      name,
      role: config.role,
      scope: config.scope || [],
      provider: config.provider || 'claude-code',
      model: config.model || null,
      prompt: config.prompt || '',
      permission: config.permission || 'full',
      workingDir: config.workingDir || process.cwd(),
      teamId: config.teamId || null,
      skills: config.skills || [],
      integrations: config.integrations || [],
      metadata: config.metadata || {},
      status: 'starting',
      pid: null,
      spawnedAt: new Date().toISOString(),
      lastActivity: null,
      tokensUsed: 0,
      contextUsage: 0,
      filesTouched: {},
    };

    this.agents.set(agent.id, agent);
    this.emit('change', { changed: [agent.id] });
    return agent;
  }

  get(id) {
    return this.agents.get(id) || null;
  }

  getAll() {
    return Array.from(this.agents.values());
  }

  update(id, updates) {
    const agent = this.agents.get(id);
    if (!agent) return null;

    // Only allow known fields to prevent prototype pollution
    for (const key of Object.keys(updates)) {
      if (SAFE_FIELDS.has(key)) {
        agent[key] = updates[key];
      }
    }
    agent.lastActivity = new Date().toISOString();
    this.emit('change', { changed: [id] });
    return agent;
  }

  remove(id) {
    const agent = this.agents.get(id);
    if (!agent) return false;

    this.agents.delete(id);
    this.emit('change', { removed: [id] });
    return true;
  }

  findByRole(role) {
    return this.getAll().filter((a) => a.role === role);
  }

  findByProvider(provider) {
    return this.getAll().filter((a) => a.provider === provider);
  }

  findByTeam(teamId) {
    return this.getAll().filter((a) => a.teamId === teamId);
  }

  trackFileOp(id, filePath, op) {
    const agent = this.agents.get(id);
    if (!agent) return;
    if (!agent.filesTouched) agent.filesTouched = {};
    const entry = agent.filesTouched[filePath] || { reads: 0, writes: 0, lastOp: null };
    if (op === 'read') entry.reads++;
    else entry.writes++;
    entry.lastOp = new Date().toISOString();
    agent.filesTouched[filePath] = entry;

    const keys = Object.keys(agent.filesTouched);
    if (keys.length > 5000) {
      const sorted = keys
        .map((k) => ({ k, t: agent.filesTouched[k].lastOp || '' }))
        .sort((a, b) => a.t.localeCompare(b.t));
      for (let i = 0; i < keys.length - 5000; i++) {
        delete agent.filesTouched[sorted[i].k];
      }
    }
  }

  getFilesTouched(id) {
    const agent = this.agents.get(id);
    if (!agent || !agent.filesTouched) return [];
    return Object.entries(agent.filesTouched)
      .map(([path, info]) => ({ path, reads: info.reads, writes: info.writes, lastOp: info.lastOp }))
      .sort((a, b) => (b.lastOp || '').localeCompare(a.lastOp || ''));
  }

  restore(agents) {
    for (const agent of agents) {
      agent.status = 'stopped';
      agent.pid = null;
      this.agents.set(agent.id, agent);
    }
    this._initCounters();
    if (agents.length > 0) {
      this.emit('change', { changed: agents.map((a) => a.id) });
    }
  }
}
