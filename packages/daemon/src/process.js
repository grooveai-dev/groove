// GROOVE — Agent Process Manager
// FSL-1.1-Apache-2.0 — see LICENSE

import { spawn as cpSpawn } from 'child_process';
import { createWriteStream, mkdirSync, chmodSync, existsSync, readFileSync, unlinkSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { getProvider, getInstalledProviders } from './providers/index.js';
import { AgentLoop } from './agent-loop.js';
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
  creative: `You are a Creative Writing agent. You produce professional written content — copy, articles, scripts, proposals, briefs, and documentation. Focus on:
- Writing clear, compelling, well-structured content
- Adapting tone and style to the audience (formal, conversational, technical, marketing)
- Editing and polishing drafts for grammar, flow, and impact
- Researching topics to produce accurate, substantive writing
You CAN use code tools to create and edit text files, markdown documents, and structured content. For best results, apply a writing skill from the Marketplace that matches your task.

`,
  slides: `You are a Slide Deck agent. You build presentation decks as HTML slides (Reveal.js) with optional PPTX export. Focus on:
- Creating clean, professional slide layouts with strong visual hierarchy
- Structuring content into clear sections with concise bullet points
- Building responsive HTML slides that look polished in the browser
- Generating a slides.json data file alongside HTML for PPTX conversion
For best results, apply a slide deck skill from the Marketplace. The skill provides templates, styling, and export automation.

`,
  home: `You are a Smart Home automation agent. You have MCP integrations for Home Assistant. Focus on:
- Monitoring and controlling smart home devices
- Setting up automations and routines
- Reporting on device status and energy usage
- Troubleshooting connectivity and configuration issues
Do NOT write code unless explicitly asked. Use your MCP tools to interact with Home Assistant.

`,
  planner: `You are a PLANNING ONLY agent. You create plans and route work to your team. You do NOT write code, edit files, or run commands.

ABSOLUTE RULE: Never use the Edit, Write, or Bash tools to modify source code. You ONLY use Read, Glob, and Grep to understand the codebase, then output a written plan. If the user says "build this" or "redesign this", create a PLAN for how other agents should build it — do NOT build it yourself.

YOU HAVE TWO MODES:

MODE 1 — TEAM CREATION (first time, no team exists yet):
Explore the codebase thoroughly, understand the architecture, then recommend a team structure.

MODE 2 — TASK ROUTING (team already exists):
Check AGENTS_REGISTRY.md or .groove/recommended-team.json to see your existing team.
Do NOT re-explore the entire codebase. You already know it from team creation.
Just read the specific files related to the bug/feature, decide which existing agent should handle it, and write the routing config. This should be FAST — under 5 tool calls.

HOW TO DETECT WHICH MODE:
- Read AGENTS_REGISTRY.md. If it lists agents with roles matching your team (frontend, backend, fullstack), you are in MODE 2.
- If no agents exist or only a planner exists, you are in MODE 1.

After completing your plan, you MUST write .groove/recommended-team.json — EVERY TIME, no exceptions.

For MODE 1 (team creation):
{
  "agents": [
    { "role": "frontend", "phase": 1, "scope": ["src/components/**", "src/views/**"], "prompt": "Build the frontend: [specific tasks]" },
    { "role": "backend", "phase": 1, "scope": ["src/api/**", "src/server/**"], "prompt": "Build the backend: [specific tasks]" },
    { "role": "fullstack", "phase": 2, "scope": [], "prompt": "QC Senior Dev: Audit all changes from phase 1 agents. Verify correctness, fix issues, run tests, build the project, commit, and launch. Output the localhost URL." }
  ]
}

For MODE 2 (task routing to existing team):
Only include the agents that need to do work. Use their EXISTING role — the system will find and reuse them.
{
  "agents": [
    { "role": "frontend", "phase": 1, "prompt": "Fix the bug: [specific description with file paths and what to change]" }
  ]
}
Do NOT include QC/fullstack in the JSON for task routing — the system auto-triggers the existing QC when work completes.
Do NOT include agents that have no work to do.
Do NOT invent new agent names or roles — use the existing team's roles exactly.

For NEW projects (team creation only):
Include "projectDir" with a short kebab-case directory name. All agents spawn inside it.
For EXISTING codebases: Do NOT include "projectDir".

MANDATORY RULES:

1. For team creation: the LAST entry MUST be { "role": "fullstack", "phase": 2 } — the QC agent.
   For task routing: do NOT include the QC — it auto-triggers.

2. ALL phase 1 agents run in parallel. Do NOT tell agents to wait for each other.

3. If the user gave a specific task, write detailed prompts with file paths and what to change.
   If no task was given, use empty prompts ("prompt": "") — agents will await instructions.

4. NEVER create new agent names or custom roles. Use the standard roles: frontend, backend, fullstack.

5. NEVER instruct agents to delete files from other projects or clean up unrelated code.

6. You MUST always write .groove/recommended-team.json. NEVER skip it.

7. In MODE 2, be FAST. Read only the files needed to understand the specific task. Do not re-analyze the full codebase.

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

    // Resolve provider — auto-detect best installed if not specified
    let providerName = config.provider;
    if (!providerName) {
      const installed = getInstalledProviders();
      if (installed.length === 0) {
        throw new Error('No AI providers installed. Install Claude Code, Gemini CLI, Codex, or Ollama first.');
      }
      // Priority: claude-code > gemini > codex > local (local replaces ollama in UI)
      const priority = ['claude-code', 'gemini', 'codex', 'local', 'ollama'];
      const best = priority.find((p) => installed.some((i) => i.id === p)) || installed[0].id;
      providerName = best;
    }

    const provider = getProvider(providerName);
    if (!provider) {
      throw new Error(`Unknown provider: ${providerName}`);
    }
    if (!provider.constructor.isInstalled()) {
      const installed = getInstalledProviders();
      if (installed.length > 0) {
        throw new Error(
          `${provider.constructor.displayName} is not installed. Available providers: ${installed.map((p) => p.name).join(', ')}`
        );
      }
      throw new Error(
        `${provider.constructor.displayName} is not installed. Run: ${provider.constructor.installCommand()}`
      );
    }

    // Resolve auto model routing before registering
    // Treat missing/null/empty model as 'auto' — GUI sends empty string for "Auto" option
    let resolvedModel = config.model;
    const isAutoRouted = !config.model || config.model === 'auto';

    // Register the agent in the registry
    const agent = registry.add({
      ...config,
      provider: providerName,
      model: isAutoRouted ? null : config.model, // Set after routing
    });

    // Auto-route: let the router pick the model based on role/complexity
    if (isAutoRouted) {
      const { router } = this.daemon;
      router.setMode(agent.id, 'auto');
      const rec = router.recommend(agent.id);
      if (rec?.model?.id) {
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

    // Track cold-start savings — agent gets context from planner/journalist/team
    // instead of exploring the codebase from scratch
    const otherAgents = registry.getAll().filter((a) => a.id !== agent.id);
    const hasTeamContext = otherAgents.length > 0;
    const hasJournalistContext = this.daemon.journalist?.getLastSynthesis()?.projectMap;
    if (hasTeamContext || hasJournalistContext) {
      this.daemon.tokens.recordColdStartSkipped();
    }

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
    if (rolePrompt) {
      if (!spawnConfig.prompt) {
        spawnConfig.prompt = rolePrompt + `IMPORTANT: No task has been assigned yet. You MUST wait for the user to tell you what to do.

Do NOT:
- Start building, coding, or creating anything
- Continue or improve previous agents' work
- Treat the project map or existing files as your task
- Analyze the codebase proactively

DO: Introduce yourself in one sentence and ask the user what they would like you to work on. Then wait.`;
      } else if (spawnConfig.prompt.startsWith('# Agent Handoff Brief')) {
        spawnConfig.prompt += '\n\n## Role Constraints\n\n' + rolePrompt.trim();
      } else {
        spawnConfig.prompt = rolePrompt + 'Task: ' + spawnConfig.prompt;
      }
    } else if (!spawnConfig.prompt) {
      spawnConfig.prompt = `You are a ${agent.role} agent.

IMPORTANT: No task has been assigned yet. You MUST wait for the user to tell you what to do. Do NOT start building, coding, or continuing previous work. Do NOT treat existing files or the project map as your task. Introduce yourself in one sentence and ask the user what they would like you to work on. Then wait.`;
    }

    // Inject skill content into the prompt
    if (config.skills?.length > 0 && this.daemon.skills) {
      const skillSections = [];
      for (const skillId of config.skills) {
        const content = this.daemon.skills.getContent(skillId);
        if (content) {
          skillSections.push(`## Skill: ${skillId}\n\n${content}`);
        }
      }
      if (skillSections.length > 0) {
        spawnConfig.prompt += '\n\n' + skillSections.join('\n\n');
      }
    }

    // Apply PM review instructions for Auto permission mode
    // Agents call the PM endpoint before risky operations for AI review
    // Skip for sandboxed providers (Codex) — localhost is unreachable from their sandbox
    const permission = config.permission || 'full';
    const sandboxedProviders = ['codex'];
    if ((permission === 'auto' || permission === 'supervised') && !sandboxedProviders.includes(providerName)) {
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

    // Set up log capture (shared between CLI and agent loop paths)
    const logDir = resolve(this.daemon.grooveDir, 'logs');
    mkdirSync(logDir, { recursive: true });
    const logPath = resolve(logDir, `${sanitizeFilename(agent.name)}.log`);
    const logStream = createWriteStream(logPath, { flags: 'a', mode: 0o600 });

    // ─── Agent Loop path (local models with built-in agentic runtime) ───
    if (provider.constructor.useAgentLoop) {
      const loopConfig = provider.getLoopConfig(spawnConfig);
      logStream.write(`[${new Date().toISOString()}] GROOVE agent-loop: model=${loopConfig.model} api=${loopConfig.apiBase}\n`);

      const loop = new AgentLoop({ daemon: this.daemon, agent, loopConfig, logStream });
      this.handles.set(agent.id, { loop, logStream });
      registry.update(agent.id, { status: 'running' });

      // Record spawn lifecycle event
      if (this.daemon.timeline) {
        this.daemon.timeline.recordEvent('spawn', {
          agentId: agent.id, agentName: agent.name, role: agent.role,
          provider: agent.provider, model: loopConfig.model,
        });
      }

      // Wire output events — ProcessManager handles subsystem feeding + GUI broadcast
      loop.on('output', (output) => {
        this._handleAgentOutput(agent.id, output);
      });

      // Wire exit — same lifecycle as CLI agents (timeline, broadcast, journalist, phase2)
      loop.on('exit', ({ code, signal, status }) => {
        logStream.write(`[${new Date().toISOString()}] Agent loop exited: status=${status}\n`);
        logStream.end();
        this.handles.delete(agent.id);
        registry.update(agent.id, { status, pid: null });

        if (this.daemon.timeline) {
          const agentData = registry.get(agent.id);
          const evtType = status === 'completed' ? 'complete' : status === 'crashed' ? 'crash' : 'kill';
          this.daemon.timeline.recordEvent(evtType, {
            agentId: agent.id, agentName: agent.name, role: agent.role,
            finalTokens: agentData?.tokensUsed || 0, costUsd: agentData?.costUsd || 0,
          });
        }

        this.daemon.broadcast({ type: 'agent:exit', agentId: agent.id, code: code || 0, signal, status });
        if (this.daemon.integrations) this.daemon.integrations.refreshMcpJson();
        if (status === 'completed' && this.daemon.journalist) this.daemon.journalist.cycle().catch(() => {});
        this._checkPhase2(agent.id);

        // Auto-trigger idle QC + process cross-scope handoffs
        if (status === 'completed') {
          const files = this.daemon.journalist?.getAgentFiles(agent) || [];
          if (files.length > 0) this._triggerIdleQC(agent);
          this._processHandoffs(agent);
        }
      });

      // Wire errors — broadcast to GUI for display
      loop.on('error', ({ message }) => {
        this.daemon.broadcast({
          type: 'agent:output', agentId: agent.id,
          data: { type: 'activity', subtype: 'error', data: message },
        });
      });

      // Start the agent loop with the fully assembled prompt
      loop.start(spawnConfig.prompt);
      return agent;
    }

    // ─── CLI Spawn path (Claude Code, Codex, Gemini, Ollama CLI) ────────

    // Write MCP config for agent integrations (command/args only, no secrets)
    // Credentials are injected via process environment below
    let integrationEnv = {};
    if (config.integrations?.length > 0 && this.daemon.integrations) {
      this.daemon.integrations.writeMcpJson(config.integrations);
      integrationEnv = this.daemon.integrations.getSpawnEnv(config.integrations);
    }

    const spawnCmd = provider.buildSpawnCommand(spawnConfig);
    const { command, args, env, stdin: stdinData } = spawnCmd;

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

    // Spawn the process (use pipe for stdin if provider needs to send prompt via stdin)
    const proc = cpSpawn(command, args, {
      cwd: agent.workingDir || this.daemon.projectDir,
      env: { ...process.env, ...env, ...integrationEnv, GROOVE_AGENT_ID: agent.id, GROOVE_AGENT_NAME: agent.name },
      stdio: [stdinData ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      detached: false,
    });

    // Write prompt via stdin if provider requested it (e.g., Ollama avoids arg length limits)
    if (stdinData && proc.stdin) {
      proc.stdin.write(stdinData);
      proc.stdin.end();
    }

    if (!proc.pid) {
      registry.remove(agent.id);
      locks.release(agent.id);
      logStream.end();
      throw new Error(`Failed to spawn ${command} — process has no PID`);
    }

    this.handles.set(agent.id, { proc, logStream });
    registry.update(agent.id, { status: 'running', pid: proc.pid });

    // Record spawn lifecycle event for timeline
    if (this.daemon.timeline) {
      this.daemon.timeline.recordEvent('spawn', {
        agentId: agent.id, agentName: agent.name, role: agent.role,
        provider: agent.provider, model: agent.model,
      });
    }

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
            // Feed token tracker with full breakdown for savings calculations
            this.daemon.tokens.record(agent.id, {
              tokens: output.tokensUsed,
              inputTokens: output.inputTokens,
              outputTokens: output.outputTokens,
              cacheReadTokens: output.cacheReadTokens,
              cacheCreationTokens: output.cacheCreationTokens,
              model: output.model,
              estimatedCostUsd: output.estimatedCostUsd,
            });
            // Feed router cost log for tier tracking
            const tier = this.daemon.classifier.classify(agent.id);
            this.daemon.router.recordUsage(agent.id, output.model || current.model, output.tokensUsed, tier);
          }
        }
        // Record session result data (cost, duration, turns)
        if (output.type === 'result') {
          this.daemon.tokens.recordResult(agent.id, {
            costUsd: output.cost, durationMs: output.duration, turns: output.turns,
          });
          const resultUpdates = {};
          if (output.cost) resultUpdates.costUsd = (registry.get(agent.id)?.costUsd || 0) + output.cost;
          if (output.duration) resultUpdates.durationMs = output.duration;
          if (output.turns) resultUpdates.turns = output.turns;
          if (Object.keys(resultUpdates).length > 0) registry.update(agent.id, resultUpdates);
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

    // Capture stderr — collect for crash reporting
    const stderrBuf = [];
    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      logStream.write(`[stderr] ${text}`);
      stderrBuf.push(text);
      // Keep last 2KB of stderr for crash reporting
      while (stderrBuf.join('').length > 2048) stderrBuf.shift();
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

      // Capture crash error from stderr for UI display
      const crashError = finalStatus === 'crashed' ? stderrBuf.join('').trim().slice(-500) : null;

      registry.update(agent.id, { status: finalStatus, pid: null });

      // Record lifecycle event for timeline
      if (this.daemon.timeline) {
        const agentData = registry.get(agent.id);
        this.daemon.timeline.recordEvent(finalStatus === 'completed' ? 'complete' : finalStatus === 'crashed' ? 'crash' : 'kill', {
          agentId: agent.id, agentName: agent.name, role: agent.role,
          finalTokens: agentData?.tokensUsed || 0, costUsd: agentData?.costUsd || 0,
          exitCode: code,
        });
      }

      this.daemon.broadcast({
        type: 'agent:exit',
        agentId: agent.id,
        code,
        signal,
        status: finalStatus,
        error: crashError || undefined,
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

      // Auto-trigger idle QC: if this agent modified files and there's an idle QC
      // in the same team, activate it to verify the changes
      if (finalStatus === 'completed') {
        const files = this.daemon.journalist?.getAgentFiles(agent) || [];
        if (files.length > 0) this._triggerIdleQC(agent);
        // Process cross-scope handoff requests from this agent
        this._processHandoffs(agent);
      }
    });

    proc.on('error', (err) => {
      logStream.write(`[error] ${err.message}\n`);
      logStream.end();

      this.handles.delete(agent.id);
      registry.update(agent.id, { status: 'crashed', pid: null });
      this.daemon.broadcast({
        type: 'agent:exit',
        agentId: agent.id,
        code: null,
        signal: null,
        status: 'crashed',
        error: err.message,
      });
    });

    return agent;
  }

  /**
   * Shared output handler for agent loop events.
   * Feeds registry, token tracker, classifier, router, and broadcasts to GUI.
   */
  _handleAgentOutput(agentId, output) {
    const { registry, tokens, classifier, router } = this.daemon;
    const agent = registry.get(agentId);
    if (!agent) return;

    // Feed classifier for complexity tracking (informs model routing)
    classifier.addEvent(agentId, output);

    const updates = { lastActivity: new Date().toISOString() };

    // Token tracking — feed subsystems with full breakdown
    if (output.tokensUsed !== undefined && output.tokensUsed > 0) {
      updates.tokensUsed = agent.tokensUsed + output.tokensUsed;
      tokens.record(agentId, {
        tokens: output.tokensUsed,
        inputTokens: output.inputTokens,
        outputTokens: output.outputTokens,
        cacheReadTokens: output.cacheReadTokens,
        cacheCreationTokens: output.cacheCreationTokens,
        model: output.model,
        estimatedCostUsd: output.estimatedCostUsd,
      });
      const tier = classifier.classify(agentId);
      router.recordUsage(agentId, output.model || agent.model, output.tokensUsed, tier);
    }

    // Session result data (cost, duration, turns)
    if (output.type === 'result') {
      tokens.recordResult(agentId, {
        costUsd: output.cost, durationMs: output.duration, turns: output.turns,
      });
      if (output.cost) updates.costUsd = (agent.costUsd || 0) + output.cost;
      if (output.duration) updates.durationMs = output.duration;
      if (output.turns) updates.turns = output.turns;
    }

    // Context window usage (0-1 scale) — drives rotation threshold
    if (output.contextUsage !== undefined) {
      updates.contextUsage = output.contextUsage;
    }

    // Session ID for resume support
    if (output.sessionId) {
      updates.sessionId = output.sessionId;
    }

    registry.update(agentId, updates);
    this.daemon.broadcast({ type: 'agent:output', agentId, data: output });
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

        // Check if phase 1 agents did any real work by looking at file modifications.
        // If no agent modified any files, there's nothing to QC.
        const journalist = this.daemon.journalist;
        const phase1Idle = group.waitFor.every((id) => {
          const a = registry.get(id);
          if (!a) return true;
          const files = journalist?.getAgentFiles(a) || [];
          return files.length === 0;
        });

        // Auto-spawn phase 2 agents — if phase 1 was idle, clear the prompt
        // so QC also waits for instructions instead of auditing nothing
        for (const config of group.agents) {
          if (phase1Idle) config.prompt = '';
          try {
            const validated = validateAgentConfig(config);
            if (!validated.teamId) validated.teamId = this.daemon.teams.getDefault()?.id || null;
            this.spawn(validated).then((agent) => {
              this.daemon.broadcast({
                type: 'phase2:spawned',
                agentId: agent.id,
                name: agent.name,
                role: agent.role,
              });
              this.daemon.audit.log('phase2.autoSpawn', { id: agent.id, name: agent.name, role: agent.role });
            }).catch((err) => {
              console.error(`[Groove] Phase 2 spawn failed for ${config.role}: ${err.message}`);
              this.daemon.broadcast({
                type: 'phase2:failed',
                role: config.role,
                error: err.message,
              });
            });
          } catch (err) {
            console.error(`[Groove] Phase 2 config invalid for ${config.role}: ${err.message}`);
            this.daemon.broadcast({
              type: 'phase2:failed',
              role: config.role,
              error: err.message,
            });
          }
        }
      }
    }
  }

  /**
   * Auto-trigger an idle QC agent in the same team when a teammate completes real work.
   * "Idle" = running fullstack agent that hasn't modified any files yet.
   */
  _triggerIdleQC(completedAgent) {
    const registry = this.daemon.registry;
    if (!completedAgent.teamId) return;

    // Find a running fullstack/QC agent in the same team that's idle (no files modified)
    const journalist = this.daemon.journalist;
    const qc = registry.getAll().find((a) =>
      a.id !== completedAgent.id &&
      a.teamId === completedAgent.teamId &&
      a.role === 'fullstack' &&
      a.status === 'running' &&
      (journalist?.getAgentFiles(a) || []).length === 0
    );
    if (!qc) return;

    // Gather context about what the completed agent did
    const files = this.daemon.journalist?.getAgentFiles(completedAgent) || [];
    const result = this.daemon.journalist?.getAgentResult(completedAgent) || '';
    const fileList = files.length > 0 ? `\nFiles modified: ${files.slice(0, 20).join(', ')}` : '';

    const message = `Your teammate ${completedAgent.name} (${completedAgent.role}) just finished their work.${fileList}${result ? `\n\nTheir summary:\n${result.slice(0, 2000)}` : ''}\n\nPlease audit their changes: verify correctness, check for bugs, run tests if available, and report any issues.`;

    // Send message to the QC agent via the instruct flow
    this.sendMessage(qc.id, message).catch((err) => {
      console.error(`[Groove] QC auto-trigger failed: ${err.message}`);
    });

    this.daemon.audit.log('qc.autoTrigger', {
      qcId: qc.id, qcName: qc.name,
      triggeredBy: completedAgent.name, role: completedAgent.role,
    });
    this.daemon.broadcast({
      type: 'qc:triggered',
      qcId: qc.id, qcName: qc.name,
      triggeredBy: completedAgent.name,
    });
  }

  /**
   * Process handoff files in .groove/handoffs/.
   * Agents write handoff requests when they need cross-scope work from a teammate.
   * File name = target role (e.g., backend.md). Content = what to do.
   */
  _processHandoffs(sourceAgent) {
    const handoffsDir = resolve(this.daemon.grooveDir, 'handoffs');
    if (!existsSync(handoffsDir)) return;

    const registry = this.daemon.registry;
    let files;
    try { files = readdirSync(handoffsDir); } catch { return; }

    for (const file of files) {
      if (!file.endsWith('.md')) continue;
      const targetRole = file.replace(/\.md$/, '');
      const filePath = resolve(handoffsDir, file);

      let content;
      try { content = readFileSync(filePath, 'utf8').trim(); } catch { continue; }
      if (!content) { try { unlinkSync(filePath); } catch {} continue; }

      // Find the target agent in the same team
      const target = registry.getAll().find((a) =>
        a.role === targetRole &&
        a.teamId === sourceAgent.teamId &&
        a.id !== sourceAgent.id &&
        (a.status === 'running' || a.status === 'completed')
      );

      if (!target) {
        console.log(`[Groove] Handoff to ${targetRole} — no matching agent in team`);
        try { unlinkSync(filePath); } catch {}
        continue;
      }

      // Wake the target agent with the handoff request
      const message = `Cross-scope handoff from ${sourceAgent.name} (${sourceAgent.role}):\n\n${content}`;
      this.daemon.processes.resume(target.id, message).then((newAgent) => {
        this.daemon.audit.log('handoff.routed', {
          from: sourceAgent.name, to: target.name, newId: newAgent.id, role: targetRole,
        });
        this.daemon.broadcast({
          type: 'handoff:routed',
          from: sourceAgent.name, to: target.name, role: targetRole,
        });
      }).catch((err) => {
        console.error(`[Groove] Handoff to ${targetRole} failed: ${err.message}`);
      });

      // Remove the handoff file
      try { unlinkSync(filePath); } catch {}
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
      teamId: config.teamId,
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
            this.daemon.tokens.record(newAgent.id, {
              tokens: output.tokensUsed,
              inputTokens: output.inputTokens,
              outputTokens: output.outputTokens,
              cacheReadTokens: output.cacheReadTokens,
              cacheCreationTokens: output.cacheCreationTokens,
              model: output.model,
              estimatedCostUsd: output.estimatedCostUsd,
            });
          }
        }
        if (output.type === 'result') {
          this.daemon.tokens.recordResult(newAgent.id, {
            costUsd: output.cost, durationMs: output.duration, turns: output.turns,
          });
          const resultUpdates = {};
          if (output.cost) resultUpdates.costUsd = (registry.get(newAgent.id)?.costUsd || 0) + output.cost;
          if (output.duration) resultUpdates.durationMs = output.duration;
          if (output.turns) resultUpdates.turns = output.turns;
          if (Object.keys(resultUpdates).length > 0) registry.update(newAgent.id, resultUpdates);
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

    const { proc, loop, logStream } = handle;

    // Agent loop path — clean async stop
    if (loop) {
      await loop.stop();
      // Exit handler already fired; finish cleanup
      this.handles.delete(agentId);
      this.daemon.registry.remove(agentId);
      this.daemon.locks.release(agentId);
      return;
    }

    // CLI process path
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

  /**
   * Send a message to a running agent loop.
   * Returns true if the message was sent, false if the agent doesn't have an active loop.
   */
  async sendMessage(agentId, message) {
    const handle = this.handles.get(agentId);
    if (!handle?.loop) return false;

    const { loop } = handle;
    if (!loop.running) return false;

    // Fire and forget — the loop processes the message asynchronously
    // and emits output events that flow through the normal handler
    loop.sendMessage(message).catch(() => {});
    return true;
  }

  /**
   * Check if an agent is using the agent loop runtime (vs CLI process).
   */
  hasAgentLoop(agentId) {
    const handle = this.handles.get(agentId);
    return !!(handle?.loop);
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
