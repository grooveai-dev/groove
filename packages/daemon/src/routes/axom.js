// FSL-1.1-Apache-2.0 — see LICENSE

import os from 'os';
import { saveConfig } from '../firstrun.js';
import { validateEndpoint, AXOM_DEFAULT_PORT } from '../axom-connector.js';
import { hardwareReport } from '../axom-server.js';
import { validateRemote } from '../axom-remote.js';

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
      const { text, endpoint, clientRef } = req.body || {};
      if (!text || typeof text !== 'string' || !text.trim()) {
        return res.status(400).json({ error: 'text is required' });
      }
      if (clientRef !== undefined && (typeof clientRef !== 'string' || clientRef.length > 64)) {
        return res.status(400).json({ error: 'clientRef must be a string of at most 64 chars' });
      }
      const result = await daemon.axom.message(endpoint, req.params.id, text, clientRef);
      // Title the chat from its opening message — but only once the runtime
      // ACCEPTED the turn. A message rejected with 409/413 never ran, so it
      // must not name the conversation it failed to start.
      if (result.status === 202) {
        daemon.axomRuntimes.titleFromFirstMessage(req.params.id, text);
        // Remember what we sent, keyed by the §15 ref the runtime echoes in
        // pipeline_start. This is what lets a reloaded tab put the user's own
        // words back above the answer instead of "prompt not identified".
        if (clientRef) daemon.axomRuntimes.recordPrompt(req.params.id, clientRef, text);
      }
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

  // §14: shut down the runtime itself. Works for any endpoint that supports
  // the verb — including remote ones, which GROOVE could never reach with a
  // signal. A 404 means the runtime predates §14; the GUI must say so rather
  // than claim the runtime is gone.
  app.post('/api/axom/shutdown', async (req, res) => {
    try {
      const result = await daemon.axom.shutdown(req.body?.endpoint, { force: !!req.body?.force });
      daemon.audit.log('axom.shutdown', { endpoint: req.body?.endpoint || null, status: result.status });
      res.status(result.status === 404 ? 501 : result.status)
        .json(result.status === 404
          ? { error: 'this runtime does not support remote shutdown (predates contract §14)' }
          : result.body);
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  // ── Runtimes — the one entity (plans/axom-runtime-flow-redesign.md) ─────
  // The GUI reasons about runtimes only; endpoints/instances/ssh are backends.

  app.get('/api/axom/runtimes', async (req, res) => {
    res.json(await daemon.axomRuntimes.status());
  });

  app.post('/api/axom/runtimes', (req, res) => {
    try {
      const rt = daemon.axomRuntimes.add(req.body);
      if (req.body?.activate) daemon.axomRuntimes.activate(rt.id);
      daemon.audit.log('axom.runtime.add', { id: rt.id, control: rt.control });
      res.json(rt);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.patch('/api/axom/runtimes/:id', (req, res) => {
    try {
      res.json(daemon.axomRuntimes.update(req.params.id, req.body || {}));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete('/api/axom/runtimes/:id', (req, res) => {
    try {
      daemon.axomRuntimes.remove(req.params.id);
      daemon.audit.log('axom.runtime.remove', { id: req.params.id });
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Mono-Axom (§10): a hook is a fresh session on the ONE runtime — never a
  // second process. Used by the agent selector, new tabs, and new chats alike.
  // Chats are named hooks, persisted daemon-side so the list survives a
  // refresh. Removing one HIDES it — the conversation is the user's memory and
  // lives in the runtime's ledger; GROOVE tidying its list never destroys it.
  app.get('/api/axom/chats', (req, res) => {
    res.json({ chats: daemon.axomRuntimes.chats() });
  });

  // What GROOVE sent on this session, so a reloaded tab can restore the user's
  // bubbles. Only ever OUR OWN sends — a turn started from the REPL or another
  // client has no entry here and must still render without a bubble.
  app.get('/api/axom/sessions/:id/prompts', (req, res) => {
    res.json({ prompts: daemon.axomRuntimes.prompts(req.params.id) });
  });

  app.patch('/api/axom/chats/:session', (req, res) => {
    try {
      res.json(daemon.axomRuntimes.renameChat(req.params.session, req.body?.label));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete('/api/axom/chats/:session', (req, res) => {
    try {
      const result = daemon.axomRuntimes.hideChat(req.params.session);
      daemon.audit.log('axom.chat.hide', { session: req.params.session });
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/axom/hook', async (req, res) => {
    try {
      const result = await daemon.axomRuntimes.hook(req.body?.runtimeId, {
        session: req.body?.session,
        label: req.body?.label,
      });
      daemon.audit.log('axom.hook', { runtime: result.runtimeId, session: result.session });
      res.json(result);
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  app.post('/api/axom/runtimes/:id/activate', (req, res) => {
    try {
      daemon.axomRuntimes.activate(req.params.id);
      res.json({ ok: true, activeRuntimeId: req.params.id });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/axom/runtimes/:id/start', async (req, res) => {
    try {
      const result = await daemon.axomRuntimes.startRuntime(req.params.id);
      daemon.audit.log('axom.runtime.start', { id: req.params.id });
      res.json(result);
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  app.post('/api/axom/runtimes/:id/stop', async (req, res) => {
    try {
      const result = await daemon.axomRuntimes.stopRuntime(req.params.id, { force: !!req.body?.force });
      daemon.audit.log('axom.runtime.stop', { id: req.params.id });
      res.json(result);
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  app.post('/api/axom/runtimes/:id/heal', async (req, res) => {
    try {
      res.json(await daemon.axomRuntimes.heal(req.params.id));
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  // ── Remote runtime control over SSH (manual only, never automatic) ──────

  app.get('/api/axom/remote', async (req, res) => {
    res.json(await daemon.axomRemote.status());
  });

  app.patch('/api/axom/remote', (req, res) => {
    const remote = req.body || {};
    if (remote.clear === true) {
      delete daemon.config.axom?.remote;
      saveConfig(daemon.grooveDir, daemon.config);
      return res.json({ configured: false });
    }
    const problem = validateRemote(remote);
    if (problem) return res.status(400).json({ error: problem });
    const { host, user, sshPort, port, command, logPath } = remote;
    daemon.config.axom = {
      ...(daemon.config.axom || {}),
      remote: { host, user, sshPort, port, command, logPath },
    };
    saveConfig(daemon.grooveDir, daemon.config);
    daemon.audit.log('axom.remote.config', { host, user });
    res.json(daemon.config.axom.remote);
  });

  // Reachability only — opens/heals the port-forward. Never starts a runtime.
  app.post('/api/axom/remote/tunnel', async (req, res) => {
    try {
      res.json(await daemon.axomRemote.ensureTunnel());
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  app.post('/api/axom/remote/start', async (req, res) => {
    try {
      res.json(await daemon.axomRemote.start());
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  app.post('/api/axom/remote/stop', async (req, res) => {
    try {
      res.json(await daemon.axomRemote.stop({ force: !!req.body?.force }));
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
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
