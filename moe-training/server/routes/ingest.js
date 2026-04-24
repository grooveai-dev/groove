// FSL-1.1-Apache-2.0 — see LICENSE

import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';

export function createIngestRoutes(verifier, storage, stitcher, scorer, enrichment, ledger) {
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

      storage.store(envelope);
      const envelopeId = envelope.envelope_id || `env_${uuidv4()}`;

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

    const result = verifier.verify(envelope);
    if (!result.valid) {
      return res.json({ accepted: false, reason: result.reason });
    }

    storage.store(envelope);
    const envelopeId = envelope.envelope_id || `env_${uuidv4()}`;
    res.json({ accepted: true, envelope_id: envelopeId });
  });

  return router;
}
