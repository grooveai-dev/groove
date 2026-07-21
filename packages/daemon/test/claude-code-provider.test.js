// GROOVE — Claude Code Provider Tests
// FSL-1.1-Apache-2.0 — see LICENSE

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ClaudeCodeProvider } from '../src/providers/claude-code.js';

const provider = new ClaudeCodeProvider();

describe('ClaudeCodeProvider result parsing', () => {
  // Regression: the "phantom interrupt" bug. On --resume with an orphaned
  // background shell task, the CLI aborts the turn before calling the model.
  // These fields were previously dropped, so the abort was indistinguishable
  // from a successful turn and the user's message vanished with no UI signal.
  it('surfaces error signals from an aborted turn', () => {
    const out = provider.parseOutput(JSON.stringify({
      type: 'result',
      subtype: 'error_during_execution',
      is_error: true,
      duration_ms: 5126,
      duration_api_ms: 0,
      num_turns: 2,
      total_cost_usd: 0,
      terminal_reason: 'aborted_streaming',
    }));

    assert.equal(out.type, 'result');
    assert.equal(out.isError, true);
    assert.equal(out.apiDurationMs, 0, 'api duration 0 proves the model was never reached');
    assert.equal(out.terminalReason, 'aborted_streaming');
  });

  it('treats an error_during_execution subtype as an error even without is_error', () => {
    const out = provider.parseOutput(JSON.stringify({
      type: 'result', subtype: 'error_during_execution', duration_api_ms: 0,
    }));
    assert.equal(out.isError, true);
  });

  it('does not flag a successful turn as an error', () => {
    const out = provider.parseOutput(JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      duration_ms: 17850,
      duration_api_ms: 17672,
      num_turns: 3,
      total_cost_usd: 0.42,
      terminal_reason: 'completed',
    }));

    assert.equal(out.isError, false);
    assert.equal(out.apiDurationMs, 17672);
    assert.equal(out.cost, 0.42);
  });

  // The retry gate is (isError && apiDurationMs === 0). A turn that failed
  // *after* reaching the model has real cost and must not be auto-retried.
  it('distinguishes a pre-model abort from a post-model failure', () => {
    const preModel = provider.parseOutput(JSON.stringify({
      type: 'result', subtype: 'error_during_execution', is_error: true, duration_api_ms: 0,
    }));
    const postModel = provider.parseOutput(JSON.stringify({
      type: 'result', subtype: 'error_during_execution', is_error: true, duration_api_ms: 8400,
    }));

    assert.equal(preModel.isError && preModel.apiDurationMs === 0, true, 'free to retry');
    assert.equal(postModel.isError && postModel.apiDurationMs === 0, false, 'already billed — do not retry');
  });
});

describe('ClaudeCodeProvider models', () => {
  it('offers Fable 5', () => {
    assert.ok(ClaudeCodeProvider.models.some((m) => m.id === 'claude-fable-5'));
  });
});
