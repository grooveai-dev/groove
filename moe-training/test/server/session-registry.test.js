// FSL-1.1-Apache-2.0 — see LICENSE

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateECDHKeypair } from '../../shared/crypto.js';
import { SessionRegistry } from '../../server/session-registry.js';

describe('SessionRegistry', () => {
  let registry;
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'sess-test-'));
    registry = new SessionRegistry(join(tmpDir, 'sessions.db'));
  });

  afterEach(() => {
    registry.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('opens a session and returns server public key', () => {
    const clientKeypair = generateECDHKeypair();
    const result = registry.openSession(
      'sess_001', clientKeypair.publicKey, 'claude-code', 'claude-opus-4-6',
      'fp_abc123', 'hash_xyz', '0.27.77'
    );
    assert.ok(result.serverPublicKey);
    assert.equal(typeof result.serverPublicKey, 'string');
    assert.ok(result.serverPublicKey.length > 10);
  });

  it('gets a session with all fields stored', () => {
    const clientKeypair = generateECDHKeypair();
    registry.openSession(
      'sess_002', clientKeypair.publicKey, 'codex', 'o3',
      'fp_def456', 'hash_abc', '0.27.77'
    );

    const session = registry.getSession('sess_002');
    assert.ok(session);
    assert.equal(session.session_id, 'sess_002');
    assert.equal(session.provider, 'codex');
    assert.equal(session.model, 'o3');
    assert.equal(session.machine_fingerprint, 'fp_def456');
    assert.equal(session.app_version_hash, 'hash_abc');
    assert.equal(session.groove_version, '0.27.77');
    assert.equal(session.status, 'active');
    assert.equal(session.expected_sequence, 0);
    assert.ok(session.server_public_key);
    assert.ok(session.server_private_key);
    assert.ok(session.shared_secret);
    assert.ok(session.created_at);
  });

  it('returns null for unknown session', () => {
    assert.equal(registry.getSession('nonexistent'), null);
  });

  it('increments sequence atomically and monotonically', () => {
    const clientKeypair = generateECDHKeypair();
    registry.openSession(
      'sess_003', clientKeypair.publicKey, 'claude-code', 'claude-opus-4-6',
      'fp_seq', 'hash_seq', '0.27.77'
    );

    const seq1 = registry.incrementSequence('sess_003');
    assert.equal(seq1, 1);

    const seq2 = registry.incrementSequence('sess_003');
    assert.equal(seq2, 2);

    const seq3 = registry.incrementSequence('sess_003');
    assert.equal(seq3, 3);

    const session = registry.getSession('sess_003');
    assert.equal(session.expected_sequence, 3);
  });

  it('closes a session with status and timestamp', () => {
    const clientKeypair = generateECDHKeypair();
    registry.openSession(
      'sess_004', clientKeypair.publicKey, 'gemini', 'gemini-2.5-pro',
      'fp_close', 'hash_close', '0.27.77'
    );

    registry.closeSession('sess_004');
    const session = registry.getSession('sess_004');
    assert.equal(session.status, 'closed');
    assert.ok(session.closed_at);
  });

  it('rate limits at 20 sessions per fingerprint per hour', () => {
    const clientKeypair = generateECDHKeypair();
    const fp = 'fp_ratelimit';

    for (let i = 0; i < 20; i++) {
      const result = registry.openSession(
        `sess_rl_${i}`, clientKeypair.publicKey, 'claude-code', 'claude-opus-4-6',
        fp, 'hash_rl', '0.27.77'
      );
      assert.ok(result.serverPublicKey, `session ${i} should succeed`);
    }

    const result = registry.openSession(
      'sess_rl_21', clientKeypair.publicKey, 'claude-code', 'claude-opus-4-6',
      fp, 'hash_rl', '0.27.77'
    );
    assert.equal(result.rateLimited, true);
  });

  it('returns active sessions', () => {
    const clientKeypair = generateECDHKeypair();
    registry.openSession('sess_a1', clientKeypair.publicKey, 'claude-code', 'claude-opus-4-6', 'fp1', 'h1', '0.27.77');
    registry.openSession('sess_a2', clientKeypair.publicKey, 'codex', 'o3', 'fp2', 'h2', '0.27.77');
    registry.closeSession('sess_a1');

    const active = registry.getActiveSessions();
    assert.equal(active.length, 1);
    assert.equal(active[0].session_id, 'sess_a2');
  });
});
