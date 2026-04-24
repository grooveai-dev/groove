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
        status TEXT DEFAULT 'active',
        created_at TEXT NOT NULL,
        closed_at TEXT
      )
    `);
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
        groove_version, expected_sequence, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'active', ?)
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

  incrementSequence(sessionId) {
    const result = this.db.prepare(`
      UPDATE sessions SET expected_sequence = expected_sequence + 1
      WHERE session_id = ? RETURNING expected_sequence
    `).get(sessionId);
    return result ? result.expected_sequence : null;
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
