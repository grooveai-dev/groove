// FSL-1.1-Apache-2.0 — see LICENSE

import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export class ContributorLedger {
  constructor(dbPath = './data/ledger.db') {
    const dir = join(dbPath, '..');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this._createTables();
  }

  _createTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS credits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        contributor_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        points REAL NOT NULL,
        base_points INTEGER NOT NULL,
        multiplier_breakdown TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS balances (
        contributor_id TEXT PRIMARY KEY,
        total_points REAL NOT NULL DEFAULT 0,
        total_sessions INTEGER NOT NULL DEFAULT 0,
        last_credit_at TEXT,
        trust_score REAL NOT NULL DEFAULT 1.0
      )
    `);
  }

  credit(contributorId, sessionId, scoreResult) {
    const now = new Date().toISOString();
    const breakdown = JSON.stringify({
      modelMultiplier: scoreResult.modelMultiplier,
      correctionBonus: scoreResult.correctionBonus,
      coordinationBonus: scoreResult.coordinationBonus,
      errorRecoveryBonus: scoreResult.errorRecoveryBonus,
      complexityBonus: scoreResult.complexityBonus,
      qualityBonus: scoreResult.qualityBonus,
    });

    const txn = this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO credits (contributor_id, session_id, points, base_points, multiplier_breakdown, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(contributorId, sessionId, scoreResult.totalPoints, scoreResult.basePoints, breakdown, now);

      const existing = this.db.prepare('SELECT * FROM balances WHERE contributor_id = ?').get(contributorId);
      if (existing) {
        this.db.prepare(`
          UPDATE balances SET total_points = total_points + ?, total_sessions = total_sessions + 1, last_credit_at = ?
          WHERE contributor_id = ?
        `).run(scoreResult.totalPoints, now, contributorId);
      } else {
        this.db.prepare(`
          INSERT INTO balances (contributor_id, total_points, total_sessions, last_credit_at, trust_score)
          VALUES (?, ?, 1, ?, 1.0)
        `).run(contributorId, scoreResult.totalPoints, now);
      }
    });
    txn();
  }

  getBalance(contributorId) {
    return this.db.prepare('SELECT * FROM balances WHERE contributor_id = ?').get(contributorId) || null;
  }

  getLeaderboard(limit = 50) {
    return this.db.prepare('SELECT * FROM balances ORDER BY total_points DESC LIMIT ?').all(limit);
  }

  getCreditsForContributor(contributorId, limit = 100) {
    return this.db.prepare(
      'SELECT * FROM credits WHERE contributor_id = ? ORDER BY created_at DESC LIMIT ?'
    ).all(contributorId, limit);
  }

  getDailyCredits(days = 7) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    return this.db.prepare(`
      SELECT DATE(created_at) as date, SUM(points) as totalPoints, COUNT(*) as totalSessions
      FROM credits WHERE created_at > ? GROUP BY DATE(created_at) ORDER BY date
    `).all(cutoff.toISOString());
  }

  adjustTrustScore(contributorId, delta) {
    this.db.prepare(`
      UPDATE balances SET trust_score = MAX(0, MIN(10, trust_score + ?)) WHERE contributor_id = ?
    `).run(delta, contributorId);
  }

  getTotalPointsAwarded() {
    const row = this.db.prepare('SELECT COALESCE(SUM(total_points), 0) as total FROM balances').get();
    return row.total;
  }

  close() {
    this.db.close();
  }
}
