// FSL-1.1-Apache-2.0 — see LICENSE

import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { CURRENT_CONSENT_VERSION } from '../shared/constants.js';

export class ConsentManager {
  constructor(dbPath) {
    this._dbPath = dbPath || join(homedir(), '.groove', 'consent.db');
    const dir = this._dbPath.replace(/[/\\][^/\\]+$/, '');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this._db = new Database(this._dbPath);
    this._db.pragma('journal_mode = WAL');
    this._db.exec(`
      CREATE TABLE IF NOT EXISTS consent_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        opted_in INTEGER NOT NULL,
        consent_version TEXT NOT NULL,
        metadata TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
  }

  recordConsent(userId, optedIn, consentVersion, metadata) {
    this._db.prepare(
      'INSERT INTO consent_history (user_id, opted_in, consent_version, metadata) VALUES (?, ?, ?, ?)'
    ).run(userId, optedIn ? 1 : 0, consentVersion, metadata ? JSON.stringify(metadata) : null);
  }

  isOptedIn(userId) {
    const row = this._db.prepare(
      'SELECT opted_in, consent_version FROM consent_history WHERE user_id = ? ORDER BY id DESC LIMIT 1'
    ).get(userId);
    if (!row) return false;
    if (row.consent_version !== CURRENT_CONSENT_VERSION) return false;
    return row.opted_in === 1;
  }

  revokeConsent(userId) {
    this.recordConsent(userId, false, CURRENT_CONSENT_VERSION);
  }

  getOptedInCount() {
    const row = this._db.prepare(`
      SELECT COUNT(DISTINCT user_id) as cnt FROM consent_history ch1
      WHERE opted_in = 1
        AND consent_version = ?
        AND id = (SELECT MAX(id) FROM consent_history ch2 WHERE ch2.user_id = ch1.user_id)
    `).get(CURRENT_CONSENT_VERSION);
    return row?.cnt || 0;
  }

  getConsentHistory(userId) {
    const rows = this._db.prepare(
      'SELECT * FROM consent_history WHERE user_id = ? ORDER BY id ASC'
    ).all(userId);
    return rows.map((r) => ({
      ...r,
      opted_in: r.opted_in === 1,
      metadata: r.metadata ? JSON.parse(r.metadata) : null,
    }));
  }

  close() {
    this._db.close();
  }

  static getOrCreateUserId(userIdPath) {
    const filePath = userIdPath || join(homedir(), '.groove', 'user_id');
    const dir = filePath.replace(/[/\\][^/\\]+$/, '');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    if (existsSync(filePath)) {
      return readFileSync(filePath, 'utf-8').trim();
    }
    const uid = randomUUID().replace(/-/g, '');
    writeFileSync(filePath, uid, { mode: 0o600 });
    return uid;
  }

  static isCaptureEnabled(userIdPath, dbPath) {
    const filePath = userIdPath || join(homedir(), '.groove', 'user_id');
    if (!existsSync(filePath)) return false;
    const userId = readFileSync(filePath, 'utf-8').trim();
    const manager = new ConsentManager(dbPath);
    try {
      return manager.isOptedIn(userId);
    } finally {
      manager.close();
    }
  }
}
