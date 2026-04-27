// FSL-1.1-Apache-2.0 — see LICENSE

import { OBSERVATION_TOKEN_LIMIT } from '../../shared/constants.js';

function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

function truncateObservation(text) {
  if (!text || typeof text !== 'string') return { content: text || '', truncated: false, original_token_count: estimateTokens(text) };
  const originalTokens = estimateTokens(text);
  if (originalTokens <= OBSERVATION_TOKEN_LIMIT) {
    return { content: text, truncated: false, original_token_count: originalTokens };
  }
  const charLimit = OBSERVATION_TOKEN_LIMIT * 4;
  const truncated = text.slice(0, charLimit) + `\n[TRUNCATED — original output was ${originalTokens} tokens]`;
  return { content: truncated, truncated: true, original_token_count: originalTokens };
}

export class CodexParser {
  constructor() {
    this._sessionId = null;
  }

  parseEvent(jsonEvent) {
    if (!jsonEvent || !jsonEvent.type) return null;

    switch (jsonEvent.type) {
      case 'thread.started': {
        this._sessionId = jsonEvent.thread_id || null;
        return null;
      }

      case 'item.started': {
        const item = jsonEvent.item || {};
        if (item.type === 'agent_message') {
          return { type: 'thought', content: item.text || '' };
        }
        if (item.type === 'command_execution') {
          return { type: 'action', tool: 'command_execution', arguments: { command: item.command }, content: `Executing: ${item.command || ''}` };
        }
        if (item.type === 'file_edit' || item.type === 'file_write') {
          return { type: 'action', tool: item.type, arguments: { path: item.path || item.file || '' }, content: `${item.type}: ${item.path || item.file || ''}` };
        }
        if (item.type === 'file_read') {
          return { type: 'action', tool: 'file_read', arguments: { path: item.path || item.file || '' }, content: `Reading: ${item.path || item.file || ''}` };
        }
        return null;
      }

      case 'item.completed': {
        const item = jsonEvent.item || {};
        if (item.type === 'agent_message') {
          return { type: 'thought', content: item.text || '' };
        }
        if (item.type === 'command_execution') {
          const rawOutput = item.aggregated_output || '';
          if (item.exit_code !== 0) {
            return { type: 'error', content: rawOutput.slice(0, 2000) || `Exit code: ${item.exit_code}` };
          }
          const obs = truncateObservation(rawOutput);
          return { type: 'observation', content: obs.content, truncated: obs.truncated, original_token_count: obs.original_token_count };
        }
        if (item.type === 'file_edit' || item.type === 'file_write' || item.type === 'file_read') {
          const rawOutput = item.output || item.content || '';
          const obs = truncateObservation(rawOutput);
          return { type: 'observation', content: obs.content, truncated: obs.truncated, original_token_count: obs.original_token_count };
        }
        return null;
      }

      case 'turn.completed': {
        return { type: 'resolution', content: '' };
      }

      default:
        return null;
    }
  }

  extractTokens(jsonEvent) {
    if (!jsonEvent) return null;
    const usage = jsonEvent.usage || jsonEvent.item?.usage;
    if (!usage) return null;
    return {
      input: usage.input_tokens || 0,
      output: usage.output_tokens || 0,
      cacheRead: 0,
      cacheCreation: 0,
    };
  }

  extractSessionId(jsonEvent) {
    if (jsonEvent?.type === 'thread.started') {
      return jsonEvent.thread_id || null;
    }
    return null;
  }
}
