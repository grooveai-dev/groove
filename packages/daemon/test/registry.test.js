// GROOVE — Registry Tests
// FSL-1.1-Apache-2.0 — see LICENSE

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Registry } from '../src/registry.js';
import { StateManager } from '../src/state.js';
import { mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('Registry', () => {
  let registry;

  beforeEach(() => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'groove-test-'));
    const state = new StateManager(tmpDir);
    registry = new Registry(state);
  });

  it('should add an agent and return it with an id', () => {
    const agent = registry.add({ role: 'backend', scope: ['src/api/**'] });

    assert.ok(agent.id, 'agent should have an id');
    assert.equal(agent.role, 'backend');
    assert.deepEqual(agent.scope, ['src/api/**']);
    assert.equal(agent.status, 'starting');
    assert.equal(agent.provider, 'claude-code');
    assert.ok(agent.spawnedAt);
  });

  it('should auto-name agents by role + count', () => {
    const a1 = registry.add({ role: 'backend' });
    const a2 = registry.add({ role: 'frontend' });

    assert.equal(a1.name, 'backend-1');
    assert.equal(a2.name, 'frontend-1');
  });

  it('should produce unique names across different teams', () => {
    const a1 = registry.add({ role: 'backend', teamId: 'team-a' });
    const a2 = registry.add({ role: 'backend', teamId: 'team-b' });
    const a3 = registry.add({ role: 'backend', teamId: 'team-a' });

    assert.equal(a1.name, 'backend-1');
    assert.equal(a2.name, 'backend-2');
    assert.equal(a3.name, 'backend-3');
    assert.notEqual(a1.name, a2.name);
    assert.notEqual(a2.name, a3.name);
  });

  it('should not reuse names after agents are removed', () => {
    const a1 = registry.add({ role: 'frontend' });
    assert.equal(a1.name, 'frontend-1');

    registry.remove(a1.id);
    assert.equal(registry.getAll().length, 0);

    const a2 = registry.add({ role: 'frontend' });
    assert.equal(a2.name, 'frontend-2');
  });

  it('_initCounters should resume numbering from restored agents', () => {
    const persisted = [
      { id: 'x1', name: 'backend-5', role: 'backend', status: 'running', pid: 1 },
      { id: 'x2', name: 'frontend-12', role: 'frontend', status: 'running', pid: 2 },
      { id: 'x3', name: 'backend-3', role: 'backend', status: 'running', pid: 3 },
    ];
    registry.restore(persisted);

    const newBackend = registry.add({ role: 'backend' });
    const newFrontend = registry.add({ role: 'frontend' });

    assert.equal(newBackend.name, 'backend-6');
    assert.equal(newFrontend.name, 'frontend-13');
  });

  it('should get an agent by id', () => {
    const added = registry.add({ role: 'backend' });
    const found = registry.get(added.id);

    assert.deepEqual(found, added);
  });

  it('should return null for unknown id', () => {
    assert.equal(registry.get('nonexistent'), null);
  });

  it('should list all agents', () => {
    registry.add({ role: 'backend' });
    registry.add({ role: 'frontend' });

    const all = registry.getAll();
    assert.equal(all.length, 2);
  });

  it('should update an agent', () => {
    const agent = registry.add({ role: 'backend' });
    const updated = registry.update(agent.id, { status: 'running', pid: 12345 });

    assert.equal(updated.status, 'running');
    assert.equal(updated.pid, 12345);
    assert.ok(updated.lastActivity);
  });

  it('should return null when updating unknown agent', () => {
    assert.equal(registry.update('nonexistent', { status: 'running' }), null);
  });

  it('should remove an agent', () => {
    const agent = registry.add({ role: 'backend' });

    assert.equal(registry.remove(agent.id), true);
    assert.equal(registry.get(agent.id), null);
    assert.equal(registry.getAll().length, 0);
  });

  it('should return false when removing unknown agent', () => {
    assert.equal(registry.remove('nonexistent'), false);
  });

  it('should find agents by role', () => {
    registry.add({ role: 'backend' });
    registry.add({ role: 'backend' });
    registry.add({ role: 'frontend' });

    assert.equal(registry.findByRole('backend').length, 2);
    assert.equal(registry.findByRole('frontend').length, 1);
    assert.equal(registry.findByRole('devops').length, 0);
  });

  it('should find agents by provider', () => {
    registry.add({ role: 'backend', provider: 'claude-code' });
    registry.add({ role: 'frontend', provider: 'codex' });

    assert.equal(registry.findByProvider('claude-code').length, 1);
    assert.equal(registry.findByProvider('codex').length, 1);
  });

  it('should emit change events', () => {
    let changeCount = 0;
    registry.on('change', () => changeCount++);

    registry.add({ role: 'backend' });
    assert.equal(changeCount, 1);

    const agent = registry.getAll()[0];
    registry.update(agent.id, { status: 'running' });
    assert.equal(changeCount, 2);

    registry.remove(agent.id);
    assert.equal(changeCount, 3);
  });

  it('should restore agents from persisted state', () => {
    const persisted = [
      { id: 'abc', name: 'backend-1', role: 'backend', status: 'running', pid: 999 },
      { id: 'def', name: 'frontend-1', role: 'frontend', status: 'running', pid: 1000 },
    ];

    registry.restore(persisted);
    const all = registry.getAll();

    assert.equal(all.length, 2);
    // Restored agents should be marked stopped with no PID
    assert.equal(all[0].status, 'stopped');
    assert.equal(all[0].pid, null);
    assert.equal(all[1].status, 'stopped');
    assert.equal(all[1].pid, null);
  });
});
