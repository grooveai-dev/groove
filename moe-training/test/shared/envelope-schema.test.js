// FSL-1.1-Apache-2.0 — see LICENSE

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateEnvelope, STEP_TYPES } from '../../shared/envelope-schema.js';

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
});
