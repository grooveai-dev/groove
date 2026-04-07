// GROOVE Daemon — Entry Point
// FSL-1.1-Apache-2.0 — see LICENSE

import { createServer as createHttpServer } from 'http';
import { createServer as createNetServer } from 'net';
import { execFileSync } from 'child_process';
import { resolve } from 'path';
import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync } from 'fs';
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
import { FileWatcher } from './filewatcher.js';
import { TerminalManager } from './terminal-pty.js';
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
    this.fileWatcher = new FileWatcher(this);
    this.terminalManager = new TerminalManager(this);

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

    // Broadcast registry changes over WebSocket
    this.registry.on('change', () => {
      this.broadcast({ type: 'state', data: this.registry.getAll() });
    });

    // Send full state to new WebSocket clients + handle editor messages
    this.wss.on('connection', (ws) => {
      ws.send(JSON.stringify({
        type: 'state',
        data: this.registry.getAll(),
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

        // Scan codebase for workspace/structure awareness
        this.indexer.scan();

        resolvePromise(this);
      });
    });
  }

  async stop() {
    // Persist state before shutdown
    this.state.set('agents', this.registry.getAll());
    this.state.save();

    // Stop background services
    this.journalist.stop();
    this.rotator.stop();

    // Clean up file watchers and terminal sessions
    this.fileWatcher.unwatchAll();
    this.terminalManager.killAll();

    // Kill all agent processes
    await this.processes.killAll();

    // Clean up PID and host files
    if (existsSync(this.pidFile)) {
      unlinkSync(this.pidFile);
    }
    const hostFile = resolve(this.grooveDir, 'daemon.host');
    if (existsSync(hostFile)) {
      unlinkSync(hostFile);
    }

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
