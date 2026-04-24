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

// Per-IP rate limiting
const ipWindows = new Map();
const RATE_LIMIT_PER_MINUTE = 100;
const RATE_LIMIT_PER_HOUR = 1000;

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of ipWindows) {
    if (now - entry.minuteStart > 120_000 && now - entry.hourStart > 7200_000) {
      ipWindows.delete(ip);
    }
  }
}, 300_000);

app.use((req, res, next) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
  const now = Date.now();

  let entry = ipWindows.get(ip);
  if (!entry) {
    entry = { minuteCount: 0, minuteStart: now, hourCount: 0, hourStart: now };
    ipWindows.set(ip, entry);
  }

  if (now - entry.minuteStart > 60_000) {
    entry.minuteCount = 0;
    entry.minuteStart = now;
  }
  if (now - entry.hourStart > 3600_000) {
    entry.hourCount = 0;
    entry.hourStart = now;
  }

  entry.minuteCount++;
  entry.hourCount++;

  if (entry.minuteCount > RATE_LIMIT_PER_MINUTE) {
    return res.status(429).json({ error: 'Too Many Requests', retryAfter: Math.ceil((entry.minuteStart + 60_000 - now) / 1000) });
  }
  if (entry.hourCount > RATE_LIMIT_PER_HOUR) {
    return res.status(429).json({ error: 'Too Many Requests', retryAfter: Math.ceil((entry.hourStart + 3600_000 - now) / 1000) });
  }

  next();
});

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
app.use(createIngestRoutes(verifier, storage, stitcher, scorer, enrichment, ledger, sessionRegistry));
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
