#!/usr/bin/env node
// FSL-1.1-Apache-2.0 — see LICENSE
//
// One-off ledger repair for ~/.groove/tokens.json (2026-07 efficiency audit).
//
// Entry c3789b6f recorded $20,536.57 from a duplicate-ingestion loop (4,631
// session records in 380s, payloads duplicated up to 10×). The ingestion bug
// is fixed in claude-code.js, but the poisoned data still dominates every cost
// dashboard: recorded all-time spend ~$24K vs ~$3.5K real. This script:
//   1. Sets the poisoned entry's totalCostUsd to its audited real value (~$325)
//   2. Truncates every entry's sessions array to the last 500 records
//      (matches SESSION_CAP in tokentracker.js; aggregates are untouched)
//   3. Writes a timestamped .bak of the original file first
//
// MUST run with the daemon STOPPED — the daemon holds the ledger in memory and
// rewrites the file, so a live edit gets clobbered. The script checks and aborts.
//
// Usage: node repair-tokens.mjs [path-to-tokens.json] [--entry c3789b6f] [--cost 325]

import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : dflt;
};
const tokensPath = args[0] && !args[0].startsWith('--')
  ? resolve(args[0])
  : resolve(homedir(), '.groove', 'tokens.json');
const entryId = flag('entry', 'c3789b6f');
const correctedCost = Number(flag('cost', '325'));
const SESSION_CAP = 500;

// Refuse to edit under a live daemon
try {
  const res = await fetch('http://127.0.0.1:31415/api/health', { signal: AbortSignal.timeout(1500) });
  if (res.ok) {
    console.error('ABORT: GROOVE daemon is running on :31415. Stop it first (groove stop) — it rewrites tokens.json and will clobber this repair.');
    process.exit(1);
  }
} catch { /* no daemon — safe to proceed */ }

if (!existsSync(tokensPath)) {
  console.error(`ABORT: ${tokensPath} not found. Pass the path explicitly: node repair-tokens.mjs /path/to/tokens.json`);
  process.exit(1);
}

const backupPath = `${tokensPath}.${new Date().toISOString().replace(/[:.]/g, '-')}.bak`;
copyFileSync(tokensPath, backupPath);
console.log(`Backup written: ${backupPath}`);

const data = JSON.parse(readFileSync(tokensPath, 'utf8'));
const usage = data.usage || data;

const target = usage[entryId];
if (target) {
  const before = target.totalCostUsd;
  target.totalCostUsd = correctedCost;
  target.note = `totalCostUsd corrected ${before} -> ${correctedCost} on ${new Date().toISOString().slice(0, 10)} (duplicate-ingestion inflation, see 2026-07 efficiency audit)`;
  console.log(`Entry ${entryId}: totalCostUsd ${before} -> ${correctedCost}`);
} else {
  console.warn(`Entry ${entryId} not found — skipping cost correction.`);
}

let trimmed = 0;
for (const entry of Object.values(usage)) {
  if (Array.isArray(entry?.sessions) && entry.sessions.length > SESSION_CAP) {
    trimmed += entry.sessions.length - SESSION_CAP;
    entry.sessions.splice(0, entry.sessions.length - SESSION_CAP);
  }
}
console.log(`Trimmed ${trimmed} session records across all entries (cap ${SESSION_CAP}).`);

writeFileSync(tokensPath, JSON.stringify(data, null, 2));
const sizeMb = (Buffer.byteLength(JSON.stringify(data)) / 1024 / 1024).toFixed(1);
console.log(`Repaired ledger written: ${tokensPath} (${sizeMb}MB)`);
