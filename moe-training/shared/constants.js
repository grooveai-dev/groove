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
  'gpt-5.5': 5,
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

// Hard ceiling on step.content, shared by the client trimmer (envelope-builder)
// and the ingest validator (envelope-schema). These MUST stay equal: the
// validator rejects the whole envelope when exceeded, which drops the entire
// session — so the client must trim to exactly this before building.
export const MAX_STEP_CONTENT_CHARS = 100_000;
export const MAX_TOKEN_COUNT = 100_000;

// Per-observation budget, in estimated tokens (~4 chars/token). Kept safely
// under MAX_STEP_CONTENT_CHARS so a parser-truncated observation plus its
// "[TRUNCATED …]" suffix still fits without a second trim downstream.
export const OBSERVATION_TOKEN_LIMIT = 24_000;
export const TIER_A_MIN_QUALITY = 70;
export const TIER_B_MIN_QUALITY = 50;
export const TRAINING_MIN_STEPS = 5;
export const TRAINING_MIN_TOKENS = 500;
export const TRAINING_MIN_DURATION = 10;
export const TRAINING_EXCLUSION_REASONS = ['too_few_steps', 'no_actions', 'no_observations', 'insufficient_tokens', 'too_short'];

export const USER_MESSAGE_MAX_CHARS = 2000;

export const CENTRAL_COMMAND_URL = process.env.GROOVE_CENTRAL_URL || 'https://api.groovedev.ai';
export const EMBEDDING_SERVICE_URL = process.env.EMBEDDING_SERVICE_URL || `${CENTRAL_COMMAND_URL}/v1/embed`;
