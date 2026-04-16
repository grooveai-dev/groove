// GROOVE — StateManager Tests
// FSL-1.1-Apache-2.0 — see LICENSE

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { StateManager } from '../src/state.js';
import { mkdtempSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('StateManager', () => {
  let state;
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'groove-test-'));
    state = new StateManager(tmpDir);
  });

  it('should start with empty state', () => {
    assert.equal(state.get('anything'), undefined);
  });

  it('should set and get values', () => {
    state.set('key', 'value');
    assert.equal(state.get('key'), 'value');
  });

  it('should handle complex values', () => {
    const agents = [{ id: '1', name: 'test', role: 'backend' }];
    state.set('agents', agents);
    assert.deepEqual(state.get('agents'), agents);
  });

  it('should persist to disk and restore', async () => {
    state.set('agents', [{ id: 'a1', role: 'backend' }]);
    state.set('config', { port: 3141 });
    await state.save();

    // Verify file exists
    assert.ok(existsSync(join(tmpDir, 'state.json')));

    // Create a new StateManager and load
    const state2 = new StateManager(tmpDir);
    state2.load();

    assert.deepEqual(state2.get('agents'), [{ id: 'a1', role: 'backend' }]);
    assert.deepEqual(state2.get('config'), { port: 3141 });
  });

  it('should handle loading from nonexistent file gracefully', () => {
    state.load();
    assert.equal(state.get('anything'), undefined);
  });

  it('should handle corrupted state file gracefully', async () => {
    const fs = await import('node:fs');
    fs.writeFileSync(join(tmpDir, 'state.json'), 'not json{{{');

    state.load();
    assert.equal(state.get('anything'), undefined);
  });
});
