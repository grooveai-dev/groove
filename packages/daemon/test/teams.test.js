// GROOVE — Teams Tests
// FSL-1.1-Apache-2.0 — see LICENSE

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Teams } from '../src/teams.js';
import { Registry } from '../src/registry.js';
import { StateManager } from '../src/state.js';
import { mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

function createMockDaemon() {
  const tmpDir = mkdtempSync(join(tmpdir(), 'groove-test-'));
  const grooveDir = join(tmpDir, '.groove');
  mkdirSync(grooveDir, { recursive: true });

  const state = new StateManager(grooveDir);
  const registry = new Registry(state);

  const spawned = [];
  const daemon = {
    registry,
    grooveDir,
    processes: {
      async killAll() {},
      async spawn(config) {
        const agent = registry.add(config);
        registry.update(agent.id, { status: 'running' });
        spawned.push(agent);
        return agent;
      },
    },
    broadcast() {},
  };

  return { daemon, tmpDir, grooveDir, spawned };
}

describe('Teams', () => {
  let teams;
  let daemon;

  beforeEach(() => {
    const mock = createMockDaemon();
    daemon = mock.daemon;
    teams = new Teams(daemon);
  });

  it('should save current agents as a team', () => {
    daemon.registry.add({ role: 'backend', scope: ['src/api/**'], provider: 'claude-code' });
    daemon.registry.add({ role: 'frontend', scope: ['src/components/**'], provider: 'claude-code' });

    const team = teams.save('my-project');

    assert.equal(team.name, 'my-project');
    assert.equal(team.agents.length, 2);
    assert.equal(team.agents[0].role, 'backend');
    assert.equal(team.agents[1].role, 'frontend');
    assert.ok(team.createdAt);
  });

  it('should throw when saving with no agents', () => {
    assert.throws(() => teams.save('empty'), /No agents/);
  });

  it('should throw when saving without a name', () => {
    daemon.registry.add({ role: 'backend' });
    assert.throws(() => teams.save(''), /name is required/);
  });

  it('should list saved teams', () => {
    daemon.registry.add({ role: 'backend' });
    teams.save('team-a');

    daemon.registry.add({ role: 'frontend' });
    teams.save('team-b');

    const list = teams.list();
    assert.equal(list.length, 2);

    const names = list.map((t) => t.name);
    assert.ok(names.includes('team-a'));
    assert.ok(names.includes('team-b'));
  });

  it('should get a specific team', () => {
    daemon.registry.add({ role: 'backend', scope: ['src/**'] });
    teams.save('my-team');

    const team = teams.get('my-team');
    assert.equal(team.name, 'my-team');
    assert.equal(team.agents.length, 1);
  });

  it('should return null for nonexistent team', () => {
    assert.equal(teams.get('nope'), null);
  });

  it('should load a team and spawn agents', async () => {
    // Save a team with 2 agents
    daemon.registry.add({ role: 'backend', scope: ['src/api/**'] });
    daemon.registry.add({ role: 'frontend', scope: ['src/components/**'] });
    teams.save('full-stack');

    // Clear registry to simulate fresh state
    for (const a of daemon.registry.getAll()) daemon.registry.remove(a.id);
    assert.equal(daemon.registry.getAll().length, 0);

    // Load the team
    const result = await teams.load('full-stack');

    assert.equal(result.name, 'full-stack');
    assert.equal(result.agents.length, 2);
    assert.equal(teams.getActiveTeam(), 'full-stack');
  });

  it('should throw when loading nonexistent team', async () => {
    await assert.rejects(() => teams.load('nope'), /not found/);
  });

  it('should delete a team', () => {
    daemon.registry.add({ role: 'backend' });
    teams.save('to-delete');

    assert.ok(teams.get('to-delete'));
    teams.delete('to-delete');
    assert.equal(teams.get('to-delete'), null);
  });

  it('should throw when deleting nonexistent team', () => {
    assert.throws(() => teams.delete('nope'), /not found/);
  });

  it('should export team as JSON', () => {
    daemon.registry.add({ role: 'backend' });
    teams.save('exportable');

    const json = teams.export('exportable');
    const parsed = JSON.parse(json);
    assert.equal(parsed.name, 'exportable');
    assert.equal(parsed.agents.length, 1);
  });

  it('should import team from JSON', () => {
    const json = JSON.stringify({
      name: 'imported-team',
      agents: [
        { role: 'backend', scope: ['src/api/**'], provider: 'claude-code' },
        { role: 'frontend', scope: ['src/components/**'], provider: 'claude-code' },
      ],
    });

    const team = teams.import(json);
    assert.equal(team.name, 'imported-team');
    assert.equal(team.agents.length, 2);

    // Should be persisted
    const loaded = teams.get('imported-team');
    assert.ok(loaded);
    assert.equal(loaded.agents.length, 2);
  });

  it('should reject invalid import JSON', () => {
    assert.throws(() => teams.import('not json'), /Invalid JSON/);
    assert.throws(() => teams.import('{}'), /needs "name"/);
    assert.throws(
      () => teams.import(JSON.stringify({ name: 'x', agents: [{}] })),
      /Role is required/
    );
  });

  it('should auto-save when agents change while team is active', () => {
    daemon.registry.add({ role: 'backend' });
    teams.save('auto-saved');

    // Add another agent
    const a2 = daemon.registry.add({ role: 'frontend' });
    daemon.registry.update(a2.id, { status: 'running' });

    // Trigger auto-save
    teams.onAgentChange();

    const team = teams.get('auto-saved');
    // Should now have the frontend agent (only running agents are saved)
    assert.ok(team.agents.some((a) => a.role === 'frontend'));
  });

  it('should sanitize team names for filesystem', () => {
    daemon.registry.add({ role: 'backend' });
    teams.save('My Project / v2!');

    const list = teams.list();
    assert.equal(list.length, 1);
    assert.equal(list[0].name, 'My Project / v2!'); // Original name preserved in JSON
  });
});
