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
      update(id, updates) { const a = this.agents.find((x) => x.id === id); if (a) Object.assign(a, updates); return a; },
      remove(id) { this.agents = this.agents.filter((a) => a.id !== id); return true; },
      agents: [],
    };

    mockDaemon = {
      registry: mockRegistry,
      processes: {
        async kill(id) { /* mock */ },
        async spawn(config) { return { id: 'new-' + config.role, name: config.name, ...config }; },
      },
      journalist: {
        async generateHandoffBrief(agent, options = {}) {
          return `Handoff brief for ${agent.name}`;
        },
      },
      memory: {
        appendHandoffBrief() { return true; },
      },
      adaptive: {
        extractSignals() { return { errorCount: 0, repetitions: 0, scopeViolations: 0, toolCalls: 0, toolFailures: 0, filesWritten: 0 }; },
        recordSession() { return { score: 70, threshold: 0.75, converged: false }; },
        getThreshold() { return 0.65; },
      },
      classifier: {
        agentWindows: {},
        clearAgent(id) { delete this.agentWindows[id]; },
      },
      router: {
        getMode() { return { mode: 'fixed', fixedModel: null, floorModel: null }; },
      },
      tokens: {
        recordRotation() {},
        recordColdStartSkipped() {},
        record() {},
      },
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

  it('should include cooldown and token ceiling in stats', () => {
    const stats = rotator.getStats();
    assert.equal(stats.cooldownMs, 5 * 60 * 1000);
    assert.equal(stats.tokenCeiling, 5_000_000);
    assert.deepEqual(stats.roleMultipliers, { planner: 10, fullstack: 4, security: 4, analyst: 5 });
    assert.equal(stats.tokenCeilingRotations, 0);
  });

  it('should enforce cooldown — skip context rotation within 5 minutes', async () => {
    // Use gemini provider (non-self-managing)
    const agent = {
      id: 'g1', name: 'gemini-1', role: 'backend', status: 'running',
      provider: 'gemini', scope: [], model: null,
      tokensUsed: 1000, contextUsage: 0.70, workingDir: '/tmp',
      lastActivity: new Date(Date.now() - 30_000).toISOString(),
      spawnedAt: new Date(Date.now() - 300_000).toISOString(),
    };
    mockDaemon.registry.agents = [agent];
    mockDaemon.adaptive.getThreshold = () => 0.65;

    // Manually set a recent rotation time
    rotator.lastRotationTime.set('g1', Date.now() - 60_000); // 1 min ago (within 5-min cooldown)

    await rotator.check();

    // Should NOT rotate — cooldown is active
    const history = rotator.getHistory();
    assert.equal(history.length, 0);
  });

  it('should allow rotation after cooldown expires', async () => {
    const agent = {
      id: 'g2', name: 'gemini-2', role: 'backend', status: 'running',
      provider: 'gemini', scope: [], model: null,
      tokensUsed: 1000, contextUsage: 0.70, workingDir: '/tmp',
      lastActivity: new Date(Date.now() - 30_000).toISOString(),
      spawnedAt: new Date(Date.now() - 300_000).toISOString(),
    };
    mockDaemon.registry.agents = [agent];
    mockDaemon.adaptive.getThreshold = () => 0.65;

    // Set rotation time well in the past (6 min ago — cooldown expired)
    rotator.lastRotationTime.set('g2', Date.now() - 6 * 60 * 1000);

    await rotator.check();

    // Should rotate — cooldown expired
    const history = rotator.getHistory();
    assert.equal(history.length, 1);
    assert.equal(history[0].reason, 'context_threshold');
  });

  it('should trigger token ceiling rotation for non-self-managing provider', async () => {
    const agent = {
      id: 'g3', name: 'gemini-3', role: 'backend', status: 'running',
      provider: 'gemini', scope: [], model: null,
      tokensUsed: 5_500_000, contextUsage: 0.50, workingDir: '/tmp',
      lastActivity: new Date(Date.now() - 30_000).toISOString(),
      spawnedAt: new Date(Date.now() - 300_000).toISOString(),
    };
    mockDaemon.registry.agents = [agent];

    await rotator.check();

    const history = rotator.getHistory();
    assert.equal(history.length, 1);
    assert.equal(history[0].reason, 'token_ceiling');
  });

  it('should respect role multipliers — planner gets 50M ceiling', async () => {
    const agent = {
      id: 'g4', name: 'gemini-planner', role: 'planner', status: 'running',
      provider: 'gemini', scope: [], model: null,
      tokensUsed: 8_000_000, contextUsage: 0.50, workingDir: '/tmp',
      lastActivity: new Date(Date.now() - 30_000).toISOString(),
      spawnedAt: new Date(Date.now() - 300_000).toISOString(),
    };
    mockDaemon.registry.agents = [agent];

    await rotator.check();

    // 8M < 50M (planner ceiling = 5M * 10), should NOT token-ceiling rotate
    const history = rotator.getHistory();
    const tokenCeilingRotations = history.filter((r) => r.reason === 'token_ceiling');
    assert.equal(tokenCeilingRotations.length, 0);
  });

  it('should token ceiling rotate planner at 50M+', async () => {
    const agent = {
      id: 'g5', name: 'gemini-planner-2', role: 'planner', status: 'running',
      provider: 'gemini', scope: [], model: null,
      tokensUsed: 55_000_000, contextUsage: 0.50, workingDir: '/tmp',
      lastActivity: new Date(Date.now() - 30_000).toISOString(),
      spawnedAt: new Date(Date.now() - 300_000).toISOString(),
    };
    mockDaemon.registry.agents = [agent];

    await rotator.check();

    const history = rotator.getHistory();
    assert.equal(history.length, 1);
    assert.equal(history[0].reason, 'token_ceiling');
  });

  it('should bypass cooldown for hard ceiling', async () => {
    const agent = {
      id: 'g6', name: 'gemini-hot', role: 'backend', status: 'running',
      provider: 'gemini', scope: [], model: null,
      tokensUsed: 1000, contextUsage: 0.85, workingDir: '/tmp',
      lastActivity: new Date(Date.now() - 30_000).toISOString(),
      spawnedAt: new Date(Date.now() - 300_000).toISOString(),
    };
    mockDaemon.registry.agents = [agent];

    // Set recent cooldown
    rotator.lastRotationTime.set('g6', Date.now() - 60_000); // 1 min ago

    await rotator.check();

    // Hard ceiling (85% >= 80%) should bypass cooldown
    const history = rotator.getHistory();
    assert.equal(history.length, 1);
    assert.equal(history[0].reason, 'hard_ceiling');
  });

  it('should bypass cooldown for token ceiling', async () => {
    const agent = {
      id: 'g7', name: 'gemini-tokens', role: 'backend', status: 'running',
      provider: 'gemini', scope: [], model: null,
      tokensUsed: 6_000_000, contextUsage: 0.50, workingDir: '/tmp',
      lastActivity: new Date(Date.now() - 30_000).toISOString(),
      spawnedAt: new Date(Date.now() - 300_000).toISOString(),
    };
    mockDaemon.registry.agents = [agent];

    // Set recent cooldown
    rotator.lastRotationTime.set('g7', Date.now() - 60_000); // 1 min ago

    await rotator.check();

    // Token ceiling (6M >= 5M) should bypass cooldown
    const history = rotator.getHistory();
    assert.equal(history.length, 1);
    assert.equal(history[0].reason, 'token_ceiling');
  });

  it('should NOT apply token ceiling to self-managing providers (Claude Code)', async () => {
    const agent = {
      id: 'c1', name: 'claude-heavy', role: 'backend', status: 'running',
      provider: 'claude-code', scope: [], model: null,
      tokensUsed: 10_000_000, contextUsage: 0.50, workingDir: '/tmp',
      lastActivity: new Date(Date.now() - 30_000).toISOString(),
      spawnedAt: new Date(Date.now() - 300_000).toISOString(),
    };
    mockDaemon.registry.agents = [agent];

    await rotator.check();

    // Claude Code self-manages — token ceiling should NOT fire
    const history = rotator.getHistory();
    const tokenCeilingRotations = history.filter((r) => r.reason === 'token_ceiling');
    assert.equal(tokenCeilingRotations.length, 0);
  });

  it('should record lastRotationTime after successful rotation', async () => {
    const agent = {
      id: 'a3', name: 'backend-3', role: 'backend',
      provider: 'claude-code', scope: [], model: null,
      tokensUsed: 3000, contextUsage: 0.9, workingDir: '/tmp',
    };
    mockDaemon.registry.agents = [agent];

    assert.equal(rotator.lastRotationTime.has('a3'), false);

    const newAgent = await rotator.rotate('a3');

    assert.equal(rotator.lastRotationTime.has('a3'), false);
    assert.equal(rotator.lastRotationTime.has(newAgent.id), true);
    const elapsed = Date.now() - rotator.lastRotationTime.get(newAgent.id);
    assert.ok(elapsed < 1000); // Should be very recent
  });
});
