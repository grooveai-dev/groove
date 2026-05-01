// GROOVE — Agent Process Manager
// FSL-1.1-Apache-2.0 — see LICENSE

import { spawn as cpSpawn } from 'child_process';
import { createWriteStream, mkdirSync, chmodSync, existsSync, readFileSync, writeFileSync, unlinkSync, readdirSync, copyFileSync } from 'fs';
import { resolve, dirname, isAbsolute } from 'path';
import { fileURLToPath } from 'url';
import { getProvider, getInstalledProviders, resolveProviderCommand } from './providers/index.js';
import { LocalProvider } from './providers/local.js';
import { OllamaProvider } from './providers/ollama.js';
import { AgentLoop } from './agent-loop.js';
import { validateAgentConfig } from './validate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SLIDES_ENGINE_SRC = resolve(__dirname, '../templates/groove-slides.cjs');

const COMPACTION_DROP_THRESHOLD = 0.25; // 25% drop from peak = natural compaction
const COMPACTION_MIN_PEAK = 0.15;       // Ignore compaction if peak was below 15%
const MAX_BUFFER_SIZE = 1_048_576;      // 1MB — discard oldest half if exceeded
const STREAM_THROTTLE_MS = 250;         // 4 broadcasts/sec per agent
const STALL_CHECK_INTERVAL_MS = 60_000; // Poll for stuck agents every 60s
const STALL_THRESHOLD_MS = 5 * 60_000;  // 5 min of silence on a live PID = stalled stream

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
  chat: `You are a Chat agent — a conversational companion, friend, and assistant. You are warm, curious, and genuinely engaged. You can discuss anything: ideas, philosophy, science, culture, coding, life.

Your primary mode is conversation, but you can still perform ANY task the user asks — code, research, analysis, writing. When no task is given, lean into being a great conversational partner.

Key behaviors:
- Be genuinely interested in the user's thoughts
- Ask thoughtful follow-up questions
- Share perspectives and explore ideas together
- Match the user's energy — playful, serious, philosophical, technical
- Remember context within the conversation
- Be honest and direct, not sycophantic

`,
  frontend: `You are a Frontend agent. You build and modify UI components, views, and state management. Focus on:
- Writing clean React/JSX with Tailwind CSS classes — zero inline styles unless dynamic
- Using the project's design system: CSS variables (--color-accent: #33afbc teal, --color-success, --color-warning, --color-danger, --color-info, --color-purple, --color-orange), surface colors (--color-surface-0 through -6), text hierarchy (--color-text-0 through -4), border colors (--color-border, --color-border-subtle)
- Fonts: Inter (--font-sans) for UI, JetBrains Mono (--font-mono) for code/data. Text sizes: text-xs (12px), text-2xs (10px), text-sm (14px)
- Using existing UI primitives from components/ui/ (Button, Badge, Dialog, Tabs, Tooltip, etc.) before creating new ones
- Checking the Zustand store (stores/groove.js) for existing state before adding new state
- Reading app.css for existing animations and utility classes before creating new ones
When making visual changes, always read app.css for the color palette and existing patterns first.
NEVER open files in a browser (no "open index.html", "open http://...", "xdg-open"). GROOVE has its own preview system.

`,
  backend: `You are a Backend agent. You build and modify daemon services, API endpoints, and system logic. Focus on:
- Writing clean Node.js ESM with the project's conventions (ESM imports, FSL license headers)
- Adding API endpoints in api.js with input validation (use validate.js patterns)
- Emitting WebSocket broadcasts for state changes so the GUI stays in sync
- Logging state-changing operations to the audit system
- Never touching OAuth tokens or proxying API calls (compliance rules)
- Writing tests in packages/daemon/test/ for new functionality

`,
  fullstack: `You are a Fullstack / QC agent. You work across both daemon and GUI. Focus on:
- Verifying daemon-to-GUI integration: API contracts, WebSocket event shapes, state sync
- Running tests (npm test) and builds (npm run build) to catch regressions
- Auditing changes from other agents for correctness and consistency
- Fixing integration issues that span the daemon/GUI boundary

CRITICAL — NEVER DO THESE:
- NEVER restart the Groove daemon. No "groove stop", "groove start", "groove nuke", "groove restart".
- NEVER kill the daemon process. No "kill <pid>", "pkill groove", "killall node", etc.
- NEVER run "./promote.sh", "./promote-local.sh", or any publish/deploy script.
- NEVER start long-running dev servers (vite dev, npm start, next dev, etc.).
- NEVER open files in a browser. No "open index.html", "open http://...", "xdg-open", or any command that launches a browser. GROOVE has its own preview system.
- NEVER use 'git add -f' or 'git add --force' to bypass .gitignore. If a file is gitignored, it should stay gitignored. Only stage files that git tracks normally. If .gitignore prevents staging, report it in your output — do NOT force-add.
- NEVER use 'git push --force' or 'git push -f'. Force-pushing can destroy shared history.
- NEVER modify .gitignore to include files that were previously excluded.

Restarting the daemon destroys ALL other agents currently running in other teams. Verification is done via "npm run build" and "npm test", which exit cleanly. If code changes require a daemon restart to take effect, report that in your output so the user can restart manually — do NOT do it yourself.

`,
  testing: `You are a Testing agent. You write and maintain test suites, improve coverage, and verify quality. Focus on:
- Writing unit tests, integration tests, and end-to-end tests matching the project's test framework
- Running existing tests (npm test) to establish a baseline before making changes
- Identifying untested code paths and edge cases
- Fixing flaky or failing tests with clear root cause analysis
- Reporting test results and coverage metrics clearly

`,
  devops: `You are a DevOps agent. You manage CI/CD pipelines, deployment configuration, and infrastructure. Focus on:
- Configuring build pipelines, GitHub Actions, and deployment scripts
- Managing Docker, container configs, and environment setup
- Optimizing build performance and caching strategies
- Setting up monitoring, logging, and alerting
- Managing environment variables and secrets (never hardcode credentials)

`,
  docs: `You are a Documentation agent. You write clear, accurate technical documentation. Focus on:
- Writing README files, API docs, guides, and tutorials
- Keeping docs in sync with the actual codebase (read the code first, then document)
- Using clear structure: headings, tables, code examples, and concise descriptions
- Writing for the target audience (developers, end users, or operators)
- Documenting architecture decisions, setup instructions, and troubleshooting

`,
  security: `You are a Security agent. You audit code for vulnerabilities and harden the application. Focus on:
- Reviewing code for OWASP Top 10 vulnerabilities (injection, XSS, SSRF, auth bypass, etc.)
- Checking dependency versions for known CVEs
- Auditing access controls, input validation, and output encoding
- Verifying secrets management (no hardcoded keys, proper encryption)
- Reporting findings with severity, location, and recommended fix

`,
  database: `You are a Database agent. You manage schemas, migrations, queries, and data layer code. Focus on:
- Writing and reviewing database schemas and migrations
- Optimizing query performance (indexes, joins, N+1 detection)
- Managing seed data and fixtures for development/testing
- Ensuring data integrity with proper constraints and validation
- Writing database-related tests and verifying migration safety

`,
  slides: `You are a Slide Deck agent. You build presentation decks as HTML slides (Reveal.js) with a matching PPTX export. Focus on:
- Creating clean, professional slide layouts with strong visual hierarchy
- Structuring content into clear sections with concise, editorial copy
- Building responsive HTML slides that look polished in the browser
- Generating a slides.json data file alongside HTML so PPTX export stays in sync

MANDATORY PPTX LAYOUT ENGINE — baked into Groove, not optional

A file called groove-slides.cjs has been written into your working directory. It is the layout engine — it does NOT define any theme or style. You MUST use it in your convert-slides.js (which must also be CommonJS — use require, not import). Do not re-implement its functions. Do not copy its contents into your own code.

  const {
    LAYOUT, estimateTextHeight, fitFontSize,
    hardGate, tracker,
  } = require('./groove-slides.cjs');

What the engine gives you:
- LAYOUT constants — SLIDE_W (10), SLIDE_H (5.625), SAFE_X (0.6), SAFE_W (8.8), SAFE_BOT (5.125), CONTENT_START (0.65), plus standard gaps. Any element whose y + h exceeds SAFE_BOT (5.125) is clipped off the slide — treat that as a build failure.
- estimateTextHeight(text, fontSize, boxW, {bold}) — returns the height the text will actually need.
- fitFontSize(text, maxSize, minSize, boxW, boxH, {bold}) — returns the largest integer font size that fits the text in the box. Use this for every headline, hero number, price, or any text that could wrap. It replaces shrinkText.
- tracker() — returns { track, placed }. Wrap EVERY slide.addText / slide.addShape call's options with track('element-name', {x, y, w, h, text, fontSize, bold, ...}) so the gate can inspect it.
- hardGate(pairs) — runs collision, bounds, and wrap checks over every slide. Calls process.exit(1) on any issue. Call it once, before pres.writeFile(), with allSlides.map(s => [s.name, s.elements]).

Non-negotiable rules:
1. Do NOT use shrinkText: true. PowerPoint honors it; Google Slides and LibreOffice PDF export largely do not — the text renders at its declared size and overflows. Compute a real font size with fitFontSize() instead.
2. Do NOT invent skipCollision, skipBounds, skipWrap, or any other opt-out flag on tracked elements. The engine rejects them with an error. If a design element legitimately extends past the safe area (e.g., an orb bleeding off-slide as atmosphere), call slide.addImage directly WITHOUT tracking it — the gate only validates elements you declare placed.
3. Y advances come from estimateTextHeight() or an explicit box budget (const titleBoxH = 1.2). Never write a hardcoded magic number like Y += 0.95.
4. Do NOT wrap hardGate() in try/catch. Do NOT run pres.writeFile() after a failing gate. If the gate fails, the deck is not shippable — fix the slide generator.
5. Track the brand watermark and category label you draw on every slide. If they are not in placed[], the gate cannot detect a title bleeding into them.

A marketplace skill (e.g., modern-pitch-deck) layers theme on top — color palette, typography choices, gradient backgrounds, visual components (orbs, charts, heatmaps), slide archetype patterns. Skills must NOT redefine the engine functions, reset LAYOUT constants, or introduce their own gate. If you see a skill doing any of those, ignore that part and keep using the engine as documented here.

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
    { "role": "fullstack", "phase": 2, "scope": [], "prompt": "QC Senior Dev: Audit all changes from phase 1 agents. Verify correctness, fix issues, run tests, verify the build compiles (npm run build). Do NOT start long-running dev servers. Do NOT open files in a browser — no 'open' commands. Commit all changes." }
  ],
  "preview": {
    "kind": "dev-server",
    "command": "npm run dev",
    "cwd": "<projectDir>",
    "urlPattern": "https?://(localhost|127\\.0\\.0\\.1):\\d+",
    "readyText": "Local:",
    "openPath": "/"
  }
}

The "preview" block is how GROOVE launches a one-click preview for the user after the team finishes. Pick EXACTLY ONE kind based on what the project will produce:

  - "dev-server"   — web app, API, anything that needs a running process (Vite, Next, Express, FastAPI, Rails, etc.). Set command to the exact shell command to start it. Set cwd to the subdir containing the runnable project (relative to the team working dir), or "" if it runs at the root. Set urlPattern to a regex that matches the URL in the command's stdout. Set readyText to a short substring that signals the server is up (optional but helps). Set openPath to the path the user should land on ("/").
  - "static-html"  — slide deck, static site, anything where a browser opens index.html directly. Set command to "" and openPath to the relative path of the entry HTML (e.g. "index.html" or "slides/index.html"). GROOVE will serve the directory on a local port.
  - "cli"          — library, CLI tool, anything with no visible preview. Set command to "" and let the kind signal no auto-launch.
  - "none"         — explicitly no preview.

NEVER invent preview kinds. Use these four exact strings.

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
  ambassador: `You are an Ambassador agent — the sole bridge between this Groove daemon and a federated peer. You communicate with the remote Ambassador using diplomatic pouch messages. You can read the local codebase for context. Your ONLY outbound channel is the federation pouch system. When you receive work from your local team, package it as a task-request and send it to your peer. When you receive results from your peer, deliver them to your local team. Report results to your local team. Priority order: deliver to the planner agent first. If no planner exists, deliver to the fullstack agent. If neither exists, broadcast to all running agents. Use the GROOVE coordination API at http://localhost:31415 to discover running agents (GET /api/agents) and instruct them (POST /api/agents/:id/instruct). You do NOT write code or modify files. You translate, negotiate, and coordinate.

`,
};

// Role-to-integration mapping — recommended integrations per role for onboarding preflight
export const ROLE_INTEGRATIONS = {
  ea: ['gmail', 'google-calendar'],
  cmo: ['gmail', 'slack', 'hubspot'],
  cfo: ['stripe', 'google-sheets'],
  support: ['gmail', 'slack', 'zendesk'],
  analyst: ['google-sheets', 'postgres', 'mixpanel'],
  home: ['home-assistant'],
  slides: ['google-slides'],
  creative: ['google-docs'],
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

export function wrapWithRoleReminder(role, message) {
  if (role === 'planner' && !message.startsWith('ROLE REMINDER:')) {
    return 'ROLE REMINDER: You are a PLANNING ONLY agent. Do NOT write code, edit source files, or run build commands. Your ONLY file write should be .groove/recommended-team.json.\n\nUser message: ' + message;
  }
  return message;
}

export class ProcessManager {
  constructor(daemon) {
    this.daemon = daemon;
    this.handles = new Map(); // agentId -> { proc, logStream }
    this.peakContextUsage = new Map(); // agentId -> highest contextUsage seen
    this.pendingMessages = new Map(); // agentId -> { message, timestamp }
    this._streamThrottle = new Map(); // agentId -> { timer, pending }
    this._rotatingAgents = new Set(); // agentIds currently being rotated (rotator wrote handoff)
    this._stalledAgents = new Set(); // agentIds already flagged as stalled (avoids duplicate broadcasts)
    this._exitHandled = new Set();
    this._resultReceived = new Set();

    this._stallWatchdog = setInterval(() => this._checkStalls(), STALL_CHECK_INTERVAL_MS);
    if (this._stallWatchdog.unref) this._stallWatchdog.unref();
  }

  _checkStalls() {
    const { registry } = this.daemon;
    const now = Date.now();
    for (const agentId of this.handles.keys()) {
      const agent = registry.get(agentId);
      if (!agent || agent.status !== 'running') continue;
      const lastActivity = agent.lastActivity ? new Date(agent.lastActivity).getTime() : now;
      const silentMs = now - lastActivity;
      if (silentMs < STALL_THRESHOLD_MS) {
        if (this._stalledAgents.has(agentId)) {
          this._stalledAgents.delete(agentId);
          registry.update(agentId, { stalled: false });
        }
        continue;
      }
      if (this._stalledAgents.has(agentId)) continue;
      this._stalledAgents.add(agentId);
      registry.update(agentId, { stalled: true, stalledSince: new Date(lastActivity).toISOString() });
      if (this.daemon.timeline) {
        this.daemon.timeline.recordEvent('stall', {
          agentId, agentName: agent.name, role: agent.role, silentMs,
        });
      }
      this.daemon.broadcast({
        type: 'agent:stalled',
        agentId,
        agentName: agent.name,
        silentMs,
        lastActivity: agent.lastActivity,
      });
      console.warn(`[Groove] Agent ${agent.name} (${agentId}) silent for ${Math.round(silentMs / 1000)}s — possible stalled API stream`);
    }

    // Defense in depth: detect zombie handles where PID is no longer alive
    const ZOMBIE_THRESHOLD_MS = 10 * 60_000;
    for (const [agentId, handle] of this.handles.entries()) {
      const agent = registry.get(agentId);
      if (!agent) continue;
      const lastActivity = agent.lastActivity ? new Date(agent.lastActivity).getTime() : now;
      if (now - lastActivity < ZOMBIE_THRESHOLD_MS) continue;
      const pid = handle.proc?.pid;
      if (!pid) continue;
      try {
        process.kill(pid, 0);
      } catch {
        console.warn(`[Groove] Agent ${agent.name} (${agentId}) PID ${pid} no longer alive — force-cleaning handle`);
        if (handle.logStream && !handle.logStream.destroyed) {
          handle.logStream.write(`[${new Date().toISOString()}] Force-cleaned: PID ${pid} no longer alive\n`);
          handle.logStream.end();
        }
        this.handles.delete(agentId);
        this._exitHandled.add(agentId);
        setTimeout(() => this._exitHandled.delete(agentId), 30_000);
        this._stalledAgents.delete(agentId);
        this._resultReceived.delete(agentId);
        const throttle = this._streamThrottle.get(agentId);
        if (throttle?.timer) clearTimeout(throttle.timer);
        this._streamThrottle.delete(agentId);
        this.peakContextUsage.delete(agentId);
        this.pendingMessages.delete(agentId);
        if (this.daemon.locks) this.daemon.locks.release(agentId);
        registry.update(agentId, { status: 'completed', pid: null });
        this.daemon.broadcast({ type: 'agent:exit', agentId, code: 0, signal: null, status: 'completed' });
      }
    }
  }

  _handleProcessExit(agent, code, signal, logStream, stderrBuf, logPath) {
    if (this._exitHandled.has(agent.id)) return;
    this._exitHandled.add(agent.id);
    setTimeout(() => this._exitHandled.delete(agent.id), 30_000);

    const { registry } = this.daemon;

    if (!logStream.destroyed) {
      logStream.write(`[${new Date().toISOString()}] Process exited: code=${code} signal=${signal}\n`);
      logStream.end();
    }

    this.handles.delete(agent.id);

    const throttle = this._streamThrottle.get(agent.id);
    if (throttle?.timer) clearTimeout(throttle.timer);
    this._streamThrottle.delete(agent.id);

    this.peakContextUsage.delete(agent.id);
    this.pendingMessages.delete(agent.id);
    this._stalledAgents.delete(agent.id);

    if (this.daemon.locks) this.daemon.locks.release(agent.id);

    const hadResult = this._resultReceived.has(agent.id);
    this._resultReceived.delete(agent.id);

    const finalStatus = hadResult
      ? 'completed'
      : signal === 'SIGTERM' || signal === 'SIGKILL'
        ? 'killed'
        : code === 0
          ? 'completed'
          : 'crashed';

    const crashError = finalStatus === 'crashed' ? stderrBuf.join('').trim().slice(-500) : null;

    registry.update(agent.id, { status: finalStatus, pid: null });

    if (this.daemon.timeline) {
      const agentData = registry.get(agent.id);
      this.daemon.timeline.recordEvent(finalStatus === 'completed' ? 'complete' : finalStatus === 'crashed' ? 'crash' : 'kill', {
        agentId: agent.id, agentName: agent.name, role: agent.role,
        finalTokens: agentData?.tokensUsed || 0, costUsd: agentData?.costUsd || 0,
        exitCode: code,
      });
    }

    if (this.daemon.trajectoryCapture) {
      try {
        if (finalStatus === 'completed') {
          this.daemon.trajectoryCapture.onAgentComplete(agent.id, {
            status: 'SUCCESS', exit_code: code, signal,
          });
        } else {
          this.daemon.trajectoryCapture.onAgentCrash(agent.id,
            signal ? 'Killed by signal ' + signal : 'Exit code ' + code
          );
        }
        const count = (this.daemon.state.get('training_sessions_captured') || 0) + 1;
        this.daemon.state.set('training_sessions_captured', count);
      } catch (e) { /* fail silent */ }
    }

    this.daemon.broadcast({
      type: 'agent:exit',
      agentId: agent.id,
      code,
      signal,
      status: finalStatus,
      error: crashError || undefined,
    });

    if (this.daemon.integrations) {
      this.daemon.integrations.refreshMcpJson();
    }

    if (finalStatus === 'completed' && agent.role === 'planner') {
      this._extractRecommendedTeam(agent, logPath);
    }

    if (finalStatus === 'completed') {
      const pending = this.consumePendingMessage(agent.id);
      if (pending) {
        const agentData = registry.get(agent.id);
        if (agentData?.sessionId) {
          this.resume(agent.id, pending.message).catch((err) => {
            console.error(`[Groove] Auto-resume with queued message failed for ${agent.name}: ${err.message}`);
          });
          return;
        }
      }
    }

    if (finalStatus === 'completed' && this.daemon.journalist) {
      const a = registry.get(agent.id);
      const turns = a?.turns || 0;
      const tok = a?.tokensUsed || 0;
      if (turns > 1 || tok >= 100) {
        this.daemon.journalist.requestSynthesis('completion');
      }
    }

    this._checkPhase2(agent.id);

    if (agent.teamId) {
      this._checkPreviewReady(agent.teamId);
    }

    if (finalStatus === 'completed') {
      const files = this.daemon.journalist?.getAgentFiles(agent) || [];
      if (files.length > 0) this._triggerIdleQC(agent);
      this._processHandoffs(agent);
      if (this._rotatingAgents.has(agent.id)) {
        this._rotatingAgents.delete(agent.id);
      } else {
        this._writeCompletionHandoff(agent).catch(err => console.error(`[Groove] Completion handoff failed for ${agent.name}:`, err.message));
      }
    }

    if (this.daemon.memory && (finalStatus === 'completed' || finalStatus === 'crashed')) {
      try {
        const events = this.daemon.classifier?.agentWindows?.[agent.id] || [];
        const signals = events.length >= 6
          ? this.daemon.adaptive.extractSignals(events, agent.scope)
          : null;
        const score = signals ? this.daemon.adaptive.scoreSession(signals) : null;
        const files = this.daemon.journalist?.getAgentFiles(agent) || [];
        this.daemon.memory.updateSpecialization(agent.id, {
          role: agent.role,
          qualityScore: score,
          filesTouched: files,
          signals,
          threshold: this.daemon.adaptive?.getThreshold(agent.provider, agent.role),
        });
      } catch { /* best-effort */ }
    }
  }

  _handleResumeProcessExit(agent, code, signal, logStream) {
    if (this._exitHandled.has(agent.id)) return;
    this._exitHandled.add(agent.id);
    setTimeout(() => this._exitHandled.delete(agent.id), 30_000);

    const { registry } = this.daemon;

    if (!logStream.destroyed) {
      logStream.write(`[${new Date().toISOString()}] Process exited: code=${code} signal=${signal}\n`);
      logStream.end();
    }

    this.handles.delete(agent.id);
    this._stalledAgents.delete(agent.id);

    if (this.daemon.locks) this.daemon.locks.release(agent.id);

    const hadResult = this._resultReceived.has(agent.id);
    this._resultReceived.delete(agent.id);

    const finalStatus = hadResult ? 'completed' : signal === 'SIGTERM' || signal === 'SIGKILL' ? 'killed' : code === 0 ? 'completed' : 'crashed';
    registry.update(agent.id, { status: finalStatus, pid: null });

    if (this.daemon.trajectoryCapture) {
      try {
        if (finalStatus === 'completed') {
          this.daemon.trajectoryCapture.onAgentComplete(agent.id, {
            status: 'SUCCESS', exit_code: code, signal,
          });
        } else {
          this.daemon.trajectoryCapture.onAgentCrash(agent.id,
            signal ? 'Killed by signal ' + signal : 'Exit code ' + code
          );
        }
        const count = (this.daemon.state.get('training_sessions_captured') || 0) + 1;
        this.daemon.state.set('training_sessions_captured', count);
      } catch (e) { /* fail silent */ }
    }

    this.daemon.broadcast({ type: 'agent:exit', agentId: agent.id, code, signal, status: finalStatus });
    if (finalStatus === 'completed' && this.daemon.journalist) {
      const a = registry.get(agent.id);
      const turns = a?.turns || 0;
      const tok = a?.tokensUsed || 0;
      if (turns > 1 || tok >= 100) this.daemon.journalist.requestSynthesis('completion');
    }

    if (finalStatus === 'completed' && !this._rotatingAgents.has(agent.id)) {
      this._writeCompletionHandoff(agent).catch(err =>
        console.error(`[Groove] Completion handoff failed for ${agent.name}:`, err.message));
    }
    if (this._rotatingAgents.has(agent.id)) {
      this._rotatingAgents.delete(agent.id);
    }
    if (this.daemon.memory && (finalStatus === 'completed' || finalStatus === 'crashed')) {
      try {
        const events = this.daemon.classifier?.agentWindows?.[agent.id] || [];
        const signals = events.length >= 6
          ? this.daemon.adaptive.extractSignals(events, agent.scope)
          : null;
        const score = signals ? this.daemon.adaptive.scoreSession(signals) : null;
        const files = this.daemon.journalist?.getAgentFiles(agent) || [];
        this.daemon.memory.updateSpecialization(agent.id, {
          role: agent.role,
          qualityScore: score,
          filesTouched: files,
          signals,
          threshold: this.daemon.adaptive?.getThreshold(agent.provider, agent.role),
        });
      } catch { /* best-effort */ }
    }
  }

  async spawn(config) {
    const { registry, locks, introducer } = this.daemon;

    // Validate workingDir. Must be an absolute path to an existing directory.
    // We intentionally do NOT require it to live under daemon.projectDir — remote
    // SSH users legitimately run projects anywhere on the server (e.g. /var/www,
    // /opt/myapp) while daemon.projectDir defaults to their homedir.
    if (config.workingDir) {
      if (typeof config.workingDir !== 'string' || config.workingDir.includes('\0') || !isAbsolute(config.workingDir)) {
        throw new Error('workingDir must be an absolute path');
      }
      const resolved = resolve(config.workingDir);
      if (!existsSync(resolved)) {
        throw new Error(`workingDir does not exist: ${resolved}`);
      }
      config.workingDir = resolved;
    }

    // Ambassador spawn guard: one ambassador per federation peer
    if (config.role === 'ambassador') {
      const peerId = config.peerId || config.metadata?.peerId;
      if (!peerId) throw new Error('Ambassador agents require a peerId');
      if (this.daemon.federation?.ambassadors?.hasAmbassadorForPeer(peerId)) {
        throw new Error(`Ambassador already exists for peer ${peerId}`);
      }
    }

    // Scope collision check: refuse to spawn if another running agent in the
    // SAME working directory already claims overlapping files. Scopes are
    // relative patterns rooted at the agent's workingDir, so two agents in
    // different workingDirs can't step on each other even if their patterns
    // look identical. Oversight roles (planner, QC, security) and ambassadors
    // bypass entirely since their job requires broad access.
    const SCOPE_BYPASS_ROLES = new Set(['planner', 'fullstack', 'qc', 'pm', 'supervisor', 'security', 'ambassador']);
    if (config.scope && config.scope.length > 0 && !SCOPE_BYPASS_ROLES.has(config.role) && !config.allowScopeOverlap) {
      const conflict = locks.findOverlappingOwner(config.scope, config.workingDir);
      if (conflict.overlap) {
        const owner = registry.get(conflict.owner);
        if (owner && owner.status === 'running' && owner.workingDir === config.workingDir) {
          const ownerScope = Array.isArray(conflict.ownerScope) ? conflict.ownerScope.join(', ') : '';
          throw new Error(
            `Scope collision: ${config.role} scope [${config.scope.join(', ')}] overlaps with ${owner.name} (${owner.role}) which owns [${ownerScope}] in the same workspace. ` +
            `Two agents cannot edit the same files. Either narrow the scope or wait for ${owner.name} to finish.`
          );
        }
      }
    }

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

    // Resolve lab preset — apply runtime/model/parameters from a saved preset
    if (config.labPresetId && this.daemon.modelLab) {
      const preset = this.daemon.modelLab.getPreset(config.labPresetId);
      if (preset) {
        if (preset.model && !config.model) config.model = preset.model;
        if (preset.runtimeId) {
          const rt = this.daemon.modelLab.getRuntime(preset.runtimeId);
          if (rt && rt.type === 'ollama' && !config.provider) config.provider = 'ollama';
        }
        config._labPreset = preset;
      }
    }

    // Resolve provider — auto-detect best installed if not specified
    let providerName = config.provider;
    if (!providerName && this.daemon.config?.defaultProvider) {
      providerName = this.daemon.config.defaultProvider;
    }
    if (!providerName) {
      const installed = getInstalledProviders();
      if (installed.length === 0) {
        throw new Error('No AI providers installed. Install Claude Code, Gemini CLI, Codex, or Ollama first.');
      }
      // If a model is specified, find the provider that supports it
      if (config.model && config.model !== 'auto') {
        const match = installed.find((p) => p.models?.some((m) => m.id === config.model));
        if (match) providerName = match.id;
      }
      // Fallback: priority-based selection
      if (!providerName) {
        const priority = ['claude-code', 'gemini', 'codex', 'local', 'ollama'];
        const best = priority.find((p) => installed.some((i) => i.id === p)) || installed[0].id;
        providerName = best;
      }
    }

    // Validate provider is both installed and authenticated — fall back if not
    const isProviderAuthed = (name) => {
      const p = getProvider(name);
      if (!p || !p.constructor.isInstalled()) return false;
      const authType = p.constructor.authType;
      if (authType === 'local' || authType === 'none') return true;
      if (authType === 'api-key') return !!this.daemon.credentials?.hasKey(name);
      if (authType === 'subscription') {
        const status = p.constructor.isAuthenticated?.();
        return status?.authenticated === true;
      }
      return true;
    };

    if (!isProviderAuthed(providerName)) {
      const priority = ['claude-code', 'gemini', 'codex', 'local', 'ollama'];
      const fallback = priority.find(p => p !== providerName && isProviderAuthed(p));
      if (fallback) {
        providerName = fallback;
      }
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

    // Pre-flight for local model providers: ensure Ollama server is running and model is installed
    if (providerName === 'local' || providerName === 'ollama') {
      try {
        await LocalProvider.ensureServerRunning();
      } catch (err) {
        const agent = registry.add({ ...config, provider: providerName, status: 'error' });
        registry.update(agent.id, { status: 'error', error: 'Ollama server failed to start' });
        this.daemon.broadcast({ type: 'model:error', agentId: agent.id, error: err.message });
        throw new Error('Ollama server failed to start: ' + err.message);
      }
      if (config.model && config.model !== 'auto') {
        const installed = OllamaProvider.getInstalledModels();
        const modelInstalled = installed.some((m) => m.id === config.model || config.model.startsWith(m.id.split(':')[0]));
        if (!modelInstalled) {
          throw new Error(`Model '${config.model}' is not installed. Pull it first with: ollama pull ${config.model}`);
        }
      }
    }

    // Validate explicit model against provider's supported models
    if (config.model && config.model !== 'auto' && provider.constructor.models) {
      const valid = provider.constructor.models.some(m => m.id === config.model);
      if (!valid) {
        const fallback = provider.constructor.models[0];
        if (fallback) {
          console.log(`[Groove] Model '${config.model}' not available for ${provider.constructor.displayName}, falling back to '${fallback.id}'`);
          config.model = fallback.id;
        }
      }
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

    if (this.daemon.trajectoryCapture) {
      try {
        const teamSize = registry.getAll().filter(a => a.status === 'active' || a.status === 'running' || a.status === 'starting').length;
        this.daemon.trajectoryCapture.onAgentSpawn(
          agent.id, providerName, config.model || null, config.role, teamSize, config.prompt
        ).catch(() => {});
      } catch (e) { /* fail silent */ }
    }

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
      locks.register(agent.id, agent.scope, agent.workingDir);
    }

    // Register ambassador with federation system
    if (config.role === 'ambassador') {
      const peerId = config.peerId || config.metadata?.peerId;
      if (peerId && this.daemon.federation?.ambassadors) {
        this.daemon.federation.ambassadors.registerAmbassador(peerId, agent.id);
        registry.update(agent.id, { metadata: { ...agent.metadata, peerId } });
      }
    }

    // For slides-role agents, write the baked-in layout engine into the working
    // directory. The agent imports it as `./groove-slides.cjs`. Core layout rules
    // (Y-cursor, fitFontSize, collision/bounds/wrap gates) ship with Groove so
    // they apply without a skill attached — skills only provide theme/style.
    if (config.role === 'slides') {
      try {
        const dest = resolve(agent.workingDir || this.daemon.projectDir, 'groove-slides.cjs');
        mkdirSync(dirname(dest), { recursive: true });
        copyFileSync(SLIDES_ENGINE_SRC, dest);
      } catch (err) {
        console.log(`[Groove:Spawn] Failed to write groove-slides.cjs: ${err.message}`);
      }
    }

    // Create empty personality file for this agent
    const personalityDir = resolve(this.daemon.grooveDir, 'personalities');
    mkdirSync(personalityDir, { recursive: true });
    const personalityFile = resolve(personalityDir, `${agent.name}.md`);
    if (!existsSync(personalityFile)) {
      if (config.personality) {
        const templateFile = resolve(personalityDir, `${config.personality}.md`);
        if (existsSync(templateFile)) {
          copyFileSync(templateFile, personalityFile);
        } else {
          writeFileSync(personalityFile, '', { mode: 0o600 });
        }
      } else {
        writeFileSync(personalityFile, '', { mode: 0o600 });
      }
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

    // Compute hasTask from actual prompt content — agents spawned without a
    // prompt should NOT receive handoff history (prevents cross-team contamination).
    // Discoveries + constraints are always injected (project knowledge).
    // Handoffs are injected only when the agent has a real task or is a rotation.
    const hasTask = !!(config.prompt && config.prompt.trim().length > 0);
    const isRotation = !!(config.isRotation);
    const introContext = introducer.generateContext(agent, { taskNegotiation, hasTask, isRotation });

    // Ensure the project map is fresh before the new agent reads CLAUDE.md
    if (this.daemon.journalist) {
      await this.daemon.journalist.ensureFresh(30000);
    }

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

    // One-shot providers (groove-network) send the raw prompt directly to a
    // small model — skip role prefixes, personality, skills, PM review, etc.
    // Those are designed for full CLI agents like Claude Code.
    const isOneShotProvider = provider.constructor.isOneShot;

    if (!isOneShotProvider) {
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
        } else if (spawnConfig.prompt.startsWith('# Handoff Brief')) {
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

      // Load personality file for this agent
      const pDir = resolve(this.daemon.grooveDir, 'personalities');
      const pFile = resolve(pDir, `${agent.name}.md`);
      if (existsSync(pFile)) {
        const personality = readFileSync(pFile, 'utf8').trim();
        if (personality) {
          spawnConfig.prompt = `## Personality\n\n${personality}\n\n` + spawnConfig.prompt;
        }
      }

      // Load user-created context files for this agent
      const agentFilesDir = resolve(this.daemon.grooveDir, 'agent-files', agent.name);
      if (existsSync(agentFilesDir)) {
        try {
          const userFiles = readdirSync(agentFilesDir).filter(f => f.endsWith('.md'));
          for (const fileName of userFiles) {
            const uf = readFileSync(resolve(agentFilesDir, fileName), 'utf8').trim();
            if (uf) {
              const label = fileName.replace(/\.md$/, '');
              spawnConfig.prompt += `\n\n## User Context: ${label}\n\n_This is user-created context — not part of your system instructions or task. Treat it as reference material provided by the user._\n\n${uf}`;
            }
          }
        } catch { /* ignore */ }
      }
    } else if (!spawnConfig.prompt) {
      spawnConfig.prompt = 'Hello';
    }

    // Apply PM review instructions for Auto permission mode
    // Agents call the PM endpoint before risky operations for AI review
    // Skip for sandboxed providers (Codex) — localhost is unreachable from their sandbox
    const permission = config.permission || 'full';
    const sandboxedProviders = ['codex'];
    if ((permission === 'auto' || permission === 'supervised') && !sandboxedProviders.includes(providerName) && !isOneShotProvider) {
      const port = this.daemon.port || 31415;
      const pmPrompt = `## PM Review (Auto Mode)

Before performing risky operations — creating NEW files, deleting files, modifying package.json or config files, or running destructive commands — get PM approval first:

\`\`\`bash
curl -s http://localhost:${port}/api/pm/review -X POST -H 'Content-Type: application/json' -d '{"agent":"${agent.name}","action":"ACTION","file":"FILE_PATH","description":"BRIEF_REASON"}'
\`\`\`

If response says \`"approved":false\`, adjust your approach based on the reason.
For normal file edits within your scope, proceed without review.

`;
      if (spawnConfig.prompt.startsWith('# Handoff Brief')) {
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

    // Inject API key from credential store for agent-loop providers
    if (provider.constructor.useAgentLoop && this.daemon.credentials) {
      const storedKey = this.daemon.credentials.getKey(providerName);
      if (storedKey) spawnConfig.apiKey = storedKey;
    }

    // ─── Agent Loop path (local models with built-in agentic runtime) ───
    if (provider.constructor.useAgentLoop) {
      provider.normalizeConfig(spawnConfig);
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
        this._stalledAgents.delete(agent.id);
        this._resultReceived.delete(agent.id);

        // Clean up stream throttle so pending timers don't fire for dead agents
        const throttle = this._streamThrottle.get(agent.id);
        if (throttle?.timer) clearTimeout(throttle.timer);
        this._streamThrottle.delete(agent.id);

        // Clean up per-agent maps to prevent unbounded growth in long sessions
        this.peakContextUsage.delete(agent.id);
        this.pendingMessages.delete(agent.id);

        // Release file-scope locks so they don't persist after agent death
        if (this.daemon.locks) this.daemon.locks.release(agent.id);

        registry.update(agent.id, { status, pid: null });

        if (this.daemon.timeline) {
          const agentData = registry.get(agent.id);
          const evtType = status === 'completed' ? 'complete' : status === 'crashed' ? 'crash' : 'kill';
          this.daemon.timeline.recordEvent(evtType, {
            agentId: agent.id, agentName: agent.name, role: agent.role,
            finalTokens: agentData?.tokensUsed || 0, costUsd: agentData?.costUsd || 0,
          });
        }

        if (this.daemon.trajectoryCapture) {
          try {
            if (status === 'completed') {
              this.daemon.trajectoryCapture.onAgentComplete(agent.id, {
                status: 'SUCCESS', exit_code: code || 0, signal,
              });
            } else {
              this.daemon.trajectoryCapture.onAgentCrash(agent.id,
                signal ? 'Killed by signal ' + signal : 'Exit status ' + status
              );
            }
            const count = (this.daemon.state.get('training_sessions_captured') || 0) + 1;
            this.daemon.state.set('training_sessions_captured', count);
          } catch (e) { /* fail silent */ }
        }

        this.daemon.broadcast({ type: 'agent:exit', agentId: agent.id, code: code || 0, signal, status });
        if (this.daemon.integrations) this.daemon.integrations.refreshMcpJson();
        if (status === 'completed' && this.daemon.journalist) {
          const a = registry.get(agent.id);
          const turns = a?.turns || 0;
          const tok = a?.tokensUsed || 0;
          if (turns > 1 || tok >= 100) this.daemon.journalist.requestSynthesis('completion');
        }
        this._checkPhase2(agent.id);

        // Auto-trigger idle QC + process cross-scope handoffs
        if (status === 'completed') {
          const files = this.daemon.journalist?.getAgentFiles(agent) || [];
          if (files.length > 0) this._triggerIdleQC(agent);
          this._processHandoffs(agent);
          if (this._rotatingAgents.has(agent.id)) {
            this._rotatingAgents.delete(agent.id);
          } else {
            this._writeCompletionHandoff(agent).catch(err => console.error(`[Groove] Completion handoff failed for ${agent.name}:`, err.message));
          }
        }
      });

      // Wire errors — broadcast to GUI for display, crash on fatal API errors
      loop.on('error', ({ message }) => {
        this.daemon.broadcast({
          type: 'agent:output', agentId: agent.id,
          data: { type: 'activity', subtype: 'error', data: message },
        });
        if ((message.includes('API error 4') && !message.includes('API error 429')) || message.includes('Inference API unreachable')) {
          loop.stop();
        }
      });

      // Start the agent loop with the fully assembled prompt
      loop.start(spawnConfig.prompt);
      return agent;
    }

    // ─── CLI Spawn path (Claude Code, Codex, Gemini, Ollama CLI) ────────

    // Write MCP config for agent integrations (command/args only, no secrets)
    // Credentials are injected via process environment below
    // Only write .mcp.json for claude-code — other providers use GROOVE's exec API
    let integrationEnv = {};
    if (config.integrations?.length > 0 && this.daemon.integrations) {
      if (agent.provider === 'claude-code') {
        this.daemon.integrations.writeMcpJson(config.integrations);
      }
      integrationEnv = this.daemon.integrations.getSpawnEnv(config.integrations);
    }

    provider.normalizeConfig(spawnConfig);
    const spawnCmd = provider.buildSpawnCommand(spawnConfig);
    const { command: rawCommand, args, env, stdin: stdinData, cwd: providerCwd } = spawnCmd;
    const command = resolveProviderCommand(agent.provider || config.provider) || rawCommand;

    // Log the spawn command (mask anything that looks like an API key)
    const maskArg = (a) => /^(sk-|AIza|key-|token-)/.test(a) ? '***' : a;
    const safeArgs = args.map((a) => maskArg(a.includes(' ') ? `"${a}"` : a));
    const spawnLine = `[${new Date().toISOString()}] GROOVE spawning: ${command} [${safeArgs.length} args]\n`;
    logStream.write(spawnLine);

    // Inject only the API key for the agent's own provider — least-privilege principle
    // (avoids leaking unrelated credentials into agent environments)
    if (this.daemon.credentials) {
      const agentProvider = agent.provider || config.provider;
      if (agentProvider) {
        const meta = getProvider(agentProvider);
        if (meta?.constructor?.envKey) {
          const storedKey = this.daemon.credentials.getKey(agentProvider);
          if (storedKey) {
            env[meta.constructor.envKey] = storedKey;
          }
        }
      }
    }

    // Best-effort Codex auth recovery: refresh ~/.codex/auth.json if stale
    const agentProviderName = agent.provider || config.provider;
    if (agentProviderName === 'codex') {
      const codexMeta = getProvider('codex');
      if (codexMeta?.constructor?.isAuthenticated) {
        const authStatus = codexMeta.constructor.isAuthenticated();
        if (!authStatus?.authenticated && this.daemon.credentials?.hasKey('codex')) {
          const storedKey = this.daemon.credentials.getKey('codex');
          if (storedKey && codexMeta.constructor.onKeySet) {
            try {
              const result = await codexMeta.constructor.onKeySet(storedKey);
              logStream.write(`[${new Date().toISOString()}] Codex auth recovery: ${result?.ok ? 'success' : result?.error || 'failed'}\n`);
            } catch (e) {
              logStream.write(`[${new Date().toISOString()}] Codex auth recovery error: ${e.message}\n`);
            }
          }
        }
      }
    }

    // Spawn the process (use pipe for stdin if provider needs to send prompt via stdin)
    const spawnCwd = [providerCwd, agent.workingDir, this.daemon.projectDir].find(d => d && existsSync(d)) || this.daemon.projectDir;
    const proc = cpSpawn(command, args, {
      cwd: spawnCwd,
      env: { ...process.env, ...env, ...integrationEnv, GROOVE_AGENT_ID: agent.id, GROOVE_AGENT_NAME: agent.name, GROOVE_DAEMON_HOST: this.daemon.host || '127.0.0.1', GROOVE_DAEMON_PORT: String(this.daemon.port || 31415) },
      stdio: [stdinData ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      detached: false,
    });

    proc.on('error', (err) => {
      if (!logStream.destroyed) logStream.write(`[${new Date().toISOString()}] Spawn error: ${err.message}\n`);
      if (!logStream.destroyed) logStream.end();
      this.handles.delete(agent.id);
      this._exitHandled.add(agent.id);
      registry.update(agent.id, { status: 'crashed', pid: null });
      this.daemon.broadcast({ type: 'agent:exit', agentId: agent.id, code: null, signal: null, status: 'crashed', error: err.message });
    });

    // Write prompt via stdin if provider requested it (e.g., Ollama avoids arg length limits)
    if (stdinData && proc.stdin) {
      proc.stdin.write(stdinData);
      proc.stdin.end();
    }

    if (!proc.pid) {
      registry.remove(agent.id);
      locks.release(agent.id);
      if (!logStream.destroyed) logStream.end();
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
      this._processStdoutChunk(agent.id, provider, chunk);
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

    // Handle process exit — cleanup extracted to _handleProcessExit with dedup
    proc.on('exit', (code, signal) => {
      this._handleProcessExit(agent, code, signal, logStream, stderrBuf, logPath);
    });

    proc.on('close', (code, signal) => {
      this._handleProcessExit(agent, code, signal, logStream, stderrBuf, logPath);
    });

    proc.on('error', (err) => {
      logStream.write(`[error] ${err.message}\n`);
      logStream.end();

      this.handles.delete(agent.id);
      this._exitHandled.add(agent.id);
      if (this.daemon.locks) this.daemon.locks.release(agent.id);
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
  // Buffer stdout across chunks and parse each complete stream-json line
  // separately. Two bugs this fixes:
  //   1. A JSON line can span chunk boundaries — parsing each chunk in isolation
  //      drops the partial line, so big assistant turns vanish.
  //   2. A single assistant msg_id emits multiple JSON lines (thinking, text,
  //      tool_use), and parseOutput merges all events in its input into one
  //      output — keeping only the first activity's content. Text blocks after
  //      a thinking block got silently dropped, which is why long planner
  //      plans never reached chat.
  _processStdoutChunk(agentId, provider, chunk) {
    const handle = this.handles.get(agentId);
    if (!handle) return;

    handle.stdoutBuffer = (handle.stdoutBuffer || '') + chunk.toString();
    if (handle.stdoutBuffer.length > MAX_BUFFER_SIZE) {
      const half = Math.floor(handle.stdoutBuffer.length / 2);
      const nextNewline = handle.stdoutBuffer.indexOf('\n', half);
      handle.stdoutBuffer = nextNewline !== -1 ? handle.stdoutBuffer.slice(nextNewline + 1) : handle.stdoutBuffer.slice(half);
    }
    const lastNewline = handle.stdoutBuffer.lastIndexOf('\n');
    if (lastNewline === -1) return;

    const complete = handle.stdoutBuffer.slice(0, lastNewline + 1);
    handle.stdoutBuffer = handle.stdoutBuffer.slice(lastNewline + 1);

    for (const line of complete.split('\n')) {
      if (!line) continue;
      try {
        const output = provider.parseOutput(line);
        if (output) this._handleAgentOutput(agentId, output);
      } catch (err) {
        console.error(`[Groove] parseOutput error for ${agentId}: ${err.message}`);
      }
      if (this.daemon.trajectoryCapture) {
        try {
          const parsed = JSON.parse(line);
          this.daemon.trajectoryCapture.onStdoutLine(agentId, parsed);
        } catch (e) { /* fail silent — non-JSON lines are expected */ }
      }
    }
  }

  _handleAgentOutput(agentId, output) {
    const { registry, tokens, classifier, router } = this.daemon;
    const agent = registry.get(agentId);
    if (!agent) return;

    // Feed classifier for complexity tracking (informs model routing)
    classifier.addEvent(agentId, output);

    const updates = { lastActivity: new Date().toISOString() };

    // Clear stall flag — output means the stream is alive again
    if (this._stalledAgents.has(agentId)) {
      this._stalledAgents.delete(agentId);
      updates.stalled = false;
    }

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

      // Claude Code sometimes hangs after emitting the result event — the
      // process stays alive instead of exiting.  Record that the result
      // arrived so exit handlers know this was a successful completion even
      // if we have to SIGTERM the process.  After a 5s grace period, force-
      // kill any process that hasn't exited on its own.
      this._resultReceived.add(agentId);
      const handle = this.handles.get(agentId);
      if (handle?.proc && typeof handle.proc.kill === 'function') {
        setTimeout(() => {
          if (this.handles.has(agentId) && this._resultReceived.has(agentId)) {
            try { handle.proc.kill('SIGTERM'); } catch {}
          }
        }, 5_000);
      }
    }

    // Context window usage (0-1 scale) — drives rotation threshold
    if (output.contextUsage !== undefined) {
      updates.contextUsage = output.contextUsage;

      const peak = this.peakContextUsage.get(agentId) || 0;
      if (output.contextUsage > peak) {
        this.peakContextUsage.set(agentId, output.contextUsage);
      } else if (peak >= COMPACTION_MIN_PEAK) {
        const drop = peak - output.contextUsage;
        if (drop >= COMPACTION_DROP_THRESHOLD * peak) {
          this.daemon.rotator.recordNaturalCompaction(agent, peak, output.contextUsage);
          this.peakContextUsage.set(agentId, output.contextUsage);
        }
      }
    }

    // Session ID for resume support
    if (output.sessionId) {
      updates.sessionId = output.sessionId;
    }

    registry.update(agentId, updates);

    // Throttle streaming broadcasts to 4/sec per agent
    const isStreaming = output.type !== 'result';
    if (isStreaming) {
      let throttle = this._streamThrottle.get(agentId);
      if (!throttle) {
        throttle = { timer: null, pending: null };
        this._streamThrottle.set(agentId, throttle);
      }
      throttle.pending = output;
      if (!throttle.timer) {
        this.daemon.broadcast({ type: 'agent:output', agentId, data: output });
        throttle.pending = null;
        throttle.timer = setTimeout(() => {
          const p = throttle.pending;
          throttle.timer = null;
          throttle.pending = null;
          if (p) this.daemon.broadcast({ type: 'agent:output', agentId, data: p });
        }, STREAM_THROTTLE_MS);
      }
    } else {
      // Result messages always broadcast immediately and flush throttle
      const throttle = this._streamThrottle.get(agentId);
      if (throttle?.timer) { clearTimeout(throttle.timer); this._streamThrottle.delete(agentId); }
      this.daemon.broadcast({ type: 'agent:output', agentId, data: output });
    }
  }

  /**
   * Fire the one-click preview when the whole team has finished building.
   * Requirements:
   *   - The daemon has a preview plan stashed for this team (planner wrote one).
   *   - If the team plan has multiple phases, at least one agent from the highest
   *     phase exists in the registry AND is in a terminal state (prevents launching
   *     before QC finishes — _checkPhase2 consumes _pendingPhase2 before we run).
   *   - No pending phase 2 groups for this team (QC hasn't spawned yet).
   *   - Every non-planner team agent is in a terminal state.
   *   - At least one non-planner agent completed successfully.
   *
   * The plan is intentionally NOT cleared on failure so the user can hit the
   * "Launch Preview" button manually after fixing whatever blocked the auto
   * attempt (wrong cwd, missing deps, etc). We guard against infinite re-fires
   * with _previewAttempted per teamId.
   */
  _checkPreviewReady(teamId) {
    const preview = this.daemon.preview;
    if (!preview) return;
    if (!this._previewAttempted) this._previewAttempted = new Set();
    if (this._previewAttempted.has(teamId)) return;

    const plan = preview.getPlan(teamId);
    if (!plan) {
      this.daemon.audit?.log('preview.skipped', { teamId, reason: 'no_plan_stashed' });
      return;
    }

    // Multi-phase guard: use the stashed team plan so cleanup of the plan file
    // cannot race preview readiness checks.
    const maxPhase = typeof plan.maxPhase === 'number' ? plan.maxPhase : 1;
    const maxPhaseRoles = new Set();
    const expectedRoleCounts = {};
    const configs = Array.isArray(plan.agents) ? plan.agents : [];
    if (maxPhase > 1) {
      for (const cfg of configs) {
        if (cfg.role === 'planner') continue;
        const role = cfg.role || 'fullstack';
        const phase = typeof cfg.phase === 'number' ? cfg.phase : 1;
        expectedRoleCounts[role] = (expectedRoleCounts[role] || 0) + 1;
        if (phase === maxPhase) maxPhaseRoles.add(role);
      }
    }

    if (maxPhase > 1) {
      const terminalSet = new Set(['completed', 'crashed', 'stopped', 'killed']);
      const allTeamAgents = this.daemon.registry.getAll().filter(
        a => a.teamId === teamId && a.role !== 'planner'
      );
      for (const role of maxPhaseRoles) {
        const actual = allTeamAgents.filter(a => a.role === role).length;
        if (actual < (expectedRoleCounts[role] || 0)) return;
      }
      const anyMaxPhaseTerminal = allTeamAgents.some(
        a => maxPhaseRoles.has(a.role) && terminalSet.has(a.status)
      );
      if (!anyMaxPhaseTerminal) return;
    }

    const pendingPhase2 = this.daemon._pendingPhase2 || [];
    for (const group of pendingPhase2) {
      for (const id of group.waitFor) {
        const a = this.daemon.registry.get(id);
        if (a?.teamId === teamId) return;
      }
    }

    // Phase 2 spawns are async — _checkPhase2 may have consumed the pending
    // entry but the spawn() calls haven't resolved yet. Wait for them.
    if (this._phase2Spawning?.has(teamId)) return;

    const teamAgents = this.daemon.registry.getAll().filter((a) => a.teamId === teamId && a.role !== 'planner');
    if (teamAgents.length === 0) return;
    const terminal = new Set(['completed', 'crashed', 'stopped', 'killed']);
    const allDone = teamAgents.every((a) => terminal.has(a.status));
    const anyCompleted = teamAgents.some((a) => a.status === 'completed');
    if (!allDone || !anyCompleted) return;

    this._previewAttempted.add(teamId);
    const workingDir = plan.workingDir;
    preview.launch(teamId, workingDir, plan.preview).then((result) => {
      if (!result.launched) {
        const intentionalSkips = new Set(['no_preview', 'cli', 'none', 'no_command', 'no_dev_script']);
        if (intentionalSkips.has(result.reason)) {
          console.log(`[Groove] Preview for team ${teamId} intentionally skipped: ${result.reason}`);
          return;
        }
        console.warn(`[Groove] Preview for team ${teamId} did not launch: ${result.reason}`);
        this.daemon.broadcast({
          type: 'preview:failed',
          teamId,
          kind: plan.preview?.kind,
          reason: result.reason,
        });
      }
    }).catch((err) => {
      console.error(`[Groove] Preview launch error for team ${teamId}:`, err.message);
      this.daemon.broadcast({ type: 'preview:failed', teamId, kind: plan.preview?.kind, reason: err.message });
    });
  }

  _extractRecommendedTeam(agent, logPath) {
    try {
      const workDir = agent.workingDir || this.daemon.projectDir;
      const grooveDir = resolve(workDir, '.groove');
      const targetPath = resolve(grooveDir, 'recommended-team.json');

      if (existsSync(targetPath)) return;

      const log = readFileSync(logPath, 'utf8');

      // Extract text from JSON log events (Codex agent_message, Claude content blocks)
      const textParts = [];
      for (const line of log.split('\n')) {
        try {
          const evt = JSON.parse(line.trim());
          if (evt.item?.type === 'agent_message' && evt.item?.text) textParts.push(evt.item.text);
          if (evt.type === 'assistant' && evt.message?.content) {
            for (const block of evt.message.content) {
              if (block.type === 'text') textParts.push(block.text);
            }
          }
          if (evt.type === 'message' && evt.content) {
            const parts = Array.isArray(evt.content) ? evt.content : [evt.content];
            for (const p of parts) {
              if (typeof p === 'string') textParts.push(p);
              else if (p.text) textParts.push(p.text);
            }
          }
        } catch { textParts.push(line); }
      }
      const fullText = textParts.join('\n');

      const match = fullText.match(/\{[\s\S]*?"agents"\s*:\s*\[[\s\S]*?\]\s*\}/);
      if (!match) return;

      let parsed;
      try { parsed = JSON.parse(match[0]); } catch { return; }
      if (!parsed || !Array.isArray(parsed.agents) || parsed.agents.length === 0) return;

      parsed._meta = { teamId: agent.teamId || null, agentId: agent.id || null };

      if (!existsSync(grooveDir)) mkdirSync(grooveDir, { recursive: true });
      writeFileSync(targetPath, JSON.stringify(parsed, null, 2));
    } catch { /* best effort */ }
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

        // Track that phase 2 spawns are in-flight for this team so
        // _checkPreviewReady doesn't race ahead of the async spawn calls.
        const groupTeamId = group.agents[0]?.teamId || this.daemon.teams.getDefault()?.id || null;
        if (!this._phase2Spawning) this._phase2Spawning = new Map();
        const spawnPromises = [];

        // Auto-spawn phase 2 agents — if phase 1 was idle, clear the prompt
        // so QC also waits for instructions instead of auditing nothing
        for (const config of group.agents) {
          if (phase1Idle) config.prompt = '';

          // Dedup: check if team already has an agent with this role
          const teamId = config.teamId || this.daemon.teams.getDefault()?.id || null;
          const existing = teamId ? registry.getAll().find((a) =>
            a.teamId === teamId && a.role === config.role && a.id !== undefined
          ) : null;

          if (existing && (existing.status === 'running' || existing.status === 'starting')) {
            // Agent already active — reuse it instead of spawning a duplicate
            if (config.prompt) {
              this.sendMessage(existing.id, config.prompt, 'planner').catch((err) => {
                console.error(`[Groove] Phase 2 reuse message failed for ${existing.name}: ${err.message}`);
              });
            }
            this.daemon.audit.log('phase2.reuse', { id: existing.id, name: existing.name, role: existing.role });
            this.daemon.broadcast({
              type: 'phase2:spawned',
              agentId: existing.id,
              name: existing.name,
              role: existing.role,
              reused: true,
            });
            continue;
          }

          if (existing && (existing.status === 'completed' || existing.status === 'stopped' || existing.status === 'crashed' || existing.status === 'killed')) {
            // Previous agent finished — remove it and respawn with the same name
            config.name = existing.name;
            registry.remove(existing.id);
            this.daemon.locks.release(existing.id);
          }

          try {
            const validated = validateAgentConfig(config);
            if (!validated.teamId) validated.teamId = this.daemon.teams.getDefault()?.id || null;
            const p = this.spawn(validated).then((agent) => {
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
            spawnPromises.push(p);
          } catch (err) {
            console.error(`[Groove] Phase 2 config invalid for ${config.role}: ${err.message}`);
            this.daemon.broadcast({
              type: 'phase2:failed',
              role: config.role,
              error: err.message,
            });
          }
        }

        // Mark this team as having phase 2 spawns in-flight. Cleared once
        // all spawn promises settle so _checkPreviewReady won't race ahead.
        if (spawnPromises.length > 0 && groupTeamId) {
          this._phase2Spawning.set(groupTeamId, (this._phase2Spawning.get(groupTeamId) || 0) + spawnPromises.length);
          Promise.allSettled(spawnPromises).then(() => {
            const remaining = (this._phase2Spawning.get(groupTeamId) || 0) - spawnPromises.length;
            if (remaining <= 0) this._phase2Spawning.delete(groupTeamId);
            else this._phase2Spawning.set(groupTeamId, remaining);
          });
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
    this.sendMessage(qc.id, message, 'system').catch((err) => {
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

  async _writeCompletionHandoff(agent) {
    if (!this.daemon.memory || !this.daemon.journalist) return;
    try {
      const agentData = this.daemon.registry.get(agent.id);

      // Skip sessions that did no meaningful work — a "greeting-only" completion
      // (agent introduced itself, user gave no task) should not overwrite the chain
      // with a useless brief. Gate on turns and tokens used in this session.
      const turns = agentData?.turns || 0;
      const tokens = agentData?.tokensUsed || 0;
      if (turns <= 1 && tokens < 100) return;

      let brief;
      try {
        brief = await this.daemon.journalist.generateHandoffBrief(agent, { reason: 'completed' });
      } catch {
        // Fallback to structural brief if AI synthesis fails
        const filteredLogs = this.daemon.journalist.collectFilteredLogs([agent]);
        const agentLog = filteredLogs[agent.id];
        const entries = agentLog?.entries || [];
        const files = this.daemon.journalist.getAgentFiles(agent) || [];

        const toolSummary = entries
          .filter(e => e.type === 'tool')
          .map(e => `- ${e.tool}: ${e.input}`)
          .slice(-15)
          .join('\n');

        const errorSummary = entries
          .filter(e => e.type === 'error')
          .map(e => `- ${e.text}`)
          .slice(-5)
          .join('\n');

        brief = [
          `Agent ${agent.name} (${agent.role}) completed.`,
          agent.prompt ? `Task: ${agent.prompt.slice(0, 300)}` : '',
          files.length > 0 ? `\nFiles modified:\n${files.slice(0, 15).map(f => '- ' + f).join('\n')}` : '',
          toolSummary ? `\nRecent actions:\n${toolSummary}` : '',
          errorSummary ? `\nErrors encountered:\n${errorSummary}` : '',
        ].filter(Boolean).join('\n');
      }

      this.daemon.memory.appendHandoffBrief(agent.role, {
        timestamp: new Date().toISOString(),
        agentId: agent.id,
        reason: 'completed',
        oldTokens: agentData?.tokensUsed || 0,
        contextUsage: agentData?.contextUsage || 0,
        brief: (typeof brief === 'string' ? brief : '').slice(0, 4000),
      }, agent.workingDir, agent.teamId);
    } catch { /* best-effort */ }
  }

  /**
   * Process handoff files in .groove/handoffs/.
   * Agents write handoff requests when they need cross-scope work from a teammate.
   * File name = target role (e.g., backend.md). Content = what to do.
   */
  _processHandoffs(sourceAgent) {
    const handoffsDir = resolve(this.daemon.grooveDir, 'handoffs');
    if (!existsSync(handoffsDir)) return;

    const MAX_HANDOFFS_PER_ROLE = 3;
    if (!this.daemon._handoffCounts) this.daemon._handoffCounts = new Map();

    const registry = this.daemon.registry;
    let files;
    try { files = readdirSync(handoffsDir); } catch { return; }

    for (const file of files) {
      if (!file.endsWith('.md')) continue;
      const targetRole = file.replace(/\.md$/, '');
      const filePath = resolve(handoffsDir, file);

      const roleKey = `${sourceAgent.teamId}:${targetRole}`;
      const count = this.daemon._handoffCounts.get(roleKey) || 0;
      if (count >= MAX_HANDOFFS_PER_ROLE) {
        console.warn(`[Groove] Handoff to ${targetRole} skipped — cycle cap reached (${count}/${MAX_HANDOFFS_PER_ROLE})`);
        try { unlinkSync(filePath); } catch {}
        continue;
      }

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

      this.daemon._handoffCounts.set(roleKey, count + 1);

      // Wake the target agent with the handoff request
      const message = `Cross-scope handoff from ${sourceAgent.name} (${sourceAgent.role}):\n\n${content}`;

      if (target.status === 'running') {
        let sent = false;
        if (this.hasAgentLoop(target.id)) {
          this.sendMessage(target.id, message, 'agent').catch(() => {});
          sent = true;
        }
        if (!sent && this.daemon.journalist) {
          this.daemon.journalist.recordUserFeedback(target, message);
        }
        this.daemon.audit.log('handoff.routed', {
          from: sourceAgent.name, to: target.name, newId: target.id, role: targetRole,
        });
        this.daemon.broadcast({
          type: 'handoff:routed',
          from: sourceAgent.name, to: target.name, role: targetRole,
        });
      } else {
        // Target is completed/stopped — resume it with the handoff message
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
      }

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

    // Agent-loop providers: resume from saved session file
    const resumeProvider = getProvider(agent.provider || 'claude-code');
    if (resumeProvider?.constructor?.useAgentLoop) {
      const sessionPath = resolve(this.daemon.grooveDir, 'sessions', `${agentId}.json`);
      if (existsSync(sessionPath)) {
        return this._resumeAgentLoop(agentId, agent, message, resumeProvider);
      }
    }

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

    // Stop if running, then remove old entry so we can re-register with same name
    if (this.handles.has(agentId)) {
      await this.kill(agentId);
    }
    registry.remove(agentId);
    locks.release(agentId);

    // Build resume command
    const { command: rawCommand, args, env } = provider.buildResumeCommand(sessionId, message, config.model);
    const command = resolveProviderCommand(config.provider || 'claude-code') || rawCommand;

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
      locks.register(newAgent.id, newAgent.scope, newAgent.workingDir);
    }

    if (this.daemon.trajectoryCapture) {
      try {
        const teamSize = registry.getAll().filter(a => a.status === 'active' || a.status === 'running' || a.status === 'starting').length;
        this.daemon.trajectoryCapture.onAgentSpawn(
          newAgent.id, config.provider, config.model || null, config.role, teamSize, config.prompt
        ).catch(() => {});
      } catch (e) { /* fail silent */ }
    }

    // Spawn the resumed process
    const resumeCwd = [config.workingDir, this.daemon.projectDir].find(d => d && existsSync(d)) || this.daemon.projectDir;
    const proc = cpSpawn(command, args, {
      cwd: resumeCwd,
      env: { ...process.env, ...env, GROOVE_AGENT_ID: newAgent.id, GROOVE_AGENT_NAME: newAgent.name, GROOVE_DAEMON_HOST: this.daemon.host || '127.0.0.1', GROOVE_DAEMON_PORT: String(this.daemon.port || 31415) },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });

    proc.on('error', (err) => {
      if (!logStream.destroyed) logStream.write(`[${new Date().toISOString()}] Resume spawn error: ${err.message}\n`);
      if (!logStream.destroyed) logStream.end();
      this.handles.delete(newAgent.id);
      this._exitHandled.add(newAgent.id);
      registry.update(newAgent.id, { status: 'crashed', pid: null });
      this.daemon.broadcast({ type: 'agent:exit', agentId: newAgent.id, code: null, signal: null, status: 'crashed', error: err.message });
    });

    if (!proc.pid) {
      registry.remove(newAgent.id);
      locks.release(newAgent.id);
      if (!logStream.destroyed) logStream.end();
      throw new Error(`Failed to resume — process has no PID`);
    }

    this.handles.set(newAgent.id, { proc, logStream });
    registry.update(newAgent.id, { status: 'running', pid: proc.pid, sessionId });

    this.daemon.broadcast({
      type: 'rotation:complete',
      agentId: newAgent.id,
      agentName: newAgent.name,
      oldAgentId: agentId,
      reason: 'resume',
      tokensSaved: 0,
    });

    // Same stdout/stderr/exit handling as spawn
    proc.stdout.on('data', (chunk) => {
      logStream.write(chunk);
      this._processStdoutChunk(newAgent.id, provider, chunk);
    });

    proc.stderr.on('data', (chunk) => { logStream.write(`[stderr] ${chunk}`); });

    proc.on('exit', (code, signal) => {
      this._handleResumeProcessExit(newAgent, code, signal, logStream);
    });

    proc.on('close', (code, signal) => {
      this._handleResumeProcessExit(newAgent, code, signal, logStream);
    });

    proc.on('error', (err) => {
      logStream.write(`[error] ${err.message}\n`);
      logStream.end();
      this.handles.delete(newAgent.id);
      this._exitHandled.add(newAgent.id);
      this._stalledAgents.delete(newAgent.id);
      registry.update(newAgent.id, { status: 'crashed', pid: null });
    });

    return newAgent;
  }

  async _resumeAgentLoop(agentId, agent, message, provider) {
    const { registry, locks } = this.daemon;
    const config = { ...agent };

    if (this.handles.has(agentId)) {
      await this.kill(agentId);
    }
    registry.remove(agentId);
    locks.release(agentId);

    const newAgent = registry.add({
      role: config.role,
      scope: config.scope,
      provider: config.provider,
      model: config.model,
      prompt: config.prompt,
      permission: config.permission,
      workingDir: config.workingDir || undefined,
      name: config.name,
      teamId: config.teamId,
    });

    if (config.tokensUsed > 0) {
      registry.update(newAgent.id, { tokensUsed: config.tokensUsed });
    }

    if (newAgent.scope?.length > 0) {
      locks.register(newAgent.id, newAgent.scope, newAgent.workingDir);
    }

    // Move session file from old agent ID to new agent ID
    const sessionsDir = resolve(this.daemon.grooveDir, 'sessions');
    const oldSessionPath = resolve(sessionsDir, `${agentId}.json`);
    const newSessionPath = resolve(sessionsDir, `${newAgent.id}.json`);
    if (oldSessionPath !== newSessionPath && existsSync(oldSessionPath)) {
      try {
        mkdirSync(sessionsDir, { recursive: true });
        copyFileSync(oldSessionPath, newSessionPath);
        unlinkSync(oldSessionPath);
      } catch { /* AgentLoop will start fresh if file is missing */ }
    }

    const logDir = resolve(this.daemon.grooveDir, 'logs');
    mkdirSync(logDir, { recursive: true });
    const logPath = resolve(logDir, `${sanitizeFilename(newAgent.name)}.log`);
    const logStream = createWriteStream(logPath, { flags: 'a', mode: 0o600 });
    logStream.write(`[${new Date().toISOString()}] GROOVE resuming agent-loop session\n`);

    // Inject API key
    const spawnConfig = { ...newAgent, ...config };
    if (this.daemon.credentials) {
      const storedKey = this.daemon.credentials.getKey(newAgent.provider);
      if (storedKey) spawnConfig.apiKey = storedKey;
    }

    const loopConfig = provider.getLoopConfig(spawnConfig);
    const loop = new AgentLoop({ daemon: this.daemon, agent: newAgent, loopConfig, logStream });

    this.handles.set(newAgent.id, { loop, logStream });
    registry.update(newAgent.id, { status: 'running' });

    if (this.daemon.timeline) {
      this.daemon.timeline.recordEvent('spawn', {
        agentId: newAgent.id, agentName: newAgent.name, role: newAgent.role,
        provider: newAgent.provider, model: loopConfig.model,
      });
    }

    if (this.daemon.trajectoryCapture) {
      try {
        const teamSize = registry.getAll().filter(a => a.status === 'active' || a.status === 'running' || a.status === 'starting').length;
        this.daemon.trajectoryCapture.onAgentSpawn(
          newAgent.id, config.provider, loopConfig.model || config.model || null, config.role, teamSize, config.prompt
        ).catch(() => {});
      } catch (e) { /* fail silent */ }
    }

    loop.on('output', (output) => {
      this._handleAgentOutput(newAgent.id, output);
      if (this.daemon.trajectoryCapture) {
        try { this.daemon.trajectoryCapture.onParsedOutput(newAgent.id, output); } catch (e) { /* fail silent */ }
      }
    });

    loop.on('exit', ({ code, signal, status }) => {
      logStream.write(`[${new Date().toISOString()}] Agent loop exited: status=${status}\n`);
      logStream.end();
      this.handles.delete(newAgent.id);

      const throttle = this._streamThrottle.get(newAgent.id);
      if (throttle?.timer) clearTimeout(throttle.timer);
      this._streamThrottle.delete(newAgent.id);
      this.peakContextUsage.delete(newAgent.id);
      this.pendingMessages.delete(newAgent.id);

      // Release file-scope locks so they don't persist after agent death
      if (this.daemon.locks) this.daemon.locks.release(newAgent.id);

      registry.update(newAgent.id, { status, pid: null });

      const agentData = registry.get(newAgent.id);

      if (this.daemon.timeline) {
        const evtType = status === 'completed' ? 'complete' : status === 'crashed' ? 'crash' : 'kill';
        this.daemon.timeline.recordEvent(evtType, {
          agentId: newAgent.id, agentName: newAgent.name, role: newAgent.role,
          finalTokens: agentData?.tokensUsed || 0, costUsd: agentData?.costUsd || 0,
        });
      }

      if (this.daemon.trajectoryCapture) {
        try {
          if (status === 'completed') {
            this.daemon.trajectoryCapture.onAgentComplete(newAgent.id, {
              status: 'SUCCESS', exit_code: code || 0, signal,
            });
          } else {
            this.daemon.trajectoryCapture.onAgentCrash(newAgent.id,
              signal ? 'Killed by signal ' + signal : 'Exit status ' + status
            );
          }
          const count = (this.daemon.state.get('training_sessions_captured') || 0) + 1;
          this.daemon.state.set('training_sessions_captured', count);
        } catch (e) { /* fail silent */ }
      }

      this.daemon.broadcast({ type: 'agent:exit', agentId: newAgent.id, code: code || 0, signal, status });
      if (this.daemon.integrations) this.daemon.integrations.refreshMcpJson();

      if (status === 'completed' && this.daemon.journalist) {
        const turns = agentData?.turns || 0;
        const tok = agentData?.tokensUsed || 0;
        if (turns > 1 || tok >= 100) this.daemon.journalist.requestSynthesis('completion');
      }
      this._checkPhase2(newAgent.id);

      if (status === 'completed') {
        const files = this.daemon.journalist?.getAgentFiles(newAgent) || [];
        if (files.length > 0) this._triggerIdleQC(newAgent);
        this._processHandoffs(newAgent);
        if (this._rotatingAgents.has(newAgent.id)) {
          this._rotatingAgents.delete(newAgent.id);
        } else {
          this._writeCompletionHandoff(newAgent).catch(err =>
            console.error(`[Groove] Completion handoff failed for ${newAgent.name}:`, err.message));
        }
      }
    });

    loop.on('error', ({ message: errMsg }) => {
      this.daemon.broadcast({
        type: 'agent:output', agentId: newAgent.id,
        data: { type: 'activity', subtype: 'error', data: errMsg },
      });
      if ((errMsg.includes('API error 4') && !errMsg.includes('API error 429')) || errMsg.includes('Inference API unreachable')) {
        loop.stop();
      }
    });

    loop.start();
    loop.sendMessage(message);

    this.daemon.broadcast({
      type: 'rotation:complete',
      agentId: newAgent.id,
      agentName: newAgent.name,
      oldAgentId: agentId,
      reason: 'resume',
      tokensSaved: 0,
    });

    return newAgent;
  }

  cleanupTeamSessions(teamId) {
    const { registry } = this.daemon;
    const teamAgents = registry.getAll().filter(a => a.teamId === teamId);
    const sessionsDir = resolve(this.daemon.grooveDir, 'sessions');
    for (const agent of teamAgents) {
      const sessionPath = resolve(sessionsDir, `${agent.id}.json`);
      try { if (existsSync(sessionPath)) unlinkSync(sessionPath); } catch { /* non-fatal */ }
    }
  }

  /**
   * Stop the agent's current work without killing the agent.
   * The process is terminated but the agent stays in the registry with its
   * sessionId intact, so you can resume it later with a new message.
   */
  async stop(agentId) {
    const handle = this.handles.get(agentId);
    if (!handle) return;

    const { proc, loop } = handle;

    if (loop) {
      await loop.stop();
      this.handles.delete(agentId);
      if (this.daemon.trajectoryCapture) {
        try {
          this.daemon.trajectoryCapture.onAgentComplete(agentId, { status: 'STOPPED' });
          const count = (this.daemon.state.get('training_sessions_captured') || 0) + 1;
          this.daemon.state.set('training_sessions_captured', count);
        } catch (e) { /* fail silent */ }
      }
      this.daemon.registry.update(agentId, { status: 'stopped', pid: null });
      return;
    }

    return new Promise((resolveStop) => {
      const forceTimer = setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch {}
      }, 5000);

      proc.on('exit', () => {
        clearTimeout(forceTimer);
        this.handles.delete(agentId);
        this.daemon.registry.update(agentId, { status: 'stopped', pid: null });
        resolveStop();
      });

      try { proc.kill('SIGTERM'); } catch { resolveStop(); }
    });
  }

  async kill(agentId) {
    this.peakContextUsage.delete(agentId);

    // Clean up stream throttle so pending timers don't fire for dead agents
    const throttle = this._streamThrottle.get(agentId);
    if (throttle?.timer) clearTimeout(throttle.timer);
    this._streamThrottle.delete(agentId);
    this.pendingMessages.delete(agentId);

    // Unregister ambassador if this agent was one
    const agent = this.daemon.registry.get(agentId);
    if (agent?.role === 'ambassador' && agent?.metadata?.peerId) {
      this.daemon.federation?.ambassadors?.unregisterAmbassador(agent.metadata.peerId);
    }

    const handle = this.handles.get(agentId);

    if (!handle) {
      // Not running — release locks but keep agent in registry.
      // Spawn's exit handler already set the terminal status.
      // Callers that want removal must call registry.remove() explicitly.
      this.daemon.locks.release(agentId);
      return;
    }

    const { proc, loop, logStream } = handle;

    // Agent loop path — clean async stop
    if (loop) {
      await loop.stop();
      // Loop exit handler already updated status and cleaned handles
      this.daemon.locks.release(agentId);
      return;
    }

    // CLI process path — spawn's exit handler sets status='killed' for SIGTERM
    return new Promise((resolveKill) => {
      let resolved = false;
      const resolve = () => { if (!resolved) { resolved = true; resolveKill(); } };

      const forceTimer = setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch {}
      }, 5000);

      // Hard timeout: resolve even if exit event never fires (prevents HTTP hang)
      const hardTimer = setTimeout(() => {
        clearTimeout(forceTimer);
        this.handles.delete(agentId);
        this.daemon.locks.release(agentId);
        resolve();
      }, 10000);

      proc.on('exit', () => {
        clearTimeout(forceTimer);
        clearTimeout(hardTimer);
        this.daemon.locks.release(agentId);
        resolve();
      });

      try {
        proc.kill('SIGTERM');
      } catch {
        // Already dead
        clearTimeout(forceTimer);
        clearTimeout(hardTimer);
        this.handles.delete(agentId);
        this.daemon.locks.release(agentId);
        resolve();
      }
    });
  }

  /**
   * Send a message to a running agent loop.
   * Returns true if the message was sent, false if the agent doesn't have an active loop.
   */
  async sendMessage(agentId, message, source = 'user') {
    const handle = this.handles.get(agentId);
    if (!handle?.loop) return false;

    const { loop } = handle;
    if (!loop.running) return false;

    const agent = this.daemon.registry.get(agentId);
    const wrapped = agent ? wrapWithRoleReminder(agent.role, message) : message;

    if (this.daemon.trajectoryCapture) {
      try { this.daemon.trajectoryCapture.onUserMessage(agentId, message, source); } catch (e) { /* fail silent */ }
    }

    loop.sendMessage(wrapped).catch(() => {});
    return true;
  }

  /**
   * Check if an agent is using the agent loop runtime (vs CLI process).
   */
  hasAgentLoop(agentId) {
    const handle = this.handles.get(agentId);
    return !!(handle?.loop);
  }

  queueMessage(agentId, message) {
    const agent = this.daemon.registry.get(agentId);
    const wrapped = agent ? wrapWithRoleReminder(agent.role, message) : message;
    this.pendingMessages.set(agentId, { message: wrapped, timestamp: Date.now() });
    this.daemon.broadcast({ type: 'agent:message_queued', agentId, message: wrapped });
  }

  consumePendingMessage(agentId) {
    const pending = this.pendingMessages.get(agentId);
    if (pending) this.pendingMessages.delete(agentId);
    return pending || null;
  }

  async killAll() {
    const ids = Array.from(this.handles.keys());
    await Promise.all(ids.map((id) => this.kill(id)));
    if (this._stallWatchdog) {
      clearInterval(this._stallWatchdog);
      this._stallWatchdog = null;
    }
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
      const response = await journalist.callHeadless(prompt, { trackAs: '__negotiator__' });
      return response;
    } catch {
      // Fallback: return raw data for the agent to interpret
      return agentSummaries.map((a) =>
        `${a.name} is working on: ${a.files.join(', ') || 'unknown'}`
      ).join('\n');
    }
  }
}
