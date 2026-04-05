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
});
