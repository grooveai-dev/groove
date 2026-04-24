// FSL-1.1-Apache-2.0 — see LICENSE

import { platform, arch, cpus, totalmem } from 'node:os';
import { createHash } from 'node:crypto';
import { generateECDHKeypair, deriveSharedSecret, signEnvelope, computeAppHash } from '../shared/crypto.js';

export class SessionAttestation {
  constructor(centralCommandUrl) {
    this._centralCommandUrl = centralCommandUrl;
    this._sessions = new Map();
  }

  async openSession(sessionId, metadata) {
    const keypair = generateECDHKeypair();
    let appVersionHash = '';
    try {
      appVersionHash = computeAppHash(new URL(import.meta.url).pathname);
    } catch {
      appVersionHash = 'unknown';
    }

    const body = {
      session_id: sessionId,
      public_key: keypair.publicKey,
      app_version_hash: appVersionHash,
      provider: metadata.provider,
      model: metadata.model_engine,
      machine_fingerprint: SessionAttestation.getMachineFingerprint(),
      groove_version: metadata.groove_version,
    };

    try {
      const res = await fetch(`${this._centralCommandUrl}/v1/sessions/open`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        this._sessions.set(sessionId, { keypair, sharedSecret: null, sequence: 0, appVersionHash, offline: true });
        return false;
      }

      const data = await res.json();
      const sharedSecret = deriveSharedSecret(keypair.privateKey, data.server_public_key);
      this._sessions.set(sessionId, { keypair, sharedSecret, sequence: 0, appVersionHash, offline: false });
      return true;
    } catch {
      this._sessions.set(sessionId, { keypair, sharedSecret: null, sequence: 0, appVersionHash, offline: true });
      return false;
    }
  }

  signEnvelope(sessionId, envelope) {
    const session = this._sessions.get(sessionId);
    if (!session) return envelope;

    if (session.offline || !session.sharedSecret) {
      envelope.attestation = {
        session_hmac: '',
        sequence: session.sequence++,
        app_version_hash: session.appVersionHash,
      };
      return envelope;
    }

    const envelopeForHmac = { ...envelope };
    delete envelopeForHmac.attestation;
    const envelopeBytes = JSON.stringify(envelopeForHmac);
    const hmac = signEnvelope(session.sharedSecret, envelopeBytes, session.sequence);
    envelope.attestation = {
      session_hmac: hmac,
      sequence: session.sequence++,
      app_version_hash: session.appVersionHash,
    };
    return envelope;
  }

  async closeSession(sessionId) {
    const session = this._sessions.get(sessionId);
    if (!session || session.offline) {
      this._sessions.delete(sessionId);
      return;
    }

    try {
      await fetch(`${this._centralCommandUrl}/v1/sessions/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      // fail silent
    }

    this._sessions.delete(sessionId);
  }

  static getMachineFingerprint() {
    const raw = `${platform()}|${arch()}|${cpus()[0]?.model || ''}|${totalmem()}`;
    return createHash('sha256').update(raw).digest('hex');
  }
}
