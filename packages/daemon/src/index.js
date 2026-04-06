// GROOVE Daemon — Entry Point
// FSL-1.1-Apache-2.0 — see LICENSE

import { createServer as createHttpServer } from 'http';
import { createServer as createNetServer } from 'net';
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
import { isFirstRun, runFirstTimeSetup, loadConfig, saveConfig, printWelcome } from './firstrun.js';

const DEFAULT_PORT = 31415;

export { loadConfig, saveConfig } from './firstrun.js';

export class Daemon {
  constructor(options = {}) {
    this.port = options.port !== undefined ? options.port : (parseInt(process.env.GROOVE_PORT, 10) || DEFAULT_PORT);
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
    if (isFirstRun(this.grooveDir)) {
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

    // HTTP + WebSocket server
    this.app = express();
    this.server = createHttpServer(this.app);
    this.wss = new WebSocketServer({
      server: this.server,
      maxPayload: 1024 * 1024, // 1MB max message
      verifyClient: ({ req }) => {
        const origin = req.headers.origin;
        // Allow: no origin (CLI/native clients), localhost origins
        if (!origin) return true;
        const allowed = [
          `http://localhost:${this.port}`,
          `http://127.0.0.1:${this.port}`,
          'http://localhost:3142',
        ];
        return allowed.includes(origin);
      },
    });

    // Wire up API routes
    createApi(this.app, this);

    // Broadcast registry changes over WebSocket
    this.registry.on('change', () => {
      this.broadcast({ type: 'state', data: this.registry.getAll() });
    });

    // Send full state to new WebSocket clients
    this.wss.on('connection', (ws) => {
      ws.send(JSON.stringify({
        type: 'state',
        data: this.registry.getAll(),
      }));
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
    const checkPort = (port) => new Promise((res) => {
      const tester = createNetServer();
      tester.once('error', () => res(false));
      tester.once('listening', () => { tester.close(); res(true); });
      tester.listen(port, '127.0.0.1');
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
      this.server.listen(this.port, '127.0.0.1', () => {
        writeFileSync(this.pidFile, String(process.pid));
        // Write actual port so CLI can find us (supports auto-port rotation)
        writeFileSync(resolve(this.grooveDir, 'daemon.port'), String(this.port));

        printWelcome(this.port);

        // Start background services
        this.journalist.start();
        this.rotator.start();

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

    // Kill all agent processes
    await this.processes.killAll();

    // Clean up PID file
    if (existsSync(this.pidFile)) {
      unlinkSync(this.pidFile);
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
