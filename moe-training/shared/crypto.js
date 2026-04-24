// FSL-1.1-Apache-2.0 — see LICENSE

import { createECDH, createHmac, createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

export function generateECDHKeypair() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    publicKey: ecdh.getPublicKey('base64'),
    privateKey: ecdh.getPrivateKey('base64'),
  };
}

export function deriveSharedSecret(privateKeyB64, otherPublicKeyB64) {
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(Buffer.from(privateKeyB64, 'base64'));
  const secret = ecdh.computeSecret(Buffer.from(otherPublicKeyB64, 'base64'));
  return secret.toString('base64');
}

// envelopeBytes MUST contain ALL envelope fields EXCEPT attestation (which holds the HMAC itself).
// Callers must strip attestation before JSON.stringify to produce envelopeBytes.
export function signEnvelope(sharedSecretB64, envelopeBytes, sequenceNumber) {
  const key = Buffer.from(sharedSecretB64, 'base64');
  const seqBuf = Buffer.alloc(4);
  seqBuf.writeUInt32BE(sequenceNumber);
  const payload = Buffer.concat([seqBuf, Buffer.from(envelopeBytes)]);
  return createHmac('sha256', key).update(payload).digest('hex');
}

export function verifyEnvelope(sharedSecretB64, envelopeBytes, sequenceNumber, hmac) {
  const expected = signEnvelope(sharedSecretB64, envelopeBytes, sequenceNumber);
  if (expected.length !== hmac.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ hmac.charCodeAt(i);
  }
  return diff === 0;
}

export function computeAppHash(filePath) {
  const content = readFileSync(filePath);
  return createHash('sha256').update(content).digest('hex');
}
