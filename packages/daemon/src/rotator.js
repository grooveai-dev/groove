// GROOVE — Context Rotation Engine
// FSL-1.1-Apache-2.0 — see LICENSE

import { EventEmitter } from 'events';

const DEFAULT_THRESHOLD = 0.75; // 75% context usage triggers rotation
const CHECK_INTERVAL = 15_000; // Check every 15 seconds

export class Rotator extends EventEmitter {
  constructor(daemon) {
    super();
    this.daemon = daemon;
    this.interval = null;
    this.rotationHistory = []; // [{ agentId, agentName, oldTokens, timestamp, brief }]
    this.rotating = new Set(); // Agent IDs currently being rotated
    this.enabled = false;
  }

  start() {
    if (this.interval) return;
    this.enabled = true;
    this.interval = setInterval(() => this.check(), CHECK_INTERVAL);
    console.log('  Rotator started (auto-rotation enabled)');
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.enabled = false;
  }

  async check() {
    const agents = this.daemon.registry.getAll();
    const running = agents.filter((a) => a.status === 'running');

    for (const agent of running) {
      if (this.rotating.has(agent.id)) continue;

      const threshold = this.daemon.adaptive
        ? this.daemon.adaptive.getThreshold(agent.provider, agent.role)
        : DEFAULT_THRESHOLD;

      if (agent.contextUsage >= threshold) {
        // Check for natural pause: if agent has been idle for >10s
        const idleMs = agent.lastActivity
          ? Date.now() - new Date(agent.lastActivity).getTime()
          : Infinity;

        if (idleMs > 10_000) {
          console.log(`  Rotator: ${agent.name} at ${Math.round(agent.contextUsage * 100)}% — rotating`);
          await this.rotate(agent.id);
        }
      }
    }
  }

  async rotate(agentId) {
    const { registry, processes, journalist } = this.daemon;
    const agent = registry.get(agentId);
    if (!agent) throw new Error(`Agent ${agentId} not found`);
    if (this.rotating.has(agentId)) throw new Error(`Agent ${agentId} is already rotating`);

    this.rotating.add(agentId);

    this.daemon.broadcast({
      type: 'rotation:start',
      agentId,
      agentName: agent.name,
    });

    try {
      // 1. Generate handoff brief from Journalist
      const brief = await journalist.generateHandoffBrief(agent);

      // 2. Record rotation history
      const record = {
        agentId: agent.id,
        agentName: agent.name,
        role: agent.role,
        provider: agent.provider,
        oldTokens: agent.tokensUsed,
        contextUsage: agent.contextUsage,
        timestamp: new Date().toISOString(),
      };

      // 3. Kill the old process
      await processes.kill(agentId);

      // 4. Respawn with handoff brief as the prompt
      const newAgent = await processes.spawn({
        role: agent.role,
        scope: agent.scope,
        provider: agent.provider,
        model: agent.model,
        prompt: brief,
        workingDir: agent.workingDir,
        name: agent.name, // Keep the same name for continuity
      });

      record.newAgentId = newAgent.id;
      record.newTokens = 0;
      this.rotationHistory.push(record);

      // Keep last 100 rotations
      if (this.rotationHistory.length > 100) {
        this.rotationHistory = this.rotationHistory.slice(-100);
      }

      this.daemon.broadcast({
        type: 'rotation:complete',
        agentId: newAgent.id,
        agentName: newAgent.name,
        oldAgentId: agentId,
        tokensSaved: agent.tokensUsed,
      });

      this.emit('rotation', record);

      return newAgent;
    } catch (err) {
      this.daemon.broadcast({
        type: 'rotation:failed',
        agentId,
        error: err.message,
      });
      throw err;
    } finally {
      this.rotating.delete(agentId);
    }
  }

  isRotating(agentId) {
    return this.rotating.has(agentId);
  }

  getHistory() {
    return this.rotationHistory;
  }

  getStats() {
    const totalRotations = this.rotationHistory.length;
    const totalTokensSaved = this.rotationHistory.reduce((sum, r) => sum + r.oldTokens, 0);
    return {
      enabled: this.enabled,
      totalRotations,
      totalTokensSaved,
      rotating: Array.from(this.rotating),
    };
  }
}
