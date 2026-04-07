// GROOVE — Audit Logger
// FSL-1.1-Apache-2.0 — see LICENSE

import { appendFileSync, readFileSync, existsSync, renameSync, statSync } from 'fs';
import { resolve } from 'path';

const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5MB

export class AuditLogger {
  constructor(grooveDir) {
    this.logPath = resolve(grooveDir, 'audit.log');
  }

  /**
   * Append an audit entry.
   * @param {string} action — e.g. 'agent.spawn', 'config.set', 'team.load'
   * @param {object} detail — action-specific metadata (keep it small)
   */
  log(action, detail = {}) {
    const entry = JSON.stringify({
      t: new Date().toISOString(),
      action,
      ...detail,
    });
    try {
      // Rotate if log exceeds 5MB
      if (existsSync(this.logPath)) {
        try {
          const size = statSync(this.logPath).size;
          if (size > MAX_LOG_SIZE) {
            const rotated = this.logPath + '.1';
            renameSync(this.logPath, rotated);
          }
        } catch { /* ignore rotation errors */ }
      }
      appendFileSync(this.logPath, entry + '\n', { mode: 0o600 });
    } catch {
      // Audit must never crash the daemon
    }
  }

  /**
   * Read recent entries (newest first).
   * @param {number} limit — max entries to return
   * @returns {object[]}
   */
  recent(limit = 50) {
    if (!existsSync(this.logPath)) return [];
    try {
      const lines = readFileSync(this.logPath, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean);
      return lines
        .slice(-limit)
        .reverse()
        .map((line) => {
          try { return JSON.parse(line); } catch { return null; }
        })
        .filter(Boolean);
    } catch {
      return [];
    }
  }
}
