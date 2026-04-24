// FSL-1.1-Apache-2.0 — see LICENSE

import { SUPPORTED_PROVIDERS } from '../../shared/constants.js';
import { ClaudeCodeParser } from './claude-code.js';
import { CodexParser } from './codex.js';
import { GeminiParser } from './gemini.js';
import { GrokParser } from './grok.js';

const constructors = {
  'claude-code': ClaudeCodeParser,
  'codex': CodexParser,
  'gemini': GeminiParser,
  'grok': GrokParser,
};

export function getParser(providerName) {
  if (!SUPPORTED_PROVIDERS.includes(providerName)) return null;
  const Ctor = constructors[providerName];
  return Ctor ? new Ctor() : null;
}
