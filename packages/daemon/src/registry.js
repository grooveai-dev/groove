// GROOVE — Agent Registry
// FSL-1.1-Apache-2.0 — see LICENSE

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';

export class Registry extends EventEmitter {
  constructor(state) {
    super();
    this.state = state;
    this.agents = new Map();
  }

  add(config) {
    const agent = {
      id: randomUUID().slice(0, 8),
      name: config.name || `${config.role}-${this.agents.size + 1}`,
      role: config.role,
      scope: config.scope || [],
      provider: config.provider || 'claude-code',
      model: config.model || null,
      prompt: config.prompt || '',
      workingDir: config.workingDir || process.cwd(),
      status: 'starting',
      pid: null,
      spawnedAt: new Date().toISOString(),
      lastActivity: null,
      tokensUsed: 0,
      contextUsage: 0,
    };

    this.agents.set(agent.id, agent);
    this.emit('change', this.getAll());
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
    const SAFE_FIELDS = ['status', 'pid', 'tokensUsed', 'contextUsage', 'lastActivity', 'model', 'name', 'routingMode', 'routingReason'];
    for (const key of Object.keys(updates)) {
      if (SAFE_FIELDS.includes(key)) {
        agent[key] = updates[key];
      }
    }
    agent.lastActivity = new Date().toISOString();
    this.emit('change', this.getAll());
    return agent;
  }

  remove(id) {
    const agent = this.agents.get(id);
    if (!agent) return false;

    this.agents.delete(id);
    this.emit('change', this.getAll());
    return true;
  }

  findByRole(role) {
    return this.getAll().filter((a) => a.role === role);
  }

  findByProvider(provider) {
    return this.getAll().filter((a) => a.provider === provider);
  }

  restore(agents) {
    for (const agent of agents) {
      agent.status = 'stopped';
      agent.pid = null;
      this.agents.set(agent.id, agent);
    }
    if (agents.length > 0) {
      this.emit('change', this.getAll());
    }
  }
}
