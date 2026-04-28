// FSL-1.1-Apache-2.0 — see LICENSE

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StepClassifier } from '../../client/step-classifier.js';

describe('StepClassifier', () => {
  it('user message before any action is classified as instruction', () => {
    const classifier = new StepClassifier();
    const result = classifier.classifyUserMessage('fix the bug');
    assert.equal(result.type, 'instruction');
    assert.equal(result.content, 'fix the bug');
    assert.equal(result.source, 'user');
  });

  it('user correction after action is classified as correction', () => {
    const classifier = new StepClassifier();
    classifier.onStep({ type: 'action' });
    const result = classifier.classifyUserMessage('no, that\'s wrong, use exponential backoff');
    assert.equal(result.type, 'correction');
    assert.equal(result.content, 'no, that\'s wrong, use exponential backoff');
    assert.equal(result.source, 'user');
  });

  it('user approval after action is classified as approval', () => {
    const classifier = new StepClassifier();
    classifier.onStep({ type: 'action' });
    const result = classifier.classifyUserMessage('looks good, ship it');
    assert.equal(result.type, 'approval');
  });

  it('user clarification after action is classified as clarification', () => {
    const classifier = new StepClassifier();
    classifier.onStep({ type: 'action' });
    const result = classifier.classifyUserMessage('to clarify, I meant the sidebar component');
    assert.equal(result.type, 'clarification');
  });

  it('new instruction after action defaults to instruction', () => {
    const classifier = new StepClassifier();
    classifier.onStep({ type: 'action' });
    const result = classifier.classifyUserMessage('now add pagination to the list view');
    assert.equal(result.type, 'instruction');
  });

  it('passes source through from caller', () => {
    const classifier = new StepClassifier();
    const result = classifier.classifyUserMessage('deploy the backend', 'planner');
    assert.equal(result.source, 'planner');
    assert.equal(result.type, 'instruction');
  });

  it('defaults source to user', () => {
    const classifier = new StepClassifier();
    const result = classifier.classifyUserMessage('do the thing');
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

  it('counts corrections and clarifications as interventions', () => {
    const steps = [
      { type: 'thought' },
      { type: 'correction' },
      { type: 'action' },
      { type: 'clarification' },
      { type: 'resolution' },
    ];
    assert.equal(StepClassifier.countUserInterventions(steps), 2);
  });

  it('does not count instruction or approval as interventions', () => {
    const steps = [
      { type: 'instruction' },
      { type: 'action' },
      { type: 'approval' },
      { type: 'resolution' },
    ];
    assert.equal(StepClassifier.countUserInterventions(steps), 0);
  });

  it('counts zero interventions when none present', () => {
    const steps = [
      { type: 'thought' },
      { type: 'action' },
      { type: 'resolution' },
    ];
    assert.equal(StepClassifier.countUserInterventions(steps), 0);
  });

  it('never reclassifies action to error', () => {
    const classifier = new StepClassifier();
    const step = { type: 'action', content: 'Command failed with exit code 1' };
    const result = classifier.onStep(step);
    assert.equal(result.type, 'action');
  });

  it('reclassifies observation with error content to error', () => {
    const classifier = new StepClassifier();
    const step = { type: 'observation', content: 'TypeError: cannot read properties of undefined' };
    const result = classifier.onStep(step);
    assert.equal(result.type, 'error');
  });

  it('does not reclassify thought with error content', () => {
    const classifier = new StepClassifier();
    const step = { type: 'thought', content: 'I see the Error and will fix it' };
    const result = classifier.onStep(step);
    assert.equal(result.type, 'thought');
  });

  it('marks thought after correction as correction_context', () => {
    const classifier = new StepClassifier();
    classifier.onStep({ type: 'action' });
    classifier.onStep({ type: 'correction', content: 'no, fix the bug' });
    const step = { type: 'thought', content: 'I see the issue, let me fix it' };
    const result = classifier.onStep(step);
    assert.equal(result.type, 'thought');
    assert.equal(result.correction_context, true);
  });

  it('marks thought after instruction as correction_context when fix signal present', () => {
    const classifier = new StepClassifier();
    classifier.onStep({ type: 'instruction', content: 'fix the login page' });
    const step = { type: 'thought', content: 'I see the issue, let me fix the validation' };
    const result = classifier.onStep(step);
    assert.equal(result.correction_context, true);
  });

  it('does not mark thought as correction_context without prior correction', () => {
    const classifier = new StepClassifier();
    classifier.onStep({ type: 'action', content: 'running test' });
    const step = { type: 'thought', content: 'let me fix this' };
    const result = classifier.onStep(step);
    assert.equal(result.correction_context, undefined);
  });

  it('returns the step from onStep', () => {
    const classifier = new StepClassifier();
    const step = { type: 'action', content: 'hello' };
    const result = classifier.onStep(step);
    assert.ok(result);
    assert.equal(result.type, 'action');
  });

  it('preserves observation type when is_error is false despite error keywords', () => {
    const classifier = new StepClassifier();
    const step = { type: 'observation', content: 'Cannot find module foo', is_error: false };
    const result = classifier.onStep(step);
    assert.equal(result.type, 'observation');
  });

  it('preserves observation type when is_error:false and content has TypeError', () => {
    const classifier = new StepClassifier();
    const step = { type: 'observation', content: 'TypeError: something failed', is_error: false };
    const result = classifier.onStep(step);
    assert.equal(result.type, 'observation');
  });

  it('still reclassifies observation to error when is_error is true', () => {
    const classifier = new StepClassifier();
    const step = { type: 'observation', content: 'Command failed with exit code 1', is_error: true };
    const result = classifier.onStep(step);
    assert.equal(result.type, 'error');
  });

  it('still reclassifies observation to error when is_error is undefined', () => {
    const classifier = new StepClassifier();
    const step = { type: 'observation', content: 'ENOENT: no such file or directory' };
    const result = classifier.onStep(step);
    assert.equal(result.type, 'error');
  });

  it('does not reclassify observation containing bare word "error" in source code', () => {
    const classifier = new StepClassifier();
    const step = { type: 'observation', content: 'function handleError(err) { console.error(err); }' };
    const result = classifier.onStep(step);
    assert.equal(result.type, 'observation');
  });

  it('does not reclassify observation with "0 errors" or "found 0 vulnerabilities"', () => {
    const classifier = new StepClassifier();
    const step = { type: 'observation', content: 'Build succeeded\n0 errors, 0 warnings\nfound 0 vulnerabilities' };
    const result = classifier.onStep(step);
    assert.equal(result.type, 'observation');
  });

  it('does not reclassify observation reading a file that mentions exceptions', () => {
    const classifier = new StepClassifier();
    const step = { type: 'observation', content: '{"scripts": {"build": "tsc && vite build"}, "name": "my-app"}' };
    const result = classifier.onStep(step);
    assert.equal(result.type, 'observation');
  });

  it('reclassifies observation with real TypeScript build error', () => {
    const classifier = new StepClassifier();
    const step = { type: 'observation', content: 'src/main.ts(1,8): error TS2882: Cannot find module' };
    const result = classifier.onStep(step);
    assert.equal(result.type, 'error');
  });

  it('reclassifies observation with Python traceback', () => {
    const classifier = new StepClassifier();
    const step = { type: 'observation', content: 'Traceback (most recent call last):\n  File "main.py", line 5' };
    const result = classifier.onStep(step);
    assert.equal(result.type, 'error');
  });

  it('reclassifies observation with actual TypeError message', () => {
    const classifier = new StepClassifier();
    const step = { type: 'observation', content: 'TypeError: Cannot read properties of undefined (reading "map")' };
    const result = classifier.onStep(step);
    assert.equal(result.type, 'error');
  });

  it('reclassifies observation with exit code failure', () => {
    const classifier = new StepClassifier();
    const step = { type: 'observation', content: 'Process exited with exit code 1' };
    const result = classifier.onStep(step);
    assert.equal(result.type, 'error');
  });

  it('reclassifies observation with ModuleNotFoundError', () => {
    const classifier = new StepClassifier();
    const step = { type: 'observation', content: 'ModuleNotFoundError: No module named requests' };
    const result = classifier.onStep(step);
    assert.equal(result.type, 'error');
  });

  it('preserves action type even with error keywords', () => {
    const classifier = new StepClassifier();
    const step = { type: 'action', content: 'Command failed with exit code 1' };
    const result = classifier.onStep(step);
    assert.equal(result.type, 'action');
  });

  it('preserves action type regardless of is_error flag', () => {
    const classifier = new StepClassifier();
    const step = { type: 'action', content: 'ENOENT: no such file', is_error: true };
    const result = classifier.onStep(step);
    assert.equal(result.type, 'action');
  });
});

describe('StepClassifier.classifyIntent', () => {
  it('classifies corrections', () => {
    assert.equal(StepClassifier.classifyIntent("no, that's wrong"), 'correction');
    assert.equal(StepClassifier.classifyIntent("that's not what I wanted"), 'correction');
    assert.equal(StepClassifier.classifyIntent('undo that change'), 'correction');
    assert.equal(StepClassifier.classifyIntent('revert the last edit'), 'correction');
    assert.equal(StepClassifier.classifyIntent('you missed the edge case'), 'correction');
  });

  it('classifies approvals', () => {
    assert.equal(StepClassifier.classifyIntent('looks good'), 'approval');
    assert.equal(StepClassifier.classifyIntent('lgtm, ship it'), 'approval');
    assert.equal(StepClassifier.classifyIntent("that's correct"), 'approval');
    assert.equal(StepClassifier.classifyIntent('go ahead with that approach'), 'approval');
  });

  it('classifies clarifications', () => {
    assert.equal(StepClassifier.classifyIntent('to clarify, I meant the sidebar'), 'clarification');
    assert.equal(StepClassifier.classifyIntent('what I want is the mobile layout'), 'clarification');
    assert.equal(StepClassifier.classifyIntent('let me rephrase — update the header'), 'clarification');
  });

  it('defaults to instruction for new directions', () => {
    assert.equal(StepClassifier.classifyIntent('now add pagination to the list'), 'instruction');
    assert.equal(StepClassifier.classifyIntent('also update the README'), 'instruction');
    assert.equal(StepClassifier.classifyIntent('can you refactor the auth module'), 'instruction');
  });

  it('returns instruction for null/empty input', () => {
    assert.equal(StepClassifier.classifyIntent(null), 'instruction');
    assert.equal(StepClassifier.classifyIntent(''), 'instruction');
    assert.equal(StepClassifier.classifyIntent(undefined), 'instruction');
  });
});
