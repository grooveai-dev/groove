// GROOVE — Context Rotation Engine
// FSL-1.1-Apache-2.0 — see LICENSE

import { EventEmitter } from 'events';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { getProvider } from './providers/index.js';

const DEFAULT_THRESHOLD = 0.65;      // For non-self-managing providers (was 0.75)
const HARD_CEILING = 0.80;           // Force rotate (was 0.85) — only for non-self-managing
const CHECK_INTERVAL = 15_000;
const QUALITY_THRESHOLD = 40;   // Score below this triggers quality rotation
const MIN_EVENTS = 10;          // Minimum classifier events before scoring
const MIN_AGE_SEC = 120;        // Minimum agent age before quality rotation
const SCORE_HISTORY_MAX = 40;   // ~10 min at 15s intervals
const COOLDOWN_MS = 5 * 60 * 1000;   // 5 minutes between rotations per agent
const QUALITY_COOLDOWN_MS = 2 * 60 * 1000; // 2 minutes for quality degradation rotations
const TOKEN_CEILING = 5_000_000;     // 5M tokens per agent (non-self-managing only)
const ROLE_MULTIPLIERS = {
  planner: 2,
  fullstack: 4,
  security: 4,
  analyst: 5,
};

export class Rotator extends EventEmitter {
  constructor(daemon) {
    super();
    this.daemon = daemon;
    this.interval = null;
    this.rotationHistory = [];
    this.rotating = new Set();
    this.lastRotationTime = new Map(); // agentId -> timestamp of last rotation
    this._lastContextState = new Map(); // agentId -> { contextUsage, timestamp }
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

  _isOnCooldown(agentId, cooldownMs = COOLDOWN_MS) {
    const lastTime = this.lastRotationTime.get(agentId);
    if (!lastTime) return false;
    return (Date.now() - lastTime) < cooldownMs;
  }

  _getTokenCeiling(agent) {
    const multiplier = ROLE_MULTIPLIERS[agent.role] || 1;
    return TOKEN_CEILING * multiplier;
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

      // Skip agents idle for over 60s — no point scoring them every 15s
      const idleMs = this._idleMs(agent);
      if (idleMs > 60_000 && agent.contextUsage < HARD_CEILING) continue;

      // Determine if provider manages its own context (e.g. Claude Code compacts internally)
      const providerInstance = getProvider(agent.provider);
      const selfManagesContext = providerInstance?.constructor?.managesOwnContext ?? false;

      if (!selfManagesContext) {
        // Non-Claude: threshold + ceiling + quality rotation
        // These providers fill up linearly and degrade without external rotation

        // Hard ceiling — force rotate, no idle check, bypasses cooldown (safety override)
        if (agent.contextUsage >= HARD_CEILING) {
          console.log(`  Rotator: ${agent.name} at ${Math.round(agent.contextUsage * 100)}% — FORCE rotating (hard ceiling)`);
          await this.rotate(agent.id, { reason: 'hard_ceiling' });
          continue;
        }

        // Token ceiling — force rotate when total tokens exceed ceiling, bypasses cooldown
        const tokenCeiling = this._getTokenCeiling(agent);
        if (agent.tokensUsed >= tokenCeiling) {
          console.log(`  Rotator: ${agent.name} at ${(agent.tokensUsed || 0).toLocaleString()} tokens — FORCE rotating (token ceiling ${tokenCeiling.toLocaleString()})`);
          await this.rotate(agent.id, { reason: 'token_ceiling', tokensUsed: agent.tokensUsed, ceiling: tokenCeiling });
          continue;
        }

        // Stale context fallback — safety net for providers (like Codex) that don't
        // report intermediate contextUsage. If contextUsage hasn't changed in 120+
        // seconds but tokens are being consumed, estimate from total tokens.
        const knownCtx = this._lastContextState.get(agent.id);
        if (!knownCtx || knownCtx.contextUsage !== agent.contextUsage) {
          this._lastContextState.set(agent.id, { contextUsage: agent.contextUsage, timestamp: Date.now() });
        } else if (agent.tokensUsed > 0 && (Date.now() - knownCtx.timestamp) >= 120_000) {
          const providerClass = getProvider(agent.provider)?.constructor;
          const models = providerClass?.models || [];
          const model = models.find((m) => m.id === agent.model) || models[0];
          const maxContext = model?.maxContext || 200000;
          const estimatedContext = agent.tokensUsed / maxContext;
          if (estimatedContext >= HARD_CEILING) {
            console.log(`  Rotator: ${agent.name} estimated context ${Math.round(estimatedContext * 100)}% (stale contextUsage fallback)`);
            await this.rotate(agent.id, { reason: 'estimated_context_ceiling' });
            continue;
          }
        }

        // Cooldown — skip threshold/quality rotation if recently rotated
        if (this._isOnCooldown(agent.id)) continue;

        // Context threshold — rotate when idle
        const threshold = this.daemon.adaptive
          ? this.daemon.adaptive.getThreshold(agent.provider, agent.role)
          : DEFAULT_THRESHOLD;
        if (agent.contextUsage >= threshold) {
          if (this._idleMs(agent) > 10_000) {
            console.log(`  Rotator: ${agent.name} at ${Math.round(agent.contextUsage * 100)}% — rotating (context)`);
            await this.rotate(agent.id, { reason: 'context_threshold' });
            continue;
          }
        }
      }

      // Quality rotation uses a shorter cooldown (2 min vs 5 min) so degraded
      // agents don't persist producing bad output for 8-10 minutes
      if (this._isOnCooldown(agent.id, QUALITY_COOLDOWN_MS)) continue;

      // All providers: quality-based rotation — detects degradation before tokens are wasted
      const quality = this.scoreLiveSession(agent);
      if (quality.hasEnoughData && quality.score < QUALITY_THRESHOLD) {
        // Severe degradation (score < 25): rotate immediately regardless of idle state.
        // The agent is producing bad output — waiting for idle is counterproductive.
        if (quality.score < 25) {
          console.log(`  Rotator: ${agent.name} quality=${quality.score} — FORCE rotating (severe degradation)`);
          await this.rotate(agent.id, {
            reason: 'quality_degradation',
            qualityScore: quality.score,
            signals: quality.signals,
          });
          continue;
        }
        // Moderate degradation (25-40): rotate when idle
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
          newAgentId: null,
          reason: options.reason || 'manual',
          oldTokens: agent.tokensUsed,
          contextUsage: agent.contextUsage,
          brief: brief.slice(0, 4000),
        }, agent.workingDir, agent.teamId);
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

      processes._rotatingAgents.add(agentId);
      await processes.kill(agentId);

      const routingMode = this.daemon.router.getMode(agentId);
      const respawnModel = routingMode.mode === 'auto' ? 'auto' : agent.model;

      // Remove old agent BEFORE spawning so registry.add() won't dedup the name
      // (appending "-2", "-2-2", etc.). Save config in case we need to re-add on failure.
      const savedConfig = { ...agent };
      registry.remove(agentId);
      this.daemon.locks.release(agentId);

      let newAgent;
      try {
        newAgent = await processes.spawn({
          role: agent.role,
          scope: agent.scope,
          provider: agent.provider,
          model: respawnModel,
          prompt: brief,
          permission: agent.permission || 'full',
          workingDir: agent.workingDir,
          name: agent.name,
          teamId: agent.teamId,
          isRotation: true,
        });
      } catch (spawnErr) {
        // Spawn failed — re-add old agent so the user can see and retry.
        registry.add({
          role: savedConfig.role, scope: savedConfig.scope, provider: savedConfig.provider,
          model: savedConfig.model, prompt: savedConfig.prompt, permission: savedConfig.permission,
          workingDir: savedConfig.workingDir, name: savedConfig.name, teamId: savedConfig.teamId,
        });
        console.error(`[Groove] Rotation spawn failed for ${agent.name}: ${spawnErr.message}`);
        throw spawnErr;
      }

      if (agent.tokensUsed > 0) {
        registry.update(newAgent.id, { tokensUsed: agent.tokensUsed });
      }

      this.daemon.tokens.recordRotation(agent.id, agent.tokensUsed);
      this.daemon.tokens.recordColdStartSkipped();

      record.newAgentId = newAgent.id;
      record.newTokens = 0;
      this.lastRotationTime.set(newAgent.id, Date.now());
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

      // Schedule post-rotation quality validation: after the new agent produces
      // enough events, compare its quality to the old agent's last score.
      // If rotation didn't help, log a warning and record it for adaptive tuning.
      if (options.qualityScore != null) {
        this._schedulePostRotationCheck(newAgent.id, options.qualityScore, record);
      }

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

  _schedulePostRotationCheck(newAgentId, oldQualityScore, record) {
    // Wait for the new agent to accumulate MIN_EVENTS classifier events,
    // checking every 15s for up to 5 minutes (20 checks)
    let checks = 0;
    const maxChecks = 20;
    const checkInterval = setInterval(() => {
      checks++;
      const agent = this.daemon.registry.get(newAgentId);
      if (!agent || agent.status !== 'running' || checks >= maxChecks) {
        clearInterval(checkInterval);
        return;
      }

      const events = this.daemon.classifier.agentWindows[newAgentId] || [];
      if (events.length < MIN_EVENTS) return; // not enough data yet

      clearInterval(checkInterval);

      const newQuality = this.scoreLiveSession(agent);
      if (!newQuality.hasEnoughData) return;

      if (newQuality.score < oldQualityScore) {
        console.warn(`  Rotator: Post-rotation check — ${agent.name} quality ${newQuality.score} is LOWER than pre-rotation ${oldQualityScore}. Rotation did not improve quality.`);

        // Record for adaptive threshold adjustment
        if (this.daemon.adaptive) {
          this.daemon.adaptive.recordRotationOutcome({
            agentId: newAgentId,
            role: agent.role,
            provider: agent.provider,
            oldScore: oldQualityScore,
            newScore: newQuality.score,
            improved: false,
            reason: record.reason,
            timestamp: new Date().toISOString(),
          });
        }

        if (this.daemon.timeline) {
          this.daemon.timeline.recordEvent('rotate', {
            agentId: newAgentId,
            agentName: agent.name,
            role: agent.role,
            reason: 'post_rotation_check',
            qualityBefore: oldQualityScore,
            qualityAfter: newQuality.score,
            improved: false,
          });
        }
      }
    }, CHECK_INTERVAL);
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
    const tokenCeilingRotations = this.rotationHistory.filter((r) => r.reason === 'token_ceiling').length;
    const estimatedCeilingRotations = this.rotationHistory.filter((r) => r.reason === 'estimated_context_ceiling').length;
    return {
      enabled: this.enabled,
      totalRotations,
      totalTokensSaved,
      qualityRotations,
      contextRotations,
      naturalCompactions,
      hardCeilingRotations,
      tokenCeilingRotations,
      estimatedCeilingRotations,
      rotating: Array.from(this.rotating),
      liveScores: this.liveScores,
      scoreHistory: this.scoreHistory,
      defaultThreshold: DEFAULT_THRESHOLD,
      hardCeiling: HARD_CEILING,
      qualityThreshold: QUALITY_THRESHOLD,
      cooldownMs: COOLDOWN_MS,
      tokenCeiling: TOKEN_CEILING,
      roleMultipliers: ROLE_MULTIPLIERS,
    };
  }
}
