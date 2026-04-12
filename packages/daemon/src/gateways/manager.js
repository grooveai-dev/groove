// GROOVE — Gateway Manager (Lifecycle, Event Routing, Command Dispatch)
// FSL-1.1-Apache-2.0 — see LICENSE

import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, unlinkSync } from 'fs';
import { resolve } from 'path';
import { randomUUID } from 'crypto';
import { validateAgentConfig } from '../validate.js';
import { eventToSummary, agentListText, statusText, approvalsText, teamsText, schedulesText, briefText, tokensText, logText, planText, truncate, formatTokens } from './formatter.js';

const GATEWAY_TYPES = ['telegram', 'discord', 'slack'];

// Notification presets — which event types each preset includes
const PRESETS = {
  critical: new Set([
    'approval:request',
    'conflict:detected',
    // agent:exit only when crashed — handled specially in _shouldNotify
  ]),
  lifecycle: new Set([
    'approval:request',
    'conflict:detected',
    'agent:exit',
    'rotation:complete',
    'rotation:failed',
    'schedule:execute',
    'phase2:spawned',
    'qc:activated',
  ]),
  all: new Set([
    'approval:request',
    'approval:resolved',
    'conflict:detected',
    'agent:exit',
    'rotation:start',
    'rotation:complete',
    'rotation:failed',
    'schedule:execute',
    'phase2:spawned',
    'qc:activated',
    'journalist:cycle',
    'team:created',
    'team:updated',
    'team:deleted',
  ]),
};

// Events that are never forwarded (too high-frequency / GUI-only)
const NEVER_FORWARD = new Set(['state', 'agent:output', 'file:changed', 'ollama:pull:start', 'ollama:pull:progress', 'ollama:pull:complete', 'ollama:pull:error', 'terminal:output', 'terminal:spawned', 'terminal:exit', 'indexer:complete']);

const COALESCE_WINDOW = 3000; // 3 seconds
const NEVER_COALESCE = new Set(['approval:request']); // Always send immediately

// Team lead role priority — first match wins
const LEAD_PRIORITY = ['qc', 'fullstack', 'lead', 'senior', 'pm', 'planner'];

// Commands that require 'full' permission (mutate state)
const WRITE_COMMANDS = new Set(['spawn', 'kill', 'approve', 'reject', 'rotate', 'instruct', 'plan']);
// Commands allowed in 'read-only' mode
const READ_COMMANDS = new Set(['status', 'agents', 'teams', 'schedules', 'help', 'log', 'query', 'brief', 'tokens']);

export class GatewayManager {
  constructor(daemon) {
    this.daemon = daemon;
    this.gatewaysDir = resolve(daemon.grooveDir, 'gateways');
    mkdirSync(this.gatewaysDir, { recursive: true });
    this.gateways = new Map(); // id -> gateway instance
    this._coalesceTimers = new Map(); // eventType -> { timer, events[] }
    this._pendingPlans = new Map(); // agentId -> { gatewayId, timestamp }
    this._originalBroadcast = null;
    this._load();
  }

  /**
   * Start all enabled gateways and begin routing events.
   */
  async start() {
    // Wrap daemon.broadcast to intercept events for gateway routing
    this._originalBroadcast = this.daemon.broadcast.bind(this.daemon);
    this.daemon.broadcast = (message) => {
      this._originalBroadcast(message);
      this._routeEvent(message);
    };

    // Replace placeholders with real gateway instances (async imports)
    await this._materialize();

    // Connect all enabled gateways
    for (const [id, gw] of this.gateways) {
      if (gw.config.enabled && gw.connect) {
        try {
          await gw.connect();
          this.daemon.audit.log('gateway.connect', { id, type: gw.config.type });
        } catch (err) {
          console.log(`[Groove:Gateway] Failed to connect ${id}: ${err.message}`);
        }
      }
    }
  }

  /**
   * Disconnect all gateways and restore original broadcast.
   */
  async stop() {
    // Clear coalesce timers
    for (const { timer } of this._coalesceTimers.values()) {
      clearTimeout(timer);
    }
    this._coalesceTimers.clear();

    // Disconnect all gateways
    for (const [id, gw] of this.gateways) {
      if (gw.connected) {
        try {
          await gw.disconnect();
        } catch (err) {
          console.log(`[Groove:Gateway] Error disconnecting ${id}: ${err.message}`);
        }
      }
    }

    // Restore original broadcast
    if (this._originalBroadcast) {
      this.daemon.broadcast = this._originalBroadcast;
      this._originalBroadcast = null;
    }
  }

  /**
   * Create a new gateway configuration.
   */
  async create(config) {
    if (!config.type || !GATEWAY_TYPES.includes(config.type)) {
      throw new Error(`Invalid gateway type. Must be one of: ${GATEWAY_TYPES.join(', ')}`);
    }

    const id = config.id || `${config.type}-${randomUUID().slice(0, 6)}`;

    if (this.gateways.has(id)) {
      throw new Error(`Gateway already exists: ${id}`);
    }

    const gwConfig = {
      id,
      type: config.type,
      enabled: config.enabled !== false,
      chatId: config.chatId || null,
      allowedUsers: Array.isArray(config.allowedUsers) ? config.allowedUsers.map(String) : [],
      notifications: config.notifications || { preset: 'critical' },
      commandPermission: config.commandPermission === 'read-only' ? 'read-only' : 'full',
      createdAt: new Date().toISOString(),
    };

    const gw = await this._instantiate(gwConfig);
    this.gateways.set(id, gw);
    this._save(id);

    this.daemon.audit.log('gateway.create', { id, type: config.type });

    // Broadcast gateway status to GUI
    this._broadcastGatewayStatus();

    return gw.getStatus();
  }

  /**
   * Update an existing gateway configuration.
   */
  async update(id, updates) {
    const gw = this.gateways.get(id);
    if (!gw) throw new Error(`Gateway not found: ${id}`);

    const SAFE = ['enabled', 'chatId', 'allowedUsers', 'notifications', 'commandPermission'];
    let needsReconnect = false;

    for (const key of Object.keys(updates)) {
      if (SAFE.includes(key)) {
        if (key === 'allowedUsers' && Array.isArray(updates[key])) {
          gw.config[key] = updates[key].map(String);
        } else {
          gw.config[key] = updates[key];
        }
      }
    }

    // If enabled state changed, connect/disconnect
    if ('enabled' in updates) {
      if (updates.enabled && !gw.connected) {
        needsReconnect = true;
      } else if (!updates.enabled && gw.connected) {
        await gw.disconnect();
      }
    }

    this._save(id);

    if (needsReconnect) {
      try {
        await gw.connect();
      } catch (err) {
        console.log(`[Groove:Gateway] Failed to reconnect ${id}: ${err.message}`);
      }
    }

    this._broadcastGatewayStatus();
    return gw.getStatus();
  }

  /**
   * Delete a gateway.
   */
  async delete(id) {
    const gw = this.gateways.get(id);
    if (!gw) throw new Error(`Gateway not found: ${id}`);

    if (gw.connected) {
      await gw.disconnect();
    }

    // Remove credentials
    for (const ck of gw.constructor.credentialKeys) {
      try { this.daemon.credentials.deleteKey(`gateway:${id}:${ck.key}`); } catch { /* ignore */ }
    }

    this.gateways.delete(id);

    const filePath = resolve(this.gatewaysDir, `${id}.json`);
    if (existsSync(filePath)) unlinkSync(filePath);

    this.daemon.audit.log('gateway.delete', { id });
    this._broadcastGatewayStatus();
  }

  /**
   * List all gateways with their status.
   */
  list() {
    return Array.from(this.gateways.values()).map((gw) => gw.getStatus());
  }

  /**
   * Get a specific gateway's status.
   */
  get(id) {
    const gw = this.gateways.get(id);
    if (!gw) return null;
    return gw.getStatus();
  }

  /**
   * Send a test message through a gateway.
   */
  async test(id) {
    const gw = this.gateways.get(id);
    if (!gw) throw new Error(`Gateway not found: ${id}`);
    if (!gw.connected) throw new Error('Gateway is not connected');

    await gw.send('\u2705 Groove gateway connected! Notifications will appear here.');
    this.daemon.audit.log('gateway.test', { id });
    return { ok: true };
  }

  /**
   * Manually connect a gateway.
   */
  async connect(id) {
    const gw = this.gateways.get(id);
    if (!gw) throw new Error(`Gateway not found: ${id}`);
    if (gw.connected) return gw.getStatus();

    await gw.connect();
    this.daemon.audit.log('gateway.connect', { id, type: gw.config.type });
    this._broadcastGatewayStatus();
    return gw.getStatus();
  }

  /**
   * Manually disconnect a gateway.
   */
  async disconnect(id) {
    const gw = this.gateways.get(id);
    if (!gw) throw new Error(`Gateway not found: ${id}`);
    if (!gw.connected) return gw.getStatus();

    await gw.disconnect();
    this.daemon.audit.log('gateway.disconnect', { id });
    this._broadcastGatewayStatus();
    return gw.getStatus();
  }

  /**
   * Set a credential for a gateway.
   */
  setCredential(id, key, value) {
    if (!this.gateways.has(id)) throw new Error(`Gateway not found: ${id}`);
    this.daemon.credentials.setKey(`gateway:${id}:${key}`, value);
    this.daemon.audit.log('gateway.credential.set', { id, key });
  }

  /**
   * Delete a credential for a gateway.
   */
  deleteCredential(id, key) {
    if (!this.gateways.has(id)) throw new Error(`Gateway not found: ${id}`);
    this.daemon.credentials.deleteKey(`gateway:${id}:${key}`);
  }

  // -------------------------------------------------------------------
  // Command Routing — chat command → daemon internals
  // -------------------------------------------------------------------

  /**
   * Route a command from a chat gateway to the appropriate daemon method.
   * Called by BaseGateway.handleCommand() after authorization check.
   * Enforces commandPermission: 'full' (default) or 'read-only'.
   */
  async routeCommand(gateway, command, args) {
    // Permission level check
    const permission = gateway.config.commandPermission || 'full';
    if (permission === 'read-only' && WRITE_COMMANDS.has(command)) {
      return { text: `Permission denied. This gateway is read-only.\nAllowed: ${[...READ_COMMANDS].map((c) => '/' + c).join(', ')}` };
    }

    try {
      switch (command) {
        case 'status':
          return this._cmdStatus();
        case 'agents':
          return this._cmdAgents();
        case 'spawn':
          return await this._cmdSpawn(args);
        case 'kill':
          return this._cmdKill(args);
        case 'approve':
          return this._cmdApprove(args);
        case 'reject':
          return this._cmdReject(args);
        case 'rotate':
          return await this._cmdRotate(args);
        case 'teams':
          return this._cmdTeams();
        case 'schedules':
          return this._cmdSchedules();
        case 'instruct':
          return await this._cmdInstruct(args);
        case 'query':
          return await this._cmdQuery(args, gateway);
        case 'log':
          return this._cmdLog(args);
        case 'plan':
          return await this._cmdPlan(args, gateway);
        case 'brief':
          return this._cmdBrief();
        case 'tokens':
          return this._cmdTokens();
        case 'help':
          return this._cmdHelp();
        default:
          return { text: `Unknown command: /${command}\nType /help for available commands.` };
      }
    } catch (err) {
      return { text: `Error: ${err.message}` };
    }
  }

  _cmdStatus() {
    const agents = this.daemon.registry.getAll();
    const uptime = process.uptime() * 1000;
    return { text: statusText(agents, uptime) };
  }

  _cmdAgents() {
    const agents = this.daemon.registry.getAll();
    return { text: agentListText(agents) };
  }

  async _cmdSpawn(args) {
    if (args.length === 0) {
      return { text: 'Usage: /spawn <role> [--name <name>] [--prompt "task"]' };
    }

    const role = args[0];
    let name, prompt;

    // Parse --name and --prompt flags
    for (let i = 1; i < args.length; i++) {
      if (args[i] === '--name' && args[i + 1]) {
        name = args[++i];
      } else if (args[i] === '--prompt' && args[i + 1]) {
        // Collect remaining args as prompt (may be quoted)
        prompt = args.slice(i + 1).join(' ').replace(/^["']|["']$/g, '');
        break;
      }
    }

    const config = { role };
    if (name) config.name = name;
    if (prompt) config.prompt = prompt;

    const agent = await this.daemon.processes.spawn(config);
    return { text: `\u2705 Spawned ${agent.name || agent.id} (${role})` };
  }

  // -------------------------------------------------------------------
  // Team-First Resolver
  // -------------------------------------------------------------------

  /**
   * Resolve identifier to a team or agent.
   * Priority: team name → team prefix → exact agent ID → agent name → agent prefix → role
   */
  _resolveTarget(identifier) {
    const agents = this.daemon.registry.getAll();
    const teams = this.daemon.teams.list();
    const lower = identifier.toLowerCase();

    // 1. Team name (case-insensitive) — primary target
    const team = teams.find((t) => t.name.toLowerCase() === lower);
    if (team) {
      return { type: 'team', team, agents: agents.filter((a) => a.teamId === team.id) };
    }

    // 2. Team name prefix
    const teamPrefix = teams.filter((t) => t.name.toLowerCase().startsWith(lower));
    if (teamPrefix.length === 1) {
      return { type: 'team', team: teamPrefix[0], agents: agents.filter((a) => a.teamId === teamPrefix[0].id) };
    }

    // 3. Exact agent ID
    const byId = agents.find((a) => a.id === identifier);
    if (byId) return { type: 'agent', agent: byId };

    // 4. Exact agent name (case-insensitive)
    const byName = agents.find((a) => (a.name || '').toLowerCase() === lower);
    if (byName) return { type: 'agent', agent: byName };

    // 5. Agent name/ID prefix
    const byPrefix = agents.filter((a) =>
      a.id.toLowerCase().startsWith(lower) ||
      (a.name || '').toLowerCase().startsWith(lower)
    );
    if (byPrefix.length === 1) return { type: 'agent', agent: byPrefix[0] };

    // 6. Role match (only if one agent has that role)
    const byRole = agents.filter((a) => (a.role || '').toLowerCase() === lower);
    if (byRole.length === 1) return { type: 'agent', agent: byRole[0] };

    // Ambiguous
    if (byPrefix.length > 1 || teamPrefix.length > 1) {
      const names = [
        ...teamPrefix.map((t) => `team:${t.name}`),
        ...byPrefix.map((a) => a.name || a.id),
      ];
      return { type: 'ambiguous', matches: names };
    }

    return null;
  }

  /**
   * Resolve to agent only (for kill, rotate — not team-aware).
   */
  _resolveAgent(identifier) {
    const result = this._resolveTarget(identifier);
    if (!result) return { error: `Not found: ${identifier}. Try /agents or /teams.` };
    if (result.type === 'ambiguous') return { error: `Ambiguous — did you mean: ${result.matches.join(', ')}?` };
    if (result.type === 'team') return { error: `"${result.team.name}" is a team (${result.agents.length} agents). Use a specific agent name.` };
    return { agent: result.agent };
  }

  /**
   * Find the team lead — the senior agent who routes messages.
   * Priority: QC > fullstack > lead > senior > PM > planner > first running
   */
  _findTeamLead(agents) {
    const running = agents.filter((a) => a.status === 'running' || a.status === 'starting');
    if (running.length === 0) return null;
    for (const keyword of LEAD_PRIORITY) {
      const match = running.find((a) => (a.role || '').toLowerCase().includes(keyword));
      if (match) return match;
    }
    return running[0];
  }

  // -------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------

  _readAgentLog(agent, lineCount = 20) {
    const logDir = resolve(this.daemon.grooveDir, 'logs');
    const name = (agent.name || agent.id).replace(/[^a-zA-Z0-9_-]/g, '_');
    const logPath = resolve(logDir, `${name}.log`);
    if (!existsSync(logPath)) return null;
    const content = readFileSync(logPath, 'utf8');
    const allLines = content.split('\n').filter(Boolean);
    return allLines.slice(-lineCount);
  }

  /**
   * Find recommended-team.json — same logic as api.js findRecommendedTeam()
   */
  _findRecommendedTeam() {
    const agents = this.daemon.registry.getAll();
    for (const agent of agents) {
      if (agent.workingDir) {
        const p = resolve(agent.workingDir, '.groove', 'recommended-team.json');
        if (existsSync(p)) return p;
      }
    }
    const p = resolve(this.daemon.grooveDir, 'recommended-team.json');
    if (existsSync(p)) return p;
    return null;
  }

  // -------------------------------------------------------------------
  // Command Implementations
  // -------------------------------------------------------------------

  _cmdKill(args) {
    if (args.length === 0) return { text: 'Usage: /kill <agent-name>' };
    const { agent, error } = this._resolveAgent(args[0]);
    if (error) return { text: error };
    this.daemon.processes.kill(agent.id);
    return { text: `\u26d4 Killed ${agent.name || agent.id}` };
  }

  _cmdApprove(args) {
    if (args.length === 0) return { text: 'Usage: /approve <approval-id>' };
    // Check if approving a pending plan
    const planId = args[0];
    if (this._pendingPlans.has(planId)) {
      return this._launchPlan(planId);
    }
    this.daemon.supervisor.approve(args[0]);
    return { text: `\u2705 Approved: ${args[0]}` };
  }

  _cmdReject(args) {
    if (args.length === 0) return { text: 'Usage: /reject <approval-id> [reason]' };
    // Check if rejecting a pending plan
    const planId = args[0];
    if (this._pendingPlans.has(planId)) {
      this._pendingPlans.delete(planId);
      return { text: `\u274c Plan discarded.` };
    }
    const reason = args.slice(1).join(' ') || undefined;
    this.daemon.supervisor.reject(args[0], reason);
    return { text: `\u274c Rejected: ${args[0]}${reason ? ` — ${reason}` : ''}` };
  }

  async _cmdRotate(args) {
    if (args.length === 0) return { text: 'Usage: /rotate <agent-name>' };
    const { agent, error } = this._resolveAgent(args[0]);
    if (error) return { text: error };
    await this.daemon.rotator.rotate(agent.id);
    return { text: `\u{1f504} Rotating ${agent.name || agent.id}...` };
  }

  _cmdTeams() {
    const teams = this.daemon.teams.list();
    return { text: teamsText(teams) };
  }

  _cmdSchedules() {
    const schedules = this.daemon.scheduler.list();
    return { text: schedulesText(schedules) };
  }

  /**
   * Instruct a team or agent. Team-first: routes to team lead.
   */
  async _cmdInstruct(args) {
    if (args.length < 2) return { text: 'Usage: /instruct <team> <message>' };
    const target = args[0];
    const message = args.slice(1).join(' ');

    const result = this._resolveTarget(target);
    if (!result) return { text: `Not found: ${target}. Try /teams to see available teams.` };
    if (result.type === 'ambiguous') return { text: `Ambiguous — did you mean: ${result.matches.join(', ')}?` };

    // Team target — route to team lead
    if (result.type === 'team') {
      const lead = this._findTeamLead(result.agents);
      if (!lead) return { text: `No running agents in team ${result.team.name}. Use /plan to start a new project.` };

      const resumed = !!lead.sessionId;
      const newAgent = resumed
        ? await this.daemon.processes.resume(lead.id, message)
        : await this.daemon.rotator.rotate(lead.id, { additionalPrompt: message });

      this.daemon.audit.log('agent.instruct', { id: lead.id, newId: newAgent.id, resumed, source: 'gateway', team: result.team.name });
      return { text: `\u2705 Sent to ${lead.name} (${result.team.name} lead): ${truncate(message, 100)}` };
    }

    // Direct agent target (fallback)
    const agent = result.agent;
    const resumed = !!agent.sessionId;
    const newAgent = resumed
      ? await this.daemon.processes.resume(agent.id, message)
      : await this.daemon.rotator.rotate(agent.id, { additionalPrompt: message });

    this.daemon.audit.log('agent.instruct', { id: agent.id, newId: newAgent.id, resumed, source: 'gateway' });
    return { text: `\u2705 Instructed ${agent.name || agent.id}: ${truncate(message, 100)}` };
  }

  /**
   * Query a team or agent — journalist synthesis, no disruption.
   */
  async _cmdQuery(args, gateway) {
    if (args.length < 2) return { text: 'Usage: /query <team> <question>' };
    const target = args[0];
    const question = args.slice(1).join(' ');

    const result = this._resolveTarget(target);
    if (!result) return { text: `Not found: ${target}. Try /teams to see available teams.` };
    if (result.type === 'ambiguous') return { text: `Ambiguous — did you mean: ${result.matches.join(', ')}?` };

    if (result.type === 'team') {
      const active = result.agents.filter((a) => a.status === 'running' || a.status === 'completed');
      if (active.length === 0) return { text: `No active agents in team ${result.team.name}.` };

      await gateway.send(`\u{1f914} Querying team ${result.team.name} (${active.length} agents)...`).catch(() => {});

      const agentContexts = active.map((a) => {
        const activity = this.daemon.classifier?.agentWindows?.[a.id] || [];
        const recent = activity.slice(-10).map((e) => e.data || e.text || '').join('\n');
        return [
          `Agent "${a.name}" (${a.role}, ${a.status})`,
          `Scope: ${(a.scope || []).join(', ') || 'unrestricted'}`,
          a.prompt ? `Task: ${a.prompt}` : '',
          recent ? `Recent activity:\n${recent}` : '',
        ].filter(Boolean).join('\n');
      }).join('\n\n');

      const prompt = [
        `You are answering a question about team "${result.team.name}" with ${active.length} agents.`,
        `\nTeam members:\n${agentContexts}`,
        `\nUser question: ${question}`,
        '\nSynthesize a concise answer based on the team\'s collective context.',
      ].join('\n');

      const response = await this.daemon.journalist.callHeadless(prompt, { trackAs: '__gateway__' });
      return { text: `\ud83d\udcac Team ${result.team.name}:\n${truncate(response, 3000)}` };
    }

    // Single agent query
    const agent = result.agent;
    await gateway.send(`\u{1f914} Querying ${agent.name || agent.id}...`).catch(() => {});

    const activity = this.daemon.classifier?.agentWindows?.[agent.id] || [];
    const recentActivity = activity.slice(-20).map((e) => e.data || e.text || '').join('\n');

    const prompt = [
      `You are answering a question about agent "${agent.name}" (role: ${agent.role}).`,
      `File scope: ${(agent.scope || []).join(', ') || 'unrestricted'}`,
      `Provider: ${agent.provider}, Tokens used: ${agent.tokensUsed || 0}`,
      agent.prompt ? `Original task: ${agent.prompt}` : '',
      recentActivity ? `\nRecent activity:\n${recentActivity}` : '',
      `\nUser question: ${question}`,
      '\nAnswer concisely based on the agent context above.',
    ].filter(Boolean).join('\n');

    const response = await this.daemon.journalist.callHeadless(prompt, { trackAs: '__gateway__' });
    return { text: `\ud83d\udcac ${agent.name || agent.id}:\n${truncate(response, 3000)}` };
  }

  /**
   * View logs for a team or agent.
   */
  _cmdLog(args) {
    if (args.length === 0) return { text: 'Usage: /log <team> [lines]' };
    const target = args[0];
    const lineCount = Math.min(parseInt(args[1], 10) || 20, 50);

    const result = this._resolveTarget(target);
    if (!result) return { text: `Not found: ${target}. Try /teams to see available teams.` };
    if (result.type === 'ambiguous') return { text: `Ambiguous — did you mean: ${result.matches.join(', ')}?` };

    if (result.type === 'team') {
      const sections = [];
      const perAgent = Math.max(Math.floor(lineCount / Math.max(result.agents.length, 1)), 5);
      for (const agent of result.agents) {
        const lines = this._readAgentLog(agent, perAgent);
        if (lines && lines.length > 0) {
          sections.push(`\u2014 ${agent.name || agent.id} (${agent.role}) \u2014\n${lines.join('\n')}`);
        }
      }
      if (sections.length === 0) return { text: `No logs for team ${result.team.name}.` };
      return { text: `\ud83d\udccb Team ${result.team.name} logs:\n\n${sections.join('\n\n')}` };
    }

    const agent = result.agent;
    const lines = this._readAgentLog(agent, lineCount);
    if (!lines) return { text: `No log file found for ${agent.name || agent.id}.` };
    return { text: logText(agent.name || agent.id, lines) };
  }

  // -------------------------------------------------------------------
  // Plan → Approve → Build Flow
  // -------------------------------------------------------------------

  /**
   * Start a new project — spawns a planner, tracks it for gateway feedback.
   */
  async _cmdPlan(args, gateway) {
    if (args.length === 0) return { text: 'Usage: /plan <description of what to build>' };
    const description = args.join(' ');

    await gateway.send(`\u{1f4cb} Planning: ${truncate(description, 200)}\nSpawning planner agent...`).catch(() => {});

    const agent = await this.daemon.processes.spawn({
      role: 'planner',
      prompt: description,
    });

    // Track this planner so we send results back to the right gateway
    this._pendingPlans.set(agent.id, {
      gatewayId: gateway.config.id,
      description,
      timestamp: Date.now(),
    });

    this.daemon.audit.log('gateway.plan', { agentId: agent.id, source: 'gateway', gatewayId: gateway.config.id });
    return { text: `\u{1f9e0} Planner ${agent.name} is analyzing the codebase and building a team plan.\nYou'll get the plan here for approval when it's ready.` };
  }

  /**
   * Called from _routeEvent when a planner agent completes.
   * Reads recommended-team.json and sends plan to chat for approval.
   */
  _handlePlannerComplete(agentId) {
    const plan = this._pendingPlans.get(agentId);
    if (!plan) return; // Not a gateway-initiated planner

    const gw = this.gateways.get(plan.gatewayId);
    if (!gw || !gw.connected) {
      this._pendingPlans.delete(agentId);
      return;
    }

    const teamPath = this._findRecommendedTeam();
    if (!teamPath) {
      gw.send('\u274c Planner finished but no team plan was generated. Try again with a more specific description.').catch(() => {});
      this._pendingPlans.delete(agentId);
      return;
    }

    try {
      const agents = JSON.parse(readFileSync(teamPath, 'utf8'));
      if (!Array.isArray(agents) || agents.length === 0) {
        gw.send('\u274c Planner generated an empty team plan.').catch(() => {});
        this._pendingPlans.delete(agentId);
        return;
      }

      // Store the plan data for launch
      plan.agents = agents;
      plan.teamPath = teamPath;

      const summary = planText(agents, plan.description);
      const approveMsg = `\n\nApprove this plan?\n/approve ${agentId} — launch the team\n/reject ${agentId} — discard\n/plan <edits> — replan with changes`;

      gw.send(summary + approveMsg, { planId: agentId }).catch(() => {});
    } catch (err) {
      gw.send(`\u274c Error reading plan: ${err.message}`).catch(() => {});
      this._pendingPlans.delete(agentId);
    }
  }

  /**
   * Launch a team from an approved plan.
   */
  _launchPlan(planId) {
    const plan = this._pendingPlans.get(planId);
    if (!plan || !plan.agents) return { text: 'Plan not found or already launched.' };

    const agents = plan.agents;
    const defaultDir = this.daemon.config?.defaultWorkingDir || undefined;
    const defaultTeamId = this.daemon.teams.getDefault()?.id || null;

    // Separate phases
    const phase1 = agents.filter((a) => !a.phase || a.phase === 1);
    let phase2 = agents.filter((a) => a.phase === 2);

    // Auto-add QC if planner forgot
    if (phase2.length === 0 && phase1.length >= 2) {
      phase2 = [{
        role: 'fullstack', phase: 2, scope: [],
        prompt: 'QC Senior Dev: All builder agents have completed. Audit their changes for correctness, fix any issues, run tests, and verify the project builds cleanly (npm run build). Do NOT start long-running dev servers. Commit all changes.',
      }];
    }

    // Spawn phase 1
    const spawned = [];
    const phase1Ids = [];
    const spawnAll = async () => {
      for (const config of phase1) {
        try {
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
          validated.teamId = defaultTeamId;
          const agent = await this.daemon.processes.spawn(validated);
          spawned.push(agent);
          phase1Ids.push(agent.id);
        } catch (err) {
          console.log(`[Groove:Gateway] Failed to spawn ${config.role}: ${err.message}`);
        }
      }

      // Register phase 2 for auto-spawn
      if (phase2.length > 0 && phase1Ids.length > 0) {
        this.daemon._pendingPhase2 = this.daemon._pendingPhase2 || [];
        this.daemon._pendingPhase2.push({
          waitFor: phase1Ids,
          agents: phase2.map((c) => ({
            role: c.role, scope: c.scope || [], prompt: c.prompt || '',
            provider: c.provider || 'claude-code', model: c.model || 'auto',
            permission: c.permission || 'auto',
            workingDir: c.workingDir || defaultDir,
            name: c.name || undefined,
            teamId: defaultTeamId,
          })),
        });
      }

      this.daemon.audit.log('team.launch', {
        phase1: spawned.length, phase2Pending: phase2.length,
        agents: spawned.map((a) => a.role), source: 'gateway',
      });

      // Notify via gateway
      const gw = this.gateways.get(plan.gatewayId);
      if (gw?.connected) {
        const names = spawned.map((a) => `${a.name} (${a.role})`).join(', ');
        const msg = `\u{1f680} Team launched! ${spawned.length} agents building${phase2.length > 0 ? `, ${phase2.length} QC agents queued` : ''}.\n${names}`;
        gw.send(msg).catch(() => {});
      }
    };

    // Fire and forget — spawn is async but we return immediately
    spawnAll().catch((err) => console.log(`[Groove:Gateway] Launch error: ${err.message}`));
    this._pendingPlans.delete(planId);

    return { text: `\u2705 Launching team (${phase1.length} agents)...` };
  }

  // -------------------------------------------------------------------
  // Intelligence + Help
  // -------------------------------------------------------------------

  _cmdBrief() {
    const status = this.daemon.journalist.getStatus();
    const lastSynthesis = this.daemon.journalist.getLastSynthesis();
    return { text: briefText(status, lastSynthesis) };
  }

  _cmdTokens() {
    const summary = this.daemon.tokens.getSummary();
    return { text: tokensText(summary) };
  }

  _cmdHelp() {
    return {
      text: [
        'Groove Commands:',
        '',
        'Talk to Teams:',
        '/instruct <team> <message> — send to team lead',
        '/query <team> <question> — ask without disrupting work',
        '/log <team> [lines] — view team logs',
        '/plan <description> — plan + build a new project',
        '',
        'Fleet:',
        '/status — daemon status + active agents',
        '/agents — list all agents',
        '/teams — list teams',
        '/spawn <role> [--name X] [--prompt "Y"] — manual spawn',
        '/kill <name> — kill agent',
        '/rotate <name> — rotate agent context',
        '',
        'Intelligence:',
        '/brief — journalist project summary',
        '/tokens — token usage + savings',
        '',
        'Workflow:',
        '/approve <id> — approve plan or request',
        '/reject <id> [reason] — reject plan or request',
        '/schedules — list schedules',
        '/help — this message',
      ].join('\n'),
    };
  }

  // -------------------------------------------------------------------
  // Event Routing — daemon broadcast → gateway notifications
  // -------------------------------------------------------------------

  /**
   * Route a daemon broadcast event to all connected gateways.
   */
  _routeEvent(message) {
    if (!message || !message.type) return;
    if (NEVER_FORWARD.has(message.type)) return;

    // Intercept planner completions for the plan→approve→build flow
    if (message.type === 'agent:exit' && message.status === 'completed' && message.agentId) {
      this._handlePlannerComplete(message.agentId);
    }

    for (const gw of this.gateways.values()) {
      if (!gw.connected || !gw.config.enabled) continue;
      if (!this._shouldNotify(gw, message)) continue;

      // Coalesce or send immediately
      if (NEVER_COALESCE.has(message.type)) {
        this._sendEvent(gw, message);
      } else {
        this._coalesceEvent(gw, message);
      }
    }
  }

  /**
   * Check if a gateway should receive this event based on notification preferences.
   */
  _shouldNotify(gw, message) {
    const prefs = gw.config.notifications || { preset: 'critical' };

    // Custom per-event overrides take priority
    if (prefs.custom && message.type in prefs.custom) {
      return prefs.custom[message.type];
    }

    // Use preset
    const preset = PRESETS[prefs.preset || 'critical'];
    if (!preset) return false;

    // Special case: 'critical' preset only wants crashed agent:exit
    if (prefs.preset === 'critical' && message.type === 'agent:exit') {
      return message.status === 'crashed';
    }

    return preset.has(message.type);
  }

  /**
   * Format and send an event notification to a gateway.
   */
  _sendEvent(gw, message) {
    const text = eventToSummary(message);
    if (!text) return;

    const options = {};

    // Add inline action buttons for approval requests (platform-specific)
    if (message.type === 'approval:request' && message.data?.id) {
      options.approvalId = message.data.id;
    }

    gw.send(text, options).catch((err) => {
      console.log(`[Groove:Gateway] Send failed (${gw.config.id}): ${err.message}`);
    });
  }

  /**
   * Coalesce rapid events of the same type within a time window.
   */
  _coalesceEvent(gw, message) {
    const key = `${gw.config.id}:${message.type}`;
    let bucket = this._coalesceTimers.get(key);

    if (!bucket) {
      bucket = { events: [], timer: null };
      this._coalesceTimers.set(key, bucket);
    }

    bucket.events.push(message);

    // Reset the flush timer
    if (bucket.timer) clearTimeout(bucket.timer);
    bucket.timer = setTimeout(() => {
      this._flushCoalesced(gw, key, bucket.events);
      this._coalesceTimers.delete(key);
    }, COALESCE_WINDOW);
  }

  /**
   * Flush coalesced events — send as a single batch message.
   */
  _flushCoalesced(gw, key, events) {
    if (events.length === 0) return;

    if (events.length === 1) {
      this._sendEvent(gw, events[0]);
      return;
    }

    // Batch: summarize multiple events of the same type
    const type = events[0].type;
    let text;

    switch (type) {
      case 'agent:exit': {
        const groups = {};
        for (const e of events) {
          const s = e.status || 'unknown';
          if (!groups[s]) groups[s] = [];
          groups[s].push(e.agentId || 'unknown');
        }
        const parts = Object.entries(groups).map(([s, ids]) => `${ids.length} ${s}: ${ids.join(', ')}`);
        text = `\u{1f4cb} Agent updates — ${parts.join(' | ')}`;
        break;
      }
      case 'conflict:detected':
        text = `\u26a0\ufe0f ${events.length} scope conflicts detected`;
        break;
      default: {
        // Generic batch: send summaries joined
        const summaries = events.map(eventToSummary).filter(Boolean);
        text = summaries.join('\n');
        break;
      }
    }

    if (text) {
      gw.send(text).catch((err) => {
        console.log(`[Groove:Gateway] Batch send failed (${gw.config.id}): ${err.message}`);
      });
    }
  }

  // -------------------------------------------------------------------
  // Gateway Status Broadcast to GUI
  // -------------------------------------------------------------------

  _broadcastGatewayStatus() {
    if (this._originalBroadcast) {
      this._originalBroadcast({
        type: 'gateway:status',
        data: this.list(),
      });
    }
  }

  // -------------------------------------------------------------------
  // Instantiation & Persistence
  // -------------------------------------------------------------------

  /**
   * Dynamically instantiate a gateway by type.
   */
  async _instantiate(config) {
    switch (config.type) {
      case 'telegram': {
        const { TelegramGateway } = await import('./telegram.js');
        return new TelegramGateway(this.daemon, config);
      }
      case 'discord': {
        try {
          const { DiscordGateway } = await import('./discord.js');
          return new DiscordGateway(this.daemon, config);
        } catch (err) {
          if (err.code === 'ERR_MODULE_NOT_FOUND') {
            throw new Error('Discord gateway requires discord.js. Install with: npm i discord.js');
          }
          throw err;
        }
      }
      case 'slack': {
        try {
          const { SlackGateway } = await import('./slack.js');
          return new SlackGateway(this.daemon, config);
        } catch (err) {
          if (err.code === 'ERR_MODULE_NOT_FOUND') {
            throw new Error('Slack gateway requires @slack/bolt. Install with: npm i @slack/bolt');
          }
          throw err;
        }
      }
      default:
        throw new Error(`Unknown gateway type: ${config.type}`);
    }
  }

  _save(id) {
    const gw = this.gateways.get(id);
    if (!gw) return;
    const filePath = resolve(this.gatewaysDir, `${id}.json`);
    writeFileSync(filePath, JSON.stringify(gw.config, null, 2));
  }

  _load() {
    if (!existsSync(this.gatewaysDir)) return;
    for (const file of readdirSync(this.gatewaysDir)) {
      if (!file.endsWith('.json')) continue;
      try {
        const config = JSON.parse(readFileSync(resolve(this.gatewaysDir, file), 'utf8'));
        const id = config.id || file.replace('.json', '');
        config.id = id;
        // Synchronous load — use TelegramGateway directly for known types
        // Dynamic import is async, so we defer connection to start()
        this._instantiateSync(config);
      } catch (err) {
        console.log(`[Groove:Gateway] Failed to load ${file}: ${err.message}`);
      }
    }
  }

  /**
   * Synchronous instantiation for load-time (before start).
   * Only Telegram is guaranteed available (no external deps).
   * Discord/Slack will be instantiated in start() if their deps are present.
   */
  _instantiateSync(config) {
    // Store config for deferred async instantiation in start()
    // Use a placeholder that holds config but isn't connected
    const placeholder = {
      config,
      connected: false,
      constructor: { type: config.type, displayName: config.type, credentialKeys: [] },
      getStatus() {
        return {
          id: config.id,
          type: config.type,
          displayName: config.type,
          connected: false,
          enabled: config.enabled,
          chatId: config.chatId || null,
          notifications: config.notifications || { preset: 'critical' },
          allowedUsers: (config.allowedUsers || []).length,
          pending: true, // Not yet fully instantiated
        };
      },
    };
    this.gateways.set(config.id, placeholder);
  }

  /**
   * Called during start() to replace placeholders with real gateway instances.
   */
  async _materialize() {
    for (const [id, entry] of this.gateways) {
      if (entry.pending || !entry.connect) {
        try {
          const gw = await this._instantiate(entry.config);
          this.gateways.set(id, gw);
        } catch (err) {
          console.log(`[Groove:Gateway] Failed to instantiate ${id}: ${err.message}`);
          this.gateways.delete(id);
        }
      }
    }
  }
}
