// FSL-1.1-Apache-2.0 — see LICENSE

import { randomUUID } from 'node:crypto';
import { CHUNK_SIZE, MAX_STEP_CONTENT_CHARS, MAX_TOKEN_COUNT } from '../shared/constants.js';

function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export class EnvelopeBuilder {
  constructor(sessionId, contributorId, metadata) {
    this._sessionId = sessionId;
    this._contributorId = contributorId;
    this._metadata = { ...metadata, leaf_context: metadata.leaf_context ?? null };
    this._buffer = [];
    this._chunkSequence = 0;
  }

  addStep(step) {
    // Last-resort trim so the envelope passes ingest validation (an oversized
    // step.content is rejected, which drops the whole session). Parsers already
    // truncate observations to OBSERVATION_TOKEN_LIMIT and flag it; this only
    // fires for content that slipped past them. When it does fire it MUST record
    // the loss — a silent trim looks like complete data to downstream training.
    if (step.content && typeof step.content === 'string' && step.content.length > MAX_STEP_CONTENT_CHARS) {
      const originalTokens = estimateTokens(step.content);
      step.content = step.content.slice(0, MAX_STEP_CONTENT_CHARS);
      step.truncated = true;
      // Preserve the parser's count if it already trimmed — that one reflects
      // the true original size, ours only sees what survived the first pass.
      if (typeof step.original_token_count !== 'number') {
        step.original_token_count = Math.min(originalTokens, MAX_TOKEN_COUNT);
      }
    }
    if (typeof step.token_count === 'number' && step.token_count > MAX_TOKEN_COUNT) {
      step.token_count = MAX_TOKEN_COUNT;
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

  updateMetadata(updates) {
    Object.assign(this._metadata, updates);
  }

  buildSessionClose(outcome) {
    return {
      envelope_id: `env_${randomUUID()}`,
      session_id: this._sessionId,
      type: 'SESSION_CLOSE',
      attestation: { session_hmac: '', sequence: 0, app_version_hash: '' },
      metadata: { ...this._metadata },
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
