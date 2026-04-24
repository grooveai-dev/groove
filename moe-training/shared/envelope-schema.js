// FSL-1.1-Apache-2.0 — see LICENSE

import { SUPPORTED_PROVIDERS, MODEL_TIERS } from './constants.js';

export const STEP_TYPES = ['thought', 'action', 'observation', 'correction', 'resolution', 'error', 'coordination'];

const VALID_MODEL_ENGINES = Object.keys(MODEL_TIERS);
const VALID_COMPLEXITIES = ['light', 'medium', 'heavy'];
const VALID_OUTCOME_STATUSES = ['SUCCESS', 'CRASH', 'KILLED'];
const MAX_STEPS_PER_ENVELOPE = 500;
const MAX_STEP_CONTENT_LENGTH = 10_000;
const MAX_TOKEN_COUNT = 100_000;
const MAX_STEP_NUMBER = 50_000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;
const HEX_32 = /^[0-9a-f]{32}$/;
const HEX_64 = /^[0-9a-f]{64}$/;
const MAX_OUTCOME_NUMERIC = 50_000;

export class EnvelopeBuilder {
  constructor() {
    this._steps = [];
  }

  addStep(step) {
    this._steps.push(step);
    return this;
  }

  build(envelopeId, sessionId, chunkSequence, contributorId, metadata) {
    return {
      envelope_id: envelopeId,
      session_id: sessionId,
      chunk_sequence: chunkSequence,
      contributor_id: contributorId,
      attestation: { session_hmac: '', sequence: 0, app_version_hash: '' },
      metadata,
      trajectory_log: [...this._steps],
    };
  }

  static buildSessionClose(envelopeId, sessionId, outcome) {
    return {
      envelope_id: envelopeId,
      session_id: sessionId,
      type: 'SESSION_CLOSE',
      attestation: { session_hmac: '', sequence: 0, app_version_hash: '' },
      outcome,
    };
  }
}

export function validateEnvelope(envelope) {
  const errors = [];

  if (!envelope) {
    return { valid: false, errors: ['Envelope is null or undefined'] };
  }

  if (envelope.type === 'SESSION_CLOSE') {
    return validateSessionClose(envelope);
  }

  if (!envelope.session_id || typeof envelope.session_id !== 'string') {
    errors.push('Missing or invalid session_id');
  }
  if (typeof envelope.chunk_sequence !== 'number') {
    errors.push('Missing or invalid chunk_sequence');
  }

  // contributor_id: must be 32-char hex (UUID without dashes)
  if (!envelope.contributor_id || typeof envelope.contributor_id !== 'string') {
    errors.push('Missing or invalid contributor_id');
  } else if (!HEX_32.test(envelope.contributor_id)) {
    errors.push('contributor_id must be a 32-character hex string');
  }

  // Attestation validation
  if (!envelope.attestation || typeof envelope.attestation !== 'object') {
    errors.push('Missing attestation');
  } else {
    if (typeof envelope.attestation.session_hmac !== 'string' || !HEX_64.test(envelope.attestation.session_hmac)) {
      errors.push('attestation.session_hmac must be exactly 64 hex characters');
    }
    if (typeof envelope.attestation.sequence !== 'number' || !Number.isInteger(envelope.attestation.sequence) || envelope.attestation.sequence < 0 || envelope.attestation.sequence > 1_000_000) {
      errors.push('attestation.sequence must be a non-negative integer, max 1000000');
    }
    if (typeof envelope.attestation.app_version_hash !== 'string' || !HEX_64.test(envelope.attestation.app_version_hash)) {
      errors.push('attestation.app_version_hash must be exactly 64 hex characters');
    }
  }

  // Metadata validation
  if (!envelope.metadata || typeof envelope.metadata !== 'object') {
    errors.push('Missing metadata');
  } else {
    const m = envelope.metadata;
    if (!m.provider || !SUPPORTED_PROVIDERS.includes(m.provider)) {
      errors.push(`metadata.provider must be one of: ${SUPPORTED_PROVIDERS.join(', ')}`);
    }
    if (!m.model_engine || !VALID_MODEL_ENGINES.includes(m.model_engine)) {
      errors.push(`metadata.model_engine must be one of: ${VALID_MODEL_ENGINES.join(', ')}`);
    }
    if (!m.agent_role || typeof m.agent_role !== 'string' || m.agent_role.length > 50) {
      errors.push('metadata.agent_role must be a string, max 50 characters');
    }
    if (!m.agent_id || typeof m.agent_id !== 'string' || m.agent_id.length > 100) {
      errors.push('metadata.agent_id must be a string, max 100 characters');
    }
    if (m.team_size !== undefined && m.team_size !== null) {
      if (!Number.isInteger(m.team_size) || m.team_size < 1 || m.team_size > 50) {
        errors.push('metadata.team_size must be an integer 1-50');
      }
    }
    if (m.task_complexity !== undefined && m.task_complexity !== null) {
      if (!VALID_COMPLEXITIES.includes(m.task_complexity)) {
        errors.push('metadata.task_complexity must be light, medium, or heavy');
      }
    }
    if (m.groove_version !== undefined && m.groove_version !== null) {
      if (typeof m.groove_version !== 'string' || m.groove_version.length > 20) {
        errors.push('metadata.groove_version must be a string, max 20 characters');
      }
    }
    // session_quality is ignored from client — server derives quality
  }

  // Trajectory log validation
  if (!Array.isArray(envelope.trajectory_log)) {
    errors.push('Missing or invalid trajectory_log');
  } else {
    if (envelope.trajectory_log.length > MAX_STEPS_PER_ENVELOPE) {
      errors.push(`trajectory_log exceeds maximum of ${MAX_STEPS_PER_ENVELOPE} steps (got ${envelope.trajectory_log.length})`);
    }

    const now = Date.now();
    const sevenDaysAgo = now - SEVEN_DAYS_MS;
    const futureLimit = now + ONE_HOUR_MS;

    for (let i = 0; i < Math.min(envelope.trajectory_log.length, MAX_STEPS_PER_ENVELOPE); i++) {
      const step = envelope.trajectory_log[i];
      if (!STEP_TYPES.includes(step.type)) {
        errors.push(`Invalid step type "${step.type}" at index ${i}`);
      }
      if (typeof step.step !== 'number' || !Number.isInteger(step.step) || step.step < 0 || step.step > MAX_STEP_NUMBER) {
        errors.push(`step.step must be a non-negative integer, max ${MAX_STEP_NUMBER} at index ${i}`);
      }
      if (typeof step.timestamp !== 'number') {
        errors.push(`Missing timestamp at index ${i}`);
      } else {
        const tsMs = step.timestamp < 1e12 ? step.timestamp * 1000 : step.timestamp;
        if (tsMs < sevenDaysAgo || tsMs > futureLimit) {
          errors.push(`Timestamp out of range at index ${i} (must be within last 7 days, max 1 hour in future)`);
        }
      }
      if (step.content !== undefined && typeof step.content === 'string' && step.content.length > MAX_STEP_CONTENT_LENGTH) {
        errors.push(`step.content exceeds ${MAX_STEP_CONTENT_LENGTH} characters at index ${i}`);
      }
      if (step.token_count !== undefined) {
        if (typeof step.token_count !== 'number' || step.token_count < 0 || step.token_count > MAX_TOKEN_COUNT) {
          errors.push(`step.token_count must be 0-${MAX_TOKEN_COUNT} at index ${i}`);
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

function validateSessionClose(envelope) {
  const errors = [];

  if (!envelope.session_id || typeof envelope.session_id !== 'string') {
    errors.push('Missing or invalid session_id');
  }
  if (envelope.type !== 'SESSION_CLOSE') {
    errors.push('Invalid type for SESSION_CLOSE envelope');
  }

  // Attestation validation
  if (!envelope.attestation || typeof envelope.attestation !== 'object') {
    errors.push('Missing attestation');
  } else {
    if (typeof envelope.attestation.session_hmac !== 'string' || !HEX_64.test(envelope.attestation.session_hmac)) {
      errors.push('attestation.session_hmac must be exactly 64 hex characters');
    }
    if (typeof envelope.attestation.sequence !== 'number' || !Number.isInteger(envelope.attestation.sequence) || envelope.attestation.sequence < 0 || envelope.attestation.sequence > 1_000_000) {
      errors.push('attestation.sequence must be a non-negative integer, max 1000000');
    }
    if (typeof envelope.attestation.app_version_hash !== 'string' || !HEX_64.test(envelope.attestation.app_version_hash)) {
      errors.push('attestation.app_version_hash must be exactly 64 hex characters');
    }
  }

  // Outcome validation
  if (!envelope.outcome || typeof envelope.outcome !== 'object') {
    errors.push('Missing outcome');
  } else {
    if (!VALID_OUTCOME_STATUSES.includes(envelope.outcome.status)) {
      errors.push(`outcome.status must be one of: ${VALID_OUTCOME_STATUSES.join(', ')}`);
    }
    if (typeof envelope.outcome.total_steps !== 'number' || !Number.isInteger(envelope.outcome.total_steps) || envelope.outcome.total_steps < 0 || envelope.outcome.total_steps > MAX_OUTCOME_NUMERIC) {
      errors.push('Missing or invalid outcome.total_steps');
    }
    if (typeof envelope.outcome.total_chunks !== 'number' || !Number.isInteger(envelope.outcome.total_chunks) || envelope.outcome.total_chunks < 0 || envelope.outcome.total_chunks > MAX_OUTCOME_NUMERIC) {
      errors.push('Missing or invalid outcome.total_chunks');
    }
    const numericFields = ['user_interventions', 'total_tokens', 'duration_seconds', 'files_modified', 'errors_encountered', 'errors_recovered', 'coordination_events'];
    for (const field of numericFields) {
      if (envelope.outcome[field] !== undefined) {
        const v = envelope.outcome[field];
        if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > MAX_OUTCOME_NUMERIC) {
          errors.push(`outcome.${field} must be a non-negative integer, max ${MAX_OUTCOME_NUMERIC}`);
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
