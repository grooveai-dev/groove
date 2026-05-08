// GROOVE — Input Validation
// FSL-1.1-Apache-2.0 — see LICENSE

const NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
const ROLE_PATTERN = /^[a-zA-Z0-9_-]{1,50}$/;
const PROVIDER_PATTERN = /^[a-zA-Z0-9_-]{1,30}$/;
const MAX_PROMPT_LENGTH = 50_000;
const MAX_SCOPE_PATTERNS = 20;
const MAX_SCOPE_LENGTH = 200;

export function validateAgentConfig(config) {
  if (!config || typeof config !== 'object') {
    throw new Error('Invalid agent config');
  }

  if (!config.role || typeof config.role !== 'string') {
    throw new Error('Role is required');
  }
  if (!ROLE_PATTERN.test(config.role)) {
    throw new Error('Invalid role: must be alphanumeric, dash, or underscore (max 50 chars)');
  }

  if (config.name !== undefined && config.name !== null) {
    if (typeof config.name !== 'string' || !NAME_PATTERN.test(config.name)) {
      throw new Error('Invalid name: must be alphanumeric, dash, or underscore (max 64 chars)');
    }
  }

  if (config.provider !== undefined && config.provider !== null) {
    if (typeof config.provider !== 'string' || !PROVIDER_PATTERN.test(config.provider)) {
      throw new Error('Invalid provider name');
    }
  }

  if (config.scope !== undefined && config.scope !== null) {
    if (!Array.isArray(config.scope)) {
      throw new Error('Scope must be an array');
    }
    if (config.scope.length > MAX_SCOPE_PATTERNS) {
      throw new Error(`Too many scope patterns (max ${MAX_SCOPE_PATTERNS})`);
    }
    for (const pattern of config.scope) {
      validateScopePattern(pattern);
    }
  }

  if (config.prompt !== undefined && config.prompt !== null) {
    if (typeof config.prompt !== 'string') {
      throw new Error('Prompt must be a string');
    }
    if (config.prompt.length > MAX_PROMPT_LENGTH) {
      throw new Error(`Prompt too long (max ${MAX_PROMPT_LENGTH} chars)`);
    }
  }

  // Validate permission level
  const validPermissions = ['auto', 'full'];
  const permission = validPermissions.includes(config.permission) ? config.permission : 'full';

  // Validate skills (array of skill IDs)
  let skills = [];
  if (config.skills !== undefined && config.skills !== null) {
    if (!Array.isArray(config.skills)) {
      throw new Error('Skills must be an array');
    }
    skills = config.skills.filter((s) => typeof s === 'string' && s.length > 0 && s.length <= 100);
  }

  // Validate integrations (array of integration IDs)
  let integrations = [];
  if (config.integrations !== undefined && config.integrations !== null) {
    if (!Array.isArray(config.integrations)) {
      throw new Error('Integrations must be an array');
    }
    integrations = config.integrations.filter((s) => typeof s === 'string' && s.length > 0 && s.length <= 100);
  }

  // Validate repos (array of import IDs)
  let repos = [];
  if (config.repos !== undefined && config.repos !== null) {
    if (!Array.isArray(config.repos)) {
      throw new Error('Repos must be an array');
    }
    repos = config.repos.filter((s) => typeof s === 'string' && s.length > 0 && s.length <= 100);
  }

  // Validate integration approval mode
  const validApprovalModes = ['auto', 'manual'];
  const integrationApproval = validApprovalModes.includes(config.integrationApproval) ? config.integrationApproval : 'manual';

  const personality = (typeof config.personality === 'string' && config.personality.length > 0 && config.personality.length <= 64 && NAME_PATTERN.test(config.personality)) ? config.personality : undefined;

  const reasoningEffort = config.reasoning_effort !== undefined && config.reasoning_effort !== null
    ? validateReasoningEffort(config.reasoning_effort) : undefined;

  // Numeric tuning params (0-100 for effort/verbosity, 0.0-1.0 for temperature)
  let numericReasoningEffort = undefined;
  if (config.reasoningEffort !== undefined && config.reasoningEffort !== null) {
    const n = Number(config.reasoningEffort);
    if (!isNaN(n) && n >= 0 && n <= 100) numericReasoningEffort = Math.round(n);
  }

  let temperature = undefined;
  if (config.temperature !== undefined && config.temperature !== null) {
    const t = Number(config.temperature);
    if (!isNaN(t) && t >= 0 && t <= 1) temperature = t;
  }

  let verbosity = undefined;
  if (config.verbosity !== undefined && config.verbosity !== null) {
    const v = Number(config.verbosity);
    if (!isNaN(v) && v >= 0 && v <= 100) verbosity = Math.round(v);
  }

  // Return sanitized config (only known fields)
  return {
    role: config.role,
    name: config.name || undefined,
    scope: config.scope || [],
    prompt: config.prompt || '',
    provider: config.provider || undefined,
    model: typeof config.model === 'string' ? config.model : null,
    workingDir: typeof config.workingDir === 'string' ? config.workingDir : undefined,
    teamId: config.teamId || undefined,
    permission,
    skills,
    integrations,
    integrationApproval,
    repos,
    personality,
    reasoningEffort: numericReasoningEffort ?? reasoningEffort,
    temperature,
    verbosity,
    labPresetId: (typeof config.labPresetId === 'string' && config.labPresetId.length <= 64) ? config.labPresetId : undefined,
  };
}

export function validateScopePattern(pattern) {
  if (typeof pattern !== 'string') {
    throw new Error('Scope pattern must be a string');
  }
  if (pattern.length > MAX_SCOPE_LENGTH) {
    throw new Error(`Scope pattern too long (max ${MAX_SCOPE_LENGTH} chars)`);
  }
  // No absolute paths
  if (pattern.startsWith('/')) {
    throw new Error('Scope patterns cannot be absolute paths');
  }
  // No null bytes
  if (pattern.includes('\0')) {
    throw new Error('Scope pattern contains invalid characters');
  }
}

export function validateTeamName(name) {
  if (!name || typeof name !== 'string') {
    throw new Error('Team name is required');
  }
  if (name.length > 100) {
    throw new Error('Team name too long (max 100 chars)');
  }
  // Allow spaces and special chars in display name, sanitize for filesystem separately
}

const VALID_GATEWAY_TYPES = ['telegram', 'discord', 'slack'];
const VALID_NOTIFICATION_PRESETS = ['critical', 'lifecycle', 'all', 'custom'];

export function validateGatewayConfig(config) {
  if (!config || typeof config !== 'object') {
    throw new Error('Invalid gateway config');
  }

  if (!config.type || !VALID_GATEWAY_TYPES.includes(config.type)) {
    throw new Error(`Invalid gateway type. Must be one of: ${VALID_GATEWAY_TYPES.join(', ')}`);
  }

  if (config.chatId !== undefined && config.chatId !== null) {
    if (typeof config.chatId !== 'string' || config.chatId.length > 100) {
      throw new Error('Invalid chatId');
    }
  }

  if (config.allowedUsers !== undefined && config.allowedUsers !== null) {
    if (!Array.isArray(config.allowedUsers)) {
      throw new Error('allowedUsers must be an array');
    }
    if (config.allowedUsers.length > 50) {
      throw new Error('Too many allowed users (max 50)');
    }
    for (const u of config.allowedUsers) {
      if (typeof u !== 'string' || u.length > 100) {
        throw new Error('Invalid user ID in allowedUsers');
      }
    }
  }

  if (config.notifications !== undefined && config.notifications !== null) {
    if (typeof config.notifications !== 'object') {
      throw new Error('notifications must be an object');
    }
    if (config.notifications.preset && !VALID_NOTIFICATION_PRESETS.includes(config.notifications.preset)) {
      throw new Error(`Invalid notification preset. Must be one of: ${VALID_NOTIFICATION_PRESETS.join(', ')}`);
    }
  }

  if (config.commandPermission !== undefined && !['full', 'read-only'].includes(config.commandPermission)) {
    throw new Error('Invalid commandPermission. Must be "full" or "read-only"');
  }

  return {
    type: config.type,
    enabled: config.enabled !== false,
    chatId: config.chatId || null,
    allowedUsers: (config.allowedUsers || []).map(String),
    notifications: config.notifications || { preset: 'critical' },
    commandPermission: config.commandPermission || 'full',
  };
}

const VALID_REASONING_EFFORTS = ['none', 'low', 'medium', 'high', 'xhigh'];
const VALID_VERBOSITIES = ['low', 'medium'];

export function validateReasoningEffort(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || !VALID_REASONING_EFFORTS.includes(value)) {
    throw new Error(`Invalid reasoning_effort: must be one of ${VALID_REASONING_EFFORTS.join(', ')}`);
  }
  return value;
}

export function validateVerbosity(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || !VALID_VERBOSITIES.includes(value)) {
    throw new Error(`Invalid verbosity: must be one of ${VALID_VERBOSITIES.join(', ')}`);
  }
  return value;
}

const VALID_TEAM_MODES = ['sandbox', 'production'];

export function validateTeamMode(mode) {
  if (!mode) return 'sandbox';
  if (!VALID_TEAM_MODES.includes(mode)) {
    throw new Error(`Invalid team mode: must be one of ${VALID_TEAM_MODES.join(', ')}`);
  }
  return mode;
}

const VALID_RUNTIME_TYPES = ['ollama', 'vllm', 'llama-cpp', 'tgi', 'openai-compatible'];
const MAX_ENDPOINT_LENGTH = 500;
const MAX_SYSTEM_PROMPT_LENGTH = 20_000;
const MAX_MESSAGES = 500;
const MAX_MESSAGE_CONTENT_LENGTH = 100_000;
const PRESET_NAME_PATTERN = /^[a-zA-Z0-9 _\-().]{1,100}$/;

export function validateLabRuntimeConfig(config) {
  if (!config || typeof config !== 'object') {
    throw new Error('Invalid runtime config');
  }

  if (!config.name || typeof config.name !== 'string' || config.name.length > 100) {
    throw new Error('Runtime name is required (max 100 chars)');
  }

  if (!config.type || !VALID_RUNTIME_TYPES.includes(config.type)) {
    throw new Error(`Invalid runtime type: must be one of ${VALID_RUNTIME_TYPES.join(', ')}`);
  }

  if (!config.endpoint || typeof config.endpoint !== 'string') {
    throw new Error('Endpoint URL is required');
  }
  if (config.endpoint.length > MAX_ENDPOINT_LENGTH) {
    throw new Error(`Endpoint URL too long (max ${MAX_ENDPOINT_LENGTH} chars)`);
  }
  try {
    new URL(config.endpoint);
  } catch {
    throw new Error('Invalid endpoint URL');
  }

  if (config.apiKey !== undefined && config.apiKey !== null) {
    if (typeof config.apiKey !== 'string' || config.apiKey.length > 500) {
      throw new Error('Invalid API key');
    }
  }

  return {
    name: config.name.trim(),
    type: config.type,
    endpoint: config.endpoint.trim(),
    apiKey: config.apiKey || null,
  };
}

export function validateLabInferenceParams(params) {
  if (!params || typeof params !== 'object') {
    throw new Error('Invalid inference params');
  }

  if (!params.runtimeId || typeof params.runtimeId !== 'string') {
    throw new Error('runtimeId is required');
  }

  if (!params.model || typeof params.model !== 'string') {
    throw new Error('model is required');
  }

  if (!Array.isArray(params.messages) || params.messages.length === 0) {
    throw new Error('messages array is required and must not be empty');
  }
  if (params.messages.length > MAX_MESSAGES) {
    throw new Error(`Too many messages (max ${MAX_MESSAGES})`);
  }

  const validRoles = ['system', 'user', 'assistant'];
  for (const msg of params.messages) {
    if (!msg || typeof msg !== 'object') {
      throw new Error('Each message must be an object');
    }
    if (!validRoles.includes(msg.role)) {
      throw new Error(`Invalid message role: must be one of ${validRoles.join(', ')}`);
    }
    if (typeof msg.content !== 'string') {
      throw new Error('Message content must be a string');
    }
    if (msg.content.length > MAX_MESSAGE_CONTENT_LENGTH) {
      throw new Error(`Message content too long (max ${MAX_MESSAGE_CONTENT_LENGTH} chars)`);
    }
  }

  const parameters = {};
  if (params.parameters && typeof params.parameters === 'object') {
    const p = params.parameters;
    if (p.temperature !== undefined) {
      const t = Number(p.temperature);
      if (isNaN(t) || t < 0 || t > 2) throw new Error('temperature must be 0-2');
      parameters.temperature = t;
    }
    if (p.top_p !== undefined) {
      const v = Number(p.top_p);
      if (isNaN(v) || v < 0 || v > 1) throw new Error('top_p must be 0-1');
      parameters.top_p = v;
    }
    if (p.top_k !== undefined) {
      const v = Number(p.top_k);
      if (isNaN(v) || v < 0 || v > 1000) throw new Error('top_k must be 0-1000');
      parameters.top_k = Math.round(v);
    }
    if (p.repeat_penalty !== undefined) {
      const v = Number(p.repeat_penalty);
      if (isNaN(v) || v < 0 || v > 10) throw new Error('repeat_penalty must be 0-10');
      parameters.repeat_penalty = v;
    }
    if (p.max_tokens !== undefined) {
      const v = Number(p.max_tokens);
      if (isNaN(v) || v < 1 || v > 1_000_000) throw new Error('max_tokens must be 1-1000000');
      parameters.max_tokens = Math.round(v);
    }
    if (p.stop !== undefined) {
      if (!Array.isArray(p.stop)) throw new Error('stop must be an array of strings');
      if (p.stop.length > 10) throw new Error('Too many stop sequences (max 10)');
      parameters.stop = p.stop.filter((s) => typeof s === 'string' && s.length <= 100);
    }
    if (p.frequency_penalty !== undefined) {
      const v = Number(p.frequency_penalty);
      if (isNaN(v) || v < -2 || v > 2) throw new Error('frequency_penalty must be -2 to 2');
      parameters.frequency_penalty = v;
    }
    if (p.presence_penalty !== undefined) {
      const v = Number(p.presence_penalty);
      if (isNaN(v) || v < -2 || v > 2) throw new Error('presence_penalty must be -2 to 2');
      parameters.presence_penalty = v;
    }
  }

  return {
    runtimeId: params.runtimeId,
    model: params.model,
    messages: params.messages.map((m) => ({ role: m.role, content: m.content })),
    parameters,
    sessionId: (typeof params.sessionId === 'string' && params.sessionId.length <= 64) ? params.sessionId : undefined,
  };
}

export function validateLabPresetConfig(config) {
  if (!config || typeof config !== 'object') {
    throw new Error('Invalid preset config');
  }

  if (!config.name || typeof config.name !== 'string') {
    throw new Error('Preset name is required');
  }
  if (!PRESET_NAME_PATTERN.test(config.name)) {
    throw new Error('Invalid preset name: alphanumeric, spaces, dashes, underscores, parens (max 100 chars)');
  }

  if (config.runtimeId !== undefined && config.runtimeId !== null) {
    if (typeof config.runtimeId !== 'string' || config.runtimeId.length > 64) {
      throw new Error('Invalid runtimeId');
    }
  }

  if (config.model !== undefined && config.model !== null) {
    if (typeof config.model !== 'string' || config.model.length > 200) {
      throw new Error('Invalid model name');
    }
  }

  if (config.systemPrompt !== undefined && config.systemPrompt !== null) {
    if (typeof config.systemPrompt !== 'string') {
      throw new Error('systemPrompt must be a string');
    }
    if (config.systemPrompt.length > MAX_SYSTEM_PROMPT_LENGTH) {
      throw new Error(`systemPrompt too long (max ${MAX_SYSTEM_PROMPT_LENGTH} chars)`);
    }
  }

  // Validate parameters sub-object if present
  let parameters = {};
  if (config.parameters && typeof config.parameters === 'object') {
    const p = config.parameters;
    if (p.temperature !== undefined) {
      const t = Number(p.temperature);
      if (!isNaN(t) && t >= 0 && t <= 2) parameters.temperature = t;
    }
    if (p.top_p !== undefined) {
      const v = Number(p.top_p);
      if (!isNaN(v) && v >= 0 && v <= 1) parameters.top_p = v;
    }
    if (p.top_k !== undefined) {
      const v = Number(p.top_k);
      if (!isNaN(v) && v >= 0 && v <= 1000) parameters.top_k = Math.round(v);
    }
    if (p.repeat_penalty !== undefined) {
      const v = Number(p.repeat_penalty);
      if (!isNaN(v) && v >= 0 && v <= 10) parameters.repeat_penalty = v;
    }
    if (p.max_tokens !== undefined) {
      const v = Number(p.max_tokens);
      if (!isNaN(v) && v >= 1 && v <= 1_000_000) parameters.max_tokens = Math.round(v);
    }
    if (p.stop !== undefined && Array.isArray(p.stop)) {
      parameters.stop = p.stop.filter((s) => typeof s === 'string' && s.length <= 100).slice(0, 10);
    }
    if (p.frequency_penalty !== undefined) {
      const v = Number(p.frequency_penalty);
      if (!isNaN(v) && v >= -2 && v <= 2) parameters.frequency_penalty = v;
    }
    if (p.presence_penalty !== undefined) {
      const v = Number(p.presence_penalty);
      if (!isNaN(v) && v >= -2 && v <= 2) parameters.presence_penalty = v;
    }
  }

  return {
    name: config.name.trim(),
    runtimeId: config.runtimeId || null,
    model: config.model || null,
    parameters,
    systemPrompt: config.systemPrompt || '',
  };
}

export function escapeMd(text) {
  if (!text) return '';
  // Escape markdown special chars that could break table rendering or inject formatting.
  // Keep hyphens and dots since they're common in agent names and safe in table cells.
  return String(text).replace(/[|\\`*_{}[\]()#+!]/g, '\\$&');
}
