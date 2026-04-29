// FSL-1.1-Apache-2.0 — see LICENSE

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TrajectoryCapture } from '../../client/trajectory-capture.js';

function makeTc() {
  const tc = new TrajectoryCapture({ centralCommandUrl: 'http://localhost:9999' });
  return tc;
}

function makeCtx(overrides = {}) {
  return {
    sessionId: 'sess_test_1',
    stepCount: overrides.stepCount ?? 20,
    totalTokens: overrides.totalTokens ?? 5000,
    errorsEncountered: overrides.errorsEncountered ?? 0,
    errorsRecovered: overrides.errorsRecovered ?? 0,
    coordinationEvents: overrides.coordinationEvents ?? 0,
    revisionRounds: overrides.revisionRounds ?? 0,
    allSteps: overrides.allSteps ?? [
      { step: 1, type: 'thought', content: 'thinking' },
      { step: 2, type: 'action', tool: 'Bash', content: 'running command' },
      { step: 3, type: 'observation', content: 'output here' },
      { step: 4, type: 'thought', content: 'next step' },
      { step: 5, type: 'action', tool: 'Edit', content: 'editing file' },
    ],
    metadata: {
      session_quality: overrides.quality ?? 80,
    },
    builder: {
      _metadata: {},
      updateMetadata(updates) { Object.assign(this._metadata, updates); },
      buildSessionClose: function (outcome) {
        return {
          envelope_id: 'env_test_close',
          session_id: 'sess_test_1',
          type: 'SESSION_CLOSE',
          metadata: { ...this._metadata },
          outcome,
        };
      },
    },
  };
}

describe('TrajectoryCapture — quality tier', () => {
  it('TIER_A: high quality, no errors, no interventions, SUCCESS', () => {
    const tc = makeTc();
    const ctx = makeCtx({ quality: 80, errorsEncountered: 0 });
    const result = tc._computeQualityTier(ctx, 'SUCCESS', 0);
    assert.equal(result.tier, 'TIER_A');
    assert.equal(result.reason, 'high_quality_no_errors');
  });

  it('TIER_A requires quality >= 70', () => {
    const tc = makeTc();
    const ctx = makeCtx({ quality: 69, errorsEncountered: 0 });
    const result = tc._computeQualityTier(ctx, 'SUCCESS', 0);
    assert.notEqual(result.tier, 'TIER_A');
  });

  it('TIER_A requires zero errors', () => {
    const tc = makeTc();
    const ctx = makeCtx({ quality: 80, errorsEncountered: 1 });
    const result = tc._computeQualityTier(ctx, 'SUCCESS', 0);
    assert.notEqual(result.tier, 'TIER_A');
  });

  it('TIER_A requires zero user interventions', () => {
    const tc = makeTc();
    const ctx = makeCtx({ quality: 80, errorsEncountered: 0 });
    const result = tc._computeQualityTier(ctx, 'SUCCESS', 1);
    assert.notEqual(result.tier, 'TIER_A');
  });

  it('TIER_A requires SUCCESS status', () => {
    const tc = makeTc();
    const ctx = makeCtx({ quality: 80, errorsEncountered: 0 });
    const result = tc._computeQualityTier(ctx, 'CRASH', 0);
    assert.notEqual(result.tier, 'TIER_A');
  });

  it('TIER_B: moderate quality >= 50 with SUCCESS', () => {
    const tc = makeTc();
    const ctx = makeCtx({ quality: 55, errorsEncountered: 0 });
    const result = tc._computeQualityTier(ctx, 'SUCCESS', 0);
    assert.equal(result.tier, 'TIER_B');
    assert.equal(result.reason, 'moderate_quality');
  });

  it('TIER_C: non-SUCCESS status overrides quality', () => {
    const tc = makeTc();
    const ctx = makeCtx({ quality: 55, errorsEncountered: 0 });
    const result = tc._computeQualityTier(ctx, 'CRASH', 0);
    assert.equal(result.tier, 'TIER_C');
    assert.equal(result.reason, 'non_success_status');
  });

  it('TIER_B: errors fully recovered', () => {
    const tc = makeTc();
    const ctx = makeCtx({ quality: 40, errorsEncountered: 2, errorsRecovered: 2 });
    const result = tc._computeQualityTier(ctx, 'SUCCESS', 0);
    assert.equal(result.tier, 'TIER_B');
    assert.equal(result.reason, 'errors_recovered');
  });

  it('TIER_C: low quality below 50', () => {
    const tc = makeTc();
    const ctx = makeCtx({ quality: 30, errorsEncountered: 0 });
    const result = tc._computeQualityTier(ctx, 'SUCCESS', 0);
    assert.equal(result.tier, 'TIER_C');
    assert.equal(result.reason, 'low_quality');
  });

  it('TIER_C: unrecovered errors with low quality', () => {
    const tc = makeTc();
    const ctx = makeCtx({ quality: 45, errorsEncountered: 3, errorsRecovered: 1 });
    const result = tc._computeQualityTier(ctx, 'SUCCESS', 2);
    assert.equal(result.tier, 'TIER_C');
  });

  it('TIER_B at exactly quality=50 boundary', () => {
    const tc = makeTc();
    const ctx = makeCtx({ quality: 50, errorsEncountered: 0 });
    const result = tc._computeQualityTier(ctx, 'SUCCESS', 0);
    assert.equal(result.tier, 'TIER_B');
  });

  it('TIER_A at exactly quality=70 boundary', () => {
    const tc = makeTc();
    const ctx = makeCtx({ quality: 70, errorsEncountered: 0 });
    const result = tc._computeQualityTier(ctx, 'SUCCESS', 0);
    assert.equal(result.tier, 'TIER_A');
  });
});

describe('TrajectoryCapture — training eligibility', () => {
  it('eligible when all criteria met', () => {
    const tc = makeTc();
    const ctx = makeCtx();
    const result = tc._computeTrainingEligibility(ctx, 60);
    assert.equal(result.eligible, true);
    assert.equal(result.exclusionReason, null);
  });

  it('ineligible: too_few_steps (< 5)', () => {
    const tc = makeTc();
    const ctx = makeCtx({ stepCount: 4 });
    const result = tc._computeTrainingEligibility(ctx, 60);
    assert.equal(result.eligible, false);
    assert.equal(result.exclusionReason, 'too_few_steps');
  });

  it('ineligible: no_actions (no step with type action + tool)', () => {
    const tc = makeTc();
    const ctx = makeCtx({
      allSteps: [
        { step: 1, type: 'thought', content: 'thinking' },
        { step: 2, type: 'thought', content: 'more thinking' },
        { step: 3, type: 'observation', content: 'output' },
        { step: 4, type: 'thought', content: 'done' },
        { step: 5, type: 'resolution', content: 'completed' },
      ],
    });
    const result = tc._computeTrainingEligibility(ctx, 60);
    assert.equal(result.eligible, false);
    assert.equal(result.exclusionReason, 'no_actions');
  });

  it('ineligible: no_observations', () => {
    const tc = makeTc();
    const ctx = makeCtx({
      allSteps: [
        { step: 1, type: 'thought', content: 'thinking' },
        { step: 2, type: 'action', tool: 'Bash', content: 'run' },
        { step: 3, type: 'thought', content: 'hmm' },
        { step: 4, type: 'action', tool: 'Edit', content: 'edit' },
        { step: 5, type: 'resolution', content: 'done' },
      ],
    });
    const result = tc._computeTrainingEligibility(ctx, 60);
    assert.equal(result.eligible, false);
    assert.equal(result.exclusionReason, 'no_observations');
  });

  it('ineligible: insufficient_tokens (< 500)', () => {
    const tc = makeTc();
    const ctx = makeCtx({ totalTokens: 400 });
    const result = tc._computeTrainingEligibility(ctx, 60);
    assert.equal(result.eligible, false);
    assert.equal(result.exclusionReason, 'insufficient_tokens');
  });

  it('ineligible: too_short (duration < 10s)', () => {
    const tc = makeTc();
    const ctx = makeCtx({ totalTokens: 5000 });
    const result = tc._computeTrainingEligibility(ctx, 9);
    assert.equal(result.eligible, false);
    assert.equal(result.exclusionReason, 'too_short');
  });

  it('eligible at exact boundary values', () => {
    const tc = makeTc();
    const ctx = makeCtx({ stepCount: 5, totalTokens: 500 });
    const result = tc._computeTrainingEligibility(ctx, 10);
    assert.equal(result.eligible, true);
    assert.equal(result.exclusionReason, null);
  });

  it('exclusion reasons follow priority order: tokens before duration before steps', () => {
    const tc = makeTc();
    const ctx = makeCtx({
      stepCount: 3,
      totalTokens: 100,
      allSteps: [
        { step: 1, type: 'thought', content: 'thinking' },
        { step: 2, type: 'thought', content: 'more' },
        { step: 3, type: 'thought', content: 'done' },
      ],
    });
    const result = tc._computeTrainingEligibility(ctx, 5);
    assert.equal(result.exclusionReason, 'insufficient_tokens');
  });

  it('duration checked before steps when tokens pass', () => {
    const tc = makeTc();
    const ctx = makeCtx({
      stepCount: 3,
      totalTokens: 5000,
      allSteps: [
        { step: 1, type: 'thought', content: 'thinking' },
        { step: 2, type: 'thought', content: 'more' },
        { step: 3, type: 'thought', content: 'done' },
      ],
    });
    const result = tc._computeTrainingEligibility(ctx, 5);
    assert.equal(result.exclusionReason, 'too_short');
  });

  it('steps checked after tokens and duration pass', () => {
    const tc = makeTc();
    const ctx = makeCtx({
      stepCount: 3,
      totalTokens: 5000,
      allSteps: [
        { step: 1, type: 'thought', content: 'thinking' },
        { step: 2, type: 'thought', content: 'more' },
        { step: 3, type: 'thought', content: 'done' },
      ],
    });
    const result = tc._computeTrainingEligibility(ctx, 60);
    assert.equal(result.exclusionReason, 'too_few_steps');
  });
});

describe('TrajectoryCapture — planner/conversational eligibility', () => {
  function makeConversationalCtx(role, overrides = {}) {
    const ctx = makeCtx(overrides);
    ctx.metadata.agent_role = role;
    return ctx;
  }

  it('planner eligible with only thoughts (no actions/observations)', () => {
    const tc = makeTc();
    const ctx = makeConversationalCtx('planner', {
      stepCount: 10,
      totalTokens: 2000,
      allSteps: Array.from({ length: 10 }, (_, i) => ({ step: i + 1, type: 'thought', content: 'planning' })),
    });
    const result = tc._computeTrainingEligibility(ctx, 60);
    assert.equal(result.eligible, true);
    assert.equal(result.exclusionReason, null);
  });

  it('chat role eligible with only thoughts', () => {
    const tc = makeTc();
    const ctx = makeConversationalCtx('chat', {
      stepCount: 5,
      totalTokens: 1000,
      allSteps: [
        { step: 1, type: 'instruction', content: 'explain React hooks' },
        { step: 2, type: 'thought', content: 'explaining' },
        { step: 3, type: 'thought', content: 'more detail' },
        { step: 4, type: 'thought', content: 'examples' },
        { step: 5, type: 'resolution', content: 'done' },
      ],
    });
    const result = tc._computeTrainingEligibility(ctx, 30);
    assert.equal(result.eligible, true);
  });

  it('advisor role eligible with only thoughts', () => {
    const tc = makeTc();
    const ctx = makeConversationalCtx('advisor', {
      stepCount: 3,
      totalTokens: 800,
      allSteps: [
        { step: 1, type: 'instruction', content: 'review approach' },
        { step: 2, type: 'thought', content: 'analysis' },
        { step: 3, type: 'resolution', content: 'recommendation' },
      ],
    });
    const result = tc._computeTrainingEligibility(ctx, 20);
    assert.equal(result.eligible, true);
  });

  it('planner still requires minimum tokens', () => {
    const tc = makeTc();
    const ctx = makeConversationalCtx('planner', {
      stepCount: 10,
      totalTokens: 100,
      allSteps: Array.from({ length: 10 }, (_, i) => ({ step: i + 1, type: 'thought', content: 'plan' })),
    });
    const result = tc._computeTrainingEligibility(ctx, 60);
    assert.equal(result.eligible, false);
    assert.equal(result.exclusionReason, 'insufficient_tokens');
  });

  it('planner still requires minimum duration', () => {
    const tc = makeTc();
    const ctx = makeConversationalCtx('planner', {
      stepCount: 10,
      totalTokens: 2000,
      allSteps: Array.from({ length: 10 }, (_, i) => ({ step: i + 1, type: 'thought', content: 'plan' })),
    });
    const result = tc._computeTrainingEligibility(ctx, 5);
    assert.equal(result.eligible, false);
    assert.equal(result.exclusionReason, 'too_short');
  });

  it('planner requires at least 2 steps', () => {
    const tc = makeTc();
    const ctx = makeConversationalCtx('planner', {
      stepCount: 1,
      totalTokens: 2000,
      allSteps: [{ step: 1, type: 'thought', content: 'plan' }],
    });
    const result = tc._computeTrainingEligibility(ctx, 60);
    assert.equal(result.eligible, false);
    assert.equal(result.exclusionReason, 'too_few_steps');
  });

  it('coding role (fullstack) still requires actions and observations', () => {
    const tc = makeTc();
    const ctx = makeConversationalCtx('fullstack', {
      stepCount: 10,
      totalTokens: 2000,
      allSteps: Array.from({ length: 10 }, (_, i) => ({ step: i + 1, type: 'thought', content: 'thinking' })),
    });
    const result = tc._computeTrainingEligibility(ctx, 60);
    assert.equal(result.eligible, false);
    assert.equal(result.exclusionReason, 'no_actions');
  });
});

describe('TrajectoryCapture — API chat capture via onChatTurnStart', () => {
  function makeChatTc() {
    const tc = makeTc();
    tc._enabled = true;
    tc._scrubber = { scrub: (s) => s };
    tc._attestation = { openSession: async () => {}, closeSession: async () => {}, signEnvelope: (sid, e) => e };
    tc._transmissionQueue = { enqueue: () => {}, waitForDrain: async () => {} };
    tc._domainTagger = null;
    return tc;
  }

  it('returns a synthetic agent ID and creates context', () => {
    const tc = makeChatTc();
    const agentId = tc.onChatTurnStart('conv-123', 'claude-code', 'opus', 'What is React?');
    assert.ok(agentId);
    assert.ok(agentId.startsWith('chat-api-conv-123-'));
    const ctx = tc._contexts.get(agentId);
    assert.ok(ctx);
    assert.equal(ctx.metadata.agent_role, 'chat');
    assert.equal(ctx.metadata.provider, 'claude-code');
    assert.equal(ctx.metadata.model_engine, 'opus');
  });

  it('records the user message as an instruction step', () => {
    const tc = makeChatTc();
    const agentId = tc.onChatTurnStart('conv-456', 'claude-code', 'opus', 'Explain hooks');
    const ctx = tc._contexts.get(agentId);
    assert.equal(ctx.stepCount, 1);
    assert.equal(ctx.allSteps[0].type, 'instruction');
    assert.ok(ctx.allSteps[0].content.includes('Explain hooks'));
  });

  it('works with onParsedOutput and onAgentComplete', async () => {
    const tc = makeChatTc();
    const agentId = tc.onChatTurnStart('conv-789', 'claude-code', 'opus', 'Tell me about React');

    tc.onParsedOutput(agentId, { type: 'activity', subtype: 'assistant', data: 'React is a UI library' });
    tc.onParsedOutput(agentId, { type: 'result', data: 'React is a UI library' });

    const ctx = tc._contexts.get(agentId);
    assert.equal(ctx.stepCount, 3);
    assert.equal(ctx.allSteps[1].type, 'thought');
    assert.equal(ctx.allSteps[2].type, 'resolution');

    await tc.onAgentComplete(agentId, { status: 'SUCCESS' });
    assert.equal(tc._contexts.has(agentId), false);
  });

  it('returns null when disabled', () => {
    const tc = makeChatTc();
    tc._enabled = false;
    const agentId = tc.onChatTurnStart('conv-000', 'claude-code', 'opus', 'Hello');
    assert.equal(agentId, null);
  });

  it('context has no parser (not needed for API chat)', () => {
    const tc = makeChatTc();
    const agentId = tc.onChatTurnStart('conv-nop', 'claude-code', 'opus', 'Hello');
    const ctx = tc._contexts.get(agentId);
    assert.equal(ctx.parser, null);
  });
});

describe('TrajectoryCapture — initial prompt capture', () => {
  function makeSpawnTc() {
    const tc = makeTc();
    tc._enabled = true;
    tc._scrubber = { scrub: (s) => s };
    tc._attestation = { openSession: async () => {}, signEnvelope: (sid, e) => e };
    tc._transmissionQueue = { enqueue: () => {} };
    tc._domainTagger = null;
    return tc;
  }

  it('onAgentSpawn records prompt as instruction step', async () => {
    const tc = makeSpawnTc();
    await tc.onAgentSpawn('agent-p1', 'claude-code', 'opus', 'planner', 1, 'Build a React app');

    const ctx = tc._contexts.get('agent-p1');
    assert.ok(ctx);
    assert.equal(ctx.stepCount, 1);
    assert.equal(ctx.allSteps[0].type, 'instruction');
    assert.ok(ctx.allSteps[0].content.includes('Build a React app'));
    assert.equal(ctx.allSteps[0].source, 'user');
  });

  it('onAgentSpawn with no prompt creates no instruction step', async () => {
    const tc = makeSpawnTc();
    await tc.onAgentSpawn('agent-p2', 'claude-code', 'opus', 'fullstack', 1);

    const ctx = tc._contexts.get('agent-p2');
    assert.ok(ctx);
    assert.equal(ctx.stepCount, 0);
    assert.equal(ctx.allSteps.length, 0);
  });

  it('onAgentSpawn truncates long prompts', async () => {
    const tc = makeSpawnTc();
    const longPrompt = 'x'.repeat(50000);
    await tc.onAgentSpawn('agent-p3', 'claude-code', 'opus', 'planner', 1, longPrompt);

    const ctx = tc._contexts.get('agent-p3');
    assert.ok(ctx.allSteps[0].content.length <= 10001);
  });

  it('onAgentSpawn ignores empty/whitespace prompts', async () => {
    const tc = makeSpawnTc();
    await tc.onAgentSpawn('agent-p4', 'claude-code', 'opus', 'planner', 1, '   ');

    const ctx = tc._contexts.get('agent-p4');
    assert.equal(ctx.stepCount, 0);
  });
});

describe('TrajectoryCapture — user feedback emission', () => {
  it('emits accepted signal on SUCCESS with 0 interventions and 0 revisions', () => {
    const tc = makeTc();
    const captured = [];
    tc._signAndTransmit = (_sid, envelope) => { captured.push(envelope); };

    const ctx = makeCtx({ revisionRounds: 0 });
    ctx.stepCount = 10;
    tc._emitUserFeedback(ctx, 'SUCCESS', 0);

    assert.equal(captured.length, 1);
    assert.equal(captured[0].type, 'USER_FEEDBACK');
    assert.equal(captured[0].feedback.signal, 'accepted');
    assert.equal(captured[0].feedback.revision_rounds, 0);
    assert.equal(captured[0].feedback.target_step, 10);
  });

  it('emits iterated signal on SUCCESS with revision rounds > 0', () => {
    const tc = makeTc();
    const captured = [];
    tc._signAndTransmit = (_sid, envelope) => { captured.push(envelope); };

    const ctx = makeCtx({ revisionRounds: 3 });
    ctx.stepCount = 25;
    tc._emitUserFeedback(ctx, 'SUCCESS', 2);

    assert.equal(captured.length, 1);
    assert.equal(captured[0].feedback.signal, 'iterated');
    assert.equal(captured[0].feedback.revision_rounds, 3);
    assert.ok(captured[0].feedback.context.includes('3 revision'));
  });

  it('does not emit feedback on non-SUCCESS status', () => {
    const tc = makeTc();
    const captured = [];
    tc._signAndTransmit = (_sid, envelope) => { captured.push(envelope); };

    const ctx = makeCtx({ revisionRounds: 0 });
    tc._emitUserFeedback(ctx, 'CRASH', 0);

    assert.equal(captured.length, 0);
  });

  it('does not emit feedback when SHUTDOWN', () => {
    const tc = makeTc();
    const captured = [];
    tc._signAndTransmit = (_sid, envelope) => { captured.push(envelope); };

    const ctx = makeCtx({ revisionRounds: 0 });
    tc._emitUserFeedback(ctx, 'SHUTDOWN', 0);

    assert.equal(captured.length, 0);
  });

  it('feedback envelope has correct structure', () => {
    const tc = makeTc();
    const captured = [];
    tc._signAndTransmit = (_sid, envelope) => { captured.push(envelope); };

    const ctx = makeCtx({ revisionRounds: 0 });
    ctx.stepCount = 15;
    tc._emitUserFeedback(ctx, 'SUCCESS', 0);

    const fb = captured[0];
    assert.ok(fb.envelope_id.startsWith('env_'));
    assert.equal(fb.session_id, 'sess_test_1');
    assert.equal(fb.type, 'USER_FEEDBACK');
    assert.ok(fb.attestation);
    assert.ok(fb.feedback.timestamp > 0);
    assert.equal(fb.feedback.delta_summary, null);
  });
});

describe('TrajectoryCapture — token counting via _processStep', () => {
  it('accumulates token_count from every step type', () => {
    const tc = makeTc();
    tc._scrubber = { scrub: (s) => s };
    const ctx = makeCtx();
    ctx.totalTokens = 0;
    ctx.stepCount = 0;
    ctx.allSteps = [];
    ctx.builder = { addStep: () => null };
    ctx.classifier = {
      onStep: (s) => s,
    };

    tc._processStep('agent-1', ctx, { type: 'thought', content: 'thinking about it', token_count: 50 });
    tc._processStep('agent-1', ctx, { type: 'action', content: 'run test', token_count: 30 });
    tc._processStep('agent-1', ctx, { type: 'observation', content: 'test passed', token_count: 100 });
    tc._processStep('agent-1', ctx, { type: 'thought', content: 'next step', token_count: 20 });

    assert.equal(ctx.totalTokens, 200);
    assert.equal(ctx.stepCount, 4);
  });

  it('estimates token_count when not provided', () => {
    const tc = makeTc();
    tc._scrubber = { scrub: (s) => s };
    const ctx = makeCtx();
    ctx.totalTokens = 0;
    ctx.stepCount = 0;
    ctx.allSteps = [];
    ctx.builder = { addStep: () => null };
    ctx.classifier = {
      onStep: (s) => s,
    };

    tc._processStep('agent-1', ctx, { type: 'thought', content: 'a'.repeat(100) });
    assert.equal(ctx.totalTokens, 25);
  });

  it('does not double-count tokens from onStdoutLine', () => {
    const tc = makeTc();
    tc._scrubber = { scrub: (s) => s };
    tc._enabled = true;

    const ctx = makeCtx();
    ctx.totalTokens = 0;
    ctx.stepCount = 0;
    ctx.allSteps = [];
    ctx.builder = { addStep: () => null };
    ctx.classifier = {
      onStep: (s) => s,
    };
    ctx.parser = {
      parseEvent: () => ({ type: 'thought', content: 'hello', token_count: 10 }),
      extractModel: () => null,
    };
    tc._contexts.set('agent-x', ctx);

    tc.onStdoutLine('agent-x', '{"type":"assistant"}');
    assert.equal(ctx.totalTokens, 10);
  });
});

describe('TrajectoryCapture — TIER_A with recovered errors', () => {
  it('TIER_A when all errors are recovered', () => {
    const tc = makeTc();
    const ctx = makeCtx({ quality: 80, errorsEncountered: 2, errorsRecovered: 2 });
    const result = tc._computeQualityTier(ctx, 'SUCCESS', 0);
    assert.equal(result.tier, 'TIER_A');
    assert.equal(result.reason, 'high_quality_errors_recovered');
  });

  it('TIER_A when errors recovered exceed errors encountered', () => {
    const tc = makeTc();
    const ctx = makeCtx({ quality: 75, errorsEncountered: 1, errorsRecovered: 2 });
    const result = tc._computeQualityTier(ctx, 'SUCCESS', 0);
    assert.equal(result.tier, 'TIER_A');
    assert.equal(result.reason, 'high_quality_errors_recovered');
  });

  it('not TIER_A when errors exceed recoveries', () => {
    const tc = makeTc();
    const ctx = makeCtx({ quality: 80, errorsEncountered: 3, errorsRecovered: 1 });
    const result = tc._computeQualityTier(ctx, 'SUCCESS', 0);
    assert.notEqual(result.tier, 'TIER_A');
  });

  it('TIER_A with zero errors still uses original reason', () => {
    const tc = makeTc();
    const ctx = makeCtx({ quality: 80, errorsEncountered: 0 });
    const result = tc._computeQualityTier(ctx, 'SUCCESS', 0);
    assert.equal(result.tier, 'TIER_A');
    assert.equal(result.reason, 'high_quality_no_errors');
  });
});

describe('TrajectoryCapture — _computeQuality', () => {
  it('base score is 50', () => {
    const tc = makeTc();
    const ctx = makeCtx({ allSteps: [] });
    ctx.coordinationEvents = 0;
    ctx.errorsRecovered = 0;
    ctx.stepCount = 0;
    const quality = tc._computeQuality(ctx);
    assert.equal(quality, 50);
  });

  it('correction adds 10 points', () => {
    const tc = makeTc();
    const ctx = makeCtx({
      allSteps: [{ step: 1, type: 'correction', content: 'fix' }],
    });
    ctx.coordinationEvents = 0;
    ctx.errorsRecovered = 0;
    ctx.stepCount = 1;
    const quality = tc._computeQuality(ctx);
    assert.ok(quality >= 60);
  });

  it('coordination adds 10 points', () => {
    const tc = makeTc();
    const ctx = makeCtx({ allSteps: [] });
    ctx.coordinationEvents = 1;
    ctx.errorsRecovered = 0;
    ctx.stepCount = 0;
    const quality = tc._computeQuality(ctx);
    assert.equal(quality, 60);
  });

  it('caps at 100', () => {
    const tc = makeTc();
    const ctx = makeCtx({
      allSteps: [
        { step: 1, type: 'correction' },
        { step: 2, type: 'thought' },
        { step: 3, type: 'action' },
        { step: 4, type: 'observation' },
        ...Array.from({ length: 16 }, (_, i) => ({ step: i + 5, type: 'thought' })),
      ],
    });
    ctx.coordinationEvents = 5;
    ctx.errorsRecovered = 3;
    ctx.stepCount = 20;
    const quality = tc._computeQuality(ctx);
    assert.equal(quality, 100);
  });
});

describe('TrajectoryCapture — domain_tags in SESSION_CLOSE', () => {
  it('domain_tags set on ctx.metadata flow into SESSION_CLOSE via updateMetadata', () => {
    const tc = makeTc();
    const captured = [];
    tc._signAndTransmit = (_sid, envelope) => { captured.push(envelope); };

    const ctx = makeCtx();
    ctx.metadata.domain_tags = {
      primary: { domain: 'react_frontend', confidence: 0.3 },
      secondary: { domain: 'typescript_node', confidence: 0.25 },
      tertiary: { domain: 'python', confidence: 0 },
    };

    ctx.builder.updateMetadata({
      domain_tags: ctx.metadata.domain_tags,
      session_quality: ctx.metadata.session_quality,
    });
    const close = ctx.builder.buildSessionClose({
      status: 'SUCCESS', total_steps: 10, total_chunks: 1,
    });

    assert.ok(close.metadata, 'SESSION_CLOSE must have metadata');
    assert.deepEqual(close.metadata.domain_tags, ctx.metadata.domain_tags);
  });

  it('SESSION_CLOSE metadata is absent domain_tags when tagger returns null', () => {
    const ctx = makeCtx();
    ctx.metadata.domain_tags = null;

    ctx.builder.updateMetadata({
      domain_tags: null,
      session_quality: ctx.metadata.session_quality,
    });
    const close = ctx.builder.buildSessionClose({
      status: 'SUCCESS', total_steps: 5, total_chunks: 1,
    });

    assert.ok(close.metadata, 'SESSION_CLOSE must have metadata');
    assert.equal(close.metadata.domain_tags, null);
  });
});

describe('TrajectoryCapture — onParsedOutput', () => {
  function makeEnabledTc() {
    const tc = makeTc();
    tc._enabled = true;
    tc._scrubber = { scrub: (s) => s };
    const ctx = makeCtx();
    ctx.totalTokens = 0;
    ctx.stepCount = 0;
    ctx.allSteps = [];
    ctx.builder = { addStep: () => null };
    ctx.classifier = { onStep: (s) => s };
    tc._contexts.set('agent-loop-1', ctx);
    return { tc, ctx };
  }

  it('converts assistant activity to thought step', () => {
    const { tc, ctx } = makeEnabledTc();
    tc.onParsedOutput('agent-loop-1', { type: 'activity', subtype: 'assistant', data: 'I will fix the bug' });
    assert.equal(ctx.stepCount, 1);
    assert.equal(ctx.allSteps[0].type, 'thought');
    assert.equal(ctx.allSteps[0].content, 'I will fix the bug');
  });

  it('converts tool_use activity to action step', () => {
    const { tc, ctx } = makeEnabledTc();
    tc.onParsedOutput('agent-loop-1', {
      type: 'activity', subtype: 'tool_use',
      data: [{ type: 'tool_use', name: 'Edit', input: { path: 'foo.js' } }],
    });
    assert.equal(ctx.stepCount, 1);
    assert.equal(ctx.allSteps[0].type, 'action');
    assert.equal(ctx.allSteps[0].tool, 'Edit');
  });

  it('converts successful tool_result to observation step', () => {
    const { tc, ctx } = makeEnabledTc();
    tc.onParsedOutput('agent-loop-1', {
      type: 'activity', subtype: 'tool_result',
      data: [{ type: 'tool_result', name: 'Bash', success: true, output: 'tests passed' }],
    });
    assert.equal(ctx.stepCount, 1);
    assert.equal(ctx.allSteps[0].type, 'observation');
    assert.equal(ctx.allSteps[0].content, 'tests passed');
  });

  it('converts failed tool_result to error step', () => {
    const { tc, ctx } = makeEnabledTc();
    tc.onParsedOutput('agent-loop-1', {
      type: 'activity', subtype: 'tool_result',
      data: [{ type: 'tool_result', name: 'Bash', success: false, output: 'command not found' }],
    });
    assert.equal(ctx.stepCount, 1);
    assert.equal(ctx.allSteps[0].type, 'error');
    assert.equal(ctx.allSteps[0].is_error, true);
  });

  it('converts result to resolution step', () => {
    const { tc, ctx } = makeEnabledTc();
    tc.onParsedOutput('agent-loop-1', { type: 'result', subtype: 'assistant', data: 'Task complete' });
    assert.equal(ctx.stepCount, 1);
    assert.equal(ctx.allSteps[0].type, 'resolution');
    assert.equal(ctx.allSteps[0].content, 'Task complete');
  });

  it('ignores stream activity (partial deltas)', () => {
    const { tc, ctx } = makeEnabledTc();
    tc.onParsedOutput('agent-loop-1', { type: 'activity', subtype: 'stream', data: 'partial' });
    assert.equal(ctx.stepCount, 0);
  });

  it('ignores token-only activity', () => {
    const { tc, ctx } = makeEnabledTc();
    tc.onParsedOutput('agent-loop-1', { type: 'activity', tokensUsed: 500, inputTokens: 400, outputTokens: 100 });
    assert.equal(ctx.stepCount, 0);
  });

  it('silently returns for unknown agent', () => {
    const { tc } = makeEnabledTc();
    tc.onParsedOutput('unknown-agent', { type: 'activity', subtype: 'assistant', data: 'hello' });
  });

  it('silently returns when disabled', () => {
    const { tc, ctx } = makeEnabledTc();
    tc._enabled = false;
    tc.onParsedOutput('agent-loop-1', { type: 'activity', subtype: 'assistant', data: 'hello' });
    assert.equal(ctx.stepCount, 0);
  });

  it('accumulates tokens across multiple outputs', () => {
    const { tc, ctx } = makeEnabledTc();
    tc.onParsedOutput('agent-loop-1', { type: 'activity', subtype: 'assistant', data: 'thinking about the problem' });
    tc.onParsedOutput('agent-loop-1', {
      type: 'activity', subtype: 'tool_use',
      data: [{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }],
    });
    tc.onParsedOutput('agent-loop-1', {
      type: 'activity', subtype: 'tool_result',
      data: [{ type: 'tool_result', name: 'Bash', success: true, output: 'file1.js\nfile2.js' }],
    });
    assert.equal(ctx.stepCount, 3);
    assert.ok(ctx.totalTokens > 0);
  });
});
