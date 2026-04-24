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
    outcome: overrides.outcome || {},
  };
}

describe('TrajectoryScorer', () => {
  it('base scoring: 1 point per step', () => {
    const result = scorer.score(makeTrajectory());
    assert.equal(result.basePoints, 3);
  });

  it('applies model multiplier correctly (5x for opus)', () => {
    const result = scorer.score(makeTrajectory({
      metadata: { model_engine: 'claude-opus-4-6' },
    }));
    assert.equal(result.basePoints, 3);
    assert.equal(result.modelMultiplier, 5);
    assert.equal(result.totalPoints, 3 * 5);
  });

  it('applies correction multiplier (10x) on correction steps only', () => {
    const result = scorer.score(makeTrajectory({
      steps: [
        { step: 1, type: 'thought', token_count: 10 },
        { step: 2, type: 'correction', token_count: 5 },
        { step: 3, type: 'action', token_count: 8 },
      ],
      outcome: { user_interventions: 1 },
    }));
    assert.equal(result.correctionBonus, 10);
  });

  it('does not apply correction bonus when user_interventions is 0', () => {
    const result = scorer.score(makeTrajectory({
      steps: [
        { step: 1, type: 'correction', token_count: 5 },
      ],
      outcome: { user_interventions: 0 },
    }));
    assert.equal(result.correctionBonus, 0);
  });

  it('applies coordination multiplier (5x) on coordination steps', () => {
    const result = scorer.score(makeTrajectory({
      steps: [
        { step: 1, type: 'thought', token_count: 10 },
        { step: 2, type: 'coordination', token_count: 5 },
        { step: 3, type: 'coordination', token_count: 3 },
      ],
      outcome: { coordination_events: 2 },
    }));
    assert.equal(result.coordinationBonus, 10);
  });

  it('applies error recovery multiplier (3x)', () => {
    const result = scorer.score(makeTrajectory({
      steps: [
        { step: 1, type: 'error', token_count: 5 },
        { step: 2, type: 'thought', token_count: 10 },
      ],
      outcome: { errors_encountered: 1, errors_recovered: 1 },
    }));
    assert.equal(result.errorRecoveryBonus, 3);
  });

  it('does not apply error recovery when no errors recovered', () => {
    const result = scorer.score(makeTrajectory({
      steps: [{ step: 1, type: 'error', token_count: 5 }],
      outcome: { errors_encountered: 1, errors_recovered: 0 },
    }));
    assert.equal(result.errorRecoveryBonus, 0);
  });

  it('applies complexity bonus (2x base) for heavy tasks', () => {
    const result = scorer.score(makeTrajectory({
      metadata: { task_complexity: 'heavy' },
    }));
    assert.equal(result.basePoints, 3);
    assert.equal(result.complexityBonus, 3);
  });

  it('applies quality bonus at session_quality >= 80', () => {
    const result = scorer.score(makeTrajectory({
      metadata: { session_quality: 85 },
    }));
    assert.ok(result.qualityBonus > 0);
    assert.equal(result.totalPoints, result.basePoints + result.complexityBonus + result.qualityBonus);
  });

  it('does not apply quality bonus below 80', () => {
    const result = scorer.score(makeTrajectory({
      metadata: { session_quality: 79 },
    }));
    assert.equal(result.qualityBonus, 0);
  });

  it('stacks all multipliers correctly', () => {
    const result = scorer.score(makeTrajectory({
      steps: [
        { step: 1, type: 'thought', token_count: 10 },
        { step: 2, type: 'correction', token_count: 5 },
        { step: 3, type: 'coordination', token_count: 3 },
        { step: 4, type: 'error', token_count: 2 },
        { step: 5, type: 'action', token_count: 7 },
      ],
      metadata: { model_engine: 'claude-opus-4-6', task_complexity: 'heavy', session_quality: 90 },
      outcome: { user_interventions: 1, coordination_events: 1, errors_encountered: 1, errors_recovered: 1 },
    }));

    assert.equal(result.basePoints, 5);
    assert.equal(result.modelMultiplier, 5);
    assert.equal(result.correctionBonus, 10);
    assert.equal(result.coordinationBonus, 5);
    assert.equal(result.errorRecoveryBonus, 3);
    assert.equal(result.complexityBonus, 5);

    const subtotal = (5 * 5) + 10 + 5 + 3 + 5;
    const qualityBonus = subtotal * 0.5;
    assert.equal(result.qualityBonus, qualityBonus);
    assert.equal(result.totalPoints, subtotal + qualityBonus);
  });
});
