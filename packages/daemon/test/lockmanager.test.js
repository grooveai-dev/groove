// GROOVE — LockManager Tests
// FSL-1.1-Apache-2.0 — see LICENSE

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { LockManager } from '../src/lockmanager.js';
import { mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('LockManager', () => {
  let locks;

  beforeEach(() => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'groove-test-'));
    locks = new LockManager(tmpDir);
  });

  it('should register locks for an agent', () => {
    locks.register('agent-1', ['src/api/**']);

    const all = locks.getAll();
    assert.deepEqual(all['agent-1'], ['src/api/**']);
  });

  it('should detect no conflict for the same agent', () => {
    locks.register('agent-1', ['src/api/**']);

    const result = locks.check('agent-1', 'src/api/auth.js');
    assert.equal(result.conflict, false);
  });

  it('should detect conflict with another agent scope', () => {
    locks.register('agent-1', ['src/api/**']);

    const result = locks.check('agent-2', 'src/api/auth.js');
    assert.equal(result.conflict, true);
    assert.equal(result.owner, 'agent-1');
  });

  it('should not conflict on files outside scope', () => {
    locks.register('agent-1', ['src/api/**']);

    const result = locks.check('agent-2', 'src/components/App.jsx');
    assert.equal(result.conflict, false);
  });

  it('should handle multiple scope patterns', () => {
    locks.register('agent-1', ['src/api/**', 'src/lib/**']);

    assert.equal(locks.check('agent-2', 'src/api/auth.js').conflict, true);
    assert.equal(locks.check('agent-2', 'src/lib/utils.js').conflict, true);
    assert.equal(locks.check('agent-2', 'src/components/App.jsx').conflict, false);
  });

  it('should release locks for an agent', () => {
    locks.register('agent-1', ['src/api/**']);
    locks.release('agent-1');

    const result = locks.check('agent-2', 'src/api/auth.js');
    assert.equal(result.conflict, false);
    assert.deepEqual(locks.getAll(), {});
  });

  it('should persist and restore locks', () => {
    locks.register('agent-1', ['src/api/**']);
    locks.register('agent-2', ['src/components/**']);

    // Create a new LockManager pointing at the same directory
    const locks2 = new LockManager(locks.path.replace('/locks.json', ''));

    const all = locks2.getAll();
    assert.deepEqual(all['agent-1'], ['src/api/**']);
    assert.deepEqual(all['agent-2'], ['src/components/**']);
  });

  it('should handle two agents with non-overlapping scopes', () => {
    locks.register('agent-1', ['src/api/**']);
    locks.register('agent-2', ['src/components/**']);

    assert.equal(locks.check('agent-1', 'src/api/auth.js').conflict, false);
    assert.equal(locks.check('agent-2', 'src/components/App.jsx').conflict, false);
    assert.equal(locks.check('agent-1', 'src/components/App.jsx').conflict, true);
    assert.equal(locks.check('agent-2', 'src/api/auth.js').conflict, true);
  });
});
