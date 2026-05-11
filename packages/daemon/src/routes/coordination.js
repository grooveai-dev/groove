// FSL-1.1-Apache-2.0 — see LICENSE
import { Keeper, KEEPER_COMMANDS } from '../keeper.js';

const FILE_READ_TOOLS = new Set(['Read', 'read_file']);
const FILE_WRITE_TOOLS = new Set(['Write', 'Edit', 'write_file', 'edit_file', 'create_file']);

export function registerCoordinationRoutes(app, daemon) {
  // Lock management
  app.get('/api/locks', (req, res) => {
    res.json(daemon.locks.getAll());
  });

  // Knock protocol: Claude Code PreToolUse hook POSTs every Bash/Write/Edit
  // tool call here. The daemon checks the target path (for file ops) against
  // the agent's declared scope and against other agents' active locks, and
  // allows or denies. Non-Claude providers don't hit this path.
  app.post('/api/knock', (req, res) => {
    const body = req.body || {};
    const agentId = body.grooveAgentId;
    const toolName = body.tool_name || body.toolName || '';
    const toolInput = body.tool_input || body.toolInput || {};

    // Unknown / no agent id → fail open (don't wedge an agent we can't identify)
    if (!agentId) return res.json({ allow: true });
    const agent = daemon.registry.get(agentId);
    if (!agent) return res.json({ allow: true });

    // Extract the target file paths from the tool input
    const targets = [];
    if (toolInput.file_path) targets.push(String(toolInput.file_path));
    if (toolInput.path) targets.push(String(toolInput.path));
    if (Array.isArray(toolInput.edits)) {
      for (const e of toolInput.edits) if (e?.file_path) targets.push(String(e.file_path));
    }

    // Scope guard: if agent has a declared scope and the op targets a path,
    // verify the path matches the scope or belongs to no one.
    if (agent.scope && agent.scope.length > 0 && targets.length > 0) {
      for (const target of targets) {
        const conflict = daemon.locks.check(agentId, target, agent.workingDir);
        if (conflict.conflict) {
          daemon.audit.log('knock.denied', { agentId, toolName, target, owner: conflict.owner, pattern: conflict.pattern });
          daemon.broadcast({ type: 'knock:denied', agentId, agentName: agent.name, toolName, target, owner: conflict.owner, reason: 'scope_conflict' });
          return res.json({
            allow: false,
            reason: `GROOVE PM: ${target} is owned by another agent (pattern ${conflict.pattern}). Use the handoff protocol (write .groove/handoffs/<role>.md) or request approval instead of editing it directly.`,
          });
        }
      }
    }

    // Track file operations for the files-touched API
    if (targets.length > 0) {
      const op = FILE_WRITE_TOOLS.has(toolName) ? 'write' : FILE_READ_TOOLS.has(toolName) ? 'read' : null;
      if (op) {
        for (const t of targets) daemon.registry.trackFileOp(agentId, t, op);
      }
    }

    daemon.audit.log('knock.allowed', { agentId, toolName, targets });
    res.json({ allow: true });
  });

  // Coordination protocol — agents declare intent on shared resources
  // (npm install, server restart, package.json edit) to prevent races.
  // Returns 423 Locked if another agent holds a conflicting resource.
  app.post('/api/coordination/declare', (req, res) => {
    const { agentId, operation, resources, ttlMs } = req.body || {};
    if (!agentId || !operation || !Array.isArray(resources) || resources.length === 0) {
      return res.status(400).json({ error: 'agentId, operation, and resources[] required' });
    }
    const result = daemon.locks.declareOperation(agentId, operation, resources, ttlMs);
    if (result.conflict) {
      daemon.audit.log('coordination.conflict', { agentId, operation, resource: result.resource, owner: result.owner });
      return res.status(423).json(result);
    }
    daemon.audit.log('coordination.declared', { agentId, operation, resources });
    daemon.broadcast({ type: 'coordination:declared', agentId, operation, resources });
    res.json({ declared: true, operation, resources });
  });

  app.post('/api/coordination/complete', (req, res) => {
    const { agentId } = req.body || {};
    if (!agentId) return res.status(400).json({ error: 'agentId required' });
    const removed = daemon.locks.completeOperation(agentId);
    daemon.audit.log('coordination.completed', { agentId });
    daemon.broadcast({ type: 'coordination:completed', agentId });
    res.json({ completed: removed });
  });

  app.get('/api/coordination', (req, res) => {
    res.json({ operations: daemon.locks.getOperations() });
  });

  // --- Persistent Memory (Layer 7) ---
  // Constraints: project rules discovered by agents / set by user
  app.get('/api/memory/constraints', (req, res) => {
    res.json({ constraints: daemon.memory.listConstraints() });
  });

  app.post('/api/memory/constraints', (req, res) => {
    const { text, category } = req.body || {};
    const result = daemon.memory.addConstraint({ text, category });
    if (!result.added && result.error) {
      return res.status(400).json(result);
    }
    if (result.added) {
      daemon.audit.log('memory.constraint.added', { hash: result.hash, category });
      daemon.broadcast({ type: 'memory:constraint:added', hash: result.hash });
    }
    res.json(result);
  });

  app.delete('/api/memory/constraints/:hash', (req, res) => {
    const removed = daemon.memory.removeConstraint(req.params.hash);
    if (removed) {
      daemon.audit.log('memory.constraint.removed', { hash: req.params.hash });
      daemon.broadcast({ type: 'memory:constraint:removed', hash: req.params.hash });
    }
    res.json({ removed });
  });

  // Handoff chains (per role, optionally scoped by workspace)
  app.get('/api/memory/handoff-chain/:role', (req, res) => {
    res.json({
      role: req.params.role,
      workspace: req.query.workspace || null,
      entries: daemon.memory.getHandoffChain(req.params.role, req.query.workspace),
    });
  });

  app.get('/api/memory/handoff-chain/:role/recent', (req, res) => {
    const count = Math.min(parseInt(req.query.count) || 3, 10);
    res.json({
      role: req.params.role,
      workspace: req.query.workspace || null,
      markdown: daemon.memory.getRecentHandoffMarkdown(req.params.role, count, 10_000, req.query.workspace),
    });
  });

  app.get('/api/memory/handoff-chain', (req, res) => {
    res.json({ roles: daemon.memory.listHandoffRoles(req.query.workspace) });
  });

  // Discoveries (error → fix pairs)
  app.get('/api/memory/discoveries', (req, res) => {
    const role = req.query.role;
    const teamId = req.query.teamId;
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    res.json({ discoveries: daemon.memory.listDiscoveries({ role, teamId, limit }) });
  });

  app.post('/api/memory/discoveries', (req, res) => {
    const { agentId, role, trigger, fix, outcome, teamId } = req.body || {};
    const result = daemon.memory.addDiscovery({ agentId, role, trigger, fix, outcome, teamId });
    if (!result.added && result.error) {
      return res.status(400).json(result);
    }
    if (result.added) {
      daemon.audit.log('memory.discovery.added', { agentId, role });
      daemon.broadcast({ type: 'memory:discovery:added', agentId, role });
    }
    res.json(result);
  });

  // Specializations (per-agent + per-role quality profiles)
  app.get('/api/memory/specializations', (req, res) => {
    res.json(daemon.memory.getAllSpecializations());
  });

  app.get('/api/memory/specializations/:agentId', (req, res) => {
    const spec = daemon.memory.getSpecialization(req.params.agentId);
    if (!spec) return res.status(404).json({ error: 'No specialization data for this agent' });
    res.json(spec);
  });

  // ── Keeper (tagged memory) ──────────────────────────────────

  app.get('/api/keeper', (req, res) => {
    res.json({ items: daemon.keeper.list() });
  });

  app.get('/api/keeper/tree', (req, res) => {
    res.json({ tree: daemon.keeper.tree() });
  });

  app.get('/api/keeper/search', (req, res) => {
    const q = req.query.q || '';
    res.json({ results: daemon.keeper.search(q) });
  });

  app.get('/api/keeper/commands', (_req, res) => {
    res.json({ commands: KEEPER_COMMANDS });
  });

  app.get('/api/keeper/:tag(*)', (req, res) => {
    const item = daemon.keeper.get(req.params.tag);
    if (!item) return res.status(404).json({ error: `Memory #${req.params.tag} not found` });
    res.json(item);
  });

  app.post('/api/keeper', (req, res) => {
    try {
      const { tag, content } = req.body || {};
      const item = daemon.keeper.save(tag, content);
      daemon.audit.log('keeper.save', { tag: item.tag });
      daemon.broadcast({ type: 'keeper:saved', item });
      res.status(201).json(item);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/keeper/append', (req, res) => {
    try {
      const { tag, content } = req.body || {};
      const item = daemon.keeper.append(tag, content);
      daemon.audit.log('keeper.append', { tag: item.tag });
      daemon.broadcast({ type: 'keeper:updated', item });
      res.json(item);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/keeper/pull', (req, res) => {
    try {
      const { tags } = req.body || {};
      if (!Array.isArray(tags) || tags.length === 0) {
        return res.status(400).json({ error: 'Tags array is required' });
      }
      const brief = daemon.keeper.pull(tags);
      if (!brief) return res.status(404).json({ error: 'No memories found for the given tags' });
      res.json({ brief, tags });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.patch('/api/keeper/:tag(*)', (req, res) => {
    try {
      const { content } = req.body || {};
      const item = daemon.keeper.update(req.params.tag, content);
      daemon.audit.log('keeper.update', { tag: item.tag });
      daemon.broadcast({ type: 'keeper:updated', item });
      res.json(item);
    } catch (err) {
      res.status(err.message.includes('does not exist') ? 404 : 400).json({ error: err.message });
    }
  });

  app.delete('/api/keeper/link/:tag(*)', (req, res) => {
    try {
      const { docPath } = req.body || {};
      daemon.keeper.unlink(req.params.tag, docPath);
      daemon.audit.log('keeper.unlink', { tag: req.params.tag, docPath });
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete('/api/keeper/:tag(*)', (req, res) => {
    try {
      const removed = daemon.keeper.delete(req.params.tag);
      if (!removed) return res.status(404).json({ error: `Memory #${req.params.tag} not found` });
      daemon.audit.log('keeper.delete', { tag: req.params.tag });
      daemon.broadcast({ type: 'keeper:deleted', tag: req.params.tag });
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/keeper/doc', async (req, res) => {
    try {
      const { tag, chatHistory, agentId } = req.body || {};
      if (!tag) return res.status(400).json({ error: 'Tag is required' });
      if (!chatHistory || !Array.isArray(chatHistory) || chatHistory.length === 0) {
        return res.status(400).json({ error: 'Chat history is required' });
      }
      const transcript = chatHistory
        .map(m => `**${m.from === 'user' ? 'User' : 'Agent'}:** ${m.text}`)
        .join('\n\n');
      const prompt = `You are a technical writer. Below is a conversation exploring an idea or feature. Write a comprehensive document that captures:\n\n1. The core idea and motivation\n2. Key decisions made during the discussion\n3. Architecture / design choices\n4. Implementation plan (if discussed)\n5. Open questions or next steps\n\nWrite in clear, structured markdown with headers. Be thorough — this document will be the reference for future work on this topic. Do not include a meta-summary about the conversation itself.\n\n---\n\nConversation:\n\n${transcript.slice(0, 40000)}`;
      let doc;
      if (daemon.journalist && typeof daemon.journalist.callHeadless === 'function') {
        doc = await daemon.journalist.callHeadless(prompt, { trackAs: '__keeper_doc__' });
      } else {
        doc = `# ${tag}\n\n*Auto-generated document from conversation*\n\n${transcript.slice(0, 5000)}`;
      }
      const item = daemon.keeper.saveDoc(tag, doc);
      daemon.audit.log('keeper.doc', { tag: item.tag, agentId });
      daemon.broadcast({ type: 'keeper:saved', item });
      res.status(201).json({ ...item, content: doc });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/keeper/link', (req, res) => {
    try {
      const { tag, docPath } = req.body || {};
      const item = daemon.keeper.link(tag, docPath);
      daemon.audit.log('keeper.link', { tag: item.tag, docPath });
      daemon.broadcast({ type: 'keeper:updated', item });
      res.json(item);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/keeper/parse', (req, res) => {
    const { text } = req.body || {};
    const parsed = Keeper.parseCommand(text || '');
    res.json({ parsed });
  });
}
