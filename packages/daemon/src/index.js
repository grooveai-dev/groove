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
import { ModelManager } from './model-manager.js';
import { LlamaServerManager } from './llama-server.js';
import { RepoImporter } from './repo-import.js';
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
    this.repoImporter = new RepoImporter(this);

    // HTTP + WebSocket server
    this.app = express();
    this.server = createHttpServer(this.app);
    this.wss = new WebSocketServer({
      server: this.server,
      maxPayload: 1024 * 1024, // 1MB max message
      verifyClient: ({ req }) => {
        const origin = req.headers.origin;
        // Allow: no origin (CLI/native clients)
        if (!origin) return true;
        try {
          const url = new URL(origin);
          // Allow any localhost origin (any port — tunnels change the port)
          if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return true;
          // Allow the bound interface (for Tailscale/LAN access)
          if (this.host !== DEFAULT_HOST && url.hostname === this.host) return true;
        } catch { /* invalid origin */ }
        return false;
      },
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

    // Broadcast registry changes over WebSocket
    this.registry.on('change', () => {
      this.broadcast({ type: 'state', data: enrichAgents(this.registry.getAll()) });
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
          switch (msg.type) {
            // File editor
            case 'editor:watch':
              if (msg.path) { this.fileWatcher.watch(msg.path); watchedFiles.add(msg.path); }
              break;
            case 'editor:unwatch':
              if (msg.path) { this.fileWatcher.unwatch(msg.path); watchedFiles.delete(msg.path); }
              break;
            // Terminal
            case 'terminal:spawn': {
              const id = this.terminalManager.spawn(ws, { cwd: msg.cwd, cols: msg.cols, rows: msg.rows });
              ws.send(JSON.stringify({ type: 'terminal:spawned', id }));
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

    // Auto-update AGENTS_REGISTRY.md and CLAUDE.md GROOVE section on changes
    this.registry.on('change', () => {
      this.introducer.writeRegistryFile(this.projectDir);
      this.introducer.injectGrooveSection(this.projectDir);
      this.teams.onAgentChange();
      this.supervisor.checkQcThreshold();
    });
  }

  broadcast(message) {
    const payload = JSON.stringify(message);
    for (const client of this.wss.clients) {
      if (client.readyState === 1) {
        client.send(payload);
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

    // Migrate old agents without teamId to default team
    this.teams.migrateAgents();

    return new Promise((resolvePromise) => {
      this.server.listen(this.port, this.host, () => {
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
        this._startGarbageCollector();

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

        resolvePromise(this);
      });
    });
  }

  _startGarbageCollector() {
    // Run once on startup, then every 24 hours
    this._gc();
    this._gcInterval = setInterval(() => this._gc(), 24 * 60 * 60 * 1000);
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
    this.state.save();

    // Stop background services
    await this.gateways.stop();
    this.journalist.stop();
    this.rotator.stop();
    this.scheduler.stop();
    this.timeline.stop();
    if (this._gcInterval) clearInterval(this._gcInterval);

    // Clean up file watchers and terminal sessions
    this.fileWatcher.unwatchAll();
    this.terminalManager.killAll();

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
