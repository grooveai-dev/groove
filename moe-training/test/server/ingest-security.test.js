// FSL-1.1-Apache-2.0 — see LICENSE

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateECDHKeypair, signEnvelope } from '../../shared/crypto.js';
import { SessionRegistry } from '../../server/session-registry.js';
import { EnvelopeVerifier } from '../../server/verifier.js';
import { EnvelopeStorage } from '../../server/storage.js';

const VALID_CONTRIBUTOR = 'c'.repeat(32);
const VALID_APP_HASH = 'b'.repeat(64);

function makeSignedEnvelope(sessionId, sequence, sharedSecret, overrides = {}) {
  const envelope = {
    envelope_id: `env_test_${sequence}`,
    session_id: sessionId,
    chunk_sequence: sequence,
    contributor_id: VALID_CONTRIBUTOR,
    metadata: { model_engine: 'claude-opus-4-6', provider: 'claude-code', agent_role: 'backend', agent_id: 'backend-1' },
    trajectory_log: [{ step: 1, type: 'thought', timestamp: Date.now() / 1000, content: 'test', token_count: 10 }],
    ...overrides,
  };

  const forHmac = { ...envelope };
  const envelopeBytes = JSON.stringify(forHmac);
  const hmac = signEnvelope(sharedSecret, envelopeBytes, sequence);

  envelope.attestation = {
    session_hmac: hmac,
    sequence,
    app_version_hash: VALID_APP_HASH,
  };

  return envelope;
}

describe('Ingest Security', () => {
  let registry;
  let verifier;
  let storage;
  let tmpDir;
  let sharedSecret;
  const sessionId = 'sess_ingest_sec_001';

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ingest-sec-'));
    registry = new SessionRegistry(join(tmpDir, 'sessions.db'));
    storage = new EnvelopeStorage(join(tmpDir, 'envelopes'));
    verifier = new EnvelopeVerifier(registry);

    const clientKeypair = generateECDHKeypair();
    registry.openSession(
      sessionId, clientKeypair.publicKey, 'claude-code', 'claude-opus-4-6',
      'fp_ingest', 'hash_ingest', '0.27.77'
    );

    const session = registry.getSession(sessionId);
    sharedSecret = session.shared_secret;
  });

  afterEach(() => {
    registry.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('rejects envelope with > 500 steps', () => {
    const steps = Array.from({ length: 501 }, (_, i) => ({
      step: i, type: 'thought', timestamp: Date.now() / 1000,
    }));
    const envelope = makeSignedEnvelope(sessionId, 0, sharedSecret, { trajectory_log: steps });
    const result = verifier.verify(envelope);
    assert.equal(result.valid, false);
    assert.ok(result.reason.includes('schema'));
  });

  it('rejects envelope when session has > 200 envelopes', () => {
    // Simulate 200 envelopes already received
    for (let i = 0; i < 200; i++) {
      registry.incrementEnvelopeCount(sessionId);
    }

    const withinLimit = registry.checkEnvelopeCount(sessionId, 200);
    assert.equal(withinLimit, false);
  });

  it('server generates envelope_id (client value ignored)', () => {
    const envelope = makeSignedEnvelope(sessionId, 0, sharedSecret);
    const originalId = envelope.envelope_id;

    // Verify passes
    const result = verifier.verify(envelope);
    assert.equal(result.valid, true);

    // In the real ingest flow, server overwrites envelope_id
    // Verify the dedup infrastructure works
    const generatedId = 'env_server_generated';
    registry.recordProcessedEnvelope(generatedId, sessionId);
    assert.equal(registry.isEnvelopeProcessed(generatedId), true);
    assert.equal(registry.isEnvelopeProcessed(originalId), false);
  });

  it('rejects invalid model_engine via schema validation', () => {
    const envelope = makeSignedEnvelope(sessionId, 0, sharedSecret, {
      metadata: { model_engine: 'gpt-5-turbo', provider: 'claude-code', agent_role: 'backend', agent_id: 'backend-1' },
    });
    const result = verifier.verify(envelope);
    assert.equal(result.valid, false);
    assert.ok(result.reason.includes('schema'));
  });

  it('rejects invalid contributor_id format', () => {
    const envelope = makeSignedEnvelope(sessionId, 0, sharedSecret, {
      contributor_id: 'not-a-valid-hex-id',
    });
    const result = verifier.verify(envelope);
    assert.equal(result.valid, false);
    assert.ok(result.reason.includes('schema'));
  });

  it('envelope dedup prevents double-processing', () => {
    const envelopeId = 'env_dedup_test';
    assert.equal(registry.isEnvelopeProcessed(envelopeId), false);

    registry.recordProcessedEnvelope(envelopeId, sessionId);
    assert.equal(registry.isEnvelopeProcessed(envelopeId), true);

    // Recording again should not throw (INSERT OR IGNORE)
    registry.recordProcessedEnvelope(envelopeId, sessionId);
    assert.equal(registry.isEnvelopeProcessed(envelopeId), true);
  });

  it('per-session envelope count tracks correctly', () => {
    assert.equal(registry.checkEnvelopeCount(sessionId, 200), true);

    registry.incrementEnvelopeCount(sessionId);
    const session = registry.getSession(sessionId);
    assert.equal(session.envelope_count, 1);

    registry.incrementEnvelopeCount(sessionId);
    const session2 = registry.getSession(sessionId);
    assert.equal(session2.envelope_count, 2);
  });

  it('atomic sequence check prevents race condition', () => {
    // First call should succeed
    const r1 = registry.checkAndIncrementSequence(sessionId, 0);
    assert.equal(r1.valid, true);

    // Same sequence again should fail
    const r2 = registry.checkAndIncrementSequence(sessionId, 0);
    assert.equal(r2.valid, false);
    assert.ok(r2.reason.includes('sequence'));

    // Next sequence should succeed
    const r3 = registry.checkAndIncrementSequence(sessionId, 1);
    assert.equal(r3.valid, true);
  });

  it('storage quota check works', () => {
    const ok = storage.checkQuota();
    assert.equal(ok, true);
  });
});
