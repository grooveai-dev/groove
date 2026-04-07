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

  // Return sanitized config (only known fields)
  return {
    role: config.role,
    name: config.name || undefined,
    scope: config.scope || [],
    prompt: config.prompt || '',
    provider: config.provider || 'claude-code',
    model: typeof config.model === 'string' ? config.model : null,
    workingDir: typeof config.workingDir === 'string' ? config.workingDir : undefined,
    permission,
    skills,
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
  // No path traversal
  if (pattern.includes('..')) {
    throw new Error('Scope patterns cannot contain path traversal (..)');
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

export function sanitizeForFilename(name) {
  const sanitized = name
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .toLowerCase()
    .slice(0, 50);

  if (!sanitized || /^_+$/.test(sanitized)) {
    throw new Error('Team name must contain alphanumeric characters');
  }
  return sanitized;
}

export function escapeMd(text) {
  if (!text) return '';
  // Escape markdown special chars that could break table rendering or inject formatting.
  // Keep hyphens and dots since they're common in agent names and safe in table cells.
  return String(text).replace(/[|\\`*_{}[\]()#+!]/g, '\\$&');
}
