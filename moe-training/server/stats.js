// FSL-1.1-Apache-2.0 — see LICENSE

import { readFileSync, statSync } from 'node:fs';

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
const MAX_LINES_PER_FILE = 100_000;

export class CentralStats {
  constructor(storage, ledger, sessionRegistry) {
    this.storage = storage;
    this.ledger = ledger;
    this.sessionRegistry = sessionRegistry;
  }

  summary() {
    const storageStats = this.storage.getTotalStats();
    const activeSessions = this.sessionRegistry.getActiveSessions().length;
    const totalPointsAwarded = this.ledger.getTotalPointsAwarded();

    return {
      totalEnvelopes: storageStats.totalEnvelopes,
      totalSteps: storageStats.totalSteps,
      totalSessions: storageStats.uniqueSessions,
      activeSessions,
      uniqueContributors: storageStats.uniqueContributors,
      storageSizeMb: storageStats.storageSizeMb,
      totalPointsAwarded,
    };
  }

  dailyGrowth(days = 7) {
    days = Math.max(1, Math.min(365, Number(days) || 7));
    const storageDaily = this.storage.getDailyStats(days);
    const creditDaily = this.ledger.getDailyCredits(days);

    const creditMap = {};
    for (const c of creditDaily) {
      creditMap[c.date] = { points: c.totalPoints, sessions: c.totalSessions };
    }

    return storageDaily.map(d => ({
      date: d.date,
      envelopes: d.envelopeCount,
      steps: d.stepCount,
      sessions: creditMap[d.date]?.sessions || 0,
      points: creditMap[d.date]?.points || 0,
    }));
  }

  modelBreakdown() {
    const files = this.storage._listFiles();
    const models = {};

    for (const file of files) {
      try {
        const stat = statSync(file);
        if (stat.size > MAX_FILE_SIZE) continue;
      } catch { continue; }

      try {
        const lines = readFileSync(file, 'utf-8').split('\n').filter(Boolean);
        const capped = lines.slice(0, MAX_LINES_PER_FILE);
        for (const line of capped) {
          try {
            const env = JSON.parse(line);
            const model = env.metadata?.model_engine || 'unknown';
            if (!models[model]) models[model] = { sessions: new Set(), steps: 0, points: 0 };
            models[model].sessions.add(env.session_id);
            models[model].steps += env.trajectory_log?.length || 0;
          } catch { /* skip */ }
        }
      } catch { /* skip file */ }
    }

    const total = Object.values(models).reduce((sum, m) => sum + m.steps, 0) || 1;
    const result = {};
    for (const [model, data] of Object.entries(models)) {
      result[model] = {
        sessions: data.sessions.size,
        steps: data.steps,
        points: data.points,
        percentage: +((data.steps / total) * 100).toFixed(1),
      };
    }
    return result;
  }

  providerBreakdown() {
    const files = this.storage._listFiles();
    const providers = {};

    for (const file of files) {
      try {
        const stat = statSync(file);
        if (stat.size > MAX_FILE_SIZE) continue;
      } catch { continue; }

      try {
        const lines = readFileSync(file, 'utf-8').split('\n').filter(Boolean);
        const capped = lines.slice(0, MAX_LINES_PER_FILE);
        for (const line of capped) {
          try {
            const env = JSON.parse(line);
            const provider = env.metadata?.provider || 'unknown';
            if (!providers[provider]) providers[provider] = { sessions: new Set(), steps: 0, points: 0 };
            providers[provider].sessions.add(env.session_id);
            providers[provider].steps += env.trajectory_log?.length || 0;
          } catch { /* skip */ }
        }
      } catch { /* skip file */ }
    }

    const result = {};
    for (const [provider, data] of Object.entries(providers)) {
      result[provider] = { sessions: data.sessions.size, steps: data.steps, points: data.points };
    }
    return result;
  }

  topContributors(limit = 10) {
    limit = Math.max(1, Math.min(1000, Number(limit) || 10));
    const leaders = this.ledger.getLeaderboard(limit);
    return leaders.map(l => ({
      contributor_id: l.contributor_id.slice(0, 8) + '...',
      total_points: l.total_points,
      total_sessions: l.total_sessions,
    }));
  }
}
