// FSL-1.1-Apache-2.0 — see LICENSE

import express from 'express';
import { SessionRegistry } from './session-registry.js';
import { EnvelopeVerifier } from './verifier.js';
import { EnvelopeStorage } from './storage.js';
import { TrajectoryStitcher } from './stitcher.js';
import { TrajectoryScorer } from './scoring.js';
import { ContributorLedger } from './ledger.js';
import { EnrichmentPipeline } from './enrichment.js';
import { CentralStats } from './stats.js';
import { createSessionRoutes } from './routes/sessions.js';
import { createIngestRoutes } from './routes/ingest.js';
import { createStatsRoutes } from './routes/stats.js';
import { MODEL_TIERS, QUALITY_MULTIPLIERS } from '../shared/constants.js';

const PORT = parseInt(process.env.GROOVE_CENTRAL_PORT, 10) || 8443;

const sessionRegistry = new SessionRegistry();
const storage = new EnvelopeStorage();
const ledger = new ContributorLedger();
const verifier = new EnvelopeVerifier(sessionRegistry);
const stitcher = new TrajectoryStitcher(storage);
const scorer = new TrajectoryScorer({ MODEL_TIERS, QUALITY_MULTIPLIERS });
const enrichment = new EnrichmentPipeline();
const centralStats = new CentralStats(storage, ledger, sessionRegistry);

const app = express();

app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (_req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: '5mb' }));

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
  });
  next();
});

app.get('/health', (_req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

app.use(createSessionRoutes(sessionRegistry));
app.use(createIngestRoutes(verifier, storage, stitcher, scorer, enrichment, ledger));
app.use(createStatsRoutes(centralStats));

const server = app.listen(PORT, () => {
  console.log(`[central-command] listening on port ${PORT}`);
});

function shutdown() {
  console.log('[central-command] shutting down...');
  server.close(() => {
    sessionRegistry.close();
    ledger.close();
    console.log('[central-command] shut down complete');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

export { app, server };
