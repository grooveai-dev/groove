// GROOVE — CredentialStore Tests
// FSL-1.1-Apache-2.0 — see LICENSE

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { CredentialStore } from '../src/credentials.js';
import { mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('CredentialStore', () => {
  let store;
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'groove-test-'));
    store = new CredentialStore(tmpDir);
  });

  it('should start empty', () => {
    assert.equal(store.listProviders().length, 0);
    assert.equal(store.hasKey('codex'), false);
    assert.equal(store.getKey('codex'), null);
  });

  it('should set and get a key', () => {
    store.setKey('codex', 'sk-test-123456');
    assert.equal(store.hasKey('codex'), true);
    assert.equal(store.getKey('codex'), 'sk-test-123456');
  });

  it('should mask keys', () => {
    const masked = store.mask('sk-test-123456');
    assert.ok(masked.includes('sk-t'));
    assert.ok(masked.includes('3456'));
    assert.ok(masked.includes('...'));
    assert.ok(!masked.includes('test-12'));
  });

  it('should delete a key', () => {
    store.setKey('codex', 'sk-test-123456');
    store.deleteKey('codex');
    assert.equal(store.hasKey('codex'), false);
    assert.equal(store.getKey('codex'), null);
  });

  it('should list providers with keys', () => {
    store.setKey('codex', 'sk-test-123');
    store.setKey('gemini', 'AIza-test-456');

    const list = store.listProviders();
    assert.equal(list.length, 2);
    assert.ok(list.some((p) => p.provider === 'codex'));
    assert.ok(list.some((p) => p.provider === 'gemini'));
    assert.ok(list[0].masked);
    assert.ok(list[0].setAt);
  });

  it('should persist and restore', () => {
    store.setKey('codex', 'sk-test-persist');

    const store2 = new CredentialStore(tmpDir);
    assert.equal(store2.getKey('codex'), 'sk-test-persist');
  });

  it('should get env vars for provider', () => {
    store.setKey('codex', 'sk-test-env');
    const env = store.getEnvForProvider('codex', { envKey: 'OPENAI_API_KEY' });
    assert.equal(env.OPENAI_API_KEY, 'sk-test-env');
  });

  it('should return empty env when no key or no envKey', () => {
    const env1 = store.getEnvForProvider('codex', { envKey: 'OPENAI_API_KEY' });
    assert.deepEqual(env1, {});

    store.setKey('codex', 'sk-test');
    const env2 = store.getEnvForProvider('codex', {});
    assert.deepEqual(env2, {});
  });
});
