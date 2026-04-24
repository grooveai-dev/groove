// FSL-1.1-Apache-2.0 — see LICENSE

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  generateECDHKeypair,
  deriveSharedSecret,
  signEnvelope,
  verifyEnvelope,
  computeAppHash,
} from '../../shared/crypto.js';

describe('crypto', () => {
  it('generates ECDH keypairs with base64 encoded keys', () => {
    const kp = generateECDHKeypair();
    assert.ok(kp.publicKey);
    assert.ok(kp.privateKey);
    assert.ok(Buffer.from(kp.publicKey, 'base64').length > 0);
    assert.ok(Buffer.from(kp.privateKey, 'base64').length > 0);
  });

  it('derives the same shared secret from both sides', () => {
    const alice = generateECDHKeypair();
    const bob = generateECDHKeypair();

    const secretA = deriveSharedSecret(alice.privateKey, bob.publicKey);
    const secretB = deriveSharedSecret(bob.privateKey, alice.publicKey);

    assert.equal(secretA, secretB);
    assert.ok(Buffer.from(secretA, 'base64').length > 0);
  });

  it('HMAC sign and verify round-trip', () => {
    const alice = generateECDHKeypair();
    const bob = generateECDHKeypair();
    const secret = deriveSharedSecret(alice.privateKey, bob.publicKey);

    const payload = JSON.stringify({ data: 'test envelope content' });
    const seq = 1;
    const hmac = signEnvelope(secret, payload, seq);

    assert.ok(typeof hmac === 'string');
    assert.ok(hmac.length > 0);
    assert.ok(verifyEnvelope(secret, payload, seq, hmac));
  });

  it('verification fails with tampered payload', () => {
    const alice = generateECDHKeypair();
    const bob = generateECDHKeypair();
    const secret = deriveSharedSecret(alice.privateKey, bob.publicKey);

    const payload = JSON.stringify({ data: 'original' });
    const hmac = signEnvelope(secret, payload, 1);

    const tampered = JSON.stringify({ data: 'tampered' });
    assert.equal(verifyEnvelope(secret, tampered, 1, hmac), false);
  });

  it('verification fails with wrong sequence number', () => {
    const alice = generateECDHKeypair();
    const bob = generateECDHKeypair();
    const secret = deriveSharedSecret(alice.privateKey, bob.publicKey);

    const payload = JSON.stringify({ data: 'test' });
    const hmac = signEnvelope(secret, payload, 1);

    assert.equal(verifyEnvelope(secret, payload, 2, hmac), false);
  });

  it('computeAppHash returns SHA256 of file contents', () => {
    const dir = mkdtempSync(join(tmpdir(), 'crypto-test-'));
    const filePath = join(dir, 'test-file.txt');
    writeFileSync(filePath, 'hello world');

    const hash = computeAppHash(filePath);
    assert.ok(typeof hash === 'string');
    assert.equal(hash.length, 64);

    const hash2 = computeAppHash(filePath);
    assert.equal(hash, hash2);

    rmSync(dir, { recursive: true });
  });
});
