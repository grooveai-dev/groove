// GROOVE — Rotator Tests
// FSL-1.1-Apache-2.0 — see LICENSE

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Rotator } from '../src/rotator.js';

describe('Rotator', () => {
  let rotator;
  let broadcasts;
  let mockDaemon;

  beforeEach(() => {
    broadcasts = [];
    const mockRegistry = {
      get(id) { return this.agents.find((a) => a.id === id) || null; },
      getAll() { return this.agents; },
      agents: [],
    };

    mockDaemon = {
      registry: mockRegistry,
      processes: {
        async kill(id) { /* mock */ },
        async spawn(config) { return { id: 'new-' + config.role, name: config.name, ...config }; },
      },
      journalist: {
        async generateHandoffBrief(agent) {
          return `Handoff brief for ${agent.name}`;
        },
      },
      adaptive: null,
      broadcast(msg) { broadcasts.push(msg); },
    };

    rotator = new Rotator(mockDaemon);
  });

  it('should start with empty state', () => {
    const stats = rotator.getStats();
    assert.equal(stats.totalRotations, 0);
    assert.equal(stats.totalTokensSaved, 0);
    assert.equal(stats.enabled, false);
    assert.deepEqual(stats.rotating, []);
  });

  it('should start and stop cleanly', () => {
    rotator.start();
    assert.equal(rotator.getStats().enabled, true);

    rotator.stop();
    assert.equal(rotator.getStats().enabled, false);
  });

  it('should rotate an agent', async () => {
    const agent = {
      id: 'a1', name: 'backend-1', role: 'backend',
      provider: 'claude-code', scope: ['src/api/**'],
      model: null, tokensUsed: 5000, contextUsage: 0.8,
      workingDir: '/tmp', prompt: 'Test',
    };
    mockDaemon.registry.agents = [agent];

    const newAgent = await rotator.rotate('a1');

    assert.ok(newAgent);
    assert.equal(newAgent.role, 'backend');
    assert.equal(newAgent.name, 'backend-1'); // Keeps same name

    // Check history
    const history = rotator.getHistory();
    assert.equal(history.length, 1);
    assert.equal(history[0].agentName, 'backend-1');
    assert.equal(history[0].oldTokens, 5000);

    // Check broadcasts
    const types = broadcasts.map((b) => b.type);
    assert.ok(types.includes('rotation:start'));
    assert.ok(types.includes('rotation:complete'));
  });

  it('should emit rotation event', async () => {
    const agent = {
      id: 'a1', name: 'backend-1', role: 'backend',
      provider: 'claude-code', scope: [], model: null,
      tokensUsed: 3000, contextUsage: 0.9, workingDir: '/tmp',
    };
    mockDaemon.registry.agents = [agent];

    let emitted = false;
    rotator.on('rotation', (record) => {
      emitted = true;
      assert.equal(record.agentName, 'backend-1');
      assert.equal(record.oldTokens, 3000);
    });

    await rotator.rotate('a1');
    assert.ok(emitted);
  });

  it('should prevent double rotation', async () => {
    const agent = {
      id: 'a1', name: 'backend-1', role: 'backend',
      provider: 'claude-code', scope: [], model: null,
      tokensUsed: 3000, contextUsage: 0.9, workingDir: '/tmp',
    };
    mockDaemon.registry.agents = [agent];

    // Start first rotation
    const p1 = rotator.rotate('a1');

    // Try second rotation immediately
    await assert.rejects(
      () => rotator.rotate('a1'),
      { message: /already rotating/ }
    );

    await p1;
  });

  it('should throw for unknown agent', async () => {
    await assert.rejects(
      () => rotator.rotate('nonexistent'),
      { message: /not found/ }
    );
  });

  it('should track stats across multiple rotations', async () => {
    const agent1 = {
      id: 'a1', name: 'backend-1', role: 'backend',
      provider: 'claude-code', scope: [], model: null,
      tokensUsed: 5000, contextUsage: 0.8, workingDir: '/tmp',
    };
    const agent2 = {
      id: 'a2', name: 'frontend-1', role: 'frontend',
      provider: 'claude-code', scope: [], model: null,
      tokensUsed: 3000, contextUsage: 0.9, workingDir: '/tmp',
    };
    mockDaemon.registry.agents = [agent1, agent2];

    await rotator.rotate('a1');
    mockDaemon.registry.agents = [agent2]; // a1 was killed
    await rotator.rotate('a2');

    const stats = rotator.getStats();
    assert.equal(stats.totalRotations, 2);
    assert.equal(stats.totalTokensSaved, 8000);
  });
});
