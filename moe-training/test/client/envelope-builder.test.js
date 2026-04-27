// FSL-1.1-Apache-2.0 — see LICENSE

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EnvelopeBuilder } from '../../client/envelope-builder.js';
import { CHUNK_SIZE } from '../../shared/constants.js';

const metadata = {
  model_engine: 'claude-opus-4-6',
  provider: 'claude-code',
  agent_role: 'backend',
  agent_id: 'backend-1',
  task_complexity: 'medium',
  team_size: 2,
  session_quality: 80,
  groove_version: '0.27.0',
};

describe('EnvelopeBuilder', () => {
  it('adding steps below CHUNK_SIZE returns null', () => {
    const builder = new EnvelopeBuilder('sess_1', 'user_1', metadata);
    for (let i = 0; i < CHUNK_SIZE - 1; i++) {
      const result = builder.addStep({ step: i + 1, type: 'thought', timestamp: Date.now() / 1000 });
      assert.equal(result, null);
    }
  });

  it('adding step that hits CHUNK_SIZE returns envelope', () => {
    const builder = new EnvelopeBuilder('sess_1', 'user_1', metadata);
    let envelope = null;
    for (let i = 0; i < CHUNK_SIZE; i++) {
      envelope = builder.addStep({ step: i + 1, type: 'thought', timestamp: Date.now() / 1000 });
    }
    assert.ok(envelope);
    assert.equal(envelope.trajectory_log.length, CHUNK_SIZE);
    assert.equal(envelope.session_id, 'sess_1');
    assert.equal(envelope.contributor_id, 'user_1');
    assert.ok(envelope.envelope_id.startsWith('env_'));
    assert.equal(envelope.chunk_sequence, 0);
  });

  it('flush returns remaining steps', () => {
    const builder = new EnvelopeBuilder('sess_1', 'user_1', metadata);
    builder.addStep({ step: 1, type: 'thought', timestamp: 123 });
    builder.addStep({ step: 2, type: 'action', timestamp: 124 });
    const envelope = builder.flush();
    assert.ok(envelope);
    assert.equal(envelope.trajectory_log.length, 2);
  });

  it('flush returns null when buffer is empty', () => {
    const builder = new EnvelopeBuilder('sess_1', 'user_1', metadata);
    assert.equal(builder.flush(), null);
  });

  it('SESSION_CLOSE includes outcome data', () => {
    const builder = new EnvelopeBuilder('sess_1', 'user_1', metadata);
    const outcome = {
      status: 'SUCCESS',
      user_interventions: 1,
      total_steps: 50,
      total_chunks: 1,
      total_tokens: 5000,
      duration_seconds: 120,
      files_modified: 3,
      errors_encountered: 1,
      errors_recovered: 1,
      coordination_events: 0,
    };
    const close = builder.buildSessionClose(outcome);
    assert.ok(close.envelope_id.startsWith('env_'));
    assert.equal(close.session_id, 'sess_1');
    assert.equal(close.type, 'SESSION_CLOSE');
    assert.deepEqual(close.outcome, outcome);
  });

  it('truncates step content at 10000 characters', () => {
    const builder = new EnvelopeBuilder('sess_1', 'user_1', metadata);
    const longContent = 'x'.repeat(15_000);
    builder.addStep({ step: 1, type: 'thought', timestamp: 123, content: longContent });
    const envelope = builder.flush();
    assert.equal(envelope.trajectory_log[0].content.length, 10_000);
  });

  it('caps token_count at 100000', () => {
    const builder = new EnvelopeBuilder('sess_1', 'user_1', metadata);
    builder.addStep({ step: 1, type: 'thought', timestamp: 123, token_count: 999_999 });
    const envelope = builder.flush();
    assert.equal(envelope.trajectory_log[0].token_count, 100_000);
  });

  it('includes leaf_context in metadata defaulting to null', () => {
    const builder = new EnvelopeBuilder('sess_1', 'user_1', metadata);
    builder.addStep({ step: 1, type: 'thought', timestamp: 123 });
    const envelope = builder.flush();
    assert.equal(envelope.metadata.leaf_context, null);
  });

  it('preserves provided leaf_context', () => {
    const metaWithLeaf = { ...metadata, leaf_context: { leaf_id: 'py_v1', leaf_version: '1.0', confidence_at_route: 0.4, chassis_model: 'Qwen' } };
    const builder = new EnvelopeBuilder('sess_1', 'user_1', metaWithLeaf);
    builder.addStep({ step: 1, type: 'thought', timestamp: 123 });
    const envelope = builder.flush();
    assert.equal(envelope.metadata.leaf_context.leaf_id, 'py_v1');
  });

  it('SESSION_CLOSE passes through quality_tier and training fields', () => {
    const builder = new EnvelopeBuilder('sess_1', 'user_1', metadata);
    const outcome = {
      status: 'SUCCESS', total_steps: 10, total_chunks: 1,
      quality_tier: 'TIER_A', quality_tier_reason: 'high_quality_no_errors',
      training_eligible: true, training_exclusion_reason: null,
    };
    const close = builder.buildSessionClose(outcome);
    assert.equal(close.outcome.quality_tier, 'TIER_A');
    assert.equal(close.outcome.training_eligible, true);
    assert.equal(close.outcome.training_exclusion_reason, null);
  });

  it('updateMetadata syncs late-computed fields to builder', () => {
    const builder = new EnvelopeBuilder('sess_1', 'user_1', metadata);
    const domainTags = {
      primary: { domain: 'react_frontend', confidence: 0.3 },
      secondary: { domain: 'typescript_node', confidence: 0.25 },
      tertiary: { domain: 'python', confidence: 0 },
    };
    builder.updateMetadata({ domain_tags: domainTags, session_quality: 85 });

    builder.addStep({ step: 1, type: 'thought', timestamp: 123 });
    const envelope = builder.flush();
    assert.deepEqual(envelope.metadata.domain_tags, domainTags);
    assert.equal(envelope.metadata.session_quality, 85);
  });

  it('SESSION_CLOSE includes metadata with domain_tags', () => {
    const builder = new EnvelopeBuilder('sess_1', 'user_1', metadata);
    const domainTags = {
      primary: { domain: 'react_frontend', confidence: 0.3 },
      secondary: { domain: 'typescript_node', confidence: 0.25 },
      tertiary: { domain: 'python', confidence: 0 },
    };
    builder.updateMetadata({ domain_tags: domainTags });

    const close = builder.buildSessionClose({
      status: 'SUCCESS', total_steps: 10, total_chunks: 1,
    });
    assert.ok(close.metadata, 'SESSION_CLOSE must include metadata');
    assert.deepEqual(close.metadata.domain_tags, domainTags);
    assert.equal(close.metadata.agent_role, 'backend');
  });

  it('chunk sequence increments correctly', () => {
    const builder = new EnvelopeBuilder('sess_1', 'user_1', metadata);
    let first = null;
    let second = null;

    for (let i = 0; i < CHUNK_SIZE; i++) {
      first = builder.addStep({ step: i + 1, type: 'thought', timestamp: Date.now() / 1000 }) || first;
    }
    for (let i = 0; i < CHUNK_SIZE; i++) {
      second = builder.addStep({ step: CHUNK_SIZE + i + 1, type: 'action', timestamp: Date.now() / 1000 }) || second;
    }

    assert.equal(first.chunk_sequence, 0);
    assert.equal(second.chunk_sequence, 1);
  });
});
