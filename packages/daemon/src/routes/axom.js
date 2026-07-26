// FSL-1.1-Apache-2.0 — see LICENSE

import os from 'os';
import { saveConfig } from '../firstrun.js';
import { validateEndpoint, AXOM_DEFAULT_PORT } from '../axom-connector.js';
import { hardwareReport } from '../axom-server.js';

// Interrupt text is capped runtime-side at 2000 chars (contract §2, with a
// `truncated` flag in the response); we allow headroom and let the runtime be
// the authority on truncation — its flag is the honest signal, not ours.
const MAX_INTERRUPT_CHARS = 8000;

export function registerAxomRoutes(app, daemon) {
  app.get('/api/axom/status', (req, res) => {
    res.json(daemon.axom.status());
  });

  app.get('/api/axom/sessions', (req, res) => {
    const sessions = daemon.axom.status().endpoints.flatMap((ep) =>
      ep.sessions.map((s) => ({ endpoint: ep.name, ...s })));
    res.json(sessions);
  });

  // In-daemon ring backfill for the GUI (initial load / scrubber). `since` is
  // an envelope id ("ev-000123"); events after it are returned.
  app.get('/api/axom/sessions/:id/events', (req, res) => {
    try {
      const sinceSeq = /^ev-\d+$/.test(req.query.since || '')
        ? parseInt(req.query.since.slice(3), 10) : 0;
      res.json(daemon.axom.events(req.query.endpoint, req.params.id, sinceSeq));
    } catch (err) {
      res.status(404).json({ error: err.message });
    }
  });

  // §12: message starts a turn. Contract statuses (202/409/413) mirror
  // through verbatim — the GUI reads them, we don't reinterpret.
  app.post('/api/axom/sessions/:id/message', async (req, res) => {
    try {
      const { text, endpoint } = req.body || {};
      if (!text || typeof text !== 'string' || !text.trim()) {
        return res.status(400).json({ error: 'text is required' });
      }
      const result = await daemon.axom.message(endpoint, req.params.id, text);
      daemon.audit.log('axom.message', { session: req.params.id, chars: text.length, status: result.status });
      res.status(result.status).json(result.body);
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  app.post('/api/axom/sessions/:id/interrupt', async (req, res) => {
    try {
      const { text, endpoint } = req.body || {};
      if (!text || typeof text !== 'string' || !text.trim()) {
        return res.status(400).json({ error: 'text is required' });
      }
      if (text.length > MAX_INTERRUPT_CHARS) {
        return res.status(400).json({ error: `text exceeds ${MAX_INTERRUPT_CHARS} chars` });
      }
      const result = await daemon.axom.interrupt(endpoint, req.params.id, text);
      daemon.audit.log('axom.interrupt', { session: req.params.id, chars: text.length });
      res.json(result); // verbatim {id, truncated} from the runtime
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  app.post('/api/axom/sessions/:id/stop', async (req, res) => {
    try {
      const result = await daemon.axom.stop(req.body?.endpoint, req.params.id);
      daemon.audit.log('axom.stop', { session: req.params.id });
      res.json(result);
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  // Machine readiness for local inference — powers the welcome page's
  // "can this device run Axom?" verdict.
  app.get('/api/axom/hardware', (req, res) => {
    res.json(hardwareReport(daemon.grooveDir));
  });

  // This GROOVE's own Axom endpoint — what another instance would paste.
  // serve binds 127.0.0.1 (§6), so cross-machine reach is the user's own
  // channel; we hand them the exact tunnel one-liner rather than pretending
  // the URL travels on its own.
  app.get('/api/axom/my-endpoint', (req, res) => {
    const running = daemon.axomServer.list().find((i) => i.status === 'running');
    const port = running?.port || AXOM_DEFAULT_PORT;
    const host = os.hostname();
    const user = os.userInfo().username;
    res.json({
      url: `http://127.0.0.1:${port}`,
      port,
      host,
      running: !!running,
      instanceId: running?.id || null,
      tunnelCommand: `ssh -N -L ${port}:localhost:${port} ${user}@${host}`,
    });
  });

  // ── Managed local instances (contract §11) ──────────────────────────────

  app.get('/api/axom/instances', (req, res) => {
    res.json(daemon.axomServer.list());
  });

  app.post('/api/axom/instances', async (req, res) => {
    try {
      const instance = await daemon.axomServer.start(req.body?.id || 'default');
      res.json(instance);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/axom/instances/:id', async (req, res) => {
    try {
      await daemon.axomServer.stop(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // ── Manifest-driven install (contract §11) ──────────────────────────────

  app.get('/api/axom/install', (req, res) => {
    res.json(daemon.axomInstaller.getStatus());
  });

  app.post('/api/axom/install', (req, res) => {
    // Long-running — kick off and let the axom:install:progress broadcasts
    // carry the story; the GUI polls GET /api/axom/install as backstop.
    daemon.axomInstaller.install(req.body?.manifestUrl).catch(() => { /* status carries the error */ });
    res.json({ started: true });
  });

  app.get('/api/axom/config', (req, res) => {
    res.json({ endpoints: daemon.config.axom?.endpoints || [] });
  });

  app.patch('/api/axom/config', (req, res) => {
    const { endpoints, command, mock, manifestUrl, modelDir } = req.body || {};

    // Runtime settings (contract §11): serve binary path, mock mode,
    // install-manifest URL, model dir. Any subset may be patched alone.
    const settings = {};
    if (command !== undefined) {
      if (command !== null && (typeof command !== 'string' || !command.trim())) {
        return res.status(400).json({ error: 'command must be a non-empty string or null' });
      }
      settings.command = command;
    }
    if (mock !== undefined) settings.mock = !!mock;
    if (manifestUrl !== undefined) {
      if (manifestUrl !== null && !/^https?:\/\//.test(manifestUrl)) {
        return res.status(400).json({ error: 'manifestUrl must be http(s) or null' });
      }
      settings.manifestUrl = manifestUrl;
    }
    if (modelDir !== undefined) settings.modelDir = modelDir;
    if (Object.keys(settings).length > 0) {
      daemon.config.axom = { ...(daemon.config.axom || {}), ...settings };
      if (endpoints === undefined) {
        saveConfig(daemon.grooveDir, daemon.config);
        daemon.audit.log('axom.config', { keys: Object.keys(settings) });
        return res.json({ ...daemon.config.axom });
      }
    }

    if (!Array.isArray(endpoints)) {
      return res.status(400).json({ error: 'endpoints array is required' });
    }
    if (endpoints.length > 16) {
      return res.status(400).json({ error: 'too many endpoints (max 16)' });
    }
    const seen = new Set();
    for (const entry of endpoints) {
      const problem = validateEndpoint(entry);
      if (problem) return res.status(400).json({ error: problem });
      if (seen.has(entry.name)) {
        return res.status(400).json({ error: `duplicate endpoint name: ${entry.name}` });
      }
      seen.add(entry.name);
    }
    const cleaned = endpoints.map(({ name, url }) => ({ name, url: url.replace(/\/+$/, '') }));
    daemon.config.axom = { ...(daemon.config.axom || {}), endpoints: cleaned };
    saveConfig(daemon.grooveDir, daemon.config);
    daemon.axom.configure(cleaned);
    daemon.audit.log('axom.config', { endpoints: cleaned.map((e) => e.name) });
    res.json({ endpoints: cleaned });
  });
}
