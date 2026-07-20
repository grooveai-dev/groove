// GROOVE — Auto Agent API Routes
// FSL-1.1-Apache-2.0 — see LICENSE

import { spawn } from 'child_process';
import { getProvider, resolveProviderCommand } from '../providers/index.js';

function execHeadlessChat(daemon, messages, systemPrompt) {
  const provider = getProvider('claude-code');
  if (!provider) return Promise.reject(new Error('Claude Code provider not available'));

  const fullPrompt = systemPrompt + '\n\n' + messages.map(m =>
    `${m.role === 'user' ? 'Human' : 'Assistant'}: ${m.content}`
  ).join('\n\n') + '\n\nAssistant:';

  const cmd = resolveProviderCommand('claude-code') || 'claude';
  const args = ['-p', '--output-format', 'text'];

  return new Promise((resolve, reject) => {
    let stdout = '';
    const proc = spawn(cmd, args, {
      env: process.env,
      cwd: daemon.projectDir,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    proc.on('error', reject);
    proc.stdin.write(fullPrompt);
    proc.stdin.end();
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    const timer = setTimeout(() => { proc.kill(); reject(new Error('Setup chat timeout')); }, 120_000);
    proc.on('exit', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`Headless exited with code ${code}`));

      // Try to parse stream-json output
      let response = '';
      for (const line of stdout.split('\n')) {
        try {
          const json = JSON.parse(line);
          if (typeof json.result === 'string') { response = json.result; break; }
          if (json.type === 'assistant' && typeof json.message?.content === 'string') {
            response = json.message.content;
          }
          if (json.type === 'assistant' && Array.isArray(json.message?.content)) {
            const text = json.message.content.filter(b => b.type === 'text').map(b => b.text).join('');
            if (text) response = text;
          }
        } catch { /* not json */ }
      }
      if (!response) response = stdout.trim();

      // Extract config if present
      let config = null;
      const jsonMatch = response.match(/```json\s*([\s\S]*?)```/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[1]);
          if (parsed.ready) config = parsed;
        } catch { /* not valid json */ }
      }

      resolve({ response, config });
    });
  });
}

export function registerAutoAgentRoutes(app, daemon) {

  // AI-assisted setup chat (must be before :id routes)
  app.post('/api/auto-agents/setup-chat', async (req, res) => {
    const { messages, systemPrompt } = req.body;
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'messages array is required' });
    }
    try {
      const result = await execHeadlessChat(daemon, messages, systemPrompt || '');
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // List all auto agent definitions
  app.get('/api/auto-agents', (req, res) => {
    const defs = daemon.orchestrator.list();
    const enriched = defs.map(def => {
      const state = daemon.autoState.getState(def.id);
      const activeAgentId = daemon.orchestrator.activeAgents.get(def.id);
      let activeAgent = null;
      if (activeAgentId) {
        const agent = daemon.registry.get(activeAgentId);
        if (agent) activeAgent = { id: agent.id, status: agent.status, spawnedAt: agent.spawnedAt };
      }
      return { ...def, state, activeAgent };
    });
    res.json(enriched);
  });

  // Create a new auto agent
  app.post('/api/auto-agents', (req, res) => {
    try {
      const def = daemon.orchestrator.create(req.body);
      res.status(201).json(def);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Get a single auto agent with full status
  app.get('/api/auto-agents/:id', (req, res) => {
    const status = daemon.orchestrator.getStatus(req.params.id);
    if (!status) return res.status(404).json({ error: 'Auto agent not found' });
    res.json(status);
  });

  // Update an auto agent definition
  app.patch('/api/auto-agents/:id', (req, res) => {
    try {
      const def = daemon.orchestrator.update(req.params.id, req.body);
      res.json(def);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Delete an auto agent
  app.delete('/api/auto-agents/:id', (req, res) => {
    try {
      daemon.orchestrator.delete(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Pause
  app.post('/api/auto-agents/:id/pause', (req, res) => {
    try {
      const def = daemon.orchestrator.pause(req.params.id);
      res.json(def);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Resume
  app.post('/api/auto-agents/:id/resume', (req, res) => {
    try {
      const def = daemon.orchestrator.resume(req.params.id);
      res.json(def);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Trigger now (manual iteration)
  app.post('/api/auto-agents/:id/trigger', async (req, res) => {
    try {
      const agent = await daemon.orchestrator.trigger(req.params.id);
      res.json({ ok: true, agentId: agent.id });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // --- State Layer ---

  // Get state
  app.get('/api/auto-agents/:id/state', (req, res) => {
    const def = daemon.orchestrator.get(req.params.id);
    if (!def) return res.status(404).json({ error: 'Auto agent not found' });
    res.json(daemon.autoState.getState(req.params.id));
  });

  // Update state (agent or human can call this to redirect)
  app.patch('/api/auto-agents/:id/state', (req, res) => {
    const def = daemon.orchestrator.get(req.params.id);
    if (!def) return res.status(404).json({ error: 'Auto agent not found' });
    try {
      const state = daemon.autoState.setState(req.params.id, req.body);
      daemon.broadcast({ type: 'auto-agent:state-updated', data: { id: req.params.id, state } });
      res.json(state);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Get journal
  app.get('/api/auto-agents/:id/journal', (req, res) => {
    const def = daemon.orchestrator.get(req.params.id);
    if (!def) return res.status(404).json({ error: 'Auto agent not found' });
    const limit = parseInt(req.query.limit) || 50;
    const since = req.query.since || undefined;
    res.json(daemon.autoState.getJournal(req.params.id, { limit, since }));
  });

  // Append journal entry
  app.post('/api/auto-agents/:id/journal', (req, res) => {
    const def = daemon.orchestrator.get(req.params.id);
    if (!def) return res.status(404).json({ error: 'Auto agent not found' });
    try {
      const entry = daemon.autoState.appendJournal(req.params.id, req.body);
      daemon.broadcast({ type: 'auto-agent:journal-entry', data: { id: req.params.id, entry } });
      res.status(201).json(entry);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Append history entry
  app.post('/api/auto-agents/:id/history', (req, res) => {
    const def = daemon.orchestrator.get(req.params.id);
    if (!def) return res.status(404).json({ error: 'Auto agent not found' });
    try {
      const history = daemon.autoState.appendHistory(req.params.id, req.body);
      daemon.broadcast({ type: 'auto-agent:history-entry', data: { id: req.params.id } });
      res.json({ ok: true, count: history.length });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Get/set roadmap
  app.get('/api/auto-agents/:id/roadmap', (req, res) => {
    const def = daemon.orchestrator.get(req.params.id);
    if (!def) return res.status(404).json({ error: 'Auto agent not found' });
    res.type('text/markdown').send(daemon.autoState.getRoadmap(req.params.id));
  });

  app.put('/api/auto-agents/:id/roadmap', (req, res) => {
    const def = daemon.orchestrator.get(req.params.id);
    if (!def) return res.status(404).json({ error: 'Auto agent not found' });
    const content = typeof req.body === 'string' ? req.body : req.body.content;
    if (!content) return res.status(400).json({ error: 'Content is required' });
    daemon.autoState.setRoadmap(req.params.id, content);
    daemon.broadcast({ type: 'auto-agent:roadmap-updated', data: { id: req.params.id } });
    res.json({ ok: true });
  });

  // Get/set prompt
  app.get('/api/auto-agents/:id/prompt', (req, res) => {
    const def = daemon.orchestrator.get(req.params.id);
    if (!def) return res.status(404).json({ error: 'Auto agent not found' });
    res.type('text/markdown').send(daemon.autoState.getPrompt(req.params.id));
  });

  app.put('/api/auto-agents/:id/prompt', (req, res) => {
    const def = daemon.orchestrator.get(req.params.id);
    if (!def) return res.status(404).json({ error: 'Auto agent not found' });
    const content = typeof req.body === 'string' ? req.body : req.body.content;
    if (!content) return res.status(400).json({ error: 'Content is required' });
    daemon.autoState.setPrompt(req.params.id, content);
    daemon.broadcast({ type: 'auto-agent:prompt-updated', data: { id: req.params.id } });
    res.json({ ok: true });
  });

  // Run history
  app.get('/api/auto-agents/:id/runs', (req, res) => {
    const def = daemon.orchestrator.get(req.params.id);
    if (!def) return res.status(404).json({ error: 'Auto agent not found' });
    const limit = parseInt(req.query.limit) || 20;
    res.json(daemon.autoState.listRuns(req.params.id, { limit }));
  });

}
