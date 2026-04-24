// FSL-1.1-Apache-2.0 — see LICENSE

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ContributorLedger } from '../../server/ledger.js';

describe('ContributorLedger', () => {
  let ledger;
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ledger-test-'));
    ledger = new ContributorLedger(join(tmpDir, 'ledger.db'));
  });

  afterEach(() => {
    ledger.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('credits a contributor and updates balance', () => {
    ledger.credit('contrib_001', 'sess_001', {
      basePoints: 10,
      totalPoints: 50,
      modelMultiplier: 5,
      correctionBonus: 0,
      coordinationBonus: 0,
      errorRecoveryBonus: 0,
      complexityBonus: 0,
      qualityBonus: 0,
    });

    const balance = ledger.getBalance('contrib_001');
    assert.ok(balance);
    assert.equal(balance.total_points, 50);
    assert.equal(balance.total_sessions, 1);
    assert.equal(balance.trust_score, 1.0);
  });

  it('accumulates multiple credits', () => {
    const scoreResult = {
      basePoints: 5, totalPoints: 25, modelMultiplier: 5,
      correctionBonus: 0, coordinationBonus: 0, errorRecoveryBonus: 0,
      complexityBonus: 0, qualityBonus: 0,
    };

    ledger.credit('contrib_002', 'sess_a', scoreResult);
    ledger.credit('contrib_002', 'sess_b', scoreResult);
    ledger.credit('contrib_002', 'sess_c', scoreResult);

    const balance = ledger.getBalance('contrib_002');
    assert.equal(balance.total_points, 75);
    assert.equal(balance.total_sessions, 3);
  });

  it('returns null for unknown contributor', () => {
    assert.equal(ledger.getBalance('nonexistent'), null);
  });

  it('returns leaderboard sorted by points', () => {
    const score = (pts) => ({
      basePoints: 1, totalPoints: pts, modelMultiplier: 1,
      correctionBonus: 0, coordinationBonus: 0, errorRecoveryBonus: 0,
      complexityBonus: 0, qualityBonus: 0,
    });

    ledger.credit('user_a', 'sess_1', score(100));
    ledger.credit('user_b', 'sess_2', score(300));
    ledger.credit('user_c', 'sess_3', score(200));

    const board = ledger.getLeaderboard(10);
    assert.equal(board.length, 3);
    assert.equal(board[0].contributor_id, 'user_b');
    assert.equal(board[0].total_points, 300);
    assert.equal(board[1].contributor_id, 'user_c');
    assert.equal(board[2].contributor_id, 'user_a');
  });

  it('gets credit history for a contributor', () => {
    const scoreResult = {
      basePoints: 5, totalPoints: 25, modelMultiplier: 5,
      correctionBonus: 0, coordinationBonus: 0, errorRecoveryBonus: 0,
      complexityBonus: 0, qualityBonus: 0,
    };

    ledger.credit('contrib_hist', 'sess_x', scoreResult);
    ledger.credit('contrib_hist', 'sess_y', scoreResult);

    const credits = ledger.getCreditsForContributor('contrib_hist');
    assert.equal(credits.length, 2);
    assert.ok(credits[0].multiplier_breakdown);
  });

  it('daily credits aggregation works', () => {
    const scoreResult = {
      basePoints: 10, totalPoints: 50, modelMultiplier: 5,
      correctionBonus: 0, coordinationBonus: 0, errorRecoveryBonus: 0,
      complexityBonus: 0, qualityBonus: 0,
    };

    ledger.credit('contrib_daily', 'sess_d1', scoreResult);
    ledger.credit('contrib_daily', 'sess_d2', scoreResult);

    const daily = ledger.getDailyCredits(7);
    assert.ok(daily.length >= 1);
    const today = daily.find(d => d.date === new Date().toISOString().slice(0, 10));
    assert.ok(today);
    assert.equal(today.totalPoints, 100);
    assert.equal(today.totalSessions, 2);
  });

  it('adjusts trust score within bounds', () => {
    const scoreResult = {
      basePoints: 1, totalPoints: 1, modelMultiplier: 1,
      correctionBonus: 0, coordinationBonus: 0, errorRecoveryBonus: 0,
      complexityBonus: 0, qualityBonus: 0,
    };
    ledger.credit('trust_user', 'sess_t', scoreResult);

    ledger.adjustTrustScore('trust_user', 2.5);
    let balance = ledger.getBalance('trust_user');
    assert.equal(balance.trust_score, 3.5);

    ledger.adjustTrustScore('trust_user', -10);
    balance = ledger.getBalance('trust_user');
    assert.equal(balance.trust_score, 0);
  });
});
