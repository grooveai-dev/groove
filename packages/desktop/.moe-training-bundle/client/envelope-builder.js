// FSL-1.1-Apache-2.0 — see LICENSE

import { randomUUID } from 'node:crypto';
import { CHUNK_SIZE } from '../shared/constants.js';

export class EnvelopeBuilder {
  constructor(sessionId, contributorId, metadata) {
    this._sessionId = sessionId;
    this._contributorId = contributorId;
    this._metadata = metadata;
    this._buffer = [];
    this._chunkSequence = 0;
  }

  addStep(step) {
    if (step.content && typeof step.content === 'string' && step.content.length > 10_000) {
      step.content = step.content.slice(0, 10_000);
    }
    if (typeof step.token_count === 'number' && step.token_count > 100_000) {
      step.token_count = 100_000;
    }
    this._buffer.push(step);
    if (this._buffer.length >= CHUNK_SIZE) {
      return this._buildEnvelope();
    }
    return null;
  }

  flush() {
    if (this._buffer.length === 0) return null;
    return this._buildEnvelope();
  }

  buildSessionClose(outcome) {
    return {
      envelope_id: `env_${randomUUID()}`,
      session_id: this._sessionId,
      type: 'SESSION_CLOSE',
      attestation: { session_hmac: '', sequence: 0, app_version_hash: '' },
      outcome,
    };
  }

  _buildEnvelope() {
    const envelope = {
      envelope_id: `env_${randomUUID()}`,
      session_id: this._sessionId,
      chunk_sequence: this._chunkSequence++,
      contributor_id: this._contributorId,
      attestation: { session_hmac: '', sequence: 0, app_version_hash: '' },
      metadata: { ...this._metadata },
      trajectory_log: this._buffer.splice(0),
    };
    return envelope;
  }
}
