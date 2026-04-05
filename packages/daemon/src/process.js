// GROOVE — Agent Process Manager
// FSL-1.1-Apache-2.0 — see LICENSE

import { spawn as cpSpawn } from 'child_process';
import { createWriteStream, mkdirSync, chmodSync } from 'fs';
import { resolve } from 'path';
import { getProvider } from './providers/index.js';

function sanitizeFilename(name) {
  return String(name).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}

export class ProcessManager {
  constructor(daemon) {
    this.daemon = daemon;
    this.handles = new Map(); // agentId -> { proc, logStream }
  }

  async spawn(config) {
    const { registry, locks, introducer } = this.daemon;

    // Validate provider exists and is installed
    const provider = getProvider(config.provider || 'claude-code');
    if (!provider) {
      throw new Error(`Unknown provider: ${config.provider}`);
    }
    if (!provider.constructor.isInstalled()) {
      throw new Error(
        `${provider.constructor.displayName} is not installed. Run: ${provider.constructor.installCommand()}`
      );
    }

    // Resolve auto model routing before registering
    let resolvedModel = config.model;
    const isAutoRouted = config.model === 'auto';

    // Register the agent in the registry
    const agent = registry.add({
      ...config,
      provider: config.provider || 'claude-code',
      model: isAutoRouted ? null : config.model, // Set after routing
    });

    // Auto-route: let the router pick the model based on role/complexity
    if (isAutoRouted) {
      const { router } = this.daemon;
      router.setMode(agent.id, 'auto');
      const rec = router.recommend(agent.id);
      if (rec) {
        resolvedModel = rec.model.id;
        registry.update(agent.id, { model: resolvedModel, routingMode: 'auto', routingReason: rec.reason });
      }
    }

    // Register file locks for the agent's scope
    if (agent.scope && agent.scope.length > 0) {
      locks.register(agent.id, agent.scope);
    }

    // Generate introduction context (team awareness)
    const introContext = introducer.generateContext(agent);

    // Update AGENTS_REGISTRY.md (other agents can see this new agent)
    introducer.writeRegistryFile(this.daemon.projectDir);

    // Build spawn command from provider (use resolved model for auto-routed agents)
    const { command, args, env } = provider.buildSpawnCommand({
      ...agent,
      model: resolvedModel || agent.model,
      introContext,
    });

    // Set up log capture
    const logDir = resolve(this.daemon.grooveDir, 'logs');
    mkdirSync(logDir, { recursive: true });
    const logPath = resolve(logDir, `${sanitizeFilename(agent.name)}.log`);
    const logStream = createWriteStream(logPath, { flags: 'a', mode: 0o600 });

    // Log the spawn command (mask anything that looks like an API key)
    const maskArg = (a) => /^(sk-|AIza|key-|token-)/.test(a) ? '***' : a;
    const safeArgs = args.map((a) => maskArg(a.includes(' ') ? `"${a}"` : a));
    const spawnLine = `[${new Date().toISOString()}] GROOVE spawning: ${command} [${safeArgs.length} args]\n`;
    logStream.write(spawnLine);

    // Spawn the process
    const proc = cpSpawn(command, args, {
      cwd: agent.workingDir || this.daemon.projectDir,
      env: { ...process.env, ...env, GROOVE_AGENT_ID: agent.id, GROOVE_AGENT_NAME: agent.name },
      stdio: ['ignore', 'pipe', 'pipe'],
      // Don't let agent process prevent daemon from exiting
      detached: false,
    });

    if (!proc.pid) {
      registry.remove(agent.id);
      locks.release(agent.id);
      logStream.end();
      throw new Error(`Failed to spawn ${command} — process has no PID`);
    }

    this.handles.set(agent.id, { proc, logStream });
    registry.update(agent.id, { status: 'running', pid: proc.pid });

    // Capture stdout (stream-json from Claude Code)
    proc.stdout.on('data', (chunk) => {
      logStream.write(chunk);

      const output = provider.parseOutput(chunk.toString());
      if (output) {
        // Feed to classifier for complexity tracking (informs model routing)
        this.daemon.classifier.addEvent(agent.id, output);

        const updates = { lastActivity: new Date().toISOString() };
        if (output.tokensUsed) {
          const current = registry.get(agent.id);
          if (current) updates.tokensUsed = current.tokensUsed + output.tokensUsed;
        }
        if (output.contextUsage !== undefined) {
          updates.contextUsage = output.contextUsage;
        }
        registry.update(agent.id, updates);

        this.daemon.broadcast({
          type: 'agent:output',
          agentId: agent.id,
          data: output,
        });
      }
    });

    // Capture stderr
    proc.stderr.on('data', (chunk) => {
      logStream.write(`[stderr] ${chunk}`);
    });

    // Handle process exit
    proc.on('exit', (code, signal) => {
      const exitLine = `[${new Date().toISOString()}] Process exited: code=${code} signal=${signal}\n`;
      logStream.write(exitLine);
      logStream.end();

      this.handles.delete(agent.id);

      const finalStatus = signal === 'SIGTERM' || signal === 'SIGKILL'
        ? 'killed'
        : code === 0
          ? 'completed'
          : 'crashed';

      registry.update(agent.id, { status: finalStatus, pid: null });

      this.daemon.broadcast({
        type: 'agent:exit',
        agentId: agent.id,
        code,
        signal,
        status: finalStatus,
      });
    });

    proc.on('error', (err) => {
      logStream.write(`[error] ${err.message}\n`);
      logStream.end();

      this.handles.delete(agent.id);
      registry.update(agent.id, { status: 'crashed', pid: null });
    });

    return agent;
  }

  async kill(agentId) {
    const handle = this.handles.get(agentId);

    if (!handle) {
      // Not running — just clean up registry
      this.daemon.registry.remove(agentId);
      this.daemon.locks.release(agentId);
      return;
    }

    const { proc, logStream } = handle;

    return new Promise((resolveKill) => {
      // Give the process 5s to exit gracefully
      const forceTimer = setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch {}
      }, 5000);

      proc.on('exit', () => {
        clearTimeout(forceTimer);
        this.handles.delete(agentId);
        this.daemon.registry.remove(agentId);
        this.daemon.locks.release(agentId);
        resolveKill();
      });

      try {
        proc.kill('SIGTERM');
      } catch {
        // Already dead
        clearTimeout(forceTimer);
        this.handles.delete(agentId);
        this.daemon.registry.remove(agentId);
        this.daemon.locks.release(agentId);
        resolveKill();
      }
    });
  }

  async killAll() {
    const ids = Array.from(this.handles.keys());
    await Promise.all(ids.map((id) => this.kill(id)));
  }

  isRunning(agentId) {
    return this.handles.has(agentId);
  }

  getRunningCount() {
    return this.handles.size;
  }
}
