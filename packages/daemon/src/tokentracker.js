// GROOVE — Token Tracker with Savings Calculator
// FSL-1.1-Apache-2.0 — see LICENSE

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// Base tokens wasted per cold-start (minimum overhead for any project)
const COLD_START_BASE = 3000;
// Additional tokens per file the agent would scan during cold discovery
const COLD_START_PER_FILE = 15;
// Additional tokens per directory traversed
const COLD_START_PER_DIR = 40;
// Estimated tokens wasted per file conflict (agent discovers, backs off, retries)
const CONFLICT_OVERHEAD = 500;

export class TokenTracker {
  constructor(grooveDir) {
    this.path = resolve(grooveDir, 'tokens.json');
    this.usage = {};
    this.sessionStart = Date.now();
    this.rotationSavings = 0;
    this.conflictsPrevented = 0;
    this.coldStartsSkipped = 0;
    this.projectFiles = 0;   // Set from indexer stats
    this.projectDirs = 0;
    this.load();
  }

  load() {
    if (existsSync(this.path)) {
      try {
        const data = JSON.parse(readFileSync(this.path, 'utf8'));
        this.usage = data.usage || data; // Handle both old and new format
        this.rotationSavings = data.rotationSavings || 0;
        this.conflictsPrevented = data.conflictsPrevented || 0;
        this.coldStartsSkipped = data.coldStartsSkipped || 0;
        // Migrate old format entries (number-only totals)
        for (const [id, entry] of Object.entries(this.usage)) {
          if (typeof entry === 'number') {
            this.usage[id] = { total: entry, sessions: [] };
          }
          if (!entry.totalCostUsd) entry.totalCostUsd = 0;
          if (!entry.inputTokens) entry.inputTokens = 0;
          if (!entry.outputTokens) entry.outputTokens = 0;
          if (!entry.cacheReadTokens) entry.cacheReadTokens = 0;
          if (!entry.cacheCreationTokens) entry.cacheCreationTokens = 0;
          if (!entry.totalDurationMs) entry.totalDurationMs = 0;
          if (!entry.totalTurns) entry.totalTurns = 0;
          if (!entry.modelDistribution) entry.modelDistribution = {};
        }
      } catch {
        this.usage = {};
      }
    }
  }

  save() {
    writeFileSync(this.path, JSON.stringify({
      usage: this.usage,
      rotationSavings: this.rotationSavings,
      conflictsPrevented: this.conflictsPrevented,
      coldStartsSkipped: this.coldStartsSkipped,
      lastSaved: new Date().toISOString(),
    }, null, 2));
  }

  _initAgent(agentId) {
    if (!this.usage[agentId]) {
      this.usage[agentId] = {
        total: 0,
        totalCostUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        totalDurationMs: 0,
        totalTurns: 0,
        modelDistribution: {},
        sessions: [],
      };
    }
  }

  record(agentId, detail) {
    this._initAgent(agentId);
    const entry = this.usage[agentId];

    // Backward compat: accept a plain number
    if (typeof detail === 'number') {
      entry.total += detail;
      entry.sessions.push({ tokens: detail, timestamp: new Date().toISOString() });
      this.save();
      return;
    }

    const tokens = detail.tokens || 0;
    entry.total += tokens;
    entry.inputTokens += detail.inputTokens || 0;
    entry.outputTokens += detail.outputTokens || 0;
    entry.cacheReadTokens += detail.cacheReadTokens || 0;
    entry.cacheCreationTokens += detail.cacheCreationTokens || 0;

    if (detail.model) {
      entry.modelDistribution[detail.model] = (entry.modelDistribution[detail.model] || 0) + tokens;
    }

    // Estimated cost from non-Claude providers
    if (detail.estimatedCostUsd) {
      entry.totalCostUsd += detail.estimatedCostUsd;
    }

    entry.sessions.push({
      tokens,
      inputTokens: detail.inputTokens || 0,
      outputTokens: detail.outputTokens || 0,
      cacheReadTokens: detail.cacheReadTokens || 0,
      cacheCreationTokens: detail.cacheCreationTokens || 0,
      model: detail.model || null,
      // Reserved for future per-project grouping (workspaces feature).
      // Caller passes the project's absolute root path when known.
      projectRoot: detail.projectRoot || null,
      timestamp: new Date().toISOString(),
    });

    this.save();
  }

  // Sum tokens recorded for an agent since a given timestamp.
  // Used by safety rotation triggers to measure per-instance burn
  // (scoped to spawnedAt avoids counting pre-rotation history).
  getTokensInWindow(agentId, sinceTs) {
    const entry = this.usage[agentId];
    if (!entry || !Array.isArray(entry.sessions)) return 0;
    const cutoff = typeof sinceTs === 'number' ? sinceTs : new Date(sinceTs).getTime();
    let total = 0;
    for (const session of entry.sessions) {
      const ts = new Date(session.timestamp).getTime();
      if (ts >= cutoff) total += session.tokens || 0;
    }
    return total;
  }

  // Rolling velocity: tokens consumed in the last `windowMs` milliseconds.
  getVelocity(agentId, windowMs) {
    return this.getTokensInWindow(agentId, Date.now() - windowMs);
  }

  // Record session-level result data (cost, duration, turns) — fires once per completion
  recordResult(agentId, { costUsd, durationMs, turns }) {
    this._initAgent(agentId);
    const entry = this.usage[agentId];
    if (costUsd) entry.totalCostUsd += costUsd;
    if (durationMs) entry.totalDurationMs += durationMs;
    if (turns) entry.totalTurns += turns;
    this.save();
  }

  // Record that a rotation saved context tokens
  recordRotation(agentId, tokensBefore) {
    this.rotationSavings += Math.round(tokensBefore * 0.3); // ~30% of context was degraded
    this.save();
  }

  // Record that a conflict was prevented (scope enforcement)
  recordConflictPrevented() {
    this.conflictsPrevented++;
    this.save();
  }

  // Record that a cold-start was skipped (Journalist provided context)
  recordColdStartSkipped() {
    this.coldStartsSkipped++;
    this.save();
  }

  // Set project size from indexer for dynamic cold-start estimation
  setProjectStats(totalFiles, totalDirs) {
    this.projectFiles = totalFiles || 0;
    this.projectDirs = totalDirs || 0;
  }

  // Calculate cold-start overhead based on project size
  getColdStartOverhead() {
    return COLD_START_BASE
      + (this.projectFiles * COLD_START_PER_FILE)
      + (this.projectDirs * COLD_START_PER_DIR);
  }

  getAgent(agentId) {
    return this.usage[agentId] || { total: 0, sessions: [] };
  }

  getAll() {
    return this.usage;
  }

  getTotal() {
    return Object.values(this.usage).reduce((sum, a) => sum + a.total, 0);
  }

  getTotalCost() {
    return Object.values(this.usage).reduce((sum, a) => sum + (a.totalCostUsd || 0), 0);
  }

  // Cache hit rate = cache reads / all cacheable input (reads + creation).
  // Fresh inputTokens are conversation turns that were never cache-eligible,
  // so they must be excluded from the denominator.
  getCacheHitRate() {
    let totalRead = 0, totalCreation = 0;
    for (const a of Object.values(this.usage)) {
      totalRead += a.cacheReadTokens || 0;
      totalCreation += a.cacheCreationTokens || 0;
    }
    const cacheable = totalRead + totalCreation;
    return cacheable > 0 ? totalRead / cacheable : 0;
  }

  // Generate a savings summary
  getSummary() {
    const totalTokens = this.getTotal();
    const totalCostUsd = this.getTotalCost();
    const sessionDuration = Date.now() - this.sessionStart;

    let totalInputTokens = 0, totalOutputTokens = 0;
    let totalCacheRead = 0, totalCacheCreation = 0;
    let totalDurationMs = 0, totalTurns = 0;

    for (const a of Object.values(this.usage)) {
      totalInputTokens += a.inputTokens || 0;
      totalOutputTokens += a.outputTokens || 0;
      totalCacheRead += a.cacheReadTokens || 0;
      totalCacheCreation += a.cacheCreationTokens || 0;
      totalDurationMs += a.totalDurationMs || 0;
      totalTurns += a.totalTurns || 0;
    }

    // Segregate internal overhead (reserved IDs prefixed __) from user agents.
    // Internal tokens still count in totals (real billing) but show separately.
    const userEntries = Object.entries(this.usage).filter(([id]) => !id.startsWith('__'));
    const internalEntries = Object.entries(this.usage).filter(([id]) => id.startsWith('__'));
    const agentCount = userEntries.length;

    const internalComponents = {};
    let internalTokens = 0;
    let internalCostUsd = 0;
    for (const [id, data] of internalEntries) {
      internalComponents[id] = {
        tokens: data.total,
        costUsd: data.totalCostUsd || 0,
        inputTokens: data.inputTokens || 0,
        outputTokens: data.outputTokens || 0,
        cacheReadTokens: data.cacheReadTokens || 0,
        cacheCreationTokens: data.cacheCreationTokens || 0,
        sessions: data.sessions.length,
      };
      internalTokens += data.total;
      internalCostUsd += data.totalCostUsd || 0;
    }

    const coldStartOverhead = this.getColdStartOverhead();
    const coldStartWaste = this.coldStartsSkipped * coldStartOverhead;
    const conflictWaste = this.conflictsPrevented * CONFLICT_OVERHEAD;
    const coordinationSavings = this.rotationSavings + coldStartWaste + conflictWaste;

    const estimatedWithout = totalTokens + coordinationSavings;
    const rawPct = estimatedWithout > 0 ? (coordinationSavings / estimatedWithout) * 100 : 0;
    const coordPct = rawPct > 0 && rawPct < 1
      ? Math.round(rawPct * 10) / 10
      : Math.round(rawPct);

    // Cache hit rate: reads / (reads + creation). Excludes fresh inputTokens
    // which are never cache-eligible.
    const cacheable = totalCacheRead + totalCacheCreation;
    const cacheHitRate = cacheable > 0 ? totalCacheRead / cacheable : 0;

    return {
      totalTokens,
      totalCostUsd,
      totalInputTokens,
      totalOutputTokens,
      cacheReadTokens: totalCacheRead,
      cacheCreationTokens: totalCacheCreation,
      cacheHitRate: Math.round(cacheHitRate * 1000) / 1000,
      avgSessionDurationMs: agentCount > 0 ? Math.round(totalDurationMs / agentCount) : 0,
      totalTurns,
      agentCount,
      sessionDurationMs: sessionDuration,
      savings: {
        total: coordinationSavings,
        fromRotation: this.rotationSavings,
        fromConflictPrevention: conflictWaste,
        fromColdStartSkip: coldStartWaste,
        percentage: coordPct,
        estimatedWithoutGroove: estimatedWithout,
      },
      internalOverhead: {
        tokens: internalTokens,
        costUsd: internalCostUsd,
        components: internalComponents,
      },
      perAgent: userEntries.map(([id, data]) => ({
        agentId: id,
        tokens: data.total,
        costUsd: data.totalCostUsd || 0,
        inputTokens: data.inputTokens || 0,
        outputTokens: data.outputTokens || 0,
        cacheReadTokens: data.cacheReadTokens || 0,
        cacheCreationTokens: data.cacheCreationTokens || 0,
        durationMs: data.totalDurationMs || 0,
        turns: data.totalTurns || 0,
        modelDistribution: data.modelDistribution || {},
        sessions: data.sessions.length,
      })),
    };
  }
}
