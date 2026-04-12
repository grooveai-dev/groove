// GROOVE — TokenTracker Tests
// FSL-1.1-Apache-2.0 — see LICENSE

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { TokenTracker } from '../src/tokentracker.js';
import { mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('TokenTracker', () => {
  let tracker;
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'groove-test-'));
    tracker = new TokenTracker(tmpDir);
  });

  it('should start with empty usage', () => {
    assert.deepEqual(tracker.getAll(), {});
    assert.equal(tracker.getTotal(), 0);
  });

  it('should record token usage for an agent', () => {
    tracker.record('agent-1', 100);

    const usage = tracker.getAgent('agent-1');
    assert.equal(usage.total, 100);
    assert.equal(usage.sessions.length, 1);
    assert.equal(usage.sessions[0].tokens, 100);
    assert.ok(usage.sessions[0].timestamp);
  });

  it('should accumulate usage across multiple recordings', () => {
    tracker.record('agent-1', 100);
    tracker.record('agent-1', 250);
    tracker.record('agent-1', 50);

    const usage = tracker.getAgent('agent-1');
    assert.equal(usage.total, 400);
    assert.equal(usage.sessions.length, 3);
  });

  it('should track multiple agents independently', () => {
    tracker.record('agent-1', 100);
    tracker.record('agent-2', 200);

    assert.equal(tracker.getAgent('agent-1').total, 100);
    assert.equal(tracker.getAgent('agent-2').total, 200);
    assert.equal(tracker.getTotal(), 300);
  });

  it('should return empty usage for unknown agent', () => {
    const usage = tracker.getAgent('nonexistent');
    assert.equal(usage.total, 0);
    assert.deepEqual(usage.sessions, []);
  });

  it('should persist and restore usage', () => {
    tracker.record('agent-1', 100);
    tracker.record('agent-2', 200);

    const tracker2 = new TokenTracker(tmpDir);
    assert.equal(tracker2.getAgent('agent-1').total, 100);
    assert.equal(tracker2.getAgent('agent-2').total, 200);
    assert.equal(tracker2.getTotal(), 300);
  });

  it('should generate a summary', () => {
    tracker.record('agent-1', 100);
    tracker.record('agent-2', 200);

    const summary = tracker.getSummary();
    assert.equal(summary.totalTokens, 300);
    assert.equal(summary.agentCount, 2);
    assert.ok(summary.sessionDurationMs >= 0);
    assert.ok(summary.savings);
    assert.equal(summary.perAgent.length, 2);
  });

  it('should track rotation savings', () => {
    tracker.recordRotation('agent-1', 5000);
    const summary = tracker.getSummary();
    assert.ok(summary.savings.fromRotation > 0);
    assert.ok(summary.savings.total > 0);
  });

  it('should track conflict prevention savings', () => {
    tracker.recordConflictPrevented();
    tracker.recordConflictPrevented();
    const summary = tracker.getSummary();
    assert.ok(summary.savings.fromConflictPrevention > 0);
  });

  it('should track cold-start skip savings', () => {
    tracker.recordColdStartSkipped();
    const summary = tracker.getSummary();
    assert.ok(summary.savings.fromColdStartSkip > 0);
  });

  it('should calculate savings percentage', () => {
    tracker.record('agent-1', 1000);
    tracker.recordRotation('agent-1', 5000);
    tracker.recordConflictPrevented();
    tracker.recordColdStartSkipped();

    const summary = tracker.getSummary();
    assert.ok(summary.savings.percentage > 0);
    assert.ok(summary.savings.estimatedWithoutGroove > summary.totalTokens);
  });

  it('cache hit rate returns 0 when no cacheable tokens exist', () => {
    tracker.record('agent-1', { tokens: 1000, inputTokens: 1000 });
    const summary = tracker.getSummary();
    assert.equal(summary.cacheHitRate, 0);
    assert.equal(tracker.getCacheHitRate(), 0);
  });

  it('cache hit rate excludes fresh input tokens from denominator', () => {
    // 800 cache reads + 200 cache creation = 1000 cacheable → 80% hit rate.
    // Fresh inputTokens must NOT inflate the denominator.
    tracker.record('agent-1', {
      tokens: 6000,
      inputTokens: 5000,
      cacheReadTokens: 800,
      cacheCreationTokens: 200,
    });
    const summary = tracker.getSummary();
    assert.equal(summary.cacheHitRate, 0.8);
  });

  it('cache hit rate is 1.0 when all cacheable tokens are reads', () => {
    tracker.record('agent-1', {
      tokens: 1000,
      cacheReadTokens: 1000,
      cacheCreationTokens: 0,
    });
    assert.equal(tracker.getCacheHitRate(), 1.0);
  });

  it('internal reserved IDs (__prefix) are segregated from user agents', () => {
    tracker.record('agent-1', { tokens: 1000, inputTokens: 1000 });
    tracker.record('agent-2', { tokens: 500, inputTokens: 500 });
    tracker.record('__journalist__', { tokens: 300, inputTokens: 300 });
    tracker.record('__pm__', { tokens: 200, inputTokens: 200 });

    const summary = tracker.getSummary();
    // perAgent excludes internal IDs
    assert.equal(summary.perAgent.length, 2);
    assert.ok(summary.perAgent.every((a) => !a.agentId.startsWith('__')));
    // agentCount reflects user-facing agents only
    assert.equal(summary.agentCount, 2);
    // Internal overhead is exposed separately
    assert.equal(summary.internalOverhead.tokens, 500);
    assert.equal(summary.internalOverhead.components['__journalist__'].tokens, 300);
    assert.equal(summary.internalOverhead.components['__pm__'].tokens, 200);
    // totalTokens still includes internal (reflects real billing)
    assert.equal(summary.totalTokens, 2000);
  });

  it('empty internalOverhead when no internal IDs recorded', () => {
    tracker.record('agent-1', { tokens: 100 });
    const summary = tracker.getSummary();
    assert.equal(summary.internalOverhead.tokens, 0);
    assert.deepEqual(summary.internalOverhead.components, {});
  });

  it('getTokensInWindow returns 0 for unknown agent', () => {
    assert.equal(tracker.getTokensInWindow('nonexistent', 0), 0);
  });

  it('getTokensInWindow sums sessions since a given timestamp', () => {
    tracker.record('agent-1', { tokens: 100 });
    tracker.record('agent-1', { tokens: 200 });
    tracker.record('agent-1', { tokens: 300 });
    // sinceTs = 0 captures all
    assert.equal(tracker.getTokensInWindow('agent-1', 0), 600);
    // sinceTs = now + 10s captures nothing
    assert.equal(tracker.getTokensInWindow('agent-1', Date.now() + 10_000), 0);
  });

  it('getVelocity returns tokens in a rolling window', () => {
    tracker.record('agent-1', { tokens: 1000 });
    // Large window captures the recent recording
    assert.equal(tracker.getVelocity('agent-1', 60_000), 1000);
    // Empty tracker returns 0
    assert.equal(tracker.getVelocity('unknown-agent', 60_000), 0);
  });
});
