// GROOVE — Teams Tests
// FSL-1.1-Apache-2.0 — see LICENSE

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Teams } from '../src/teams.js';
import { Registry } from '../src/registry.js';
import { StateManager } from '../src/state.js';
import { mkdtempSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

function createMockDaemon() {
  const tmpDir = mkdtempSync(join(tmpdir(), 'groove-test-'));
  const grooveDir = join(tmpDir, '.groove');
  mkdirSync(grooveDir, { recursive: true });

  const state = new StateManager(grooveDir);
  const registry = new Registry(state);

  const broadcasts = [];
  const daemon = {
    registry,
    grooveDir,
    projectDir: tmpDir,
    broadcast(msg) { broadcasts.push(msg); },
    processes: { kill() {} },
  };

  return { daemon, tmpDir, grooveDir, broadcasts };
}

describe('Teams', () => {
  let teams;
  let daemon;
  let broadcasts;

  beforeEach(() => {
    const mock = createMockDaemon();
    daemon = mock.daemon;
    broadcasts = mock.broadcasts;
    teams = new Teams(daemon);
  });

  it('should auto-create a default team', () => {
    const list = teams.list();
    assert.equal(list.length, 1);
    assert.equal(list[0].name, 'Default');
    assert.equal(list[0].isDefault, true);
    assert.ok(list[0].id);
  });

  it('should return default team via getDefault()', () => {
    const d = teams.getDefault();
    assert.equal(d.name, 'Default');
    assert.equal(d.isDefault, true);
  });

  it('should create a new team', () => {
    const team = teams.create('Marketing');
    assert.equal(team.name, 'Marketing');
    assert.equal(team.isDefault, false);
    assert.ok(team.id);
    assert.ok(team.createdAt);

    const list = teams.list();
    assert.equal(list.length, 2); // Default + Marketing
  });

  it('should broadcast on team create', () => {
    teams.create('Dev');
    const msg = broadcasts.find((b) => b.type === 'team:created');
    assert.ok(msg);
    assert.equal(msg.team.name, 'Dev');
  });

  it('should throw when creating without a name', () => {
    assert.throws(() => teams.create(''), /name is required/);
  });

  it('should get team by ID', () => {
    const created = teams.create('Backend');
    const fetched = teams.get(created.id);
    assert.equal(fetched.name, 'Backend');
  });

  it('should return null for nonexistent ID', () => {
    assert.equal(teams.get('nope'), null);
  });

  it('should rename a team', () => {
    const team = teams.create('Old Name');
    const renamed = teams.rename(team.id, 'New Name');
    assert.equal(renamed.name, 'New Name');
    assert.equal(teams.get(team.id).name, 'New Name');
  });

  it('should broadcast on rename', () => {
    const team = teams.create('Before');
    broadcasts.length = 0;
    teams.rename(team.id, 'After');
    const msg = broadcasts.find((b) => b.type === 'team:updated');
    assert.ok(msg);
    assert.equal(msg.team.name, 'After');
  });

  it('should throw when renaming nonexistent team', () => {
    assert.throws(() => teams.rename('nope', 'X'), /not found/);
  });

  it('should delete a team', () => {
    const team = teams.create('To Delete');
    assert.equal(teams.list().length, 2);
    teams.delete(team.id);
    assert.equal(teams.list().length, 1);
    assert.equal(teams.get(team.id), null);
  });

  it('should remove agents on team delete', () => {
    const team = teams.create('Temp');
    const agent = daemon.registry.add({ role: 'backend', teamId: team.id });
    assert.equal(daemon.registry.get(agent.id).teamId, team.id);

    teams.delete(team.id);

    assert.equal(daemon.registry.get(agent.id), null);
  });

  it('should broadcast on delete', () => {
    const team = teams.create('Temp');
    broadcasts.length = 0;
    teams.delete(team.id);
    const msg = broadcasts.find((b) => b.type === 'team:deleted');
    assert.ok(msg);
    assert.equal(msg.teamId, team.id);
  });

  it('should throw when deleting the default team', () => {
    const d = teams.getDefault();
    assert.throws(() => teams.delete(d.id), /Cannot delete the default/);
  });

  it('should throw when deleting nonexistent team', () => {
    assert.throws(() => teams.delete('nope'), /not found/);
  });

  it('should migrate agents without teamId to default', () => {
    // Simulate old agent with no teamId
    const agent = daemon.registry.add({ role: 'backend' });
    assert.equal(daemon.registry.get(agent.id).teamId, null);

    teams.migrateAgents();

    const defaultTeam = teams.getDefault();
    assert.equal(daemon.registry.get(agent.id).teamId, defaultTeam.id);
  });

  it('should not re-migrate agents that already have teamId', () => {
    const team = teams.create('Existing');
    const agent = daemon.registry.add({ role: 'backend', teamId: team.id });

    teams.migrateAgents();

    // Should stay in original team, not moved to default
    assert.equal(daemon.registry.get(agent.id).teamId, team.id);
  });

  it('should persist teams across instances', () => {
    teams.create('Persistent');
    assert.equal(teams.list().length, 2);

    // Create new Teams instance with same daemon (same grooveDir)
    const teams2 = new Teams(daemon);
    assert.equal(teams2.list().length, 2);
    assert.ok(teams2.list().some((t) => t.name === 'Persistent'));
  });

  it('should provide backward compat stubs', () => {
    // onAgentChange is a no-op
    teams.onAgentChange();

    // getActiveTeam returns default team name
    assert.equal(teams.getActiveTeam(), 'Default');
  });
});
