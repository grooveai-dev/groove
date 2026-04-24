// FSL-1.1-Apache-2.0 — see LICENSE

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StepClassifier } from '../../client/step-classifier.js';

describe('StepClassifier', () => {
  it('user message before any action is not a correction', () => {
    const classifier = new StepClassifier();
    const result = classifier.classifyUserMessage('fix the bug');
    assert.equal(result, null);
  });

  it('user message after action is a correction', () => {
    const classifier = new StepClassifier();
    classifier.onStep({ type: 'action' });
    const result = classifier.classifyUserMessage('no, use exponential backoff');
    assert.equal(result.type, 'correction');
    assert.equal(result.content, 'no, use exponential backoff');
    assert.equal(result.source, 'user');
  });

  it('classifies coordination event', () => {
    const classifier = new StepClassifier();
    const result = classifier.classifyCoordinationEvent({
      coordination_id: 'coord-1',
      direction: 'outbound',
      target_agent: 'backend-1',
      protocol: 'knock',
      content: 'Requesting lock on src/api.js',
    });
    assert.equal(result.type, 'coordination');
    assert.equal(result.coordination_id, 'coord-1');
    assert.equal(result.direction, 'outbound');
    assert.equal(result.target_agent, 'backend-1');
    assert.equal(result.protocol, 'knock');
  });

  it('detects error recovery', () => {
    const steps = [
      { type: 'thought', step: 1 },
      { type: 'action', step: 2 },
      { type: 'error', step: 3 },
      { type: 'thought', step: 4 },
      { type: 'action', step: 5 },
      { type: 'resolution', step: 6 },
    ];
    assert.equal(StepClassifier.detectErrorRecovery(steps), true);
  });

  it('no error recovery when no resolution after error', () => {
    const steps = [
      { type: 'thought', step: 1 },
      { type: 'error', step: 2 },
      { type: 'error', step: 3 },
    ];
    assert.equal(StepClassifier.detectErrorRecovery(steps), false);
  });

  it('no error recovery when no errors', () => {
    const steps = [
      { type: 'thought', step: 1 },
      { type: 'action', step: 2 },
      { type: 'resolution', step: 3 },
    ];
    assert.equal(StepClassifier.detectErrorRecovery(steps), false);
  });

  it('counts user interventions', () => {
    const steps = [
      { type: 'thought' },
      { type: 'correction' },
      { type: 'action' },
      { type: 'correction' },
      { type: 'resolution' },
    ];
    assert.equal(StepClassifier.countUserInterventions(steps), 2);
  });

  it('counts zero interventions when none present', () => {
    const steps = [
      { type: 'thought' },
      { type: 'action' },
      { type: 'resolution' },
    ];
    assert.equal(StepClassifier.countUserInterventions(steps), 0);
  });
});
