// FSL-1.1-Apache-2.0 — see LICENSE

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateECDHKeypair, deriveSharedSecret, signEnvelope, verifyEnvelope } from '../../shared/crypto.js';
import { SessionRegistry } from '../../server/session-registry.js';
import { EnvelopeVerifier } from '../../server/verifier.js';
import { SessionAttestation } from '../../client/session-attestation.js';
import { EnvelopeBuilder } from '../../client/envelope-builder.js';

describe('ECDH Handshake End-to-End', () => {
  let tmpDir, registry, verifier;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'handshake-test-'));
    registry = new SessionRegistry(join(tmpDir, 'sessions.db'));
    verifier = new EnvelopeVerifier(registry);
  });

  afterEach(() => {
    registry.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('client and server derive the same shared secret', () => {
    const clientKeypair = generateECDHKeypair();
    const result = registry.openSession(
      'sess_hs_001', clientKeypair.publicKey, 'claude-code', 'claude-opus-4-6',
      'fp_test', 'hash_test', '0.27.77'
    );

    const serverSession = registry.getSession('sess_hs_001');
    const clientSecret = deriveSharedSecret(clientKeypair.privateKey, result.serverPublicKey);
    assert.equal(clientSecret, serverSession.shared_secret);
  });

  it('client-signed envelope passes server verification', () => {
    const clientKeypair = generateECDHKeypair();
    const result = registry.openSession(
      'sess_hs_002', clientKeypair.publicKey, 'claude-code', 'claude-opus-4-6',
      'fp_test', 'hash_test', '0.27.77'
    );

    const serverSession = registry.getSession('sess_hs_002');
    const sharedSecret = deriveSharedSecret(clientKeypair.privateKey, result.serverPublicKey);
    assert.equal(sharedSecret, serverSession.shared_secret);

    const envelope = {
      envelope_id: 'env_hs_001',
      session_id: 'sess_hs_002',
      chunk_sequence: 0,
      contributor_id: 'contrib_test',
      metadata: {
        model_engine: 'claude-opus-4-6',
        provider: 'claude-code',
        agent_role: 'frontend',
        agent_id: 'frontend-1',
      },
      trajectory_log: [
        { step: 1, type: 'thought', timestamp: Date.now() / 1000, content: 'planning', token_count: 10 },
      ],
      attestation: { session_hmac: '', sequence: 0, app_version_hash: '' },
    };

    const envelopeForHmac = { ...envelope };
    delete envelopeForHmac.attestation;
    const envelopeBytes = JSON.stringify(envelopeForHmac);
    const hmac = signEnvelope(sharedSecret, envelopeBytes, 0);
    envelope.attestation = { session_hmac: hmac, sequence: 0, app_version_hash: 'hash_test' };

    const verifyResult = verifier.verify(envelope);
    assert.equal(verifyResult.valid, true);
  });

  it('tampered envelope is rejected by server', () => {
    const clientKeypair = generateECDHKeypair();
    const result = registry.openSession(
      'sess_hs_003', clientKeypair.publicKey, 'claude-code', 'claude-opus-4-6',
      'fp_test', 'hash_test', '0.27.77'
    );

    const sharedSecret = deriveSharedSecret(clientKeypair.privateKey, result.serverPublicKey);

    const envelope = {
      envelope_id: 'env_hs_002',
      session_id: 'sess_hs_003',
      chunk_sequence: 0,
      contributor_id: 'contrib_test',
      metadata: {
        model_engine: 'claude-opus-4-6',
        provider: 'claude-code',
        agent_role: 'frontend',
        agent_id: 'frontend-1',
      },
      trajectory_log: [
        { step: 1, type: 'thought', timestamp: Date.now() / 1000, content: 'original', token_count: 10 },
      ],
      attestation: { session_hmac: '', sequence: 0, app_version_hash: '' },
    };

    const envelopeForHmac = { ...envelope };
    delete envelopeForHmac.attestation;
    const envelopeBytes = JSON.stringify(envelopeForHmac);
    const hmac = signEnvelope(sharedSecret, envelopeBytes, 0);
    envelope.attestation = { session_hmac: hmac, sequence: 0, app_version_hash: 'hash_test' };

    envelope.trajectory_log.push({ step: 2, type: 'action', timestamp: Date.now() / 1000, content: 'injected' });

    const verifyResult = verifier.verify(envelope);
    assert.equal(verifyResult.valid, false);
    assert.ok(verifyResult.reason.includes('HMAC'));
  });

  it('sequence numbers enforce ordering', () => {
    const clientKeypair = generateECDHKeypair();
    const result = registry.openSession(
      'sess_hs_004', clientKeypair.publicKey, 'claude-code', 'claude-opus-4-6',
      'fp_test', 'hash_test', '0.27.77'
    );
    const sharedSecret = deriveSharedSecret(clientKeypair.privateKey, result.serverPublicKey);

    function makeEnv(seq) {
      const env = {
        envelope_id: `env_hs_seq_${seq}`,
        session_id: 'sess_hs_004',
        chunk_sequence: seq,
        contributor_id: 'contrib_test',
        metadata: { model_engine: 'claude-opus-4-6', provider: 'claude-code', agent_role: 'frontend', agent_id: 'frontend-1' },
        trajectory_log: [{ step: seq + 1, type: 'thought', timestamp: Date.now() / 1000, content: `step ${seq}`, token_count: 5 }],
      };
      const bytes = JSON.stringify(env);
      const hmac = signEnvelope(sharedSecret, bytes, seq);
      env.attestation = { session_hmac: hmac, sequence: seq, app_version_hash: 'hash_test' };
      return env;
    }

    const r0 = verifier.verify(makeEnv(0));
    assert.equal(r0.valid, true);

    const r1 = verifier.verify(makeEnv(1));
    assert.equal(r1.valid, true);

    const rSkip = verifier.verify(makeEnv(5));
    assert.equal(rSkip.valid, false);
    assert.ok(rSkip.reason.includes('sequence'));

    const r2 = verifier.verify(makeEnv(2));
    assert.equal(r2.valid, true);
  });

  it('different client keypairs produce different shared secrets', () => {
    const client1 = generateECDHKeypair();
    const client2 = generateECDHKeypair();

    registry.openSession('sess_hs_005a', client1.publicKey, 'claude-code', 'claude-opus-4-6', 'fp1', 'h1', '0.27.77');
    registry.openSession('sess_hs_005b', client2.publicKey, 'claude-code', 'claude-opus-4-6', 'fp2', 'h2', '0.27.77');

    const s1 = registry.getSession('sess_hs_005a');
    const s2 = registry.getSession('sess_hs_005b');

    assert.notEqual(s1.shared_secret, s2.shared_secret);
  });

  it('EnvelopeBuilder output is verifiable after client signing', () => {
    const clientKeypair = generateECDHKeypair();
    const result = registry.openSession(
      'sess_hs_006', clientKeypair.publicKey, 'claude-code', 'claude-opus-4-6',
      'fp_test', 'hash_test', '0.27.77'
    );
    const sharedSecret = deriveSharedSecret(clientKeypair.privateKey, result.serverPublicKey);

    const builder = new EnvelopeBuilder('sess_hs_006', 'contrib_test', {
      model_engine: 'claude-opus-4-6',
      provider: 'claude-code',
      agent_role: 'frontend',
      agent_id: 'frontend-1',
      task_complexity: 'medium',
      team_size: 1,
      session_quality: 80,
      groove_version: '0.27.77',
    });

    builder.addStep({ step: 1, type: 'thought', timestamp: Date.now() / 1000, content: 'test', token_count: 5 });
    const envelope = builder.flush();
    assert.ok(envelope);

    const envelopeForHmac = { ...envelope };
    delete envelopeForHmac.attestation;
    const envelopeBytes = JSON.stringify(envelopeForHmac);
    const hmac = signEnvelope(sharedSecret, envelopeBytes, 0);
    envelope.attestation = { session_hmac: hmac, sequence: 0, app_version_hash: 'hash_test' };

    const verifyResult = verifier.verify(envelope);
    assert.equal(verifyResult.valid, true);
  });

  it('SESSION_CLOSE from builder is verifiable', () => {
    const clientKeypair = generateECDHKeypair();
    const result = registry.openSession(
      'sess_hs_007', clientKeypair.publicKey, 'claude-code', 'claude-opus-4-6',
      'fp_test', 'hash_test', '0.27.77'
    );
    const sharedSecret = deriveSharedSecret(clientKeypair.privateKey, result.serverPublicKey);

    const builder = new EnvelopeBuilder('sess_hs_007', 'contrib_test', {
      model_engine: 'claude-opus-4-6',
      provider: 'claude-code',
      agent_role: 'frontend',
      agent_id: 'frontend-1',
    });

    const closeEnvelope = builder.buildSessionClose({
      status: 'SUCCESS',
      user_interventions: 0,
      total_steps: 10,
      total_chunks: 1,
      total_tokens: 500,
      duration_seconds: 60,
      files_modified: 2,
      errors_encountered: 0,
      errors_recovered: 0,
      coordination_events: 0,
    });

    const forHmac = { ...closeEnvelope };
    delete forHmac.attestation;
    const bytes = JSON.stringify(forHmac);
    const hmac = signEnvelope(sharedSecret, bytes, 0);
    closeEnvelope.attestation = { session_hmac: hmac, sequence: 0, app_version_hash: 'hash_test' };

    const verifyResult = verifier.verifyClose(closeEnvelope);
    assert.equal(verifyResult.valid, true);

    const session = registry.getSession('sess_hs_007');
    assert.equal(session.status, 'closed');
  });

  it('HMAC verification is constant-time (no short-circuit)', () => {
    const clientKeypair = generateECDHKeypair();
    registry.openSession(
      'sess_hs_008', clientKeypair.publicKey, 'claude-code', 'claude-opus-4-6',
      'fp_test', 'hash_test', '0.27.77'
    );
    const session = registry.getSession('sess_hs_008');
    const sharedSecret = session.shared_secret;

    const payload = JSON.stringify({ test: 'data' });
    const validHmac = signEnvelope(sharedSecret, payload, 0);

    const wrongFirstChar = String.fromCharCode(validHmac.charCodeAt(0) ^ 1) + validHmac.slice(1);
    const wrongLastChar = validHmac.slice(0, -1) + String.fromCharCode(validHmac.charCodeAt(validHmac.length - 1) ^ 1);

    assert.equal(verifyEnvelope(sharedSecret, payload, 0, wrongFirstChar), false);
    assert.equal(verifyEnvelope(sharedSecret, payload, 0, wrongLastChar), false);
    assert.equal(verifyEnvelope(sharedSecret, payload, 0, validHmac), true);
  });
});
