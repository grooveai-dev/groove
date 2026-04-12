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
      adaptive: {
        extractSignals() { return { errorCount: 0, repetitions: 0, scopeViolations: 0, toolCalls: 0, toolFailures: 0, filesWritten: 0 }; },
        recordSession() { return { score: 70, threshold: 0.75, converged: false }; },
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

  describe('safety triggers', () => {
    const SPAWNED = new Date(Date.now() - 60_000).toISOString(); // spawned 1 min ago

    function mkAgent(overrides = {}) {
      return {
        id: 'a1', name: 'backend-1', role: 'backend',
        provider: 'claude-code', scope: [], model: null,
        tokensUsed: 0, contextUsage: 0.1, workingDir: '/tmp',
        spawnedAt: SPAWNED, status: 'running',
        ...overrides,
      };
    }

    it('returns null when safety config is missing', () => {
      mockDaemon.config = undefined;
      const trigger = rotator._checkSafetyTriggers(mkAgent());
      assert.equal(trigger, null);
    });

    it('returns null when autoRotate is disabled', () => {
      mockDaemon.config = { safety: { autoRotate: false, tokenCeilingPerAgent: 100 } };
      mockDaemon.tokens.getTokensInWindow = () => 1000;
      const trigger = rotator._checkSafetyTriggers(mkAgent());
      assert.equal(trigger, null);
    });

    it('fires token_limit_exceeded when instance tokens hit ceiling', () => {
      mockDaemon.config = {
        safety: {
          autoRotate: true,
          tokenCeilingPerAgent: 1_000_000,
          velocityWindowSeconds: 300,
          velocityTokenThreshold: 2_000_000,
        },
      };
      mockDaemon.tokens.getTokensInWindow = () => 1_200_000;
      mockDaemon.tokens.getVelocity = () => 0;

      const trigger = rotator._checkSafetyTriggers(mkAgent());
      assert.equal(trigger.reason, 'token_limit_exceeded');
      assert.equal(trigger.instanceTokens, 1_200_000);
      assert.equal(trigger.ceiling, 1_000_000);
    });

    it('returns null when ceiling not hit', () => {
      mockDaemon.config = {
        safety: { autoRotate: true, tokenCeilingPerAgent: 5_000_000 },
      };
      mockDaemon.tokens.getTokensInWindow = () => 100_000;
      const trigger = rotator._checkSafetyTriggers(mkAgent());
      assert.equal(trigger, null);
    });

    it('planner gets a 10x ceiling — normal heavy exploration does not trigger', () => {
      mockDaemon.config = {
        safety: { autoRotate: true, tokenCeilingPerAgent: 5_000_000 },
      };
      // A planner reading a big codebase at 3M tokens would have tripped
      // the old 5M ceiling but has 50M headroom under the role multiplier.
      mockDaemon.tokens.getTokensInWindow = () => 3_000_000;
      const trigger = rotator._checkSafetyTriggers(mkAgent({ role: 'planner' }));
      assert.equal(trigger, null, 'planner should NOT trigger at 3M when base ceiling is 5M');
    });

    it('planner still triggers on genuinely runaway burn (>50M instance tokens)', () => {
      mockDaemon.config = {
        safety: { autoRotate: true, tokenCeilingPerAgent: 5_000_000 },
      };
      mockDaemon.tokens.getTokensInWindow = () => 60_000_000;
      const trigger = rotator._checkSafetyTriggers(mkAgent({ role: 'planner' }));
      assert.equal(trigger.reason, 'token_limit_exceeded');
      assert.equal(trigger.ceiling, 50_000_000, 'planner ceiling = 5M × 10');
    });

    it('role multipliers are config-overridable', () => {
      mockDaemon.config = {
        safety: {
          autoRotate: true,
          tokenCeilingPerAgent: 1_000_000,
          roleMultipliers: { backend: 2 },
        },
      };
      mockDaemon.tokens.getTokensInWindow = () => 1_500_000; // above base ceiling, under 2x
      const trigger = rotator._checkSafetyTriggers(mkAgent({ role: 'backend' }));
      assert.equal(trigger, null, 'backend with 2x multiplier should allow 2M ceiling');
    });

    it('does not trigger on velocity (velocity rotation removed in v0.27.2)', () => {
      mockDaemon.config = {
        safety: { autoRotate: true, tokenCeilingPerAgent: 10_000_000 },
      };
      // Even with huge velocity, no rotation if under ceiling
      mockDaemon.tokens.getTokensInWindow = () => 500_000;
      mockDaemon.tokens.getVelocity = () => 99_999_999;
      const trigger = rotator._checkSafetyTriggers(mkAgent());
      assert.equal(trigger, null, 'velocity alone should never trigger a rotation');
    });

    it('stats track safety-triggered rotations separately', async () => {
      mockDaemon.registry.agents = [mkAgent({ tokensUsed: 1_200_000 })];
      await rotator.rotate('a1', {
        reason: 'token_limit_exceeded',
        instanceTokens: 1_200_000,
        ceiling: 1_000_000,
      });

      const stats = rotator.getStats();
      assert.equal(stats.tokenLimitRotations, 1);
      assert.equal(stats.velocityRotations, 0);
      assert.equal(stats.totalRotations, 1);
    });
  });
});
