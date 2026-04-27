// FSL-1.1-Apache-2.0 — see LICENSE

import { OBSERVATION_TOKEN_LIMIT } from '../../shared/constants.js';

function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

function truncateObservation(text) {
  if (!text || typeof text !== 'string') return { content: text, truncated: false, original_token_count: estimateTokens(text) };
  const originalTokens = estimateTokens(text);
  if (originalTokens <= OBSERVATION_TOKEN_LIMIT) {
    return { content: text, truncated: false, original_token_count: originalTokens };
  }
  const charLimit = OBSERVATION_TOKEN_LIMIT * 4;
  const truncated = text.slice(0, charLimit) + `\n[TRUNCATED — original output was ${originalTokens} tokens]`;
  return { content: truncated, truncated: true, original_token_count: originalTokens };
}

export class ClaudeCodeParser {
  constructor() {
    this._pendingToolUse = new Map();
  }

  parseEvent(jsonEvent) {
    if (!jsonEvent || !jsonEvent.type) return null;

    if (jsonEvent.type === 'assistant') {
      const contentBlocks = jsonEvent.message?.content;
      if (!Array.isArray(contentBlocks)) return null;

      const results = [];
      for (const block of contentBlocks) {
        if (block.type === 'text') {
          results.push({
            type: 'thought',
            content: block.text || '',
          });
        } else if (block.type === 'tool_use') {
          this._pendingToolUse.set(block.id, block);
          results.push({
            type: 'action',
            tool: block.name,
            arguments: block.input,
            content: `Using ${block.name}`,
          });
        } else if (block.type === 'tool_result') {
          const toolUse = this._pendingToolUse.get(block.tool_use_id);
          if (toolUse) this._pendingToolUse.delete(block.tool_use_id);

          const resultContent = Array.isArray(block.content)
            ? block.content.map((c) => c.text || '').join('\n')
            : (typeof block.content === 'string' ? block.content : '');

          if (block.is_error) {
            results.push({ type: 'error', content: resultContent, is_error: true });
          } else {
            const obs = truncateObservation(resultContent);
            results.push({
              type: 'observation',
              content: obs.content,
              truncated: obs.truncated,
              original_token_count: obs.original_token_count,
              is_error: false,
            });
          }
        }
      }

      return results.length === 1 ? results[0] : results.length > 1 ? results : null;
    }

    if (jsonEvent.type === 'user') {
      const contentBlocks = jsonEvent.message?.content;
      if (!Array.isArray(contentBlocks)) return null;

      const results = [];
      for (const block of contentBlocks) {
        if (block.type === 'tool_result') {
          const toolUse = this._pendingToolUse.get(block.tool_use_id);
          if (toolUse) this._pendingToolUse.delete(block.tool_use_id);

          const resultContent = Array.isArray(block.content)
            ? block.content.map((c) => c.text || '').join('\n')
            : (typeof block.content === 'string' ? block.content : '');

          if (block.is_error) {
            results.push({
              type: 'error',
              content: resultContent,
              is_error: true,
              tool: toolUse?.name,
            });
          } else {
            const obs = truncateObservation(resultContent);
            results.push({
              type: 'observation',
              content: obs.content,
              truncated: obs.truncated,
              original_token_count: obs.original_token_count,
              is_error: false,
              tool: toolUse?.name,
            });
          }
        }
      }

      return results.length === 1 ? results[0] : results.length > 1 ? results : null;
    }

    if (jsonEvent.type === 'result') {
      return {
        type: 'resolution',
        content: typeof jsonEvent.result === 'string' ? jsonEvent.result : JSON.stringify(jsonEvent.result),
      };
    }

    return null;
  }

  extractTokens(jsonEvent) {
    if (!jsonEvent) return null;
    if (jsonEvent.type === 'assistant') {
      const usage = jsonEvent.message?.usage;
      if (!usage) return null;
      return {
        input: usage.input_tokens || 0,
        output: usage.output_tokens || 0,
        cacheRead: usage.cache_read_input_tokens || 0,
        cacheCreation: usage.cache_creation_input_tokens || 0,
      };
    }
    if (jsonEvent.type === 'result') {
      return {
        input: jsonEvent.total_input_tokens || 0,
        output: jsonEvent.total_output_tokens || 0,
        cacheRead: 0,
        cacheCreation: 0,
      };
    }
    return null;
  }

  extractSessionId(jsonEvent) {
    return jsonEvent?.session_id || null;
  }

  extractModel(jsonEvent) {
    if (jsonEvent?.type === 'assistant') {
      return jsonEvent.message?.model || null;
    }
    return null;
  }
}
