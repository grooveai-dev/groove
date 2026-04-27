// GROOVE — Codex Provider Tests
// FSL-1.1-Apache-2.0 — see LICENSE

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CodexProvider } from '../src/providers/codex.js';

describe('CodexProvider', () => {
  it('allows context rotation during active Codex sessions', () => {
    assert.equal(CodexProvider.singleTask, false);
  });

  it('uses one-million token context windows for GPT-5.x models', () => {
    const gpt5Models = CodexProvider.models.filter((model) => model.id.startsWith('gpt-5'));

    assert.ok(gpt5Models.length > 0);
    for (const model of gpt5Models) {
      assert.equal(model.maxContext, 1000000, model.id);
    }
  });

  it('emits non-zero intermediate context usage from item output estimates', () => {
    const provider = new CodexProvider();
    provider.buildSpawnCommand({
      model: 'gpt-5.4',
      introContext: 'x'.repeat(400),
      prompt: 'Build something useful',
    });

    const result = provider.parseOutput(JSON.stringify({
      type: 'item.completed',
      item: {
        type: 'command_execution',
        id: 'exec-1',
        command: 'printf hello',
        aggregated_output: 'y'.repeat(800),
      },
    }));

    assert.equal(result.type, 'activity');
    assert.ok(result.contextUsage > 0);
    assert.equal(result.contextUsage, (provider._initialPromptTokens + provider._accumulatedOutputTokens * 2) / 1000000);
  });

  it('uses real turn usage when Codex reports final token counts', () => {
    const provider = new CodexProvider();
    provider.buildSpawnCommand({ model: 'gpt-5.4', prompt: 'Test real usage' });

    const result = provider.parseOutput(JSON.stringify({
      type: 'turn.completed',
      usage: {
        input_tokens: 765000,
        output_tokens: 1000,
        cached_input_tokens: 5000,
        output_tokens_details: { reasoning_tokens: 250 },
      },
    }));

    assert.equal(result.contextUsage, 0.765);
    assert.equal(result.inputTokens, 765000);
    assert.equal(result.cacheReadTokens, 5000);
  });
});
