// FSL-1.1-Apache-2.0 — see LICENSE

import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';

const MAX_ENVELOPES_PER_SESSION = 200;

export function createIngestRoutes(verifier, storage, stitcher, scorer, enrichment, ledger, sessionRegistry) {
  const router = Router();

  router.post('/v1/training/ingest', async (req, res) => {
    const envelope = req.body;

    if (!envelope || !envelope.session_id) {
      return res.status(400).json({ accepted: false, reason: 'malformed request: missing envelope or session_id' });
    }

    if (envelope.type === 'SESSION_CLOSE') {
      const closeResult = verifier.verifyClose(envelope);
      if (!closeResult.valid) {
        return res.json({ accepted: false, reason: closeResult.reason });
      }

      // Server-generated envelope_id
      const envelopeId = `env_${uuidv4()}`;
      envelope.envelope_id = envelopeId;

      // Dedup check
      if (sessionRegistry.isEnvelopeProcessed(envelopeId)) {
        return res.json({ accepted: false, reason: 'duplicate envelope' });
      }

      try {
        storage.store(envelope);
      } catch (err) {
        if (err.message === 'STORAGE_QUOTA_EXCEEDED') {
          return res.status(507).json({ accepted: false, reason: 'storage quota exceeded' });
        }
        throw err;
      }

      sessionRegistry.recordProcessedEnvelope(envelopeId, envelope.session_id);

      try {
        const stitched = stitcher.stitch(envelope.session_id);
        if (stitched) {
          const enriched = await enrichment.enrich(stitched);
          const scoreResult = scorer.score(enriched);
          const contributorId = stitched.contributor_id;
          if (contributorId) {
            ledger.credit(contributorId, envelope.session_id, scoreResult);
          }
        }
      } catch (err) {
        console.error(`[ingest] stitching/scoring error for session ${envelope.session_id}:`, err.message);
      }

      return res.json({ accepted: true, envelope_id: envelopeId });
    }

    // Per-session envelope limit
    if (!sessionRegistry.checkEnvelopeCount(envelope.session_id, MAX_ENVELOPES_PER_SESSION)) {
      return res.status(429).json({ accepted: false, reason: `session envelope limit exceeded (max ${MAX_ENVELOPES_PER_SESSION})` });
    }

    const result = verifier.verify(envelope);
    if (!result.valid) {
      return res.json({ accepted: false, reason: result.reason });
    }

    // Server-generated envelope_id
    const envelopeId = `env_${uuidv4()}`;
    envelope.envelope_id = envelopeId;

    // Dedup check
    if (sessionRegistry.isEnvelopeProcessed(envelopeId)) {
      return res.json({ accepted: false, reason: 'duplicate envelope' });
    }

    try {
      storage.store(envelope);
    } catch (err) {
      if (err.message === 'STORAGE_QUOTA_EXCEEDED') {
        return res.status(507).json({ accepted: false, reason: 'storage quota exceeded' });
      }
      throw err;
    }

    sessionRegistry.recordProcessedEnvelope(envelopeId, envelope.session_id);
    sessionRegistry.incrementEnvelopeCount(envelope.session_id);

    res.json({ accepted: true, envelope_id: envelopeId });
  });

  return router;
}
