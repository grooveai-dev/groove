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
      timestamp: new Date().toISOString(),
    });

    this.save();
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

  getCacheHitRate() {
    let totalRead = 0, totalCreation = 0, totalInput = 0;
    for (const a of Object.values(this.usage)) {
      totalRead += a.cacheReadTokens || 0;
      totalCreation += a.cacheCreationTokens || 0;
      totalInput += a.inputTokens || 0;
    }
    const total = totalRead + totalCreation + totalInput;
    return total > 0 ? totalRead / total : 0;
  }

  // Generate a savings summary
  getSummary() {
    const totalTokens = this.getTotal();
    const totalCostUsd = this.getTotalCost();
    const agentCount = Object.keys(this.usage).length;
    const sessionDuration = Date.now() - this.sessionStart;

    // Aggregate I/O and cache breakdown
    let totalInputTokens = 0, totalOutputTokens = 0;
    let totalCacheRead = 0, totalCacheCreation = 0;
    let totalDurationMs = 0, totalTurns = 0;
    let realCostUsd = 0, estimatedCostUsd = 0;

    for (const a of Object.values(this.usage)) {
      totalInputTokens += a.inputTokens || 0;
      totalOutputTokens += a.outputTokens || 0;
      totalCacheRead += a.cacheReadTokens || 0;
      totalCacheCreation += a.cacheCreationTokens || 0;
      totalDurationMs += a.totalDurationMs || 0;
      totalTurns += a.totalTurns || 0;
    }

    // Estimate what uncoordinated usage would have cost
    const coldStartOverhead = this.getColdStartOverhead();
    const coldStartWaste = this.coldStartsSkipped * coldStartOverhead;
    const conflictWaste = this.conflictsPrevented * CONFLICT_OVERHEAD;
    const totalSavings = this.rotationSavings + coldStartWaste + conflictWaste;

    const estimatedWithout = totalTokens + totalSavings;
    const savingsPct = estimatedWithout > 0
      ? Math.round((totalSavings / estimatedWithout) * 100)
      : 0;

    const cacheTotal = totalCacheRead + totalCacheCreation + totalInputTokens;
    const cacheHitRate = cacheTotal > 0 ? totalCacheRead / cacheTotal : 0;

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
        total: totalSavings,
        fromRotation: this.rotationSavings,
        fromConflictPrevention: conflictWaste,
        fromColdStartSkip: coldStartWaste,
        percentage: savingsPct,
        estimatedWithoutGroove: estimatedWithout,
      },
      perAgent: Object.entries(this.usage).map(([id, data]) => ({
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
