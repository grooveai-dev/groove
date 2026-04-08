// GROOVE — Agent Process Manager
// FSL-1.1-Apache-2.0 — see LICENSE

import { spawn as cpSpawn } from 'child_process';
import { createWriteStream, mkdirSync, chmodSync, existsSync, readFileSync, unlinkSync } from 'fs';
import { resolve } from 'path';
import { getProvider } from './providers/index.js';
import { validateAgentConfig } from './validate.js';

// Role-specific prompt prefixes — applied during spawn regardless of entry point
// (SpawnPanel, chat continue, CLI, API) for consistency
const ROLE_PROMPTS = {
  // Business roles — use MCP tools, not code
  cmo: `You are a Chief Marketing Officer agent. You have MCP integrations for communication and research. Focus on:
- Drafting and reviewing marketing content, social media posts, and campaigns
- Analyzing market trends and competitive positioning
- Managing team communications and status updates via Slack
- Researching topics using web search tools
Do NOT write code unless explicitly asked. Use your MCP tools to interact with external services.

`,
  cfo: `You are a Chief Financial Officer agent. You have MCP integrations for financial data and reporting. Focus on:
- Reviewing revenue, subscriptions, and payment data via Stripe
- Creating financial summaries and reports
- Analyzing spending patterns and forecasting
- Managing financial documents and spreadsheets
Do NOT write code unless explicitly asked. Use your MCP tools to interact with external services.

`,
  ea: `You are an Executive Assistant agent. You have MCP integrations for email, calendar, and communication. Focus on:
- Managing calendar events and scheduling meetings
- Drafting and sending emails
- Coordinating team communications via Slack
- Organizing tasks, reminders, and follow-ups
Do NOT write code unless explicitly asked. Use your MCP tools to interact with external services.

`,
  support: `You are a Customer Support agent. You have MCP integrations for communication channels. Focus on:
- Responding to customer inquiries and tickets
- Triaging and categorizing support requests
- Drafting helpful responses and knowledge base articles
- Escalating critical issues with clear summaries
Do NOT write code unless explicitly asked. Use your MCP tools to interact with external services.

`,
  analyst: `You are a Data Analyst agent. You have MCP integrations for databases and data tools. Focus on:
- Querying databases to extract insights and trends
- Creating data summaries and reports
- Identifying patterns, anomalies, and opportunities
- Presenting findings in clear, actionable format
Do NOT write code unless explicitly asked. Use your MCP tools (database queries, spreadsheets) to analyze data.

`,
  home: `You are a Smart Home automation agent. You have MCP integrations for Home Assistant. Focus on:
- Monitoring and controlling smart home devices
- Setting up automations and routines
- Reporting on device status and energy usage
- Troubleshooting connectivity and configuration issues
Do NOT write code unless explicitly asked. Use your MCP tools to interact with Home Assistant.

`,
  planner: `You are a PLANNING ONLY agent. You create plans. You do NOT write code, edit files, or run commands.

ABSOLUTE RULE: Never use the Edit, Write, or Bash tools to modify source code. You ONLY use Read, Glob, and Grep to understand the codebase, then output a written plan. If the user says "build this" or "redesign this", create a PLAN for how other agents should build it — do NOT build it yourself.

Focus on:
- Understanding requirements
- Exploring the codebase to understand current architecture
- Identifying approaches and trade-offs
- Writing structured plans with agent assignments

After completing your plan, you MUST do two things:

1. Write your team recommendation as a clear summary in your output so the user can review it.

2. Save a machine-readable team config to .groove/recommended-team.json using this EXACT format:
[
  { "role": "frontend", "phase": 1, "scope": ["src/components/**", "src/views/**"], "prompt": "Build the frontend: [specific tasks]" },
  { "role": "backend", "phase": 1, "scope": ["src/api/**", "src/server/**"], "prompt": "Build the backend: [specific tasks]" },
  { "role": "fullstack", "phase": 2, "scope": [], "prompt": "QC Senior Dev: Audit all changes from phase 1 agents. Verify correctness, fix issues, run tests, build the project, commit, and launch. Output the localhost URL." }
]

MANDATORY RULES — NEVER SKIP THESE:

1. The LAST entry in the array MUST be: { "role": "fullstack", "phase": 2, ... }
   This is the QC Senior Dev. It auto-spawns after all other agents finish.
   Its prompt: audit changes, fix issues, run tests, build, commit, launch.
   NEVER omit this agent. Every team needs a QC.

2. ALL other agents are phase: 1 — they run in parallel.

3. Do NOT tell any agent to "wait for" another agent. Phase 2 handles sequencing automatically.

4. Set appropriate scopes. Write detailed prompts so each agent knows exactly what to build.

5. If the project is a monorepo, set "workingDir" for agents that need specific subdirectories.

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

    // Clean stale recommended-team.json when spawning a new planner
    if (config.role === 'planner') {
      const dirs = [this.daemon.grooveDir];
      if (config.workingDir) dirs.push(resolve(config.workingDir, '.groove'));
      if (this.daemon.config?.defaultWorkingDir) dirs.push(resolve(this.daemon.config.defaultWorkingDir, '.groove'));
      for (const dir of dirs) {
        const p = resolve(dir, 'recommended-team.json');
        if (existsSync(p)) try { unlinkSync(p); } catch { /* */ }
      }
    }

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

    // Write MCP config for agent integrations (command/args only, no secrets)
    // Credentials are injected via process environment below
    let integrationEnv = {};
    if (config.integrations?.length > 0 && this.daemon.integrations) {
      this.daemon.integrations.writeMcpJson(config.integrations);
      integrationEnv = this.daemon.integrations.getSpawnEnv(config.integrations);
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

    // Inject API key from credential store if the provider needs one
    const providerMeta = getProvider(agent.provider);
    if (providerMeta?.constructor?.envKey) {
      const storedKey = this.daemon.credentials.getKey(agent.provider);
      if (storedKey) {
        env[providerMeta.constructor.envKey] = storedKey;
      }
    }

    // Spawn the process
    const proc = cpSpawn(command, args, {
      cwd: agent.workingDir || this.daemon.projectDir,
      env: { ...process.env, ...env, ...integrationEnv, GROOVE_AGENT_ID: agent.id, GROOVE_AGENT_NAME: agent.name },
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
        // Capture session_id for --resume support (zero cold-start continuation)
        if (output.sessionId) {
          updates.sessionId = output.sessionId;
        }
        if (output.tokensUsed !== undefined && output.tokensUsed > 0) {
          const current = registry.get(agent.id);
          if (current) {
            updates.tokensUsed = current.tokensUsed + output.tokensUsed;
            // Feed token tracker for savings calculations
            this.daemon.tokens.record(agent.id, output.tokensUsed);
          }
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

      // Refresh MCP config — remove integrations no longer needed by running agents
      if (this.daemon.integrations) {
        this.daemon.integrations.refreshMcpJson();
      }

      // Trigger journalist synthesis immediately on completion so the project
      // map is fresh for the next agent that spawns (don't wait for 120s cycle)
      if (finalStatus === 'completed' && this.daemon.journalist) {
        this.daemon.journalist.cycle().catch(() => {});
      }

      // Phase 2 auto-spawn: check if all phase 1 agents for a team are done
      this._checkPhase2(agent.id);
    });

    proc.on('error', (err) => {
      logStream.write(`[error] ${err.message}\n`);
      logStream.end();

      this.handles.delete(agent.id);
      registry.update(agent.id, { status: 'crashed', pid: null });
    });

    return agent;
  }

  /**
   * Check if a completed/crashed agent was the last phase 1 agent in a team.
   * If so, auto-spawn the phase 2 (QC/finisher) agents.
   */
  _checkPhase2(completedAgentId) {
    const pending = this.daemon._pendingPhase2;
    if (!pending || pending.length === 0) return;

    const registry = this.daemon.registry;

    for (let i = pending.length - 1; i >= 0; i--) {
      const group = pending[i];
      if (!group.waitFor.includes(completedAgentId)) continue;

      // Check if ALL phase 1 agents in this group are done
      const allDone = group.waitFor.every((id) => {
        const a = registry.get(id);
        return !a || a.status === 'completed' || a.status === 'crashed' || a.status === 'stopped' || a.status === 'killed';
      });

      if (allDone) {
        // Remove from pending
        pending.splice(i, 1);

        // Auto-spawn phase 2 agents
        for (const config of group.agents) {
          try {
            const validated = validateAgentConfig(config);
            this.spawn(validated).then((agent) => {
              this.daemon.broadcast({
                type: 'phase2:spawned',
                agentId: agent.id,
                name: agent.name,
                role: agent.role,
              });
              this.daemon.audit.log('phase2.autoSpawn', { id: agent.id, name: agent.name, role: agent.role });
            }).catch(() => {});
          } catch { /* skip invalid configs */ }
        }
      }
    }
  }

  /**
   * Resume a completed agent's session with a new message.
   * Uses --resume SESSION_ID for zero cold-start continuation.
   * Falls back to full spawn if no session ID available.
   */
  async resume(agentId, message) {
    const { registry, locks } = this.daemon;
    const agent = registry.get(agentId);
    if (!agent) throw new Error(`Agent ${agentId} not found`);

    // If no session ID, fall back to rotation (handoff brief)
    if (!agent.sessionId) {
      return this.daemon.rotator.rotate(agentId, { additionalPrompt: message });
    }

    const provider = getProvider(agent.provider || 'claude-code');
    if (!provider?.buildResumeCommand) {
      return this.daemon.rotator.rotate(agentId, { additionalPrompt: message });
    }

    // Clean up old agent entry but keep the data we need
    const config = { ...agent };
    const sessionId = agent.sessionId;

    // Kill if still running, or remove if dead
    if (this.handles.has(agentId)) {
      await this.kill(agentId);
    } else {
      locks.release(agentId);
      registry.remove(agentId);
    }

    // Build resume command
    const { command, args, env } = provider.buildResumeCommand(sessionId, message, config.model);

    // Set up log capture
    const logDir = resolve(this.daemon.grooveDir, 'logs');
    mkdirSync(logDir, { recursive: true });
    const logPath = resolve(logDir, `${sanitizeFilename(config.name)}.log`);
    const logStream = createWriteStream(logPath, { flags: 'a', mode: 0o600 });

    const resumeLine = `[${new Date().toISOString()}] GROOVE resuming session: ${command} --resume ${sessionId}\n`;
    logStream.write(resumeLine);

    // Re-register in registry with same name
    const newAgent = registry.add({
      role: config.role,
      scope: config.scope,
      provider: config.provider,
      model: config.model,
      prompt: config.prompt,
      permission: config.permission,
      workingDir: config.workingDir || this.daemon.config?.defaultWorkingDir || undefined,
      name: config.name,
    });

    // Carry cumulative tokens
    if (config.tokensUsed > 0) {
      registry.update(newAgent.id, { tokensUsed: config.tokensUsed });
    }

    // Re-register locks
    if (newAgent.scope && newAgent.scope.length > 0) {
      locks.register(newAgent.id, newAgent.scope);
    }

    // Spawn the resumed process
    const proc = cpSpawn(command, args, {
      cwd: config.workingDir || this.daemon.projectDir,
      env: { ...process.env, ...env, GROOVE_AGENT_ID: newAgent.id, GROOVE_AGENT_NAME: newAgent.name },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });

    if (!proc.pid) {
      registry.remove(newAgent.id);
      locks.release(newAgent.id);
      logStream.end();
      throw new Error(`Failed to resume — process has no PID`);
    }

    this.handles.set(newAgent.id, { proc, logStream });
    registry.update(newAgent.id, { status: 'running', pid: proc.pid });

    // Same stdout/stderr/exit handling as spawn
    proc.stdout.on('data', (chunk) => {
      logStream.write(chunk);
      const output = provider.parseOutput(chunk.toString());
      if (output) {
        this.daemon.classifier.addEvent(newAgent.id, output);
        const updates = { lastActivity: new Date().toISOString() };
        if (output.sessionId) updates.sessionId = output.sessionId;
        if (output.tokensUsed !== undefined && output.tokensUsed > 0) {
          const current = registry.get(newAgent.id);
          if (current) {
            updates.tokensUsed = current.tokensUsed + output.tokensUsed;
            this.daemon.tokens.record(newAgent.id, output.tokensUsed);
          }
        }
        if (output.contextUsage !== undefined) updates.contextUsage = output.contextUsage;
        registry.update(newAgent.id, updates);
        this.daemon.broadcast({ type: 'agent:output', agentId: newAgent.id, data: output });
      }
    });

    proc.stderr.on('data', (chunk) => { logStream.write(`[stderr] ${chunk}`); });

    proc.on('exit', (code, signal) => {
      logStream.write(`[${new Date().toISOString()}] Process exited: code=${code} signal=${signal}\n`);
      logStream.end();
      this.handles.delete(newAgent.id);
      const finalStatus = signal === 'SIGTERM' || signal === 'SIGKILL' ? 'killed' : code === 0 ? 'completed' : 'crashed';
      registry.update(newAgent.id, { status: finalStatus, pid: null });
      this.daemon.broadcast({ type: 'agent:exit', agentId: newAgent.id, code, signal, status: finalStatus });
      if (finalStatus === 'completed' && this.daemon.journalist) {
        this.daemon.journalist.cycle().catch(() => {});
      }
    });

    proc.on('error', (err) => {
      logStream.write(`[error] ${err.message}\n`);
      logStream.end();
      this.handles.delete(newAgent.id);
      registry.update(newAgent.id, { status: 'crashed', pid: null });
    });

    return newAgent;
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
