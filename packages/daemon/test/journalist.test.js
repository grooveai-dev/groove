// GROOVE — Journalist Tests
// FSL-1.1-Apache-2.0 — see LICENSE

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Journalist } from '../src/journalist.js';
import { Registry } from '../src/registry.js';
import { StateManager } from '../src/state.js';
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

      const entries = journalist.filterLog(logLine, { name: 'test' });
      assert.equal(entries.length, 1);
      assert.equal(entries[0].type, 'tool');
      assert.equal(entries[0].tool, 'Write');
      assert.equal(entries[0].input, 'src/api/auth.js');
    });

    it('should extract errors from logs', () => {
      const { daemon } = createMockDaemon();
      const journalist = new Journalist(daemon);

      const entries = journalist.filterLog('Error: something broke\nTypeError: undefined is not a function', {});
      assert.equal(entries.length, 2);
      assert.equal(entries[0].type, 'error');
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

      const entries = journalist.filterLog(logLine, {});
      assert.equal(entries.length, 1);
      assert.equal(entries[0].type, 'result');
      assert.ok(entries[0].text.includes('Task completed'));
      assert.equal(entries[0].turns, 5);
    });

    it('should skip empty and GROOVE header lines', () => {
      const { daemon } = createMockDaemon();
      const journalist = new Journalist(daemon);

      const entries = journalist.filterLog(
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
    it('should generate a handoff brief for context rotation', async () => {
      const { daemon, grooveDir } = createMockDaemon();
      const journalist = new Journalist(daemon);

      // Create a mock log
      const logLine = JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', name: 'Write', input: { file_path: 'src/api/auth.js' } },
          ],
        },
      });
      writeFileSync(join(grooveDir, 'logs', 'backend-1.log'), logLine);

      const agent = {
        id: 'a1', name: 'backend-1', role: 'backend',
        provider: 'claude-code', scope: ['src/api/**'],
        tokensUsed: 5000, prompt: 'Build the auth API',
      };

      const brief = await journalist.generateHandoffBrief(agent);

      assert.ok(brief.includes('backend-1'));
      assert.ok(brief.includes('context rotation'));
      assert.ok(brief.includes('src/api/**'));
      assert.ok(brief.includes('5000'));
      assert.ok(brief.includes('Build the auth API'));
      assert.ok(brief.includes('Write'));
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
});
