// FSL-1.1-Apache-2.0 — see LICENSE

import { verifyEnvelope } from '../shared/crypto.js';

let validateEnvelope;
try {
  const schema = await import('../shared/envelope-schema.js');
  validateEnvelope = schema.validateEnvelope;
} catch {
  validateEnvelope = () => ({ valid: true });
}

export class EnvelopeVerifier {
  constructor(sessionRegistry) {
    this.sessionRegistry = sessionRegistry;
  }

  verify(envelope) {
    const sessionId = envelope.session_id;
    if (!sessionId) return { valid: false, reason: 'missing session_id' };

    const session = this.sessionRegistry.getSession(sessionId);
    if (!session) return { valid: false, reason: 'unknown session_id' };
    if (session.status !== 'active') return { valid: false, reason: 'session is closed' };

    const attestation = envelope.attestation;
    if (!attestation) return { valid: false, reason: 'missing attestation' };

    const envelopeForHmac = { ...envelope };
    delete envelopeForHmac.attestation;
    const envelopeBytes = JSON.stringify(envelopeForHmac);

    const hmacValid = verifyEnvelope(
      session.shared_secret,
      envelopeBytes,
      attestation.sequence,
      attestation.session_hmac
    );
    if (!hmacValid) return { valid: false, reason: 'HMAC verification failed' };

    if (attestation.sequence !== session.expected_sequence) {
      return { valid: false, reason: `sequence mismatch: expected ${session.expected_sequence}, got ${attestation.sequence}` };
    }

    const schemaResult = validateEnvelope(envelope);
    if (!schemaResult.valid) {
      return { valid: false, reason: `schema validation failed: ${schemaResult.reason || schemaResult.errors?.join(', ')}` };
    }

    this.sessionRegistry.incrementSequence(sessionId);

    return { valid: true };
  }

  verifyClose(envelope) {
    const sessionId = envelope.session_id;
    if (!sessionId) return { valid: false, reason: 'missing session_id' };

    const session = this.sessionRegistry.getSession(sessionId);
    if (!session) return { valid: false, reason: 'unknown session_id' };
    if (session.status !== 'active') return { valid: false, reason: 'session already closed' };

    const attestation = envelope.attestation;
    if (!attestation) return { valid: false, reason: 'missing attestation' };

    const envelopeForHmac = { ...envelope };
    delete envelopeForHmac.attestation;
    const envelopeBytes = JSON.stringify(envelopeForHmac);

    const hmacValid = verifyEnvelope(
      session.shared_secret,
      envelopeBytes,
      attestation.sequence,
      attestation.session_hmac
    );
    if (!hmacValid) return { valid: false, reason: 'HMAC verification failed' };

    this.sessionRegistry.closeSession(sessionId);
    return { valid: true };
  }
}
