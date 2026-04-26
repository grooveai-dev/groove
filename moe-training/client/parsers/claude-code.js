// FSL-1.1-Apache-2.0 — see LICENSE

import { OBSERVATION_TRUNCATE_HEAD, OBSERVATION_TRUNCATE_TAIL } from '../../shared/constants.js';

function truncateObservation(text) {
  if (!text || typeof text !== 'string') return text;
  const lines = text.split('\n');
  if (lines.length <= OBSERVATION_TRUNCATE_HEAD + OBSERVATION_TRUNCATE_TAIL) return text;
  const head = lines.slice(0, OBSERVATION_TRUNCATE_HEAD);
  const tail = lines.slice(-OBSERVATION_TRUNCATE_TAIL);
  const omitted = lines.length - OBSERVATION_TRUNCATE_HEAD - OBSERVATION_TRUNCATE_TAIL;
  return [...head, `[... ${omitted} lines omitted ...]`, ...tail].join('\n');
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
            results.push({
              type: 'observation',
              content: truncateObservation(resultContent),
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
            results.push({
              type: 'observation',
              content: truncateObservation(resultContent),
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
