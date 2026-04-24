// FSL-1.1-Apache-2.0 — see LICENSE

import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { generateECDHKeypair, deriveSharedSecret } from '../shared/crypto.js';

export class SessionRegistry {
  constructor(dbPath = './data/sessions.db') {
    const dir = join(dbPath, '..');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this._createTables();
  }

  _createTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        server_private_key TEXT NOT NULL,
        server_public_key TEXT NOT NULL,
        shared_secret TEXT NOT NULL,
        client_public_key TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        machine_fingerprint TEXT NOT NULL,
        app_version_hash TEXT NOT NULL,
        groove_version TEXT NOT NULL,
        expected_sequence INTEGER DEFAULT 0,
        envelope_count INTEGER DEFAULT 0,
        status TEXT DEFAULT 'active',
        created_at TEXT NOT NULL,
        closed_at TEXT
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS processed_envelopes (
        envelope_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        processed_at TEXT NOT NULL
      )
    `);

    // Migration: add envelope_count if table exists but column doesn't
    try {
      this.db.prepare('SELECT envelope_count FROM sessions LIMIT 1').get();
    } catch {
      try { this.db.exec('ALTER TABLE sessions ADD COLUMN envelope_count INTEGER DEFAULT 0'); } catch { /* already exists */ }
    }
  }

  openSession(sessionId, clientPublicKey, provider, model, machineFingerprint, appVersionHash, grooveVersion) {
    if (this.rateLimitCheck(machineFingerprint)) {
      return { rateLimited: true };
    }

    const keypair = generateECDHKeypair();
    const sharedSecret = deriveSharedSecret(keypair.privateKey, clientPublicKey);

    this.db.prepare(`
      INSERT INTO sessions (session_id, server_private_key, server_public_key, shared_secret,
        client_public_key, provider, model, machine_fingerprint, app_version_hash,
        groove_version, expected_sequence, envelope_count, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 'active', ?)
    `).run(
      sessionId, keypair.privateKey, keypair.publicKey, sharedSecret,
      clientPublicKey, provider, model, machineFingerprint, appVersionHash,
      grooveVersion, new Date().toISOString()
    );

    return { serverPublicKey: keypair.publicKey };
  }

  getSession(sessionId) {
    return this.db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(sessionId) || null;
  }

  checkAndIncrementSequence(sessionId, expectedSequence) {
    const txn = this.db.transaction(() => {
      const row = this.db.prepare(
        "SELECT expected_sequence FROM sessions WHERE session_id = ? AND status = 'active'"
      ).get(sessionId);

      if (!row) {
        return { valid: false, reason: 'session not found or not active' };
      }

      if (row.expected_sequence !== expectedSequence) {
        return { valid: false, reason: `sequence mismatch: expected ${row.expected_sequence}, got ${expectedSequence}` };
      }

      this.db.prepare(
        'UPDATE sessions SET expected_sequence = expected_sequence + 1 WHERE session_id = ?'
      ).run(sessionId);

      return { valid: true };
    });

    return txn.immediate();
  }

  incrementSequence(sessionId) {
    const result = this.db.prepare(`
      UPDATE sessions SET expected_sequence = expected_sequence + 1
      WHERE session_id = ? RETURNING expected_sequence
    `).get(sessionId);
    return result ? result.expected_sequence : null;
  }

  checkEnvelopeCount(sessionId, max = 200) {
    const row = this.db.prepare('SELECT envelope_count FROM sessions WHERE session_id = ?').get(sessionId);
    if (!row) return false;
    return row.envelope_count < max;
  }

  incrementEnvelopeCount(sessionId) {
    this.db.prepare('UPDATE sessions SET envelope_count = envelope_count + 1 WHERE session_id = ?').run(sessionId);
  }

  isEnvelopeProcessed(envelopeId) {
    const row = this.db.prepare('SELECT 1 FROM processed_envelopes WHERE envelope_id = ?').get(envelopeId);
    return !!row;
  }

  recordProcessedEnvelope(envelopeId, sessionId) {
    this.db.prepare(
      'INSERT OR IGNORE INTO processed_envelopes (envelope_id, session_id, processed_at) VALUES (?, ?, ?)'
    ).run(envelopeId, sessionId, new Date().toISOString());
  }

  closeSession(sessionId) {
    this.db.prepare(`
      UPDATE sessions SET status = 'closed', closed_at = ? WHERE session_id = ?
    `).run(new Date().toISOString(), sessionId);
  }

  getActiveSessions() {
    return this.db.prepare("SELECT * FROM sessions WHERE status = 'active'").all();
  }

  rateLimitCheck(machineFingerprint) {
    const oneHourAgo = new Date(Date.now() - 3600_000).toISOString();
    const row = this.db.prepare(`
      SELECT COUNT(*) as cnt FROM sessions
      WHERE machine_fingerprint = ? AND created_at > ?
    `).get(machineFingerprint, oneHourAgo);
    return row.cnt >= 20;
  }

  close() {
    this.db.close();
  }
}
