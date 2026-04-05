// GROOVE — Token Tracker with Savings Calculator
// FSL-1.1-Apache-2.0 — see LICENSE

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// Estimated tokens wasted per cold-start without GROOVE context
const COLD_START_OVERHEAD = 2000;
// Estimated tokens wasted per file conflict (agent discovers, backs off, retries)
const CONFLICT_OVERHEAD = 500;

export class TokenTracker {
  constructor(grooveDir) {
    this.path = resolve(grooveDir, 'tokens.json');
    this.usage = {};
    this.sessionStart = Date.now();
    this.rotationSavings = 0; // Tokens saved by rotation (context that would have degraded)
    this.conflictsPrevented = 0;
    this.coldStartsSkipped = 0;
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

  record(agentId, tokens) {
    if (!this.usage[agentId]) {
      this.usage[agentId] = { total: 0, sessions: [] };
    }
    this.usage[agentId].total += tokens;
    this.usage[agentId].sessions.push({
      tokens,
      timestamp: new Date().toISOString(),
    });
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

  getAgent(agentId) {
    return this.usage[agentId] || { total: 0, sessions: [] };
  }

  getAll() {
    return this.usage;
  }

  getTotal() {
    return Object.values(this.usage).reduce((sum, a) => sum + a.total, 0);
  }

  // Generate a savings summary
  getSummary() {
    const totalTokens = this.getTotal();
    const agentCount = Object.keys(this.usage).length;
    const sessionDuration = Date.now() - this.sessionStart;

    // Estimate what uncoordinated usage would have cost
    const coldStartWaste = this.coldStartsSkipped * COLD_START_OVERHEAD;
    const conflictWaste = this.conflictsPrevented * CONFLICT_OVERHEAD;
    const totalSavings = this.rotationSavings + coldStartWaste + conflictWaste;

    const estimatedWithout = totalTokens + totalSavings;
    const savingsPct = estimatedWithout > 0
      ? Math.round((totalSavings / estimatedWithout) * 100)
      : 0;

    return {
      totalTokens,
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
        sessions: data.sessions.length,
      })),
    };
  }
}
