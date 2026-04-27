// FSL-1.1-Apache-2.0 — see LICENSE

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CodexParser } from '../../../client/parsers/codex.js';

describe('CodexParser', () => {
  it('parses item.started agent_message as thought', () => {
    const parser = new CodexParser();
    const result = parser.parseEvent({
      type: 'item.started',
      item: { type: 'agent_message', text: 'Let me analyze this' },
    });
    assert.equal(result.type, 'thought');
    assert.equal(result.content, 'Let me analyze this');
  });

  it('parses item.started command_execution as action', () => {
    const parser = new CodexParser();
    const result = parser.parseEvent({
      type: 'item.started',
      item: { type: 'command_execution', command: 'ls -la' },
    });
    assert.equal(result.type, 'action');
    assert.equal(result.tool, 'command_execution');
    assert.deepEqual(result.arguments, { command: 'ls -la' });
  });

  it('parses item.started file_edit as action', () => {
    const parser = new CodexParser();
    const result = parser.parseEvent({
      type: 'item.started',
      item: { type: 'file_edit', path: '/src/app.js' },
    });
    assert.equal(result.type, 'action');
    assert.equal(result.tool, 'file_edit');
  });

  it('parses item.completed command_execution as observation', () => {
    const parser = new CodexParser();
    const result = parser.parseEvent({
      type: 'item.completed',
      item: { type: 'command_execution', aggregated_output: 'file1\nfile2', exit_code: 0 },
    });
    assert.equal(result.type, 'observation');
    assert.equal(result.content, 'file1\nfile2');
    assert.equal(result.truncated, false);
    assert.equal(typeof result.original_token_count, 'number');
  });

  it('parses item.completed with error exit code as error', () => {
    const parser = new CodexParser();
    const result = parser.parseEvent({
      type: 'item.completed',
      item: { type: 'command_execution', aggregated_output: 'ENOENT', exit_code: 1 },
    });
    assert.equal(result.type, 'error');
  });

  it('parses turn.completed as resolution', () => {
    const parser = new CodexParser();
    const result = parser.parseEvent({ type: 'turn.completed' });
    assert.equal(result.type, 'resolution');
  });

  it('extracts tokens from usage', () => {
    const parser = new CodexParser();
    const tokens = parser.extractTokens({
      type: 'item.completed',
      usage: { input_tokens: 200, output_tokens: 100 },
    });
    assert.deepEqual(tokens, { input: 200, output: 100, cacheRead: 0, cacheCreation: 0 });
  });

  it('extracts session id from thread.started', () => {
    const parser = new CodexParser();
    assert.equal(parser.extractSessionId({ type: 'thread.started', thread_id: 'th_123' }), 'th_123');
    assert.equal(parser.extractSessionId({ type: 'item.started' }), null);
  });

  it('returns null for unknown event types', () => {
    const parser = new CodexParser();
    assert.equal(parser.parseEvent({ type: 'unknown.event' }), null);
  });
});
