// FSL-1.1-Apache-2.0 — see LICENSE

import { SUPPORTED_PROVIDERS } from './constants.js';

export const STEP_TYPES = ['thought', 'action', 'observation', 'correction', 'resolution', 'error', 'coordination'];

/**
 * Envelope shape:
 * @typedef {Object} TrajectoryEnvelope
 * @property {string} envelope_id - 'env_<uuid>'
 * @property {string} session_id - 'sess_<uuid>'
 * @property {number} chunk_sequence
 * @property {string} contributor_id - anonymous install uuid
 * @property {Object} attestation
 * @property {string} attestation.session_hmac - HMAC-SHA256 hex
 * @property {number} attestation.sequence
 * @property {string} attestation.app_version_hash - SHA256 hex
 * @property {Object} metadata
 * @property {string} metadata.model_engine
 * @property {string} metadata.provider
 * @property {string} metadata.agent_role
 * @property {string} metadata.agent_id
 * @property {string} metadata.task_complexity
 * @property {number} metadata.team_size
 * @property {number} metadata.session_quality
 * @property {string} metadata.groove_version
 * @property {Array<TrajectoryStep>} trajectory_log
 *
 * @typedef {Object} TrajectoryStep
 * @property {number} step
 * @property {string} type - one of STEP_TYPES
 * @property {number} timestamp
 * @property {string} [content]
 * @property {number} [token_count]
 * @property {string} [tool]
 * @property {Object} [arguments]
 * @property {boolean} [truncated]
 * @property {string} [coordination_id]
 * @property {string} [direction] - 'inbound' | 'outbound'
 * @property {string} [target_agent]
 * @property {string} [protocol] - 'knock' | 'qc' | 'lock'
 * @property {string} [source]
 *
 * @typedef {Object} SessionCloseEnvelope
 * @property {string} envelope_id
 * @property {string} session_id
 * @property {string} type - 'SESSION_CLOSE'
 * @property {Object} attestation
 * @property {Object} outcome
 * @property {string} outcome.status
 * @property {number} outcome.user_interventions
 * @property {number} outcome.total_steps
 * @property {number} outcome.total_chunks
 * @property {number} outcome.total_tokens
 * @property {number} outcome.duration_seconds
 * @property {number} outcome.files_modified
 * @property {number} outcome.errors_encountered
 * @property {number} outcome.errors_recovered
 * @property {number} outcome.coordination_events
 */

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

  if (!envelope.envelope_id || typeof envelope.envelope_id !== 'string') {
    errors.push('Missing or invalid envelope_id');
  }
  if (!envelope.session_id || typeof envelope.session_id !== 'string') {
    errors.push('Missing or invalid session_id');
  }
  if (typeof envelope.chunk_sequence !== 'number') {
    errors.push('Missing or invalid chunk_sequence');
  }
  if (!envelope.contributor_id || typeof envelope.contributor_id !== 'string') {
    errors.push('Missing or invalid contributor_id');
  }
  if (!envelope.attestation || typeof envelope.attestation !== 'object') {
    errors.push('Missing attestation');
  }
  if (!envelope.metadata || typeof envelope.metadata !== 'object') {
    errors.push('Missing metadata');
  } else {
    if (!envelope.metadata.provider) errors.push('Missing metadata.provider');
    if (!envelope.metadata.model_engine) errors.push('Missing metadata.model_engine');
    if (!envelope.metadata.agent_role) errors.push('Missing metadata.agent_role');
    if (!envelope.metadata.agent_id) errors.push('Missing metadata.agent_id');
  }

  if (!Array.isArray(envelope.trajectory_log)) {
    errors.push('Missing or invalid trajectory_log');
  } else {
    for (let i = 0; i < envelope.trajectory_log.length; i++) {
      const step = envelope.trajectory_log[i];
      if (!STEP_TYPES.includes(step.type)) {
        errors.push(`Invalid step type "${step.type}" at index ${i}`);
      }
      if (typeof step.step !== 'number') {
        errors.push(`Missing step number at index ${i}`);
      }
      if (typeof step.timestamp !== 'number') {
        errors.push(`Missing timestamp at index ${i}`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

function validateSessionClose(envelope) {
  const errors = [];

  if (!envelope.envelope_id || typeof envelope.envelope_id !== 'string') {
    errors.push('Missing or invalid envelope_id');
  }
  if (!envelope.session_id || typeof envelope.session_id !== 'string') {
    errors.push('Missing or invalid session_id');
  }
  if (envelope.type !== 'SESSION_CLOSE') {
    errors.push('Invalid type for SESSION_CLOSE envelope');
  }
  if (!envelope.attestation || typeof envelope.attestation !== 'object') {
    errors.push('Missing attestation');
  }
  if (!envelope.outcome || typeof envelope.outcome !== 'object') {
    errors.push('Missing outcome');
  } else {
    if (typeof envelope.outcome.status !== 'string') errors.push('Missing outcome.status');
    if (typeof envelope.outcome.total_steps !== 'number') errors.push('Missing outcome.total_steps');
    if (typeof envelope.outcome.total_chunks !== 'number') errors.push('Missing outcome.total_chunks');
  }

  return { valid: errors.length === 0, errors };
}
