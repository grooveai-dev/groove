// FSL-1.1-Apache-2.0 — see LICENSE

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ClaudeCodeParser } from '../../../client/parsers/claude-code.js';
import { PIIScrubber } from '../../../client/scrubber.js';
import { OBSERVATION_TOKEN_LIMIT } from '../../../shared/constants.js';

function makeToolUseEvent(id, name, input) {
  return {
    type: 'assistant',
    message: {
      content: [{ type: 'tool_use', id, name, input }],
      usage: {},
    },
  };
}

function makeUserToolResult(toolUseId, content, isError = false) {
  return {
    type: 'user',
    message: {
      content: [{ type: 'tool_result', tool_use_id: toolUseId, content, is_error: isError }],
    },
  };
}

describe('ClaudeCodeParser', () => {
  it('parses assistant message as thought', () => {
    const parser = new ClaudeCodeParser();
    const event = {
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: 'I need to fix the bug' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      },
    };
    const result = parser.parseEvent(event);
    assert.equal(result.type, 'thought');
    assert.equal(result.content, 'I need to fix the bug');
    assert.equal(result.token_count, undefined);
  });

  it('parses tool_use block as action', () => {
    const parser = new ClaudeCodeParser();
    const event = {
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', id: 'tu_1', name: 'Read', input: { file_path: '/test.js' } }],
        usage: { output_tokens: 10 },
      },
    };
    const result = parser.parseEvent(event);
    assert.equal(result.type, 'action');
    assert.equal(result.tool, 'Read');
    assert.deepEqual(result.arguments, { file_path: '/test.js' });
  });

  it('parses result event as resolution', () => {
    const parser = new ClaudeCodeParser();
    const event = { type: 'result', result: 'Task completed successfully', total_tokens_used: 500 };
    const result = parser.parseEvent(event);
    assert.equal(result.type, 'resolution');
    assert.equal(result.content, 'Task completed successfully');
    assert.equal(result.token_count, undefined);
  });

  it('extracts tokens from assistant event', () => {
    const parser = new ClaudeCodeParser();
    const event = {
      type: 'assistant',
      message: {
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_read_input_tokens: 30,
          cache_creation_input_tokens: 10,
        },
      },
    };
    const tokens = parser.extractTokens(event);
    assert.deepEqual(tokens, { input: 100, output: 50, cacheRead: 30, cacheCreation: 10 });
  });

  it('extracts session id', () => {
    const parser = new ClaudeCodeParser();
    assert.equal(parser.extractSessionId({ session_id: 'sess-abc' }), 'sess-abc');
    assert.equal(parser.extractSessionId({}), null);
  });

  it('extracts model from assistant event', () => {
    const parser = new ClaudeCodeParser();
    assert.equal(parser.extractModel({ type: 'assistant', message: { model: 'claude-opus-4-6' } }), 'claude-opus-4-6');
    assert.equal(parser.extractModel({ type: 'result' }), null);
  });

  it('returns null for unknown event types', () => {
    const parser = new ClaudeCodeParser();
    assert.equal(parser.parseEvent({ type: 'system' }), null);
    assert.equal(parser.parseEvent(null), null);
  });

  describe('observation steps from user events', () => {
    it('emits observation for Bash tool result', () => {
      const parser = new ClaudeCodeParser();
      parser.parseEvent(makeToolUseEvent('tu_bash', 'Bash', { command: 'ls -la' }));

      const result = parser.parseEvent(makeUserToolResult('tu_bash', 'file1.js\nfile2.js'));
      assert.equal(result.type, 'observation');
      assert.equal(result.content, 'file1.js\nfile2.js');
      assert.equal(result.is_error, false);
      assert.equal(result.tool, 'Bash');
      assert.equal(result.truncated, false);
      assert.equal(result.original_token_count, Math.ceil('file1.js\nfile2.js'.length / 4));
    });

    it('emits observation for Read tool result', () => {
      const parser = new ClaudeCodeParser();
      parser.parseEvent(makeToolUseEvent('tu_read', 'Read', { file_path: '/src/index.js' }));

      const result = parser.parseEvent(makeUserToolResult('tu_read', 'const x = 1;'));
      assert.equal(result.type, 'observation');
      assert.equal(result.content, 'const x = 1;');
      assert.equal(result.tool, 'Read');
    });

    it('emits observation for Edit tool result', () => {
      const parser = new ClaudeCodeParser();
      parser.parseEvent(makeToolUseEvent('tu_edit', 'Edit', { file_path: '/src/app.js' }));

      const result = parser.parseEvent(makeUserToolResult('tu_edit', 'Edit applied successfully'));
      assert.equal(result.type, 'observation');
      assert.equal(result.content, 'Edit applied successfully');
      assert.equal(result.tool, 'Edit');
    });

    it('emits error for failed tool result', () => {
      const parser = new ClaudeCodeParser();
      parser.parseEvent(makeToolUseEvent('tu_fail', 'Bash', { command: 'cat /nonexistent' }));

      const result = parser.parseEvent(makeUserToolResult('tu_fail', 'cat: /nonexistent: No such file or directory', true));
      assert.equal(result.type, 'error');
      assert.equal(result.is_error, true);
      assert.equal(result.tool, 'Bash');
      assert.match(result.content, /No such file or directory/);
    });

    it('handles array content in tool_result blocks', () => {
      const parser = new ClaudeCodeParser();
      parser.parseEvent(makeToolUseEvent('tu_arr', 'Grep', { pattern: 'TODO' }));

      const event = {
        type: 'user',
        message: {
          content: [{
            type: 'tool_result',
            tool_use_id: 'tu_arr',
            content: [{ type: 'text', text: 'src/a.js:1:TODO fix' }, { type: 'text', text: 'src/b.js:5:TODO refactor' }],
            is_error: false,
          }],
        },
      };
      const result = parser.parseEvent(event);
      assert.equal(result.type, 'observation');
      assert.equal(result.content, 'src/a.js:1:TODO fix\nsrc/b.js:5:TODO refactor');
    });

    it('handles multiple tool_result blocks in one user event', () => {
      const parser = new ClaudeCodeParser();
      parser.parseEvent(makeToolUseEvent('tu_m1', 'Read', { file_path: '/a.js' }));
      parser.parseEvent(makeToolUseEvent('tu_m2', 'Read', { file_path: '/b.js' }));

      const event = {
        type: 'user',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 'tu_m1', content: 'content of a', is_error: false },
            { type: 'tool_result', tool_use_id: 'tu_m2', content: 'content of b', is_error: false },
          ],
        },
      };
      const results = parser.parseEvent(event);
      assert.ok(Array.isArray(results));
      assert.equal(results.length, 2);
      assert.equal(results[0].type, 'observation');
      assert.equal(results[0].tool, 'Read');
      assert.equal(results[1].type, 'observation');
      assert.equal(results[1].tool, 'Read');
    });

    it('returns null for user event without tool_result blocks', () => {
      const parser = new ClaudeCodeParser();
      const result = parser.parseEvent({
        type: 'user',
        message: { content: [{ type: 'text', text: 'user said something' }] },
      });
      assert.equal(result, null);
    });

    it('returns null for user event with non-array content', () => {
      const parser = new ClaudeCodeParser();
      assert.equal(parser.parseEvent({ type: 'user', message: { content: 'just text' } }), null);
      assert.equal(parser.parseEvent({ type: 'user', message: {} }), null);
    });

    it('cleans up _pendingToolUse after matching result', () => {
      const parser = new ClaudeCodeParser();
      parser.parseEvent(makeToolUseEvent('tu_clean', 'Bash', { command: 'echo hi' }));
      assert.equal(parser._pendingToolUse.size, 1);

      parser.parseEvent(makeUserToolResult('tu_clean', 'hi'));
      assert.equal(parser._pendingToolUse.size, 0);
    });

    it('handles unmatched tool_result (no prior tool_use)', () => {
      const parser = new ClaudeCodeParser();
      const result = parser.parseEvent(makeUserToolResult('tu_orphan', 'some output'));
      assert.equal(result.type, 'observation');
      assert.equal(result.tool, undefined);
    });
  });

  describe('observation truncation', () => {
    it('truncates observation exceeding token limit', () => {
      const parser = new ClaudeCodeParser();
      parser.parseEvent(makeToolUseEvent('tu_long', 'Bash', { command: 'cat bigfile' }));

      const charLimit = OBSERVATION_TOKEN_LIMIT * 4;
      const longContent = 'x'.repeat(charLimit + 1000);

      const result = parser.parseEvent(makeUserToolResult('tu_long', longContent));
      assert.equal(result.type, 'observation');
      assert.equal(result.truncated, true);
      assert.ok(result.original_token_count > OBSERVATION_TOKEN_LIMIT);
      assert.match(result.content, /\[TRUNCATED/);
      assert.ok(result.content.length <= charLimit + 100);
    });

    it('does not truncate short observation content', () => {
      const parser = new ClaudeCodeParser();
      parser.parseEvent(makeToolUseEvent('tu_short', 'Bash', { command: 'echo hi' }));

      const shortContent = 'line 1\nline 2\nline 3';
      const result = parser.parseEvent(makeUserToolResult('tu_short', shortContent));
      assert.equal(result.content, shortContent);
      assert.equal(result.truncated, false);
      assert.equal(result.original_token_count, Math.ceil(shortContent.length / 4));
    });

    it('does not truncate errors', () => {
      const parser = new ClaudeCodeParser();
      parser.parseEvent(makeToolUseEvent('tu_err_long', 'Bash', { command: 'bad' }));

      const longError = 'x'.repeat(20000);
      const result = parser.parseEvent(makeUserToolResult('tu_err_long', longError, true));
      assert.equal(result.type, 'error');
      assert.equal(result.content, longError);
      assert.equal(result.truncated, undefined);
    });
  });

  describe('scrubber integration', () => {
    it('observation content is scrubber-compatible (string format)', () => {
      const parser = new ClaudeCodeParser();
      parser.parseEvent(makeToolUseEvent('tu_scrub', 'Bash', { command: 'env' }));

      const result = parser.parseEvent(makeUserToolResult('tu_scrub', 'API_KEY=sk_test_abc123def456ghi789'));
      assert.equal(typeof result.content, 'string');

      const scrubber = new PIIScrubber();
      const scrubbed = scrubber.scrub(result.content);
      assert.match(scrubbed, /\[API_KEY\]/);
      assert.ok(!scrubbed.includes('sk_test_abc123def456ghi789'));
    });

    it('scrubber handles observation with email addresses', () => {
      const parser = new ClaudeCodeParser();
      parser.parseEvent(makeToolUseEvent('tu_email', 'Bash', { command: 'git log' }));

      const result = parser.parseEvent(makeUserToolResult('tu_email', 'Author: user@example.com'));
      const scrubber = new PIIScrubber();
      const scrubbed = scrubber.scrub(result.content);
      assert.match(scrubbed, /\[EMAIL\]/);
    });
  });

  describe('full ReAct loop', () => {
    it('produces thought → action → observation → thought sequence', () => {
      const parser = new ClaudeCodeParser();
      const steps = [];

      // Thought + action (assistant event with text and tool_use)
      const assistantEvent = {
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'Let me check the file' },
            { type: 'tool_use', id: 'tu_react', name: 'Read', input: { file_path: '/src/app.js' } },
          ],
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      };
      const parsed1 = parser.parseEvent(assistantEvent);
      const events1 = Array.isArray(parsed1) ? parsed1 : [parsed1];
      steps.push(...events1);

      // Observation (user event with tool_result)
      const parsed2 = parser.parseEvent(makeUserToolResult('tu_react', 'const app = express();'));
      const events2 = Array.isArray(parsed2) ? parsed2 : [parsed2];
      steps.push(...events2);

      // Next thought (assistant event)
      const parsed3 = parser.parseEvent({
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'I see the Express setup, now let me fix it' }],
          usage: { input_tokens: 200, output_tokens: 60 },
        },
      });
      steps.push(parsed3);

      assert.equal(steps.length, 4);
      assert.equal(steps[0].type, 'thought');
      assert.equal(steps[1].type, 'action');
      assert.equal(steps[2].type, 'observation');
      assert.equal(steps[3].type, 'thought');
    });
  });
});
