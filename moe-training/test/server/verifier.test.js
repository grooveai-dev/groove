// FSL-1.1-Apache-2.0 — see LICENSE

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateECDHKeypair, deriveSharedSecret, signEnvelope } from '../../shared/crypto.js';
import { SessionRegistry } from '../../server/session-registry.js';
import { EnvelopeVerifier } from '../../server/verifier.js';

const VALID_CONTRIBUTOR = 'c'.repeat(32);
const VALID_APP_HASH = 'b'.repeat(64);

function makeSignedEnvelope(sessionId, sequence, sharedSecret, extra = {}) {
  const envelope = {
    envelope_id: `env_test_${sequence}`,
    session_id: sessionId,
    chunk_sequence: sequence,
    contributor_id: VALID_CONTRIBUTOR,
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
    app_version_hash: VALID_APP_HASH,
  };

  return envelope;
}

function makeSignedCloseEnvelope(sessionId, sequence, sharedSecret) {
  const envelope = {
    envelope_id: `env_close_${sequence}`,
    session_id: sessionId,
    type: 'SESSION_CLOSE',
    outcome: {
      status: 'SUCCESS',
      total_steps: 10,
      total_chunks: 1,
      user_interventions: 0,
      total_tokens: 500,
      duration_seconds: 60,
      files_modified: 1,
      errors_encountered: 0,
      errors_recovered: 0,
      coordination_events: 0,
    },
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

  // --- New security tests ---

  it('rejects empty HMAC string', () => {
    const envelope = makeSignedEnvelope(sessionId, 0, sharedSecret);
    envelope.attestation.session_hmac = '';
    const result = verifier.verify(envelope);
    assert.equal(result.valid, false);
    assert.ok(result.reason.includes('HMAC'));
  });

  it('rejects missing HMAC field', () => {
    const envelope = makeSignedEnvelope(sessionId, 0, sharedSecret);
    delete envelope.attestation.session_hmac;
    const result = verifier.verify(envelope);
    assert.equal(result.valid, false);
    assert.ok(result.reason.includes('HMAC'));
  });

  it('atomic sequence prevents duplicate sequence acceptance', () => {
    const env0 = makeSignedEnvelope(sessionId, 0, sharedSecret);
    const r0 = verifier.verify(env0);
    assert.equal(r0.valid, true);

    // Re-sign with sequence 0 again (replay attempt)
    const env0replay = makeSignedEnvelope(sessionId, 0, sharedSecret);
    const rReplay = verifier.verify(env0replay);
    assert.equal(rReplay.valid, false);
    assert.ok(rReplay.reason.includes('sequence'));
  });

  it('verifyClose checks sequence number', () => {
    // Send one regular envelope first (sequence 0)
    const env0 = makeSignedEnvelope(sessionId, 0, sharedSecret);
    verifier.verify(env0);

    // Close with wrong sequence
    const closeWrong = makeSignedCloseEnvelope(sessionId, 0, sharedSecret);
    const resultWrong = verifyClose(verifier, closeWrong);
    assert.equal(resultWrong.valid, false);
    assert.ok(resultWrong.reason.includes('sequence'));

    // Close with correct sequence
    const closeRight = makeSignedCloseEnvelope(sessionId, 1, sharedSecret);
    const resultRight = verifyClose(verifier, closeRight);
    assert.equal(resultRight.valid, true);
  });

  it('verifyClose rejects empty HMAC', () => {
    const closeEnv = makeSignedCloseEnvelope(sessionId, 0, sharedSecret);
    closeEnv.attestation.session_hmac = '';
    const result = verifier.verifyClose(closeEnv);
    assert.equal(result.valid, false);
    assert.ok(result.reason.includes('HMAC'));
  });

  it('rejects OFFLINE HMAC marker from offline client', () => {
    const envelope = makeSignedEnvelope(sessionId, 0, sharedSecret);
    envelope.attestation.session_hmac = 'OFFLINE';
    const result = verifier.verify(envelope);
    assert.equal(result.valid, false);
    assert.ok(result.reason.includes('HMAC'));
  });

  it('rejects mega-length HMAC string', () => {
    const envelope = makeSignedEnvelope(sessionId, 0, sharedSecret);
    envelope.attestation.session_hmac = 'a'.repeat(1_000_000);
    const result = verifier.verify(envelope);
    assert.equal(result.valid, false);
    assert.ok(result.reason.includes('HMAC'));
  });

  // --- verifyFeedback ---

  it('verifyFeedback accepts valid USER_FEEDBACK envelope', () => {
    const envelope = {
      envelope_id: 'env_fb_1',
      session_id: sessionId,
      type: 'USER_FEEDBACK',
      feedback: {
        signal: 'accepted',
        timestamp: Date.now() / 1000,
        context: 'completed with no interventions',
        target_step: 10,
        revision_rounds: 0,
        delta_summary: null,
      },
    };

    const forHmac = { ...envelope };
    const envelopeBytes = JSON.stringify(forHmac);
    const hmac = signEnvelope(sharedSecret, envelopeBytes, 0);
    envelope.attestation = { session_hmac: hmac, sequence: 0, app_version_hash: VALID_APP_HASH };

    const result = verifier.verifyFeedback(envelope);
    assert.equal(result.valid, true);
  });

  it('verifyFeedback rejects unknown session_id', () => {
    const envelope = {
      envelope_id: 'env_fb_2',
      session_id: 'sess_nonexistent',
      type: 'USER_FEEDBACK',
      feedback: { signal: 'accepted', timestamp: Date.now() / 1000 },
      attestation: { session_hmac: 'a'.repeat(64), sequence: 0, app_version_hash: VALID_APP_HASH },
    };
    const result = verifier.verifyFeedback(envelope);
    assert.equal(result.valid, false);
    assert.ok(result.reason.includes('unknown session_id'));
  });

  it('verifyFeedback rejects missing attestation', () => {
    const envelope = {
      envelope_id: 'env_fb_3',
      session_id: sessionId,
      type: 'USER_FEEDBACK',
      feedback: { signal: 'accepted', timestamp: Date.now() / 1000 },
    };
    const result = verifier.verifyFeedback(envelope);
    assert.equal(result.valid, false);
    assert.ok(result.reason.includes('attestation'));
  });

  it('verifyFeedback rejects tampered HMAC', () => {
    const envelope = {
      envelope_id: 'env_fb_4',
      session_id: sessionId,
      type: 'USER_FEEDBACK',
      feedback: { signal: 'accepted', timestamp: Date.now() / 1000 },
      attestation: { session_hmac: 'f'.repeat(64), sequence: 0, app_version_hash: VALID_APP_HASH },
    };
    const result = verifier.verifyFeedback(envelope);
    assert.equal(result.valid, false);
    assert.ok(result.reason.includes('HMAC'));
  });

  it('verifyFeedback rejects invalid signal via schema', () => {
    const envelope = {
      envelope_id: 'env_fb_5',
      session_id: sessionId,
      type: 'USER_FEEDBACK',
      feedback: { signal: 'thumbs_up', timestamp: Date.now() / 1000 },
    };

    const forHmac = { ...envelope };
    const envelopeBytes = JSON.stringify(forHmac);
    const hmac = signEnvelope(sharedSecret, envelopeBytes, 0);
    envelope.attestation = { session_hmac: hmac, sequence: 0, app_version_hash: VALID_APP_HASH };

    const result = verifier.verifyFeedback(envelope);
    assert.equal(result.valid, false);
    assert.ok(result.reason.includes('schema'));
  });

  it('verifyFeedback rejects missing session_id', () => {
    const envelope = {
      envelope_id: 'env_fb_6',
      type: 'USER_FEEDBACK',
      feedback: { signal: 'accepted', timestamp: Date.now() / 1000 },
      attestation: { session_hmac: 'a'.repeat(64), sequence: 0, app_version_hash: VALID_APP_HASH },
    };
    const result = verifier.verifyFeedback(envelope);
    assert.equal(result.valid, false);
    assert.ok(result.reason.includes('session_id'));
  });
});

function verifyClose(verifier, envelope) {
  return verifier.verifyClose(envelope);
}
