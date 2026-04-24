// FSL-1.1-Apache-2.0 — see LICENSE

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ClaudeCodeParser } from '../../../client/parsers/claude-code.js';

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
    assert.equal(result.token_count, 50);
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

  it('parses tool_result as observation', () => {
    const parser = new ClaudeCodeParser();
    // First register a tool use
    parser.parseEvent({
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', id: 'tu_2', name: 'Read', input: {} }],
        usage: {},
      },
    });
    // Then parse result
    const event = {
      type: 'assistant',
      message: {
        content: [{ type: 'tool_result', tool_use_id: 'tu_2', content: 'file contents here', is_error: false }],
        usage: {},
      },
    };
    const result = parser.parseEvent(event);
    assert.equal(result.type, 'observation');
    assert.equal(result.content, 'file contents here');
    assert.equal(result.is_error, false);
  });

  it('parses error tool_result as error', () => {
    const parser = new ClaudeCodeParser();
    const event = {
      type: 'assistant',
      message: {
        content: [{ type: 'tool_result', tool_use_id: 'tu_3', content: 'Permission denied', is_error: true }],
        usage: {},
      },
    };
    const result = parser.parseEvent(event);
    assert.equal(result.type, 'error');
    assert.equal(result.is_error, true);
  });

  it('parses result event as resolution', () => {
    const parser = new ClaudeCodeParser();
    const event = { type: 'result', result: 'Task completed successfully', total_tokens_used: 500 };
    const result = parser.parseEvent(event);
    assert.equal(result.type, 'resolution');
    assert.equal(result.content, 'Task completed successfully');
    assert.equal(result.token_count, 500);
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
});
