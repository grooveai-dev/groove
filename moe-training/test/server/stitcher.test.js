// FSL-1.1-Apache-2.0 — see LICENSE

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EnvelopeStorage } from '../../server/storage.js';
import { TrajectoryStitcher } from '../../server/stitcher.js';

describe('TrajectoryStitcher', () => {
  let storage;
  let stitcher;
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'stitch-test-'));
    storage = new EnvelopeStorage(join(tmpDir, 'envelopes'));
    stitcher = new TrajectoryStitcher(storage);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('stitches 3 chunks into correct order', () => {
    const sessionId = 'sess_stitch_001';

    storage.store({
      session_id: sessionId, chunk_sequence: 2, contributor_id: 'contrib_1',
      metadata: { model_engine: 'claude-opus-4-6', provider: 'claude-code' },
      trajectory_log: [
        { step: 3, type: 'action', tool: 'Edit', token_count: 20 },
        { step: 4, type: 'observation', content: 'done', token_count: 5 },
      ],
    });
    storage.store({
      session_id: sessionId, chunk_sequence: 0, contributor_id: 'contrib_1',
      metadata: { model_engine: 'claude-opus-4-6', provider: 'claude-code' },
      trajectory_log: [
        { step: 1, type: 'thought', content: 'plan', token_count: 10 },
      ],
    });
    storage.store({
      session_id: sessionId, chunk_sequence: 1, contributor_id: 'contrib_1',
      metadata: { model_engine: 'claude-opus-4-6', provider: 'claude-code' },
      trajectory_log: [
        { step: 2, type: 'action', tool: 'Grep', token_count: 15 },
      ],
    });

    const result = stitcher.stitch(sessionId);

    assert.ok(result);
    assert.equal(result.session_id, sessionId);
    assert.equal(result.total_steps, 4);
    assert.equal(result.total_chunks, 3);
    assert.deepEqual(result.trajectory_log.map(s => s.step), [1, 2, 3, 4]);
  });

  it('has all steps present and ordered by step number', () => {
    const sessionId = 'sess_stitch_002';

    storage.store({
      session_id: sessionId, chunk_sequence: 0, contributor_id: 'c1',
      metadata: {},
      trajectory_log: [
        { step: 1, type: 'thought', token_count: 5 },
        { step: 2, type: 'action', tool: 'Read', token_count: 3 },
      ],
    });
    storage.store({
      session_id: sessionId, chunk_sequence: 1, contributor_id: 'c1',
      metadata: {},
      trajectory_log: [
        { step: 3, type: 'observation', token_count: 8 },
      ],
    });

    const result = stitcher.stitch(sessionId);
    assert.equal(result.total_steps, 3);
    assert.equal(result.total_tokens, 16);

    for (let i = 0; i < result.trajectory_log.length - 1; i++) {
      assert.ok(result.trajectory_log[i].step < result.trajectory_log[i + 1].step);
    }
  });

  it('computes step_type_distribution correctly', () => {
    const sessionId = 'sess_stitch_003';

    storage.store({
      session_id: sessionId, chunk_sequence: 0, contributor_id: 'c1',
      metadata: {},
      trajectory_log: [
        { step: 1, type: 'thought', token_count: 5 },
        { step: 2, type: 'action', tool: 'Read', token_count: 3 },
        { step: 3, type: 'action', tool: 'Edit', token_count: 4 },
        { step: 4, type: 'observation', token_count: 2 },
        { step: 5, type: 'error', token_count: 1 },
      ],
    });

    const result = stitcher.stitch(sessionId);
    assert.deepEqual(result.step_type_distribution, {
      thought: 1,
      action: 2,
      observation: 1,
      error: 1,
    });
    assert.deepEqual(result.unique_tools_used.sort(), ['Edit', 'Read']);
  });

  it('returns null for unknown session', () => {
    const result = stitcher.stitch('sess_nonexistent');
    assert.equal(result, null);
  });

  it('includes outcome from SESSION_CLOSE envelope', () => {
    const sessionId = 'sess_stitch_004';

    storage.store({
      session_id: sessionId, chunk_sequence: 0, contributor_id: 'c1',
      metadata: {},
      trajectory_log: [{ step: 1, type: 'thought', token_count: 5 }],
    });
    storage.store({
      session_id: sessionId, type: 'SESSION_CLOSE',
      outcome: { status: 'SUCCESS', total_steps: 1, user_interventions: 0 },
    });

    const result = stitcher.stitch(sessionId);
    assert.ok(result.outcome);
    assert.equal(result.outcome.status, 'SUCCESS');
  });

  it('links coordination steps', () => {
    const sessionId = 'sess_stitch_005';

    storage.store({
      session_id: sessionId, chunk_sequence: 0, contributor_id: 'c1',
      metadata: {},
      trajectory_log: [
        { step: 1, type: 'coordination', coordination_id: 'coord_1', direction: 'outbound', target_agent: 'backend-1', token_count: 5 },
        { step: 2, type: 'thought', token_count: 3 },
      ],
    });

    const result = stitcher.stitch(sessionId);
    const enriched = stitcher.linkCoordination(result);

    const coordStep = enriched.trajectory_log.find(s => s.type === 'coordination');
    assert.ok(coordStep.coordination_partner);
    assert.equal(coordStep.coordination_partner.coordination_id, 'coord_1');
    assert.equal(coordStep.coordination_partner.linked, true);
  });
});
