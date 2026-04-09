// GROOVE — REST API
// FSL-1.1-Apache-2.0 — see LICENSE

import express from 'express';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync, unlinkSync, renameSync, rmSync, createReadStream } from 'fs';
import { lookup as mimeLookup } from './mimetypes.js';
import { listProviders, getProvider } from './providers/index.js';
import { OllamaProvider } from './providers/ollama.js';
import { validateAgentConfig } from './validate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function createApi(app, daemon) {
  // CORS — restrict to localhost + bound interface origins
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    let allowed = false;
    if (!origin) {
      allowed = true;
    } else {
      try {
        const url = new URL(origin);
        // Allow any localhost origin (any port — tunnels change the port)
        if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') allowed = true;
        // Allow the bound interface (for Tailscale/LAN access)
        if (daemon.host && daemon.host !== '127.0.0.1' && url.hostname === daemon.host) allowed = true;
      } catch { /* invalid origin */ }
    }
    if (allowed) {
      res.header('Access-Control-Allow-Origin', origin || '*');
    }
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, PATCH');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  app.use(express.json({ limit: '6mb' }));

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  // List all agents
  app.get('/api/agents', (req, res) => {
    res.json(daemon.registry.getAll());
  });

  // Get single agent
  app.get('/api/agents/:id', (req, res) => {
    const agent = daemon.registry.get(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    res.json(agent);
  });

  // Spawn a new agent
  app.post('/api/agents', async (req, res) => {
    try {
      const config = validateAgentConfig(req.body);
      config.teamId = req.body.teamId || daemon.teams.getDefault()?.id || null;
      const agent = await daemon.processes.spawn(config);
      daemon.audit.log('agent.spawn', { id: agent.id, role: agent.role, provider: agent.provider });
      res.status(201).json(agent);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Update agent
  app.patch('/api/agents/:id', (req, res) => {
    const agent = daemon.registry.update(req.params.id, req.body);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    res.json(agent);
  });

  // Kill an agent (add ?purge=true to also remove from registry)
  app.delete('/api/agents/:id', async (req, res) => {
    try {
      const agent = daemon.registry.get(req.params.id);
      if (!agent) return res.status(404).json({ error: 'Agent not found' });

      const isAlive = agent.status === 'running' || agent.status === 'starting';
      if (isAlive) {
        await daemon.processes.kill(req.params.id);
      }

      // Purge from registry if requested or if agent is dead
      if (req.query.purge === 'true' || !isAlive) {
        daemon.registry.remove(req.params.id);
      }

      daemon.audit.log('agent.kill', { id: agent.id, role: agent.role, purged: req.query.purge === 'true' || !isAlive });
      res.json({ ok: true, purged: req.query.purge === 'true' || !isAlive });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Kill all agents
  app.delete('/api/agents', async (req, res) => {
    const count = daemon.processes.getRunningCount();
    await daemon.processes.killAll();
    daemon.audit.log('agent.kill_all', { count });
    res.json({ ok: true });
  });

  // Lock management
  app.get('/api/locks', (req, res) => {
    res.json(daemon.locks.getAll());
  });

  // Token usage
  app.get('/api/tokens', (req, res) => {
    res.json(daemon.tokens.getAll());
  });

  // List available providers
  app.get('/api/providers', (req, res) => {
    const providers = listProviders();
    // Enrich with credential status
    for (const p of providers) {
      p.hasKey = daemon.credentials.hasKey(p.id);
    }
    res.json(providers);
  });

  // --- Ollama ---

  app.get('/api/providers/ollama/hardware', (req, res) => {
    res.json(OllamaProvider.getSystemHardware());
  });

  app.get('/api/providers/ollama/models', (req, res) => {
    const installed = OllamaProvider.isInstalled() ? OllamaProvider.getInstalledModels() : [];
    const catalog = OllamaProvider.catalog;
    const hardware = OllamaProvider.getSystemHardware();
    res.json({ installed, catalog, hardware });
  });

  app.post('/api/providers/ollama/pull', async (req, res) => {
    const { model } = req.body;
    if (!model) return res.status(400).json({ error: 'model is required' });
    if (!OllamaProvider.isInstalled()) return res.status(400).json({ error: 'Ollama is not installed' });
    const broadcast = daemon.broadcast || (() => {});
    try {
      broadcast({ type: 'ollama:pull:start', model });
      await OllamaProvider.pullModel(model, (progress) => {
        broadcast({ type: 'ollama:pull:progress', model, progress: progress.trim() });
      });
      broadcast({ type: 'ollama:pull:complete', model });
      daemon.audit.log('ollama.pull', { model });
      res.json({ ok: true, model });
    } catch (err) {
      broadcast({ type: 'ollama:pull:error', model, error: err.message });
      res.status(500).json({ error: `Pull failed: ${err.message}` });
    }
  });

  app.delete('/api/providers/ollama/models/:model', (req, res) => {
    if (!OllamaProvider.isInstalled()) return res.status(400).json({ error: 'Ollama is not installed' });
    const success = OllamaProvider.deleteModel(req.params.model);
    if (success) {
      daemon.audit.log('ollama.delete', { model: req.params.model });
      res.json({ ok: true });
    } else {
      res.status(500).json({ error: 'Failed to delete model' });
    }
  });

  app.post('/api/providers/ollama/check', (req, res) => {
    const installed = OllamaProvider.isInstalled();
    const install = OllamaProvider.installCommand();
    const hardware = OllamaProvider.getSystemHardware();
    const requirements = OllamaProvider.hardwareRequirements();
    res.json({ installed, install, hardware, requirements });
  });

  // --- Credentials ---

  app.get('/api/credentials', (req, res) => {
    res.json(daemon.credentials.listProviders());
  });

  app.post('/api/credentials/:provider', (req, res) => {
    if (!req.body.key) return res.status(400).json({ error: 'key is required' });
    daemon.credentials.setKey(req.params.provider, req.body.key);
    daemon.audit.log('credential.set', { provider: req.params.provider });
    res.json({ ok: true, masked: daemon.credentials.mask(req.body.key) });
  });

  app.delete('/api/credentials/:provider', (req, res) => {
    daemon.credentials.deleteKey(req.params.provider);
    daemon.audit.log('credential.delete', { provider: req.params.provider });
    res.json({ ok: true });
  });

  // --- Model Routing ---

  app.get('/api/routing', (req, res) => {
    res.json(daemon.router.getStatus());
  });

  app.post('/api/agents/:id/routing', (req, res) => {
    daemon.router.setMode(req.params.id, req.body.mode, {
      fixedModel: req.body.fixedModel,
      floorModel: req.body.floorModel,
    });
    res.json(daemon.router.getMode(req.params.id));
  });

  app.get('/api/agents/:id/routing/recommend', (req, res) => {
    const rec = daemon.router.recommend(req.params.id);
    if (!rec) return res.status(404).json({ error: 'Agent not found' });
    res.json(rec);
  });

  // Daemon status
  app.get('/api/status', (req, res) => {
    res.json({
      pid: process.pid,
      uptime: process.uptime(),
      agents: daemon.registry.getAll().length,
      running: daemon.processes.getRunningCount(),
      host: daemon.host,
      port: daemon.port,
      projectDir: daemon.projectDir,
    });
  });

  // --- Teams (live agent groups) ---

  app.get('/api/teams', (req, res) => {
    res.json({
      teams: daemon.teams.list(),
      defaultTeamId: daemon.teams.getDefault()?.id || null,
    });
  });

  app.post('/api/teams', (req, res) => {
    try {
      const team = daemon.teams.create(req.body.name);
      daemon.audit.log('team.create', { id: team.id, name: team.name });
      res.status(201).json(team);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.patch('/api/teams/:id', (req, res) => {
    try {
      const team = daemon.teams.rename(req.params.id, req.body.name);
      daemon.audit.log('team.rename', { id: team.id, name: team.name });
      res.json(team);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete('/api/teams/:id', (req, res) => {
    try {
      daemon.teams.delete(req.params.id);
      daemon.audit.log('team.delete', { id: req.params.id });
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // --- Approvals ---

  app.get('/api/approvals', (req, res) => {
    res.json({
      pending: daemon.supervisor.getPending(),
      resolved: daemon.supervisor.getResolved().slice(-20),
      status: daemon.supervisor.getStatus(),
    });
  });

  app.post('/api/approvals/:id/approve', (req, res) => {
    const result = daemon.supervisor.approve(req.params.id);
    if (!result) return res.status(404).json({ error: 'Approval not found' });
    daemon.audit.log('approval.approve', { id: req.params.id });
    res.json(result);
  });

  app.post('/api/approvals/:id/reject', (req, res) => {
    const result = daemon.supervisor.reject(req.params.id, req.body.reason);
    if (!result) return res.status(404).json({ error: 'Approval not found' });
    daemon.audit.log('approval.reject', { id: req.params.id, reason: req.body.reason });
    res.json(result);
  });

  // --- Token Summary ---

  app.get('/api/tokens/summary', (req, res) => {
    res.json(daemon.tokens.getSummary());
  });

  // Rotate an agent
  app.post('/api/agents/:id/rotate', async (req, res) => {
    try {
      const oldAgent = daemon.registry.get(req.params.id);
      const newAgent = await daemon.rotator.rotate(req.params.id);
      daemon.audit.log('agent.rotate', { oldId: req.params.id, newId: newAgent.id, role: oldAgent?.role });
      res.json(newAgent);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Instruct an agent — resumes session if possible, falls back to rotation
  // Resume = zero cold-start (uses --resume SESSION_ID)
  // Rotation = full handoff brief (only for degradation or no session)
  app.post('/api/agents/:id/instruct', async (req, res) => {
    try {
      const { message } = req.body;
      if (!message || typeof message !== 'string' || !message.trim()) {
        return res.status(400).json({ error: 'message is required' });
      }
      const agent = daemon.registry.get(req.params.id);
      if (!agent) return res.status(404).json({ error: 'Agent not found' });

      // Try session resume first (zero cold-start)
      // Falls back to rotation if no session ID or provider doesn't support resume
      const resumed = !!agent.sessionId;
      const newAgent = resumed
        ? await daemon.processes.resume(req.params.id, message.trim())
        : await daemon.rotator.rotate(req.params.id, { additionalPrompt: message.trim() });

      daemon.audit.log('agent.instruct', { id: req.params.id, newId: newAgent.id, resumed });
      res.json(newAgent);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Query an agent (headless one-shot, agent keeps running)
  app.post('/api/agents/:id/query', async (req, res) => {
    try {
      const { message } = req.body;
      if (!message || typeof message !== 'string' || !message.trim()) {
        return res.status(400).json({ error: 'message is required' });
      }
      const agent = daemon.registry.get(req.params.id);
      if (!agent) return res.status(404).json({ error: 'Agent not found' });

      // Build context about the agent's work
      const activity = daemon.classifier?.agentWindows?.[agent.id] || [];
      const recentActivity = activity.slice(-20).map((e) => e.data || e.text || '').join('\n');

      const prompt = [
        `You are answering a question about agent "${agent.name}" (role: ${agent.role}).`,
        `This agent's file scope: ${(agent.scope || []).join(', ') || 'unrestricted'}`,
        `Provider: ${agent.provider}, Tokens used: ${agent.tokensUsed || 0}`,
        agent.prompt ? `Original task: ${agent.prompt}` : '',
        recentActivity ? `\nRecent activity:\n${recentActivity}` : '',
        `\nUser question: ${message.trim()}`,
        '\nAnswer concisely based on the agent context above.',
      ].filter(Boolean).join('\n');

      const response = await daemon.journalist.callHeadless(prompt);
      res.json({ response, agentId: agent.id, agentName: agent.name });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Rotation stats
  app.get('/api/rotation', (req, res) => {
    res.json({
      ...daemon.rotator.getStats(),
      history: daemon.rotator.getHistory(),
    });
  });

  // Journalist status & history
  app.get('/api/journalist', (req, res) => {
    res.json({
      ...daemon.journalist.getStatus(),
      history: daemon.journalist.getHistory(),
      lastSynthesis: daemon.journalist.getLastSynthesis(),
    });
  });

  // Plan chat — direct API (fast, sub-second) when API key available, CLI fallback otherwise
  const PLAN_SYSTEM = `You are the planning assistant built into Groove's spawn panel. The user is configuring an AI agent right now — they're looking at a form with role selection, file scope, skills, integrations, effort level, and a task prompt. Your conversation will be synthesized into the agent's task prompt when they click "Generate Prompt."

Your job: help them think through what the agent should do, then craft a clear plan. Be direct and practical. Don't ask how they'll feed input to agents or what tools to use — they're already inside Groove doing it. Focus on the TASK itself.

What you know about the system:
- The user is in the spawn panel, configuring an agent before launching it
- The left panel has: role picker, directory, permissions, effort, integrations, skills, schedule
- When done planning, "Generate Prompt" synthesizes this chat into the agent's task prompt
- Agents are Claude Code instances with full terminal/file access in the specified directory
- Agents can read/write files, run commands, use MCP integrations (Slack, GitHub, etc.)
- The journalist system prevents cold starts during context rotation — agents don't lose context

Keep responses concise. Help them think, don't lecture them about the system they built.`;

  app.post('/api/journalist/query', async (req, res) => {
    try {
      const { prompt } = req.body || {};
      if (!prompt) return res.status(400).json({ error: 'prompt is required' });

      // Fast path: direct Anthropic API call (sub-second)
      const apiKey = daemon.credentials.getKey('anthropic-api');
      if (apiKey) {
        const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 1024,
            system: PLAN_SYSTEM,
            messages: [{ role: 'user', content: prompt }],
          }),
        });
        const data = await apiRes.json();
        if (data.content?.[0]?.text) {
          return res.json({ response: data.content[0].text, mode: 'fast' });
        }
        if (data.error) {
          return res.status(400).json({ error: data.error.message || 'API error' });
        }
      }

      // Slow path: CLI fallback for subscription auth (~10s)
      const fullPrompt = `${PLAN_SYSTEM}\n\n${prompt}`;
      const response = await daemon.journalist.callHeadless(fullPrompt);
      res.json({ response, mode: 'cli' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Check if Anthropic API key is configured
  app.get('/api/anthropic-key/status', (req, res) => {
    const hasKey = !!daemon.credentials.getKey('anthropic-api');
    res.json({ configured: hasKey });
  });

  // Trigger journalist cycle manually
  app.post('/api/journalist/cycle', async (req, res) => {
    try {
      await daemon.journalist.cycle();
      res.json({ ok: true, cycle: daemon.journalist.cycleCount });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Adaptive thresholds
  app.get('/api/adaptive', (req, res) => {
    res.json(daemon.adaptive.getAllProfiles());
  });

  // --- Marketplace Auth ---

  // Browser login callback — Studio redirects here with the JWT
  app.get('/api/auth/callback', async (req, res) => {
    const { token } = req.query;
    if (!token) {
      return res.status(400).send('<html><body><h2>Missing token</h2><p>Login failed. Close this tab and try again.</p></body></html>');
    }

    const user = await daemon.skills.setAuth(token);
    if (!user) {
      return res.send(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Groove — Login Failed</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:#1a1e25;color:#bcc2cd;font-family:-apple-system,system-ui,'Segoe UI',sans-serif;display:flex;align-items:center;justify-content:center;height:100vh}
  .card{text-align:center;padding:48px;border-radius:8px;border:1px solid #2c313a;background:#20242b;max-width:380px;width:100%}
  .icon{width:48px;height:48px;border-radius:12px;margin:0 auto 20px;display:flex;align-items:center;justify-content:center;background:rgba(224,108,117,0.1);border:1px solid rgba(224,108,117,0.2)}
  .icon svg{width:24px;height:24px;color:#e06c75}
  h2{font-size:16px;font-weight:600;color:#e6e6e6;margin-bottom:8px}
  p{font-size:13px;color:#505862;line-height:1.5}
</style>
</head><body>
<div class="card">
  <div class="icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></div>
  <h2>Login failed</h2>
  <p>Invalid or expired token. Close this tab and try again from the app.</p>
</div>
</body></html>`);
    }

    const displayName = user?.displayName || user?.id || '';
    res.send(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Groove — Signed In</title>
<link rel="icon" href="/favicon.png">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:#1a1e25;color:#bcc2cd;font-family:-apple-system,system-ui,'Segoe UI',sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;overflow:hidden}
  .card{text-align:center;padding:48px;border-radius:8px;border:1px solid #2c313a;background:#20242b;max-width:380px;width:100%}
  .logo{width:48px;height:48px;border-radius:12px;margin:0 auto 20px;display:flex;align-items:center;justify-content:center;background:rgba(51,175,188,0.1);border:1px solid rgba(51,175,188,0.2)}
  .logo svg{width:24px;height:24px;color:#33afbc}
  h2{font-size:16px;font-weight:600;color:#e6e6e6;margin-bottom:6px}
  .user{font-size:13px;color:#33afbc;margin-bottom:16px}
  p{font-size:13px;color:#505862;line-height:1.5}
  .bar{width:120px;height:2px;background:#2c313a;border-radius:1px;margin:20px auto 0;overflow:hidden}
  .bar span{display:block;height:100%;background:#33afbc;border-radius:1px;animation:close 3s linear forwards}
  @keyframes close{from{width:100%}to{width:0%}}
</style>
</head><body>
<div class="card">
  <div class="logo"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></div>
  <h2>Connected to Groove</h2>
  ${displayName ? `<div class="user">${displayName}</div>` : ''}
  <p>This tab will close automatically.</p>
  <div class="bar"><span></span></div>
</div>
<script>setTimeout(()=>window.close(),3000)</script>
</body></html>`);
  });

  // Auth status — returns current user or { authenticated: false }
  app.get('/api/auth/status', async (req, res) => {
    const user = daemon.skills.getUser();
    const token = daemon.skills.getToken();
    if (!user || !token) return res.json({ authenticated: false });
    res.json({ authenticated: true, user });
  });

  // Validate stored token (hits remote API)
  app.post('/api/auth/validate', async (req, res) => {
    const user = await daemon.skills.validateAuth();
    if (!user) return res.json({ authenticated: false });
    res.json({ authenticated: true, user });
  });

  // Get login URL for browser redirect
  app.get('/api/auth/login-url', (req, res) => {
    res.json({ url: daemon.skills.getLoginUrl() });
  });

  // Logout — clear stored token
  app.post('/api/auth/logout', async (req, res) => {
    await daemon.skills.clearAuth();
    res.json({ ok: true });
  });

  // User's purchases
  app.get('/api/auth/purchases', async (req, res) => {
    const purchases = await daemon.skills.getPurchases();
    res.json({ purchases });
  });

  // Check single purchase
  app.get('/api/auth/purchases/check/:skillId', async (req, res) => {
    const purchased = await daemon.skills.checkPurchase(req.params.skillId);
    res.json({ purchased });
  });

  // Start Stripe checkout for paid skill
  app.post('/api/auth/checkout', async (req, res) => {
    try {
      const { skillId } = req.body;
      if (!skillId) return res.status(400).json({ error: 'skillId required' });
      const result = await daemon.skills.checkout(skillId);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

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

  // --- Agent Skills (attach/detach) ---

  app.post('/api/agents/:agentId/skills/:skillId', (req, res) => {
    const agent = daemon.registry.get(req.params.agentId);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    const skillId = req.params.skillId;
    if (!daemon.skills.getContent(skillId)) {
      return res.status(400).json({ error: 'Skill not installed. Install it first.' });
    }
    const skills = agent.skills || [];
    if (skills.includes(skillId)) {
      return res.json({ id: agent.id, skills });
    }
    daemon.registry.update(agent.id, { skills: [...skills, skillId] });
    daemon.audit.log('skill.attach', { agentId: agent.id, skillId });
    res.json({ id: agent.id, skills: [...skills, skillId] });
  });

  app.delete('/api/agents/:agentId/skills/:skillId', (req, res) => {
    const agent = daemon.registry.get(req.params.agentId);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    const skills = (agent.skills || []).filter((s) => s !== req.params.skillId);
    daemon.registry.update(agent.id, { skills });
    daemon.audit.log('skill.detach', { agentId: agent.id, skillId: req.params.skillId });
    res.json({ id: agent.id, skills });
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
    try {
      const { code, state } = req.query;
      if (!code || !state) return res.status(400).send('Missing code or state parameter');
      await daemon.integrations.handleOAuthCallback(code, state);
      res.send(`<!DOCTYPE html><html><body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#1e2127;color:#e6e6e6">
        <div style="text-align:center">
          <div style="font-size:48px;margin-bottom:16px">&#10003;</div>
          <h2>Connected!</h2>
          <p style="color:#7a8394">You can close this tab and return to Groove.</p>
          <script>setTimeout(()=>window.close(),2000)</script>
        </div>
      </body></html>`);
    } catch (err) {
      res.status(400).send(`<!DOCTYPE html><html><body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#1e2127;color:#e06c75">
        <div style="text-align:center">
          <h2>Connection Failed</h2>
          <p>${err.message}</p>
          <p style="color:#7a8394">Close this tab and try again in Groove.</p>
        </div>
      </body></html>`);
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

  // --- Agent Integrations (attach/detach) ---

  app.post('/api/agents/:agentId/integrations/:integrationId', (req, res) => {
    const agent = daemon.registry.get(req.params.agentId);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    const integrationId = req.params.integrationId;
    if (!daemon.integrations._isInstalled(integrationId)) {
      return res.status(400).json({ error: 'Integration not installed. Install it first.' });
    }
    const integrations = agent.integrations || [];
    if (integrations.includes(integrationId)) {
      return res.json({ id: agent.id, integrations });
    }
    daemon.registry.update(agent.id, { integrations: [...integrations, integrationId] });
    daemon.audit.log('integration.attach', { agentId: agent.id, integrationId });
    res.json({ id: agent.id, integrations: [...integrations, integrationId] });
  });

  app.delete('/api/agents/:agentId/integrations/:integrationId', (req, res) => {
    const agent = daemon.registry.get(req.params.agentId);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    const integrations = (agent.integrations || []).filter((s) => s !== req.params.integrationId);
    daemon.registry.update(agent.id, { integrations });
    daemon.audit.log('integration.detach', { agentId: agent.id, integrationId: req.params.integrationId });
    res.json({ id: agent.id, integrations });
  });

  // --- Schedules ---

  app.get('/api/schedules', (req, res) => {
    res.json(daemon.scheduler.list());
  });

  app.post('/api/schedules', (req, res) => {
    try {
      const schedule = daemon.scheduler.create(req.body);
      res.status(201).json(schedule);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/api/schedules/:id', (req, res) => {
    const schedule = daemon.scheduler.get(req.params.id);
    if (!schedule) return res.status(404).json({ error: 'Schedule not found' });
    res.json(schedule);
  });

  app.patch('/api/schedules/:id', (req, res) => {
    try {
      const schedule = daemon.scheduler.update(req.params.id, req.body);
      res.json(schedule);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete('/api/schedules/:id', (req, res) => {
    try {
      daemon.scheduler.delete(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/schedules/:id/enable', (req, res) => {
    try {
      res.json(daemon.scheduler.enable(req.params.id));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/schedules/:id/disable', (req, res) => {
    try {
      res.json(daemon.scheduler.disable(req.params.id));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/schedules/:id/run', async (req, res) => {
    try {
      const agent = await daemon.scheduler.run(req.params.id);
      res.json({ ok: true, agentId: agent.id });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // --- Directory Browser ---

  app.get('/api/browse', (req, res) => {
    const relPath = req.query.path || '';

    // Security: no absolute paths, no traversal
    if (relPath.startsWith('/') || relPath.includes('..') || relPath.includes('\0')) {
      return res.status(400).json({ error: 'Invalid path' });
    }

    const fullPath = relPath ? resolve(daemon.projectDir, relPath) : daemon.projectDir;

    // Must stay within project directory
    if (!fullPath.startsWith(daemon.projectDir)) {
      return res.status(400).json({ error: 'Path outside project' });
    }

    if (!existsSync(fullPath)) {
      return res.status(404).json({ error: 'Directory not found' });
    }

    try {
      const entries = readdirSync(fullPath, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((e) => {
          const childPath = relPath ? `${relPath}/${e.name}` : e.name;
          const childFull = resolve(fullPath, e.name);
          let hasChildren = false;
          let childCount = 0;
          let fileCount = 0;
          try {
            const children = readdirSync(childFull, { withFileTypes: true });
            for (const c of children) {
              if (c.name.startsWith('.') || c.name === 'node_modules') continue;
              if (c.isDirectory()) { childCount++; hasChildren = true; }
              else fileCount++;
            }
          } catch { /* unreadable */ }
          return { name: e.name, path: childPath, hasChildren, childCount, fileCount };
        });

      // Count files in current dir
      let currentFiles = 0;
      try {
        currentFiles = readdirSync(fullPath, { withFileTypes: true })
          .filter((e) => e.isFile() && !e.name.startsWith('.')).length;
      } catch { /* ignore */ }

      res.json({
        current: relPath || '.',
        parent: relPath ? relPath.split('/').slice(0, -1).join('/') : null,
        dirs: entries,
        fileCount: currentFiles,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Browse absolute paths (for directory picker in agent config)
  // Dirs only, localhost-only, no file content exposed
  app.get('/api/browse-system', (req, res) => {
    const absPath = req.query.path || process.env.HOME || '/';
    if (absPath.includes('\0')) return res.status(400).json({ error: 'Invalid path' });
    if (!existsSync(absPath)) return res.status(404).json({ error: 'Not found' });

    try {
      const entries = readdirSync(absPath, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((e) => {
          const full = resolve(absPath, e.name);
          let hasChildren = false;
          try {
            hasChildren = readdirSync(full, { withFileTypes: true })
              .some((c) => c.isDirectory() && !c.name.startsWith('.') && c.name !== 'node_modules');
          } catch { /* unreadable */ }
          return { name: e.name, path: full, hasChildren };
        });

      const parent = absPath === '/' ? null : resolve(absPath, '..');
      res.json({ current: absPath, parent, dirs: entries });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- File Editor API ---

  const LANG_MAP = {
    js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
    ts: 'typescript', tsx: 'typescript',
    css: 'css', scss: 'css', html: 'html', json: 'json',
    md: 'markdown', py: 'python', rs: 'rust', go: 'go',
    sh: 'shell', bash: 'shell', zsh: 'shell',
    yaml: 'yaml', yml: 'yaml', toml: 'toml',
    sql: 'sql', xml: 'xml', java: 'java', c: 'cpp', cpp: 'cpp', h: 'cpp',
    rb: 'ruby', php: 'php', swift: 'swift', kt: 'kotlin',
    dockerfile: 'dockerfile', makefile: 'makefile',
  };
  function detectLanguage(filename) {
    const ext = filename.split('.').pop()?.toLowerCase();
    return LANG_MAP[ext] || 'text';
  }

  const IGNORED_NAMES = new Set(['.git', 'node_modules', '.DS_Store', '.groove', '__pycache__', '.next', '.cache', 'dist', 'coverage']);

  // Editor root directory — defaults to projectDir but can be changed at runtime
  let editorRootDir = daemon.projectDir;

  function getEditorRoot() { return editorRootDir; }

  function validateFilePath(relPath, projectDir) {
    if (!relPath || typeof relPath !== 'string') return { error: 'path is required' };
    if (relPath.startsWith('/') || relPath.includes('..') || relPath.includes('\0')) {
      return { error: 'Invalid path' };
    }
    const fullPath = resolve(projectDir, relPath);
    if (!fullPath.startsWith(projectDir)) return { error: 'Path outside project' };
    return { fullPath };
  }

  // Get/set the editor working directory
  app.get('/api/files/root', (req, res) => {
    res.json({ root: editorRootDir });
  });

  app.post('/api/files/root', (req, res) => {
    const { root } = req.body || {};
    if (!root || typeof root !== 'string') return res.status(400).json({ error: 'root path is required' });
    // Must be absolute and exist
    if (!root.startsWith('/')) return res.status(400).json({ error: 'root must be an absolute path' });
    if (root.includes('\0') || root.includes('..')) return res.status(400).json({ error: 'Invalid path' });
    if (!existsSync(root)) return res.status(404).json({ error: 'Directory not found' });
    try {
      const stat = statSync(root);
      if (!stat.isDirectory()) return res.status(400).json({ error: 'Path is not a directory' });
    } catch { return res.status(400).json({ error: 'Cannot access directory' }); }
    editorRootDir = root;
    daemon.audit.log('editor.root.set', { root });
    res.json({ ok: true, root: editorRootDir });
  });

  // File tree — returns dirs + files for a given path
  app.get('/api/files/tree', (req, res) => {
    const relPath = req.query.path || '';

    // Security: reuse browse validation
    if (relPath && (relPath.startsWith('/') || relPath.includes('..') || relPath.includes('\0'))) {
      return res.status(400).json({ error: 'Invalid path' });
    }

    const rootDir = getEditorRoot();
    const fullPath = relPath ? resolve(rootDir, relPath) : rootDir;
    if (!fullPath.startsWith(rootDir)) {
      return res.status(400).json({ error: 'Path outside project' });
    }
    if (!existsSync(fullPath)) {
      return res.status(404).json({ error: 'Directory not found' });
    }

    try {
      const raw = readdirSync(fullPath, { withFileTypes: true });
      const entries = [];

      // Dirs first (sorted), then files (sorted)
      const dirs = raw.filter((e) => e.isDirectory() && !IGNORED_NAMES.has(e.name) && !e.name.startsWith('.'))
        .sort((a, b) => a.name.localeCompare(b.name));
      const files = raw.filter((e) => e.isFile() && !e.name.startsWith('.'))
        .sort((a, b) => a.name.localeCompare(b.name));

      for (const d of dirs) {
        const childPath = relPath ? `${relPath}/${d.name}` : d.name;
        const childFull = resolve(fullPath, d.name);
        let hasChildren = false;
        try {
          const children = readdirSync(childFull, { withFileTypes: true });
          hasChildren = children.some((c) => !c.name.startsWith('.') && !IGNORED_NAMES.has(c.name));
        } catch { /* unreadable */ }
        entries.push({ name: d.name, type: 'dir', path: childPath, hasChildren });
      }

      for (const f of files) {
        const childPath = relPath ? `${relPath}/${f.name}` : f.name;
        let size = 0;
        try { size = statSync(resolve(fullPath, f.name)).size; } catch { /* ignore */ }
        entries.push({
          name: f.name, type: 'file', path: childPath, size,
          language: detectLanguage(f.name),
        });
      }

      res.json({
        current: relPath || '.',
        parent: relPath ? relPath.split('/').slice(0, -1).join('/') : null,
        entries,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Read file contents
  app.get('/api/files/read', (req, res) => {
    const result = validateFilePath(req.query.path, getEditorRoot());
    if (result.error) return res.status(400).json({ error: result.error });

    if (!existsSync(result.fullPath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    try {
      const stat = statSync(result.fullPath);
      if (stat.size > 5 * 1024 * 1024) {
        return res.status(400).json({ error: 'File too large (>5MB)' });
      }

      // Binary detection: check first 8KB for null bytes
      const buf = readFileSync(result.fullPath);
      const sample = buf.subarray(0, 8192);
      if (sample.includes(0)) {
        return res.json({ path: req.query.path, binary: true, size: stat.size });
      }

      const content = buf.toString('utf8');
      const filename = req.query.path.split('/').pop();
      res.json({
        path: req.query.path,
        content,
        size: stat.size,
        language: detectLanguage(filename),
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Write file contents
  app.post('/api/files/write', (req, res) => {
    const { path: relPath, content } = req.body;
    const result = validateFilePath(relPath, getEditorRoot());
    if (result.error) return res.status(400).json({ error: result.error });

    if (typeof content !== 'string') {
      return res.status(400).json({ error: 'content must be a string' });
    }
    if (content.length > 5 * 1024 * 1024) {
      return res.status(400).json({ error: 'Content too large (>5MB)' });
    }

    try {
      writeFileSync(result.fullPath, content, 'utf8');
      daemon.audit.log('file.write', { path: relPath });
      res.json({ ok: true, size: Buffer.byteLength(content, 'utf8') });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Create a new file
  app.post('/api/files/create', (req, res) => {
    const { path: relPath, content = '' } = req.body;
    const result = validateFilePath(relPath, getEditorRoot());
    if (result.error) return res.status(400).json({ error: result.error });

    if (existsSync(result.fullPath)) {
      return res.status(409).json({ error: 'File already exists' });
    }

    try {
      // Ensure parent directory exists
      const parentDir = resolve(result.fullPath, '..');
      if (!parentDir.startsWith(daemon.projectDir)) {
        return res.status(400).json({ error: 'Path outside project' });
      }
      mkdirSync(parentDir, { recursive: true });
      writeFileSync(result.fullPath, content, 'utf8');
      daemon.audit.log('file.create', { path: relPath });
      res.status(201).json({ ok: true, path: relPath });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Create a new directory
  app.post('/api/files/mkdir', (req, res) => {
    const { path: relPath } = req.body;
    const result = validateFilePath(relPath, getEditorRoot());
    if (result.error) return res.status(400).json({ error: result.error });

    if (existsSync(result.fullPath)) {
      return res.status(409).json({ error: 'Directory already exists' });
    }

    try {
      mkdirSync(result.fullPath, { recursive: true });
      daemon.audit.log('file.mkdir', { path: relPath });
      res.status(201).json({ ok: true, path: relPath });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Delete a file or directory
  app.delete('/api/files/delete', (req, res) => {
    const relPath = req.query.path || req.body?.path;
    const result = validateFilePath(relPath, getEditorRoot());
    if (result.error) return res.status(400).json({ error: result.error });

    if (!existsSync(result.fullPath)) {
      return res.status(404).json({ error: 'Not found' });
    }

    try {
      const stat = statSync(result.fullPath);
      if (stat.isDirectory()) {
        rmSync(result.fullPath, { recursive: true });
      } else {
        unlinkSync(result.fullPath);
      }
      daemon.audit.log('file.delete', { path: relPath });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Rename / move a file or directory
  app.post('/api/files/rename', (req, res) => {
    const { oldPath, newPath } = req.body;
    const oldResult = validateFilePath(oldPath, getEditorRoot());
    if (oldResult.error) return res.status(400).json({ error: oldResult.error });
    const newResult = validateFilePath(newPath, getEditorRoot());
    if (newResult.error) return res.status(400).json({ error: newResult.error });

    if (!existsSync(oldResult.fullPath)) {
      return res.status(404).json({ error: 'Source not found' });
    }
    if (existsSync(newResult.fullPath)) {
      return res.status(409).json({ error: 'Destination already exists' });
    }

    try {
      // Ensure parent of new path exists
      const parentDir = resolve(newResult.fullPath, '..');
      mkdirSync(parentDir, { recursive: true });
      renameSync(oldResult.fullPath, newResult.fullPath);
      daemon.audit.log('file.rename', { oldPath, newPath });
      res.json({ ok: true, oldPath, newPath });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Serve raw file (images, video, etc.)
  app.get('/api/files/raw', (req, res) => {
    const result = validateFilePath(req.query.path, getEditorRoot());
    if (result.error) return res.status(400).json({ error: result.error });

    if (!existsSync(result.fullPath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    try {
      const stat = statSync(result.fullPath);
      if (stat.size > 50 * 1024 * 1024) {
        return res.status(400).json({ error: 'File too large (>50MB)' });
      }
      const filename = req.query.path.split('/').pop();
      const contentType = mimeLookup(filename);
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', stat.size);
      res.setHeader('Cache-Control', 'no-cache');
      createReadStream(result.fullPath).pipe(res);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Codebase Indexer ---

  app.get('/api/indexer', (req, res) => {
    res.json(daemon.indexer.getStatus());
  });

  app.get('/api/indexer/workspaces', (req, res) => {
    res.json({
      workspaces: daemon.indexer.getWorkspaces(),
    });
  });

  app.post('/api/indexer/rescan', (req, res) => {
    try {
      daemon.indexer.scan();
      res.json({ ok: true, ...daemon.indexer.getStatus() });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Project Manager (AI Review Gate) ---

  // Agent knocks on PM before risky operations (Auto permission mode)
  app.post('/api/pm/review', async (req, res) => {
    try {
      const { agent, action, file, description } = req.body;
      if (!agent || !action || !file) {
        return res.status(400).json({ error: 'agent, action, and file are required' });
      }
      const result = await daemon.pm.review({ agent, action, file, description: description || '' });
      res.json(result);
    } catch (err) {
      // On failure, approve by default (don't block agents)
      res.json({ approved: true, reason: `PM error: ${err.message}. Auto-approved.` });
    }
  });

  // PM review history for Approvals tab
  app.get('/api/pm/history', (req, res) => {
    res.json({
      history: daemon.pm.getHistory(),
      stats: daemon.pm.getStats(),
    });
  });

  // --- Recommended Team (from planner) ---

  // Find recommended-team.json — check all agent working dirs, then daemon's grooveDir
  function findRecommendedTeam() {
    // Check agent working dirs first (planner may have written there)
    const agents = daemon.registry.getAll();
    for (const agent of agents) {
      if (agent.workingDir) {
        const p = resolve(agent.workingDir, '.groove', 'recommended-team.json');
        if (existsSync(p)) return p;
      }
    }
    // Fallback to daemon's .groove dir
    const p = resolve(daemon.grooveDir, 'recommended-team.json');
    if (existsSync(p)) return p;
    return null;
  }

  app.get('/api/recommended-team', (req, res) => {
    const teamPath = findRecommendedTeam();
    if (!teamPath) {
      return res.json({ exists: false, agents: [] });
    }
    try {
      const agents = JSON.parse(readFileSync(teamPath, 'utf8'));
      res.json({ exists: true, agents: Array.isArray(agents) ? agents : [] });
    } catch {
      res.json({ exists: false, agents: [] });
    }
  });

  app.post('/api/recommended-team/launch', async (req, res) => {
    const teamPath = findRecommendedTeam();
    if (!teamPath) {
      return res.status(404).json({ error: 'No recommended team found. Run a planner first.' });
    }
    try {
      const agents = JSON.parse(readFileSync(teamPath, 'utf8'));
      if (!Array.isArray(agents) || agents.length === 0) {
        return res.status(400).json({ error: 'Recommended team is empty' });
      }

      const defaultDir = daemon.config?.defaultWorkingDir || undefined;

      // Separate phase 1 (builders) and phase 2 (QC/finisher)
      const phase1 = agents.filter((a) => !a.phase || a.phase === 1);
      let phase2 = agents.filter((a) => a.phase === 2);

      // Safety net: if planner forgot the QC agent, auto-add one
      if (phase2.length === 0 && phase1.length >= 2) {
        phase2 = [{
          role: 'fullstack', phase: 2, scope: [],
          prompt: 'QC Senior Dev: All builder agents have completed. Audit their changes for correctness, fix any issues, run tests, build the project, commit all changes, and launch. Output the localhost URL where the app can be accessed.',
        }];
      }

      // Spawn phase 1 agents immediately
      const spawned = [];
      const phase1Ids = [];
      for (const config of phase1) {
        const validated = validateAgentConfig({
          role: config.role,
          scope: config.scope || [],
          prompt: config.prompt || '',
          provider: config.provider || 'claude-code',
          model: config.model || 'auto',
          permission: config.permission || 'auto',
          workingDir: config.workingDir || defaultDir,
          name: config.name || undefined,
        });
        const agent = await daemon.processes.spawn(validated);
        spawned.push({ id: agent.id, name: agent.name, role: agent.role });
        phase1Ids.push(agent.id);
      }

      // If there are phase 2 agents, register them for auto-spawn on phase 1 completion
      if (phase2.length > 0 && phase1Ids.length > 0) {
        daemon._pendingPhase2 = daemon._pendingPhase2 || [];
        daemon._pendingPhase2.push({
          waitFor: phase1Ids,
          agents: phase2.map((c) => ({
            role: c.role, scope: c.scope || [], prompt: c.prompt || '',
            provider: c.provider || 'claude-code', model: c.model || 'auto',
            permission: c.permission || 'auto',
            workingDir: c.workingDir || defaultDir,
            name: c.name || undefined,
          })),
        });
      }

      daemon.audit.log('team.launch', {
        phase1: spawned.length, phase2Pending: phase2.length,
        agents: spawned.map((a) => a.role),
      });
      res.json({ launched: spawned.length, phase2Pending: phase2.length, agents: spawned });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Clean up stale artifacts (old plans, recommended teams, etc.)
  app.post('/api/cleanup', (req, res) => {
    let cleaned = 0;
    // Clean recommended-team.json from all known locations
    const locations = [resolve(daemon.grooveDir, 'recommended-team.json')];
    for (const agent of daemon.registry.getAll()) {
      if (agent.workingDir) {
        locations.push(resolve(agent.workingDir, '.groove', 'recommended-team.json'));
      }
    }
    const defaultDir = daemon.config?.defaultWorkingDir;
    if (defaultDir) locations.push(resolve(defaultDir, '.groove', 'recommended-team.json'));

    for (const p of locations) {
      if (existsSync(p)) { try { unlinkSync(p); cleaned++; } catch { /* */ } }
    }
    daemon.audit.log('cleanup', { cleaned });
    res.json({ ok: true, cleaned });
  });

  // --- Command Center Dashboard ---

  app.get('/api/dashboard', (req, res) => {
    const agents = daemon.registry.getAll();
    const tokenSummary = daemon.tokens.getSummary();

    // Token tracker might not have been fed — use registry as source of truth
    const registryTokens = agents.reduce((sum, a) => sum + (a.tokensUsed || 0), 0);
    if (registryTokens > tokenSummary.totalTokens) {
      tokenSummary.totalTokens = registryTokens;
      // Recalculate savings estimates
      const estimated = registryTokens + tokenSummary.savings.total;
      tokenSummary.savings.estimatedWithoutGroove = estimated;
      tokenSummary.savings.percentage = estimated > 0
        ? Math.round((tokenSummary.savings.total / estimated) * 100) : 0;
    }
    const rotationStats = daemon.rotator.getStats();
    const rotationHistory = daemon.rotator.getHistory();
    const routingStatus = daemon.router.getStatus();
    const journalistStatus = daemon.journalist.getStatus();

    // Aggregate routing cost log by tier
    const routingByTier = { light: 0, medium: 0, heavy: 0 };
    const costByTier = { light: 0, medium: 0, heavy: 0 };
    let autoRoutedCount = 0;
    for (const [, mode] of Object.entries(routingStatus.agentModes || {})) {
      if (mode.mode === 'auto') autoRoutedCount++;
    }
    for (const entry of daemon.router.costLog || []) {
      if (routingByTier[entry.tier] !== undefined) routingByTier[entry.tier]++;
      if (entry.tokens && entry.tier) {
        // Estimate cost by tier using median rates
        const rates = { heavy: 0.045, medium: 0.009, light: 0.0024 };
        costByTier[entry.tier] += (entry.tokens / 1000) * (rates[entry.tier] || 0.009);
      }
    }

    // Per-agent enriched data with quality signals
    const agentBreakdown = agents.map((a) => {
      const tokenData = daemon.tokens.getAgent(a.id);
      const agentCacheTotal = (tokenData.cacheReadTokens || 0) + (tokenData.cacheCreationTokens || 0) + (tokenData.inputTokens || 0);

      // Quality signals from classifier + adaptive
      let quality = null;
      try {
        const signals = daemon.adaptive.extractSignals ? daemon.adaptive.extractSignals(a.id) : null;
        const classification = daemon.classifier.classify(a.id);
        if (signals || classification) {
          quality = {
            score: signals?.score || null,
            errorCount: signals?.errorCount || 0,
            toolCalls: signals?.toolCalls || 0,
            toolFailures: signals?.toolFailures || 0,
            toolSuccessRate: signals?.toolCalls > 0 ? 1 - (signals.toolFailures / signals.toolCalls) : 1,
            filesWritten: signals?.filesWritten || 0,
            fileChurn: signals?.fileChurn || 0,
            repetitions: signals?.repetitions || 0,
            tier: classification?.tier || 'medium',
          };
        }
      } catch { /* classifier/adaptive may not have data for this agent */ }

      return {
        id: a.id,
        name: a.name,
        role: a.role,
        status: a.status,
        provider: a.provider,
        model: a.model || 'default',
        routingMode: a.routingMode || 'fixed',
        routingReason: a.routingReason || null,
        tokens: a.tokensUsed || 0,
        costUsd: a.costUsd || tokenData.totalCostUsd || 0,
        costSource: a.provider === 'claude-code' ? 'actual' : a.provider === 'ollama' ? 'local' : 'estimated',
        inputTokens: tokenData.inputTokens || 0,
        outputTokens: tokenData.outputTokens || 0,
        cacheHitRate: agentCacheTotal > 0 ? Math.round(((tokenData.cacheReadTokens || 0) / agentCacheTotal) * 1000) / 1000 : 0,
        contextUsage: a.contextUsage || 0,
        durationMs: a.durationMs || tokenData.totalDurationMs || 0,
        turns: a.turns || tokenData.totalTurns || 0,
        modelDistribution: tokenData.modelDistribution || {},
        teamId: a.teamId || null,
        spawnedAt: a.spawnedAt,
        lastActivity: a.lastActivity || null,
        quality,
      };
    });

    // Adaptive profiles summary — include history for threshold drift charts
    const profiles = daemon.adaptive.getAllProfiles();
    const profileSummary = Object.entries(profiles).map(([key, p]) => ({
      key,
      threshold: p.threshold,
      converged: p.converged,
      adjustments: p.adjustmentCount,
      recentScores: (p.history || []).slice(-20).map((h) => h.score),
      thresholdHistory: (p.history || []).slice(-20).map((h) => ({ t: h.timestamp, v: h.newThreshold })),
      lastSignals: p.history?.length > 0 ? p.history[p.history.length - 1].signals : null,
    }));

    // Journalist — include synthesis summary and recent history
    const lastSynthesis = daemon.journalist.getLastSynthesis();
    const journalistHistory = daemon.journalist.getHistory().slice(-10);

    // Timeline data
    const timelineData = daemon.timeline ? {
      snapshots: daemon.timeline.getSnapshots(200),
      events: daemon.timeline.getEvents(100),
    } : { snapshots: [], events: [] };

    res.json({
      tokens: tokenSummary,
      agents: {
        total: agents.length,
        running: agents.filter((a) => a.status === 'running').length,
        completed: agents.filter((a) => a.status === 'completed').length,
        crashed: agents.filter((a) => a.status === 'crashed').length,
        breakdown: agentBreakdown,
      },
      routing: {
        autoRoutedCount,
        byTier: routingByTier,
        costByTier,
        totalDecisions: daemon.router.costLog?.length || 0,
      },
      rotation: {
        ...rotationStats,
        history: rotationHistory.slice(-20),
      },
      adaptive: profileSummary,
      journalist: {
        ...journalistStatus,
        lastSummary: lastSynthesis?.summary || '',
        recentHistory: journalistHistory,
      },
      timeline: timelineData,
      activeTeam: daemon.teams?.getActiveTeam?.() || null,
      uptime: process.uptime(),
    });
  });

  // --- Federation ---

  // Federation status
  app.get('/api/federation', (req, res) => {
    res.json(daemon.federation.getStatus());
  });

  // List peers
  app.get('/api/federation/peers', (req, res) => {
    res.json(daemon.federation.getPeers());
  });

  // Initiate pairing (local CLI calls this with the remote URL)
  app.post('/api/federation/initiate', async (req, res) => {
    try {
      const { remoteUrl } = req.body;
      if (!remoteUrl || typeof remoteUrl !== 'string') {
        return res.status(400).json({ error: 'remoteUrl is required' });
      }
      const result = await daemon.federation.initiatePairing(remoteUrl);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Accept pairing (remote daemon calls this during key exchange)
  app.post('/api/federation/pair', (req, res) => {
    try {
      const result = daemon.federation.acceptPairing(req.body);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Unpair a peer
  app.delete('/api/federation/peers/:id', (req, res) => {
    try {
      daemon.federation.unpair(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Receive a signed contract from a peer
  app.post('/api/federation/contract', (req, res) => {
    try {
      const { senderId, payload, signature } = req.body;
      if (!senderId || !payload || !signature) {
        return res.status(400).json({ error: 'senderId, payload, and signature are required' });
      }
      const result = daemon.federation.receiveContract(senderId, payload, signature);
      res.json(result);
    } catch (err) {
      res.status(403).json({ error: err.message });
    }
  });

  // Send a contract to a peer (local agents call this)
  app.post('/api/federation/contract/send', async (req, res) => {
    try {
      const { peerId, contract } = req.body;
      if (!peerId || !contract) {
        return res.status(400).json({ error: 'peerId and contract are required' });
      }
      const result = await daemon.federation.sendContract(peerId, contract);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // --- Audit Log ---

  app.get('/api/audit', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 500);
    res.json(daemon.audit.recent(limit));
  });

  // --- Config ---

  app.get('/api/config', (req, res) => {
    res.json(daemon.config || {});
  });

  app.patch('/api/config', async (req, res) => {
    const ALLOWED_KEYS = [
      'port', 'journalistInterval', 'rotationThreshold', 'autoRotation',
      'qcThreshold', 'maxAgents', 'defaultProvider', 'defaultWorkingDir',
    ];
    for (const key of Object.keys(req.body)) {
      if (!ALLOWED_KEYS.includes(key)) {
        return res.status(400).json({ error: `Unknown config key: ${key}` });
      }
      daemon.config[key] = req.body[key];
    }
    const { saveConfig } = await import('./firstrun.js');
    saveConfig(daemon.grooveDir, daemon.config);
    daemon.audit.log('config.set', { keys: Object.keys(req.body) });
    res.json(daemon.config);
  });

  // Serve GUI static files (built GUI)
  const guiPath = resolve(__dirname, '../../gui/dist');
  app.use(express.static(guiPath, { etag: false, maxAge: 0 }));

  // SPA fallback
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(resolve(guiPath, 'index.html'), (err) => {
      if (err) res.status(404).json({ error: 'GUI not built yet. Run: npm run build:gui' });
    });
  });
}
