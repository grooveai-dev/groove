// FSL-1.1-Apache-2.0 — see LICENSE

import { Router } from 'express';

export function createSessionRoutes(sessionRegistry) {
  const router = Router();

  router.post('/v1/sessions/open', (req, res) => {
    const { session_id, public_key, provider, model, machine_fingerprint, app_version_hash, groove_version } = req.body;

    if (!session_id || !public_key || !provider || !model || !machine_fingerprint || !app_version_hash || !groove_version) {
      return res.status(400).json({ error: 'missing required fields', required: ['session_id', 'public_key', 'provider', 'model', 'machine_fingerprint', 'app_version_hash', 'groove_version'] });
    }

    const result = sessionRegistry.openSession(session_id, public_key, provider, model, machine_fingerprint, app_version_hash, groove_version);

    if (result.rateLimited) {
      return res.status(429).json({ error: 'rate limited: too many sessions from this machine' });
    }

    res.json({ server_public_key: result.serverPublicKey });
  });

  router.post('/v1/sessions/close', (req, res) => {
    const { session_id } = req.body;
    if (!session_id) {
      return res.status(400).json({ error: 'missing session_id' });
    }

    const session = sessionRegistry.getSession(session_id);
    if (!session) {
      return res.status(404).json({ error: 'unknown session_id' });
    }
    if (session.status === 'closed') {
      return res.json({ closed: true, already_closed: true });
    }

    sessionRegistry.closeSession(session_id);
    res.json({ closed: true });
  });

  return router;
}
