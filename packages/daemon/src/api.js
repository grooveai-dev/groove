// GROOVE — REST API
// FSL-1.1-Apache-2.0 — see LICENSE

import express from 'express';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync } from 'fs';
import { listProviders } from './providers/index.js';
import { validateAgentConfig } from './validate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function createApi(app, daemon) {
  // CORS — restrict to localhost origins only
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    const allowed = [
      `http://localhost:${daemon.port}`,
      `http://127.0.0.1:${daemon.port}`,
      'http://localhost:3142', // Vite dev server
    ];
    if (!origin || allowed.includes(origin)) {
      res.header('Access-Control-Allow-Origin', origin || '*');
    }
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, PATCH');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  app.use(express.json({ limit: '1mb' }));

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
      const agent = await daemon.processes.spawn(config);
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

      res.json({ ok: true, purged: req.query.purge === 'true' || !isAlive });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Kill all agents
  app.delete('/api/agents', async (req, res) => {
    await daemon.processes.killAll();
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

  // --- Credentials ---

  app.get('/api/credentials', (req, res) => {
    res.json(daemon.credentials.listProviders());
  });

  app.post('/api/credentials/:provider', (req, res) => {
    if (!req.body.key) return res.status(400).json({ error: 'key is required' });
    daemon.credentials.setKey(req.params.provider, req.body.key);
    res.json({ ok: true, masked: daemon.credentials.mask(req.body.key) });
  });

  app.delete('/api/credentials/:provider', (req, res) => {
    daemon.credentials.deleteKey(req.params.provider);
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
      port: daemon.port,
      projectDir: daemon.projectDir,
    });
  });

  // --- Teams ---

  app.get('/api/teams', (req, res) => {
    res.json({
      teams: daemon.teams.list(),
      activeTeam: daemon.teams.getActiveTeam(),
    });
  });

  app.post('/api/teams', (req, res) => {
    try {
      const team = daemon.teams.save(req.body.name);
      res.status(201).json(team);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/teams/:name/load', async (req, res) => {
    try {
      const result = await daemon.teams.load(req.params.name);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete('/api/teams/:name', (req, res) => {
    try {
      daemon.teams.delete(req.params.name);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/api/teams/:name/export', (req, res) => {
    try {
      const json = daemon.teams.export(req.params.name);
      res.type('application/json').send(json);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/teams/import', (req, res) => {
    try {
      const team = daemon.teams.import(JSON.stringify(req.body));
      res.status(201).json(team);
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
    res.json(result);
  });

  app.post('/api/approvals/:id/reject', (req, res) => {
    const result = daemon.supervisor.reject(req.params.id, req.body.reason);
    if (!result) return res.status(404).json({ error: 'Approval not found' });
    res.json(result);
  });

  // --- Token Summary ---

  app.get('/api/tokens/summary', (req, res) => {
    res.json(daemon.tokens.getSummary());
  });

  // Rotate an agent
  app.post('/api/agents/:id/rotate', async (req, res) => {
    try {
      const newAgent = await daemon.rotator.rotate(req.params.id);
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
      const newAgent = agent.sessionId
        ? await daemon.processes.resume(req.params.id, message.trim())
        : await daemon.rotator.rotate(req.params.id, { additionalPrompt: message.trim() });

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

  app.get('/api/recommended-team', (req, res) => {
    const teamPath = resolve(daemon.grooveDir, 'recommended-team.json');
    if (!existsSync(teamPath)) {
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
    const teamPath = resolve(daemon.grooveDir, 'recommended-team.json');
    if (!existsSync(teamPath)) {
      return res.status(404).json({ error: 'No recommended team found. Run a planner first.' });
    }
    try {
      const agents = JSON.parse(readFileSync(teamPath, 'utf8'));
      if (!Array.isArray(agents) || agents.length === 0) {
        return res.status(400).json({ error: 'Recommended team is empty' });
      }

      const spawned = [];
      for (const config of agents) {
        const validated = validateAgentConfig({
          role: config.role,
          scope: config.scope || [],
          prompt: config.prompt || '',
          provider: config.provider || 'claude-code',
          model: config.model || 'auto',
          permission: config.permission || 'auto',
        });
        const agent = await daemon.processes.spawn(validated);
        spawned.push({ id: agent.id, name: agent.name, role: agent.role });
      }

      res.json({ launched: spawned.length, agents: spawned });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
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
    let autoRoutedCount = 0;
    for (const [, mode] of Object.entries(routingStatus.agentModes || {})) {
      if (mode.mode === 'auto') autoRoutedCount++;
    }
    for (const entry of daemon.router.costLog || []) {
      if (routingByTier[entry.tier] !== undefined) routingByTier[entry.tier]++;
    }

    // Per-agent enriched data
    const agentBreakdown = agents.map((a) => ({
      id: a.id,
      name: a.name,
      role: a.role,
      status: a.status,
      provider: a.provider,
      model: a.model || 'default',
      routingMode: a.routingMode || 'fixed',
      routingReason: a.routingReason || null,
      tokens: a.tokensUsed || 0,
      contextUsage: a.contextUsage || 0,
      spawnedAt: a.spawnedAt,
    }));

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
      uptime: process.uptime(),
    });
  });

  // --- Config ---

  app.get('/api/config', (req, res) => {
    res.json(daemon.config || {});
  });

  app.patch('/api/config', async (req, res) => {
    const ALLOWED_KEYS = [
      'port', 'journalistInterval', 'rotationThreshold', 'autoRotation',
      'qcThreshold', 'maxAgents', 'defaultProvider',
    ];
    for (const key of Object.keys(req.body)) {
      if (!ALLOWED_KEYS.includes(key)) {
        return res.status(400).json({ error: `Unknown config key: ${key}` });
      }
      daemon.config[key] = req.body[key];
    }
    const { saveConfig } = await import('./firstrun.js');
    saveConfig(daemon.grooveDir, daemon.config);
    res.json(daemon.config);
  });

  // Serve GUI static files (built GUI)
  const guiPath = resolve(__dirname, '../../gui/dist');
  app.use(express.static(guiPath));

  // SPA fallback
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(resolve(guiPath, 'index.html'), (err) => {
      if (err) res.status(404).json({ error: 'GUI not built yet. Run: npm run build:gui' });
    });
  });
}
