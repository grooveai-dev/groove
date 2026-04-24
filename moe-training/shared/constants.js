// FSL-1.1-Apache-2.0 — see LICENSE

export const CURRENT_CONSENT_VERSION = '1.0';
export const CHUNK_SIZE = 200;
export const CHUNK_TIMEOUT_MS = 300_000;
export const MAX_QUEUE_SIZE = 10_000;
export const OBSERVATION_TRUNCATE_HEAD = 50;
export const OBSERVATION_TRUNCATE_TAIL = 20;
export const SUPPORTED_PROVIDERS = ['claude-code', 'codex', 'gemini'];

export const MODEL_TIERS = {
  'claude-opus-4-6': 5,
  'claude-opus-4-7': 5,
  'claude-sonnet-4-6': 3,
  'gpt-4.5': 5,
  'o3': 5,
  'o4-mini': 2,
  'gemini-2.5-pro': 3,
  'gemini-2.5-flash': 1.5,
};

export const QUALITY_MULTIPLIERS = {
  correction: 10,
  coordination: 5,
  errorRecovery: 3,
  heavyTask: 2,
  highQuality: 1.5,
};

export const CENTRAL_COMMAND_URL = process.env.GROOVE_CENTRAL_URL || 'https://api.groovedev.ai';
