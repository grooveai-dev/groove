// FSL-1.1-Apache-2.0 — see LICENSE

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateEnvelope, STEP_TYPES } from '../../shared/envelope-schema.js';
import { TRAINING_EXCLUSION_REASONS } from '../../shared/constants.js';

const VALID_HMAC = 'a'.repeat(64);
const VALID_APP_HASH = 'b'.repeat(64);
const VALID_CONTRIBUTOR = 'c'.repeat(32);

function validEnvelope() {
  return {
    envelope_id: 'env_test-123',
    session_id: 'sess_test-456',
    chunk_sequence: 0,
    contributor_id: VALID_CONTRIBUTOR,
    attestation: { session_hmac: VALID_HMAC, sequence: 0, app_version_hash: VALID_APP_HASH },
    metadata: {
      model_engine: 'claude-opus-4-6',
      provider: 'claude-code',
      agent_role: 'backend',
      agent_id: 'backend-1',
      task_complexity: 'medium',
      team_size: 2,
      groove_version: '0.27.0',
    },
    trajectory_log: [
      { step: 1, type: 'thought', timestamp: Date.now() / 1000, content: 'thinking...', token_count: 10 },
      { step: 2, type: 'action', timestamp: Date.now() / 1000, tool: 'Read', content: 'reading file' },
    ],
  };
}

describe('envelope-schema', () => {
  it('valid envelope passes validation', () => {
    const result = validateEnvelope(validEnvelope());
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
  });

  it('null envelope fails', () => {
    const result = validateEnvelope(null);
    assert.equal(result.valid, false);
  });

  it('missing session_id fails', () => {
    const env = validEnvelope();
    delete env.session_id;
    const result = validateEnvelope(env);
    assert.equal(result.valid, false);
  });

  it('missing metadata.provider fails', () => {
    const env = validEnvelope();
    delete env.metadata.provider;
    const result = validateEnvelope(env);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('provider')));
  });

  it('invalid step type fails', () => {
    const env = validEnvelope();
    env.trajectory_log[0].type = 'invalid_type';
    const result = validateEnvelope(env);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('invalid_type')));
  });

  it('missing step number fails', () => {
    const env = validEnvelope();
    delete env.trajectory_log[0].step;
    const result = validateEnvelope(env);
    assert.equal(result.valid, false);
  });

  it('missing timestamp fails', () => {
    const env = validEnvelope();
    delete env.trajectory_log[0].timestamp;
    const result = validateEnvelope(env);
    assert.equal(result.valid, false);
  });

  it('all STEP_TYPES are valid', () => {
    for (const type of STEP_TYPES) {
      const env = validEnvelope();
      env.trajectory_log = [{ step: 1, type, timestamp: Date.now() / 1000 }];
      const result = validateEnvelope(env);
      assert.equal(result.valid, true, `Type "${type}" should be valid`);
    }
  });

  it('edit step type is valid', () => {
    const env = validEnvelope();
    env.trajectory_log = [{
      step: 1, type: 'edit', timestamp: Date.now() / 1000,
      file_path: 'index.html', edit_type: 'create', content: '<html></html>',
      token_count: 5,
    }];
    const result = validateEnvelope(env);
    assert.equal(result.valid, true);
  });

  // --- New security tests ---

  it('rejects trajectory_log with > 500 steps', () => {
    const env = validEnvelope();
    env.trajectory_log = Array.from({ length: 501 }, (_, i) => ({
      step: i, type: 'thought', timestamp: Date.now() / 1000,
    }));
    const result = validateEnvelope(env);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('500')));
  });

  it('rejects step with content > 10KB', () => {
    const env = validEnvelope();
    env.trajectory_log[0].content = 'x'.repeat(10_001);
    const result = validateEnvelope(env);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('10000')));
  });

  it('rejects step with token_count > 100,000', () => {
    const env = validEnvelope();
    env.trajectory_log[0].token_count = 100_001;
    const result = validateEnvelope(env);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('token_count')));
  });

  it('rejects step with negative token_count', () => {
    const env = validEnvelope();
    env.trajectory_log[0].token_count = -1;
    const result = validateEnvelope(env);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('token_count')));
  });

  it('rejects step with step number > 50,000', () => {
    const env = validEnvelope();
    env.trajectory_log[0].step = 50_001;
    const result = validateEnvelope(env);
    assert.equal(result.valid, false);
  });

  it('rejects step with negative step number', () => {
    const env = validEnvelope();
    env.trajectory_log[0].step = -1;
    const result = validateEnvelope(env);
    assert.equal(result.valid, false);
  });

  it('rejects invalid provider', () => {
    const env = validEnvelope();
    env.metadata.provider = 'fake-provider';
    const result = validateEnvelope(env);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('provider')));
  });

  it('rejects invalid model_engine', () => {
    const env = validEnvelope();
    env.metadata.model_engine = 'gpt-5-turbo';
    const result = validateEnvelope(env);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('model_engine')));
  });

  it('rejects contributor_id that is not 32-char hex', () => {
    const env = validEnvelope();
    env.contributor_id = 'user_abc';
    const result = validateEnvelope(env);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('contributor_id')));
  });

  it('rejects contributor_id with uppercase hex', () => {
    const env = validEnvelope();
    env.contributor_id = 'A'.repeat(32);
    const result = validateEnvelope(env);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('contributor_id')));
  });

  it('rejects attestation.session_hmac that is not 64-char hex', () => {
    const env = validEnvelope();
    env.attestation.session_hmac = 'abc';
    const result = validateEnvelope(env);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('session_hmac')));
  });

  it('rejects attestation.app_version_hash that is not 64-char hex', () => {
    const env = validEnvelope();
    env.attestation.app_version_hash = 'def';
    const result = validateEnvelope(env);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('app_version_hash')));
  });

  it('rejects future timestamps beyond 1 hour', () => {
    const env = validEnvelope();
    env.trajectory_log[0].timestamp = (Date.now() + 2 * 60 * 60 * 1000) / 1000;
    const result = validateEnvelope(env);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('Timestamp out of range')));
  });

  it('rejects timestamps older than 7 days', () => {
    const env = validEnvelope();
    env.trajectory_log[0].timestamp = (Date.now() - 8 * 24 * 60 * 60 * 1000) / 1000;
    const result = validateEnvelope(env);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('Timestamp out of range')));
  });

  it('rejects team_size outside 1-50', () => {
    const env = validEnvelope();
    env.metadata.team_size = 0;
    let result = validateEnvelope(env);
    assert.equal(result.valid, false);

    env.metadata.team_size = 51;
    result = validateEnvelope(env);
    assert.equal(result.valid, false);
  });

  it('rejects invalid task_complexity', () => {
    const env = validEnvelope();
    env.metadata.task_complexity = 'extreme';
    const result = validateEnvelope(env);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('task_complexity')));
  });

  it('accepts absent optional metadata fields', () => {
    const env = validEnvelope();
    delete env.metadata.team_size;
    delete env.metadata.task_complexity;
    delete env.metadata.groove_version;
    const result = validateEnvelope(env);
    assert.equal(result.valid, true);
  });

  it('valid SESSION_CLOSE passes', () => {
    const close = {
      envelope_id: 'env_close-1',
      session_id: 'sess_test-1',
      type: 'SESSION_CLOSE',
      attestation: { session_hmac: VALID_HMAC, sequence: 5, app_version_hash: VALID_APP_HASH },
      outcome: {
        status: 'SUCCESS',
        user_interventions: 1,
        total_steps: 100,
        total_chunks: 2,
        total_tokens: 5000,
        duration_seconds: 300,
        files_modified: 3,
        errors_encountered: 1,
        errors_recovered: 1,
        coordination_events: 0,
      },
    };
    const result = validateEnvelope(close);
    assert.equal(result.valid, true);
  });

  it('SESSION_CLOSE missing outcome fails', () => {
    const close = {
      envelope_id: 'env_close-1',
      session_id: 'sess_test-1',
      type: 'SESSION_CLOSE',
      attestation: { session_hmac: VALID_HMAC, sequence: 5, app_version_hash: VALID_APP_HASH },
    };
    const result = validateEnvelope(close);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('outcome')));
  });

  it('SESSION_CLOSE missing status fails', () => {
    const close = {
      envelope_id: 'env_close-1',
      session_id: 'sess_test-1',
      type: 'SESSION_CLOSE',
      attestation: { session_hmac: VALID_HMAC, sequence: 0, app_version_hash: VALID_APP_HASH },
      outcome: { total_steps: 10, total_chunks: 1 },
    };
    const result = validateEnvelope(close);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('status')));
  });

  it('SESSION_CLOSE rejects invalid outcome status', () => {
    const close = {
      envelope_id: 'env_close-1',
      session_id: 'sess_test-1',
      type: 'SESSION_CLOSE',
      attestation: { session_hmac: VALID_HMAC, sequence: 0, app_version_hash: VALID_APP_HASH },
      outcome: { status: 'TIMEOUT', total_steps: 10, total_chunks: 1 },
    };
    const result = validateEnvelope(close);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('status')));
  });

  it('SESSION_CLOSE rejects negative outcome numerics', () => {
    const close = {
      envelope_id: 'env_close-1',
      session_id: 'sess_test-1',
      type: 'SESSION_CLOSE',
      attestation: { session_hmac: VALID_HMAC, sequence: 0, app_version_hash: VALID_APP_HASH },
      outcome: { status: 'SUCCESS', total_steps: 10, total_chunks: 1, user_interventions: -5 },
    };
    const result = validateEnvelope(close);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('user_interventions')));
  });

  it('SESSION_CLOSE rejects outcome numerics > 50,000', () => {
    const close = {
      envelope_id: 'env_close-1',
      session_id: 'sess_test-1',
      type: 'SESSION_CLOSE',
      attestation: { session_hmac: VALID_HMAC, sequence: 0, app_version_hash: VALID_APP_HASH },
      outcome: { status: 'SUCCESS', total_steps: 50_001, total_chunks: 1 },
    };
    const result = validateEnvelope(close);
    assert.equal(result.valid, false);
  });

  it('rejects token_count = 999999', () => {
    const env = validEnvelope();
    env.trajectory_log[0].token_count = 999_999;
    const result = validateEnvelope(env);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('token_count')));
  });

  it('rejects SQL injection in contributor_id', () => {
    const env = validEnvelope();
    env.contributor_id = "'; DROP TABLE balances; --";
    const result = validateEnvelope(env);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('contributor_id')));
  });

  it('rejects attestation.session_hmac = giant string', () => {
    const env = validEnvelope();
    env.attestation.session_hmac = 'x'.repeat(1_000_000);
    const result = validateEnvelope(env);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('session_hmac')));
  });

  it('rejects empty attestation.session_hmac', () => {
    const env = validEnvelope();
    env.attestation.session_hmac = '';
    const result = validateEnvelope(env);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('session_hmac')));
  });

  // --- Observation truncation fields ---

  it('accepts observation step with truncated and original_token_count', () => {
    const env = validEnvelope();
    env.trajectory_log.push({
      step: 3, type: 'observation', timestamp: Date.now() / 1000,
      content: 'output', token_count: 100, truncated: false, original_token_count: 100,
    });
    const result = validateEnvelope(env);
    assert.equal(result.valid, true);
  });

  it('accepts observation step with truncated=true', () => {
    const env = validEnvelope();
    env.trajectory_log.push({
      step: 3, type: 'observation', timestamp: Date.now() / 1000,
      content: 'output...', token_count: 4096, truncated: true, original_token_count: 9000,
    });
    const result = validateEnvelope(env);
    assert.equal(result.valid, true);
  });

  it('rejects non-boolean truncated field', () => {
    const env = validEnvelope();
    env.trajectory_log[0].truncated = 'yes';
    const result = validateEnvelope(env);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('truncated')));
  });

  it('rejects negative original_token_count', () => {
    const env = validEnvelope();
    env.trajectory_log[0].original_token_count = -5;
    const result = validateEnvelope(env);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('original_token_count')));
  });

  it('steps without truncation fields still validate (backward compat)', () => {
    const env = validEnvelope();
    assert.equal(env.trajectory_log[0].truncated, undefined);
    const result = validateEnvelope(env);
    assert.equal(result.valid, true);
  });

  // --- domain_tags ---

  it('accepts null domain_tags in metadata', () => {
    const env = validEnvelope();
    env.metadata.domain_tags = null;
    const result = validateEnvelope(env);
    assert.equal(result.valid, true);
  });

  it('accepts absent domain_tags in metadata (backward compat)', () => {
    const env = validEnvelope();
    assert.equal(env.metadata.domain_tags, undefined);
    const result = validateEnvelope(env);
    assert.equal(result.valid, true);
  });

  it('accepts valid domain_tags object', () => {
    const env = validEnvelope();
    env.metadata.domain_tags = {
      primary: { domain: 'python', confidence: 0.42 },
      secondary: { domain: 'data_science_ml', confidence: 0.23 },
      tertiary: { domain: 'devops_docker', confidence: 0.11 },
    };
    const result = validateEnvelope(env);
    assert.equal(result.valid, true);
  });

  it('rejects domain_tags with invalid confidence', () => {
    const env = validEnvelope();
    env.metadata.domain_tags = {
      primary: { domain: 'python', confidence: 1.5 },
      secondary: { domain: 'rust', confidence: 0.2 },
      tertiary: { domain: 'react_frontend', confidence: 0.1 },
    };
    const result = validateEnvelope(env);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('confidence')));
  });

  it('rejects domain_tags missing tertiary', () => {
    const env = validEnvelope();
    env.metadata.domain_tags = {
      primary: { domain: 'python', confidence: 0.4 },
      secondary: { domain: 'rust', confidence: 0.2 },
    };
    const result = validateEnvelope(env);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('tertiary')));
  });

  // --- leaf_context ---

  it('accepts null leaf_context in metadata', () => {
    const env = validEnvelope();
    env.metadata.leaf_context = null;
    const result = validateEnvelope(env);
    assert.equal(result.valid, true);
  });

  it('accepts absent leaf_context in metadata (backward compat)', () => {
    const env = validEnvelope();
    assert.equal(env.metadata.leaf_context, undefined);
    const result = validateEnvelope(env);
    assert.equal(result.valid, true);
  });

  it('accepts valid leaf_context object', () => {
    const env = validEnvelope();
    env.metadata.leaf_context = {
      leaf_id: 'python_expert_v3', leaf_version: '1.2.0',
      confidence_at_route: 0.42, chassis_model: 'Qwen/Qwen3-0.6B',
    };
    const result = validateEnvelope(env);
    assert.equal(result.valid, true);
  });

  it('rejects leaf_context with invalid confidence_at_route', () => {
    const env = validEnvelope();
    env.metadata.leaf_context = {
      leaf_id: 'test', leaf_version: '1.0', confidence_at_route: 1.5, chassis_model: 'test',
    };
    const result = validateEnvelope(env);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('confidence_at_route')));
  });

  // --- Quality tier in SESSION_CLOSE ---

  it('SESSION_CLOSE accepts quality_tier and training fields', () => {
    const close = {
      envelope_id: 'env_close-qt',
      session_id: 'sess_test-qt',
      type: 'SESSION_CLOSE',
      attestation: { session_hmac: VALID_HMAC, sequence: 0, app_version_hash: VALID_APP_HASH },
      outcome: {
        status: 'SUCCESS', total_steps: 10, total_chunks: 1,
        quality_tier: 'TIER_A', quality_tier_reason: 'high_quality_no_errors',
        training_eligible: true, training_exclusion_reason: null,
      },
    };
    const result = validateEnvelope(close);
    assert.equal(result.valid, true);
  });

  it('SESSION_CLOSE rejects invalid quality_tier', () => {
    const close = {
      envelope_id: 'env_close-qt2',
      session_id: 'sess_test-qt2',
      type: 'SESSION_CLOSE',
      attestation: { session_hmac: VALID_HMAC, sequence: 0, app_version_hash: VALID_APP_HASH },
      outcome: {
        status: 'SUCCESS', total_steps: 10, total_chunks: 1,
        quality_tier: 'TIER_Z',
      },
    };
    const result = validateEnvelope(close);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('quality_tier')));
  });

  it('SESSION_CLOSE rejects invalid training_exclusion_reason', () => {
    const close = {
      envelope_id: 'env_close-te',
      session_id: 'sess_test-te',
      type: 'SESSION_CLOSE',
      attestation: { session_hmac: VALID_HMAC, sequence: 0, app_version_hash: VALID_APP_HASH },
      outcome: {
        status: 'SUCCESS', total_steps: 10, total_chunks: 1,
        training_eligible: false, training_exclusion_reason: 'bad_vibes',
      },
    };
    const result = validateEnvelope(close);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('training_exclusion_reason')));
  });

  it('SESSION_CLOSE rejects non-boolean training_eligible', () => {
    const close = {
      envelope_id: 'env_close-te2',
      session_id: 'sess_test-te2',
      type: 'SESSION_CLOSE',
      attestation: { session_hmac: VALID_HMAC, sequence: 0, app_version_hash: VALID_APP_HASH },
      outcome: {
        status: 'SUCCESS', total_steps: 10, total_chunks: 1,
        training_eligible: 'yes',
      },
    };
    const result = validateEnvelope(close);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('training_eligible')));
  });

  it('SESSION_CLOSE without new fields still validates (backward compat)', () => {
    const close = {
      envelope_id: 'env_close-bc',
      session_id: 'sess_test-bc',
      type: 'SESSION_CLOSE',
      attestation: { session_hmac: VALID_HMAC, sequence: 0, app_version_hash: VALID_APP_HASH },
      outcome: { status: 'SUCCESS', total_steps: 10, total_chunks: 1 },
    };
    const result = validateEnvelope(close);
    assert.equal(result.valid, true);
  });

  // --- USER_FEEDBACK validation ---

  it('valid USER_FEEDBACK passes', () => {
    const feedback = {
      envelope_id: 'env_fb_1',
      session_id: 'sess_fb_1',
      type: 'USER_FEEDBACK',
      attestation: { session_hmac: VALID_HMAC, sequence: 0, app_version_hash: VALID_APP_HASH },
      feedback: {
        signal: 'accepted', timestamp: Date.now() / 1000,
        context: 'user ran code without modifications',
        target_step: 10, revision_rounds: 0, delta_summary: null,
      },
    };
    const result = validateEnvelope(feedback);
    assert.equal(result.valid, true);
  });

  it('USER_FEEDBACK rejects invalid signal', () => {
    const feedback = {
      envelope_id: 'env_fb_2',
      session_id: 'sess_fb_2',
      type: 'USER_FEEDBACK',
      attestation: { session_hmac: VALID_HMAC, sequence: 0, app_version_hash: VALID_APP_HASH },
      feedback: { signal: 'thumbs_up', timestamp: Date.now() / 1000 },
    };
    const result = validateEnvelope(feedback);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('signal')));
  });

  it('USER_FEEDBACK rejects missing feedback object', () => {
    const feedback = {
      envelope_id: 'env_fb_3',
      session_id: 'sess_fb_3',
      type: 'USER_FEEDBACK',
      attestation: { session_hmac: VALID_HMAC, sequence: 0, app_version_hash: VALID_APP_HASH },
    };
    const result = validateEnvelope(feedback);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('feedback')));
  });

  it('USER_FEEDBACK accepts all valid signal types', () => {
    for (const signal of ['accepted', 'modified', 'rejected', 'iterated']) {
      const feedback = {
        envelope_id: `env_fb_${signal}`,
        session_id: `sess_fb_${signal}`,
        type: 'USER_FEEDBACK',
        attestation: { session_hmac: VALID_HMAC, sequence: 0, app_version_hash: VALID_APP_HASH },
        feedback: { signal, timestamp: Date.now() / 1000 },
      };
      const result = validateEnvelope(feedback);
      assert.equal(result.valid, true, `Signal "${signal}" should be valid`);
    }
  });

  it('USER_FEEDBACK rejects negative revision_rounds', () => {
    const feedback = {
      envelope_id: 'env_fb_neg',
      session_id: 'sess_fb_neg',
      type: 'USER_FEEDBACK',
      attestation: { session_hmac: VALID_HMAC, sequence: 0, app_version_hash: VALID_APP_HASH },
      feedback: { signal: 'iterated', timestamp: Date.now() / 1000, revision_rounds: -1 },
    };
    const result = validateEnvelope(feedback);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('revision_rounds')));
  });
});
