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

  async rotate(agentId, options = {}) {
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
      // 1. Record adaptive session so rotation thresholds learn over time
      const classifierEvents = this.daemon.classifier.agentWindows[agentId] || [];
      if (classifierEvents.length > 0) {
        const signals = this.daemon.adaptive.extractSignals(classifierEvents, agent.scope);
        this.daemon.adaptive.recordSession(agent.provider, agent.role, signals);
      }

      // Clear classifier window for the old agent
      this.daemon.classifier.clearAgent(agentId);

      // 2. Generate handoff brief from Journalist
      let brief = await journalist.generateHandoffBrief(agent);

      // Append additional prompt if provided (used by instruct/continue endpoints)
      if (options.additionalPrompt) {
        brief = brief + '\n\n## User Instruction\n\n' + options.additionalPrompt;
      }

      // 3. Record rotation history
      const record = {
        agentId: agent.id,
        agentName: agent.name,
        role: agent.role,
        provider: agent.provider,
        oldTokens: agent.tokensUsed,
        contextUsage: agent.contextUsage,
        timestamp: new Date().toISOString(),
      };

      // 4. Kill/clean up the old agent
      // processes.kill handles both alive and dead agents:
      // - alive: sends SIGTERM, waits for exit, removes from registry
      // - dead: just removes from registry and releases locks
      await processes.kill(agentId);

      // 5. Respawn with handoff brief as the prompt
      // Preserve auto routing mode so the router re-evaluates on respawn
      const routingMode = this.daemon.router.getMode(agentId);
      const respawnModel = routingMode.mode === 'auto' ? 'auto' : agent.model;

      const newAgent = await processes.spawn({
        role: agent.role,
        scope: agent.scope,
        provider: agent.provider,
        model: respawnModel,
        prompt: brief,
        permission: agent.permission || 'full',
        workingDir: agent.workingDir,
        name: agent.name, // Keep the same name for continuity
      });

      // Carry cumulative token stats so the dashboard shows lifetime totals
      if (agent.tokensUsed > 0) {
        registry.update(newAgent.id, { tokensUsed: agent.tokensUsed });
      }

      // Record rotation savings in token tracker
      this.daemon.tokens.recordRotation(agent.id, agent.tokensUsed);
      // Each rotation is a cold-start that the Journalist's handoff brief skips
      this.daemon.tokens.recordColdStartSkipped();

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
