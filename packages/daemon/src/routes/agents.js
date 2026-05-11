// FSL-1.1-Apache-2.0 — see LICENSE

import { resolve } from 'path';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'fs';
import { validateAgentConfig, validateReasoningEffort, validateVerbosity } from '../validate.js';
import { ROLE_INTEGRATIONS, wrapWithRoleReminder } from '../process.js';
import { getProvider } from '../providers/index.js';

export function registerAgentRoutes(app, daemon) {
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
      // Inherit team working directory if agent doesn't specify one
      if (!config.workingDir) {
        const team = daemon.teams.get(config.teamId);
        if (team?.workingDir) config.workingDir = team.workingDir;
      }
      // Inherit configured defaults if the request didn't pick them
      if (!config.provider && daemon.config?.defaultProvider) {
        config.provider = daemon.config.defaultProvider;
      }
      if (!config.model && daemon.config?.defaultModel) {
        config.model = daemon.config.defaultModel;
      }
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

      // Always attempt kill — handles race where GUI sees 'running' but daemon
      // already marked the agent completed (common with fast non-interactive
      // providers like Gemini). processes.kill() is a no-op when no handle exists.
      await daemon.processes.kill(req.params.id);

      // Only purge from registry when explicitly requested.
      // Killed/completed agents stay visible so the user can review output.
      const purge = req.query.purge === 'true';
      if (purge) {
        daemon.registry.remove(req.params.id);
      }

      daemon.audit.log('agent.kill', { id: agent.id, role: agent.role, purged: purge });
      res.json({ ok: true, purged: purge });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Kill all agents and purge registry (used by groove nuke)
  app.delete('/api/agents', async (req, res) => {
    const count = daemon.processes.getRunningCount();
    await daemon.processes.killAll();
    // Purge all agents from registry — kill() no longer does this automatically
    for (const agent of daemon.registry.getAll()) {
      daemon.registry.remove(agent.id);
    }
    daemon.audit.log('agent.kill_all', { count });
    res.json({ ok: true });
  });

  // --- Role-to-Integration Mapping ---

  app.get('/api/roles/integrations', (req, res) => {
    const roleFilter = req.query.role;
    const entries = roleFilter ? { [roleFilter]: ROLE_INTEGRATIONS[roleFilter] || [] } : ROLE_INTEGRATIONS;
    const result = {};
    for (const [role, ids] of Object.entries(entries)) {
      result[role] = (ids || []).map((id) => {
        const status = daemon.integrations.getStatus(id);
        const entry = daemon.integrations.registry.find((r) => r.id === id);
        return {
          id,
          name: entry?.name || id,
          installed: status?.installed || false,
          configured: status?.configured || false,
          authenticated: status?.authenticated || false,
        };
      });
    }
    if (roleFilter) return res.json(result[roleFilter] || []);
    res.json(result);
  });

  app.post('/api/agents/preflight', (req, res) => {
    const { role, integrations } = req.body || {};
    if (!role || !Array.isArray(integrations)) {
      return res.status(400).json({ error: 'role and integrations[] required' });
    }
    const issues = [];
    for (const id of integrations) {
      const status = daemon.integrations.getStatus(id);
      const entry = daemon.integrations.registry.find((r) => r.id === id);
      const name = entry?.name || id;
      if (!status || !status.installed) {
        issues.push({ integrationId: id, name, problem: 'not_installed' });
      } else if (!status.configured) {
        issues.push({ integrationId: id, name, problem: 'not_configured' });
      } else if (!status.authenticated) {
        issues.push({ integrationId: id, name, problem: 'not_authenticated' });
      }
    }
    res.json({ ready: issues.length === 0, issues });
  });

  // --- Agent Integration Attach/Detach ---

  app.post('/api/agents/:id/integrations/:integrationId', (req, res) => {
    const agent = daemon.registry.get(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    const integrationId = req.params.integrationId;
    const status = daemon.integrations.getStatus(integrationId);
    if (!status || !status.installed) {
      return res.status(400).json({ error: `Integration not installed: ${integrationId}` });
    }

    const integrations = new Set(agent.integrations || []);
    integrations.add(integrationId);
    const updated = Array.from(integrations);

    daemon.registry.update(req.params.id, { integrations: updated });
    daemon.integrations.writeMcpJson(daemon.integrations.getActiveIntegrations());
    daemon.integrations.refreshMcpJson();
    daemon.audit.log('agent.integration.attach', { agentId: req.params.id, integrationId });
    daemon.broadcast({ type: 'agent:integration:attach', agentId: req.params.id, integrationId });
    res.json({ ok: true, integrations: updated });
  });

  app.delete('/api/agents/:id/integrations/:integrationId', (req, res) => {
    const agent = daemon.registry.get(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    const integrationId = req.params.integrationId;
    const integrations = (agent.integrations || []).filter((id) => id !== integrationId);

    daemon.registry.update(req.params.id, { integrations });
    daemon.integrations.refreshMcpJson();
    daemon.audit.log('agent.integration.detach', { agentId: req.params.id, integrationId });
    daemon.broadcast({ type: 'agent:integration:detach', agentId: req.params.id, integrationId });
    res.json({ ok: true, integrations });
  });

  // --- Agent Routing ---

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

  // Downshift suggestion — NEVER auto-applied. User must accept via UI.
  // Returns null (204) when classifier has no strong suggestion.
  app.get('/api/agents/:id/routing/suggestion', (req, res) => {
    const suggestion = daemon.router.getSuggestion(req.params.id);
    if (!suggestion) return res.status(204).send();
    res.json(suggestion);
  });

  // --- Conversations ---

  app.get('/api/conversations', (req, res) => {
    res.json({ conversations: daemon.conversations.list() });
  });

  app.post('/api/conversations', async (req, res) => {
    try {
      const { provider, model, title, mode, reasoning_effort, verbosity } = req.body;
      if (provider && typeof provider !== 'string') {
        return res.status(400).json({ error: 'provider must be a string' });
      }
      if (mode && mode !== 'api' && mode !== 'agent') {
        return res.status(400).json({ error: 'mode must be "api" or "agent"' });
      }
      const validatedEffort = validateReasoningEffort(reasoning_effort);
      const validatedVerbosity = validateVerbosity(verbosity);
      const conversation = await daemon.conversations.create(provider, model, title, mode || 'api', {
        reasoningEffort: validatedEffort,
        verbosity: validatedVerbosity,
      });
      daemon.audit.log('conversation.create', { id: conversation.id, provider, model, mode: conversation.mode });
      res.status(201).json(conversation);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/api/conversations/:id', (req, res) => {
    const conversation = daemon.conversations.get(req.params.id);
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
    res.json(conversation);
  });

  app.patch('/api/conversations/:id', async (req, res) => {
    try {
      const conv = daemon.conversations.get(req.params.id);
      if (!conv) return res.status(404).json({ error: 'Conversation not found' });
      if (req.body.title !== undefined) daemon.conversations.rename(req.params.id, req.body.title);
      if (req.body.pinned !== undefined) daemon.conversations.pin(req.params.id, req.body.pinned);
      if (req.body.archived !== undefined) daemon.conversations.archive(req.params.id, req.body.archived);
      if (req.body.model !== undefined || req.body.provider !== undefined) {
        const newProvider = req.body.provider || conv.provider;
        const newModel = req.body.model || conv.model;
        daemon.conversations.updateModel(req.params.id, newProvider, newModel);
      }
      if (req.body.mode !== undefined) {
        if (req.body.mode !== 'api' && req.body.mode !== 'agent') {
          return res.status(400).json({ error: 'mode must be "api" or "agent"' });
        }
        await daemon.conversations.setMode(req.params.id, req.body.mode);
      }
      if (req.body.reasoning_effort !== undefined || req.body.verbosity !== undefined) {
        const validatedEffort = req.body.reasoning_effort !== undefined ? validateReasoningEffort(req.body.reasoning_effort) : undefined;
        const validatedVerbosity = req.body.verbosity !== undefined ? validateVerbosity(req.body.verbosity) : undefined;
        daemon.conversations.updateReasoningSettings(req.params.id, validatedEffort, validatedVerbosity);
      }
      daemon.audit.log('conversation.update', { id: req.params.id, provider: req.body.provider, model: req.body.model, mode: req.body.mode });
      res.json(daemon.conversations.get(req.params.id));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete('/api/conversations/:id', async (req, res) => {
    try {
      const conv = daemon.conversations.get(req.params.id);
      if (!conv) return res.status(404).json({ error: 'Conversation not found' });
      await daemon.conversations.delete(req.params.id);
      daemon.audit.log('conversation.delete', { id: req.params.id });
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/conversations/:id/message', async (req, res) => {
    try {
      const { message, history, reasoning_effort, verbosity } = req.body;
      if (!message || typeof message !== 'string' || !message.trim()) {
        return res.status(400).json({ error: 'message is required' });
      }
      const validatedEffort = validateReasoningEffort(reasoning_effort);
      const validatedVerbosity = validateVerbosity(verbosity);

      const conv = daemon.conversations.get(req.params.id);
      if (!conv) return res.status(404).json({ error: 'Conversation not found' });

      daemon.conversations.autoTitle(req.params.id, message.trim());
      daemon.conversations.touchUpdatedAt(req.params.id);

      // API mode — lightweight headless streaming, no agent spawned
      if (conv.mode === 'api' || !conv.agentId) {
        await daemon.conversations.sendMessage(req.params.id, message.trim(), history || [], {
          reasoningEffort: validatedEffort,
          verbosity: validatedVerbosity,
        });
        daemon.audit.log('conversation.message', { id: req.params.id, mode: 'api' });
        return res.json({ status: 'streaming', mode: 'api' });
      }

      // Agent mode — existing behavior
      const agent = daemon.registry.get(conv.agentId);
      if (!agent) return res.status(400).json({ error: 'Agent no longer exists' });

      // Record user feedback for journalist context
      if (daemon.journalist) daemon.journalist.recordUserFeedback(agent, message.trim());

      // Agent loop path — send message directly to the running loop
      if (daemon.processes.hasAgentLoop(conv.agentId)) {
        const sent = await daemon.processes.sendMessage(conv.agentId, message.trim());
        if (sent) {
          daemon.audit.log('conversation.message', { id: req.params.id, agentId: conv.agentId });
          return res.json({ id: conv.agentId, status: 'message_sent' });
        }
      }

      // One-shot providers: kill and respawn with the message as prompt
      const provider = getProvider(agent.provider);
      if (provider?.constructor?.isOneShot) {
        const oldConfig = { ...agent };
        if (daemon.processes.isRunning(conv.agentId)) {
          await daemon.processes.kill(conv.agentId);
        }
        daemon.registry.remove(conv.agentId);
        daemon.locks.release(conv.agentId);

        const newAgent = await daemon.processes.spawn({
          role: 'chat',
          scope: oldConfig.scope,
          provider: oldConfig.provider,
          model: oldConfig.model,
          prompt: message.trim(),
          permission: oldConfig.permission || 'full',
          workingDir: oldConfig.workingDir,
          name: oldConfig.name,
          teamId: oldConfig.teamId,
        });

        // Update conversation to point to new agent
        const convObj = daemon.conversations.conversations.get(req.params.id);
        if (convObj) {
          convObj.agentId = newAgent.id;
          daemon.conversations._save();
        }
        daemon.audit.log('conversation.message', { id: req.params.id, agentId: newAgent.id, oneShot: true });
        return res.json({ id: newAgent.id, status: 'respawned' });
      }

      // Running CLI agent — queue the message
      if (daemon.processes.isRunning(conv.agentId)) {
        daemon.processes.queueMessage(conv.agentId, message.trim());
        daemon.audit.log('conversation.message', { id: req.params.id, agentId: conv.agentId, queued: true });
        return res.json({ id: conv.agentId, status: 'message_queued' });
      }

      // CLI agent — session resume or rotation
      const SESSION_RESUME_CEILING = 5_000_000;
      const resumed = !!agent.sessionId && (agent.tokensUsed || 0) < SESSION_RESUME_CEILING;
      const newAgent = resumed
        ? await daemon.processes.resume(conv.agentId, message.trim())
        : await daemon.rotator.rotate(conv.agentId, { additionalPrompt: message.trim() });

      // Update conversation to point to new agent if rotated
      if (newAgent.id !== conv.agentId) {
        const convObj = daemon.conversations.conversations.get(req.params.id);
        if (convObj) {
          convObj.agentId = newAgent.id;
          daemon.conversations._save();
        }
      }

      daemon.audit.log('conversation.message', { id: req.params.id, agentId: newAgent.id, resumed });
      res.json({ id: newAgent.id, status: resumed ? 'resumed' : 'rotated' });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/conversations/:id/stop', (req, res) => {
    try {
      const conv = daemon.conversations.get(req.params.id);
      if (!conv) return res.status(404).json({ error: 'Conversation not found' });
      daemon.conversations.stopStreaming(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // --- Image Generation ---

  app.post('/api/conversations/:id/generate-image', async (req, res) => {
    try {
      const { prompt, model, size, quality } = req.body;
      if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
        return res.status(400).json({ error: 'prompt is required' });
      }
      const conv = daemon.conversations.get(req.params.id);
      if (!conv) return res.status(404).json({ error: 'Conversation not found' });

      let providerName = conv.provider;
      let provider = getProvider(providerName);

      // If a specific image model was requested, find the right provider
      if (model) {
        const imageProviders = ['codex', 'grok', 'nano-banana'];
        for (const pid of imageProviders) {
          const p = getProvider(pid);
          if (p?.constructor.models.some((m) => m.id === model)) {
            provider = p;
            providerName = pid;
            break;
          }
        }
      }

      if (!provider?.generateImage) {
        return res.status(400).json({ error: 'Provider does not support image generation' });
      }

      const apiKey = daemon.conversations._getApiKey(providerName);
      if (!apiKey) {
        return res.status(400).json({ error: `No API key configured for ${providerName}` });
      }

      daemon.broadcast({
        type: 'conversation:image-progress',
        data: { conversationId: req.params.id, status: 'generating', prompt: prompt.trim() },
      });

      const result = await provider.generateImage(prompt.trim(), { model, size, quality, apiKey });

      daemon.broadcast({
        type: 'conversation:image',
        data: { conversationId: req.params.id, ...result, prompt: prompt.trim() },
      });

      daemon.conversations.touchUpdatedAt(req.params.id);
      daemon.audit.log('conversation.image', { id: req.params.id, model: result.model, provider: result.provider });
      res.json(result);
    } catch (err) {
      daemon.broadcast({
        type: 'conversation:image-progress',
        data: { conversationId: req.params.id, status: 'error', error: err.message },
      });
      res.status(500).json({ error: err.message });
    }
  });

  // Stop an agent's current work without killing the agent
  app.post('/api/agents/:id/stop', async (req, res) => {
    try {
      const agent = daemon.registry.get(req.params.id);
      if (!agent) return res.status(404).json({ error: 'Agent not found' });
      await daemon.processes.stop(req.params.id);
      daemon.audit.log('agent.stop', { id: req.params.id, name: agent.name });
      res.json({ id: req.params.id, status: 'stopped' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
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

  // Instruct an agent — send message to agent loop, resume session, or rotate
  // Agent loop = direct message to running loop (local models)
  // Resume = zero cold-start (uses --resume SESSION_ID)
  // Rotation = full handoff brief (only for degradation or no session)
  app.post('/api/agents/:id/instruct', async (req, res) => {
    try {
      const { message, codeContext } = req.body;
      if (!message || typeof message !== 'string' || !message.trim()) {
        return res.status(400).json({ error: 'message is required' });
      }
      const agent = daemon.registry.get(req.params.id);
      if (!agent) return res.status(404).json({ error: 'Agent not found' });

      // Build the final instruction, optionally enriched with code context
      let finalMessage = message.trim();
      if (codeContext && typeof codeContext === 'object') {
        const { filePath, lineStart, lineEnd, selectedCode } = codeContext;
        if (filePath && typeof filePath === 'string' && selectedCode && typeof selectedCode === 'string') {
          const start = Number.isFinite(lineStart) ? lineStart : '?';
          const end = Number.isFinite(lineEnd) ? lineEnd : '?';
          finalMessage = `${finalMessage}\n\nCode context from ${filePath} (lines ${start}-${end}):\n\`\`\`\n${selectedCode}\n\`\`\``;
        }
      }

      // Record user feedback so the journalist can include it in future agent context
      if (daemon.journalist) daemon.journalist.recordUserFeedback(agent, finalMessage);

      // Agent loop path — send message directly to the running loop
      const wrappedMessage = wrapWithRoleReminder(agent.role, finalMessage);
      if (daemon.processes.hasAgentLoop(req.params.id)) {
        const sent = await daemon.processes.sendMessage(req.params.id, wrappedMessage);
        if (sent) {
          daemon.audit.log('agent.chat', { id: req.params.id });
          return res.json({ id: agent.id, status: 'message_sent' });
        }
        // Loop exists but not running — fall through to resume/rotate
      }

      // One-shot providers (groove-network): kill any running instance and
      // respawn with the user's message as --prompt. No handoff brief, no
      // session resume, no message queue — each chat message is a fresh spawn.
      const provider = getProvider(agent.provider);
      if (provider?.constructor?.isOneShot) {
        const oldConfig = { ...agent };
        if (daemon.processes.isRunning(req.params.id)) {
          await daemon.processes.kill(req.params.id);
        }
        daemon.registry.remove(req.params.id);
        daemon.locks.release(req.params.id);

        const newAgent = await daemon.processes.spawn({
          role: oldConfig.role,
          scope: oldConfig.scope,
          provider: oldConfig.provider,
          model: oldConfig.model,
          prompt: finalMessage,
          permission: oldConfig.permission || 'full',
          workingDir: oldConfig.workingDir,
          name: oldConfig.name,
          teamId: oldConfig.teamId,
        });
        daemon.audit.log('agent.instruct', { id: req.params.id, newId: newAgent.id, resumed: false });
        return res.json(newAgent);
      }

      // Non-interactive CLI providers (e.g. Gemini): respawn with the new
      // message as the prompt, preserving original introContext. These providers
      // run one prompt per spawn and cannot resume sessions.
      if (provider?.constructor?.nonInteractive && !daemon.processes.isRunning(req.params.id)) {
        const oldConfig = { ...agent };
        daemon.registry.remove(req.params.id);
        daemon.locks.release(req.params.id);

        const newAgent = await daemon.processes.spawn({
          role: oldConfig.role,
          scope: oldConfig.scope,
          provider: oldConfig.provider,
          model: oldConfig.model,
          prompt: finalMessage,
          introContext: oldConfig.introContext,
          permission: oldConfig.permission || 'full',
          workingDir: oldConfig.workingDir,
          name: oldConfig.name,
          teamId: oldConfig.teamId,
        });
        daemon.audit.log('agent.instruct', { id: req.params.id, newId: newAgent.id, resumed: false });
        return res.json(newAgent);
      }

      // Running CLI agent (no loop) — queue the message for delivery after
      // the current task completes instead of killing and respawning.
      if (daemon.processes.isRunning(req.params.id)) {
        daemon.processes.queueMessage(req.params.id, wrappedMessage);
        daemon.audit.log('agent.chat.queued', { id: req.params.id });
        return res.json({ id: agent.id, status: 'message_queued' });
      }

      // CLI agent path — session resume or rotation.
      // Force rotation (fresh session + handoff brief) past the resume ceiling:
      // reviving a >5M-token claude session has crashed the CLI mid-HTTP-parse
      // (V8 fatal in JsonStringifier) — the rotator's handoff brief sidesteps that.
      const SESSION_RESUME_CEILING = 5_000_000;
      const resumed = !!agent.sessionId && (agent.tokensUsed || 0) < SESSION_RESUME_CEILING;
      const newAgent = resumed
        ? await daemon.processes.resume(req.params.id, wrappedMessage)
        : await daemon.rotator.rotate(req.params.id, { additionalPrompt: wrappedMessage });

      daemon.audit.log('agent.instruct', { id: req.params.id, newId: newAgent.id, resumed });
      res.json(newAgent);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Query an agent (headless one-shot, agent keeps running)
  // For agent loop agents: sends message directly to the loop
  app.post('/api/agents/:id/query', async (req, res) => {
    try {
      const { message } = req.body;
      if (!message || typeof message !== 'string' || !message.trim()) {
        return res.status(400).json({ error: 'message is required' });
      }
      const agent = daemon.registry.get(req.params.id);
      if (!agent) return res.status(404).json({ error: 'Agent not found' });

      // Agent loop agents: send message directly (they're interactive)
      if (daemon.processes.hasAgentLoop(req.params.id)) {
        const sent = await daemon.processes.sendMessage(req.params.id, message.trim());
        return res.json({ response: sent ? 'Message sent to agent' : 'Agent not running', agentId: agent.id, agentName: agent.name });
      }

      // Build context about the agent's work
      const activity = daemon.classifier?.agentWindows?.[agent.id] || [];
      const recentActivity = activity.slice(-20).map((e) => e.data || e.text || '').join('\n');

      // Truncate the agent's original prompt to avoid massive payloads
      const taskSummary = agent.prompt ? agent.prompt.slice(0, 500) : '';
      const prompt = [
        `You are answering a question about agent "${agent.name}" (role: ${agent.role}).`,
        `Provider: ${agent.provider}, Tokens used: ${agent.tokensUsed || 0}`,
        taskSummary ? `Task summary: ${taskSummary}` : '',
        recentActivity ? `\nRecent activity:\n${recentActivity}` : '',
        `\nUser question: ${message.trim()}`,
        '\nAnswer concisely based on the agent context above.',
      ].filter(Boolean).join('\n');

      const response = await daemon.journalist.callHeadless(prompt, { trackAs: '__agent_qa__' });
      res.json({ response, agentId: agent.id, agentName: agent.name });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Upload file to agent's working directory
  app.post('/api/agents/:id/upload', (req, res) => {
    const agent = daemon.registry.get(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    const { filename, content } = req.body;
    if (!filename || !content) return res.status(400).json({ error: 'filename and content required' });

    // Sanitize filename — strict allowlist, no path traversal
    const safeName = String(filename).replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '');
    if (!safeName) return res.status(400).json({ error: 'Invalid filename' });

    const dir = agent.workingDir || daemon.projectDir;
    const filePath = resolve(dir, safeName);

    // Ensure file stays within working directory
    if (!filePath.startsWith(dir)) {
      return res.status(400).json({ error: 'Path traversal detected' });
    }

    try {
      mkdirSync(dir, { recursive: true });
      const buffer = Buffer.from(content, 'base64');
      writeFileSync(filePath, buffer);
      daemon.audit.log('file.upload', { agentId: agent.id, filename: safeName, size: buffer.length });
      res.json({ ok: true, path: safeName, size: buffer.length });
    } catch (err) {
      res.status(500).json({ error: `Upload failed: ${err.message}` });
    }
  });

  // List MD files for an agent (from its working directory + .groove)
  app.get('/api/agents/:id/mdfiles', (req, res) => {
    const agent = daemon.registry.get(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    const dir = agent.workingDir || daemon.projectDir;
    const files = [];

    // Scan working directory for .md files (top level + .groove/)
    try {
      for (const entry of readdirSync(dir)) {
        if (entry.endsWith('.md') && !entry.startsWith('.')) {
          const fullPath = resolve(dir, entry);
          if (statSync(fullPath).isFile()) {
            files.push({ name: entry, path: entry, size: statSync(fullPath).size, source: 'project' });
          }
        }
      }
      const grooveDir = resolve(dir, '.groove');
      if (existsSync(grooveDir)) {
        for (const entry of readdirSync(grooveDir)) {
          if (entry.endsWith('.md')) {
            const fullPath = resolve(grooveDir, entry);
            if (statSync(fullPath).isFile()) {
              files.push({ name: entry, path: `.groove/${entry}`, size: statSync(fullPath).size, source: 'project' });
            }
          }
        }
      }
    } catch { /* dir might not exist */ }

    // Include personality file from .groove/personalities/
    try {
      const personalityFile = resolve(daemon.grooveDir, 'personalities', `${agent.name}.md`);
      if (existsSync(personalityFile)) {
        const size = statSync(personalityFile).size;
        files.unshift({ name: 'personality.md', path: '__personality__', size, source: 'personality' });
      }
    } catch { /* ignore */ }

    // Include user-created agent files from .groove/agent-files/<name>/
    try {
      const agentFilesDir = resolve(daemon.grooveDir, 'agent-files', agent.name);
      if (existsSync(agentFilesDir)) {
        for (const entry of readdirSync(agentFilesDir)) {
          if (entry.endsWith('.md')) {
            const fullPath = resolve(agentFilesDir, entry);
            if (statSync(fullPath).isFile()) {
              files.push({ name: entry, path: `__user__/${entry}`, size: statSync(fullPath).size, source: 'user' });
            }
          }
        }
      }
    } catch { /* ignore */ }

    res.json({ files, workingDir: dir });
  });

  // Read a specific MD file for an agent
  app.get('/api/agents/:id/mdfiles/read', (req, res) => {
    const agent = daemon.registry.get(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    const dir = agent.workingDir || daemon.projectDir;
    const relPath = req.query.path;
    if (!relPath || relPath.includes('..')) return res.status(400).json({ error: 'Invalid path' });

    if (relPath === '__personality__') {
      const personalityFile = resolve(daemon.grooveDir, 'personalities', `${agent.name}.md`);
      if (existsSync(personalityFile)) {
        return res.json({ content: readFileSync(personalityFile, 'utf8') });
      }
      return res.json({ content: '' });
    }

    if (relPath.startsWith('__user__/')) {
      const fileName = relPath.slice('__user__/'.length);
      if (!fileName || fileName.includes('/') || fileName.includes('..')) return res.status(400).json({ error: 'Invalid path' });
      const filePath = resolve(daemon.grooveDir, 'agent-files', agent.name, fileName);
      if (existsSync(filePath)) return res.json({ content: readFileSync(filePath, 'utf8') });
      return res.json({ content: '' });
    }

    const fullPath = resolve(dir, relPath);
    if (!fullPath.startsWith(dir)) return res.status(400).json({ error: 'Path traversal' });

    try {
      const content = readFileSync(fullPath, 'utf8');
      res.json({ path: relPath, content });
    } catch {
      res.status(404).json({ error: 'File not found' });
    }
  });

  // Save a MD file for an agent
  app.put('/api/agents/:id/mdfiles/write', (req, res) => {
    const agent = daemon.registry.get(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    const dir = agent.workingDir || daemon.projectDir;
    const { path: relPath, content } = req.body;
    if (!relPath || relPath.includes('..')) return res.status(400).json({ error: 'Invalid path' });
    if (typeof content !== 'string') return res.status(400).json({ error: 'Content required' });

    if (relPath === '__personality__') {
      const personalityDir = resolve(daemon.grooveDir, 'personalities');
      mkdirSync(personalityDir, { recursive: true });
      writeFileSync(resolve(personalityDir, `${agent.name}.md`), content || '', { mode: 0o600 });
      daemon.audit.log('personality.update', { name: agent.name, agentId: agent.id });
      return res.json({ saved: true });
    }

    if (relPath.startsWith('__user__/')) {
      const fileName = relPath.slice('__user__/'.length);
      if (!fileName || fileName.includes('/') || fileName.includes('..')) return res.status(400).json({ error: 'Invalid path' });
      const agentFilesDir = resolve(daemon.grooveDir, 'agent-files', agent.name);
      mkdirSync(agentFilesDir, { recursive: true });
      writeFileSync(resolve(agentFilesDir, fileName), content || '', { mode: 0o600 });
      daemon.audit.log('mdfile.write.user', { agentId: agent.id, name: fileName });
      return res.json({ saved: true });
    }

    const fullPath = resolve(dir, relPath);
    if (!fullPath.startsWith(dir)) return res.status(400).json({ error: 'Path traversal' });

    try {
      writeFileSync(fullPath, content, 'utf8');
      daemon.audit.log('mdfile.write', { agentId: agent.id, path: relPath });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Create a new MD file for an agent
  app.post('/api/agents/:id/mdfiles/create', (req, res) => {
    const agent = daemon.registry.get(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    let name = req.body?.name;
    if (!name || typeof name !== 'string') return res.status(400).json({ error: 'name required' });
    name = name.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 64);
    if (!name) return res.status(400).json({ error: 'Invalid name' });
    if (!name.endsWith('.md')) name += '.md';
    const agentFilesDir = resolve(daemon.grooveDir, 'agent-files', agent.name);
    mkdirSync(agentFilesDir, { recursive: true });
    const filePath = resolve(agentFilesDir, name);
    if (existsSync(filePath)) return res.status(409).json({ error: 'File already exists' });
    writeFileSync(filePath, '', { mode: 0o600 });
    daemon.audit.log('mdfile.create', { agentId: agent.id, name });
    res.json({ name, path: `__user__/${name}` });
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

  // --- Agent Repos (attach/detach) ---

  app.post('/api/agents/:agentId/repos/:importId', (req, res) => {
    const agent = daemon.registry.get(req.params.agentId);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    const importId = req.params.importId;
    const manifest = daemon.repoImporter.getImport(importId);
    if (!manifest || manifest.status !== 'active') {
      return res.status(400).json({ error: 'Repo not found or not active' });
    }
    const repos = agent.repos || [];
    if (repos.includes(importId)) {
      return res.json({ id: agent.id, repos });
    }
    daemon.registry.update(agent.id, { repos: [...repos, importId] });
    daemon.audit.log('repo.attach', { agentId: agent.id, importId });
    res.json({ id: agent.id, repos: [...repos, importId] });
  });

  app.delete('/api/agents/:agentId/repos/:importId', (req, res) => {
    const agent = daemon.registry.get(req.params.agentId);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    const repos = (agent.repos || []).filter((r) => r !== req.params.importId);
    daemon.registry.update(agent.id, { repos });
    daemon.audit.log('repo.detach', { agentId: agent.id, importId: req.params.importId });
    res.json({ id: agent.id, repos });
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
}
