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

  describe('coordination operations', () => {
    it('declares an operation with no conflict', () => {
      const result = locks.declareOperation('agent-1', 'npm install', ['package.json']);
      assert.equal(result.conflict, false);
      const ops = locks.getOperations();
      assert.equal(ops['agent-1'].name, 'npm install');
    });

    it('detects conflict when another agent holds a resource', () => {
      locks.declareOperation('agent-1', 'npm install', ['package.json']);
      const result = locks.declareOperation('agent-2', 'edit manifest', ['package.json']);
      assert.equal(result.conflict, true);
      assert.equal(result.owner, 'agent-1');
      assert.equal(result.resource, 'package.json');
      assert.equal(result.operation, 'npm install');
    });

    it('allows non-overlapping resource claims', () => {
      locks.declareOperation('agent-1', 'npm install', ['package.json']);
      const result = locks.declareOperation('agent-2', 'restart server', ['server:3000']);
      assert.equal(result.conflict, false);
    });

    it('same agent can update its own declaration', () => {
      locks.declareOperation('agent-1', 'edit', ['file-a']);
      // Same agent can re-declare without conflict
      const result = locks.declareOperation('agent-1', 'edit', ['file-a', 'file-b']);
      assert.equal(result.conflict, false);
    });

    it('completeOperation releases the claim', () => {
      locks.declareOperation('agent-1', 'npm install', ['package.json']);
      locks.completeOperation('agent-1');

      const result = locks.declareOperation('agent-2', 'edit', ['package.json']);
      assert.equal(result.conflict, false);
    });

    it('operations auto-expire after TTL', () => {
      locks.declareOperation('agent-1', 'stale op', ['resource-x'], 1);
      // Wait past TTL
      const start = Date.now();
      while (Date.now() - start < 5) { /* spin briefly */ }

      const result = locks.declareOperation('agent-2', 'takeover', ['resource-x']);
      assert.equal(result.conflict, false);
    });

    it('rejects malformed declarations', () => {
      assert.equal(locks.declareOperation(null, 'op', ['r']).conflict, false);
      assert.equal(locks.declareOperation('a', null, ['r']).conflict, false);
      assert.equal(locks.declareOperation('a', 'op', []).conflict, false);
      // All return error flag
      assert.ok(locks.declareOperation('a', 'op', []).error);
    });

    it('release() also clears pending operations', () => {
      locks.declareOperation('agent-1', 'op', ['r']);
      locks.release('agent-1');
      const result = locks.declareOperation('agent-2', 'op2', ['r']);
      assert.equal(result.conflict, false);
    });
  });
});
