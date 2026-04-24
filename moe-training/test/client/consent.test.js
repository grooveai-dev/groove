// FSL-1.1-Apache-2.0 — see LICENSE

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ConsentManager } from '../../client/consent.js';

describe('ConsentManager', () => {
  let tmpDir, dbPath, manager;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'consent-test-'));
    dbPath = join(tmpDir, 'consent.db');
    manager = new ConsentManager(dbPath);
  });

  afterEach(() => {
    manager.close();
    rmSync(tmpDir, { recursive: true });
  });

  it('opt in then isOptedIn returns true', () => {
    manager.recordConsent('user1', true, '1.0');
    assert.equal(manager.isOptedIn('user1'), true);
  });

  it('opt out then isOptedIn returns false', () => {
    manager.recordConsent('user1', true, '1.0');
    manager.revokeConsent('user1');
    assert.equal(manager.isOptedIn('user1'), false);
  });

  it('no consent record returns false', () => {
    assert.equal(manager.isOptedIn('nonexistent'), false);
  });

  it('version mismatch returns false', () => {
    manager.recordConsent('user1', true, '0.9');
    assert.equal(manager.isOptedIn('user1'), false);
  });

  it('getOptedInCount counts correctly', () => {
    manager.recordConsent('user1', true, '1.0');
    manager.recordConsent('user2', true, '1.0');
    manager.recordConsent('user3', false, '1.0');
    assert.equal(manager.getOptedInCount(), 2);
  });

  it('getConsentHistory returns all records', () => {
    manager.recordConsent('user1', true, '1.0', { source: 'ui' });
    manager.revokeConsent('user1');
    const history = manager.getConsentHistory('user1');
    assert.equal(history.length, 2);
    assert.equal(history[0].opted_in, true);
    assert.deepEqual(history[0].metadata, { source: 'ui' });
    assert.equal(history[1].opted_in, false);
  });
});

describe('ConsentManager.getOrCreateUserId', () => {
  let tmpDir, userIdPath;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'userid-test-'));
    userIdPath = join(tmpDir, 'user_id');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true });
  });

  it('creates user_id file and returns id', () => {
    const id = ConsentManager.getOrCreateUserId(userIdPath);
    assert.ok(id.length > 0);
    assert.ok(existsSync(userIdPath));
  });

  it('returns same id on second call', () => {
    const id1 = ConsentManager.getOrCreateUserId(userIdPath);
    const id2 = ConsentManager.getOrCreateUserId(userIdPath);
    assert.equal(id1, id2);
  });
});

describe('ConsentManager.isCaptureEnabled', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'capture-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true });
  });

  it('returns false when no user_id file exists', () => {
    const result = ConsentManager.isCaptureEnabled(join(tmpDir, 'no_file'), join(tmpDir, 'c.db'));
    assert.equal(result, false);
  });

  it('returns false when user not opted in', () => {
    const uidPath = join(tmpDir, 'user_id');
    const uid = ConsentManager.getOrCreateUserId(uidPath);
    const dbPath = join(tmpDir, 'consent.db');
    const result = ConsentManager.isCaptureEnabled(uidPath, dbPath);
    assert.equal(result, false);
  });

  it('returns true when user is opted in', () => {
    const uidPath = join(tmpDir, 'user_id');
    const uid = ConsentManager.getOrCreateUserId(uidPath);
    const dbPath = join(tmpDir, 'consent.db');
    const mgr = new ConsentManager(dbPath);
    mgr.recordConsent(uid, true, '1.0');
    mgr.close();
    const result = ConsentManager.isCaptureEnabled(uidPath, dbPath);
    assert.equal(result, true);
  });
});
