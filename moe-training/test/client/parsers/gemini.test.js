// FSL-1.1-Apache-2.0 — see LICENSE

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GeminiParser } from '../../../client/parsers/gemini.js';

describe('GeminiParser', () => {
  it('parses thought content type as thought', () => {
    const parser = new GeminiParser();
    const result = parser.parseEvent({
      type: 'message',
      role: 'model',
      content: [{ type: 'thought', thought: 'I should check the imports' }],
    });
    assert.equal(result.type, 'thought');
    assert.equal(result.content, 'I should check the imports');
  });

  it('parses model text message as thought', () => {
    const parser = new GeminiParser();
    const result = parser.parseEvent({
      type: 'message',
      role: 'model',
      content: [{ text: 'Let me look at that file' }],
    });
    assert.equal(result.type, 'thought');
    assert.equal(result.content, 'Let me look at that file');
  });

  it('skips user messages', () => {
    const parser = new GeminiParser();
    const result = parser.parseEvent({
      type: 'message',
      role: 'user',
      content: [{ text: 'fix the bug' }],
    });
    assert.equal(result, null);
  });

  it('parses tool_request as action', () => {
    const parser = new GeminiParser();
    const result = parser.parseEvent({
      type: 'tool_request',
      name: 'Grep',
      args: { pattern: 'TODO' },
    });
    assert.equal(result.type, 'action');
    assert.equal(result.tool, 'Grep');
    assert.deepEqual(result.arguments, { pattern: 'TODO' });
  });

  it('parses tool_response as observation', () => {
    const parser = new GeminiParser();
    const result = parser.parseEvent({
      type: 'tool_response',
      content: 'Found 3 matches',
    });
    assert.equal(result.type, 'observation');
    assert.equal(result.content, 'Found 3 matches');
    assert.equal(result.truncated, false);
    assert.equal(typeof result.original_token_count, 'number');
  });

  it('parses error event', () => {
    const parser = new GeminiParser();
    const result = parser.parseEvent({
      type: 'error',
      message: 'Rate limit exceeded',
    });
    assert.equal(result.type, 'error');
    assert.equal(result.content, 'Rate limit exceeded');
  });

  it('parses agent_end as resolution', () => {
    const parser = new GeminiParser();
    const result = parser.parseEvent({ type: 'agent_end' });
    assert.equal(result.type, 'resolution');
  });

  it('extracts tokens from usage event', () => {
    const parser = new GeminiParser();
    const tokens = parser.extractTokens({
      type: 'usage',
      inputTokens: 300,
      outputTokens: 150,
      cachedTokens: 50,
    });
    assert.deepEqual(tokens, { input: 300, output: 150, cacheRead: 50, cacheCreation: 0 });
  });

  it('returns null for non-usage token extraction', () => {
    const parser = new GeminiParser();
    assert.equal(parser.extractTokens({ type: 'message' }), null);
  });

  it('extracts session id from agent_start', () => {
    const parser = new GeminiParser();
    assert.equal(parser.extractSessionId({ type: 'agent_start', streamId: 'stream-456' }), 'stream-456');
    assert.equal(parser.extractSessionId({ type: 'message' }), null);
  });
});
