// FSL-1.1-Apache-2.0 — see LICENSE
import { resolve } from 'path';
import { mkdirSync, writeFileSync } from 'fs';

export function registerIntegrationRoutes(app, daemon) {

  // --- Skills Marketplace ---

  app.get('/api/skills/registry', async (req, res) => {
    const skills = await daemon.skills.getRegistry({
      search: req.query.search || '',
      category: req.query.category || 'all',
    });
    res.json({
      skills,
      categories: daemon.skills.getCategories(),
    });
  });

  app.get('/api/skills/installed', (req, res) => {
    res.json(daemon.skills.getInstalled());
  });

  app.post('/api/skills/:id/install', async (req, res) => {
    try {
      const result = await daemon.skills.install(req.params.id);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete('/api/skills/:id', (req, res) => {
    try {
      const result = daemon.skills.uninstall(req.params.id);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/skills/:id/update', async (req, res) => {
    try {
      const result = await daemon.skills.update(req.params.id);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/skills/:id/rate', async (req, res) => {
    try {
      const rating = parseInt(req.body?.rating, 10);
      const result = await daemon.skills.rate(req.params.id, rating);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Import a local .md skill file
  app.post('/api/skills/import', (req, res) => {
    const { name, content } = req.body;
    if (!content) return res.status(400).json({ error: 'content is required' });
    if (!name) return res.status(400).json({ error: 'name is required' });

    const id = name.toLowerCase().replace(/\.md$/i, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (!id) return res.status(400).json({ error: 'Invalid skill name' });

    const skillDir = resolve(daemon.skills.skillsDir, id);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(resolve(skillDir, 'SKILL.md'), content);
    daemon.audit.log('skill.import', { id, name });
    res.json({ id, name, installed: true, source: 'local' });
  });

  app.get('/api/skills/:id/content', async (req, res) => {
    try {
      const result = await daemon.skills.getContentPreview(req.params.id);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Integrations ---

  // Google OAuth routes MUST come before parameterized :id routes
  // (Express matches in order — :id would swallow 'google-oauth')

  app.get('/api/integrations/registry', async (req, res) => {
    const integrations = await daemon.integrations.getRegistry({
      search: req.query.search || '',
      category: req.query.category || 'all',
    });
    res.json({
      integrations,
      categories: daemon.integrations.getCategories(),
    });
  });

  app.get('/api/integrations/installed', (req, res) => {
    res.json(daemon.integrations.getInstalled());
  });

  app.get('/api/integrations/google-oauth/status', (req, res) => {
    res.json({ configured: daemon.integrations.isGoogleOAuthConfigured() });
  });

  app.post('/api/integrations/google-oauth/setup', (req, res) => {
    try {
      const { clientId, clientSecret } = req.body || {};
      if (!clientId || !clientSecret) return res.status(400).json({ error: 'clientId and clientSecret are required' });
      daemon.integrations.setCredential('google-oauth', 'GOOGLE_CLIENT_ID', clientId);
      daemon.integrations.setCredential('google-oauth', 'GOOGLE_CLIENT_SECRET', clientSecret);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/api/integrations/oauth/callback', async (req, res) => {
    const wantsJson = req.query.format === 'json' || (req.headers.accept && req.headers.accept.includes('application/json'));
    try {
      const { code, state } = req.query;
      if (!code || !state) {
        if (wantsJson) return res.status(400).json({ error: 'Missing code or state parameter' });
        return res.status(400).send('Missing code or state parameter');
      }
      const result = await daemon.integrations.handleOAuthCallback(code, state);
      daemon.broadcast({ type: 'integration-oauth-complete', integrationIds: result.integrationIds });
      if (wantsJson) return res.json({ ok: true });
      res.send(`<!DOCTYPE html><html><body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#1e2127;color:#e6e6e6">
        <div style="text-align:center">
          <div style="font-size:48px;margin-bottom:16px">&#10003;</div>
          <h2>Connected!</h2>
          <p style="color:#7a8394">You can close this tab and return to Groove.</p>
          <script>setTimeout(()=>window.close(),2000)</script>
        </div>
      </body></html>`);
    } catch (err) {
      if (wantsJson) return res.status(400).json({ error: err.message });
      res.status(400).send(`<!DOCTYPE html><html><body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#1e2127;color:#e06c75">
        <div style="text-align:center">
          <h2>Connection Failed</h2>
          <p>${err.message}</p>
          <p style="color:#7a8394">Close this tab and try again in Groove.</p>
        </div>
      </body></html>`);
    }
  });

  app.post('/api/integrations/google-workspace/oauth/start', (req, res) => {
    try {
      const { integrationIds } = req.body || {};
      if (!integrationIds?.length) return res.status(400).json({ error: 'integrationIds required' });
      const url = daemon.integrations.getGoogleWorkspaceOAuthUrl(integrationIds);
      res.json({ url });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Parameterized :id routes (after specific routes above)

  app.post('/api/integrations/:id/authenticate', (req, res) => {
    console.log(`[Groove:API] POST /api/integrations/${req.params.id}/authenticate`);
    try {
      const handle = daemon.integrations.authenticate(req.params.id);
      console.log(`[Groove:API] Authenticate started, PID: ${handle.pid}`);
      res.json({ ok: true, pid: handle.pid });
    } catch (err) {
      console.log(`[Groove:API] Authenticate error: ${err.message}`);
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/integrations/:id/install', async (req, res) => {
    try {
      const result = await daemon.integrations.install(req.params.id);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete('/api/integrations/:id', async (req, res) => {
    try {
      const result = await daemon.integrations.uninstall(req.params.id);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/api/integrations/:id/status', (req, res) => {
    const status = daemon.integrations.getStatus(req.params.id);
    if (!status) return res.status(404).json({ error: 'Integration not found' });
    res.json(status);
  });

  app.post('/api/integrations/:id/credentials', (req, res) => {
    try {
      const { key, value } = req.body || {};
      if (!key || !value) return res.status(400).json({ error: 'key and value are required' });
      daemon.integrations.setCredential(req.params.id, key, value);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete('/api/integrations/:id/credentials/:key', (req, res) => {
    try {
      daemon.integrations.deleteCredential(req.params.id, req.params.key);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/integrations/:id/oauth/start', (req, res) => {
    try {
      const url = daemon.integrations.getOAuthUrl(req.params.id);
      res.json({ url });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // --- Integration Execution (provider-agnostic) ---

  const _execRates = new Map();
  const EXEC_RATE_LIMIT = 30;
  const EXEC_RATE_WINDOW = 60_000;

  app.post('/api/integrations/:id/exec', async (req, res) => {
    try {
      const { tool, params, approvalId, agent: agentId } = req.body || {};
      if (!tool || typeof tool !== 'string') {
        return res.status(400).json({ error: 'tool (string) is required' });
      }
      if (params !== undefined && (typeof params !== 'object' || Array.isArray(params))) {
        return res.status(400).json({ error: 'params must be an object' });
      }
      const integrationId = req.params.id;
      if (!daemon.integrations._isInstalled(integrationId)) {
        return res.status(400).json({ error: 'Integration not installed' });
      }

      // Rate limiting — sliding window per integration
      const now = Date.now();
      let window = _execRates.get(integrationId) || [];
      window = window.filter((t) => now - t < EXEC_RATE_WINDOW);
      if (window.length >= EXEC_RATE_LIMIT) {
        daemon.audit.log('integration.exec.rate_limited', { integrationId, tool, agentId });
        return res.status(429).json({ error: `Rate limit exceeded (${EXEC_RATE_LIMIT}/min) for ${integrationId}` });
      }
      window.push(now);
      _execRates.set(integrationId, window);

      // Approval gate — dangerous tools require human approval (unless agent is set to auto)
      const entry = daemon.integrations.registry.find((s) => s.id === integrationId);
      const callingAgent = agentId ? daemon.registry.get(agentId) : null;
      const autoApprove = callingAgent?.integrationApproval === 'auto';
      if (entry?.requiresApproval?.includes(tool) && !autoApprove) {
        if (approvalId) {
          const approval = daemon.supervisor.getApproval(approvalId);
          if (!approval) return res.status(404).json({ error: 'Approval not found' });
          if (approval.status === 'rejected') {
            return res.status(403).json({ error: 'Approval rejected', reason: approval.reason });
          }
          if (approval.status !== 'approved') {
            return res.status(202).json({ requiresApproval: true, approvalId, status: 'pending', message: 'Waiting for human approval' });
          }
        } else {
          const paramsSummary = params ? JSON.stringify(params).slice(0, 500) : '{}';
          const approval = daemon.supervisor.requestApproval(agentId || null, {
            type: 'integration_exec',
            integrationId,
            tool,
            params: paramsSummary,
            description: `${entry.name}: ${tool}`,
          }, {
            type: 'integration_exec',
            integrationId,
            tool,
            params: params || {},
            agentId: agentId || null,
          });
          daemon.audit.log('integration.exec.blocked', { integrationId, tool, approvalId: approval.id, agentId });
          return res.status(202).json({
            requiresApproval: true,
            approvalId: approval.id,
            message: `Tool "${tool}" requires approval. The user will be prompted automatically. You will receive the result once approved — do not retry.`,
          });
        }
      }

      const result = await daemon.mcpManager.execTool(integrationId, tool, params || {});
      daemon.audit.log('integration.exec', { integrationId, tool, params: params ? JSON.stringify(params).slice(0, 200) : '{}', agentId });
      res.json({ result });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/api/integrations/:id/tools', async (req, res) => {
    try {
      if (!daemon.integrations._isInstalled(req.params.id)) {
        return res.status(400).json({ error: 'Integration not installed' });
      }
      const tools = await daemon.mcpManager.listTools(req.params.id);
      res.json({ tools });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // --- Google Drive Upload (file → native Google Workspace format) ---

  app.post('/api/integrations/google-drive/upload', async (req, res) => {
    try {
      const { filePath, name, folderId, convert, approvalId, agent: agentId } = req.body || {};
      if (!filePath || typeof filePath !== 'string') {
        return res.status(400).json({ error: 'filePath (string) is required' });
      }

      // Approval gate (unless agent is set to auto)
      const uploadAgent = agentId ? daemon.registry.get(agentId) : null;
      const autoApproveUpload = uploadAgent?.integrationApproval === 'auto';
      if (!autoApproveUpload) {
        if (approvalId) {
          const approval = daemon.supervisor.getApproval(approvalId);
          if (!approval) return res.status(404).json({ error: 'Approval not found' });
          if (approval.status === 'rejected') return res.status(403).json({ error: 'Approval rejected', reason: approval.reason });
          if (approval.status !== 'approved') return res.status(202).json({ requiresApproval: true, approvalId, status: 'pending' });
        } else {
          const approval = daemon.supervisor.requestApproval(agentId || null, {
            type: 'google_drive_upload',
            filePath,
            name: name || filePath.split('/').pop(),
            description: `Upload to Google Drive: ${name || filePath.split('/').pop()}`,
          }, {
            type: 'google_drive_upload',
            filePath,
            name: name || filePath.split('/').pop(),
            folderId: folderId || null,
            convert: convert !== false,
            agentId: agentId || null,
          });
          daemon.audit.log('integration.upload.blocked', { filePath, approvalId: approval.id, agentId });
          return res.status(202).json({
            requiresApproval: true,
            approvalId: approval.id,
            message: `Upload requires approval. The user will be prompted automatically. You will receive the result once approved — do not retry.`,
          });
        }
      }

      const result = await daemon.integrations.uploadToGoogleDrive(filePath, {
        name, folderId, convert: convert !== false,
      });

      daemon.audit.log('integration.upload', { filePath, driveFileId: result.id, name: result.name, agentId });
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // --- Gateways (Telegram, Discord, Slack) ---

  app.get('/api/gateways', (req, res) => {
    res.json(daemon.gateways.list());
  });

  app.post('/api/gateways', async (req, res) => {
    try {
      const result = await daemon.gateways.create(req.body || {});
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/api/gateways/:id', (req, res) => {
    const gw = daemon.gateways.get(req.params.id);
    if (!gw) return res.status(404).json({ error: 'Gateway not found' });
    res.json(gw);
  });

  app.patch('/api/gateways/:id', async (req, res) => {
    try {
      const result = await daemon.gateways.update(req.params.id, req.body || {});
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete('/api/gateways/:id', async (req, res) => {
    try {
      await daemon.gateways.delete(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/gateways/:id/test', async (req, res) => {
    try {
      const result = await daemon.gateways.test(req.params.id);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/gateways/:id/connect', async (req, res) => {
    try {
      const result = await daemon.gateways.connect(req.params.id);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/gateways/:id/disconnect', async (req, res) => {
    try {
      const result = await daemon.gateways.disconnect(req.params.id);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/gateways/:id/credentials', (req, res) => {
    try {
      const { key, value } = req.body || {};
      if (!key || !value) return res.status(400).json({ error: 'key and value are required' });
      daemon.gateways.setCredential(req.params.id, key, value);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete('/api/gateways/:id/credentials/:key', (req, res) => {
    try {
      daemon.gateways.deleteCredential(req.params.id, req.params.key);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/api/gateways/:id/channels', async (req, res) => {
    try {
      const gw = daemon.gateways.gateways.get(req.params.id);
      if (!gw) return res.status(404).json({ error: 'Gateway not found' });
      if (!gw.connected) return res.status(400).json({ error: 'Gateway not connected' });
      if (typeof gw.listChannels !== 'function') return res.json([]);
      const channels = await gw.listChannels();
      res.json(channels);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

}
