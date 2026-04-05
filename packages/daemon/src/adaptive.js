// GROOVE — Adaptive Rotation Threshold System
// FSL-1.1-Apache-2.0 — see LICENSE

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const DEFAULT_THRESHOLD = 0.75;
const NUDGE_UP = 0.02;   // Good session → allow more context
const NUDGE_DOWN = 0.05;  // Bad session → rotate sooner
const MIN_THRESHOLD = 0.40;
const MAX_THRESHOLD = 0.95;
const CONVERGENCE_WINDOW = 10; // Stable if last N adjustments < 1%

export class AdaptiveThresholds {
  constructor(grooveDir) {
    this.path = resolve(grooveDir, 'rotation-profiles.json');
    this.profiles = {}; // key: `${provider}:${role}` -> { threshold, history[], converged }
    this.load();
  }

  load() {
    if (existsSync(this.path)) {
      try {
        this.profiles = JSON.parse(readFileSync(this.path, 'utf8'));
      } catch {
        this.profiles = {};
      }
    }
  }

  save() {
    writeFileSync(this.path, JSON.stringify(this.profiles, null, 2));
  }

  profileKey(provider, role) {
    return `${provider}:${role}`;
  }

  getProfile(provider, role) {
    const key = this.profileKey(provider, role);
    if (!this.profiles[key]) {
      this.profiles[key] = {
        threshold: DEFAULT_THRESHOLD,
        history: [],
        converged: false,
        adjustmentCount: 0,
      };
    }
    return this.profiles[key];
  }

  getThreshold(provider, role) {
    return this.getProfile(provider, role).threshold;
  }

  // Score a completed session and adjust the threshold
  recordSession(provider, role, signals) {
    const profile = this.getProfile(provider, role);
    const score = this.scoreSession(signals);

    const oldThreshold = profile.threshold;
    let newThreshold;

    if (score >= 70) {
      // Good session — nudge threshold up (allow more context before rotating)
      newThreshold = Math.min(profile.threshold + NUDGE_UP, MAX_THRESHOLD);
    } else if (score < 40) {
      // Bad session — nudge threshold down (rotate sooner)
      newThreshold = Math.max(profile.threshold - NUDGE_DOWN, MIN_THRESHOLD);
    } else {
      // Neutral — no change
      newThreshold = profile.threshold;
    }

    profile.threshold = newThreshold;
    profile.adjustmentCount++;

    const record = {
      score,
      oldThreshold,
      newThreshold,
      signals,
      timestamp: new Date().toISOString(),
    };

    profile.history.push(record);
    if (profile.history.length > 100) profile.history = profile.history.slice(-100);

    // Check convergence
    profile.converged = this.checkConvergence(profile);

    this.save();
    return { score, threshold: newThreshold, converged: profile.converged };
  }

  scoreSession(signals) {
    // Score 0-100 based on quality signals
    let score = 70; // Baseline: decent session

    // Error rate: each error costs 5 points
    const errorCount = signals.errorCount || 0;
    score -= errorCount * 5;

    // Repetitions: each detected repetition costs 8 points
    const repetitions = signals.repetitions || 0;
    score -= repetitions * 8;

    // Out-of-scope access: each violation costs 10 points
    const scopeViolations = signals.scopeViolations || 0;
    score -= scopeViolations * 10;

    // Tool call success rate: bonus for high success
    const toolCalls = signals.toolCalls || 0;
    const toolFailures = signals.toolFailures || 0;
    if (toolCalls > 0) {
      const successRate = (toolCalls - toolFailures) / toolCalls;
      score += Math.round((successRate - 0.8) * 20); // Bonus/penalty around 80%
    }

    // Files written: productivity signal
    const filesWritten = signals.filesWritten || 0;
    score += Math.min(filesWritten * 2, 10); // Cap at +10

    // Clamp to 0-100
    return Math.max(0, Math.min(100, score));
  }

  checkConvergence(profile) {
    const history = profile.history;
    if (history.length < CONVERGENCE_WINDOW) return false;

    const recent = history.slice(-CONVERGENCE_WINDOW);
    const maxDelta = Math.max(
      ...recent.map((r) => Math.abs(r.newThreshold - r.oldThreshold))
    );

    return maxDelta < 0.01; // All recent adjustments < 1%
  }

  // Extract quality signals from filtered log entries
  extractSignals(entries, agentScope) {
    const signals = {
      errorCount: 0,
      repetitions: 0,
      scopeViolations: 0,
      toolCalls: 0,
      toolFailures: 0,
      filesWritten: 0,
    };

    const recentTools = [];
    const writtenFiles = new Set();

    for (const entry of entries) {
      if (entry.type === 'error') {
        signals.errorCount++;
      }

      if (entry.type === 'tool') {
        signals.toolCalls++;

        // Track file writes
        if (entry.tool === 'Write' || entry.tool === 'Edit') {
          if (entry.input) writtenFiles.add(entry.input);
        }

        // Detect repetitions: same tool+input within last 5 calls
        const key = `${entry.tool}:${entry.input}`;
        if (recentTools.includes(key)) {
          signals.repetitions++;
        }
        recentTools.push(key);
        if (recentTools.length > 5) recentTools.shift();

        // Detect scope violations (simplified check)
        if (agentScope && agentScope.length > 0 && entry.input) {
          const file = entry.input;
          if (entry.tool === 'Write' || entry.tool === 'Edit') {
            // Very rough check — real check uses minimatch in LockManager
            const inScope = agentScope.some((pattern) =>
              file.includes(pattern.replace('/**', '').replace('**/', ''))
            );
            if (!inScope) signals.scopeViolations++;
          }
        }
      }
    }

    signals.filesWritten = writtenFiles.size;
    return signals;
  }

  getAllProfiles() {
    return this.profiles;
  }
}
