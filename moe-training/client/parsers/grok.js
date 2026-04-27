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

export class GrokParser {
  // TODO: Grok agentic CLI not yet available. Wire up when headless CLI is built.
  parseEvent(_jsonEvent) {
    return null;
  }

  extractTokens(_jsonEvent) {
    return null;
  }

  extractSessionId(_jsonEvent) {
    return null;
  }
}
