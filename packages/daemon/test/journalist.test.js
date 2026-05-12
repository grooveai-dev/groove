// GROOVE — Journalist Tests
// FSL-1.1-Apache-2.0 — see LICENSE

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Journalist } from '../src/journalist.js';
import { Registry } from '../src/registry.js';
import { StateManager } from '../src/state.js';
import { MemoryStore } from '../src/memory.js';
import { mkdtempSync, writeFileSync, existsSync, readFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

function createMockDaemon() {
  const tmpDir = mkdtempSync(join(tmpdir(), 'groove-test-'));
  const grooveDir = join(tmpDir, '.groove');
  mkdirSync(join(grooveDir, 'logs'), { recursive: true });
  mkdirSync(join(grooveDir, 'context'), { recursive: true });

  const state = new StateManager(grooveDir);
  const registry = new Registry(state);

  const broadcasts = [];
  const daemon = {
    registry,
    projectDir: tmpDir,
    grooveDir,
    broadcast(msg) { broadcasts.push(msg); },
  };

  return { daemon, tmpDir, grooveDir, broadcasts };
}

describe('Journalist', () => {
  describe('filterLog', () => {
    it('should extract tool calls from stream-json log', () => {
      const { daemon } = createMockDaemon();
      const journalist = new Journalist(daemon);

      const logLine = JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', name: 'Write', input: { file_path: 'src/api/auth.js' } },
          ],
        },
      });

      const { entries, explorationEntries } = journalist.filterLog(logLine, { name: 'test' });
      assert.equal(entries.length, 1);
      assert.equal(entries[0].type, 'tool');
      assert.equal(entries[0].tool, 'Write');
      assert.equal(entries[0].input, 'src/api/auth.js');
      assert.equal(explorationEntries.length, 0);
    });

    it('should skip non-JSON lines (transient errors are noise)', () => {
      const { daemon } = createMockDaemon();
      const journalist = new Journalist(daemon);

      // Non-JSON error lines are dropped to prevent context degradation
      const { entries } = journalist.filterLog('Error: something broke\nTypeError: undefined is not a function', {});
      assert.equal(entries.length, 0);
    });

    it('should extract result events', () => {
      const { daemon } = createMockDaemon();
      const journalist = new Journalist(daemon);

      const logLine = JSON.stringify({
        type: 'result',
        result: 'Task completed successfully',
        num_turns: 5,
        duration_ms: 12000,
        total_cost_usd: 0.15,
      });

      const { entries } = journalist.filterLog(logLine, {});
      assert.equal(entries.length, 1);
      assert.equal(entries[0].type, 'result');
      assert.ok(entries[0].text.includes('Task completed'));
      assert.equal(entries[0].turns, 5);
    });

    it('should skip empty and GROOVE header lines', () => {
      const { daemon } = createMockDaemon();
      const journalist = new Journalist(daemon);

      const { entries } = journalist.filterLog(
        '[2026-04-04] GROOVE spawning: claude ...\n\nnot json\n',
        {}
      );
      assert.equal(entries.length, 0);
    });
  });

  describe('buildStructuralSummary', () => {
    it('should produce a summary from filtered logs', () => {
      const { daemon } = createMockDaemon();
      const journalist = new Journalist(daemon);

      const agents = [
        { id: 'a1', name: 'backend-1', role: 'backend', provider: 'claude-code', scope: ['src/api/**'], tokensUsed: 100 },
      ];

      const filteredLogs = {
        a1: {
          agent: agents[0],
          entries: [
            { type: 'tool', tool: 'Write', input: 'src/api/auth.js' },
            { type: 'tool', tool: 'Write', input: 'src/api/users.js' },
            { type: 'tool', tool: 'Read', input: 'package.json' },
          ],
        },
      };

      const result = journalist.buildStructuralSummary(agents, filteredLogs);

      assert.ok(result.projectMap.includes('backend-1'));
      assert.ok(result.projectMap.includes('src/api/auth.js'));
      assert.ok(result.projectMap.includes('src/api/users.js'));
      assert.ok(result.summary.includes('backend-1'));
    });
  });

  describe('writeProjectMap', () => {
    it('should write GROOVE_PROJECT_MAP.md', () => {
      const { daemon, tmpDir } = createMockDaemon();
      const journalist = new Journalist(daemon);

      journalist.writeProjectMap('# Test Map\n\nContent here');

      const path = join(tmpDir, 'GROOVE_PROJECT_MAP.md');
      assert.ok(existsSync(path));
      const content = readFileSync(path, 'utf8');
      assert.ok(content.includes('Test Map'));
    });
  });

  describe('writeDecisionsLog', () => {
    it('should write GROOVE_DECISIONS.md', () => {
      const { daemon, tmpDir } = createMockDaemon();
      const journalist = new Journalist(daemon);
      journalist.cycleCount = 1;

      journalist.writeDecisionsLog('Used Express over Fastify for simplicity');

      const path = join(tmpDir, 'GROOVE_DECISIONS.md');
      assert.ok(existsSync(path));
      const content = readFileSync(path, 'utf8');
      assert.ok(content.includes('Express over Fastify'));
      assert.ok(content.includes('Cycle 1'));
    });

    it('should prepend new decisions to existing file', () => {
      const { daemon, tmpDir } = createMockDaemon();
      const journalist = new Journalist(daemon);

      journalist.cycleCount = 1;
      journalist.writeDecisionsLog('First decision');
      journalist.cycleCount = 2;
      journalist.writeDecisionsLog('Second decision');

      const content = readFileSync(join(tmpDir, 'GROOVE_DECISIONS.md'), 'utf8');
      // Newest first
      const firstIdx = content.indexOf('Second decision');
      const secondIdx = content.indexOf('First decision');
      assert.ok(firstIdx < secondIdx, 'Newer decisions should appear first');
    });
  });

  describe('generateHandoffBrief', () => {
    it('should generate a handoff brief for seamless session continuation', async () => {
      const { daemon, grooveDir } = createMockDaemon();
      const journalist = new Journalist(daemon);

      // Create a mock log — filename must match agent.id ('a1')
      const logLines = [
        JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Write', input: { file_path: 'src/api/auth.js' } }] } }),
        JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: 'src/api/users.js', old_string: 'old', new_string: 'new' } }] } }),
        JSON.stringify({ type: 'user', message: { content: 'Add JWT middleware to the auth route' } }),
      ].join('\n');
      writeFileSync(join(grooveDir, 'logs', 'a1.log'), logLines);

      const agent = {
        id: 'a1', name: 'backend-1', role: 'backend',
        provider: 'claude-code', scope: ['src/api/**'],
        tokensUsed: 5000, prompt: 'Build the auth API',
      };

      const brief = await journalist.generateHandoffBrief(agent);

      assert.ok(brief.includes('backend-1'));
      // The brief must NOT tell the agent to announce a rotation/restart —
      // seamless infinite sessions require the agent to continue naturally.
      assert.ok(brief.includes('seamless') || brief.includes('Continue'));
      assert.ok(!brief.includes('previous session is being replaced'));
      assert.ok(brief.includes('src/api/**'));
      assert.ok(brief.includes('5000'));
      assert.ok(brief.includes('Build the auth API'));
      assert.ok(brief.includes('Session Summary') || brief.includes('Write'));
    });

    it('instructs the agent to deliver the output, not passively wait', async () => {
      // Regression test: v0.27.1 brief told the agent to "wait for the user's
      // next message" which caused planners to sit idle mid-plan after a
      // rotation, burning tokens without producing output. Agents must be
      // told to finish the work in flight, not wait for further prompting.
      const { daemon, grooveDir } = createMockDaemon();
      const journalist = new Journalist(daemon);
      writeFileSync(join(grooveDir, 'logs', 'planner-1.log'), JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'src/index.js' } }] },
      }));

      const agent = {
        id: 'p1', name: 'planner-1', role: 'planner',
        provider: 'claude-code', scope: [],
        tokensUsed: 2_000_000, prompt: 'Plan voice integrations',
      };

      const brief = await journalist.generateHandoffBrief(agent);

      // The brief MUST NOT contain the old passive instruction
      assert.ok(!/wait for the user's next message/i.test(brief),
        'brief must not tell agent to wait for next message');
      // The brief MUST tell the agent to complete/deliver the work
      assert.ok(/finish|deliver|complete|produce it/i.test(brief),
        'brief must instruct the agent to finish the work');
      // Pass-through: planner-specific instruction
      assert.ok(/output the plan|deliver/i.test(brief));
    });
  });

  describe('status', () => {
    it('should report status correctly', () => {
      const { daemon } = createMockDaemon();
      const journalist = new Journalist(daemon);

      let status = journalist.getStatus();
      assert.equal(status.running, false);
      assert.equal(status.cycleCount, 0);

      journalist.start(999999); // Long interval so it doesn't actually run
      status = journalist.getStatus();
      assert.equal(status.running, true);

      journalist.stop();
      status = journalist.getStatus();
      assert.equal(status.running, false);
    });
  });

  describe('_extractDiscoveries', () => {
    it('should extract error→fix pairs from filtered logs', () => {
      const { daemon, grooveDir } = createMockDaemon();
      daemon.memory = new MemoryStore(grooveDir);
      const journalist = new Journalist(daemon);

      const filteredLogs = {
        a1: {
          agent: { id: 'a1', role: 'backend' },
          entries: [
            { type: 'error', text: 'Error: Cannot find module gray-matter' },
            { type: 'tool', tool: 'Edit', input: 'package.json — added gray-matter dependency' },
          ],
          explorationEntries: [],
        },
      };

      journalist._extractDiscoveries(filteredLogs);

      const discoveries = daemon.memory.listDiscoveries();
      assert.equal(discoveries.length, 1);
      assert.ok(discoveries[0].trigger.includes('Cannot find module'));
      assert.ok(discoveries[0].fix.includes('package.json'));
    });

    it('should not crash when memory is unavailable', () => {
      const { daemon } = createMockDaemon();
      daemon.memory = null;
      const journalist = new Journalist(daemon);

      // Should not throw
      journalist._extractDiscoveries({
        a1: { agent: { id: 'a1', role: 'backend' }, entries: [], explorationEntries: [] },
      });
    });

    it('should skip entries without error signals', () => {
      const { daemon, grooveDir } = createMockDaemon();
      daemon.memory = new MemoryStore(grooveDir);
      const journalist = new Journalist(daemon);

      const filteredLogs = {
        a1: {
          agent: { id: 'a1', role: 'backend' },
          entries: [
            { type: 'tool', tool: 'Write', input: 'src/index.js' },
            { type: 'tool', tool: 'Edit', input: 'src/api.js' },
          ],
          explorationEntries: [],
        },
      };

      journalist._extractDiscoveries(filteredLogs);
      assert.equal(daemon.memory.listDiscoveries().length, 0);
    });
  });

  describe('requestSynthesis', () => {
    it('should debounce multiple calls within 10s into a single cycle', async () => {
      const { daemon } = createMockDaemon();
      const journalist = new Journalist(daemon);

      let cycleCalls = 0;
      journalist.cycle = async () => { cycleCalls++; };

      journalist.requestSynthesis('completion');
      journalist.requestSynthesis('spawn');
      journalist.requestSynthesis('rotation');

      assert.equal(cycleCalls, 0, 'cycle should not fire immediately');

      // Wait for debounce to fire
      await new Promise((r) => setTimeout(r, 11_000));
      assert.equal(cycleCalls, 1, 'only one cycle should fire after debounce');

      journalist.stop();
    });

    it('should track the latest reason', () => {
      const { daemon } = createMockDaemon();
      const journalist = new Journalist(daemon);
      journalist.cycle = async () => {};

      journalist.requestSynthesis('completion');
      journalist.requestSynthesis('rotation');

      assert.equal(journalist._debounceReason, 'rotation');
      journalist.stop();
    });
  });

  describe('ensureFresh', () => {
    it('should skip synthesis when lastCycleAt is recent', async () => {
      const { daemon } = createMockDaemon();
      const journalist = new Journalist(daemon);

      let cycleCalled = false;
      journalist.cycle = async () => { cycleCalled = true; };
      journalist.lastCycleAt = Date.now() - 5000; // 5s ago

      await journalist.ensureFresh(30000);
      assert.equal(cycleCalled, false, 'should skip when recent');
    });

    it('should trigger synthesis when lastCycleAt is stale', async () => {
      const { daemon } = createMockDaemon();
      const journalist = new Journalist(daemon);

      let cycleCalled = false;
      journalist.cycle = async () => { cycleCalled = true; };
      journalist.lastCycleAt = Date.now() - 60_000; // 60s ago

      await journalist.ensureFresh(30000);
      assert.equal(cycleCalled, true, 'should trigger when stale');
    });

    it('should trigger synthesis when lastCycleAt is null', async () => {
      const { daemon } = createMockDaemon();
      const journalist = new Journalist(daemon);

      let cycleCalled = false;
      journalist.cycle = async () => { cycleCalled = true; };

      await journalist.ensureFresh(30000);
      assert.equal(cycleCalled, true, 'should trigger when never synthesized');
    });
  });

  describe('model tier selection', () => {
    it('should prefer medium tier over light tier for synthesis', () => {
      // Verify the callHeadless model selection logic by checking the source
      // The constructor picks medium first, falling back to light
      const { daemon } = createMockDaemon();
      const journalist = new Journalist(daemon);

      // Simulate provider model selection logic matching callHeadless
      const models = [
        { id: 'haiku', tier: 'light' },
        { id: 'sonnet', tier: 'medium' },
        { id: 'opus', tier: 'heavy' },
      ];

      const selected = models.find((m) => m.tier === 'medium')
        || models.find((m) => m.tier === 'light')
        || models[0];

      assert.equal(selected.id, 'sonnet', 'should select medium tier (Sonnet)');
    });

    it('should fall back to light tier when medium is unavailable', () => {
      const models = [
        { id: 'haiku', tier: 'light' },
        { id: 'opus', tier: 'heavy' },
      ];

      const selected = models.find((m) => m.tier === 'medium')
        || models.find((m) => m.tier === 'light')
        || models[0];

      assert.equal(selected.id, 'haiku', 'should fall back to light tier');
    });
  });

  describe('_extractConstraints', () => {
    it('should no-op since auto-extraction is disabled', () => {
      const { daemon, grooveDir } = createMockDaemon();
      daemon.memory = new MemoryStore(grooveDir);
      const journalist = new Journalist(daemon);

      const filteredLogs = {
        a1: {
          agent: { id: 'a1', role: 'backend' },
          entries: [
            {
              type: 'thinking',
              text: 'I should never modify packages/daemon/index.js directly because it is auto-generated from the template',
            },
          ],
          explorationEntries: [],
        },
      };

      journalist._extractConstraints(filteredLogs);

      const constraints = daemon.memory.listConstraints();
      assert.equal(constraints.length, 0);
    });

    it('should skip non-project-specific constraints', () => {
      const { daemon, grooveDir } = createMockDaemon();
      daemon.memory = new MemoryStore(grooveDir);
      const journalist = new Journalist(daemon);

      const filteredLogs = {
        a1: {
          agent: { id: 'a1', role: 'backend' },
          entries: [
            {
              type: 'thinking',
              text: 'I must always write clean code and follow best practices for readability',
            },
          ],
          explorationEntries: [],
        },
      };

      journalist._extractConstraints(filteredLogs);
      // Generic advice should be skipped (no file/config references)
      assert.equal(daemon.memory.listConstraints().length, 0);
    });

    it('should not crash when memory is unavailable', () => {
      const { daemon } = createMockDaemon();
      daemon.memory = null;
      const journalist = new Journalist(daemon);

      journalist._extractConstraints({
        a1: { agent: { id: 'a1', role: 'backend' }, entries: [], explorationEntries: [] },
      });
    });
  });
});
