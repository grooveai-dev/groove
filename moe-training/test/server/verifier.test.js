// FSL-1.1-Apache-2.0 — see LICENSE

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateECDHKeypair, deriveSharedSecret, signEnvelope } from '../../shared/crypto.js';
import { SessionRegistry } from '../../server/session-registry.js';
import { EnvelopeVerifier } from '../../server/verifier.js';

function makeSignedEnvelope(sessionId, sequence, sharedSecret, extra = {}) {
  const envelope = {
    envelope_id: `env_test_${sequence}`,
    session_id: sessionId,
    chunk_sequence: sequence,
    contributor_id: 'test_contributor',
    metadata: { model_engine: 'claude-opus-4-6', provider: 'claude-code', agent_role: 'frontend', agent_id: 'frontend-1' },
    trajectory_log: [{ step: 1, type: 'thought', timestamp: Date.now() / 1000, content: 'test', token_count: 10 }],
    ...extra,
  };

  const forHmac = { ...envelope };
  const envelopeBytes = JSON.stringify(forHmac);
  const hmac = signEnvelope(sharedSecret, envelopeBytes, sequence);

  envelope.attestation = {
    session_hmac: hmac,
    sequence,
    app_version_hash: 'hash_test',
  };

  return envelope;
}

describe('EnvelopeVerifier', () => {
  let registry;
  let verifier;
  let tmpDir;
  let sharedSecret;
  const sessionId = 'sess_verify_001';

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'verify-test-'));
    registry = new SessionRegistry(join(tmpDir, 'sessions.db'));
    verifier = new EnvelopeVerifier(registry);

    const clientKeypair = generateECDHKeypair();
    const result = registry.openSession(
      sessionId, clientKeypair.publicKey, 'claude-code', 'claude-opus-4-6',
      'fp_verify', 'hash_verify', '0.27.77'
    );

    const session = registry.getSession(sessionId);
    sharedSecret = session.shared_secret;
  });

  afterEach(() => {
    registry.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('accepts a valid envelope with correct HMAC', () => {
    const envelope = makeSignedEnvelope(sessionId, 0, sharedSecret);
    const result = verifier.verify(envelope);
    assert.equal(result.valid, true);
  });

  it('rejects a tampered envelope (HMAC fails)', () => {
    const envelope = makeSignedEnvelope(sessionId, 0, sharedSecret);
    envelope.trajectory_log.push({ step: 2, type: 'action', content: 'injected' });
    const result = verifier.verify(envelope);
    assert.equal(result.valid, false);
    assert.ok(result.reason.includes('HMAC'));
  });

  it('rejects wrong sequence number', () => {
    const envelope = makeSignedEnvelope(sessionId, 5, sharedSecret);
    const result = verifier.verify(envelope);
    assert.equal(result.valid, false);
    assert.ok(result.reason.includes('sequence'));
  });

  it('rejects unknown session_id', () => {
    const envelope = makeSignedEnvelope('sess_nonexistent', 0, sharedSecret);
    const result = verifier.verify(envelope);
    assert.equal(result.valid, false);
    assert.ok(result.reason.includes('unknown session_id'));
  });

  it('rejects envelope for closed session', () => {
    registry.closeSession(sessionId);
    const envelope = makeSignedEnvelope(sessionId, 0, sharedSecret);
    const result = verifier.verify(envelope);
    assert.equal(result.valid, false);
    assert.ok(result.reason.includes('closed'));
  });

  it('rejects envelope missing attestation', () => {
    const envelope = {
      session_id: sessionId,
      envelope_id: 'env_no_att',
      trajectory_log: [],
    };
    const result = verifier.verify(envelope);
    assert.equal(result.valid, false);
    assert.ok(result.reason.includes('attestation'));
  });

  it('increments sequence after successful verification', () => {
    const env0 = makeSignedEnvelope(sessionId, 0, sharedSecret);
    const r0 = verifier.verify(env0);
    assert.equal(r0.valid, true);

    const env1 = makeSignedEnvelope(sessionId, 1, sharedSecret);
    const r1 = verifier.verify(env1);
    assert.equal(r1.valid, true);

    const session = registry.getSession(sessionId);
    assert.equal(session.expected_sequence, 2);
  });
});
