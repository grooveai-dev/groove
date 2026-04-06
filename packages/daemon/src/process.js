// GROOVE — Agent Process Manager
// FSL-1.1-Apache-2.0 — see LICENSE

import { spawn as cpSpawn } from 'child_process';
import { createWriteStream, mkdirSync, chmodSync } from 'fs';
import { resolve } from 'path';
import { getProvider } from './providers/index.js';

// Role-specific prompt prefixes — applied during spawn regardless of entry point
// (SpawnPanel, chat continue, CLI, API) for consistency
const ROLE_PROMPTS = {
  planner: `You are a planning and architecture agent. Research, analyze, and create plans — do NOT implement code unless explicitly asked. Focus on:
- Understanding requirements
- Exploring the codebase
- Identifying approaches and trade-offs
- Writing structured plans

After completing your plan, you MUST do two things:

1. Write your team recommendation as a clear summary in your output so the user can review it.

2. Save a machine-readable team config to .groove/recommended-team.json using this EXACT format:
[
  { "role": "fullstack", "scope": [], "prompt": "Set up project infrastructure: package.json, tsconfig, vite config, dependencies. Once all other agents finish, audit and QC their work, fix any issues, then launch the dev server. Output the localhost URL where the app can be accessed." },
  { "role": "backend", "scope": ["src/api/**", "src/server/**", "src/db/**", "src/lib/**"], "prompt": "Build the backend: [specific tasks from your plan]" },
  { "role": "frontend", "scope": ["src/components/**", "src/views/**", "src/pages/**", "src/styles/**"], "prompt": "Build the frontend: [specific tasks from your plan]" }
]

Include only the agents needed. Set appropriate scopes for each role. Write detailed prompts based on your plan so each agent knows exactly what to build.

Always include a fullstack agent. Its job: set up infrastructure first, then after all other agents finish, audit their work, fix issues, build the project, launch the dev server, and output the localhost URL so the user can immediately see the result. Include testing/devops only if the project needs them.

IMPORTANT: Do not use markdown formatting like ** or ### in your output. Write in plain text with clean formatting. Use line breaks, dashes, and indentation for structure.

`,
};

// Permission-level prompt instructions
// "auto" = PM reviews risky ops via API. "full" = no reviews, max speed.
const PERMISSION_PROMPTS = {
  auto: null,       // Populated at spawn time with the actual port
  supervised: null,  // Maps to auto (supervised removed — too expensive)
};

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

    // Pre-spawn task negotiation — if same-role agents are running,
    // query them about current work so the new agent gets a clear assignment
    const sameRole = registry.getAll().filter(
      (a) => a.role === config.role && a.id !== agent.id &&
        (a.status === 'running' || a.status === 'starting')
    );
    let taskNegotiation = '';
    if (sameRole.length > 0) {
      taskNegotiation = await this.negotiateTaskSplit(agent, sameRole);
    }

    // Generate introduction context (team awareness + negotiation)
    const introContext = introducer.generateContext(agent, { taskNegotiation });

    // Update AGENTS_REGISTRY.md (other agents can see this new agent)
    introducer.writeRegistryFile(this.daemon.projectDir);

    // Build spawn command from provider (use resolved model for auto-routed agents)
    const spawnConfig = {
      ...agent,
      model: resolvedModel || agent.model,
      introContext,
    };

    // Apply role-specific prompt prefix so agents always get their role constraints
    const rolePrompt = ROLE_PROMPTS[agent.role];
    if (rolePrompt && spawnConfig.prompt) {
      if (spawnConfig.prompt.startsWith('# Agent Handoff Brief')) {
        spawnConfig.prompt += '\n\n## Role Constraints\n\n' + rolePrompt.trim();
      } else {
        spawnConfig.prompt = rolePrompt + 'Task: ' + spawnConfig.prompt;
      }
    }

    // Apply PM review instructions for Auto permission mode
    // Agents call the PM endpoint before risky operations for AI review
    const permission = config.permission || 'full';
    if (permission === 'auto' || permission === 'supervised') {
      const port = this.daemon.port || 31415;
      const pmPrompt = `## PM Review (Auto Mode)

Before performing risky operations — creating NEW files, deleting files, modifying package.json or config files, or running destructive commands — get PM approval first:

\`\`\`bash
curl -s http://localhost:${port}/api/pm/review -X POST -H 'Content-Type: application/json' -d '{"agent":"${agent.name}","action":"ACTION","file":"FILE_PATH","description":"BRIEF_REASON"}'
\`\`\`

If response says \`"approved":false\`, adjust your approach based on the reason.
For normal file edits within your scope, proceed without review.

`;
      if (spawnConfig.prompt.startsWith('# Agent Handoff Brief')) {
        spawnConfig.prompt += '\n\n' + pmPrompt.trim();
      } else {
        spawnConfig.prompt = pmPrompt + spawnConfig.prompt;
      }
    }

    const { command, args, env } = provider.buildSpawnCommand(spawnConfig);

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
        if (output.tokensUsed !== undefined && output.tokensUsed > 0) {
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

      // Trigger journalist synthesis immediately on completion so the project
      // map is fresh for the next agent that spawns (don't wait for 120s cycle)
      if (finalStatus === 'completed' && this.daemon.journalist) {
        this.daemon.journalist.cycle().catch(() => {});
      }
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

  /**
   * Query existing same-role agents to negotiate task division.
   * Uses a headless Claude call to ask what they're doing and what's left.
   * Falls back to raw file/activity data if headless call fails.
   */
  async negotiateTaskSplit(newAgent, existingAgents) {
    const { journalist } = this.daemon;

    // Gather each existing agent's work context
    const agentSummaries = existingAgents.map((a) => {
      const files = journalist.getAgentFiles(a);
      const result = journalist.getAgentResult(a);
      return { name: a.name, files, result: result.slice(0, 1500) };
    });

    // Build negotiation prompt
    const agentDetails = agentSummaries.map((a) =>
      `**${a.name}:**\n` +
      `- Files modified: ${a.files.join(', ') || 'none yet'}\n` +
      `- Status: ${a.result || 'still working, no output yet'}`
    ).join('\n\n');

    const prompt = [
      `You are a GROOVE task coordinator. A new agent "${newAgent.name}" (role: ${newAgent.role}) is joining the team.`,
      ``,
      `These agents are already working in the same role:`,
      ``,
      agentDetails,
      ``,
      `Analyze what each agent is working on and suggest a clear task division for the new agent.`,
      `Be specific: list which files/features the new agent should focus on, and which to avoid.`,
      `Keep it concise — 5-10 lines max.`,
    ].join('\n');

    try {
      const response = await journalist.callHeadless(prompt);
      return response;
    } catch {
      // Fallback: return raw data for the agent to interpret
      return agentSummaries.map((a) =>
        `${a.name} is working on: ${a.files.join(', ') || 'unknown'}`
      ).join('\n');
    }
  }
}
