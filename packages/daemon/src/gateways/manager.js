// GROOVE — Gateway Manager (Lifecycle, Event Routing, Command Dispatch)
// FSL-1.1-Apache-2.0 — see LICENSE

import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, unlinkSync } from 'fs';
import { resolve } from 'path';
import { randomUUID } from 'crypto';
import { eventToSummary, agentListText, statusText, approvalsText, teamsText, schedulesText, truncate, formatTokens } from './formatter.js';

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

// Commands that require 'full' permission (mutate state)
const WRITE_COMMANDS = new Set(['spawn', 'kill', 'approve', 'reject', 'rotate']);
// Commands allowed in 'read-only' mode
const READ_COMMANDS = new Set(['status', 'agents', 'teams', 'schedules', 'help']);

export class GatewayManager {
  constructor(daemon) {
    this.daemon = daemon;
    this.gatewaysDir = resolve(daemon.grooveDir, 'gateways');
    mkdirSync(this.gatewaysDir, { recursive: true });
    this.gateways = new Map(); // id -> gateway instance
    this._coalesceTimers = new Map(); // eventType -> { timer, events[] }
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

  _cmdKill(args) {
    if (args.length === 0) return { text: 'Usage: /kill <agent-id>' };
    const id = args[0];
    this.daemon.processes.kill(id);
    return { text: `\u26d4 Killed agent ${id}` };
  }

  _cmdApprove(args) {
    if (args.length === 0) return { text: 'Usage: /approve <approval-id>' };
    this.daemon.supervisor.approve(args[0]);
    return { text: `\u2705 Approved: ${args[0]}` };
  }

  _cmdReject(args) {
    if (args.length === 0) return { text: 'Usage: /reject <approval-id> [reason]' };
    const reason = args.slice(1).join(' ') || undefined;
    this.daemon.supervisor.reject(args[0], reason);
    return { text: `\u274c Rejected: ${args[0]}${reason ? ` — ${reason}` : ''}` };
  }

  async _cmdRotate(args) {
    if (args.length === 0) return { text: 'Usage: /rotate <agent-id>' };
    await this.daemon.rotator.rotate(args[0]);
    return { text: `\u{1f504} Rotating agent ${args[0]}...` };
  }

  _cmdTeams() {
    const teams = this.daemon.teams.list();
    return { text: teamsText(teams) };
  }

  _cmdSchedules() {
    const schedules = this.daemon.scheduler.list();
    return { text: schedulesText(schedules) };
  }

  _cmdHelp() {
    return {
      text: [
        'Groove Commands:',
        '/status — daemon status + active agents',
        '/agents — list all agents',
        '/spawn <role> [--name X] [--prompt "Y"] — spawn agent',
        '/kill <id> — kill agent',
        '/approve <id> — approve pending request',
        '/reject <id> [reason] — reject request',
        '/rotate <id> — rotate agent context',
        '/teams — list teams',
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
