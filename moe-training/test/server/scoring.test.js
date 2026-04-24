// FSL-1.1-Apache-2.0 — see LICENSE

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TrajectoryScorer } from '../../server/scoring.js';
import { MODEL_TIERS, QUALITY_MULTIPLIERS } from '../../shared/constants.js';

const scorer = new TrajectoryScorer({ MODEL_TIERS, QUALITY_MULTIPLIERS });

function makeTrajectory(overrides = {}) {
  return {
    trajectory_log: overrides.steps || [
      { step: 1, type: 'thought', token_count: 10 },
      { step: 2, type: 'action', token_count: 5 },
      { step: 3, type: 'observation', token_count: 8 },
    ],
    metadata: overrides.metadata || {},
  };
}

describe('TrajectoryScorer', () => {
  it('base scoring: 1 point per step', () => {
    const result = scorer.score(makeTrajectory());
    assert.equal(result.basePoints, 3);
  });

  it('caps base points at 5000', () => {
    const steps = Array.from({ length: 6000 }, (_, i) => ({ step: i, type: 'thought' }));
    const result = scorer.score(makeTrajectory({ steps }));
    assert.equal(result.basePoints, 5000);
  });

  it('applies model multiplier correctly (5x for opus)', () => {
    const result = scorer.score(makeTrajectory({
      metadata: { model_engine: 'claude-opus-4-6' },
    }));
    assert.equal(result.basePoints, 3);
    assert.equal(result.modelMultiplier, 5);
    assert.equal(result.totalPoints, 3 * 5);
  });

  it('derives correction bonus from actual trajectory steps (not outcome)', () => {
    const result = scorer.score(makeTrajectory({
      steps: [
        { step: 1, type: 'thought', token_count: 10 },
        { step: 2, type: 'correction', token_count: 5 },
        { step: 3, type: 'action', token_count: 8 },
        { step: 4, type: 'action', token_count: 3 },
      ],
    }));
    // 4 steps, 30% cap = 1, 1 correction step * 10 = 10
    assert.equal(result.correctionBonus, 10);
  });

  it('caps correction steps at 30% of trajectory', () => {
    // 10 steps, 5 are corrections — only 3 should count (30% of 10)
    const steps = [
      { step: 1, type: 'thought' },
      { step: 2, type: 'correction' },
      { step: 3, type: 'correction' },
      { step: 4, type: 'correction' },
      { step: 5, type: 'correction' },
      { step: 6, type: 'correction' },
      { step: 7, type: 'action' },
      { step: 8, type: 'action' },
      { step: 9, type: 'action' },
      { step: 10, type: 'action' },
    ];
    const result = scorer.score(makeTrajectory({ steps }));
    assert.equal(result.correctionBonus, 3 * 10); // 3 capped corrections x 10
  });

  it('derives coordination bonus from actual trajectory steps (not outcome)', () => {
    const result = scorer.score(makeTrajectory({
      steps: [
        { step: 1, type: 'thought', token_count: 10 },
        { step: 2, type: 'coordination', token_count: 5 },
        { step: 3, type: 'coordination', token_count: 3 },
        { step: 4, type: 'action', token_count: 8 },
        { step: 5, type: 'action', token_count: 4 },
      ],
    }));
    // 5 steps, 20% cap = 1, but 2 coordination steps → capped at 1 * 5 = 5
    assert.equal(result.coordinationBonus, 5);
  });

  it('caps coordination steps at 20% of trajectory', () => {
    // 10 steps, 4 are coordination — only 2 should count (20% of 10)
    const steps = [
      { step: 1, type: 'thought' },
      { step: 2, type: 'coordination' },
      { step: 3, type: 'coordination' },
      { step: 4, type: 'coordination' },
      { step: 5, type: 'coordination' },
      { step: 6, type: 'action' },
      { step: 7, type: 'action' },
      { step: 8, type: 'action' },
      { step: 9, type: 'action' },
      { step: 10, type: 'action' },
    ];
    const result = scorer.score(makeTrajectory({ steps }));
    assert.equal(result.coordinationBonus, 2 * 5); // 2 capped coordination x 5
  });

  it('derives error recovery from actual error and resolution steps', () => {
    const result = scorer.score(makeTrajectory({
      steps: [
        { step: 1, type: 'error', token_count: 5 },
        { step: 2, type: 'resolution', token_count: 10 },
      ],
    }));
    assert.equal(result.errorRecoveryBonus, 3);
  });

  it('error recovery: can not recover more than encountered', () => {
    const result = scorer.score(makeTrajectory({
      steps: [
        { step: 1, type: 'error' },
        { step: 2, type: 'resolution' },
        { step: 3, type: 'resolution' },
        { step: 4, type: 'resolution' },
      ],
    }));
    // only 1 error, 3 resolutions → errorsRecovered = min(1,3) = 1
    assert.equal(result.errorRecoveryBonus, 1 * 3);
  });

  it('no error recovery bonus when no resolution steps', () => {
    const result = scorer.score(makeTrajectory({
      steps: [{ step: 1, type: 'error', token_count: 5 }],
    }));
    assert.equal(result.errorRecoveryBonus, 0);
  });

  it('applies complexity bonus for heavy tasks', () => {
    const result = scorer.score(makeTrajectory({
      metadata: { task_complexity: 'heavy' },
    }));
    assert.equal(result.basePoints, 3);
    assert.equal(result.complexityBonus, 3);
  });

  it('no complexity bonus for medium tasks', () => {
    const result = scorer.score(makeTrajectory({
      metadata: { task_complexity: 'medium' },
    }));
    assert.equal(result.complexityBonus, 0);
  });

  it('client-provided session_quality is ignored (quality is server-derived)', () => {
    // Without resolution steps, quality bonus should be 0 regardless of metadata
    const result = scorer.score(makeTrajectory({
      metadata: { session_quality: 100 },
    }));
    assert.equal(result.qualityBonus, 0);
  });

  it('quality bonus applies when trajectory has resolution and reasonable length', () => {
    const steps = Array.from({ length: 10 }, (_, i) => ({ step: i, type: 'thought' }));
    steps.push({ step: 10, type: 'resolution' });
    const result = scorer.score(makeTrajectory({ steps }));
    assert.ok(result.qualityBonus > 0);
  });

  it('quality bonus is 0 when trajectory has no resolution', () => {
    const steps = Array.from({ length: 10 }, (_, i) => ({ step: i, type: 'thought' }));
    const result = scorer.score(makeTrajectory({ steps }));
    assert.equal(result.qualityBonus, 0);
  });

  it('quality bonus is 0 when trajectory is too short (< 5 steps)', () => {
    const result = scorer.score(makeTrajectory({
      steps: [
        { step: 1, type: 'thought' },
        { step: 2, type: 'resolution' },
      ],
    }));
    assert.equal(result.qualityBonus, 0);
  });

  it('stacks all multipliers correctly (server-derived)', () => {
    const steps = [
      { step: 1, type: 'thought' },
      { step: 2, type: 'correction' },
      { step: 3, type: 'coordination' },
      { step: 4, type: 'error' },
      { step: 5, type: 'resolution' },
      { step: 6, type: 'action' },
      { step: 7, type: 'action' },
      { step: 8, type: 'action' },
      { step: 9, type: 'action' },
      { step: 10, type: 'action' },
    ];
    const result = scorer.score(makeTrajectory({
      steps,
      metadata: { model_engine: 'claude-opus-4-6', task_complexity: 'heavy' },
    }));

    assert.equal(result.basePoints, 10);
    assert.equal(result.modelMultiplier, 5);
    // 1 correction out of 10 steps, max 3 → 1 * 10 = 10
    assert.equal(result.correctionBonus, 10);
    // 1 coordination out of 10 steps, max 2 → 1 * 5 = 5
    assert.equal(result.coordinationBonus, 5);
    // 1 error, 1 resolution → 1 recovered * 3 = 3
    assert.equal(result.errorRecoveryBonus, 3);
    // heavy task: basePoints * 1 = 10
    assert.equal(result.complexityBonus, 10);

    const subtotal = (10 * 5) + 10 + 5 + 3 + 10; // 78
    // has resolution + length >= 5 → quality = floor(78 * 0.1) = 7
    assert.equal(result.qualityBonus, Math.floor(subtotal * 0.1));
    assert.equal(result.totalPoints, subtotal + result.qualityBonus);
  });

  it('ignores outcome.user_interventions — score derives from step count only', () => {
    const result = scorer.score({
      trajectory_log: [
        { step: 1, type: 'thought', token_count: 10 },
      ],
      metadata: { model_engine: 'claude-opus-4-6' },
      outcome: { user_interventions: 1_000_000 },
    });
    assert.equal(result.basePoints, 1);
    assert.equal(result.modelMultiplier, 5);
    assert.equal(result.totalPoints, 5);
    assert.ok(result.totalPoints < 100, 'score should be small, NOT derived from user_interventions');
  });

  it('ignores outcome entirely for multiplier calculations', () => {
    const withOutcome = scorer.score({
      trajectory_log: [{ step: 1, type: 'thought' }],
      metadata: {},
      outcome: { errors_encountered: 999, errors_recovered: 999, coordination_events: 999 },
    });
    const withoutOutcome = scorer.score({
      trajectory_log: [{ step: 1, type: 'thought' }],
      metadata: {},
    });
    assert.equal(withOutcome.totalPoints, withoutOutcome.totalPoints);
  });
});
