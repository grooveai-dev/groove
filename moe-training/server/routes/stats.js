// FSL-1.1-Apache-2.0 — see LICENSE

import { Router } from 'express';

export function createStatsRoutes(centralStats) {
  const router = Router();

  router.get('/v1/stats/summary', (_req, res) => {
    res.json(centralStats.summary());
  });

  router.get('/v1/stats/daily', (req, res) => {
    const days = parseInt(req.query.days, 10) || 7;
    res.json(centralStats.dailyGrowth(days));
  });

  router.get('/v1/stats/models', (_req, res) => {
    res.json(centralStats.modelBreakdown());
  });

  router.get('/v1/stats/providers', (_req, res) => {
    res.json(centralStats.providerBreakdown());
  });

  router.get('/v1/stats/leaderboard', (req, res) => {
    const limit = parseInt(req.query.limit, 10) || 10;
    res.json(centralStats.topContributors(limit));
  });

  return router;
}
