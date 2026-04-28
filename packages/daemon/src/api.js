// GROOVE — REST API
// FSL-1.1-Apache-2.0 — see LICENSE

import express from 'express';
import { resolve, dirname, join, sep, relative, isAbsolute } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync, unlinkSync, renameSync, rmSync, createReadStream, copyFileSync, realpathSync } from 'fs';
import { spawn, execFile, execFileSync } from 'child_process';
import { createHash, randomUUID } from 'crypto';
import { hostname, networkInterfaces, homedir } from 'os';
import { StringDecoder } from 'string_decoder';
import { request as httpRequest } from 'http';
import { lookup as mimeLookup } from './mimetypes.js';
import { listProviders, getProvider, clearInstallCache, getProviderMetadata, getProviderPath, setProviderPaths } from './providers/index.js';
import { OllamaProvider } from './providers/ollama.js';
import { ClaudeCodeProvider } from './providers/claude-code.js';
import { supportsSignalFlag, compareSemver, parseSemver } from './providers/groove-network.js';
import { ConsentManager } from '../../../moe-training/client/index.js';
import { validateAgentConfig, validateReasoningEffort, validateVerbosity } from './validate.js';
import { ROLE_INTEGRATIONS, wrapWithRoleReminder } from './process.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

let _daemon = null;

// Single source of truth for Pro features: the signed-in user's subscription
// status, populated by the daemon polling the backend with the stored JWT.
// There is no build-time "Pro edition" flag — one binary, account-gated.
function proOnly(req, res, next) {
  const sub = _daemon?.subscriptionCache || {};
  if (sub.active) return next();
  return res.status(403).json({
    error: 'Pro subscription required',
    edition: 'community',
    plan: sub.plan || 'community',
    subscriptionActive: false,
    upgrade: 'https://groovedev.ai/pro',
  });
}

function hasFeature(name) {
  return (_daemon?.subscriptionCache?.features || []).includes(name);
}

async function _executeApprovalRetry(daemon, approval) {
  const rp = approval.retryPayload;
  if (!rp) return;
  try {
    let resultText;
    if (rp.type === 'integration_exec') {
      const result = await daemon.mcpManager.execTool(rp.integrationId, rp.tool, rp.params);
      resultText = JSON.stringify(result).slice(0, 2000);
      daemon.audit.log('approval.autoRetry', { type: rp.type, integrationId: rp.integrationId, tool: rp.tool, agentId: rp.agentId, approvalId: approval.id });
    } else if (rp.type === 'google_drive_upload') {
      const result = await daemon.integrations.uploadToGoogleDrive(rp.filePath, {
        name: rp.name, folderId: rp.folderId, convert: rp.convert !== false,
      });
      resultText = JSON.stringify(result).slice(0, 2000);
      daemon.audit.log('approval.autoRetry', { type: rp.type, filePath: rp.filePath, agentId: rp.agentId, approvalId: approval.id });
    } else {
      return;
    }
    if (rp.agentId) {
      await daemon.processes.sendMessage(rp.agentId, `Your ${rp.type === 'integration_exec' ? 'integration action' : 'upload'} was approved and executed successfully. Result: ${resultText}`, 'system');
    }
  } catch (err) {
    console.log(`[Groove] Auto-retry for approval ${approval.id} failed: ${err.message}`);
    if (rp.agentId) {
      daemon.processes.sendMessage(rp.agentId, `Your ${rp.type === 'integration_exec' ? 'integration action' : 'upload'} was approved but execution failed: ${err.message}`, 'system').catch(() => {});
    }
  }
}

const FILE_READ_TOOLS = new Set(['Read', 'read_file']);
const FILE_WRITE_TOOLS = new Set(['Write', 'Edit', 'write_file', 'edit_file', 'create_file']);

export function createApi(app, daemon) {
  _daemon = daemon;

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

  // Security headers — preview proxy routes get relaxed framing policy so the
  // GUI can iframe the proxied dev server content.
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-XSS-Protection', '0');
    const isPreviewProxy = req.path.match(/^\/api\/preview\/[^/]+\/proxy/);
    if (isPreviewProxy) {
      res.setHeader('Content-Security-Policy', "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; frame-ancestors 'self'");
    } else {
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self' ws://localhost:* ws://127.0.0.1:* http://localhost:* http://127.0.0.1:*; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-src 'self' http://127.0.0.1:* http://localhost:*; frame-ancestors 'none'");
    }
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
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    res.json({ discoveries: daemon.memory.listDiscoveries({ role, limit }) });
  });

  app.post('/api/memory/discoveries', (req, res) => {
    const { agentId, role, trigger, fix, outcome } = req.body || {};
    const result = daemon.memory.addDiscovery({ agentId, role, trigger, fix, outcome });
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

  // Token usage
  app.get('/api/tokens', (req, res) => {
    res.json(daemon.tokens.getAll());
  });

  // List available providers
  app.get('/api/providers', (req, res) => {
    const providers = listProviders();
    for (const p of providers) {
      p.hasKey = daemon.credentials.hasKey(p.id);
      if (p.id === 'claude-code') {
        p.authStatus = ClaudeCodeProvider.getAuthStatus();
      }
      const meta = getProviderMetadata(p.id);
      if (meta) {
        p.setupGuide = meta.setupGuide;
        p.authMethods = meta.authMethods;
      }
      const customPath = getProviderPath(p.id);
      if (customPath) p.providerPath = customPath;
    }
    res.json(providers);
  });

  // --- Claude Code Auth ---

  app.get('/api/providers/claude-code/auth', (req, res) => {
    res.json(ClaudeCodeProvider.getAuthStatus());
  });

  app.post('/api/providers/claude-code/login', (req, res) => {
    ClaudeCodeProvider.triggerLogin();
    daemon.audit.log('claude-code.login.started', {});
    res.json({ ok: true });
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
    if (!OllamaProvider.isInstalled()) {
      const install = OllamaProvider.installCommand();
      return res.status(400).json({ error: `Ollama is not installed. Install with: ${install.command}` });
    }
    const broadcast = daemon.broadcast.bind(daemon);
    try {
      // Auto-start Ollama server if not running
      const running = await OllamaProvider.isServerRunning();
      if (!running) {
        broadcast({ type: 'ollama:serve:starting' });
        OllamaProvider.startServer();
        // Wait for server to be ready (up to 10s)
        for (let i = 0; i < 20; i++) {
          await new Promise((r) => setTimeout(r, 500));
          if (await OllamaProvider.isServerRunning()) break;
        }
        if (!(await OllamaProvider.isServerRunning())) {
          return res.status(500).json({ error: 'Could not start Ollama server. Run `ollama serve` manually.' });
        }
      }
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

  app.post('/api/providers/ollama/check', async (req, res) => {
    const installed = OllamaProvider.isInstalled();
    const serverRunning = installed ? await OllamaProvider.isServerRunning() : false;
    const install = OllamaProvider.installCommand();
    const hardware = OllamaProvider.getSystemHardware();
    const requirements = OllamaProvider.hardwareRequirements();
    res.json({ installed, serverRunning, install, hardware, requirements });
  });

  app.post('/api/providers/ollama/serve', async (req, res) => {
    if (!OllamaProvider.isInstalled()) return res.status(400).json({ error: 'Ollama is not installed' });
    const already = await OllamaProvider.isServerRunning();
    if (already) return res.json({ ok: true, alreadyRunning: true });
    const result = OllamaProvider.startServer();
    if (result.started) {
      // Wait a moment for server to come up
      await new Promise((r) => setTimeout(r, 2000));
      const running = await OllamaProvider.isServerRunning();
      res.json({ ok: running, method: result.method });
    } else {
      res.status(500).json({ error: 'Could not start server', command: result.command });
    }
  });

  app.post('/api/providers/ollama/stop', async (req, res) => {
    if (!OllamaProvider.isInstalled()) return res.status(400).json({ error: 'Ollama is not installed' });
    const running = await OllamaProvider.isServerRunning();
    if (!running) return res.json({ ok: true, alreadyStopped: true });
    const result = OllamaProvider.stopServer();
    await new Promise((r) => setTimeout(r, 1000));
    const stillRunning = await OllamaProvider.isServerRunning();
    res.json({ ok: !stillRunning, method: result.method });
  });

  app.post('/api/providers/ollama/restart', async (req, res) => {
    if (!OllamaProvider.isInstalled()) return res.status(400).json({ error: 'Ollama is not installed' });
    // Stop
    const running = await OllamaProvider.isServerRunning();
    if (running) {
      OllamaProvider.stopServer();
      await new Promise((r) => setTimeout(r, 1500));
    }
    // Start
    const result = OllamaProvider.startServer();
    if (result.started) {
      await new Promise((r) => setTimeout(r, 2000));
      const nowRunning = await OllamaProvider.isServerRunning();
      res.json({ ok: nowRunning, method: result.method });
    } else {
      res.status(500).json({ error: 'Could not restart server' });
    }
  });

  // --- Provider Management (install, login, set-path, verify) ---

  const MANAGEABLE_PROVIDERS = new Set(['claude-code', 'codex', 'gemini']);

  app.post('/api/providers/:id/install', (req, res) => {
    const { id } = req.params;
    if (!MANAGEABLE_PROVIDERS.has(id)) {
      return res.status(400).json({ error: `Invalid provider. Valid: ${[...MANAGEABLE_PROVIDERS].join(', ')}` });
    }

    const INSTALL_PACKAGES = {
      'claude-code': '@anthropic-ai/claude-code',
      'codex': '@openai/codex',
      'gemini': '@google/gemini-cli',
    };
    const pkg = INSTALL_PACKAGES[id];

    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('Cache-Control', 'no-cache');

    const write = (obj) => {
      try { res.write(JSON.stringify(obj) + '\n'); } catch { /* client disconnected */ }
    };

    write({ status: 'installing', output: `Installing ${pkg}...`, progress: 0 });

    const proc = spawn('bash', ['-lc', `npm install -g ${pkg}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: undefined },
    });

    let output = '';
    let errOutput = '';

    proc.stdout.on('data', (data) => {
      output += data.toString();
      write({ status: 'installing', output: data.toString().trim(), progress: 50 });
    });

    proc.stderr.on('data', (data) => {
      errOutput += data.toString();
      const line = data.toString().trim();
      if (line) write({ status: 'installing', output: line, progress: 50 });
    });

    proc.on('close', (code) => {
      clearInstallCache();
      const providerObj = getProvider(id);
      const installed = providerObj ? providerObj.constructor.isInstalled() : false;

      if (code === 0 && installed) {
        write({ status: 'complete', output: `${pkg} installed successfully`, progress: 100, installed: true });
        daemon.audit.log('provider.install', { provider: id, pkg, success: true });
        daemon.broadcast({ type: 'provider:status-changed', provider: id });
      } else {
        const reason = code !== 0
          ? (errOutput || output).slice(-500)
          : 'Install succeeded but provider binary not found in PATH';
        write({ status: 'error', output: reason, progress: 100, installed: false });
        daemon.audit.log('provider.install', { provider: id, pkg, success: false, code });
      }
      res.end();
    });

    proc.on('error', (err) => {
      write({ status: 'error', output: `Failed to start npm: ${err.message}`, progress: 100, installed: false });
      res.end();
    });

    req.on('close', () => {
      try { proc.kill(); } catch { /* already exited */ }
    });
  });

  app.post('/api/providers/:id/login', async (req, res) => {
    const { id } = req.params;
    if (!MANAGEABLE_PROVIDERS.has(id)) {
      return res.status(400).json({ error: `Invalid provider. Valid: ${[...MANAGEABLE_PROVIDERS].join(', ')}` });
    }

    if (id === 'gemini') {
      return res.json({ status: 'not-supported', message: 'Gemini uses API key authentication. Set your key in Settings.' });
    }

    if (id === 'claude-code') {
      const providerObj = getProvider(id);
      if (!providerObj || !providerObj.constructor.isInstalled()) {
        return res.status(400).json({ error: 'Claude Code is not installed. Install it first.' });
      }
      daemon.audit.log('provider.login.started', { provider: id });
      try {
        const result = await ClaudeCodeProvider.startLogin();
        clearInstallCache();
        daemon.broadcast({ type: 'provider:status-changed', provider: id });
        return res.json(result);
      } catch (err) {
        return res.status(500).json({ status: 'error', error: err.message });
      }
    }

    if (id === 'codex') {
      const providerObj = getProvider(id);
      if (!providerObj || !providerObj.constructor.isInstalled()) {
        return res.status(400).json({ error: 'Codex is not installed. Install it first.' });
      }

      const { method, key } = req.body || {};

      if (key) {
        daemon.audit.log('provider.login.started', { provider: id, method: 'api-key' });
        try {
          const result = await providerObj.constructor.onKeySet(key);
          clearInstallCache();
          daemon.broadcast({ type: 'provider:status-changed', provider: id });
          return res.json({ status: result.ok ? 'authenticated' : 'error', ...result });
        } catch (err) {
          return res.status(500).json({ status: 'error', error: err.message });
        }
      }

      if (method === 'chatgpt-plus') {
        daemon.audit.log('provider.login.started', { provider: id, method: 'chatgpt-plus' });
        return new Promise((resolve) => {
          let responded = false;
          const respond = (data, status) => {
            if (responded) return;
            responded = true;
            clearInstallCache();
            daemon.broadcast({ type: 'provider:status-changed', provider: id });
            if (status) res.status(status).json(data);
            else res.json(data);
            resolve();
          };

          const proc = spawn('codex', ['login'], {
            stdio: ['pipe', 'pipe', 'pipe'],
            shell: true,
          });
          proc.stdin.on('error', () => {});
          let stdout = '';
          let stderr = '';
          proc.stdout.on('data', (d) => { stdout += d.toString(); });
          proc.stderr.on('data', (d) => { stderr += d.toString(); });

          const timeout = setTimeout(() => {
            const urlMatch = (stdout + stderr).match(/https:\/\/\S+/);
            respond(urlMatch
              ? { status: 'pending', url: urlMatch[0], browserOpened: true }
              : { status: 'pending', message: 'Login started — check your browser', browserOpened: true });
          }, 5000);

          proc.on('close', (code) => {
            clearTimeout(timeout);
            if (code === 0) {
              let hasKey = false;
              try {
                const authPath = resolve(homedir(), '.codex', 'auth.json');
                if (existsSync(authPath)) {
                  const auth = JSON.parse(readFileSync(authPath, 'utf8'));
                  const token = auth.OPENAI_API_KEY
                    || (auth.auth_mode === 'chatgpt' && auth.tokens?.id_token)
                    || null;
                  if (token) {
                    daemon.credentials.setKey('codex', token);
                    hasKey = true;
                  }
                }
              } catch { /* auth.json missing or malformed — login still succeeded */ }
              respond({ status: 'authenticated', hasKey });
            } else {
              respond({ status: 'error', error: stderr.slice(-200) || `Login failed (exit ${code})` });
            }
          });

          proc.on('error', (err) => {
            clearTimeout(timeout);
            respond({ status: 'error', error: err.message }, 500);
          });
        });
      }

      return res.status(400).json({ error: 'Provide either { key: "..." } or { method: "chatgpt-plus" }' });
    }
  });

  app.post('/api/providers/:id/set-path', async (req, res) => {
    const { id } = req.params;
    if (!MANAGEABLE_PROVIDERS.has(id)) {
      return res.status(400).json({ error: `Invalid provider. Valid: ${[...MANAGEABLE_PROVIDERS].join(', ')}` });
    }

    const { path: customPath } = req.body || {};
    if (!customPath || typeof customPath !== 'string') {
      return res.status(400).json({ error: 'path is required' });
    }
    if (customPath.length > 500) {
      return res.status(400).json({ error: 'Path too long' });
    }
    if (!isAbsolute(customPath)) {
      return res.status(400).json({ error: 'Path must be absolute' });
    }

    if (!existsSync(customPath)) {
      return res.status(400).json({ error: `Path does not exist: ${customPath}` });
    }

    try {
      const stat = statSync(customPath);
      if (!stat.isFile()) {
        return res.status(400).json({ error: 'Path must point to a file, not a directory' });
      }
      const mode = stat.mode;
      const isExecutable = !!(mode & 0o111);
      if (!isExecutable) {
        return res.status(400).json({ error: 'File is not executable' });
      }
    } catch (err) {
      return res.status(400).json({ error: `Cannot stat path: ${err.message}` });
    }

    if (!daemon.config.providerPaths) daemon.config.providerPaths = {};
    daemon.config.providerPaths[id] = customPath;

    const { saveConfig } = await import('./firstrun.js');
    saveConfig(daemon.grooveDir, daemon.config);

    setProviderPaths(daemon.config.providerPaths);
    clearInstallCache();

    daemon.audit.log('provider.setPath', { provider: id, path: customPath });
    daemon.broadcast({ type: 'provider:status-changed', provider: id });

    res.json({ ok: true, path: customPath });
  });

  app.post('/api/providers/:id/verify', async (req, res) => {
    const { id } = req.params;
    if (!MANAGEABLE_PROVIDERS.has(id)) {
      return res.status(400).json({ error: `Invalid provider. Valid: ${[...MANAGEABLE_PROVIDERS].join(', ')}` });
    }

    clearInstallCache();
    const providerObj = getProvider(id);
    if (!providerObj) {
      return res.json({ installed: false, authenticated: false, version: null, error: 'Unknown provider' });
    }

    const installed = providerObj.constructor.isInstalled();
    let authenticated = false;
    let version = null;
    let error = null;

    if (installed) {
      const authStatus = providerObj.constructor.isAuthenticated?.();
      authenticated = !!(authStatus?.authenticated);

      const command = providerObj.constructor.command;
      const customPath = getProviderPath(id);
      const bin = customPath || command;

      try {
        version = execFileSync(bin, ['--version'], {
          encoding: 'utf8',
          timeout: 5000,
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: true,
        }).trim();
      } catch (err) {
        version = null;
        error = `Version check failed: ${err.message?.slice(0, 200) || 'unknown error'}`;
      }
    } else {
      error = 'Provider not installed';
    }

    daemon.broadcast({ type: 'provider:status-changed', provider: id });

    res.json({ installed, authenticated, version, error });
  });

  // --- Local Models (GGUF via HuggingFace) ---

  app.get('/api/models/installed', (req, res) => {
    const installed = daemon.modelManager.getInstalled();
    const llamaStatus = daemon.llamaServer.getStatus();
    res.json({ models: installed, llamaServer: llamaStatus });
  });

  app.get('/api/models/search', async (req, res) => {
    try {
      const query = req.query.q || req.query.query || '';
      if (!query) return res.status(400).json({ error: 'query parameter (q) is required' });
      const results = await daemon.modelManager.search(query, {
        limit: parseInt(req.query.limit) || 20,
      });
      res.json(results);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/models/:repoId(*)/files', async (req, res) => {
    try {
      const files = await daemon.modelManager.getModelFiles(req.params.repoId);
      res.json(files);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/models/download', async (req, res) => {
    try {
      const { repoId, filename } = req.body;
      if (!repoId || !filename) return res.status(400).json({ error: 'repoId and filename are required' });
      // Start download in background — progress via WebSocket
      daemon.modelManager.download(repoId, filename).catch(() => {});
      daemon.audit.log('model.download', { repoId, filename });
      res.json({ started: true, filename, repoId });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/models/download/cancel', (req, res) => {
    const { filename } = req.body;
    if (!filename) return res.status(400).json({ error: 'filename is required' });
    const cancelled = daemon.modelManager.cancelDownload(filename);
    res.json({ cancelled });
  });

  app.get('/api/models/downloads', (req, res) => {
    res.json(daemon.modelManager.getActiveDownloads());
  });

  app.delete('/api/models/:id', (req, res) => {
    const deleted = daemon.modelManager.deleteModel(req.params.id);
    if (deleted) {
      daemon.audit.log('model.delete', { id: req.params.id });
      res.json({ ok: true });
    } else {
      res.status(404).json({ error: 'Model not found' });
    }
  });

  app.get('/api/models/recommend', (req, res) => {
    const ramGb = parseInt(req.query.ram) || 16;
    const quant = daemon.modelManager.recommendQuantization('7B', ramGb);
    res.json({ recommendedQuantization: quant, ramGb });
  });

  app.get('/api/models/recommended', (req, res) => {
    const hardware = OllamaProvider.getSystemHardware();
    const catalog = OllamaProvider.catalog;
    // Filter to models that fit in RAM — same threshold as hardware recommendation
    // Apple Silicon unified memory handles these well, no aggressive headroom needed
    const recommended = catalog
      .filter((m) => m.ramGb <= hardware.totalRamGb)
      .sort((a, b) => b.ramGb - a.ramGb) // Biggest that fits = best quality
      .slice(0, 12);
    res.json({ models: recommended, hardware });
  });

  app.get('/api/llama/status', (req, res) => {
    res.json(daemon.llamaServer.getStatus());
  });

  // --- Credentials ---

  app.get('/api/credentials', (req, res) => {
    res.json(daemon.credentials.listProviders());
  });

  app.post('/api/credentials/:provider', async (req, res) => {
    if (!req.body.key) return res.status(400).json({ error: 'key is required' });
    daemon.credentials.setKey(req.params.provider, req.body.key);
    daemon.audit.log('credential.set', { provider: req.params.provider });

    // Provider-specific auth setup (e.g., Codex auto-login)
    const provider = getProvider(req.params.provider);
    let authResult = null;
    if (provider?.constructor?.onKeySet) {
      try { authResult = await provider.constructor.onKeySet(req.body.key); } catch { /* best effort */ }
    }

    res.json({ ok: true, masked: daemon.credentials.mask(req.body.key), auth: authResult });
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

  // Downshift suggestion — NEVER auto-applied. User must accept via UI.
  // Returns null (204) when classifier has no strong suggestion.
  app.get('/api/agents/:id/routing/suggestion', (req, res) => {
    const suggestion = daemon.router.getSuggestion(req.params.id);
    if (!suggestion) return res.status(204).send();
    res.json(suggestion);
  });

  // Edition
  app.get('/api/edition', (req, res) => {
    const sub = daemon.subscriptionCache || {};
    res.json({
      edition: sub.active ? 'pro' : 'community',
      plan: sub.plan || 'community',
      subscriptionActive: sub.active || false,
      features: sub.features || [],
      seats: sub.seats || 1,
      periodEnd: sub.periodEnd || null,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd || false,
      status: sub.status || 'none',
    });
  });

  // Daemon status
  app.get('/api/status', (req, res) => {
    const sub = daemon.subscriptionCache || {};
    res.json({
      version: pkgVersion,
      pid: process.pid,
      uptime: process.uptime(),
      agents: daemon.registry.getAll().length,
      running: daemon.processes.getRunningCount(),
      host: daemon.host,
      port: daemon.port,
      projectDir: daemon.projectDir,
      edition: sub.active ? 'pro' : 'community',
      homedir: homedir(),
    });
  });

  // --- Project Directory ---

  app.get('/api/project-dir', (req, res) => {
    res.json({
      projectDir: daemon.projectDir,
      recentProjects: daemon.config.recentProjects || [],
    });
  });

  app.post('/api/project-dir', (req, res) => {
    const { path: dirPath } = req.body || {};
    if (!dirPath || typeof dirPath !== 'string') {
      return res.status(400).json({ error: 'path is required' });
    }
    try {
      daemon.setProjectDir(dirPath);
      editorRootOverride = null;
      res.json({ projectDir: daemon.projectDir, recentProjects: daemon.config.recentProjects || [] });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
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
      const team = daemon.teams.create(req.body.name, req.body.workingDir);
      daemon.audit.log('team.create', { id: team.id, name: team.name, workingDir: team.workingDir });
      res.status(201).json(team);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.patch('/api/teams/:id', (req, res) => {
    try {
      if (req.body.name) daemon.teams.rename(req.params.id, req.body.name);
      if (req.body.workingDir !== undefined) daemon.teams.setWorkingDir(req.params.id, req.body.workingDir);
      const team = daemon.teams.get(req.params.id);
      daemon.audit.log('team.update', { id: team.id, name: team.name, workingDir: team.workingDir });
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

  // --- Approvals ---

  app.get('/api/approvals', (req, res) => {
    res.json({
      pending: daemon.supervisor.getPending(),
      resolved: daemon.supervisor.getResolved().slice(-20),
      status: daemon.supervisor.getStatus(),
    });
  });

  app.post('/api/approvals/:id/approve', async (req, res) => {
    const result = daemon.supervisor.approve(req.params.id);
    if (!result) return res.status(404).json({ error: 'Approval not found' });
    daemon.audit.log('approval.approve', { id: req.params.id });
    if (result.retryPayload) {
      _executeApprovalRetry(daemon, result).catch((err) => {
        console.log(`[Groove] Approval auto-retry failed: ${err.message}`);
      });
    }
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

  // Per-team token burn ranked by total. Answers "which team burned the most?"
  app.get('/api/tokens/by-team', (req, res) => {
    const agents = daemon.registry.getAll();
    const usage = daemon.tokens.getAll();
    const teams = daemon.teams.list();
    const unassignedId = '__unassigned__';

    const perTeam = new Map();
    for (const t of teams) {
      perTeam.set(t.id, {
        teamId: t.id,
        teamName: t.name,
        isDefault: !!t.isDefault,
        agentCount: 0,
        totalTokens: 0,
        totalCostUsd: 0,
        avgTokensPerAgent: 0,
      });
    }
    perTeam.set(unassignedId, {
      teamId: unassignedId,
      teamName: '(unassigned)',
      isDefault: false,
      agentCount: 0,
      totalTokens: 0,
      totalCostUsd: 0,
      avgTokensPerAgent: 0,
    });

    for (const agent of agents) {
      const bucket = perTeam.get(agent.teamId) || perTeam.get(unassignedId);
      const u = usage[agent.id];
      if (!u) continue;
      bucket.agentCount += 1;
      bucket.totalTokens += u.total || 0;
      bucket.totalCostUsd += u.totalCostUsd || 0;
    }

    const result = [...perTeam.values()]
      .map((t) => ({
        ...t,
        avgTokensPerAgent: t.agentCount > 0 ? Math.round(t.totalTokens / t.agentCount) : 0,
      }))
      .filter((t) => t.agentCount > 0 || t.isDefault)
      .sort((a, b) => b.totalTokens - a.totalTokens);

    res.json({ teams: result });
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
      const { message } = req.body;
      if (!message || typeof message !== 'string' || !message.trim()) {
        return res.status(400).json({ error: 'message is required' });
      }
      const agent = daemon.registry.get(req.params.id);
      if (!agent) return res.status(404).json({ error: 'Agent not found' });

      // Record user feedback so the journalist can include it in future agent context
      if (daemon.journalist) daemon.journalist.recordUserFeedback(agent, message.trim());

      // Agent loop path — send message directly to the running loop
      const wrappedMessage = wrapWithRoleReminder(agent.role, message.trim());
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
          prompt: message.trim(),
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
          prompt: message.trim(),
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
      const response = await daemon.journalist.callHeadless(fullPrompt, { trackAs: '__planner__' });
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
    if (user) await daemon.setAuthToken(token);
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

    const rawName = user?.displayName || user?.id || '';
    const displayName = rawName.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
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
  .btn{display:inline-block;margin-top:20px;padding:8px 20px;font-size:13px;font-weight:500;color:#e6e6e6;background:#2c313a;border:1px solid #3a3f48;border-radius:999px;cursor:pointer;transition:background 0.15s}
  .btn:hover{background:#33afbc;border-color:#33afbc;color:#1a1e25}
</style>
</head><body>
<div class="card">
  <div class="logo"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></div>
  <h2>Connected to Groove</h2>
  ${displayName ? `<div class="user">${displayName}</div>` : ''}
  <p id="msg">You can close this tab and return to Groove.</p>
  <button class="btn" onclick="window.close()">Close tab</button>
</div>
<script>setTimeout(()=>{try{window.close()}catch(e){}setTimeout(()=>{document.getElementById('msg').textContent='Return to the Groove app to continue.'},500)},3000)</script>
</body></html>`);
  });

  // Auth status — returns current user + subscription or { authenticated: false }
  app.get('/api/auth/status', async (req, res) => {
    const user = daemon.skills.getUser();
    const token = daemon.skills.getToken();
    if (!user || !token) return res.json({ authenticated: false });
    const sub = daemon.subscriptionCache || {};
    res.json({ authenticated: true, user, subscription: sub });
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

  // --- Subscription ---

  const SUB_API = 'https://docs.groovedev.ai/api/v1';

  app.get('/api/subscription/plans', async (req, res) => {
    try {
      const resp = await fetch(`${SUB_API}/subscription/plans`);
      const data = await resp.json();
      res.json(data);
    } catch (err) {
      res.status(502).json({ error: 'Failed to fetch plans', message: err.message });
    }
  });

  app.get('/api/subscription/status', (req, res) => {
    const sub = daemon.subscriptionCache || {};
    res.json(sub);
  });

  app.post('/api/subscription/checkout', async (req, res) => {
    if (!daemon.authToken) return res.status(401).json({ error: 'Not authenticated' });
    const { priceId } = req.body;
    if (!priceId || typeof priceId !== 'string') return res.status(400).json({ error: 'priceId required' });
    try {
      const resp = await fetch(`${SUB_API}/subscription/checkout`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${daemon.authToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ priceId }),
      });
      const data = await resp.json();
      if (!resp.ok) return res.status(resp.status).json(data);
      res.json(data);
    } catch (err) {
      res.status(502).json({ error: 'Checkout failed', message: err.message });
    }
  });

  app.post('/api/subscription/portal', async (req, res) => {
    if (!daemon.authToken) return res.status(401).json({ error: 'Not authenticated' });
    try {
      const resp = await fetch(`${SUB_API}/subscription/portal`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${daemon.authToken}`, 'Content-Type': 'application/json' },
        body: '{}',
      });
      const data = await resp.json();
      if (!resp.ok) return res.status(resp.status).json(data);
      res.json(data);
    } catch (err) {
      res.status(502).json({ error: 'Portal failed', message: err.message });
    }
  });

  app.patch('/api/subscription', async (req, res) => {
    if (!daemon.authToken) return res.status(401).json({ error: 'Not authenticated' });
    const { seats } = req.body;
    if (!seats || typeof seats !== 'number' || seats < 1 || seats > 999 || !Number.isInteger(seats)) {
      return res.status(400).json({ error: 'seats must be integer 1-999' });
    }
    try {
      const resp = await fetch(`${SUB_API}/subscription`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${daemon.authToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ seats }),
      });
      const data = await resp.json();
      if (!resp.ok) return res.status(resp.status).json(data);
      daemon._pollSubscription();
      res.json(data);
    } catch (err) {
      res.status(502).json({ error: 'Seat update failed', message: err.message });
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
    const absPath = req.query.path || homedir();
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

  const IGNORED_NAMES = new Set(['.DS_Store', '__pycache__']);

  // Editor root directory — always tracks daemon.projectDir unless explicitly
  // overridden via POST /api/files/root. Reset on project-dir change.
  let editorRootOverride = null;

  function getEditorRoot() { return editorRootOverride || daemon.projectDir; }

  function validateFilePath(relPath, projectDir) {
    if (!relPath || typeof relPath !== 'string') return { error: 'path is required' };
    if (relPath.startsWith('/') || relPath.includes('..') || relPath.includes('\0')) {
      return { error: 'Invalid path' };
    }
    const fullPath = resolve(projectDir, relPath);
    if (!fullPath.startsWith(projectDir)) return { error: 'Path outside project' };
    // Symlink resolution — ensure real path is also within project
    try {
      const realPath = realpathSync(fullPath);
      const realBase = realpathSync(projectDir);
      if (!realPath.startsWith(realBase)) {
        return { error: 'Path outside project (symlink)' };
      }
    } catch {
      // File may not exist yet (for writes) — path prefix check is sufficient
    }
    return { fullPath };
  }

  // Get/set the editor working directory
  app.get('/api/files/root', (req, res) => {
    res.json({ root: getEditorRoot() });
  });

  app.post('/api/files/root', (req, res) => {
    const { root } = req.body || {};
    if (!root || typeof root !== 'string') return res.status(400).json({ error: 'root path is required' });
    if (!root.startsWith('/')) return res.status(400).json({ error: 'root must be an absolute path' });
    if (root.includes('\0') || root.includes('..')) return res.status(400).json({ error: 'Invalid path' });
    if (!existsSync(root)) return res.status(404).json({ error: 'Directory not found' });
    try {
      const stat = statSync(root);
      if (!stat.isDirectory()) return res.status(400).json({ error: 'Path is not a directory' });
    } catch { return res.status(400).json({ error: 'Cannot access directory' }); }
    editorRootOverride = root;
    daemon.audit.log('editor.root.set', { root });
    res.json({ ok: true, root: getEditorRoot() });
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

      const dirs = raw.filter((e) => {
        if (e.name === '.DS_Store') return false;
        if (e.isDirectory()) return true;
        if (e.isSymbolicLink()) {
          try { return statSync(resolve(fullPath, e.name)).isDirectory(); }
          catch { return true; }
        }
        return false;
      }).sort((a, b) => a.name.localeCompare(b.name));
      const files = raw.filter((e) => {
        if (e.name === '.DS_Store') return false;
        if (e.isFile()) return true;
        if (e.isSymbolicLink()) {
          try { return statSync(resolve(fullPath, e.name)).isFile(); }
          catch { return false; }
        }
        return false;
      }).sort((a, b) => a.name.localeCompare(b.name));

      for (const d of dirs) {
        const childPath = relPath ? `${relPath}/${d.name}` : d.name;
        const childFull = resolve(fullPath, d.name);
        let hasChildren = false;
        try {
          const children = readdirSync(childFull, { withFileTypes: true });
          hasChildren = children.some((c) => c.name !== '.DS_Store');
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

  // Git status — returns modified/added/deleted/untracked files
  app.get('/api/files/git-status', (req, res) => {
    const rootDir = getEditorRoot();
    if (!rootDir) return res.status(400).json({ error: 'Editor root not set' });

    execFile('git', ['status', '--porcelain'], { cwd: rootDir, timeout: 10000 }, (err, stdout) => {
      if (err) {
        // Not a git repo or git not installed — return empty
        return res.json({ entries: [] });
      }
      const STATUS_MAP = { 'M': 'M', 'A': 'A', '?': '?', 'D': 'D', 'R': 'R', 'U': 'U' };
      const entries = [];
      for (const line of stdout.split('\n')) {
        if (!line.trim()) continue;
        const code = line[0] === ' ' ? line[1] : line[0];
        const filePath = line.slice(3).trim();
        if (!filePath) continue;
        entries.push({ path: filePath, status: STATUS_MAP[code] || code });
      }
      res.json({ entries });
    });
  });

  // Git branch — returns the current branch name
  app.get('/api/files/git-branch', (req, res) => {
    const rootDir = getEditorRoot();
    if (!rootDir) return res.status(400).json({ error: 'Editor root not set' });

    execFile('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: rootDir, timeout: 5000 }, (err, stdout) => {
      if (err) {
        return res.json({ branch: null });
      }
      res.json({ branch: stdout.trim() });
    });
  });

  // Files touched by an agent during its session
  app.get('/api/agents/:id/files-touched', (req, res) => {
    const agent = daemon.registry.get(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    const files = daemon.registry.getFilesTouched(req.params.id);
    res.json({ files, total: files.length });
  });

  // Git diff — structured diff for a file, an agent's touched files, or all uncommitted changes
  app.get('/api/files/git-diff', (req, res) => {
    const rootDir = getEditorRoot();
    if (!rootDir) return res.status(400).json({ error: 'Editor root not set' });

    let paths = [];

    if (req.query.path) {
      const result = validateFilePath(req.query.path, rootDir);
      if (result.error) return res.status(400).json({ error: result.error });
      paths = [req.query.path];
    } else if (req.query.agentId) {
      const agent = daemon.registry.get(req.query.agentId);
      if (!agent) return res.status(404).json({ error: 'Agent not found' });
      paths = daemon.registry.getFilesTouched(req.query.agentId).map(f => f.path);
      if (paths.length === 0) return res.json({ diffs: [] });
      // Validate each path
      for (const p of paths) {
        if (p.startsWith('/') || p.includes('..') || p.includes('\0')) {
          return res.status(400).json({ error: 'Invalid path in agent files' });
        }
      }
    }

    const args = ['diff'];
    const cachedArgs = ['diff', '--cached'];
    if (paths.length > 0) {
      args.push('--', ...paths);
      cachedArgs.push('--', ...paths);
    }

    try {
      const unstaged = execFileSync('git', args, { cwd: rootDir, timeout: 15000, maxBuffer: 10 * 1024 * 1024 }).toString();
      const staged = execFileSync('git', cachedArgs, { cwd: rootDir, timeout: 15000, maxBuffer: 10 * 1024 * 1024 }).toString();
      const combined = (staged + '\n' + unstaged).trim();
      const diffs = parseDiffOutput(combined);
      res.json({ diffs });
    } catch (err) {
      if (err.status !== undefined) {
        return res.json({ diffs: [] });
      }
      res.status(500).json({ error: 'Failed to compute diff' });
    }
  });

  function parseDiffOutput(raw) {
    if (!raw) return [];
    const fileDiffs = raw.split(/^diff --git /m).filter(Boolean);
    return fileDiffs.map(chunk => {
      const lines = chunk.split('\n');
      const headerMatch = lines[0]?.match(/a\/(.+?) b\/(.+)/);
      const filePath = headerMatch ? headerMatch[2] : 'unknown';
      let status = 'modified';
      if (lines.some(l => l.startsWith('new file'))) status = 'added';
      else if (lines.some(l => l.startsWith('deleted file'))) status = 'deleted';
      let additions = 0, deletions = 0;
      const hunks = [];
      let currentHunk = null;
      for (const line of lines) {
        if (line.startsWith('@@')) {
          if (currentHunk) hunks.push(currentHunk);
          currentHunk = { header: line, lines: [] };
        } else if (currentHunk) {
          currentHunk.lines.push(line);
          if (line.startsWith('+') && !line.startsWith('+++')) additions++;
          else if (line.startsWith('-') && !line.startsWith('---')) deletions++;
        }
      }
      if (currentHunk) hunks.push(currentHunk);
      return { path: filePath, status, hunks, additions, deletions, content: 'diff --git ' + chunk };
    });
  }

  // File search — fuzzy filename matching for quick-open (Ctrl+P)
  app.get('/api/files/search', (req, res) => {
    const query = req.query.q;
    if (!query || typeof query !== 'string') return res.status(400).json({ error: 'q parameter is required' });
    if (query.length > 200) return res.status(400).json({ error: 'Query too long' });

    const maxResults = Math.min(parseInt(req.query.maxResults, 10) || 50, 200);
    const rootDir = getEditorRoot();
    if (!rootDir) return res.status(400).json({ error: 'Editor root not set' });

    const lowerQuery = query.toLowerCase();
    const results = [];

    function fuzzyMatch(name) {
      const lower = name.toLowerCase();
      let qi = 0;
      for (let i = 0; i < lower.length && qi < lowerQuery.length; i++) {
        if (lower[i] === lowerQuery[qi]) qi++;
      }
      return qi === lowerQuery.length;
    }

    function walk(dir, rel) {
      if (results.length >= maxResults) return;
      let entries;
      try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (results.length >= maxResults) return;
        if (IGNORED_NAMES.has(entry.name) || entry.name.startsWith('.')) continue;
        const childRel = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          walk(resolve(dir, entry.name), childRel);
        } else if (entry.isFile() && fuzzyMatch(entry.name)) {
          results.push({ path: childRel, name: entry.name });
        }
      }
    }

    try {
      walk(rootDir, '');
      res.json({ files: results });
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

  // Find recommended-team.json — check planner agents first (they write the file),
  // sorted by most recent activity so the latest planner's team wins.
  function findRecommendedTeam() {
    const agents = daemon.registry.getAll();
    const planners = agents
      .filter((a) => a.role === 'planner' && a.workingDir)
      .sort((a, b) => (b.lastActivity || b.spawnedAt || '').localeCompare(a.lastActivity || a.spawnedAt || ''));

    const candidates = [];
    for (const planner of planners) {
      const p = resolve(planner.workingDir, '.groove', 'recommended-team.json');
      if (existsSync(p)) candidates.push({ path: p, teamId: planner.teamId || null, agentId: planner.id || null });
    }
    const fallback = resolve(daemon.grooveDir, 'recommended-team.json');
    if (existsSync(fallback) && !candidates.some(c => c.path === fallback)) {
      candidates.push({ path: fallback, teamId: planners[0]?.teamId || null, agentId: planners[0]?.id || null });
    }
    if (candidates.length === 0) return null;

    for (const c of candidates) {
      try {
        const data = JSON.parse(readFileSync(c.path, 'utf8'));
        if (data._meta?.teamId) {
          return { path: c.path, teamId: data._meta.teamId, agentId: data._meta.agentId || c.agentId };
        }
      } catch {}
    }
    return candidates[0];
  }

  app.get('/api/recommended-team', (req, res) => {
    const found = findRecommendedTeam();
    if (!found) {
      return res.json({ exists: false, agents: [] });
    }
    try {
      const raw = JSON.parse(readFileSync(found.path, 'utf8'));
      delete raw._meta;
      // Support both old format (bare array) and new format ({ projectDir, agents })
      if (Array.isArray(raw)) {
        res.json({ exists: true, agents: raw, teamId: found.teamId });
      } else if (raw && Array.isArray(raw.agents)) {
        res.json({ exists: true, agents: raw.agents, projectDir: raw.projectDir || null, teamId: found.teamId });
      } else {
        res.json({ exists: false, agents: [] });
      }
    } catch {
      res.json({ exists: false, agents: [] });
    }
  });

  app.post('/api/recommended-team/launch', async (req, res) => {
    const found = findRecommendedTeam();
    if (!found) {
      return res.status(404).json({ error: 'No recommended team found. Run a planner first.' });
    }
    const planPath = found.path;
    const planContents = readFileSync(planPath, 'utf8');
    try {
      const raw = JSON.parse(planContents);
      delete raw._meta;

      // Delete immediately after reading to prevent duplicate launches from poll races.
      // If every spawn below fails, we'll restore the plan from planContents so the
      // user can retry without re-prompting the planner.
      try { unlinkSync(planPath); } catch { /* already gone */ }

      // Support both old format (bare array) and new format ({ projectDir, agents, preview })
      let agentConfigs;
      let projectDir = null;
      let previewBlock = null;

      // Frontend Team Builder override — if body.agents is provided, use it
      // instead of the planner's recommended-team.json
      if (Array.isArray(req.body?.agents) && req.body.agents.length > 0) {
        agentConfigs = req.body.agents;
        projectDir = raw.projectDir || null;
        previewBlock = raw.preview || null;
      } else if (Array.isArray(raw)) {
        agentConfigs = raw;
      } else if (raw && Array.isArray(raw.agents)) {
        agentConfigs = raw.agents;
        projectDir = raw.projectDir || null;
        previewBlock = raw.preview || null;
      } else {
        return res.status(400).json({ error: 'Invalid recommended team format' });
      }

      if (agentConfigs.length === 0) {
        return res.status(400).json({ error: 'Recommended team is empty' });
      }

      const maxPhase = agentConfigs.reduce((max, config) => {
        const phase = typeof config.phase === 'number' ? config.phase : 1;
        return Math.max(max, phase);
      }, 1);

      // Resolve base directory from the planner that wrote the file, not the daemon root
      const plannerAgent = found.agentId ? daemon.registry.get(found.agentId) : null;
      const baseDir = plannerAgent?.workingDir || daemon.config?.defaultWorkingDir || daemon.projectDir;
      const plannerProvider = plannerAgent?.provider || undefined;

      // Use the planner's teamId so launched agents join the correct team.
      // Priority: explicit from frontend > agent that wrote the file > most recent planner > default
      let launchTeamId = req.body?.teamId || found.teamId || null;
      if (!launchTeamId) {
        const planners = daemon.registry.getAll()
          .filter((a) => a.role === 'planner')
          .sort((a, b) => (b.lastActivity || '').localeCompare(a.lastActivity || ''));
        launchTeamId = planners[0]?.teamId || null;
      }
      const defaultTeamId = launchTeamId || daemon.teams.getDefault()?.id || null;

      // If planner specified a project directory, create it and use it as workingDir
      let projectWorkingDir = baseDir;
      if (projectDir) {
        // Sanitize: kebab-case, no path traversal
        const safeName = String(projectDir).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 64);
        projectWorkingDir = resolve(baseDir, safeName);
        mkdirSync(projectWorkingDir, { recursive: true });
        console.log(`[Groove] Project directory: ${projectWorkingDir}`);
      }

      function normalizeScope(patterns, baseDir) {
        if (!patterns || !Array.isArray(patterns)) return patterns;
        return patterns.map((p) => {
          if (typeof p === 'string' && p.startsWith('/')) {
            const rel = relative(baseDir, p);
            if (!rel.startsWith('..')) return rel;
            return p.slice(1);
          }
          return p;
        });
      }

      // Team-level overrides from the pre-planner config panel
      const teamProvider = req.body?.teamProvider || undefined;
      const teamModel = req.body?.teamModel || undefined;
      const teamReasoningEffort = req.body?.teamReasoningEffort != null ? Number(req.body.teamReasoningEffort) : undefined;
      const teamTemperature = req.body?.teamTemperature != null ? Number(req.body.teamTemperature) : undefined;
      const teamVerbosity = req.body?.teamVerbosity != null ? Number(req.body.teamVerbosity) : undefined;

      if (teamProvider || teamModel) {
        for (const c of agentConfigs) {
          if (teamProvider) c.provider = teamProvider;
          if (teamModel) c.model = teamModel;
          if (teamReasoningEffort !== undefined) c.reasoningEffort = teamReasoningEffort;
          if (teamTemperature !== undefined) c.temperature = teamTemperature;
          if (teamVerbosity !== undefined) c.verbosity = teamVerbosity;
        }
      }

      // Separate phase 1 (builders) and phase 2 (QC/finisher)
      const phase1 = agentConfigs.filter((a) => !a.phase || a.phase === 1);
      let phase2 = agentConfigs.filter((a) => a.phase === 2);

      // Safety net: if planner forgot the QC agent, auto-add one
      if (phase2.length === 0 && phase1.length >= 2) {
        phase2 = [{
          name: 'qc-agent',
          role: 'fullstack', phase: 2, scope: [],
          provider: teamProvider || plannerProvider || daemon.config?.defaultProvider || undefined,
          prompt: 'QC Senior Dev: All builder agents have completed. Audit their changes for correctness, fix any issues, run tests, and verify the project builds cleanly (npm run build). Do NOT start long-running dev servers — just verify the build succeeds. Commit all changes. IMPORTANT: Do NOT delete files from other projects or directories outside this project.',
        }];
      }

      // Reset handoff cycle counters for this team so a fresh launch starts clean
      if (daemon._handoffCounts) {
        for (const key of [...daemon._handoffCounts.keys()]) {
          if (key.startsWith(`${defaultTeamId}:`)) daemon._handoffCounts.delete(key);
        }
      }

      // Spawn phase 1 agents — reuse idle team members with matching roles when possible
      const spawned = [];
      const reused = [];
      const failed = [];
      const phase1Ids = [];
      const teamAgents = daemon.registry.getAll().filter((a) => a.teamId === defaultTeamId);

      for (const config of phase1) {
        const prompt = config.prompt || '';

        // Reuse an existing agent with matching role in this team — never spawn
        // duplicates. The team's agents persist across tasks regardless of status.
        const existing = teamAgents.find((a) =>
          a.role === config.role &&
          a.role !== 'planner' &&
          !reused.some((r) => r.id === a.id)
        );

        if (existing) {
          // Role already exists in this team — never spawn a duplicate.
          // With a prompt: kill+respawn with fresh context and the new task.
          // Without a prompt: keep the existing agent as-is (the planner often
          // emits Mode-1 shaped JSON with empty prompts on follow-up; if we
          // let that fall through to "spawn new", we get 2 backends, 2 fronts).
          if (!prompt) {
            reused.push({ id: existing.id, name: existing.name, role: existing.role, reusedFrom: existing.name });
            phase1Ids.push(existing.id);
            continue;
          }
          try {
            if (existing.status === 'running' || existing.status === 'starting') {
              try { await daemon.processes.kill(existing.id); } catch { /* already dead */ }
            }
            daemon.registry.remove(existing.id);
            daemon.locks.release(existing.id);

            // Spawn fresh with the same name/team but new prompt + full context
            const validated = validateAgentConfig({
              role: existing.role,
              scope: normalizeScope(config.scope || existing.scope || [], existing.workingDir || projectWorkingDir),
              prompt,
              provider: config.provider || plannerProvider || daemon.config?.defaultProvider || existing.provider || undefined,
              model: config.model || existing.model || daemon.config?.defaultModel || 'auto',
              permission: config.permission || existing.permission || 'auto',
              workingDir: existing.workingDir || projectWorkingDir,
              name: existing.name,
              integrationApproval: config.integrationApproval || existing.integrationApproval || undefined,
              reasoningEffort: config.reasoningEffort,
              temperature: config.temperature,
              verbosity: config.verbosity,
            });
            validated.teamId = defaultTeamId;
            const newAgent = await daemon.processes.spawn(validated);
            reused.push({ id: newAgent.id, name: newAgent.name, role: newAgent.role, reusedFrom: existing.name });
            phase1Ids.push(newAgent.id);
            daemon.audit.log('team.reuse', { oldId: existing.id, newId: newAgent.id, role: config.role });
          } catch (err) {
            failed.push({ role: config.role, error: `reuse failed: ${err.message}` });
          }
        } else {
          // No matching agent — spawn a new one
          try {
            const validated = validateAgentConfig({
              role: config.role,
              scope: normalizeScope(config.scope || [], config.workingDir || projectWorkingDir),
              prompt,
              provider: config.provider || plannerProvider || daemon.config?.defaultProvider || undefined,
              model: config.model || daemon.config?.defaultModel || 'auto',
              permission: config.permission || 'auto',
              workingDir: config.workingDir || projectWorkingDir,
              name: config.name || undefined,
              integrationApproval: config.integrationApproval || undefined,
              reasoningEffort: config.reasoningEffort,
              temperature: config.temperature,
              verbosity: config.verbosity,
            });
            validated.teamId = defaultTeamId;
            const agent = await daemon.processes.spawn(validated);
            spawned.push({ id: agent.id, name: agent.name, role: agent.role });
            phase1Ids.push(agent.id);
          } catch (err) {
            failed.push({ role: config.role, error: err.message });
            console.log(`[Groove] Failed to spawn ${config.role}: ${err.message}`);
          }
        }
      }

      if (failed.length > 0) {
        console.warn(`[Groove] Team launch had ${failed.length} failure(s):`, failed.map((f) => `${f.role}: ${f.error}`).join(', '));
      }

      // Phase 2 agents also scoped to projectWorkingDir
      if (phase2.length > 0 && phase1Ids.length > 0) {
        // Dedup: if a running idle fullstack already exists in this team,
        // skip the phase2 queue — _triggerIdleQC will notify it when phase 1 completes
        const existingQC = teamAgents.find((a) =>
          a.role === 'fullstack' &&
          (a.status === 'running' || a.status === 'starting')
        );
        const qcIsIdle = existingQC && (daemon.journalist?.getAgentFiles(existingQC) || []).length === 0;

        if (existingQC && qcIsIdle) {
          daemon.audit.log('phase2.skipQueue', { existingQC: existingQC.id, name: existingQC.name, reason: 'idle fullstack exists' });
        } else {
          daemon._pendingPhase2 = daemon._pendingPhase2 || [];
          daemon._pendingPhase2.push({
            waitFor: phase1Ids,
            agents: phase2.map((c) => ({
              role: c.role, scope: c.scope || [], prompt: c.prompt || '',
              provider: c.provider || plannerProvider || daemon.config?.defaultProvider || undefined, model: c.model || daemon.config?.defaultModel || 'auto',
              permission: c.permission || 'auto',
              reasoningEffort: c.reasoningEffort, temperature: c.temperature, verbosity: c.verbosity,
              workingDir: c.workingDir || projectWorkingDir,
              name: c.name || undefined,
              teamId: defaultTeamId,
            })),
          });
        }
      }

      // Stash the preview block so the daemon can launch it when the team
      // finishes. The plan file gets deleted seconds after this endpoint returns.
      if (previewBlock && daemon.preview && defaultTeamId) {
        daemon.preview.stashPlan(defaultTeamId, previewBlock, projectWorkingDir, maxPhase, agentConfigs);
      }

      // Restore the plan if nothing actually spawned or was reused — deleting
      // it on a total failure leaves the team with no recovery path. A failed
      // spawn (scope collision, provider unavailable, etc.) should be retryable
      // once the user fixes the condition.
      if (spawned.length === 0 && reused.length === 0 && failed.length > 0) {
        try { writeFileSync(planPath, planContents); } catch { /* best-effort */ }
      }

      daemon.audit.log('team.launch', {
        phase1: spawned.length, reused: reused.length, phase2Pending: phase2.length, failed: failed.length,
        agents: [...spawned, ...reused].map((a) => a.role), projectDir: projectDir || null, preview: !!previewBlock,
      });
      res.json({ launched: spawned.length, reused: reused.length, phase2Pending: phase2.length, agents: [...spawned, ...reused], failed, projectDir: projectDir || null, preview: previewBlock ? previewBlock.kind : null });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Team Templates ---

  const BUILT_IN_TEMPLATES = {
    'dev-team': {
      name: 'Dev Team', description: 'Frontend + Backend + QC', icon: 'code',
      roles: [{ role: 'frontend' }, { role: 'backend' }, { role: 'fullstack', phase: 2 }],
    },
    'full-stack': {
      name: 'Full Stack', description: 'Frontend, Backend, DevOps, Testing + QC', icon: 'layers',
      roles: [{ role: 'frontend' }, { role: 'backend' }, { role: 'devops' }, { role: 'testing' }, { role: 'fullstack', phase: 2 }],
    },
    'marketing': {
      name: 'Marketing', description: 'CMO, Creative, Analyst', icon: 'megaphone',
      roles: [{ role: 'cmo' }, { role: 'creative' }, { role: 'analyst' }],
    },
    'business': {
      name: 'Business', description: 'CFO, CMO, Analyst', icon: 'briefcase',
      roles: [{ role: 'cfo' }, { role: 'cmo' }, { role: 'analyst' }],
    },
    'security-audit': {
      name: 'Security Audit', description: 'Security, Backend + QC', icon: 'shield',
      roles: [{ role: 'security' }, { role: 'backend' }, { role: 'fullstack', phase: 2 }],
    },
    'docs': {
      name: 'Documentation', description: 'Docs + Frontend', icon: 'file-text',
      roles: [{ role: 'docs' }, { role: 'frontend' }],
    },
  };

  function getCustomTemplatesDir() {
    return resolve(homedir(), '.groove', 'team-templates');
  }

  function loadCustomTemplates() {
    const dir = getCustomTemplatesDir();
    if (!existsSync(dir)) return {};
    const templates = {};
    try {
      for (const file of readdirSync(dir).filter(f => f.endsWith('.json'))) {
        try {
          const data = JSON.parse(readFileSync(resolve(dir, file), 'utf8'));
          const key = file.replace(/\.json$/, '');
          templates[key] = { ...data, custom: true };
        } catch { /* skip malformed */ }
      }
    } catch { /* dir read failed */ }
    return templates;
  }

  app.get('/api/team-templates', (req, res) => {
    const custom = loadCustomTemplates();
    const all = {};
    for (const [k, v] of Object.entries(BUILT_IN_TEMPLATES)) {
      all[k] = { ...v, builtIn: true };
    }
    for (const [k, v] of Object.entries(custom)) {
      all[k] = v;
    }
    res.json(all);
  });

  app.post('/api/team-templates', (req, res) => {
    const { name, description, icon, roles, settings } = req.body || {};
    if (!name || typeof name !== 'string' || name.length > 64) {
      return res.status(400).json({ error: 'name is required (max 64 chars)' });
    }
    if (!Array.isArray(roles) || roles.length === 0) {
      return res.status(400).json({ error: 'roles array is required' });
    }
    const key = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64);
    if (!key) return res.status(400).json({ error: 'Invalid template name' });
    if (BUILT_IN_TEMPLATES[key]) {
      return res.status(409).json({ error: 'Cannot overwrite built-in template' });
    }
    const dir = getCustomTemplatesDir();
    mkdirSync(dir, { recursive: true });
    const template = { name, description: description || '', icon: icon || 'users', roles, settings: settings || {} };
    writeFileSync(resolve(dir, `${key}.json`), JSON.stringify(template, null, 2));
    daemon.audit.log('team-template.save', { key, roles: roles.length });
    res.status(201).json({ key, ...template, custom: true });
  });

  app.delete('/api/team-templates/:name', (req, res) => {
    const key = req.params.name;
    if (BUILT_IN_TEMPLATES[key]) {
      return res.status(403).json({ error: 'Cannot delete built-in template' });
    }
    const file = resolve(getCustomTemplatesDir(), `${key}.json`);
    if (!existsSync(file)) return res.status(404).json({ error: 'Template not found' });
    try {
      unlinkSync(file);
      daemon.audit.log('team-template.delete', { key });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Team Builder Launch ---

  app.post('/api/team-builder/launch', async (req, res) => {
    try {
      const { task, roles, settings, launchMode } = req.body || {};
      if (!Array.isArray(roles) || roles.length === 0) {
        return res.status(400).json({ error: 'roles array is required' });
      }
      const mode = launchMode || 'direct';
      const teamSettings = settings || {};
      const teamProvider = teamSettings.provider || daemon.config?.defaultProvider || undefined;
      const teamModel = teamSettings.model || daemon.config?.defaultModel || undefined;

      const defaultTeamId = req.body.teamId || daemon.teams.getDefault()?.id || null;
      const baseDir = daemon.config?.defaultWorkingDir || daemon.projectDir;

      if (mode === 'plan-first') {
        const rolesList = roles.map(r => r.role || r.name || r).join(', ');
        const providerNote = teamProvider ? ` (provider: ${teamProvider})` : '';
        let plannerPrompt;
        if (task) {
          plannerPrompt = `The user wants these agents: ${rolesList}${providerNote}. Task: ${task}`;
        } else {
          plannerPrompt = '';
        }
        const plannerConfig = validateAgentConfig({
          role: 'planner',
          prompt: plannerPrompt,
          provider: teamProvider,
          model: teamModel,
          workingDir: baseDir,
        });
        plannerConfig.teamId = defaultTeamId;
        plannerConfig.teamBuilderRoles = roles.map(r => ({ role: r.role || r, provider: r.provider || null }));
        const planner = await daemon.processes.spawn(plannerConfig);
        daemon.audit.log('team-builder.plan-first', { plannerId: planner.id, roles: roles.length });
        return res.status(202).json({ mode: 'plan-first', plannerId: planner.id, message: 'Planner spawned — waiting for user instructions' });
      }

      const spawned = [];
      const failed = [];
      const phase1Agents = roles.filter(r => !r.phase || r.phase === 1);
      const phase2Agents = roles.filter(r => r.phase === 2);
      const phase1Ids = [];

      for (const roleDef of phase1Agents) {
        try {
          let prompt = roleDef.prompt || '';
          if (task && mode === 'direct') {
            prompt = task + (prompt ? '\n\n' + prompt : '');
          }

          const agentConfig = validateAgentConfig({
            role: roleDef.role,
            name: roleDef.name || undefined,
            scope: roleDef.scope || [],
            prompt: mode === 'await' ? '' : prompt,
            provider: roleDef.provider || teamProvider,
            model: roleDef.model || teamModel,
            reasoningEffort: roleDef.reasoningEffort ?? teamSettings.reasoningEffort,
            temperature: roleDef.temperature ?? teamSettings.temperature,
            verbosity: roleDef.verbosity ?? teamSettings.verbosity,
            workingDir: baseDir,
          });
          agentConfig.teamId = defaultTeamId;
          const agent = await daemon.processes.spawn(agentConfig);
          spawned.push({ id: agent.id, name: agent.name, role: agent.role });
          phase1Ids.push(agent.id);
        } catch (err) {
          failed.push({ role: roleDef.role, error: err.message });
        }
      }

      if (phase2Agents.length > 0 && phase1Ids.length > 0) {
        daemon._pendingPhase2 = daemon._pendingPhase2 || [];
        daemon._pendingPhase2.push({
          waitFor: phase1Ids,
          agents: phase2Agents.map(r => ({
            role: r.role, scope: r.scope || [], prompt: r.prompt || '',
            provider: r.provider || teamProvider || daemon.config?.defaultProvider || undefined,
            model: r.model || teamModel || daemon.config?.defaultModel || 'auto',
            reasoningEffort: r.reasoningEffort ?? teamSettings.reasoningEffort,
            temperature: r.temperature ?? teamSettings.temperature,
            verbosity: r.verbosity ?? teamSettings.verbosity,
            workingDir: baseDir,
            name: r.name || undefined,
            teamId: defaultTeamId,
          })),
        });
      }

      daemon.audit.log('team-builder.launch', {
        mode, phase1: spawned.length, phase2Pending: phase2Agents.length,
        failed: failed.length, task: task ? task.slice(0, 100) : null,
      });
      res.json({
        mode, launched: spawned.length, phase2Pending: phase2Agents.length,
        agents: spawned, failed,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Preview service — one-click View Site for completed teams
  app.get('/api/preview', (req, res) => {
    res.json({ previews: daemon.preview?.list() || [] });
  });

  app.get('/api/preview/:teamId', (req, res) => {
    const entry = daemon.preview?.get(req.params.teamId);
    if (!entry) return res.status(404).json({ error: 'No preview for this team' });
    res.json(entry);
  });

  app.delete('/api/preview/:teamId', async (req, res) => {
    const killed = await daemon.preview?.kill(req.params.teamId);
    res.json({ stopped: !!killed });
  });

  // Manually (re)launch the preview for a team using the stashed plan.
  app.post('/api/preview/:teamId/launch', async (req, res) => {
    const plan = daemon.preview?.getPlan(req.params.teamId);
    if (!plan) return res.status(404).json({ error: 'No preview plan stashed for this team' });
    const result = await daemon.preview.launch(req.params.teamId, plan.workingDir, plan.preview);
    res.json(result);
  });

  // --- Preview Proxy (same-origin iframe support) ---
  // Forwards HTTP requests to the dev server so the GUI can iframe the preview
  // without cross-origin issues. WebSocket upgrade for HMR is handled in index.js.

  function rewriteAbsoluteUrls(body, proxyBase) {
    let out = body;
    // HTML attributes: src, href, action, poster
    out = out.replace(/((?:src|href|action|poster)\s*=\s*(["']))\/(?!\/|api\/preview\/)/g, `$1${proxyBase}/`);
    // JS imports: from '/' and import('/')
    out = out.replace(/(from\s+(["']))\/(?!\/|api\/preview\/)/g, `$1${proxyBase}/`);
    out = out.replace(/(import\s*\(\s*(["']))\/(?!\/|api\/preview\/)/g, `$1${proxyBase}/`);
    // CSS url()
    out = out.replace(/(url\s*\(\s*(["']?))\/(?!\/|api\/preview\/)/g, `$1${proxyBase}/`);
    return out;
  }

  const REWRITABLE_TYPES = ['text/html', 'application/javascript', 'text/javascript', 'text/css'];

  function handleProxyResponse(proxyRes, res, proxyBase) {
    const fwdHeaders = { ...proxyRes.headers };
    delete fwdHeaders['content-security-policy'];
    delete fwdHeaders['x-frame-options'];

    const ct = (fwdHeaders['content-type'] || '').toLowerCase();
    const shouldRewrite = REWRITABLE_TYPES.some((t) => ct.includes(t));

    if (!shouldRewrite) {
      res.writeHead(proxyRes.statusCode, fwdHeaders);
      proxyRes.pipe(res);
      return;
    }

    const chunks = [];
    proxyRes.on('data', (c) => chunks.push(c));
    proxyRes.on('end', () => {
      let body = Buffer.concat(chunks).toString('utf8');
      body = rewriteAbsoluteUrls(body, proxyBase);
      const buf = Buffer.from(body, 'utf8');
      fwdHeaders['content-length'] = buf.length;
      delete fwdHeaders['transfer-encoding'];
      res.writeHead(proxyRes.statusCode, fwdHeaders);
      res.end(buf);
    });
  }

  app.all('/api/preview/:teamId/proxy/*', (req, res) => {
    const entry = daemon.preview?.get(req.params.teamId);
    if (!entry || !entry.url) return res.status(404).json({ error: 'No active preview for this team' });

    let targetUrl;
    try { targetUrl = new URL(entry.devUrl || entry.url); } catch { return res.status(500).json({ error: 'Invalid preview URL' }); }

    const proxyPath = req.params[0] || '';
    const search = req.url.includes('?') ? '?' + req.url.split('?').slice(1).join('?') : '';
    const fullPath = '/' + proxyPath + search;
    const proxyBase = `/api/preview/${req.params.teamId}/proxy`;

    const headers = { ...req.headers };
    delete headers.host;
    delete headers['accept-encoding'];
    headers.host = targetUrl.host;

    const proxyReq = httpRequest({
      hostname: targetUrl.hostname,
      port: targetUrl.port,
      path: fullPath,
      method: req.method,
      headers,
    }, (proxyRes) => handleProxyResponse(proxyRes, res, proxyBase));

    proxyReq.on('error', (err) => {
      if (!res.headersSent) res.status(502).json({ error: `Proxy error: ${err.message}` });
    });
    req.pipe(proxyReq);
  });

  // Also handle the bare path (no trailing wildcard)
  app.all('/api/preview/:teamId/proxy', (req, res) => {
    const entry = daemon.preview?.get(req.params.teamId);
    if (!entry || !entry.url) return res.status(404).json({ error: 'No active preview for this team' });

    let targetUrl;
    try { targetUrl = new URL(entry.devUrl || entry.url); } catch { return res.status(500).json({ error: 'Invalid preview URL' }); }

    const search = req.url.includes('?') ? '?' + req.url.split('?').slice(1).join('?') : '';
    const proxyBase = `/api/preview/${req.params.teamId}/proxy`;

    const headers = { ...req.headers };
    delete headers.host;
    delete headers['accept-encoding'];
    headers.host = targetUrl.host;

    const proxyReq = httpRequest({
      hostname: targetUrl.hostname,
      port: targetUrl.port,
      path: '/' + search,
      method: req.method,
      headers,
    }, (proxyRes) => handleProxyResponse(proxyRes, res, proxyBase));

    proxyReq.on('error', (err) => {
      if (!res.headersSent) res.status(502).json({ error: `Proxy error: ${err.message}` });
    });
    req.pipe(proxyReq);
  });

  // --- Iteration endpoint (planner routing for live preview feedback) ---
  app.post('/api/preview/:teamId/iterate', async (req, res) => {
    try {
      const { message, screenshot } = req.body;
      if (!message || typeof message !== 'string' || !message.trim()) {
        return res.status(400).json({ error: 'message is required and must be a non-empty string' });
      }

      const teamId = req.params.teamId;
      const agents = daemon.registry.getAll().filter((a) => a.teamId === teamId);
      const planner = agents.find((a) => a.role === 'planner');

      if (!planner) {
        return res.status(400).json({ error: 'No planner found for this team. Iteration routing requires a planner-based team.' });
      }

      const terminal = new Set(['completed', 'crashed', 'stopped', 'killed']);
      const feedbackPrompt = [
        'ITERATION REQUEST: The user is viewing the live preview and wants changes.',
        '',
        `User feedback: ${message.trim()}`,
        '',
        screenshot ? 'The user attached a screenshot highlighting what they want changed.' : '',
        '',
        'Analyze this feedback and route it to the appropriate team agent (frontend, backend, or fullstack) by writing .groove/recommended-team.json. Be specific about what files to change and what the change should be.',
      ].filter(Boolean).join('\n');

      if (terminal.has(planner.status)) {
        const newAgent = await daemon.processes.spawn({
          role: planner.role,
          scope: planner.scope,
          provider: planner.provider,
          model: planner.model,
          prompt: feedbackPrompt,
          permission: planner.permission || 'full',
          workingDir: planner.workingDir,
          name: planner.name,
          teamId: planner.teamId,
        });
        daemon.audit.log('preview.iterate', { teamId, plannerId: newAgent.id, respawned: true });
        return res.json({ status: 'routed', plannerAgent: newAgent.id, message: 'Feedback sent to respawned planner for routing' });
      }

      if (daemon.processes.hasAgentLoop(planner.id)) {
        await daemon.processes.sendMessage(planner.id, feedbackPrompt);
      } else if (daemon.processes.isRunning(planner.id)) {
        daemon.processes.queueMessage(planner.id, feedbackPrompt);
      } else {
        return res.status(400).json({ error: 'Planner exists but is not reachable. Try again.' });
      }

      daemon.audit.log('preview.iterate', { teamId, plannerId: planner.id, respawned: false });
      res.json({ status: 'routed', plannerAgent: planner.id, message: 'Feedback sent to planner for routing' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Screenshot storage for preview iteration ---
  app.post('/api/preview/:teamId/screenshot', (req, res) => {
    try {
      const { image, filename } = req.body;
      if (!image || typeof image !== 'string') {
        return res.status(400).json({ error: 'image (base64 string) is required' });
      }

      const teamId = req.params.teamId;
      const agents = daemon.registry.getAll().filter((a) => a.teamId === teamId);
      const teamAgent = agents[0];
      if (!teamAgent) return res.status(404).json({ error: 'No agents found for this team' });

      const workDir = teamAgent.workingDir || daemon.projectDir;
      const screenshotDir = resolve(workDir, '.groove', 'screenshots');
      mkdirSync(screenshotDir, { recursive: true });

      const ts = Date.now();
      const safeName = (filename || 'screenshot').replace(/[^a-zA-Z0-9._-]/g, '_');
      const fname = `${ts}-${safeName}.png`;
      const filePath = resolve(screenshotDir, fname);

      const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
      writeFileSync(filePath, Buffer.from(base64Data, 'base64'));

      const relativePath = `.groove/screenshots/${fname}`;
      daemon.audit.log('preview.screenshot', { teamId, path: relativePath });
      res.json({
        path: relativePath,
        url: `/api/preview/${teamId}/screenshots/${fname}`,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/preview/:teamId/screenshots/:filename', (req, res) => {
    const teamId = req.params.teamId;
    const fname = req.params.filename;
    if (!fname || fname.includes('..') || fname.includes('/') || fname.includes('\\')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }

    const agents = daemon.registry.getAll().filter((a) => a.teamId === teamId);
    const teamAgent = agents[0];
    if (!teamAgent) return res.status(404).json({ error: 'No agents found for this team' });

    const workDir = teamAgent.workingDir || daemon.projectDir;
    const filePath = resolve(workDir, '.groove', 'screenshots', fname);
    if (!existsSync(filePath)) return res.status(404).json({ error: 'Screenshot not found' });

    res.setHeader('Content-Type', 'image/png');
    createReadStream(filePath).pipe(res);
  });

  // Clean up stale artifacts. Scope to a single team when teamId is provided —
  // wiping every agent's working dir on a global cleanup would delete other
  // in-flight teams' unlaunched plans. When called with no teamId, only the
  // daemon-root plan file is touched (safe baseline).
  app.post('/api/cleanup', (req, res) => {
    const teamId = req.body?.teamId || req.query?.teamId || null;
    let cleaned = 0;
    const locations = [resolve(daemon.grooveDir, 'recommended-team.json')];

    if (teamId) {
      // Only agents in this team get their workspace scanned
      for (const agent of daemon.registry.getAll()) {
        if (agent.teamId === teamId && agent.workingDir) {
          locations.push(resolve(agent.workingDir, '.groove', 'recommended-team.json'));
        }
      }
    }

    for (const p of locations) {
      if (existsSync(p)) { try { unlinkSync(p); cleaned++; } catch { /* */ } }
    }
    daemon.audit.log('cleanup', { cleaned, teamId });
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
      const rawPct = estimated > 0 ? (tokenSummary.savings.total / estimated) * 100 : 0;
      tokenSummary.savings.percentage = rawPct > 0 && rawPct < 1
        ? Math.round(rawPct * 10) / 10 : Math.round(rawPct);
    }
    const rotationStats = daemon.rotator.getStats();
    const rotationHistory = daemon.rotator.getHistory();
    const routingStatus = daemon.router.getStatus();
    const journalistStatus = daemon.journalist.getStatus();

    // Aggregate routing cost log by tier (count + tokens, no fake cost estimates)
    const routingByTier = { light: 0, medium: 0, heavy: 0 };
    const tokensByTier = { light: 0, medium: 0, heavy: 0 };
    let autoRoutedCount = 0;
    for (const [, mode] of Object.entries(routingStatus.agentModes || {})) {
      if (mode.mode === 'auto') autoRoutedCount++;
    }
    for (const entry of daemon.router.costLog || []) {
      if (routingByTier[entry.tier] !== undefined) routingByTier[entry.tier]++;
      if (entry.tokens && entry.tier && tokensByTier[entry.tier] !== undefined) {
        tokensByTier[entry.tier] += entry.tokens;
      }
    }

    // Per-agent enriched data with quality signals
    const agentBreakdown = agents.map((a) => {
      const tokenData = daemon.tokens.getAgent(a.id);
      // Cache rate denominator: reads + creation (cacheable), excludes fresh inputTokens
      const agentCacheable = (tokenData.cacheReadTokens || 0) + (tokenData.cacheCreationTokens || 0);

      let quality = null;
      try {
        const events = daemon.classifier.agentWindows[a.id] || [];
        const signals = events.length >= 6 ? daemon.adaptive.extractSignals(events, a.scope) : null;
        const score = signals ? daemon.adaptive.scoreSession(signals) : null;
        const classification = daemon.classifier.classify(a.id);
        const history = daemon.rotator.scoreHistory[a.id] || [];
        quality = {
          score,
          scoreHistory: history,
          errorCount: signals?.errorCount || 0,
          toolCalls: signals?.toolCalls || 0,
          toolFailures: signals?.toolFailures || 0,
          toolSuccessRate: signals?.toolCalls > 0 ? 1 - (signals.toolFailures / signals.toolCalls) : 1,
          filesWritten: signals?.filesWritten || 0,
          fileChurn: signals?.fileChurn || 0,
          repetitions: signals?.repetitions || 0,
          errorTrend: signals?.errorTrend || 0,
          tier: classification?.tier || classification || 'medium',
          eventCount: events.length,
        };
      } catch { /* classifier/adaptive may not have data yet */ }

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
        cacheHitRate: agentCacheable > 0 ? Math.round(((tokenData.cacheReadTokens || 0) / agentCacheable) * 1000) / 1000 : 0,
        contextUsage: a.contextUsage || 0,
        rotationThreshold: daemon.adaptive.getThreshold(a.provider, a.role),
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
        tokensByTier,
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
        projectMap: lastSynthesis?.projectMap || '',
        decisions: lastSynthesis?.decisions || '',
        recentHistory: journalistHistory,
      },
      timeline: timelineData,
      activeTeam: daemon.teams?.getActiveTeam?.() || null,
      uptime: process.uptime(),
    });
  });

  // --- Federation ---

  // Federation status (v1 — includes whitelist, connections, ambassadors)
  app.get('/api/federation', (req, res) => {
    res.json(daemon.federation.getStatus());
  });

  app.get('/api/federation/test', async (req, res) => {
    const target = req.query.target;
    if (!target) return res.status(400).json({ error: 'target required' });
    let host;
    try {
      const parsed = new URL(`http://${target}`);
      host = parsed.hostname.replace(/^\[|]$/g, '');
    } catch {
      return res.status(400).json({ error: 'Invalid target' });
    }
    const privatePatterns = [
      /^127\./, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./,
      /^0\./, /^169\.254\./, /^localhost$/i, /^::1$/,
      /^0\.0\.0\.0$/, /^fc/i, /^fd/i, /^fe80/i,
    ];
    if (privatePatterns.some(p => p.test(host))) {
      return res.status(400).json({ error: 'Private/local addresses are not allowed' });
    }
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const resp = await fetch(`http://${target}/api/health`, { signal: controller.signal });
      clearTimeout(timeout);
      if (resp.ok) {
        const data = await resp.json();
        return res.json({ reachable: true, version: data.version, peerId: data.daemonId, agents: data.agents });
      }
      res.json({ reachable: false });
    } catch {
      res.json({ reachable: false });
    }
  });

  // List peers
  app.get('/api/federation/peers', (req, res) => {
    res.json(daemon.federation.getPeers());
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

  // Initiate pairing with a remote daemon
  app.post('/api/federation/initiate', async (req, res) => {
    try {
      const { remoteUrl } = req.body;
      if (!remoteUrl || typeof remoteUrl !== 'string') {
        return res.status(400).json({ error: 'remoteUrl is required (string)' });
      }
      const result = await daemon.federation.initiatePairing(remoteUrl);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // --- Federation v1: Whitelist ---

  app.get('/api/federation/whitelist', (req, res) => {
    res.json(daemon.federation.whitelist?.list() || []);
  });

  app.post('/api/federation/whitelist', (req, res) => {
    try {
      const { ip, port, name } = req.body;
      if (!ip || typeof ip !== 'string') {
        return res.status(400).json({ error: 'ip is required (string)' });
      }
      const entry = daemon.federation.whitelist.add(ip, port, name);
      daemon.broadcast({ type: 'federation:whitelist', data: daemon.federation.whitelist.list() });
      res.json(entry);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete('/api/federation/whitelist/:ip', (req, res) => {
    try {
      daemon.federation.whitelist.remove(req.params.ip);
      daemon.broadcast({ type: 'federation:whitelist', data: daemon.federation.whitelist.list() });
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Probe endpoint — remote daemons hit this to check if they are whitelisted
  app.get('/api/federation/whitelist-check', (req, res) => {
    const ip = req.ip?.replace('::ffff:', '') || req.socket?.remoteAddress?.replace('::ffff:', '') || '';
    const whitelisted = daemon.federation.isWhitelisted(ip);
    res.json({
      whitelisted,
      ...(whitelisted ? { daemonId: daemon.federation._daemonId() } : {}),
    });
  });

  // --- Federation v1: Knock ---

  app.post('/api/federation/knock', (req, res) => {
    try {
      const callerIp = req.ip?.replace('::ffff:', '') || req.socket?.remoteAddress?.replace('::ffff:', '') || '';
      const { senderId, publicKey, payload, signature } = req.body;
      if (!senderId || !publicKey || !payload || !signature) {
        return res.status(400).json({ error: 'senderId, publicKey, payload, and signature are required' });
      }
      const result = daemon.federation.handleKnock(senderId, publicKey, payload, signature, callerIp);
      res.json(result);
    } catch (err) {
      res.status(403).json({ error: err.message });
    }
  });

  // --- Federation v1: Connections ---

  app.get('/api/federation/connections', (req, res) => {
    res.json(daemon.federation.connections?.getStatus() || []);
  });

  // --- Federation v1: Diplomatic Pouch ---

  app.post('/api/federation/pouch', (req, res) => {
    try {
      const callerIp = req.ip?.replace('::ffff:', '') || req.socket?.remoteAddress?.replace('::ffff:', '') || '';
      if (!callerIp || !daemon.federation.isWhitelisted(callerIp)) {
        return res.status(403).json({ error: 'Caller IP not whitelisted' });
      }
      const { senderId, payload, signature } = req.body;
      if (!senderId || !payload || !signature) {
        return res.status(400).json({ error: 'senderId, payload, and signature are required' });
      }
      const result = daemon.federation.ambassadors.receivePouch(senderId, payload, signature);
      res.json(result);
    } catch (err) {
      res.status(403).json({ error: err.message });
    }
  });

  app.get('/api/federation/pouch/log', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    res.json(daemon.federation.ambassadors?.getPouchLog(limit) || []);
  });

  // Send a pouch message to a peer (local agents/GUI call this)
  app.post('/api/federation/pouch/send', async (req, res) => {
    try {
      const { peerId, contract } = req.body;
      if (!peerId || !contract) {
        return res.status(400).json({ error: 'peerId and contract are required' });
      }
      const result = await daemon.federation.ambassadors.sendPouch(peerId, contract);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Accept incoming pairing request from a remote daemon
  app.post('/api/federation/pair', (req, res) => {
    try {
      const callerIp = req.ip?.replace('::ffff:', '') || req.socket?.remoteAddress?.replace('::ffff:', '') || '';
      const { id, name, port, publicKey } = req.body;
      if (!id || !publicKey) {
        return res.status(400).json({ error: 'id and publicKey are required' });
      }
      const result = daemon.federation.acceptPairing({ id, name, port, publicKey }, callerIp);
      res.json(result);
    } catch (err) {
      res.status(403).json({ error: err.message });
    }
  });

  // Legacy contract endpoints (kept for backward compat)
  app.post('/api/federation/contract', (req, res) => {
    try {
      const callerIp = req.ip?.replace('::ffff:', '') || req.socket?.remoteAddress?.replace('::ffff:', '') || '';
      if (!callerIp || !daemon.federation.isWhitelisted(callerIp)) {
        return res.status(403).json({ error: 'Caller IP not whitelisted' });
      }
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

  // --- Repo Import ---

  app.post('/api/repos/preview', async (req, res) => {
    try {
      const { repoUrl } = req.body;
      if (!repoUrl || typeof repoUrl !== 'string') {
        return res.status(400).json({ error: 'repoUrl is required (string)' });
      }
      const result = await daemon.repoImporter.preview(repoUrl);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/repos/import', async (req, res) => {
    try {
      const { repoUrl, targetPath, createTeam, teamName } = req.body;
      if (!repoUrl || typeof repoUrl !== 'string') {
        return res.status(400).json({ error: 'repoUrl is required (string)' });
      }
      if (!targetPath || typeof targetPath !== 'string') {
        return res.status(400).json({ error: 'targetPath is required (string)' });
      }

      // Resolve shell shortcuts — GUI sends ~/... and ./...
      let resolvedPath = targetPath;
      if (resolvedPath.startsWith('~/') || resolvedPath === '~') {
        resolvedPath = resolve(homedir(), resolvedPath.slice(2));
      } else if (!resolvedPath.startsWith('/')) {
        resolvedPath = resolve(daemon.projectDir, resolvedPath);
      }

      const result = await daemon.repoImporter.import(repoUrl, resolvedPath, {});

      let teamId = null;
      if (createTeam) {
        try {
          const team = daemon.teams.create(teamName || result.stackInfo?.name || 'imported-repo');
          teamId = team.id;
          const manifest = daemon.repoImporter.getImport(result.importId);
          if (manifest) {
            manifest.teamId = teamId;
            daemon.repoImporter._saveManifest(manifest);
          }
        } catch { /* team creation is optional */ }
      }

      // Spawn setup agent
      let agentId = null;
      try {
        const setupPrompt = daemon.repoImporter.generateSetupPrompt(resolvedPath, result.stackInfo, '');
        const agent = await daemon.processes.spawn({
          role: 'fullstack',
          name: `setup-${result.importId.slice(0, 4)}`,
          workingDir: resolvedPath,
          prompt: setupPrompt,
          provider: daemon.config?.defaultProvider || 'claude-code',
        });
        agentId = agent.id;
        const manifest = daemon.repoImporter.getImport(result.importId);
        if (manifest) {
          manifest.agents.push(agentId);
          daemon.repoImporter._saveManifest(manifest);
        }
      } catch { /* agent spawn is best-effort */ }

      res.json({ importId: result.importId, path: result.path, agentId, teamId });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/api/repos/imported', (req, res) => {
    res.json(daemon.repoImporter.getImported());
  });

  app.get('/api/repos/:id', (req, res) => {
    const manifest = daemon.repoImporter.getImport(req.params.id);
    if (!manifest) return res.status(404).json({ error: 'Import not found' });
    res.json(manifest);
  });

  app.get('/api/repos/:id/sandbox', (req, res) => {
    const manifest = daemon.repoImporter.getImport(req.params.id);
    if (!manifest) return res.status(404).json({ error: 'Import not found' });
    res.json(manifest);
  });

  app.post('/api/repos/:id/process', (req, res) => {
    try {
      const { pid, command } = req.body;
      daemon.repoImporter.recordProcess(req.params.id, pid, command);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete('/api/repos/:id/remove', async (req, res) => {
    try {
      await daemon.repoImporter.softRemove(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete('/api/repos/:id/nuke', async (req, res) => {
    try {
      const deleteFiles = req.query.deleteFiles !== 'false';
      await daemon.repoImporter.hardNuke(req.params.id, { deleteFiles });
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // --- Personalities ---

  app.get('/api/personalities', (req, res) => {
    const dir = resolve(daemon.grooveDir, 'personalities');
    mkdirSync(dir, { recursive: true });
    try {
      const files = readdirSync(dir).filter(f => f.endsWith('.md'));
      const personalities = files.map(f => ({
        name: f.replace(/\.md$/, ''),
      }));
      res.json({ personalities });
    } catch {
      res.json({ personalities: [] });
    }
  });

  app.get('/api/personalities/:name', (req, res) => {
    const name = req.params.name.replace(/[^a-zA-Z0-9_-]/g, '');
    if (!name) return res.status(400).json({ error: 'Invalid name' });
    const file = resolve(daemon.grooveDir, 'personalities', `${name}.md`);
    if (!existsSync(file)) return res.status(404).json({ error: 'Personality not found' });
    res.json({ name, content: readFileSync(file, 'utf8') });
  });

  app.put('/api/personalities/:name', (req, res) => {
    const name = req.params.name.replace(/[^a-zA-Z0-9_-]/g, '');
    if (!name) return res.status(400).json({ error: 'Invalid name' });
    const content = typeof req.body?.content === 'string' ? req.body.content.slice(0, 10000) : '';
    const dir = resolve(daemon.grooveDir, 'personalities');
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, `${name}.md`), content, { mode: 0o600 });
    daemon.audit.log('personality.update', { name });
    res.json({ name, content });
  });

  app.post('/api/personalities/:name/clone', (req, res) => {
    const source = req.params.name.replace(/[^a-zA-Z0-9_-]/g, '');
    const target = (req.body?.name || '').replace(/[^a-zA-Z0-9_-]/g, '');
    if (!source || !target) return res.status(400).json({ error: 'Source and target name required' });
    const dir = resolve(daemon.grooveDir, 'personalities');
    const sourceFile = resolve(dir, `${source}.md`);
    if (!existsSync(sourceFile)) return res.status(404).json({ error: 'Source personality not found' });
    copyFileSync(sourceFile, resolve(dir, `${target}.md`));
    daemon.audit.log('personality.clone', { source, target });
    res.json({ name: target, clonedFrom: source });
  });

  // --- Tunnels (Remote Access) ---

  app.get('/api/tunnels', (req, res) => {
    res.json(daemon.tunnelManager.getSaved());
  });

  app.post('/api/tunnels', (req, res) => {
    try {
      const { name, host, user, port, sshKeyPath, autoStart, autoConnect, projectDir } = req.body;
      if (!name || typeof name !== 'string') return res.status(400).json({ error: 'name is required (string)' });
      if (!host || typeof host !== 'string') return res.status(400).json({ error: 'host is required (string)' });
      const result = daemon.tunnelManager.save({ name, host, user, port, sshKeyPath, autoStart, autoConnect, projectDir });
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.patch('/api/tunnels/:id', (req, res) => {
    try {
      const result = daemon.tunnelManager.update(req.params.id, req.body);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete('/api/tunnels/:id', async (req, res) => {
    try {
      await daemon.tunnelManager.delete(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/tunnels/:id/test', async (req, res) => {
    try {
      const result = await daemon.tunnelManager.test(req.params.id);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/tunnels/:id/connect', async (req, res) => {
    try {
      const opts = {};
      if (req.body?.skipTest && req.body?.testResult) {
        opts.skipTest = true;
        opts.testResult = req.body.testResult;
      }
      const result = await daemon.tunnelManager.connect(req.params.id, opts);
      res.json(result);
    } catch (err) {
      const body = { error: err.message };
      if (err.testResult) body.testResult = err.testResult;
      res.status(400).json(body);
    }
  });

  app.post('/api/tunnels/:id/disconnect', async (req, res) => {
    try {
      await daemon.tunnelManager.disconnect(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/tunnels/:id/install', async (req, res) => {
    try {
      const result = await daemon.tunnelManager.remoteInstall(req.params.id);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/tunnels/:id/start', async (req, res) => {
    try {
      await daemon.tunnelManager.autoStart(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/tunnels/:id/upgrade', async (req, res) => {
    try {
      const result = await daemon.tunnelManager.forceUpgrade(req.params.id);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/tunnels/:id/status', (req, res) => {
    const s = daemon.tunnelManager.getStatus(req.params.id);
    if (!s) return res.status(404).json({ error: 'Remote not found' });
    res.json(s);
  });

  // --- Onboarding (Electron wizard) ---

  const INSTALLABLE_PROVIDERS = {
    'claude-code': '@anthropic-ai/claude-code',
    'codex': '@openai/codex',
    'gemini': '@google/gemini-cli',
  };

  app.get('/api/onboarding/status', (req, res) => {
    const providers = listProviders();
    const enriched = providers.map((p) => {
      const hasKey = daemon.credentials.hasKey(p.id);
      let authStatus = 'not-configured';
      if (p.authType === 'subscription') {
        if (!p.installed) {
          authStatus = 'not-configured';
        } else {
          const provObj = getProvider(p.id);
          const authResult = provObj?.constructor?.isAuthenticated?.();
          authStatus = authResult?.authenticated ? 'authenticated' : 'not-configured';
        }
      } else if (p.authType === 'api-key') {
        authStatus = hasKey ? 'key-set' : 'not-configured';
        if (p.authStatus?.authenticated) authStatus = 'authenticated';
      } else if (p.authType === 'local') {
        authStatus = p.installed ? 'authenticated' : 'not-configured';
      }
      return {
        id: p.id,
        displayName: p.name,
        installed: p.installed,
        authType: p.authType,
        authStatus,
        hasKey,
        models: p.models,
        installCommand: p.installCommand,
        installable: !!INSTALLABLE_PROVIDERS[p.id],
      };
    });

    const dismissed = !!(daemon.config.onboardingDismissed);
    const hasReadyProvider = enriched.some((p) =>
      p.installed && (p.authStatus === 'authenticated' || p.authStatus === 'key-set'),
    );

    res.json({
      complete: dismissed || hasReadyProvider,
      dismissed,
      providers: enriched,
      defaultProvider: daemon.config.defaultProvider || 'claude-code',
      defaultModel: daemon.config.defaultModel || null,
    });
  });

  app.post('/api/onboarding/dismiss', async (req, res) => {
    daemon.config.onboardingDismissed = true;
    const { saveConfig } = await import('./firstrun.js');
    saveConfig(daemon.grooveDir, daemon.config);
    daemon.audit.log('onboarding.dismiss', {});
    daemon.broadcast({ type: 'onboarding:dismissed' });
    res.json({ ok: true });
  });

  app.post('/api/onboarding/install-provider', (req, res) => {
    const { provider } = req.body;
    if (!provider || typeof provider !== 'string') {
      return res.status(400).json({ error: 'provider is required' });
    }
    const pkg = INSTALLABLE_PROVIDERS[provider];
    if (!pkg) {
      return res.status(400).json({ error: `Provider '${provider}' is not installable via npm. Valid: ${Object.keys(INSTALLABLE_PROVIDERS).join(', ')}` });
    }

    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('Cache-Control', 'no-cache');

    const write = (obj) => {
      try { res.write(JSON.stringify(obj) + '\n'); } catch { /* client disconnected */ }
    };

    write({ status: 'installing', output: `Installing ${pkg}...`, progress: 0 });

    const proc = spawn('bash', ['-lc', `npm install -g ${pkg}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: undefined },
    });

    let output = '';
    let errOutput = '';

    proc.stdout.on('data', (data) => {
      output += data.toString();
      write({ status: 'installing', output: data.toString().trim(), progress: 50 });
    });

    proc.stderr.on('data', (data) => {
      errOutput += data.toString();
      const line = data.toString().trim();
      if (line) write({ status: 'installing', output: line, progress: 50 });
    });

    proc.on('close', (code) => {
      const providerObj = getProvider(provider);
      const installed = providerObj ? providerObj.constructor.isInstalled() : false;

      if (code === 0 && installed) {
        clearInstallCache();
        write({ status: 'complete', output: `${pkg} installed successfully`, progress: 100, installed: true });
        daemon.audit.log('onboarding.installProvider', { provider, pkg, success: true });
        daemon.broadcast({ type: 'onboarding:provider-installed', provider });
        daemon.broadcast({ type: 'provider:status-changed', provider });
      } else {
        const reason = code !== 0
          ? (errOutput || output).slice(-500)
          : 'Install succeeded but provider binary not found in PATH';
        write({ status: 'error', output: reason, progress: 100, installed: false });
        daemon.audit.log('onboarding.installProvider', { provider, pkg, success: false, code });
      }
      res.end();
    });

    proc.on('error', (err) => {
      write({ status: 'error', output: `Failed to start npm: ${err.message}`, progress: 100, installed: false });
      res.end();
    });

    req.on('close', () => {
      try { proc.kill(); } catch { /* already exited */ }
    });
  });

  app.post('/api/onboarding/set-default', async (req, res) => {
    const { provider, model } = req.body;
    const validProviders = ['claude-code', 'codex', 'gemini', 'ollama'];
    if (!provider || !validProviders.includes(provider)) {
      return res.status(400).json({ error: `Invalid provider. Valid: ${validProviders.join(', ')}` });
    }

    daemon.config.defaultProvider = provider;
    daemon.config.defaultChatProvider = provider;
    if (model && typeof model === 'string' && model.length <= 100) {
      daemon.config.defaultModel = model.trim();
      daemon.config.defaultChatModel = model.trim();
    }
    const { saveConfig } = await import('./firstrun.js');
    saveConfig(daemon.grooveDir, daemon.config);
    daemon.audit.log('onboarding.setDefault', { provider, model: model || null });
    daemon.broadcast({ type: 'onboarding:default-changed', provider, model });
    res.json({ ok: true });
  });

  // --- Training Data ---

  app.get('/api/training/status', (req, res) => {
    let userId = null;
    let optedIn = false;
    try {
      userId = ConsentManager.getOrCreateUserId();
      optedIn = ConsentManager.isCaptureEnabled();
    } catch (e) { /* */ }
    res.json({
      optedIn,
      userId: userId ? userId.substring(0, 8) + '...' : null,
      captureActive: !!daemon.trajectoryCapture,
      sessionsCaptured: daemon.state.get('training_sessions_captured') || 0,
      envelopesSent: daemon.state.get('training_envelopes_sent') || 0,
    });
  });

  app.post('/api/training/opt-in', async (req, res) => {
    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled must be boolean' });

    try {
      const userId = ConsentManager.getOrCreateUserId();
      const consent = new ConsentManager();
      if (enabled) {
        consent.recordConsent(userId, true, '1.0');
        await daemon._initTrajectoryCapture();
        daemon.state.set('training_enrolled_at', new Date().toISOString());
      } else {
        consent.revokeConsent(userId);
        if (daemon.trajectoryCapture) {
          try { await daemon.trajectoryCapture.shutdown(); } catch (e) { /* */ }
          daemon.trajectoryCapture = null;
        }
      }
    } catch (e) {
      console.error('[training/opt-in] Failed to update data sharing:', e);
      return res.status(500).json({ error: 'Failed to update data sharing', detail: e.message });
    }

    daemon.broadcast({ type: 'training:status', data: { optedIn: enabled, captureActive: !!daemon.trajectoryCapture } });
    if (daemon.audit) daemon.audit.log('training.consent', { opt_in: enabled });
    res.json({ ok: true, optedIn: enabled });
  });

  app.post('/api/training/opt-in/delete', async (req, res) => {
    try {
      const userId = ConsentManager.getOrCreateUserId();
      const consent = new ConsentManager();
      consent.revokeConsent(userId);
      if (daemon.trajectoryCapture) {
        try { await daemon.trajectoryCapture.shutdown(); } catch (e) { /* */ }
        daemon.trajectoryCapture = null;
      }
      daemon.broadcast({ type: 'training:status', data: { optedIn: false, captureActive: false } });
      if (daemon.audit) daemon.audit.log('training.delete', {});
      res.json({ ok: true, deleted: true });
    } catch (e) {
      res.status(500).json({ error: 'Failed to delete data' });
    }
  });

  // --- Config ---

  app.get('/api/config', (req, res) => {
    const cfg = daemon.config || {};
    const sanitized = { ...cfg };
    if (sanitized.networkBeta) {
      sanitized.networkBeta = { ...sanitized.networkBeta };
      delete sanitized.networkBeta.code;
    }
    res.json(sanitized);
  });

  app.patch('/api/config', async (req, res) => {
    const ALLOWED_KEYS = [
      'port', 'journalistInterval', 'rotationThreshold', 'autoRotation',
      'qcThreshold', 'maxAgents', 'defaultProvider', 'defaultWorkingDir',
      'onboardingDismissed', 'defaultModel', 'defaultChatProvider', 'defaultChatModel',
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

  // --- Toys ---

  app.get('/api/toys', (req, res) => {
    const category = req.query.category;
    if (category && (typeof category !== 'string' || category.length > 30)) {
      return res.status(400).json({ error: 'Invalid category' });
    }
    res.json(daemon.toys.list(category || undefined));
  });

  app.get('/api/toys/:id', (req, res) => {
    const toy = daemon.toys.get(req.params.id);
    if (!toy) return res.status(404).json({ error: 'Toy not found' });
    res.json(toy);
  });

  app.post('/api/toys/:id/launch', async (req, res) => {
    try {
      const { apiKey, starterPrompt } = req.body || {};
      const result = await daemon.toys.launch(req.params.id, { apiKey, starterPrompt });
      daemon.audit.log('toy.launch', { toyId: req.params.id, teamId: result.team.id });
      res.status(201).json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // --- Groove Network (Beta) ---

  // Offline fallback allowlist — SHA-256 hashes of valid codes so plaintext
  // codes aren't exposed in source. Used only when groovedev.ai is unreachable.
  const BETA_CODES_FALLBACK_HASHES = new Set([
    '2dd41c615fd155f322e8381fed28f346ed6592e2bbab1c068f156fa225c02110',
    '034d771385b608bb85d8f0225c561fe3c084b8ce7851221b01f9c2226dfe3e7b',
    'fad2c7b09f9161db518d8c9a8d338831eb3894ef0f36e2c7cb1884cffbb05768',
    '0ff4c9c1d224e59ac370d6f4bf315ae2ec750af014758c8206f38980cb7603ba',
    '08b2ffe7f40afe2894db335860d67af877fa31201b3e2c25736480eb3f7c58ef',
  ]);

  function hashCode(code) {
    return createHash('sha256').update(code).digest('hex');
  }

  const BETA_VALIDATE_URL = 'https://groovedev.ai/api/beta/validate';

  const betaAttempts = [];
  const BETA_RATE_LIMIT = 5;
  const BETA_RATE_WINDOW_MS = 60_000;

  function getMachineId() {
    const idFile = join(daemon.grooveDir, '.machine-id');
    try {
      const existing = readFileSync(idFile, 'utf8').trim();
      if (existing.length >= 32) return existing;
    } catch {}
    const id = createHash('sha256').update(`${hostname()}|${randomUUID()}`).digest('hex');
    try { writeFileSync(idFile, id, { mode: 0o600 }); } catch {}
    return id;
  }

  async function validateCodeWithServer(code) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(BETA_VALIDATE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, machineId: getMachineId() }),
        signal: controller.signal,
      });
      if (!response.ok && response.status !== 200) {
        return { ok: false, reason: 'http', status: response.status };
      }
      const body = await response.json();
      return { ok: true, result: body };
    } catch (err) {
      return { ok: false, reason: 'network', error: err.message };
    } finally {
      clearTimeout(timeout);
    }
  }

  function isNetworkUnlocked() {
    return !!(daemon.config?.networkBeta?.unlocked);
  }

  function networkGate(req, res, next) {
    // Return 404 (not 403) so the feature is invisible until unlocked.
    if (!isNetworkUnlocked()) return res.status(404).json({ error: 'Not found' });
    next();
  }

  async function persistConfig() {
    const { saveConfig } = await import('./firstrun.js');
    saveConfig(daemon.grooveDir, daemon.config);
  }

  app.get('/api/beta/status', (req, res) => {
    res.json({ unlocked: isNetworkUnlocked() });
  });

  app.post('/api/beta/activate', async (req, res) => {
    const now = Date.now();
    while (betaAttempts.length && betaAttempts[0] < now - BETA_RATE_WINDOW_MS) betaAttempts.shift();
    if (betaAttempts.length >= BETA_RATE_LIMIT) {
      return res.status(429).json({ error: 'Too many attempts. Try again in a minute.' });
    }
    betaAttempts.push(now);

    const { code } = req.body || {};
    if (typeof code !== 'string' || code.length > 64 || !/^[A-Z0-9-]+$/.test(code)) {
      return res.status(400).json({ error: 'Invalid code format' });
    }

    const remote = await validateCodeWithServer(code);

    let valid = false;
    let message = 'Invalid invite code';
    let expiresAt = null;
    let features = [];
    let source = 'server';

    if (remote.ok && remote.result && typeof remote.result === 'object') {
      valid = remote.result.valid === true;
      if (typeof remote.result.message === 'string') message = remote.result.message;
      if (typeof remote.result.expiresAt === 'string' || remote.result.expiresAt === null) {
        expiresAt = remote.result.expiresAt || null;
      }
      if (Array.isArray(remote.result.features)) features = remote.result.features;
    } else {
      // Offline fallback — only trust the hashed list when we can't reach the server
      source = 'fallback';
      if (BETA_CODES_FALLBACK_HASHES.has(hashCode(code))) {
        valid = true;
        message = 'Activated (offline)';
        features = ['network-node', 'network-consumer'];
      } else {
        message = 'Invalid invite code';
      }
    }

    if (!valid) {
      daemon.audit.log('beta.activate.denied', { codePrefix: code.slice(0, 10), source });
      return res.status(200).json({ unlocked: false, message });
    }

    daemon.config.networkBeta = {
      ...(daemon.config.networkBeta || {}),
      unlocked: true,
      code,
      expiresAt,
      features,
    };
    await persistConfig();
    daemon.audit.log('beta.activate', { codePrefix: code.slice(0, 10), source, features });
    daemon.broadcast({ type: 'config:updated' });
    res.json({ unlocked: true, message, expiresAt, features });
  });

  // Re-validate stored code against groovedev.ai. Called at daemon startup
  // so revoked or expired codes lock the feature automatically. Non-blocking.
  daemon.revalidateBetaCode = async function revalidateBetaCode() {
    const cfg = daemon.config?.networkBeta;
    if (!cfg?.unlocked) return;
    if (!cfg?.code) {
      daemon.config.networkBeta = { ...cfg, unlocked: false, expiresAt: null, features: [] };
      await persistConfig();
      daemon.audit.log('beta.revoked', { reason: 'missing code' });
      daemon.broadcast({ type: 'config:updated' });
      return;
    }
    const remote = await validateCodeWithServer(cfg.code);
    // If we couldn't reach the server, keep the current unlocked state —
    // network failures must not lock out beta users.
    if (!remote.ok || !remote.result || typeof remote.result !== 'object') return;
    if (remote.result.valid === true) {
      // Refresh features/expiresAt from server in case they changed
      const next = {
        ...cfg,
        expiresAt: typeof remote.result.expiresAt === 'string' ? remote.result.expiresAt : null,
        features: Array.isArray(remote.result.features) ? remote.result.features : (cfg.features || []),
      };
      if (JSON.stringify(next) !== JSON.stringify(cfg)) {
        daemon.config.networkBeta = next;
        await persistConfig();
        daemon.broadcast({ type: 'config:updated' });
      }
      return;
    }
    // Server says invalid — revoke
    daemon.config.networkBeta = {
      ...cfg,
      unlocked: false,
      code: null,
      expiresAt: null,
      features: [],
    };
    await persistConfig();
    daemon.audit.log('beta.revoked', { reason: remote.result.message || 'server denied' });
    daemon.broadcast({ type: 'config:updated' });
  };

  app.post('/api/beta/deactivate', async (req, res) => {
    // Stop the node if it's running before locking the feature away.
    if (daemon.networkNode?.proc && !daemon.networkNode.proc.killed) {
      safeKill(daemon.networkNode.proc);
    }
    daemon.networkNode = {
      active: false, status: 'stopped', pid: null, proc: null,
      nodeId: null, layers: null, model: null, sessions: 0,
      hardware: null, startedAt: null, events: [],
    };
    daemon.config.networkBeta = {
      ...(daemon.config.networkBeta || {}),
      unlocked: false,
      code: null,
    };
    await persistConfig();
    daemon.audit.log('beta.deactivate', {});
    daemon.broadcast({ type: 'config:updated' });
    res.json({ unlocked: false });
  });

  // Network node lifecycle (gated)

  let _localHwCache = null;
  function getLocalHardware() {
    if (!_localHwCache) {
      const sys = OllamaProvider.getSystemHardware();
      const vramGb = sys.gpu?.vram || 0;
      const ramGb = sys.totalRamGb || 0;
      const vramMb = vramGb * 1024;
      const ramMb = ramGb * 1024;
      const fmtGb = (gb) => gb > 0 ? `${gb} GB` : null;
      _localHwCache = {
        device: sys.gpu?.type === 'nvidia' ? 'cuda' : sys.gpu?.type === 'apple-silicon' ? 'metal' : 'cpu',
        gpu: sys.gpu?.name || null,
        memory: fmtGb(vramGb) || fmtGb(ramGb),
        vram: fmtGb(vramGb),
        ram: fmtGb(ramGb),
        cpuCores: sys.cores || null,
        ram_mb: ramMb,
        vram_mb: vramMb,
        gpu_model: sys.gpu?.name || null,
        cpu_cores: sys.cores || 0,
        bandwidth_mbps: 0,
        max_context_length: 0,
      };
    }
    return _localHwCache;
  }

  function snapshotNode() {
    const n = daemon.networkNode || {};
    const hw = n.hardware || getLocalHardware();
    return {
      active: !!n.active,
      status: n.status || 'stopped',
      nodeId: n.nodeId || null,
      layers: n.layers || null,
      model: n.model || null,
      sessions: n.sessions || 0,
      hardware: hw,
      installed: !!(daemon.config?.networkBeta?.installed),
      ram_mb: Number(hw.ram_mb) || 0,
      vram_mb: Number(hw.vram_mb) || 0,
      gpu_model: hw.gpu_model || hw.gpu || '',
      cpu_cores: Number(hw.cpu_cores) || 0,
      bandwidth_mbps: Number(hw.bandwidth_mbps) || 0.0,
      max_context_length: Number(hw.max_context_length) || 0,
      load: Number(hw.load) || 0.0,
    };
  }

  function eventLevel(event) {
    if (event === 'error' || event === 'crashed') return 'error';
    if (event === 'exit' || event === 'stopping' || event === 'disconnected') return 'warning';
    if (event === 'connected' || event === 'node registered' || event === 'shard loaded') return 'success';
    if (event === 'serving session' || event === 'session complete' || event === 'session ended') return 'session';
    return 'info';
  }

  function pushNodeEvent(event, details) {
    const d = details || {};
    const message = typeof d.msg === 'string' ? d.msg
      : typeof d.message === 'string' ? d.message
      : typeof d.line === 'string' ? d.line
      : event;
    const entry = {
      timestamp: new Date().toISOString(),
      event,
      level: eventLevel(event),
      message,
      details: details || null,
    };
    daemon.networkNode.events = daemon.networkNode.events || [];
    daemon.networkNode.events.push(entry);
    if (daemon.networkNode.events.length > 200) {
      daemon.networkNode.events = daemon.networkNode.events.slice(-200);
    }
    daemon.broadcast({ type: 'network:node:event', data: entry });
  }

  function normalizeHardware(caps) {
    if (!caps || typeof caps !== 'object') return null;
    const formatMb = (mb) => (Number.isFinite(mb) && mb > 0)
      ? (mb >= 1024 ? `${(mb / 1024).toFixed(mb >= 10240 ? 0 : 1)} GB` : `${mb} MB`)
      : null;
    const vram = formatMb(caps.vram_mb);
    const ram = formatMb(caps.ram_mb);
    return {
      device: caps.device || null,
      gpu: caps.gpu_model || null,
      memory: vram || ram || null,
      vram,
      ram,
      cpuCores: caps.cpu_cores || null,
      bandwidthMbps: caps.bandwidth_mbps || null,
      maxContext: caps.max_context_length || null,
      ram_mb: Number(caps.ram_mb) || 0,
      vram_mb: Number(caps.vram_mb) || 0,
      gpu_model: caps.gpu_model || null,
      cpu_cores: Number(caps.cpu_cores) || 0,
      bandwidth_mbps: Number(caps.bandwidth_mbps) || 0,
      max_context_length: Number(caps.max_context_length) || 0,
    };
  }

  function broadcastNodeStatus() {
    daemon.broadcast({ type: 'network:node:status', data: snapshotNode() });
  }

  app.get('/api/network/node/status', networkGate, (req, res) => {
    res.json(snapshotNode());
  });

  app.post('/api/network/node/start', networkGate, (req, res) => {
    if (daemon.networkNode?.active) {
      return res.status(409).json({ error: 'Node already running' });
    }

    const cfg = daemon.config.networkBeta || {};
    const signal = stripScheme(cfg.signalUrl);
    if (!isAllowedSignalHost(signal)) {
      return res.status(400).json({ error: 'Invalid signal host' });
    }
    const device = cfg.devicePreference || 'auto';
    const maxContext = Number.isFinite(cfg.maxContext) ? cfg.maxContext : 4096;

    // Resolve deploy path (handles ~ and defaults to ~/Desktop/groove-deploy)
    let deployPath = cfg.deployPath || null;
    if (!deployPath) {
      deployPath = resolve(homedir(), 'Desktop', 'groove-deploy');
    } else if (deployPath.startsWith('~/')) {
      deployPath = resolve(homedir(), deployPath.slice(2));
    }

    if (!existsSync(deployPath)) {
      return res.status(400).json({ error: `Deploy path not found: ${deployPath}` });
    }
    if (!isInsideGrooveHome(deployPath) && !deployPath.startsWith(resolve(homedir(), 'Desktop'))) {
      return res.status(400).json({ error: 'Deploy path outside allowed directories' });
    }

    const signalFlag = supportsSignalFlag(cfg.version) ? '--signal' : '--relay';
    const model = cfg.model || 'Qwen/Qwen3-4B';
    const args = [
      '-m', 'src.node.server',
      signalFlag, signal,
      '--tls',
      '--device', device,
      '--model', model,
      '--max-context', String(maxContext),
    ];

    let proc;
    try {
      proc = spawn(venvPython(deployPath), args, {
        cwd: deployPath,
        env: { ...process.env, PYTHONUNBUFFERED: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      return res.status(500).json({ error: `Failed to spawn node: ${err.message}` });
    }

    daemon.networkNode = {
      active: true,
      status: 'starting',
      pid: proc.pid,
      proc,
      nodeId: null,
      layers: null,
      model: null,
      sessions: 0,
      hardware: getLocalHardware(),
      startedAt: Date.now(),
      events: [],
      lastTokenTiming: null,
    };
    if (!daemon.networkBenchmarks) daemon.networkBenchmarks = [];

    pushNodeEvent('starting', { pid: proc.pid, signal, device });
    broadcastNodeStatus();

    let stderrBuf = '';
    const stderrDecoder = new StringDecoder('utf8');
    proc.stderr.on('data', (chunk) => {
      stderrBuf += stderrDecoder.write(chunk);
      let idx;
      while ((idx = stderrBuf.indexOf('\n')) !== -1) {
        const line = stderrBuf.slice(0, idx).trim();
        stderrBuf = stderrBuf.slice(idx + 1);
        if (!line) continue;
        if (line[0] !== '{') {
          // Python node emits plain-text logs like "Node identity: abc123",
          // "shard loaded: layers 0-12", "registered with signal". Parse those
          // here so the GUI reflects reality even without structured logging.
          let changed = false;
          const idMatch = line.match(/Node identity:\s*([A-Za-z0-9_\-:.]+)/i);
          if (idMatch && idMatch[1] !== daemon.networkNode.nodeId) {
            daemon.networkNode.nodeId = idMatch[1]; changed = true;
          }
          const layerMatch = line.match(/layers?\s*(\d+)\s*[-–to]+\s*(\d+)/i);
          if (layerMatch) {
            const start = parseInt(layerMatch[1], 10);
            const end = parseInt(layerMatch[2], 10);
            if (Number.isFinite(start) && Number.isFinite(end)) {
              daemon.networkNode.layers = [start, end]; changed = true;
            }
          }
          const modelMatch = line.match(/model[:\s]+([A-Za-z0-9_\-./]+\/[A-Za-z0-9_\-.]+)/i);
          if (modelMatch && modelMatch[1] !== daemon.networkNode.model) {
            daemon.networkNode.model = modelMatch[1]; changed = true;
          }
          if (/\bregistered\b/i.test(line) || /\bconnected\b/i.test(line)) {
            if (daemon.networkNode.status !== 'connected') {
              daemon.networkNode.status = 'connected'; changed = true;
            }
          }
          pushNodeEvent('log', { line });
          if (changed) broadcastNodeStatus();
          continue;
        }
        let entry;
        try { entry = JSON.parse(line); } catch { pushNodeEvent('log', { line }); continue; }
        const msg = entry.msg || entry.event || '';
        let changed = false;
        if (entry.node_id && entry.node_id !== daemon.networkNode.nodeId) {
          daemon.networkNode.nodeId = entry.node_id; changed = true;
        }
        if (msg === 'node registered' || msg === 'connected') {
          daemon.networkNode.status = 'connected'; changed = true;
        }
        if (msg === 'shard loaded' || entry.layer_start !== undefined) {
          if (entry.layer_start !== undefined && entry.layer_end !== undefined) {
            daemon.networkNode.layers = [entry.layer_start, entry.layer_end]; changed = true;
          }
          if (entry.model_name) { daemon.networkNode.model = entry.model_name; changed = true; }
        }
        if (msg === 'serving session') {
          daemon.networkNode.sessions = (daemon.networkNode.sessions || 0) + 1; changed = true;
        }
        if (msg === 'session complete' || msg === 'session ended') {
          daemon.networkNode.sessions = Math.max(0, (daemon.networkNode.sessions || 0) - 1); changed = true;
        }
        if (entry.capabilities || entry.hardware) {
          daemon.networkNode.hardware = normalizeHardware(entry.capabilities || entry.hardware); changed = true;
        }
        if (entry.type === 'token') {
          const timing = {
            token_ms: entry.token_ms, pipeline_ms: entry.pipeline_ms,
            prefill_ms: entry.prefill_ms, logits_deser_ms: entry.logits_deser_ms,
            sample_ms: entry.sample_ms, decode_ms: entry.decode_ms,
            tps: entry.tps, ttft_ms: entry.ttft_ms, is_prefill: entry.is_prefill,
            tokens_generated: entry.tokens_generated,
            stages: Array.isArray(entry.stages) ? entry.stages : [],
          };
          daemon.networkNode.lastTokenTiming = timing;
          daemon.broadcast({ type: 'network:token:timing', data: timing });
        }
        if (entry.type === 'timing') {
          const summary = {
            ttft_ms: entry.ttft_ms, tps: entry.tps,
            tokens_generated: entry.tokens_generated,
            total_network_ms: entry.total_network_ms,
            total_compute_ms: entry.total_compute_ms,
            p2p_sends: entry.p2p_sends, relay_sends: entry.relay_sends,
            stage_0_avg_ms: entry.stage_0_avg_ms, stage_0_count: entry.stage_0_count,
            stage_1_avg_ms: entry.stage_1_avg_ms, stage_1_count: entry.stage_1_count,
            t: Date.now(),
          };
          if (!daemon.networkBenchmarks) daemon.networkBenchmarks = [];
          daemon.networkBenchmarks.push(summary);
          if (daemon.networkBenchmarks.length > 100) daemon.networkBenchmarks.shift();
          daemon.broadcast({ type: 'network:timing:summary', data: summary });
        }
        pushNodeEvent(msg || 'log', entry);
        if (changed) broadcastNodeStatus();
      }
    });

    let stdoutBuf = '';
    const stdoutDecoder = new StringDecoder('utf8');
    proc.stdout.on('data', (chunk) => {
      stdoutBuf += stdoutDecoder.write(chunk);
      let idx;
      while ((idx = stdoutBuf.indexOf('\n')) !== -1) {
        const line = stdoutBuf.slice(0, idx).trim();
        stdoutBuf = stdoutBuf.slice(idx + 1);
        if (line) pushNodeEvent('stdout', { line });
      }
    });

    proc.on('error', (err) => {
      daemon.networkNode.status = 'error';
      pushNodeEvent('error', { message: err.message });
      broadcastNodeStatus();
    });

    proc.on('exit', (code, signal) => {
      const trailing = stdoutDecoder.end();
      if (trailing) stdoutBuf += trailing;
      if (stdoutBuf.trim()) pushNodeEvent('stdout', { line: stdoutBuf.trim() });
      const trailingErr = stderrDecoder.end();
      if (trailingErr) stderrBuf += trailingErr;
      daemon.networkNode.active = false;
      daemon.networkNode.status = 'stopped';
      daemon.networkNode.pid = null;
      daemon.networkNode.proc = null;
      pushNodeEvent('exit', { code, signal });
      broadcastNodeStatus();
    });

    daemon.audit.log('network.node.start', { pid: proc.pid, signal, device });
    res.status(202).json({ started: true, ...snapshotNode() });
  });

  app.post('/api/network/node/stop', networkGate, (req, res) => {
    const node = daemon.networkNode;
    if (!node?.active || !node.proc) {
      return res.status(409).json({ error: 'Node not running' });
    }
    safeKill(node.proc);
    daemon.networkNode.status = 'stopping';
    pushNodeEvent('stopping', { pid: node.pid });
    broadcastNodeStatus();
    daemon.audit.log('network.node.stop', { pid: node.pid });
    res.json({ stopping: true });
  });

  app.get('/api/network/benchmarks', networkGate, (req, res) => {
    res.json(daemon.networkBenchmarks || []);
  });

  app.get('/api/network/timing', networkGate, (req, res) => {
    res.json({
      current: daemon.networkNode?.lastTokenTiming || null,
      benchmarkCount: (daemon.networkBenchmarks || []).length,
    });
  });

  app.get('/api/network/traces', networkGate, (req, res) => {
    const tracesDir = resolve(homedir(), '.groove', 'traces');
    if (!existsSync(tracesDir)) return res.json([]);
    try {
      const files = readdirSync(tracesDir)
        .filter((f) => f.endsWith('.jsonl'))
        .map((f) => {
          const st = statSync(resolve(tracesDir, f));
          return { filename: f, size: st.size, mtime: st.mtimeMs };
        })
        .sort((a, b) => b.mtime - a.mtime);
      res.json(files);
    } catch { res.json([]); }
  });

  app.get('/api/network/traces/live', networkGate, (req, res) => {
    const tracesDir = resolve(homedir(), '.groove', 'traces');
    if (!existsSync(tracesDir)) {
      return res.json({ lines: [], nextOffset: 0, filename: null, active: false });
    }
    try {
      const files = readdirSync(tracesDir)
        .filter((f) => f.endsWith('.jsonl'))
        .map((f) => {
          const st = statSync(resolve(tracesDir, f));
          return { filename: f, mtime: st.mtimeMs };
        })
        .sort((a, b) => b.mtime - a.mtime);
      if (files.length === 0) {
        return res.json({ lines: [], nextOffset: 0, filename: null, active: false });
      }
      const newest = files[0];
      const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
      const filePath = resolve(tracesDir, newest.filename);
      const raw = readFileSync(filePath, 'utf8');
      const allLines = raw.split('\n').filter(Boolean);
      const sliced = allLines.slice(offset);
      const parsed = [];
      for (const line of sliced) {
        try { parsed.push(JSON.parse(line)); } catch { /* skip malformed */ }
      }
      const active = !!(daemon.networkNode?.active && (daemon.networkNode.sessions || 0) > 0);
      res.json({
        lines: parsed,
        nextOffset: offset + sliced.length,
        filename: newest.filename,
        active,
      });
    } catch {
      res.json({ lines: [], nextOffset: 0, filename: null, active: false });
    }
  });

  app.get('/api/network/traces/:filename', networkGate, (req, res) => {
    const { filename } = req.params;
    if (!filename || /[/\\]/.test(filename) || !filename.endsWith('.jsonl')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }
    const tracesDir = resolve(homedir(), '.groove', 'traces');
    const filePath = resolve(tracesDir, filename);
    if (!filePath.startsWith(tracesDir + sep)) {
      return res.status(400).json({ error: 'Invalid filename' });
    }
    if (!existsSync(filePath)) {
      return res.status(404).json({ error: 'Trace file not found' });
    }
    try {
      const raw = readFileSync(filePath, 'utf8');
      const lines = raw.split('\n').filter(Boolean).slice(0, 5000);
      const entries = [];
      for (const line of lines) {
        try { entries.push(JSON.parse(line)); } catch { /* skip malformed lines */ }
      }
      res.json(entries);
    } catch (err) {
      res.status(500).json({ error: `Failed to read trace: ${err.message}` });
    }
  });

  function isAllowedSignalHost(host) {
    const h = (host || '').replace(/^(wss?|https?):\/\//i, '').replace(/\/.*$/, '').toLowerCase();
    return h === 'signal.groovedev.ai' || h.endsWith('.groovedev.ai');
  }

  // The Python node/client code prepends the scheme itself from `--tls`.
  // Daemon must pass a BARE host to --relay/--signal; otherwise the Python
  // side ends up with a double-scheme URI like wss://wss://host.
  function stripScheme(url) {
    if (!url) return 'signal.groovedev.ai';
    return url.replace(/^wss?:\/\//i, '').replace(/\/.*$/, '');
  }

  app.get('/api/network/status', networkGate, async (req, res) => {
    const cfg = daemon.config.networkBeta || {};
    const signalHost = cfg.signalUrl || 'signal.groovedev.ai';

    if (!isAllowedSignalHost(signalHost)) {
      return res.status(400).json({ error: 'Invalid signal host' });
    }

    const bareHost = signalHost.replace(/^(wss?|https?):\/\//i, '').replace(/\/.*$/, '');
    const statusUrl = `https://${bareHost}/status`;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const r = await fetch(statusUrl, { signal: controller.signal });
      clearTimeout(timer);
      if (r.ok) {
        const data = await r.json();
        // Signal service returns snake_case; GUI expects camelCase.
        const models = Array.isArray(data.models) ? data.models.map((m) => {
          if (!m || typeof m !== 'object') return m;
          const { covered_layers, total_layers, ...rest } = m;
          return {
            ...rest,
            ...(covered_layers !== undefined ? { coveredLayers: covered_layers } : {}),
            ...(total_layers !== undefined ? { totalLayers: total_layers } : {}),
          };
        }) : [];
        const primaryModel = Array.isArray(data.models) && data.models[0] ? data.models[0] : {};

        // Enrich local node state from signal's authoritative topology.
        // Signal truncates IDs (e.g. "0xf608fd..."), so match by prefix.
        if (daemon.networkNode?.active && daemon.networkNode.nodeId) {
          const selfId = daemon.networkNode.nodeId;
          const signalNodes = Array.isArray(data.nodes) ? data.nodes : [];
          const self = signalNodes.find((n) => {
            const nid = n.node_id || n.nodeId || '';
            const prefix = nid.replace(/\.{2,}$/, '');
            return selfId === nid || (prefix.length >= 6 && selfId.startsWith(prefix));
          });
          let changed = false;
          if (self) {
            if (Array.isArray(self.layers) && self.layers.length === 2) {
              daemon.networkNode.layers = self.layers;
              changed = true;
            }
            const prev = daemon.networkNode.hardware || getLocalHardware();
            const enriched = { ...prev };
            if (self.device) enriched.device = self.device;
            if (self.gpu_model) { enriched.gpu = self.gpu_model; enriched.gpu_model = self.gpu_model; }
            if (Number(self.ram_mb) > 0) { enriched.ram_mb = Number(self.ram_mb); }
            if (Number(self.vram_mb) > 0) { enriched.vram_mb = Number(self.vram_mb); enriched.memory = enriched.vram_mb >= 1024 ? `${(enriched.vram_mb / 1024).toFixed(1)} GB` : `${enriched.vram_mb} MB`; }
            if (Number(self.cpu_cores) > 0) { enriched.cpu_cores = Number(self.cpu_cores); enriched.cpuCores = Number(self.cpu_cores); }
            daemon.networkNode.hardware = enriched;
            changed = true;
          }
          const availModel = Array.isArray(data.models)
            ? data.models.find((m) => m && m.available !== false)
            : null;
          if (availModel && !daemon.networkNode.model) {
            daemon.networkNode.model = availModel.name || null;
            changed = true;
          }
          if (changed) broadcastNodeStatus();
        }

        const capStr = (s, max = 200) => (typeof s === 'string' ? s.slice(0, max) : s);
        const selfId = daemon.networkNode?.nodeId;
        const localHw = getLocalHardware();
        const safeNodes = (Array.isArray(data.nodes) ? data.nodes : []).map((n) => {
          const nid = n.node_id || n.nodeId || '';
          const isSelf = selfId && nid && (nid === selfId || (nid.length >= 6 && selfId.startsWith(nid.replace(/\.{2,}$/, ''))));
          const base = {
            node_id: capStr(nid),
            device: capStr(n.device),
            layers: Array.isArray(n.layers) ? n.layers.slice(0, 2) : n.layers,
            status: capStr(n.status, 50),
            active_sessions: n.active_sessions ?? 0,
            ram_mb: Number(n.ram_mb) || 0,
            vram_mb: Number(n.vram_mb) || 0,
            gpu_model: capStr(n.gpu_model || '', 200),
            cpu_cores: Number(n.cpu_cores) || 0,
            bandwidth_mbps: Number(n.bandwidth_mbps) || 0.0,
            max_context_length: Number(n.max_context_length) || 0,
            load: Number(n.load) || 0.0,
            gpu_utilization_pct: Number(n.gpu_utilization_pct) || 0,
            vram_used_mb: Number(n.vram_used_mb) || 0,
            ram_used_mb: Number(n.ram_used_mb) || 0,
            ram_pct: Number(n.ram_pct) || 0,
            uptime_seconds: Number(n.uptime_seconds) || 0,
          };
          if (isSelf) {
            if (!base.device) base.device = localHw.device;
            if (!base.gpu_model) base.gpu_model = localHw.gpu_model || '';
            if (!base.ram_mb) base.ram_mb = localHw.ram_mb;
            if (!base.vram_mb) base.vram_mb = localHw.vram_mb;
            if (!base.cpu_cores) base.cpu_cores = localHw.cpu_cores;
          }
          return base;
        });

        return res.json({
          nodes: safeNodes,
          models,
          compute: data.compute || null,
          coverage: data.covered_layers ?? primaryModel.covered_layers ?? data.coverage ?? 0,
          totalLayers: data.total_layers ?? primaryModel.total_layers ?? data.totalLayers ?? 36,
          activeSessions: data.active_sessions ?? data.activeSessions ?? 0,
          totalNodes: data.total_nodes ?? data.totalNodes ?? (Array.isArray(data.nodes) ? data.nodes.length : 0),
        });
      }
    } catch { /* fall through to local snapshot */ }

    // Fallback: local node snapshot when signal is unreachable.
    const node = daemon.networkNode || {};
    const hw = node.hardware || {};
    const sysHw = OllamaProvider.getSystemHardware();
    const localRamMb = (sysHw.totalRamGb || 0) * 1024;
    const localVramMb = (sysHw.gpu?.vram || 0) * 1024;
    const localCpuCores = sysHw.cores || 0;
    const selfNode = node.active && node.nodeId ? [{
      node_id: node.nodeId,
      device: hw.device || (sysHw.gpu?.type === 'nvidia' ? 'cuda' : sysHw.gpu?.type === 'apple-silicon' ? 'metal' : 'cpu'),
      layers: node.layers || [0, 0],
      status: node.status === 'connected' ? 'active' : node.status,
      active_sessions: node.sessions || 0,
      ram_mb: localRamMb,
      vram_mb: localVramMb,
      gpu_model: sysHw.gpu?.name || '',
      cpu_cores: localCpuCores,
      bandwidth_mbps: 0.0,
      max_context_length: 0,
      load: 0.0,
      gpu_utilization_pct: 0,
      vram_used_mb: 0,
      ram_used_mb: 0,
      ram_pct: 0,
      uptime_seconds: 0,
    }] : [];
    const coverage = node.layers ? (node.layers[1] - node.layers[0]) : 0;
    const localCompute = selfNode.length > 0 ? {
      total_ram_mb: localRamMb,
      total_vram_mb: localVramMb,
      total_cpu_cores: localCpuCores,
      total_bandwidth_mbps: 0.0,
      active_nodes: selfNode.length,
      total_nodes: selfNode.length,
      avg_load: 0.0,
    } : null;
    res.json({
      nodes: selfNode,
      models: ['Qwen/Qwen3-4B'],
      compute: localCompute,
      coverage,
      totalLayers: 36,
      activeSessions: node.sessions || 0,
      totalNodes: selfNode.length,
    });
  });

  app.get('/api/network/compute', networkGate, async (req, res) => {
    const cfg = daemon.config.networkBeta || {};
    const signalHost = cfg.signalUrl || 'signal.groovedev.ai';

    if (!isAllowedSignalHost(signalHost)) {
      return res.status(400).json({ error: 'Invalid signal host' });
    }

    const bareHost = signalHost.replace(/^(wss?|https?):\/\//i, '').replace(/\/.*$/, '');
    const statusUrl = `https://${bareHost}/status`;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const r = await fetch(statusUrl, { signal: controller.signal });
      clearTimeout(timer);
      if (r.ok) {
        const data = await r.json();
        const nodes = (Array.isArray(data.nodes) ? data.nodes : []).map((n) => ({
          node_id: n.node_id || n.nodeId || '',
          ram_mb: Number(n.ram_mb) || 0,
          vram_mb: Number(n.vram_mb) || 0,
          gpu_model: typeof n.gpu_model === 'string' ? n.gpu_model.slice(0, 200) : '',
          cpu_cores: Number(n.cpu_cores) || 0,
          bandwidth_mbps: Number(n.bandwidth_mbps) || 0.0,
          max_context_length: Number(n.max_context_length) || 0,
          load: Number(n.load) || 0.0,
          gpu_utilization_pct: Number(n.gpu_utilization_pct) || 0,
          vram_used_mb: Number(n.vram_used_mb) || 0,
          ram_used_mb: Number(n.ram_used_mb) || 0,
          ram_pct: Number(n.ram_pct) || 0,
          uptime_seconds: Number(n.uptime_seconds) || 0,
        }));
        return res.json({ compute: data.compute || null, nodes });
      }
    } catch { /* fall through to local snapshot */ }

    const node = daemon.networkNode || {};
    const sysHw = OllamaProvider.getSystemHardware();
    const localRamMb = (sysHw.totalRamGb || 0) * 1024;
    const localVramMb = (sysHw.gpu?.vram || 0) * 1024;
    const localCpuCores = sysHw.cores || 0;
    const isActive = !!(node.active && node.nodeId);
    const nodes = isActive ? [{
      node_id: node.nodeId,
      ram_mb: localRamMb,
      vram_mb: localVramMb,
      gpu_model: sysHw.gpu?.name || '',
      cpu_cores: localCpuCores,
      bandwidth_mbps: 0.0,
      max_context_length: 0,
      load: 0.0,
      gpu_utilization_pct: 0,
      vram_used_mb: 0,
      ram_used_mb: 0,
      ram_pct: 0,
      uptime_seconds: 0,
    }] : [];
    const compute = isActive ? {
      total_ram_mb: localRamMb,
      total_vram_mb: localVramMb,
      total_cpu_cores: localCpuCores,
      total_bandwidth_mbps: 0.0,
      active_nodes: 1,
      total_nodes: 1,
      avg_load: 0.0,
    } : null;
    res.json({ compute, nodes });
  });

  // --- Network package install/uninstall ---

  const IS_WIN = process.platform === 'win32';
  const NETWORK_REPO_URL = 'https://github.com/grooveai-dev/groove-network.git';
  const NETWORK_VERSION = 'v0.2.0';

  function venvPython(base) {
    return IS_WIN
      ? join(base, 'venv', 'Scripts', 'python.exe')
      : join(base, 'venv', 'bin', 'python3');
  }

  let _cachedGitBash = undefined;
  function findGitBash() {
    if (_cachedGitBash !== undefined) return _cachedGitBash;
    try {
      const gitPath = execFileSync('where', ['git'], { timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] })
        .toString().trim().split('\n')[0].trim();
      // git.exe is typically at <Git>\cmd\git.exe — navigate up to Git root
      const gitDir = dirname(dirname(gitPath));
      const candidate = join(gitDir, 'bin', 'bash.exe');
      if (existsSync(candidate)) { _cachedGitBash = candidate; return _cachedGitBash; }
    } catch { /* where failed — try common paths */ }
    const fallbacks = [
      'C:\\Program Files\\Git\\bin\\bash.exe',
      'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
    ];
    for (const p of fallbacks) {
      if (existsSync(p)) { _cachedGitBash = p; return _cachedGitBash; }
    }
    _cachedGitBash = null;
    return null;
  }

  function spawnSetupSh(cwd) {
    if (IS_WIN) {
      const bashPath = findGitBash();
      if (!bashPath) {
        const err = new Error('Could not find bash. Ensure Git for Windows is installed from https://git-scm.com');
        err.code = 'BASH_NOT_FOUND';
        throw err;
      }
      return spawn(bashPath, ['setup.sh', '--json'], {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONUNBUFFERED: '1' },
      });
    }
    return spawn('bash', ['setup.sh', '--json'], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    });
  }

  function safeKill(proc, signal = 'SIGINT') {
    try {
      if (IS_WIN) { proc.kill(); } else { proc.kill(signal); }
    } catch { /* ignore */ }
  }

  function networkRoot() {
    return resolve(homedir(), '.groove', 'network');
  }

  function getInstalledNetworkVersion() {
    const configured = daemon.config?.networkBeta?.version || null;
    if (configured) return configured;
    const installPath = networkRoot();
    if (!existsSync(resolve(installPath, 'setup.sh'))) return null;
    try {
      const { execSync } = require('child_process');
      const v = execSync('git describe --tags --abbrev=0', {
        cwd: installPath, stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000,
      }).toString().trim();
      return parseSemver(v) ? v : null;
    } catch {
      return null;
    }
  }

  // Defensive: only permit fs ops on paths that resolve inside ~/.groove/.
  // Uses realpathSync when the path exists to defeat symlink escapes.
  function isInsideGrooveHome(target) {
    const home = resolve(homedir(), '.groove') + sep;
    const resolved = resolve(target);
    let full;
    try { full = existsSync(resolved) ? realpathSync(resolved) + sep : resolved + sep; }
    catch { full = resolved + sep; }
    const realHome = existsSync(home.slice(0, -1)) ? realpathSync(home.slice(0, -1)) + sep : home;
    return full.startsWith(realHome);
  }

  function broadcastInstallProgress(step, message, percent) {
    daemon.broadcast({
      type: 'network:install:progress',
      data: { step, message, percent },
    });
  }

  app.get('/api/network/install/status', networkGate, (req, res) => {
    const installPath = networkRoot();
    const dirExists = existsSync(installPath);
    const installed = dirExists && existsSync(resolve(installPath, 'setup.sh'));
    const stale = dirExists && !installed;
    res.json({
      installed,
      stale,
      path: dirExists ? installPath : null,
      version: installed ? getInstalledNetworkVersion() : null,
    });
  });

  app.post('/api/network/install', networkGate, async (req, res) => {
    if (daemon.networkInstall?.running) {
      return res.status(409).json({ error: 'Install already in progress' });
    }
    if (daemon.config?.networkBeta?.installed) {
      return res.status(400).json({ error: 'Network package already installed' });
    }

    const installPath = networkRoot();
    if (!isInsideGrooveHome(installPath)) {
      return res.status(500).json({ error: 'Invalid install path' });
    }

    // If directory exists from a previous failed install, clean it up automatically.
    if (existsSync(installPath)) {
      if (daemon.config?.networkBeta?.installed) {
        return res.status(400).json({ error: 'Install path already exists; uninstall first' });
      }
      try {
        rmSync(installPath, { recursive: true, force: true });
        daemon.audit?.log?.('network.install.stale-cleanup', { path: installPath });
      } catch (cleanupErr) {
        return res.status(500).json({ error: `Failed to clean stale install directory: ${cleanupErr.message}` });
      }
    }

    daemon.networkInstall = { running: true, startedAt: Date.now() };
    res.status(200).json({ status: 'installing' });

    // Run the install asynchronously; progress flows over WebSocket.
    (async () => {
      const cleanup = () => {
        try {
          if (existsSync(installPath) && isInsideGrooveHome(installPath)) {
            rmSync(installPath, { recursive: true, force: true });
          }
        } catch { /* ignore */ }
      };

      const fail = (message) => {
        cleanup();
        broadcastInstallProgress('error', message, -1);
        daemon.audit.log('network.install.failed', { message });
        daemon.networkInstall = { running: false };
      };

      try {
        const pat = daemon.credentials?.getKey?.('github') || daemon.credentials?.getKey?.('github-pat') || null;

        let installVersion;
        try {
          installVersion = (await getLatestNetworkTag()) || NETWORK_VERSION;
        } catch {
          installVersion = NETWORK_VERSION;
        }

        broadcastInstallProgress('cloning', `Cloning network package ${installVersion}...`, 0);

        // Pre-flight: verify git is installed before attempting clone.
        const gitInstalled = await new Promise((resolveGit) => {
          execFile('git', ['--version'], { timeout: 5000 }, (err) => resolveGit(!err));
        });
        if (!gitInstalled) {
          return fail('Git is not installed. Install Git from https://git-scm.com and restart Groove.');
        }

        const cloneArgs = ['clone', '--branch', installVersion, '--depth', '1', NETWORK_REPO_URL, installPath];
        const cloneEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
        if (pat) {
          cloneEnv.GIT_CONFIG_COUNT = '1';
          cloneEnv.GIT_CONFIG_KEY_0 = 'http.extraHeader';
          cloneEnv.GIT_CONFIG_VALUE_0 = `Authorization: token ${pat}`;
        }
        const clone = spawn('git', cloneArgs, {
          stdio: ['ignore', 'pipe', 'pipe'],
          env: cloneEnv,
        });

        const stripCredentials = (s) => s.replace(/https:\/\/[^@]+@/g, 'https://***@');

        let cloneErr = '';
        clone.stderr.on('data', (chunk) => {
          const s = chunk.toString();
          cloneErr += s;
          // git writes progress to stderr — relay last line as status.
          const line = s.split('\n').map((l) => l.trim()).filter(Boolean).pop();
          if (line) broadcastInstallProgress('cloning', stripCredentials(line), 5);
        });

        const cloneCode = await new Promise((resolveClone) => {
          clone.on('error', (err) => resolveClone({ code: -1, err: err.message }));
          clone.on('close', (code) => resolveClone({ code }));
        });

        if (cloneCode.code !== 0) {
          let hint;
          const errMsg = cloneCode.err || '';
          const lastLine = cloneErr.trim().split('\n').slice(-1)[0] || '';
          if (errMsg.includes('ENOENT')) {
            hint = 'Git is not installed. Install Git from https://git-scm.com and restart Groove.';
          } else if (/Authentication failed|could not read Username/i.test(cloneErr)) {
            hint = 'Authentication failed — run "groove set-key github-pat <token>" to set a GitHub PAT.';
          } else if (/not found/i.test(cloneErr)) {
            hint = `Repository or tag not found (${installVersion}). Check NETWORK_REPO_URL and tag.`;
          } else {
            hint = stripCredentials(lastLine || errMsg || 'git clone failed');
          }
          return fail(`Clone failed: ${hint}`);
        }

        broadcastInstallProgress('cloned', 'Repository cloned', 10);

        // Run setup.sh --json from the install directory
        let setup;
        try {
          setup = spawnSetupSh(installPath);
        } catch (spawnErr) {
          return fail(`Setup failed: ${spawnErr.message}`);
        }

        daemon.networkInstall.proc = setup;

        let stdoutBuf = '';
        setup.stdout.on('data', (chunk) => {
          stdoutBuf += chunk.toString();
          let idx;
          while ((idx = stdoutBuf.indexOf('\n')) !== -1) {
            const line = stdoutBuf.slice(0, idx).trim();
            stdoutBuf = stdoutBuf.slice(idx + 1);
            if (!line) continue;
            if (line[0] !== '{') continue;
            try {
              const event = JSON.parse(line);
              const step = typeof event.step === 'string' ? event.step : 'progress';
              const message = typeof event.message === 'string' ? event.message : '';
              const percent = Number.isFinite(event.percent) ? event.percent : null;
              broadcastInstallProgress(step, message, percent);
            } catch { /* non-JSON line, ignore */ }
          }
        });

        let stderrBuf = '';
        setup.stderr.on('data', (chunk) => {
          stderrBuf += chunk.toString();
        });

        const setupResult = await new Promise((resolveSetup) => {
          setup.on('error', (err) => resolveSetup({ code: -1, err: err.message }));
          setup.on('close', (code) => resolveSetup({ code }));
        });

        if (setupResult.code !== 0) {
          let hint;
          if (setupResult.code === -1 || setupResult.err?.includes('ENOENT')) {
            hint = 'bash not found — ensure Git for Windows is installed from https://git-scm.com';
          } else {
            hint = stderrBuf.trim().split('\n').slice(-1)[0] || `setup.sh exited ${setupResult.code}`;
          }
          return fail(`Setup failed: ${hint}`);
        }

        daemon.config.networkBeta = {
          ...(daemon.config.networkBeta || {}),
          installed: true,
          deployPath: installPath,
          version: installVersion,
        };
        await persistConfig();
        daemon.broadcast({ type: 'config:updated' });
        broadcastInstallProgress('done', `Network package ${installVersion} installed`, 100);
        daemon.audit.log('network.install', { path: installPath, version: installVersion });
        daemon.networkInstall = { running: false };
      } catch (err) {
        fail(err?.message || 'Install failed');
      }
    })();
  });

  app.post('/api/network/uninstall', networkGate, async (req, res) => {
    if (daemon.networkInstall?.running) {
      return res.status(409).json({ error: 'Install in progress; wait for it to finish' });
    }

    // Stop the running node first (reuse existing stop logic).
    try {
      const node = daemon.networkNode;
      if (node?.active && node.proc && !node.proc.killed) {
        safeKill(node.proc);
        daemon.networkNode.status = 'stopping';
        pushNodeEvent('stopping', { pid: node.pid, reason: 'uninstall' });
        broadcastNodeStatus();
      }
    } catch { /* ignore */ }

    const installPath = networkRoot();
    if (!isInsideGrooveHome(installPath)) {
      return res.status(500).json({ error: 'Invalid install path' });
    }

    try {
      if (existsSync(installPath)) {
        rmSync(installPath, { recursive: true, force: true });
      }
    } catch (err) {
      return res.status(500).json({ error: `Failed to remove install: ${err.message}` });
    }

    daemon.config.networkBeta = {
      ...(daemon.config.networkBeta || {}),
      installed: false,
      deployPath: null,
      version: null,
    };
    await persistConfig();
    daemon.broadcast({ type: 'config:updated' });
    daemon.audit.log('network.uninstall', { path: installPath });
    res.json({ status: 'uninstalled' });
  });

  // --- Network package update check / update ---

  // 5-minute cache of the latest-tag lookup so startup + GUI polls don't
  // hammer GitHub. Shape: { latest, fetchedAt }. null until first check.
  let networkUpdateCache = null;
  const NETWORK_UPDATE_CACHE_MS = 5 * 60 * 1000;

  // Run `git ls-remote --tags <repo>` and return the highest semver tag.
  // Resolves to null on git errors / network failure; caller decides how to
  // surface that. Uses spawn with array args — no shell interpolation.
  function fetchLatestNetworkTag() {
    return new Promise((resolvePromise) => {
      const tagEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
      const tagPat = daemon.credentials?.getKey?.('github') || daemon.credentials?.getKey?.('github-pat') || null;
      if (tagPat) {
        tagEnv.GIT_CONFIG_COUNT = '1';
        tagEnv.GIT_CONFIG_KEY_0 = 'http.extraHeader';
        tagEnv.GIT_CONFIG_VALUE_0 = `Authorization: token ${tagPat}`;
      }
      const proc = spawn('git', ['ls-remote', '--tags', NETWORK_REPO_URL], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: tagEnv,
      });
      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', (c) => { stdout += c.toString(); });
      proc.stderr.on('data', (c) => { stderr += c.toString(); });
      const timeout = setTimeout(() => { safeKill(proc, 'SIGTERM'); }, 10_000);
      proc.on('error', () => { clearTimeout(timeout); resolvePromise(null); });
      proc.on('close', (code) => {
        clearTimeout(timeout);
        if (code !== 0) return resolvePromise(null);
        const tags = [];
        for (const line of stdout.split('\n')) {
          // Format: <sha>\trefs/tags/v0.1.0 (or .../v0.1.0^{} for annotated)
          const m = line.match(/refs\/tags\/(v?\d+\.\d+\.\d+[^\s^]*)(?:\^\{\})?$/);
          if (m && parseSemver(m[1])) tags.push(m[1]);
        }
        if (tags.length === 0) return resolvePromise(null);
        tags.sort(compareSemver);
        resolvePromise(tags[tags.length - 1]);
      });
    });
  }

  async function getLatestNetworkTag(force = false) {
    if (!force && networkUpdateCache && (Date.now() - networkUpdateCache.fetchedAt) < NETWORK_UPDATE_CACHE_MS) {
      return networkUpdateCache.latest;
    }
    const latest = await fetchLatestNetworkTag();
    if (latest) networkUpdateCache = { latest, fetchedAt: Date.now() };
    return latest;
  }

  app.get('/api/network/update/check', networkGate, async (req, res) => {
    const installed = getInstalledNetworkVersion();
    const force = req.query.force === '1' || req.query.force === 'true';
    const latest = await getLatestNetworkTag(force);
    if (!latest) {
      return res.status(502).json({
        installed,
        latest: null,
        updateAvailable: false,
        error: 'Could not reach github.com to check for updates',
      });
    }
    const updateAvailable = !!installed && compareSemver(latest, installed) > 0;
    res.json({ installed, latest, updateAvailable });
  });

  function broadcastUpdateProgress(step, message, percent) {
    daemon.broadcast({
      type: 'network:update:progress',
      data: { step, message, percent },
    });
  }

  app.post('/api/network/update', networkGate, async (req, res) => {
    if (daemon.networkInstall?.running) {
      return res.status(409).json({ error: 'Install/update already in progress' });
    }
    const installPath = networkRoot();
    const hasInstall = daemon.config?.networkBeta?.installed || existsSync(resolve(installPath, 'setup.sh'));
    if (!hasInstall) {
      return res.status(400).json({ error: 'Network package not installed' });
    }
    if (!existsSync(installPath) || !isInsideGrooveHome(installPath)) {
      return res.status(400).json({ error: 'Install path missing or invalid' });
    }

    const latest = await getLatestNetworkTag(true);
    if (!latest) {
      return res.status(502).json({ error: 'Could not reach github.com to check for updates' });
    }
    const current = getInstalledNetworkVersion();
    if (current && compareSemver(latest, current) <= 0) {
      return res.status(400).json({ error: 'Already at latest version', installed: current, latest });
    }

    daemon.networkInstall = { running: true, startedAt: Date.now(), kind: 'update' };
    res.status(200).json({ status: 'updating', from: current, to: latest });

    (async () => {
      const fail = (message) => {
        broadcastUpdateProgress('error', message, -1);
        daemon.audit.log('network.update.failed', { message, from: current, to: latest });
        daemon.networkInstall = { running: false };
      };

      try {
        // Stop the running node first so we don't update files under its feet.
        try {
          const node = daemon.networkNode;
          if (node?.active && node.proc && !node.proc.killed) {
            safeKill(node.proc);
            daemon.networkNode.status = 'stopping';
            pushNodeEvent('stopping', { pid: node.pid, reason: 'update' });
            broadcastNodeStatus();
            // Small grace window for the process to exit cleanly.
            await new Promise((r) => setTimeout(r, 500));
          }
        } catch { /* ignore */ }

        broadcastUpdateProgress('fetching', `Fetching ${latest}...`, 5);

        const fetchProc = spawn('git', ['-C', installPath, 'fetch', '--tags', '--force'], {
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        });
        let fetchErr = '';
        fetchProc.stderr.on('data', (c) => { fetchErr += c.toString(); });
        const fetchCode = await new Promise((r) => {
          fetchProc.on('error', (e) => r({ code: -1, err: e.message }));
          fetchProc.on('close', (code) => r({ code }));
        });
        if (fetchCode.code !== 0) {
          const hint = fetchErr.trim().split('\n').slice(-1)[0] || 'git fetch failed';
          return fail(`Fetch failed: ${hint}`);
        }

        broadcastUpdateProgress('checkout', `Checking out ${latest}...`, 20);

        const checkoutProc = spawn('git', ['-C', installPath, 'checkout', latest], {
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        });
        let checkoutErr = '';
        checkoutProc.stderr.on('data', (c) => { checkoutErr += c.toString(); });
        const checkoutCode = await new Promise((r) => {
          checkoutProc.on('error', (e) => r({ code: -1, err: e.message }));
          checkoutProc.on('close', (code) => r({ code }));
        });
        if (checkoutCode.code !== 0) {
          const hint = checkoutErr.trim().split('\n').slice(-1)[0] || 'git checkout failed';
          return fail(`Checkout failed: ${hint}`);
        }

        broadcastUpdateProgress('deps', 'Updating dependencies...', 30);

        let setup;
        try {
          setup = spawnSetupSh(installPath);
        } catch (spawnErr) {
          return fail(`Setup failed: ${spawnErr.message}`);
        }

        daemon.networkInstall.proc = setup;

        let stdoutBuf = '';
        setup.stdout.on('data', (chunk) => {
          stdoutBuf += chunk.toString();
          let idx;
          while ((idx = stdoutBuf.indexOf('\n')) !== -1) {
            const line = stdoutBuf.slice(0, idx).trim();
            stdoutBuf = stdoutBuf.slice(idx + 1);
            if (!line || line[0] !== '{') continue;
            try {
              const event = JSON.parse(line);
              const step = typeof event.step === 'string' ? event.step : 'progress';
              const message = typeof event.message === 'string' ? event.message : '';
              const percent = Number.isFinite(event.percent) ? event.percent : null;
              broadcastUpdateProgress(step, message, percent);
            } catch { /* non-JSON line, ignore */ }
          }
        });

        let stderrBuf = '';
        setup.stderr.on('data', (chunk) => { stderrBuf += chunk.toString(); });

        const setupResult = await new Promise((r) => {
          setup.on('error', (e) => r({ code: -1, err: e.message }));
          setup.on('close', (code) => r({ code }));
        });

        if (setupResult.code !== 0) {
          let hint;
          if (setupResult.code === -1 || setupResult.err?.includes('ENOENT')) {
            hint = 'bash not found — ensure Git for Windows is installed from https://git-scm.com';
          } else {
            hint = stderrBuf.trim().split('\n').slice(-1)[0] || `setup.sh exited ${setupResult.code}`;
          }
          return fail(`Setup failed: ${hint}`);
        }

        daemon.config.networkBeta = {
          ...(daemon.config.networkBeta || {}),
          version: latest,
        };
        await persistConfig();
        // Invalidate the update cache now that we've moved forward.
        networkUpdateCache = { latest, fetchedAt: Date.now() };
        daemon.networkUpdateAvailable = { latest, updateAvailable: false, installed: latest };
        daemon.broadcast({ type: 'config:updated' });
        daemon.broadcast({ type: 'network:update:available', data: daemon.networkUpdateAvailable });
        broadcastUpdateProgress('done', `Updated to ${latest}`, 100);
        daemon.audit.log('network.update', { from: current, to: latest, path: installPath });
        daemon.networkInstall = { running: false };
      } catch (err) {
        fail(err?.message || 'Update failed');
      }
    })();
  });

  // --- Wallet & earnings stubs (Base L2 — wired to real data post-mainnet) ---

  app.get('/api/network/wallet', networkGate, (req, res) => {
    res.json({ connected: false, address: null, balance: '0.00', token: 'GROOVE', chain: 'base-l2' });
  });

  app.get('/api/network/earnings', networkGate, (req, res) => {
    res.json({ today: 0, thisWeek: 0, allTime: 0, history: [], currency: 'GROOVE' });
  });

  app.post('/api/network/wallet/connect', networkGate, (req, res) => {
    res.status(501).json({ error: 'Wallet connection not yet available. Coming with mainnet launch.' });
  });

  app.get('/api/network/node/identity', networkGate, (req, res) => {
    const node = daemon.networkNode;
    res.json({
      nodeId: node?.nodeId || null,
      address: node?.nodeId || null,
      startedAt: node?.startedAt || null,
      uptime: node?.startedAt ? Math.floor((Date.now() - node.startedAt) / 1000) : 0,
    });
  });

  // Startup hook — called from index.js once the server is up. Non-blocking;
  // updates daemon.networkUpdateAvailable and broadcasts so the GUI can badge.
  daemon.checkNetworkUpdate = async function checkNetworkUpdate() {
    const hasInstall = daemon.config?.networkBeta?.installed || existsSync(resolve(networkRoot(), 'setup.sh'));
    if (!hasInstall) return;
    try {
      const latest = await getLatestNetworkTag(true);
      if (!latest) return;
      const installed = getInstalledNetworkVersion();
      const updateAvailable = !!installed && compareSemver(latest, installed) > 0;
      daemon.networkUpdateAvailable = { installed, latest, updateAvailable };
      daemon.broadcast({ type: 'network:update:available', data: daemon.networkUpdateAvailable });
    } catch { /* non-fatal */ }
  };

  // Serve GUI static files (built GUI) — no-cache headers prevent stale bundles on SSH reconnect
  const guiPath = process.env.GROOVE_GUI_PATH || resolve(__dirname, '../../gui/dist');
  app.use(express.static(guiPath, {
    etag: false,
    maxAge: 0,
    lastModified: false,
    setHeaders: (res) => {
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.set('Pragma', 'no-cache');
    },
  }));

  // SPA fallback
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.sendFile(resolve(guiPath, 'index.html'), (err) => {
      if (err) res.status(404).json({ error: 'GUI not built yet. Run: npm run build:gui' });
    });
  });
}
