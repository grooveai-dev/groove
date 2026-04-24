// FSL-1.1-Apache-2.0 — see LICENSE

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateEnvelope, STEP_TYPES } from '../../shared/envelope-schema.js';

function validEnvelope() {
  return {
    envelope_id: 'env_test-123',
    session_id: 'sess_test-456',
    chunk_sequence: 0,
    contributor_id: 'user_abc',
    attestation: { session_hmac: 'abc', sequence: 0, app_version_hash: 'def' },
    metadata: {
      model_engine: 'claude-opus-4-6',
      provider: 'claude-code',
      agent_role: 'backend',
      agent_id: 'backend-1',
      task_complexity: 'medium',
      team_size: 2,
      session_quality: 80,
      groove_version: '0.27.0',
    },
    trajectory_log: [
      { step: 1, type: 'thought', timestamp: 1234567890, content: 'thinking...', token_count: 10 },
      { step: 2, type: 'action', timestamp: 1234567891, tool: 'Read', content: 'reading file' },
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

  it('missing envelope_id fails', () => {
    const env = validEnvelope();
    delete env.envelope_id;
    const result = validateEnvelope(env);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('envelope_id')));
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
      env.trajectory_log = [{ step: 1, type, timestamp: 123 }];
      const result = validateEnvelope(env);
      assert.equal(result.valid, true, `Type "${type}" should be valid`);
    }
  });

  it('valid SESSION_CLOSE passes', () => {
    const close = {
      envelope_id: 'env_close-1',
      session_id: 'sess_test-1',
      type: 'SESSION_CLOSE',
      attestation: { session_hmac: 'abc', sequence: 5, app_version_hash: 'def' },
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
      attestation: { session_hmac: 'abc', sequence: 5, app_version_hash: 'def' },
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
      attestation: {},
      outcome: { total_steps: 10, total_chunks: 1 },
    };
    const result = validateEnvelope(close);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('status')));
  });
});
