// GROOVE — Adaptive Rotation Threshold System
// FSL-1.1-Apache-2.0 — see LICENSE

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { minimatch } from 'minimatch';

// Treat these scope entries as "unrestricted" — agent can touch any file
// under its workingDir without counting as a scope violation.
const UNRESTRICTED_SCOPE_PATTERNS = new Set(['**', '**/*', '*', '']);

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
    // Score 0-100 based on quality signals.
    // Low score → rotate sooner (threshold decreases)
    // High score → allow more context (threshold increases)
    let score = 70; // Baseline: decent session

    // Error rate: each error costs 5 points
    const errorCount = signals.errorCount || 0;
    score -= errorCount * 5;

    // Repetitions: 3+ Write/Edit to the same file in a sliding window
    const repetitions = signals.repetitions || 0;
    score -= Math.min(repetitions * 6, 30);

    // Out-of-scope access: each violation costs 10 points
    const scopeViolations = signals.scopeViolations || 0;
    score -= scopeViolations * 10;

    // Tool call success rate: bonus for high success, penalty for failures
    const toolCalls = signals.toolCalls || 0;
    const toolFailures = signals.toolFailures || 0;
    if (toolCalls > 0) {
      const successRate = (toolCalls - toolFailures) / toolCalls;
      score += Math.round((successRate - 0.8) * 20);
    }

    // File churn: same file written 5+ times — genuine circular refactoring
    const fileChurn = signals.fileChurn || 0;
    score -= fileChurn * 10;

    // Error trend: increasing errors in second half = degradation
    const errorTrend = signals.errorTrend || 0;
    if (errorTrend > 0) score -= errorTrend * 6;  // getting worse
    if (errorTrend < 0) score += 3;                // getting better (small bonus)

    // Files written: productivity signal
    const filesWritten = signals.filesWritten || 0;
    score += Math.min(filesWritten * 2, 10); // Cap at +10

    // Output length decay: assistant responses shrinking dramatically
    if (signals.outputLengthDecay) score -= 10;

    // Tool output volume: bloated context from large tool results
    const toolVol = signals.toolOutputVolume || 0;
    if (toolVol === 2) score -= 10;
    else if (toolVol === 1) score -= 5;

    // Turn latency trend: agent slowing down significantly
    if (signals.turnLatencyTrend) score -= 5;

    // Bash repetition: agent stuck running identical commands
    if (signals.bashRepetition) score -= 8;

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

  // Extract quality signals from classifier events and filtered log entries.
  // These signals drive the scoring model that adapts rotation thresholds.
  extractSignals(entries, agentScope) {
    const signals = {
      errorCount: 0,
      repetitions: 0,
      scopeViolations: 0,
      toolCalls: 0,
      toolFailures: 0,
      filesWritten: 0,
      fileChurn: 0,         // same file written 3+ times → possible circular refactoring
      errorTrend: 0,        // errors increasing in recent window → degradation signal
      outputLengthDecay: 0, // last 5 assistant turns avg <50% of first 5 → declining output
      toolOutputVolume: 0,  // cumulative tool result chars (>300KB = bloated context)
      turnLatencyTrend: 0,  // avg gap in last 10 entries >2x first 10 → slowing down
      bashRepetition: 0,    // 3+ identical consecutive Bash commands → stuck in loop
    };

    const writtenFiles = new Set();
    const fileWriteCounts = {};
    const writeEditOps = [];
    const assistantOutputLengths = [];
    let toolOutputBytes = 0;
    const entryTimestamps = [];
    const bashCommands = [];

    for (const entry of entries) {
      if (entry.timestamp) entryTimestamps.push(new Date(entry.timestamp).getTime());

      if (entry.type === 'error') {
        signals.errorCount++;
      }

      // Track assistant output lengths for decay detection
      if (entry.type === 'thinking' && entry.text) {
        assistantOutputLengths.push(entry.text.length);
      }

      if (entry.type === 'tool') {
        signals.toolCalls++;

        // Track tool result output volume
        if (entry.output) toolOutputBytes += entry.output.length;

        // Track Bash commands for repetition detection
        if (entry.tool === 'Bash' && entry.input) {
          bashCommands.push(entry.input);
        }

        if (entry.tool === 'Write' || entry.tool === 'Edit') {
          if (entry.input) {
            writtenFiles.add(entry.input);
            fileWriteCounts[entry.input] = (fileWriteCounts[entry.input] || 0) + 1;
            writeEditOps.push(entry.input);
          }
        }

        if (entry.isError) {
          signals.toolFailures++;
        }

        // Scope violations: writes outside declared scope. Use real glob matching
        // (the naive substring check flagged every write when scope was `["**"]`
        // because `file.includes("**")` is always false — which tanked the
        // quality score and triggered false-positive rotations). An unrestricted
        // scope (`**`, `**/*`, empty pattern) skips the check entirely.
        if (agentScope && agentScope.length > 0 && entry.input) {
          if (entry.tool === 'Write' || entry.tool === 'Edit') {
            const file = entry.input;
            const unrestricted = agentScope.some((p) => UNRESTRICTED_SCOPE_PATTERNS.has(String(p).trim()));
            if (!unrestricted) {
              const inScope = agentScope.some((pattern) => {
                try {
                  if (minimatch(file, pattern, { matchBase: true, dot: true })) return true;
                  // Also try matching the basename and any path suffix, since
                  // scope patterns are relative to the agent's workingDir and
                  // the recorded input may be absolute.
                  const idx = file.indexOf('/' + pattern.replace(/\/?\*\*\/?/g, '').replace(/^\//, ''));
                  return idx >= 0;
                } catch { return true; } // if the pattern is malformed, don't penalize
              });
              if (!inScope) signals.scopeViolations++;
            }
          }
        }
      }
    }

    signals.filesWritten = writtenFiles.size;

    // Repetitions: only count Write/Edit to the same file as circular behavior.
    // Read/Grep/Glob revisits are normal investigation — not degradation.
    // Require 3+ writes to the same file within a 15-op sliding window.
    for (let i = 0; i < writeEditOps.length; i++) {
      const windowStart = Math.max(0, i - 14);
      const window = writeEditOps.slice(windowStart, i);
      const count = window.filter((f) => f === writeEditOps[i]).length;
      if (count >= 2) signals.repetitions++;
    }

    // File churn: files written 5+ times (circular refactoring, not normal iteration)
    for (const count of Object.values(fileWriteCounts)) {
      if (count >= 5) signals.fileChurn++;
    }

    // Error trend: compare error rate in first half vs second half of session
    // Increasing errors = degradation signal
    if (entries.length >= 6) {
      const mid = Math.floor(entries.length / 2);
      const firstHalfErrors = entries.slice(0, mid).filter((e) => e.type === 'error').length;
      const secondHalfErrors = entries.slice(mid).filter((e) => e.type === 'error').length;
      // Positive = errors increasing (bad), negative = errors decreasing (good)
      signals.errorTrend = secondHalfErrors - firstHalfErrors;
    }

    // Output length decay: if last 5 assistant outputs avg <50% of first 5
    if (assistantOutputLengths.length >= 10) {
      const first5 = assistantOutputLengths.slice(0, 5);
      const last5 = assistantOutputLengths.slice(-5);
      const firstAvg = first5.reduce((a, b) => a + b, 0) / 5;
      const lastAvg = last5.reduce((a, b) => a + b, 0) / 5;
      if (firstAvg > 0 && lastAvg < firstAvg * 0.5) signals.outputLengthDecay = 1;
    }

    // Tool output volume: cumulative tool result size
    if (toolOutputBytes > 600_000) signals.toolOutputVolume = 2;
    else if (toolOutputBytes > 300_000) signals.toolOutputVolume = 1;

    // Turn latency trend: avg gap in last 10 entries >2x first 10
    if (entryTimestamps.length >= 20) {
      const gaps = (ts) => {
        const g = [];
        for (let i = 1; i < ts.length; i++) g.push(ts[i] - ts[i - 1]);
        return g;
      };
      const firstGaps = gaps(entryTimestamps.slice(0, 11));
      const lastGaps = gaps(entryTimestamps.slice(-11));
      const avgFirst = firstGaps.reduce((a, b) => a + b, 0) / firstGaps.length;
      const avgLast = lastGaps.reduce((a, b) => a + b, 0) / lastGaps.length;
      if (avgFirst > 0 && avgLast > avgFirst * 2) signals.turnLatencyTrend = 1;
    }

    // Bash repetition: 3+ identical consecutive Bash commands
    let maxConsecutive = 0;
    let streak = 1;
    for (let i = 1; i < bashCommands.length; i++) {
      if (bashCommands[i] === bashCommands[i - 1]) {
        streak++;
        if (streak > maxConsecutive) maxConsecutive = streak;
      } else {
        streak = 1;
      }
    }
    if (maxConsecutive >= 3) signals.bashRepetition = 1;

    return signals;
  }

  // Record post-rotation quality comparison. If rotation didn't improve quality,
  // nudge the threshold down so future rotations trigger earlier (at a point
  // where context is less degraded and rotation is more likely to help).
  recordRotationOutcome(outcome) {
    const profile = this.getProfile(outcome.provider, outcome.role);
    if (!profile.rotationOutcomes) profile.rotationOutcomes = [];

    profile.rotationOutcomes.push({
      oldScore: outcome.oldScore,
      newScore: outcome.newScore,
      improved: outcome.improved,
      reason: outcome.reason,
      timestamp: outcome.timestamp,
    });

    // Keep last 50 outcomes
    if (profile.rotationOutcomes.length > 50) {
      profile.rotationOutcomes = profile.rotationOutcomes.slice(-50);
    }

    // If last 3 rotations didn't improve quality, nudge threshold down
    const recent = profile.rotationOutcomes.slice(-3);
    if (recent.length >= 3 && recent.every((r) => !r.improved)) {
      profile.threshold = Math.max(profile.threshold - NUDGE_DOWN, MIN_THRESHOLD);
    }

    this.save();
  }

  getAllProfiles() {
    return this.profiles;
  }
}
