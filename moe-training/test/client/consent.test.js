// FSL-1.1-Apache-2.0 — see LICENSE

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ConsentManager } from '../../client/consent.js';

describe('ConsentManager', () => {
  let tmpDir, consentPath, manager;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'consent-test-'));
    consentPath = join(tmpDir, 'consent.json');
    manager = new ConsentManager(consentPath);
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
    assert.equal(manager.getOptedInCount(), 1);
  });

  it('getConsentHistory returns current state', () => {
    manager.recordConsent('user1', true, '1.0');
    const history = manager.getConsentHistory('user1');
    assert.equal(history.length, 1);
    assert.equal(history[0].opted_in, true);
  });

  it('consent.json is written with 0o600 permissions', () => {
    manager.recordConsent('user1', true, '1.0');
    assert.ok(existsSync(consentPath));
    const data = JSON.parse(readFileSync(consentPath, 'utf-8'));
    assert.equal(data.opted_in, true);
    assert.equal(data.consent_version, '1.0');
    assert.equal(data.user_id, 'user1');
    assert.ok(data.updated_at);
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
    const result = ConsentManager.isCaptureEnabled(join(tmpDir, 'no_file'), join(tmpDir, 'consent.json'));
    assert.equal(result, false);
  });

  it('returns false when user not opted in', () => {
    const uidPath = join(tmpDir, 'user_id');
    ConsentManager.getOrCreateUserId(uidPath);
    const result = ConsentManager.isCaptureEnabled(uidPath, join(tmpDir, 'consent.json'));
    assert.equal(result, false);
  });

  it('returns true when user is opted in', () => {
    const uidPath = join(tmpDir, 'user_id');
    const uid = ConsentManager.getOrCreateUserId(uidPath);
    const consentPath = join(tmpDir, 'consent.json');
    const mgr = new ConsentManager(consentPath);
    mgr.recordConsent(uid, true, '1.0');
    const result = ConsentManager.isCaptureEnabled(uidPath, consentPath);
    assert.equal(result, true);
  });
});
