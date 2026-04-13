// GROOVE — Context Rotation Engine
// FSL-1.1-Apache-2.0 — see LICENSE

import { EventEmitter } from 'events';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const DEFAULT_THRESHOLD = 0.75;
const HARD_CEILING = 0.85;  // Force rotate at 85% — no idle check, prevents compaction
const CHECK_INTERVAL = 15_000;
const QUALITY_THRESHOLD = 40;   // Score below this triggers quality rotation
const MIN_EVENTS = 10;          // Minimum classifier events before scoring
const MIN_AGE_SEC = 120;        // Minimum agent age before quality rotation
const SCORE_HISTORY_MAX = 40;   // ~10 min at 15s intervals

export class Rotator extends EventEmitter {
  constructor(daemon) {
    super();
    this.daemon = daemon;
    this.interval = null;
    this.rotationHistory = [];
    this.rotating = new Set();
    this.enabled = false;
    this.liveScores = {};
    this.scoreHistory = {};
    this.historyPath = daemon.grooveDir ? resolve(daemon.grooveDir, 'rotation-history.json') : null;
    this._loadHistory();
  }

  _loadHistory() {
    if (this.historyPath && existsSync(this.historyPath)) {
      try {
        const data = JSON.parse(readFileSync(this.historyPath, 'utf8'));
        this.rotationHistory = Array.isArray(data) ? data : [];
      } catch {
        this.rotationHistory = [];
      }
    }
    this._recoverFromTimeline();
  }

  _recoverFromTimeline() {
    if (!this.daemon.timeline) return;
    const events = this.daemon.timeline.getEvents(500);
    const rotateEvents = events.filter((e) => e.type === 'rotate');
    if (rotateEvents.length === 0) return;

    const existingTimestamps = new Set(this.rotationHistory.map((r) => r.timestamp));
    let added = 0;
    for (const e of rotateEvents) {
      const ts = new Date(e.t).toISOString();
      if (existingTimestamps.has(ts)) continue;
      this.rotationHistory.push({
        agentId: e.oldAgentId || e.agentId,
        agentName: e.agentName || 'unknown',
        role: e.role || 'unknown',
        provider: e.provider || 'unknown',
        oldTokens: e.tokensBefore || 0,
        contextUsage: 0,
        reason: e.reason || 'context_threshold',
        timestamp: ts,
        newAgentId: e.agentId,
        newTokens: 0,
      });
      added++;
    }
    if (added > 0) {
      this.rotationHistory.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      this._saveHistory();
    }
  }

  _saveHistory() {
    if (!this.historyPath) return;
    try {
      writeFileSync(this.historyPath, JSON.stringify(this.rotationHistory, null, 2));
    } catch { /* best-effort */ }
  }

  start() {
    if (this.interval) return;
    this.enabled = true;
    this.interval = setInterval(() => this.check(), CHECK_INTERVAL);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.enabled = false;
  }

  _idleMs(agent) {
    return agent.lastActivity
      ? Date.now() - new Date(agent.lastActivity).getTime()
      : Infinity;
  }

  scoreLiveSession(agent) {
    const events = this.daemon.classifier.agentWindows[agent.id] || [];
    const ageSec = (Date.now() - new Date(agent.spawnedAt).getTime()) / 1000;

    if (events.length < MIN_EVENTS || ageSec < MIN_AGE_SEC) {
      return { score: 70, signals: {}, hasEnoughData: false, ageSec: Math.round(ageSec), eventCount: events.length };
    }

    const signals = this.daemon.adaptive.extractSignals(events, agent.scope);
    let score = this.daemon.adaptive.scoreSession(signals);

    if (ageSec > 1800) score -= 5;
    if (ageSec > 3600) score -= 10;

    score = Math.max(0, Math.min(100, score));

    const result = { score, signals, hasEnoughData: true, ageSec: Math.round(ageSec), eventCount: events.length };
    this.liveScores[agent.id] = result;

    if (!this.scoreHistory[agent.id]) this.scoreHistory[agent.id] = [];
    const hist = this.scoreHistory[agent.id];
    hist.push({ t: Date.now(), s: score });
    if (hist.length > SCORE_HISTORY_MAX) hist.shift();

    return result;
  }

  async check() {
    const agents = this.daemon.registry.getAll();
    const running = agents.filter((a) => a.status === 'running');

    for (const agent of running) {
      if (this.rotating.has(agent.id)) continue;

      // Hard ceiling — force rotate to prevent compaction, even if agent is busy
      if (agent.contextUsage >= HARD_CEILING) {
        console.log(`  Rotator: ${agent.name} at ${Math.round(agent.contextUsage * 100)}% — FORCE rotating (hard ceiling)`);
        await this.rotate(agent.id, { reason: 'hard_ceiling' });
        continue;
      }

      const threshold = this.daemon.adaptive
        ? this.daemon.adaptive.getThreshold(agent.provider, agent.role)
        : DEFAULT_THRESHOLD;

      // Context-based rotation (original)
      if (agent.contextUsage >= threshold) {
        if (this._idleMs(agent) > 10_000) {
          console.log(`  Rotator: ${agent.name} at ${Math.round(agent.contextUsage * 100)}% — rotating (context)`);
          await this.rotate(agent.id, { reason: 'context_threshold' });
          continue;
        }
      }

      // Quality-based rotation — detects degradation before tokens are wasted
      const quality = this.scoreLiveSession(agent);
      if (quality.hasEnoughData && quality.score < QUALITY_THRESHOLD) {
        if (this._idleMs(agent) > 10_000) {
          console.log(`  Rotator: ${agent.name} quality=${quality.score} — rotating (quality)`);
          await this.rotate(agent.id, {
            reason: 'quality_degradation',
            qualityScore: quality.score,
            signals: quality.signals,
          });
          continue;
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
      reason: options.reason || 'manual',
    });

    try {
      const classifierEvents = this.daemon.classifier.agentWindows[agentId] || [];
      if (classifierEvents.length > 0) {
        const signals = this.daemon.adaptive.extractSignals(classifierEvents, agent.scope);
        this.daemon.adaptive.recordSession(agent.provider, agent.role, signals);
      }

      this.daemon.classifier.clearAgent(agentId);
      delete this.liveScores[agentId];
      delete this.scoreHistory[agentId];

      let brief = await journalist.generateHandoffBrief(agent, {
        reason: options.reason,
        qualityScore: options.qualityScore,
        signals: options.signals,
      });

      if (options.additionalPrompt) {
        brief = brief + '\n\n## User Instruction\n\n' + options.additionalPrompt;
      }

      // Persist to Layer 7 handoff chain so future rotations have causal continuity
      if (this.daemon.memory) {
        this.daemon.memory.appendHandoffBrief(agent.role, {
          timestamp: new Date().toISOString(),
          agentId: agent.id,
          newAgentId: null, // filled after respawn completes
          reason: options.reason || 'manual',
          oldTokens: agent.tokensUsed,
          contextUsage: agent.contextUsage,
          brief: brief.slice(0, 4000),
        });
      }

      const record = {
        agentId: agent.id,
        agentName: agent.name,
        role: agent.role,
        provider: agent.provider,
        oldTokens: agent.tokensUsed,
        contextUsage: agent.contextUsage,
        reason: options.reason || 'manual',
        qualityScore: options.qualityScore || null,
        timestamp: new Date().toISOString(),
      };

      await processes.kill(agentId);

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
        name: agent.name,
        teamId: agent.teamId,
      });

      if (agent.tokensUsed > 0) {
        registry.update(newAgent.id, { tokensUsed: agent.tokensUsed });
      }

      this.daemon.tokens.recordRotation(agent.id, agent.tokensUsed);
      this.daemon.tokens.recordColdStartSkipped();

      record.newAgentId = newAgent.id;
      record.newTokens = 0;
      this.rotationHistory.push(record);

      if (this.rotationHistory.length > 100) {
        this.rotationHistory = this.rotationHistory.slice(-100);
      }
      this._saveHistory();

      if (this.daemon.timeline) {
        this.daemon.timeline.recordEvent('rotate', {
          agentId: newAgent.id, oldAgentId: agentId,
          agentName: newAgent.name, role: agent.role,
          tokensBefore: agent.tokensUsed,
          reason: record.reason,
          qualityScore: record.qualityScore,
        });
      }

      this.daemon.broadcast({
        type: 'rotation:complete',
        agentId: newAgent.id,
        agentName: newAgent.name,
        oldAgentId: agentId,
        reason: record.reason,
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

  recordNaturalCompaction(agent, peakUsage, currentUsage) {
    const record = {
      agentId: agent.id,
      agentName: agent.name,
      role: agent.role,
      provider: agent.provider,
      oldTokens: agent.tokensUsed || 0,
      contextUsage: peakUsage,
      contextAfter: currentUsage,
      reason: 'natural_compaction',
      qualityScore: null,
      timestamp: new Date().toISOString(),
      newAgentId: agent.id,
      newTokens: agent.tokensUsed || 0,
    };

    this.rotationHistory.push(record);
    if (this.rotationHistory.length > 100) {
      this.rotationHistory = this.rotationHistory.slice(-100);
    }
    this._saveHistory();

    if (this.daemon.timeline) {
      this.daemon.timeline.recordEvent('rotate', {
        agentId: agent.id,
        agentName: agent.name,
        role: agent.role,
        reason: 'natural_compaction',
        contextBefore: peakUsage,
        contextAfter: currentUsage,
      });
    }

    this.daemon.broadcast({
      type: 'rotation:natural',
      agentId: agent.id,
      agentName: agent.name,
      peakUsage,
      currentUsage,
    });

    console.log(`  Rotator: ${agent.name} natural compaction detected (${Math.round(peakUsage * 100)}% → ${Math.round(currentUsage * 100)}%)`);
  }

  isRotating(agentId) {
    return this.rotating.has(agentId);
  }

  getHistory() {
    return this.rotationHistory;
  }

  getLiveScores() {
    return this.liveScores;
  }

  getStats() {
    const totalRotations = this.rotationHistory.length;
    const totalTokensSaved = this.rotationHistory.reduce((sum, r) => sum + (r.oldTokens || 0), 0);
    const qualityRotations = this.rotationHistory.filter((r) => r.reason === 'quality_degradation').length;
    const contextRotations = this.rotationHistory.filter((r) => r.reason === 'context_threshold').length;
    const naturalCompactions = this.rotationHistory.filter((r) => r.reason === 'natural_compaction').length;
    const hardCeilingRotations = this.rotationHistory.filter((r) => r.reason === 'hard_ceiling').length;
    return {
      enabled: this.enabled,
      totalRotations,
      totalTokensSaved,
      qualityRotations,
      contextRotations,
      naturalCompactions,
      hardCeilingRotations,
      rotating: Array.from(this.rotating),
      liveScores: this.liveScores,
      scoreHistory: this.scoreHistory,
    };
  }
}
