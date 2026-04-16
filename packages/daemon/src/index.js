// GROOVE Daemon — Entry Point
// FSL-1.1-Apache-2.0 — see LICENSE

import { createServer as createHttpServer } from 'http';
import { createServer as createNetServer } from 'net';
import { execFileSync } from 'child_process';
import { resolve } from 'path';
import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync, readdirSync, rmdirSync, rmSync, statSync } from 'fs';
import express from 'express';
import { WebSocketServer } from 'ws';
import { Registry } from './registry.js';
import { createApi } from './api.js';
import { ProcessManager } from './process.js';
import { StateManager } from './state.js';
import { Introducer } from './introducer.js';
import { LockManager } from './lockmanager.js';
import { Supervisor } from './supervisor.js';
import { Journalist } from './journalist.js';
import { TokenTracker } from './tokentracker.js';
import { Rotator } from './rotator.js';
import { AdaptiveThresholds } from './adaptive.js';
import { Teams } from './teams.js';
import { CredentialStore } from './credentials.js';
import { TaskClassifier } from './classifier.js';
import { ModelRouter } from './router.js';
import { ProjectManager } from './pm.js';
import { CodebaseIndexer } from './indexer.js';
import { AuditLogger } from './audit.js';
import { Federation } from './federation.js';
import { SkillStore } from './skills.js';
import { IntegrationStore } from './integrations.js';
import { Scheduler } from './scheduler.js';
import { FileWatcher } from './filewatcher.js';
import { TimelineTracker } from './timeline.js';
import { MemoryStore } from './memory.js';
import { TerminalManager } from './terminal-pty.js';
import { GatewayManager } from './gateways/manager.js';
import { McpManager } from './mcp-manager.js';
import { TunnelManager } from './tunnel-manager.js';
import { ModelManager } from './model-manager.js';
import { LlamaServerManager } from './llama-server.js';
import { RepoImporter } from './repo-import.js';
import { Toys } from './toys.js';
import { isFirstRun, runFirstTimeSetup, loadConfig, saveConfig, printWelcome } from './firstrun.js';

const DEFAULT_PORT = 31415;
const DEFAULT_HOST = '127.0.0.1';

export { loadConfig, saveConfig } from './firstrun.js';

/**
 * Resolve the --host value to a bind address.
 * - 'tailscale' → auto-detect via `tailscale ip -4`
 * - '0.0.0.0' / '::' → rejected (security policy)
 * - anything else → used as-is
 */
function resolveHost(host) {
  if (!host || host === 'localhost') return DEFAULT_HOST;

  // Block direct internet exposure
  if (host === '0.0.0.0' || host === '::') {
    console.error('\n  Direct internet exposure not supported.');
    console.error('  Use `groove connect` (SSH tunnel) or `--host tailscale` instead.\n');
    process.exit(1);
  }

  // Auto-detect Tailscale IP
  if (host === 'tailscale') {
    try {
      const ip = execFileSync('tailscale', ['ip', '-4'], {
        encoding: 'utf8',
        timeout: 5000,
      }).trim().split('\n')[0];
      if (!ip) throw new Error('empty response');
      return ip;
    } catch (err) {
      console.error('\n  Could not detect Tailscale IP.');
      console.error('  Make sure Tailscale is installed and running: `tailscale status`');
      console.error(`  Error: ${err.message}\n`);
      process.exit(1);
    }
  }

  return host;
}

export class Daemon {
  constructor(options = {}) {
    this.port = options.port !== undefined ? options.port : (parseInt(process.env.GROOVE_PORT, 10) || DEFAULT_PORT);
    this.host = resolveHost(options.host);
    this.projectDir = options.projectDir || process.cwd();
    this.grooveDir = options.grooveDir || resolve(this.projectDir, '.groove');
    this.pidFile = resolve(this.grooveDir, 'daemon.pid');

    // Ensure .groove directories exist
    mkdirSync(resolve(this.grooveDir, 'logs'), { recursive: true });
    mkdirSync(resolve(this.grooveDir, 'context'), { recursive: true });

    // Initialize coordination file for agent knock protocol
    const coordPath = resolve(this.grooveDir, 'coordination.md');
    if (!existsSync(coordPath)) {
      writeFileSync(coordPath, '# GROOVE Coordination\n\n*Agents write their intent here before shared/destructive actions.*\n\n<!-- No active operations -->\n');
    }

    // First-run detection
    this._firstRun = isFirstRun(this.grooveDir);
    if (this._firstRun) {
      this.config = runFirstTimeSetup(this.grooveDir);
    } else {
      this.config = loadConfig(this.grooveDir);
    }

    // Initialize core components
    this.state = new StateManager(this.grooveDir);
    this.registry = new Registry(this.state);
    this.locks = new LockManager(this.grooveDir);
    this.tokens = new TokenTracker(this.grooveDir);
    this.memory = new MemoryStore(this.grooveDir);
    this.timeline = new TimelineTracker(this);
    this.processes = new ProcessManager(this);
    this.introducer = new Introducer(this);
    this.supervisor = new Supervisor(this);
    this.journalist = new Journalist(this);
    this.rotator = new Rotator(this);
    this.adaptive = new AdaptiveThresholds(this.grooveDir);
    this.teams = new Teams(this);
    this.credentials = new CredentialStore(this.grooveDir);
    this.classifier = new TaskClassifier();
    this.router = new ModelRouter(this);
    this.pm = new ProjectManager(this);
    this.indexer = new CodebaseIndexer(this);
    this.audit = new AuditLogger(this.grooveDir);
    this.federation = new Federation(this);
    this.skills = new SkillStore(this);
    this.integrations = new IntegrationStore(this);
    this.scheduler = new Scheduler(this);
    this.fileWatcher = new FileWatcher(this);
    this.terminalManager = new TerminalManager(this);
    this.gateways = new GatewayManager(this);
    this.modelManager = new ModelManager(this);
    this.llamaServer = new LlamaServerManager(this);
    this.mcpManager = new McpManager(this);
    this.tunnelManager = new TunnelManager(this);
    this.repoImporter = new RepoImporter(this);
    this.toys = new Toys(this);

    // Subscription state (populated by Electron IPC or direct auth)
    this.authToken = null;
    this.subscriptionCache = { plan: 'community', status: 'none', features: [], active: false, validatedAt: 0 };

    // HTTP + WebSocket server
    this.app = express();
    this.server = createHttpServer(this.app);

    const verifyOrigin = (req) => {
      const origin = req.headers.origin;
      if (!origin) return true;
      try {
        const url = new URL(origin);
        if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return true;
        if (this.host !== DEFAULT_HOST && url.hostname === this.host) return true;
      } catch { /* invalid origin */ }
      return false;
    };

    this.wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
    this.federationWss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });

    this.server.on('upgrade', (req, socket, head) => {
      if (!verifyOrigin(req) && !req.url?.startsWith('/ws/federation')) {
        socket.destroy();
        return;
      }
      if (req.url?.startsWith('/ws/federation')) {
        const daemonId = req.headers['x-groove-daemonid'];
        const signatureHeader = req.headers['x-groove-signature'] || '';
        const callerIp = req.socket?.remoteAddress?.replace('::ffff:', '') || '';
        if (!daemonId) { socket.destroy(); return; }
        this.federationWss.handleUpgrade(req, socket, head, (ws) => {
          this.federation.handleWsUpgrade(ws, daemonId, callerIp, signatureHeader);
        });
      } else {
        this.wss.handleUpgrade(req, socket, head, (ws) => {
          this.wss.emit('connection', ws, req);
        });
      }
    });

    // Wire up API routes
    createApi(this.app, this);

    // Enrich agent list with live quality + efficiency scores for GUI
    const enrichAgents = (agents) => agents.map((a) => {
      const enriched = { ...a };
      try {
        const events = this.classifier.agentWindows[a.id] || [];
        if (events.length >= 6) {
          const signals = this.adaptive.extractSignals(events, a.scope);
          const score = signals ? this.adaptive.scoreSession(signals) : null;
          if (score != null) enriched.qualityScore = score;
        }
      } catch { /* classifier/adaptive may not be ready */ }
      try {
        const td = this.tokens.getAgent(a.id);
        const total = (td.cacheReadTokens || 0) + (td.cacheCreationTokens || 0) + (td.inputTokens || 0);
        if (total > 0) enriched.efficiency = Math.round(((td.cacheReadTokens || 0) / total) * 100);
      } catch { /* token tracker may not have data */ }
      return enriched;
    });

    // Debounced file I/O for registry changes (at most once per 2s)
    let _registryIoTimer = null;
    const _debouncedRegistryIo = () => {
      if (_registryIoTimer) return;
      _registryIoTimer = setTimeout(() => {
        _registryIoTimer = null;
        this.introducer.writeRegistryFile(this.projectDir);
        this.introducer.injectGrooveSection(this.projectDir);
      }, 2000);
    };

    // Single unified registry change listener (broadcast + file I/O + coordination)
    this.registry.on('change', (delta) => {
      if (delta && delta.removed) {
        this.broadcast({ type: 'state:delta', data: { changed: [], removed: delta.removed } });
      } else if (delta && delta.changed) {
        const changedAgents = delta.changed
          .map((id) => this.registry.get(id))
          .filter(Boolean);
        this.broadcast({ type: 'state:delta', data: { changed: enrichAgents(changedAgents), removed: [] } });
      } else {
        // Fallback: full state broadcast
        this.broadcast({ type: 'state', data: enrichAgents(this.registry.getAll()) });
      }
      _debouncedRegistryIo();
      this.teams.onAgentChange();
      this.supervisor.checkQcThreshold();
    });

    // Send full state to new WebSocket clients + handle editor messages
    this.wss.on('connection', (ws) => {
      ws.send(JSON.stringify({
        type: 'state',
        data: enrichAgents(this.registry.getAll()),
      }));

      // Track which files this client is watching (for cleanup on disconnect)
      const watchedFiles = new Set();

      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw);

          // Validate message type against whitelist
          const VALID_WS_TYPES = new Set([
            'terminal:spawn', 'terminal:resize', 'terminal:input', 'terminal:close', 'terminal:kill', 'terminal:rename',
            'editor:watch', 'editor:unwatch', 'editor:save',
            'ping'
          ]);
          if (!msg || typeof msg !== 'object' || !VALID_WS_TYPES.has(msg.type)) return;
          if (Object.hasOwn(msg, '__proto__') || Object.hasOwn(msg, 'constructor')) return;

          switch (msg.type) {
            // File editor
            case 'editor:watch':
              if (msg.path && typeof msg.path === 'string' && !msg.path.includes('..')) {
                this.fileWatcher.watch(msg.path); watchedFiles.add(msg.path);
              }
              break;
            case 'editor:unwatch':
              if (msg.path) { this.fileWatcher.unwatch(msg.path); watchedFiles.delete(msg.path); }
              break;
            // Terminal
            case 'terminal:spawn': {
              if (msg.cwd !== undefined && (typeof msg.cwd !== 'string' || msg.cwd.includes('..'))) break;
              if (msg.cols !== undefined && (typeof msg.cols !== 'number' || msg.cols < 1 || msg.cols > 500)) break;
              if (msg.rows !== undefined && (typeof msg.rows !== 'number' || msg.rows < 1 || msg.rows > 200)) break;
              try {
                const id = this.terminalManager.spawn(ws, { cwd: msg.cwd, cols: msg.cols, rows: msg.rows });
                ws.send(JSON.stringify({ type: 'terminal:spawned', id }));
              } catch (err) {
                console.error('[terminal] spawn error:', err);
                ws.send(JSON.stringify({ type: 'terminal:error', message: err.message }));
              }
              break;
            }
            case 'terminal:input':
              if (msg.id && msg.data) this.terminalManager.write(msg.id, msg.data);
              break;
            case 'terminal:resize':
              if (msg.id && msg.rows && msg.cols) this.terminalManager.resize(msg.id, msg.rows, msg.cols);
              break;
            case 'terminal:kill':
              if (msg.id) this.terminalManager.kill(msg.id);
              break;
            case 'terminal:rename':
              if (msg.id && typeof msg.label === 'string') {
                if (this.terminalManager.rename(msg.id, msg.label)) {
                  this.broadcast({ type: 'terminal:renamed', id: msg.id, label: msg.label });
                }
              }
              break;
          }
        } catch { /* ignore malformed messages */ }
      });

      ws.on('close', () => {
        for (const path of watchedFiles) {
          this.fileWatcher.unwatch(path);
        }
        this.terminalManager.cleanupClient(ws);
      });
    });
  }

  broadcast(message) {
    if (!this.wss) return;
    const payload = JSON.stringify(message);
    for (const client of this.wss.clients) {
      if (client.readyState === 1) {
        client.send(payload);
      }
    }
  }

  async setAuthToken(token) {
    this.authToken = token;
    if (token) {
      await this._pollSubscription();
      // Fallback: if external API failed, try syncing from stored user data
      if (!this.subscriptionCache?.active) {
        this.skills?._syncSubscriptionCache(this.skills?.getUser());
      }
    } else {
      this.subscriptionCache = { plan: 'community', status: 'none', features: [], active: false, validatedAt: Date.now() };
      this.broadcast({ type: 'subscription:updated', data: this.subscriptionCache });
    }
  }

  async _pollSubscription() {
    if (!this.authToken) return;
    const API_BASE = 'https://docs.groovedev.ai/api/v1';
    const delays = [0, 5000, 15000, 30000];
    for (let attempt = 0; attempt < delays.length; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, delays[attempt]));
      try {
        const resp = await fetch(`${API_BASE}/subscription/status`, {
          headers: { 'Authorization': `Bearer ${this.authToken}` },
          signal: AbortSignal.timeout(10000),
        });
        if (resp.status === 401) {
          this.subscriptionCache = { plan: 'community', status: 'none', features: [], active: false, validatedAt: Date.now() };
          this.broadcast({ type: 'subscription:updated', data: this.subscriptionCache });
          this.broadcast({ type: 'auth:expired' });
          return;
        }
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        this.subscriptionCache = {
          plan: data.plan || 'community',
          status: data.status || 'none',
          features: data.features || [],
          active: data.status === 'active' || data.status === 'trialing',
          seats: data.seats || 1,
          periodEnd: data.periodEnd || null,
          cancelAtPeriodEnd: data.cancelAtPeriodEnd || false,
          validatedAt: Date.now(),
        };
        this.broadcast({ type: 'subscription:updated', data: this.subscriptionCache });
        return;
      } catch (err) {
        if (attempt < delays.length - 1) {
          console.log(`[Groove:Subscription] Attempt ${attempt + 1} failed, retrying in ${delays[attempt + 1] / 1000}s...`);
          continue;
        }
        if (this.subscriptionCache?.validatedAt && (Date.now() - this.subscriptionCache.validatedAt < 72 * 3600 * 1000)) {
          console.log('[Groove:Subscription] External API unreachable, keeping cached subscription');
          return;
        }
        this.subscriptionCache = { plan: 'community', status: 'none', features: [], active: false, validatedAt: 0 };
        this.broadcast({ type: 'subscription:updated', data: this.subscriptionCache });
      }
    }
  }

  async start() {
    // Kill any existing daemon on our port
    if (existsSync(this.pidFile)) {
      const existingPid = parseInt(readFileSync(this.pidFile, 'utf8'), 10);
      try {
        process.kill(existingPid, 0); // Signal 0 = check if alive
        console.log(`  Stopping previous daemon (PID ${existingPid})...`);
        process.kill(existingPid, 'SIGTERM');
        // Wait briefly for clean shutdown
        await new Promise((r) => setTimeout(r, 1000));
        try { process.kill(existingPid, 'SIGKILL'); } catch { /* already dead */ }
      } catch {
        // PID file is stale
      }
      try { unlinkSync(this.pidFile); } catch { /* ignore */ }
    }

    // Auto-find an open port if the default is taken
    const bindHost = this.host;
    const checkPort = (port) => new Promise((res) => {
      const tester = createNetServer();
      tester.once('error', () => res(false));
      tester.once('listening', () => { tester.close(); res(true); });
      tester.listen(port, bindHost);
    }).catch(() => false);

    if (!(await checkPort(this.port))) {
      // Wait for port release (e.g., after groove stop)
      let retries = 5;
      while (retries > 0 && !(await checkPort(this.port))) {
        await new Promise((r) => setTimeout(r, 1000));
        retries--;
      }
    }

    if (!(await checkPort(this.port))) {
      const originalPort = this.port;
      // Try next 10 ports
      let found = false;
      for (let i = 1; i <= 10; i++) {
        if (await checkPort(this.port + i)) {
          this.port = this.port + i;
          found = true;
          break;
        }
      }
      if (!found) {
        console.error(`\n  Ports ${originalPort}-${originalPort + 10} are all in use. Free one and try again.\n`);
        process.exit(1);
      }
    }

    // Restore persisted state
    this.state.load();
    this.registry.restore(this.state.get('agents') || []);

    // Purge file-scope locks for agents that didn't survive the restart
    const runningIds = this.registry.getAll().filter(a => a.status === 'running').map(a => a.id);
    const purged = this.locks.purgeOrphans(runningIds);
    if (purged > 0) console.log(`  Purged ${purged} orphaned lock(s) from previous session`);

    // Migrate old agents without teamId to default team
    this.teams.migrateAgents();

    return new Promise((resolvePromise) => {
      this.server.listen(this.port, this.host, () => {
        // Read back actual port (critical for port 0 / dynamic allocation)
        this.port = this.server.address().port;
        writeFileSync(this.pidFile, String(process.pid));
        // Write actual port and host so CLI can find us
        writeFileSync(resolve(this.grooveDir, 'daemon.port'), String(this.port));
        writeFileSync(resolve(this.grooveDir, 'daemon.host'), this.host);

        printWelcome(this.port, this.host, this._firstRun);

        // Start background services
        this.journalist.start();
        this.rotator.start();
        this.scheduler.start();
        this.timeline.start();
        this.gateways.start();
        this.federation.initialize();
        this._startGarbageCollector();

        // Restore auth token from stored config so subscription polling works after restart
        const storedToken = this.skills.getToken();
        if (storedToken) {
          this.authToken = storedToken;
          this._pollSubscription().catch(() => {});
        }

        // Re-validate subscription every 30 minutes
        this._subscriptionPollInterval = setInterval(() => {
          this._pollSubscription().catch(() => {});
        }, 30 * 60 * 1000);

        // Classifier broadcasting — batched into a single message per interval
        // Also bridges classifier tier changes to the router for mid-session suggestions
        this._classifierInterval = setInterval(() => {
          try {
            const updates = this.classifier.getUpdates();
            if (updates.length > 0) {
              this.broadcast({ type: 'classifier:batch', data: updates });
              // Bridge: feed tier changes to router for auto-mode agents
              for (const update of updates) {
                const agent = this.registry.get(update.agentId);
                if (agent && this.router.getMode(agent.id).mode === 'auto') {
                  const rec = this.router.recommend(agent.id);
                  if (rec && rec.model && rec.model.id !== agent.model) {
                    this.broadcast({ type: 'routing:suggestion', data: { agentId: agent.id, ...rec } });
                  }
                }
              }
            }
          } catch {
            // Never let classifier broadcasting break the daemon
          }
        }, 30_000);

        // Scan codebase for workspace/structure awareness
        this.indexer.scan();

        // Generate init map if none exists — baseline for all agents and journalist
        const initMapCreated = this.indexer.generateInitMap();
        if (initMapCreated) {
          console.log('[Groove] Init map generated — GROOVE_PROJECT_MAP.md');
          this.tokens.recordColdStartSkipped();
          this.audit.log('init.map', { stats: this.indexer.getStatus().stats });
        }

        // Always seed journalist from existing map so getLastSynthesis()
        // returns data on every startup (not just first run)
        this.journalist.seedFromInitMap();

        // Feed project size to token tracker for dynamic cold-start estimation
        const stats = this.indexer.getStatus().stats;
        if (stats) {
          this.tokens.setProjectStats(stats.totalFiles, stats.totalDirs);
        }

        // Auto-connect saved tunnels that have autoConnect enabled
        this.tunnelManager.init();

        resolvePromise(this);
      });
    });
  }

  _startGarbageCollector() {
    // Run once on startup, then every 24 hours
    this._gc();
    this._gcInterval = setInterval(() => this._gc(), 24 * 60 * 60 * 1000);

    // Periodic state save — crash protection (every 30s)
    this._stateSaveInterval = setInterval(async () => {
      try { this.state.set('agents', this.registry.getAll()); await this.state.save(); } catch {}
    }, 5000);
  }

  _gc() {
    const { grooveDir } = this;
    let cleaned = 0;

    try {
      // Build set of agent names still in the registry — never remove their logs
      const activeNames = new Set(this.registry.getAll().map((a) => a.name));

      // 1. Clean raw log files for agents no longer in the registry
      const logsDir = resolve(grooveDir, 'logs');
      if (existsSync(logsDir)) {
        for (const file of readdirSync(logsDir)) {
          const agentName = file.replace(/\.log$/, '');
          if (activeNames.has(agentName)) continue;
          try { unlinkSync(resolve(logsDir, file)); cleaned++; } catch { /* skip */ }
        }
      }

      // 2. Clean GROOVE_AGENT_LOGS/ for agents no longer in the registry
      const agentLogsDir = resolve(this.projectDir, 'GROOVE_AGENT_LOGS');
      if (existsSync(agentLogsDir)) {
        for (const dir of readdirSync(agentLogsDir, { withFileTypes: true })) {
          if (!dir.isDirectory()) continue;
          if (activeNames.has(dir.name)) continue;
          try { rmSync(resolve(agentLogsDir, dir.name), { recursive: true }); cleaned++; } catch { /* skip */ }
        }
        // Remove GROOVE_AGENT_LOGS/ itself if empty
        try { if (readdirSync(agentLogsDir).length === 0) rmdirSync(agentLogsDir); } catch { /* skip */ }
      }

      // 3. Clean stale recommended-team.json from daemon dir (not working dirs — those are user-managed)
      //    Only clean if no planner agent is currently running
      const hasPlanner = this.registry.getAll().some((a) => a.role === 'planner' && (a.status === 'running' || a.status === 'starting'));
      if (!hasPlanner) {
        const teamFile = resolve(grooveDir, 'recommended-team.json');
        if (existsSync(teamFile)) {
          try {
            const age = Date.now() - statSync(teamFile).mtimeMs;
            if (age > 24 * 60 * 60 * 1000) { unlinkSync(teamFile); cleaned++; } // >24h old
          } catch { /* skip */ }
        }
      }

      // 4. Prune audit log (keep last 1000 lines)
      const auditFile = resolve(grooveDir, 'audit.log');
      if (existsSync(auditFile)) {
        try {
          const lines = readFileSync(auditFile, 'utf8').split('\n');
          if (lines.length > 1000) {
            writeFileSync(auditFile, lines.slice(-1000).join('\n'));
            cleaned++;
          }
        } catch { /* skip */ }
      }

      // 5. Refresh journalist context — regenerate project map and registry
      //    so stale agent references don't persist in GROOVE_PROJECT_MAP.md
      if (cleaned > 0) {
        this.introducer.writeRegistryFile(this.projectDir);
        this.introducer.injectGrooveSection(this.projectDir);
        // Clear journalist's stale in-memory state for removed agents
        this.journalist.lastLogSizes = Object.fromEntries(
          Object.entries(this.journalist.lastLogSizes).filter(([id]) => {
            return this.registry.getAll().some((a) => a.id === id);
          })
        );
        // Re-synthesize project map based on current agents only
        this.journalist.cycle().catch(() => {});
        this.audit.log('gc.run', { cleaned });
      }
    } catch { /* gc should never crash the daemon */ }
  }

  async stop() {
    // Persist state before shutdown
    this.state.set('agents', this.registry.getAll());
    await this.state.save();

    // Stop background services
    await this.gateways.stop();
    this.journalist.stop();
    this.rotator.stop();
    this.scheduler.stop();
    this.timeline.stop();
    if (this._gcInterval) clearInterval(this._gcInterval);
    if (this._stateSaveInterval) clearInterval(this._stateSaveInterval);
    if (this._classifierInterval) clearInterval(this._classifierInterval);
    if (this._subscriptionPollInterval) clearInterval(this._subscriptionPollInterval);

    // Clean up file watchers and terminal sessions
    this.fileWatcher.unwatchAll();
    this.terminalManager.killAll();

    // Clean up federation (whitelist probing, connections, ambassadors)
    this.federation.destroy();

    // Disconnect all SSH tunnels
    this.tunnelManager.shutdown();

    // Kill all agent processes, stop MCP servers, and stop inference servers
    await this.processes.killAll();
    this.mcpManager.stopAll();
    await this.llamaServer.stopAll();

    // Clean up PID and host files
    if (existsSync(this.pidFile)) {
      unlinkSync(this.pidFile);
    }
    const hostFile = resolve(this.grooveDir, 'daemon.host');
    if (existsSync(hostFile)) {
      unlinkSync(hostFile);
    }

    // Clean up MCP config (remove groove-* entries from .mcp.json)
    this.integrations.cleanupMcpJson();

    // Clean up generated files
    const registryPath = resolve(this.projectDir, 'AGENTS_REGISTRY.md');
    if (existsSync(registryPath)) {
      unlinkSync(registryPath);
    }
    this.introducer.removeGrooveSection(this.projectDir);

    // Close server
    return new Promise((resolvePromise) => {
      this.wss.close(() => {
        this.server.close(() => {
          console.log('GROOVE daemon stopped.');
          resolvePromise();
        });
      });
    });
  }
}

// Start daemon if run directly
const isDirectRun = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isDirectRun) {
  const daemon = new Daemon();

  const shutdown = async () => {
    await daemon.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  daemon.start();
}
