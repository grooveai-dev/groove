// FSL-1.1-Apache-2.0 — see LICENSE

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { SessionAttestation } from '../../client/session-attestation.js';
import { verifyEnvelope } from '../../shared/crypto.js';

describe('SessionAttestation security', () => {
  let attestation;

  beforeEach(() => {
    attestation = new SessionAttestation('http://localhost:9999');
  });

  it('HMAC signs entire envelope — tampering metadata after signing fails verification', async () => {
    const sessionId = 'sess_test_1';
    await attestation.openSession(sessionId, {
      provider: 'claude-code',
      model_engine: 'claude-opus-4-6',
      groove_version: '0.27.0',
    });

    const session = attestation._sessions.get(sessionId);
    if (session.offline) {
      return;
    }

    const envelope = {
      envelope_id: 'env_test',
      session_id: sessionId,
      chunk_sequence: 0,
      contributor_id: 'user_1',
      attestation: { session_hmac: '', sequence: 0, app_version_hash: '' },
      metadata: { agent_role: 'backend', agent_id: 'backend-1', provider: 'claude-code' },
      trajectory_log: [{ step: 1, type: 'thought', timestamp: 123 }],
    };

    const signed = attestation.signEnvelope(sessionId, envelope);
    const hmac = signed.attestation.session_hmac;
    const seq = signed.attestation.sequence - 1;

    const forVerify = { ...signed };
    delete forVerify.attestation;
    const valid = verifyEnvelope(session.sharedSecret, JSON.stringify(forVerify), seq, hmac);
    assert.equal(valid, true, 'HMAC should verify against the full envelope minus attestation');

    forVerify.metadata.agent_role = 'hacked';
    const invalid = verifyEnvelope(session.sharedSecret, JSON.stringify(forVerify), seq, hmac);
    assert.equal(invalid, false, 'Tampered metadata should fail HMAC verification');
  });

  it('offline mode uses OFFLINE marker not empty string', async () => {
    const sessionId = 'sess_offline';
    attestation._sessions.set(sessionId, {
      keypair: null,
      sharedSecret: null,
      sequence: 0,
      appVersionHash: 'test',
      offline: true,
    });

    const envelope = {
      envelope_id: 'env_off',
      session_id: sessionId,
      attestation: { session_hmac: '', sequence: 0, app_version_hash: '' },
      metadata: {},
      trajectory_log: [],
    };

    const signed = attestation.signEnvelope(sessionId, envelope);
    assert.equal(signed.attestation.session_hmac, 'OFFLINE');
    assert.notEqual(signed.attestation.session_hmac, '');
  });

  it('machine fingerprint includes hostname and core count', async () => {
    const os = await import('node:os');
    const fp = SessionAttestation.getMachineFingerprint();
    assert.equal(typeof fp, 'string');
    assert.equal(fp.length, 64);

    const signals = [
      os.platform(),
      os.arch(),
      os.cpus()[0]?.model || '',
      String(os.totalmem()),
      os.hostname(),
      String(os.cpus().length),
      os.release(),
      os.endianness(),
    ];
    const { createHash } = await import('node:crypto');
    const expected = createHash('sha256').update(signals.join('|')).digest('hex');
    assert.equal(fp, expected);
  });
});
