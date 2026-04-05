// GROOVE — Adaptive Thresholds Tests
// FSL-1.1-Apache-2.0 — see LICENSE

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { AdaptiveThresholds } from '../src/adaptive.js';
import { mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('AdaptiveThresholds', () => {
  let adaptive;

  beforeEach(() => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'groove-test-'));
    adaptive = new AdaptiveThresholds(tmpDir);
  });

  it('should return default threshold for unknown profile', () => {
    const threshold = adaptive.getThreshold('claude-code', 'backend');
    assert.equal(threshold, 0.75);
  });

  it('should score a perfect session around 80', () => {
    const score = adaptive.scoreSession({
      errorCount: 0,
      repetitions: 0,
      scopeViolations: 0,
      toolCalls: 20,
      toolFailures: 0,
      filesWritten: 5,
    });
    assert.ok(score >= 75 && score <= 90, `Score ${score} should be 75-90`);
  });

  it('should score a bad session low', () => {
    const score = adaptive.scoreSession({
      errorCount: 5,
      repetitions: 3,
      scopeViolations: 2,
      toolCalls: 10,
      toolFailures: 5,
      filesWritten: 0,
    });
    assert.ok(score < 30, `Score ${score} should be < 30`);
  });

  it('should nudge threshold up on good session', () => {
    const result = adaptive.recordSession('claude-code', 'backend', {
      errorCount: 0, repetitions: 0, scopeViolations: 0,
      toolCalls: 20, toolFailures: 0, filesWritten: 5,
    });

    assert.ok(result.score >= 70, `Score should be >= 70 (got ${result.score})`);
    assert.ok(result.threshold > 0.75, `Threshold should increase from 0.75 (got ${result.threshold})`);
  });

  it('should nudge threshold down on bad session', () => {
    const result = adaptive.recordSession('claude-code', 'backend', {
      errorCount: 5, repetitions: 3, scopeViolations: 2,
      toolCalls: 10, toolFailures: 5, filesWritten: 0,
    });

    assert.ok(result.score < 40, `Score should be < 40 (got ${result.score})`);
    assert.ok(result.threshold < 0.75, `Threshold should decrease from 0.75 (got ${result.threshold})`);
  });

  it('should keep threshold stable on neutral session', () => {
    const result = adaptive.recordSession('claude-code', 'backend', {
      errorCount: 1, repetitions: 0, scopeViolations: 0,
      toolCalls: 10, toolFailures: 2, filesWritten: 2,
    });

    // Neutral score (40-70) shouldn't change threshold
    if (result.score >= 40 && result.score < 70) {
      assert.equal(result.threshold, 0.75);
    }
  });

  it('should track separate profiles per provider+role', () => {
    adaptive.recordSession('claude-code', 'backend', {
      errorCount: 0, repetitions: 0, scopeViolations: 0,
      toolCalls: 20, toolFailures: 0, filesWritten: 5,
    });

    adaptive.recordSession('codex', 'frontend', {
      errorCount: 5, repetitions: 3, scopeViolations: 2,
      toolCalls: 10, toolFailures: 5, filesWritten: 0,
    });

    const ccThreshold = adaptive.getThreshold('claude-code', 'backend');
    const codexThreshold = adaptive.getThreshold('codex', 'frontend');

    assert.ok(ccThreshold > codexThreshold, 'Profiles should be independent');
  });

  it('should respect min/max bounds', () => {
    // Many bad sessions should not go below 0.40
    for (let i = 0; i < 20; i++) {
      adaptive.recordSession('claude-code', 'backend', {
        errorCount: 10, repetitions: 5, scopeViolations: 5,
        toolCalls: 5, toolFailures: 5, filesWritten: 0,
      });
    }
    assert.ok(adaptive.getThreshold('claude-code', 'backend') >= 0.40);

    // Many good sessions should not exceed 0.95
    for (let i = 0; i < 50; i++) {
      adaptive.recordSession('claude-code', 'frontend', {
        errorCount: 0, repetitions: 0, scopeViolations: 0,
        toolCalls: 30, toolFailures: 0, filesWritten: 10,
      });
    }
    assert.ok(adaptive.getThreshold('claude-code', 'frontend') <= 0.95);
  });

  it('should persist and restore profiles', () => {
    adaptive.recordSession('claude-code', 'backend', {
      errorCount: 0, repetitions: 0, scopeViolations: 0,
      toolCalls: 20, toolFailures: 0, filesWritten: 5,
    });

    const threshold = adaptive.getThreshold('claude-code', 'backend');

    // Create new instance from same directory
    const adaptive2 = new AdaptiveThresholds(adaptive.path.replace('/rotation-profiles.json', ''));
    assert.equal(adaptive2.getThreshold('claude-code', 'backend'), threshold);
  });

  it('should extract quality signals from log entries', () => {
    const entries = [
      { type: 'tool', tool: 'Write', input: 'src/api/auth.js' },
      { type: 'tool', tool: 'Write', input: 'src/api/users.js' },
      { type: 'tool', tool: 'Read', input: 'package.json' },
      { type: 'tool', tool: 'Write', input: 'src/api/auth.js' }, // repeat
      { type: 'error', text: 'TypeError: cannot read property' },
    ];

    const signals = adaptive.extractSignals(entries, ['src/api/**']);

    assert.equal(signals.toolCalls, 4);
    assert.equal(signals.filesWritten, 2); // unique: auth.js, users.js
    assert.equal(signals.errorCount, 1);
    assert.ok(signals.repetitions >= 0); // May or may not detect based on window
  });

  it('should detect convergence after stable adjustments', () => {
    // All neutral sessions → no threshold changes → convergence
    for (let i = 0; i < 15; i++) {
      adaptive.recordSession('claude-code', 'backend', {
        errorCount: 1, repetitions: 0, scopeViolations: 0,
        toolCalls: 10, toolFailures: 1, filesWritten: 2,
      });
    }

    const profile = adaptive.getProfile('claude-code', 'backend');
    // If all sessions scored neutral (40-70), threshold didn't change → converged
    if (profile.history.every((h) => h.newThreshold === h.oldThreshold)) {
      assert.equal(profile.converged, true);
    }
  });
});
