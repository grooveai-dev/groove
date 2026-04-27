// FSL-1.1-Apache-2.0 — see LICENSE

import { SUPPORTED_PROVIDERS, MODEL_TIERS, TRAINING_EXCLUSION_REASONS } from './constants.js';

export const STEP_TYPES = ['thought', 'action', 'observation', 'correction', 'resolution', 'error', 'coordination', 'edit', 'instruction', 'clarification', 'approval'];
const VALID_QUALITY_TIERS = ['TIER_A', 'TIER_B', 'TIER_C'];
const VALID_FEEDBACK_SIGNALS = ['accepted', 'modified', 'rejected', 'iterated'];

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

  if (envelope.type === 'USER_FEEDBACK') {
    return validateUserFeedback(envelope);
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
    if (m.domain_tags !== undefined && m.domain_tags !== null) {
      if (typeof m.domain_tags !== 'object') {
        errors.push('metadata.domain_tags must be an object or null');
      } else {
        for (const level of ['primary', 'secondary', 'tertiary']) {
          const tag = m.domain_tags[level];
          if (!tag || typeof tag !== 'object') {
            errors.push(`metadata.domain_tags.${level} must be an object`);
          } else {
            if (typeof tag.domain !== 'string' || tag.domain.length === 0) {
              errors.push(`metadata.domain_tags.${level}.domain must be a non-empty string`);
            }
            if (typeof tag.confidence !== 'number' || tag.confidence < 0 || tag.confidence > 1) {
              errors.push(`metadata.domain_tags.${level}.confidence must be a number 0-1`);
            }
          }
        }
      }
    }
    if (m.leaf_context !== undefined && m.leaf_context !== null) {
      if (typeof m.leaf_context !== 'object') {
        errors.push('metadata.leaf_context must be an object or null');
      } else {
        if (!m.leaf_context.leaf_id || typeof m.leaf_context.leaf_id !== 'string') {
          errors.push('metadata.leaf_context.leaf_id must be a non-empty string');
        }
        if (!m.leaf_context.leaf_version || typeof m.leaf_context.leaf_version !== 'string') {
          errors.push('metadata.leaf_context.leaf_version must be a non-empty string');
        }
        if (typeof m.leaf_context.confidence_at_route !== 'number' || m.leaf_context.confidence_at_route < 0 || m.leaf_context.confidence_at_route > 1) {
          errors.push('metadata.leaf_context.confidence_at_route must be a number 0-1');
        }
        if (!m.leaf_context.chassis_model || typeof m.leaf_context.chassis_model !== 'string') {
          errors.push('metadata.leaf_context.chassis_model must be a non-empty string');
        }
      }
    }
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
      if (step.truncated !== undefined && typeof step.truncated !== 'boolean') {
        errors.push(`step.truncated must be a boolean at index ${i}`);
      }
      if (step.original_token_count !== undefined) {
        if (typeof step.original_token_count !== 'number' || step.original_token_count < 0 || step.original_token_count > MAX_TOKEN_COUNT) {
          errors.push(`step.original_token_count must be 0-${MAX_TOKEN_COUNT} at index ${i}`);
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
    if (envelope.outcome.quality_tier !== undefined && envelope.outcome.quality_tier !== null) {
      if (!VALID_QUALITY_TIERS.includes(envelope.outcome.quality_tier)) {
        errors.push(`outcome.quality_tier must be one of: ${VALID_QUALITY_TIERS.join(', ')}`);
      }
    }
    if (envelope.outcome.quality_tier_reason !== undefined && envelope.outcome.quality_tier_reason !== null) {
      if (typeof envelope.outcome.quality_tier_reason !== 'string' || envelope.outcome.quality_tier_reason.length > 200) {
        errors.push('outcome.quality_tier_reason must be a string, max 200 characters');
      }
    }
    if (envelope.outcome.training_eligible !== undefined && envelope.outcome.training_eligible !== null) {
      if (typeof envelope.outcome.training_eligible !== 'boolean') {
        errors.push('outcome.training_eligible must be a boolean');
      }
    }
    if (envelope.outcome.training_exclusion_reason !== undefined && envelope.outcome.training_exclusion_reason !== null) {
      if (!TRAINING_EXCLUSION_REASONS.includes(envelope.outcome.training_exclusion_reason)) {
        errors.push(`outcome.training_exclusion_reason must be one of: ${TRAINING_EXCLUSION_REASONS.join(', ')}`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

function validateUserFeedback(envelope) {
  const errors = [];

  if (!envelope.session_id || typeof envelope.session_id !== 'string') {
    errors.push('Missing or invalid session_id');
  }
  if (envelope.type !== 'USER_FEEDBACK') {
    errors.push('Invalid type for USER_FEEDBACK envelope');
  }

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

  if (!envelope.feedback || typeof envelope.feedback !== 'object') {
    errors.push('Missing feedback');
  } else {
    const f = envelope.feedback;
    if (!VALID_FEEDBACK_SIGNALS.includes(f.signal)) {
      errors.push(`feedback.signal must be one of: ${VALID_FEEDBACK_SIGNALS.join(', ')}`);
    }
    if (typeof f.timestamp !== 'number') {
      errors.push('feedback.timestamp must be a number');
    }
    if (f.context !== undefined && f.context !== null && typeof f.context !== 'string') {
      errors.push('feedback.context must be a string or null');
    }
    if (f.target_step !== undefined && f.target_step !== null) {
      if (typeof f.target_step !== 'number' || !Number.isInteger(f.target_step) || f.target_step < 0) {
        errors.push('feedback.target_step must be a non-negative integer');
      }
    }
    if (f.revision_rounds !== undefined && f.revision_rounds !== null) {
      if (typeof f.revision_rounds !== 'number' || !Number.isInteger(f.revision_rounds) || f.revision_rounds < 0) {
        errors.push('feedback.revision_rounds must be a non-negative integer');
      }
    }
    if (f.delta_summary !== undefined && f.delta_summary !== null && typeof f.delta_summary !== 'string') {
      errors.push('feedback.delta_summary must be a string or null');
    }
  }

  return { valid: errors.length === 0, errors };
}
