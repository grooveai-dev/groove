// GROOVE — Context Rotation Engine
// FSL-1.1-Apache-2.0 — see LICENSE

import { EventEmitter } from 'events';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const DEFAULT_THRESHOLD = 0.75;
const CHECK_INTERVAL = 15_000;
const QUALITY_THRESHOLD = 55;   // Score below this triggers quality rotation (tuned up from 40 — too hair-trigger)
const MIN_EVENTS = 30;          // Minimum classifier events before scoring (tuned up from 10 — ~100 turns for stable signal)
const MIN_AGE_SEC = 120;        // Minimum agent age before quality rotation
const SCORE_HISTORY_MAX = 40;   // ~10 min at 15s intervals
const ROTATION_COOLDOWN_MS = 5 * 60 * 1000; // 5 min between rotations per agent — prevents churn on persistent low quality

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

  // Check if this agent rotated recently. Prevents back-to-back rotation
  // churn when quality score stays low post-rotation (e.g. genuinely hard task).
  // Safety triggers bypass cooldown — pathological burn must be stopped.
  _isInCooldown(agent) {
    const last = [...this.rotationHistory]
      .reverse()
      .find((r) => r.newAgentId === agent.id || r.agentId === agent.id);
    if (!last) return false;
    const elapsed = Date.now() - new Date(last.timestamp).getTime();
    return elapsed < ROTATION_COOLDOWN_MS;
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

  // Per-role safety multipliers. Exploration-heavy roles burn tokens fast
  // by design (reading codebases, searching files) — a planner running
  // normally can hit 2M+ tokens in 5 min just reading. One-size-fits-all
  // thresholds produce false positives on exactly the roles that need to
  // read fast. Multipliers scale both the velocity threshold and the
  // instance ceiling. User can override via config.safety.roleMultipliers.
  _getRoleMultiplier(role) {
    const safety = this.daemon.config?.safety;
    const overrides = safety?.roleMultipliers || {};
    if (overrides[role] != null) return overrides[role];
    // Defaults tuned from observed legitimate velocity
    const defaults = {
      planner: 10,    // heavy exploration — effectively exempt in practice
      fullstack: 4,   // QC auditors read broadly
      analyst: 5,     // research/analysis roles
      security: 4,    // audit roles
      docs: 1,        // focused edits
    };
    return defaults[role] || 1;
  }

  // Safety triggers — runaway agent detection. Scoped to `spawnedAt` so
  // a rotation doesn't re-trigger on inherited cumulative tokens.
  _checkSafetyTriggers(agent) {
    const safety = this.daemon.config?.safety;
    if (!safety || safety.autoRotate === false) return null;
    if (!this.daemon.tokens || !agent.spawnedAt) return null;

    const multiplier = this._getRoleMultiplier(agent.role);
    const spawnedAtMs = new Date(agent.spawnedAt).getTime();

    const baseCeiling = safety.tokenCeilingPerAgent;
    const ceiling = baseCeiling > 0 ? Math.round(baseCeiling * multiplier) : 0;
    if (ceiling > 0) {
      const instanceTokens = this.daemon.tokens.getTokensInWindow(agent.id, spawnedAtMs);
      if (instanceTokens >= ceiling) {
        return {
          reason: 'token_limit_exceeded',
          instanceTokens,
          ceiling,
          multiplier,
        };
      }
    }

    const windowMs = (safety.velocityWindowSeconds || 300) * 1000;
    const baseVelocityThreshold = safety.velocityTokenThreshold;
    const velocityThreshold = baseVelocityThreshold > 0
      ? Math.round(baseVelocityThreshold * multiplier)
      : 0;
    if (velocityThreshold > 0) {
      const velocity = this.daemon.tokens.getVelocity(agent.id, windowMs);
      if (velocity >= velocityThreshold) {
        return {
          reason: 'runaway_velocity',
          velocity,
          windowMs,
          threshold: velocityThreshold,
          multiplier,
        };
      }
    }

    return null;
  }

  // Compute post-rotation velocity for rotations that are old enough to
  // have meaningful data. Replaces hardcoded savings assumptions with
  // measured deltas. Positive velocityDelta = rotation reduced burn rate.
  _finalizeRotationMeasurements() {
    if (!this.daemon.tokens?.getVelocity) return;
    const now = Date.now();
    let modified = false;
    for (const record of this.rotationHistory) {
      if (record.postRotationVelocity != null) continue;
      if (record.preRotationVelocity == null) continue;
      if (!record.newAgentId) continue;
      const rotatedAt = new Date(record.timestamp).getTime();
      if (now - rotatedAt < 600_000) continue; // need 10 min of post-data
      const postVelocity = this.daemon.tokens.getVelocity(record.newAgentId, 600_000);
      record.postRotationVelocity = postVelocity;
      record.velocityDelta = record.preRotationVelocity - postVelocity;
      modified = true;
    }
    if (modified) this._saveHistory();
  }

  async check() {
    this._finalizeRotationMeasurements();

    const agents = this.daemon.registry.getAll();
    const running = agents.filter((a) => a.status === 'running');

    for (const agent of running) {
      if (this.rotating.has(agent.id)) continue;

      // Safety triggers — highest priority, pathological behavior.
      // Bypasses cooldown: pathological burn must be stopped immediately.
      const safety = this._checkSafetyTriggers(agent);
      if (safety) {
        const summary = safety.reason === 'token_limit_exceeded'
          ? `${safety.instanceTokens} tokens >= ${safety.ceiling} ceiling`
          : `${safety.velocity} tokens in ${safety.windowMs / 1000}s >= ${safety.threshold} threshold`;
        console.log(`  Rotator: ${agent.name} ${safety.reason} (${summary}) — auto-rotating`);
        await this.rotate(agent.id, safety);
        continue;
      }

      // Cooldown check — skip threshold-based rotations if agent just rotated.
      // Gives the new instance time to stabilize before another judgment.
      if (this._isInCooldown(agent)) continue;

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

      // Quality-based rotation — detects degradation before tokens are wasted.
      // Converged provider:role profiles have stable thresholds already, so
      // skip quality rotation there unless score is catastrophically low.
      const quality = this.scoreLiveSession(agent);
      if (quality.hasEnoughData && quality.score < QUALITY_THRESHOLD) {
        const profile = this.daemon.adaptive?.getProfile?.(agent.provider, agent.role);
        const converged = profile?.converged;
        // If converged, require a deeper score drop before rotating
        const floor = converged ? QUALITY_THRESHOLD - 15 : QUALITY_THRESHOLD;
        if (quality.score < floor && this._idleMs(agent) > 10_000) {
          console.log(`  Rotator: ${agent.name} quality=${quality.score}${converged ? ' (converged profile)' : ''} — rotating (quality)`);
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

      let brief = await journalist.generateHandoffBrief(agent);

      if (options.additionalPrompt) {
        brief = brief + '\n\n## User Instruction\n\n' + options.additionalPrompt;
      }

      // Capture pre-rotation velocity (tokens/10min) so we can later measure
      // whether the rotation actually improved token efficiency. Stored in
      // history; finalized by _finalizeRotationMeasurements() on later ticks.
      const preRotationVelocity = this.daemon.tokens?.getVelocity
        ? this.daemon.tokens.getVelocity(agent.id, 600_000)
        : null;

      const record = {
        agentId: agent.id,
        agentName: agent.name,
        role: agent.role,
        provider: agent.provider,
        oldTokens: agent.tokensUsed,
        contextUsage: agent.contextUsage,
        reason: options.reason || 'manual',
        qualityScore: options.qualityScore || null,
        instanceTokens: options.instanceTokens || null,
        velocity: options.velocity || null,
        preRotationVelocity,
        postRotationVelocity: null,
        velocityDelta: null,
        timestamp: new Date().toISOString(),
      };

      // Capture per-session signals for specialization tracking before we clear
      const sessionSignals = classifierEvents.length > 0
        ? this.daemon.adaptive.extractSignals(classifierEvents, agent.scope)
        : null;
      const sessionScore = sessionSignals
        ? this.daemon.adaptive.scoreSession(sessionSignals)
        : null;

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

      // Append to persistent handoff chain (Layer 7 memory)
      // so agent #50 knows what agent #1 struggled with.
      if (this.daemon.memory) {
        this.daemon.memory.appendHandoffBrief(agent.role, {
          agentId: agent.id,
          newAgentId: newAgent.id,
          reason: record.reason,
          oldTokens: agent.tokensUsed,
          contextUsage: agent.contextUsage,
          brief,
          timestamp: record.timestamp,
        });

        // Update per-agent + per-role specialization profile
        const files = Array.from(new Set(
          classifierEvents
            .map((e) => e.input || e.file || e.path)
            .filter((f) => typeof f === 'string' && f.length > 0)
            .slice(-20)
        ));
        this.daemon.memory.updateSpecialization(agent.id, {
          role: agent.role,
          qualityScore: sessionScore,
          filesTouched: files,
          signals: sessionSignals,
          threshold: this.daemon.adaptive?.getThreshold(agent.provider, agent.role),
        });
      }

      if (this.daemon.timeline) {
        this.daemon.timeline.recordEvent('rotate', {
          agentId: newAgent.id, oldAgentId: agentId,
          agentName: newAgent.name, role: agent.role,
          tokensBefore: agent.tokensUsed,
          reason: record.reason,
          qualityScore: record.qualityScore,
          instanceTokens: record.instanceTokens,
          velocity: record.velocity,
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
    const tokenLimitRotations = this.rotationHistory.filter((r) => r.reason === 'token_limit_exceeded').length;
    const velocityRotations = this.rotationHistory.filter((r) => r.reason === 'runaway_velocity').length;
    return {
      enabled: this.enabled,
      totalRotations,
      totalTokensSaved,
      qualityRotations,
      contextRotations,
      naturalCompactions,
      tokenLimitRotations,
      velocityRotations,
      rotating: Array.from(this.rotating),
      liveScores: this.liveScores,
      scoreHistory: this.scoreHistory,
    };
  }
}
