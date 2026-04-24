// FSL-1.1-Apache-2.0 — see LICENSE

import { mkdirSync, appendFileSync, readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export class EnvelopeStorage {
  constructor(basePath = './data/envelopes') {
    this.basePath = basePath;
    if (!existsSync(basePath)) mkdirSync(basePath, { recursive: true, mode: 0o700 });
  }

  store(envelope) {
    const date = new Date().toISOString().slice(0, 10);
    const filePath = join(this.basePath, `${date}.jsonl`);

    if (!existsSync(this.basePath)) {
      mkdirSync(this.basePath, { recursive: true, mode: 0o700 });
    }

    const line = JSON.stringify(envelope) + '\n';
    appendFileSync(filePath, line, { mode: 0o600 });
  }

  getSessionEnvelopes(sessionId) {
    const envelopes = [];
    const files = this._listFiles();

    for (const file of files) {
      const lines = readFileSync(file, 'utf-8').split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const env = JSON.parse(line);
          if (env.session_id === sessionId) envelopes.push(env);
        } catch { /* skip malformed lines */ }
      }
    }

    return envelopes.sort((a, b) => (a.chunk_sequence ?? 0) - (b.chunk_sequence ?? 0));
  }

  getDateRange(startDate, endDate) {
    const envelopes = [];
    const files = this._listFiles();

    for (const file of files) {
      const fileName = file.split('/').pop().replace('.jsonl', '');
      if (fileName < startDate || fileName > endDate) continue;

      const lines = readFileSync(file, 'utf-8').split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          envelopes.push(JSON.parse(line));
        } catch { /* skip */ }
      }
    }

    return envelopes;
  }

  getDailyStats(days = 7) {
    const stats = [];
    const files = this._listFiles();

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    for (const file of files) {
      const date = file.split('/').pop().replace('.jsonl', '');
      if (date < cutoffStr) continue;

      const lines = readFileSync(file, 'utf-8').split('\n').filter(Boolean);
      let stepCount = 0;
      for (const line of lines) {
        try {
          const env = JSON.parse(line);
          stepCount += env.trajectory_log?.length ?? 0;
        } catch { /* skip */ }
      }

      stats.push({ date, envelopeCount: lines.length, stepCount });
    }

    return stats.sort((a, b) => a.date.localeCompare(b.date));
  }

  getTotalStats() {
    const files = this._listFiles();
    let totalEnvelopes = 0;
    let totalSteps = 0;
    let storageSizeBytes = 0;
    const contributors = new Set();
    const sessions = new Set();

    for (const file of files) {
      const stat = statSync(file);
      storageSizeBytes += stat.size;

      const lines = readFileSync(file, 'utf-8').split('\n').filter(Boolean);
      totalEnvelopes += lines.length;

      for (const line of lines) {
        try {
          const env = JSON.parse(line);
          totalSteps += env.trajectory_log?.length ?? 0;
          if (env.contributor_id) contributors.add(env.contributor_id);
          if (env.session_id) sessions.add(env.session_id);
        } catch { /* skip */ }
      }
    }

    return {
      totalEnvelopes,
      totalSteps,
      storageSizeMb: +(storageSizeBytes / 1_048_576).toFixed(2),
      uniqueContributors: contributors.size,
      uniqueSessions: sessions.size,
    };
  }

  _listFiles() {
    if (!existsSync(this.basePath)) return [];
    return readdirSync(this.basePath)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => join(this.basePath, f))
      .sort();
  }
}
