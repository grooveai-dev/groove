// GROOVE — Introduction Protocol
// FSL-1.1-Apache-2.0 — see LICENSE

import { writeFileSync, readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { resolve, dirname, basename } from 'path';
import { escapeMd } from './validate.js';

const GROOVE_SECTION_START = '<!-- GROOVE:START -->';
const GROOVE_SECTION_END = '<!-- GROOVE:END -->';

export class Introducer {
  constructor(daemon) {
    this.daemon = daemon;
  }

  generateContext(newAgent, options = {}) {
    const { taskNegotiation, hasTask, isRotation } = options;
    const agents = this.daemon.registry.getAll();
    // Only include ACTIVE agents from the SAME TEAM — never leak cross-team state
    const others = agents.filter((a) => a.id !== newAgent.id &&
      (a.status === 'running' || a.status === 'starting') &&
      a.teamId === newAgent.teamId);

    const lines = [
      `# GROOVE Agent Context`,
      ``,
      `You are **${newAgent.name}** (role: ${newAgent.role}), managed by GROOVE.`,
    ];

    if (newAgent.workingDir) {
      lines.push(`Your working directory: \`${newAgent.workingDir}\` — this is the team orchestration directory (.groove/, coordination files). Do NOT create source code or project files here.`);

      // Inject parent directory context so agents know the root layout
      const parentDir = dirname(newAgent.workingDir);
      const teamDirName = basename(newAgent.workingDir);
      lines.push(`Your project root: \`${parentDir}\` — all source code, features, and builds go here (one level up from team dir).`);
      lines.push('');
      lines.push('## Project Root Structure');
      lines.push('');
      lines.push(`Team dir: \`${teamDirName}/\` (orchestration only — do NOT build here)`);
      lines.push(`Project root: \`${parentDir}\``);
      lines.push('');
      try {
        const entries = readdirSync(parentDir, { withFileTypes: true });
        const dirs = [];
        const files = [];
        for (const entry of entries) {
          if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
          if (entry.name === teamDirName) continue;
          if (entry.isDirectory()) {
            dirs.push(entry.name + '/');
          } else {
            files.push(entry.name);
          }
        }
        if (dirs.length > 0) {
          lines.push('Directories:');
          for (const d of dirs.slice(0, 30)) {
            lines.push(`  ${d}`);
          }
          if (dirs.length > 30) lines.push(`  (+${dirs.length - 30} more)`);
        }
        if (files.length > 0) {
          lines.push('Files:');
          for (const f of files.slice(0, 20)) {
            lines.push(`  ${f}`);
          }
          if (files.length > 20) lines.push(`  (+${files.length - 20} more)`);
        }
        lines.push('');
        lines.push('When creating or modifying project files, use "../" paths relative to the team dir (e.g., "../demo/src/app.js"). The team directory is ephemeral and may be deleted — never put project work inside it.');
      } catch {
        // Parent dir not readable — skip
      }
    }

    if (newAgent.scope && newAgent.scope.length > 0) {
      lines.push(`Your file scope: \`${newAgent.scope.join('`, `')}\``);
    } else {
      lines.push(`You have no file scope restrictions.`);
    }

    // Sandbox boundary for imported repos
    if (newAgent.workingDir) {
      const sandboxPath = resolve(newAgent.workingDir, '.groove', 'sandbox.json');
      if (existsSync(sandboxPath)) {
        lines.push('');
        lines.push(`## HARD BOUNDARY`);
        lines.push('');
        lines.push(`You MUST NOT read, write, or modify ANY file outside \`${newAgent.workingDir}/\`. This is a sandboxed imported repo. If setup instructions require changes outside this directory, ask the user first.`);
      }
    }

    if (newAgent.teamBuilderRoles && newAgent.teamBuilderRoles.length > 0) {
      lines.push('');
      lines.push('## Team Builder Pre-Selection');
      lines.push('');
      const roleDescs = newAgent.teamBuilderRoles.map(r => {
        return r.provider ? `${r.role} (provider: ${r.provider})` : r.role;
      });
      lines.push(`The user selected these roles in the Team Builder UI: ${roleDescs.join(', ')}.`);
      lines.push('When the user gives you a task, create a plan using EXACTLY these roles. Do not redesign the team composition.');
    }

    lines.push('');

    if (others.length === 0) {
      lines.push('You are the only agent on this project right now.');

      // Solo agents get full authority — no team coordination, no scope limits.
      // Business roles and planners keep their restrictions (intentional by design).
      const NO_SOLO_EXPAND = new Set([
        'planner', 'cmo', 'cfo', 'ea', 'support', 'analyst', 'home', 'chat', 'ambassador',
      ]);
      if (!NO_SOLO_EXPAND.has(newAgent.role)) {
        lines.push('');
        lines.push('## Solo Mode');
        lines.push('');
        lines.push('You are working alone — no team, no scope restrictions, no coordination needed. You have full authority to do whatever the task requires:');
        lines.push('- Install dependencies (npm install, pip install, etc.)');
        lines.push('- Start dev servers and long-running processes when needed');
        lines.push('- Run tests, builds, and linters');
        lines.push('- Create, modify, or delete any project files');
        lines.push('- Commit and manage git operations');
        lines.push('- Perform any shell commands necessary to complete your task');
        lines.push('');
        lines.push('You are not limited to your role\'s typical focus area. If the task requires work outside your specialty, handle it directly.');
      }
    } else {
      lines.push(`## Team (${others.length} other agent${others.length > 1 ? 's' : ''})`);
      lines.push('');

      // Collect all files created by teammates for the project files section
      const allTeamFiles = [];

      for (const other of others) {
        const scope = other.scope?.length > 0 ? other.scope.join(', ') : 'unrestricted';
        const dir = other.workingDir ? ` — dir: ${other.workingDir}` : '';
        lines.push(`- **${other.name}** (${other.role}) — scope: ${scope}${dir} — ${other.status}`);

        // Get files this agent created/modified
        const files = this.daemon.journalist?.getAgentFiles(other) || [];
        if (files.length > 0) {
          const shown = files.slice(0, 15);
          lines.push(`  Files: ${shown.join(', ')}${files.length > 15 ? ` (+${files.length - 15} more)` : ''}`);
          for (const f of files) {
            allTeamFiles.push({ file: f, agent: other.name, role: other.role });
          }
        }

        // For completed agents, include their final result summary
        if (other.status === 'completed') {
          const result = this.daemon.journalist?.getAgentResult(other) || '';
          if (result) {
            lines.push(`  Result: ${result.slice(0, 500)}`);
          }
        }
      }

      lines.push('');
      lines.push(`## Coordination Rules`);
      lines.push('');
      lines.push(`- Stay within your file scope when other agents are actively running.`);
      lines.push(`- If you are the ONLY active agent, you may edit files outside your scope if needed to complete your task.`);
      lines.push(`- If you need another agent to make changes (e.g., you're a frontend agent and need backend API changes):`);
      lines.push(`  Write a handoff file to .groove/handoffs/<role>.md (e.g., .groove/handoffs/backend.md) with:`);
      lines.push(`  - What needs to change and why`);
      lines.push(`  - Which files to modify`);
      lines.push(`  - Expected behavior after the change`);
      lines.push(`  GROOVE will automatically wake the target agent and deliver your request.`);
      lines.push(`- Check AGENTS_REGISTRY.md for the latest team state.`);
      lines.push('');
      lines.push(`## Daemon Safety (NEVER VIOLATE)`);
      lines.push('');
      lines.push(`You are running inside the Groove daemon. Other agents in other teams are running in parallel. Restarting or killing the daemon destroys ALL of their work.`);
      lines.push(`- NEVER run "groove stop", "groove start", "groove restart", or "groove nuke"`);
      lines.push(`- NEVER kill the daemon process ("kill <pid>", "pkill groove", "killall node")`);
      lines.push(`- NEVER run "./promote.sh", "./promote-local.sh", or any publish/deploy script`);
      lines.push(`- NEVER start long-running dev servers that block process exit (vite dev, npm start, next dev)`);
      lines.push(`- NEVER open files in a browser. No "open index.html", "open http://...", "xdg-open", or any command that launches a browser window. GROOVE has its own preview system — the user will view the site there.`);
      lines.push(`If code changes require a daemon restart to take effect, state that in your output so the user can restart manually. Do NOT restart it yourself.`);

      // User feedback from previous tasks — critical context about what the user
      // observed and what needs to change. Prevents agents from repeating mistakes.
      const feedback = this.daemon.journalist?.getUserFeedback() || [];
      if (feedback.length > 0) {
        lines.push('');
        lines.push(`## User Feedback (from previous tasks)`);
        lines.push('');
        lines.push(`The user sent these messages about previous agents' work. Pay close attention — these indicate issues that previous agents missed:`);
        for (const fb of feedback.slice(-10)) {
          lines.push(`- **${fb.agentName}** (${fb.role}): "${fb.message}"`);
        }
      }

      // Project files section — tell the new agent what exists
      // When no task is assigned, list files as reference only (not an action prompt)
      if (allTeamFiles.length > 0) {
        lines.push('');
        lines.push(`## Project Files`);
        lines.push('');
        if (hasTask || isRotation) {
          lines.push(`Your team has created the following files. **Read relevant ones before starting work** to understand what's been built and planned:`);
        } else {
          lines.push(`Your team has created the following files (for reference — do NOT read or act on these until you receive a task):`);
        }
        lines.push('');

        // Group by agent for clarity
        const byAgent = {};
        for (const { file, agent, role } of allTeamFiles) {
          const key = `${agent} (${role})`;
          if (!byAgent[key]) byAgent[key] = [];
          byAgent[key].push(file);
        }
        for (const [agent, files] of Object.entries(byAgent)) {
          lines.push(`**${agent}:**`);
          for (const f of files.slice(0, 20)) {
            lines.push(`- ${f}`);
          }
        }
      }
    }

    // Task negotiation — when a duplicate role joins, include the work division
    if (taskNegotiation) {
      lines.push('');
      lines.push(`## Task Assignment`);
      lines.push('');
      lines.push(`A task coordinator has analyzed the current team's work and assigned your focus area:`);
      lines.push('');
      lines.push(taskNegotiation);
      lines.push('');
      lines.push(`**Follow this assignment.** Focus on your assigned tasks and do NOT modify files that other same-role agents are actively working on.`);
    }

    // Knock protocol — coordination for destructive/shared actions
    const running = others.filter((a) => a.status === 'running' || a.status === 'starting');
    if (running.length > 0) {
      lines.push('');
      lines.push(`## Coordination Protocol`);
      lines.push('');
      lines.push(`Before performing shared/destructive actions (restart server, npm install/build, modify package.json, modify shared config), coordinate with your team:`);
      lines.push(`1. Read \`.groove/coordination.md\` to check for active operations`);
      lines.push(`2. Write your intent to \`.groove/coordination.md\` (e.g., "backend-1: restarting server")`);
      lines.push(`3. Proceed only if no conflicting operations are active`);
      lines.push(`4. Clear your entry from \`.groove/coordination.md\` when done`);
    }

    // File safety — prevent agents from deleting files they didn't create
    lines.push('');
    lines.push(`## File Safety`);
    lines.push('');
    lines.push(`CRITICAL: NEVER delete files you did not create in this session. Do NOT remove files from other projects, previous work, or unrelated directories.`);
    if (newAgent.workingDir) {
      const parentDir = dirname(newAgent.workingDir);
      lines.push(`Your team directory is \`${newAgent.workingDir}\` (orchestration only). Build all project files in the project root: \`${parentDir}\`.`);
    }
    lines.push(`If you see files that seem unrelated to your task, leave them alone — they belong to another project or agent.`);

    // Memory containment — prevent agents from reading/writing auto-memory
    // GROOVE manages project memory automatically via Layer 7
    lines.push('');
    lines.push(`## Memory Policy`);
    lines.push('');
    lines.push(`GROOVE manages project memory automatically. Do not read or write MEMORY.md or .groove/memory/ files directly.`);
    lines.push(`GROOVE provides all your project context through handoff briefs, AGENTS_REGISTRY.md, and GROOVE_PROJECT_MAP.md.`);
    lines.push(`Do NOT save memories — your state is managed by GROOVE's rotation and handoff system.`);

    // Add reference to project map if it exists
    const mapPath = resolve(this.daemon.projectDir, 'GROOVE_PROJECT_MAP.md');
    if (existsSync(mapPath)) {
      lines.push('');
      lines.push(`## Background Context`);
      lines.push('');
      lines.push(`GROOVE_PROJECT_MAP.md contains a structural overview of this project. This is BACKGROUND INFORMATION ONLY — it is NOT your task. Do not treat existing files or previous work as something you should continue or improve unless the user explicitly asks you to.`);
    }

    // CLAUDE.md parity — non-Claude providers don't read CLAUDE.md natively,
    // so inject its project content (minus the GROOVE section) into introContext
    if (newAgent.provider && newAgent.provider !== 'claude-code') {
      if (newAgent.role === 'planner') {
        // Planners don't need full project context — codebase structure is injected separately
      } else {
        const claudeMdContent = this._loadClaudeMd(newAgent.workingDir);
        if (claudeMdContent) {
          lines.push('');
          lines.push('## Project Context (from CLAUDE.md)');
          lines.push('');
          lines.push(claudeMdContent);
        }
      }
    }

    // Non-Claude planners only need codebase structure + team info — skip heavy context
    const isLightPlanner = newAgent.role === 'planner' && newAgent.provider && newAgent.provider !== 'claude-code';

    // Codebase structure injection — give agents instant orientation
    const structureSummary = this.daemon.indexer?.getStructureSummary();
    if (structureSummary) {
      lines.push('');
      lines.push(`## Codebase Structure (auto-indexed)`);
      lines.push('');
      lines.push(structureSummary);
    }

    if (!isLightPlanner) {
      // Architecture injection — auto-detect architecture docs and inject
      // so every agent understands the big picture without spending tokens exploring
      const archContent = this.loadArchitectureDoc();
      if (archContent) {
        lines.push('');
        lines.push(`## Architecture (auto-injected)`);
        lines.push('');
        lines.push(archContent);
      }

      // Skills injection — load attached skill content and inject into context
      if (newAgent.skills && newAgent.skills.length > 0 && this.daemon.skills) {
        const skillSections = [];
        for (const skillId of newAgent.skills) {
          const content = this.daemon.skills.getContent(skillId);
          if (content) {
            // Strip YAML frontmatter, keep the instruction body
            const body = content.replace(/^---[\s\S]*?---\n*/, '').trim();
            if (body) {
              // Find the skill name from registry or frontmatter
              const regEntry = this.daemon.skills.registry.find((s) => s.id === skillId);
              const name = regEntry?.name || skillId;
              skillSections.push(`### ${name}\n\n${body}`);
            }
          }
        }
        if (skillSections.length > 0) {
          lines.push('');
          lines.push(`## Skills (${skillSections.length} attached)`);
          lines.push('');
          lines.push(`The following skills have been attached to this agent. Follow their instructions:`);
          lines.push('');
          lines.push(skillSections.join('\n\n---\n\n'));
        }
      }

      // Integration context — inject playbooks for GROOVE exec API
      if (newAgent.integrations && newAgent.integrations.length > 0 && this.daemon.integrations) {
        const integrationSections = [];
        for (const integrationId of newAgent.integrations) {
          const entry = this.daemon.integrations.registry.find((s) => s.id === integrationId);
          if (entry) {
            const configured = this.daemon.integrations._isConfigured(entry);
            if (!configured) {
              integrationSections.push(`- **${entry.name}** — NOT CONFIGURED (credentials missing)`);
            } else if (entry.agentInstructions) {
              integrationSections.push(entry.agentInstructions);
            } else {
              integrationSections.push(`- **${entry.name}**: ${entry.description}\n  Exec: \`POST http://localhost:31415/api/integrations/${entry.id}/exec\` with \`{"tool": "...", "params": {...}}\``);
            }
          }
        }
        if (integrationSections.length > 0) {
          lines.push('');
          lines.push(`## Integrations (${integrationSections.length} connected)`);
          lines.push('');
          lines.push('These integrations are ALREADY INSTALLED, AUTHENTICATED, AND READY TO USE. You do NOT need to:');
          lines.push('- Ask the user for any API keys, OAuth tokens, or credentials for these services');
          lines.push('- Set up authentication or run any auth flows');
          lines.push('- Direct the user to any external auth pages');
          lines.push('The user has already configured everything. Just use the tools.');
          lines.push('');
          lines.push('To use them, make HTTP POST requests:');
          lines.push('```');
          lines.push('POST http://localhost:31415/api/integrations/{id}/exec');
          lines.push('Body: {"tool": "tool_name", "params": {...}}');
          lines.push('```');
          lines.push('To discover available tools: `GET http://localhost:31415/api/integrations/{id}/tools`');
          lines.push('');
          lines.push('**Approval gates:** Some tools require human approval (e.g., sending emails, creating charges).');
          lines.push('If you get a `requiresApproval: true` response, the action has been queued for user approval.');
          lines.push('GROOVE will show the user an approval modal and auto-execute the action once approved.');
          lines.push('Do NOT tell the user to approve anything. Do NOT retry the request yourself. Just wait — you will receive a message confirming the result once the action is approved and executed.');
          lines.push('');
          lines.push(integrationSections.join('\n\n'));
        }
      }
    }

    // GitHub repo import — teach agents to use the tracked import API
    // Attached repos — only inject repos explicitly attached to this agent
    if (newAgent.repos && newAgent.repos.length > 0 && this.daemon.repoImporter) {
      const repoSections = [];
      for (const importId of newAgent.repos) {
        const manifest = this.daemon.repoImporter.getImport(importId);
        if (manifest && manifest.status === 'active') {
          const stack = manifest.stackInfo ? ` (${manifest.stackInfo.runtime || 'unknown'})` : '';
          repoSections.push(`- **${manifest.name || manifest.repo}**${stack}: \`${manifest.clonedTo}\` — import ID: ${manifest.id}`);
        }
      }
      if (repoSections.length > 0) {
        lines.push('');
        lines.push(`## Attached Repositories (${repoSections.length})`);
        lines.push('');
        lines.push('These repos are cloned and attached to you. Use the paths below — do NOT re-clone them:');
        lines.push(...repoSections);
        lines.push('');
        lines.push('If you spawn processes or modify config files for these repos, register them:');
        lines.push('- `POST http://localhost:31415/api/repos/{importId}/process` with `{ "pid": <number>, "command": "description" }`');
      }
    }

    // Lightweight import API reference for cloning new repos
    lines.push('');
    lines.push('## GitHub Repo Import');
    lines.push('');
    lines.push('To clone a NEW GitHub repo, use: `POST http://localhost:31415/api/repos/import` with `{ "repoUrl": "...", "targetPath": "~/Projects/name", "createTeam": true }`. Do NOT run `git clone` directly.');

    // Surface stored API keys so agents know what's available in their environment
    // Only inject provider API keys (codex, gemini, ollama) and integration credentials
    // that are relevant to this agent's attached integrations — skip OAuth boilerplate
    const KEY_MAP = { codex: 'OPENAI_API_KEY', gemini: 'GEMINI_API_KEY', ollama: 'OLLAMA_API_KEY' };
    const agentIntegrations = new Set(newAgent.integrations || []);
    try {
      const credProviders = this.daemon.credentials?.listProviders() || [];
      const relevant = credProviders.filter((cp) => {
        if (KEY_MAP[cp.provider]) return true;
        if (!cp.provider.startsWith('integration:')) return true;
        const parts = cp.provider.split(':');
        return parts.length >= 2 && agentIntegrations.has(parts[1]);
      });
      if (relevant.length > 0) {
        lines.push('');
        lines.push('## Available API Keys');
        lines.push('');
        lines.push('GROOVE has API keys stored and injected into your environment. Do NOT ask the user for these:');
        for (const cp of relevant) {
          const envVar = KEY_MAP[cp.provider];
          if (envVar) {
            lines.push(`- **${cp.provider}**: available as \`${envVar}\` in your environment`);
          } else {
            lines.push(`- **${cp.provider}**: stored in GROOVE credentials`);
          }
        }
        lines.push('');
        lines.push('If a third-party tool needs one of these keys, it is already in your environment — do not ask the user to provide it.');
      }
    } catch { /* credentials not available */ }

    // --- Layer 7: Project Memory (injected at end, bounded) ---
    // Light planners only get constraints — skip discoveries/handoffs to keep context small
    let memorySection = '';
    try {
      if (this.daemon.memory) {
        const parts = [];

        const constraints = this.daemon.memory.getConstraintsMarkdown(isLightPlanner ? 500 : 2000);
        if (constraints) {
          parts.push(`### Constraints (read carefully)\n${constraints}`);
        }

        if (!isLightPlanner && (hasTask || isRotation)) {
          const discoveries = this.daemon.memory.getDiscoveriesMarkdown(newAgent.role, 8, 600, newAgent.scope, newAgent.teamId);
          if (discoveries) {
            parts.push(`### Known Fixes for ${newAgent.role} Role\n${discoveries}`);
          }

          const handoffs = this.daemon.memory.getRecentHandoffMarkdown(newAgent.role, 2, 1000, newAgent.workingDir, newAgent.teamId);
          if (handoffs) {
            parts.push(`### Recent Handoff History\n${handoffs}`);
          }
        }

        if (parts.length > 0) {
          memorySection = `\n## Project Memory (auto-generated)\n\n${parts.join('\n\n')}\n`;
          // Hard budget: 3K chars total (1K for light planners)
          const budget = isLightPlanner ? 1000 : 3000;
          if (memorySection.length > budget) {
            memorySection = memorySection.slice(0, budget - 3) + '...';
          }
        }
      }
    } catch {
      // Memory injection must never break agent spawn
      memorySection = '';
    }

    // --- Keeper: tagged memory injection via [pull] ---
    let keeperSection = '';
    try {
      if (this.daemon.keeper && newAgent.keeperTags && Array.isArray(newAgent.keeperTags) && newAgent.keeperTags.length > 0) {
        const brief = this.daemon.keeper.pull(newAgent.keeperTags);
        if (brief) {
          keeperSection = `\n## Keeper Context (user-tagged memories)\n\n${brief}\n`;
          if (keeperSection.length > 5000) {
            keeperSection = keeperSection.slice(0, 4997) + '...';
          }
        }
      }
    } catch {
      keeperSection = '';
    }

    return lines.join('\n') + memorySection + keeperSection;
  }

  _loadClaudeMd(workingDir) {
    // Walk up from agent workingDir to find CLAUDE.md
    let dir = workingDir || this.daemon.projectDir;
    let claudePath = null;
    for (let i = 0; i < 5; i++) {
      const candidate = resolve(dir, 'CLAUDE.md');
      if (existsSync(candidate)) { claudePath = candidate; break; }
      const parent = resolve(dir, '..');
      if (parent === dir) break;
      dir = parent;
    }
    if (!claudePath) return null;
    try {
      let content = readFileSync(claudePath, 'utf8').trim();
      // Strip the GROOVE:START to GROOVE:END section to avoid duplicating coordination data
      const startIdx = content.indexOf(GROOVE_SECTION_START);
      const endIdx = content.indexOf(GROOVE_SECTION_END);
      if (startIdx !== -1 && endIdx !== -1) {
        content = (content.slice(0, startIdx) + content.slice(endIdx + GROOVE_SECTION_END.length)).trim();
      }
      if (content.length > 8000) {
        content = content.slice(0, 8000) + '\n\n*(truncated — read full file for details)*';
      }
      return content || null;
    } catch {
      return null;
    }
  }

  loadArchitectureDoc() {
    const projectDir = this.daemon.projectDir;
    const candidates = [
      'ARCHITECTURE.md',
      'docs/architecture.md',
      '.github/ARCHITECTURE.md',
    ];

    for (const candidate of candidates) {
      const fullPath = resolve(projectDir, candidate);
      if (existsSync(fullPath)) {
        try {
          let content = readFileSync(fullPath, 'utf8').trim();
          // Truncate to ~5K chars to keep context budget reasonable
          if (content.length > 5000) {
            content = content.slice(0, 5000) + '\n\n*(truncated — read full file for details)*';
          }
          return content;
        } catch {
          // ignore read errors
        }
      }
    }
    return null;
  }

  writeRegistryFile(projectDir) {
    const agents = this.daemon.registry.getAll();

    if (agents.length === 0) {
      const regPath = resolve(projectDir, 'AGENTS_REGISTRY.md');
      if (existsSync(regPath)) {
        try { writeFileSync(regPath, ''); } catch { /* dir may be gone */ }
      }
      return;
    }

    // Group agents by team so each team's registry only shows its own agents
    const teamGroups = new Map();
    for (const a of agents) {
      const tid = a.teamId || '_default';
      if (!teamGroups.has(tid)) teamGroups.set(tid, []);
      teamGroups.get(tid).push(a);
    }

    // Write a scoped registry into each team's workingDir
    for (const [teamId, teamAgents] of teamGroups) {
      const team = teamId !== '_default' ? this.daemon.teams?.get(teamId) : null;
      const dir = team?.workingDir || projectDir;
      if (!existsSync(dir)) continue;

      const lines = [
        `# AGENTS REGISTRY`,
        ``,
        `*Auto-generated by GROOVE. Do not edit manually.*`,
        ``,
        `| ID | Name | Role | Provider | Directory | Scope | Status |`,
        `|----|------|------|----------|-----------|-------|--------|`,
      ];

      for (const a of teamAgents) {
        const scope = a.scope?.length > 0 ? `\`${a.scope.join('`, `')}\`` : '-';
        const agentDir = a.workingDir ? escapeMd(a.workingDir) : '-';
        lines.push(`| ${escapeMd(a.id)} | ${escapeMd(a.name)} | ${escapeMd(a.role)} | ${escapeMd(a.provider)} | ${agentDir} | ${scope} | ${escapeMd(a.status)} |`);
      }

      lines.push('');
      lines.push(`*Updated: ${new Date().toISOString()}*`);

      writeFileSync(resolve(dir, 'AGENTS_REGISTRY.md'), lines.join('\n'));
    }
  }

  injectGrooveSection(projectDir) {
    if (!existsSync(projectDir)) return;
    const claudeMdPath = resolve(projectDir, 'CLAUDE.md');
    const agents = this.daemon.registry.getAll();

    // Only show agents that belong to this project directory — exclude agents
    // from teams with their own isolated workingDir (sandbox teams)
    const isolatedDirs = new Set();
    if (this.daemon.teams) {
      for (const team of this.daemon.teams.list()) {
        if (team.workingDir && team.workingDir !== projectDir) {
          isolatedDirs.add(team.workingDir);
        }
      }
    }
    const running = agents.filter((a) => a.status === 'running' &&
      !isolatedDirs.has(a.workingDir));

    const grooveContent = [
      GROOVE_SECTION_START,
      '',
      '## GROOVE Orchestration (auto-injected)',
      '',
      `Active agents: ${running.length}`,
      '',
      running.length > 0 ? '| Name | Role | Scope |' : '',
      running.length > 0 ? '|------|------|-------|' : '',
      ...running.map((a) => `| ${a.name} | ${a.role} | ${a.scope?.join(', ') || '-'} |`),
      '',
      `See AGENTS_REGISTRY.md for full agent state.`,
      '',
      `**Memory policy:** GROOVE manages project memory automatically. Do not read or write MEMORY.md or .groove/memory/ files directly.`,
      '',
      GROOVE_SECTION_END,
    ].filter(Boolean).join('\n');

    if (!existsSync(claudeMdPath)) {
      return; // Don't create CLAUDE.md — it's the user's file
    }

    let content = readFileSync(claudeMdPath, 'utf8');

    const startIdx = content.indexOf(GROOVE_SECTION_START);
    const endIdx = content.indexOf(GROOVE_SECTION_END);

    if (startIdx !== -1 && endIdx !== -1) {
      // Replace existing GROOVE section
      content = content.slice(0, startIdx) + grooveContent + content.slice(endIdx + GROOVE_SECTION_END.length);
    } else {
      // Append GROOVE section
      content = content.trimEnd() + '\n\n' + grooveContent + '\n';
    }

    writeFileSync(claudeMdPath, content);
  }

  removeGrooveSection(projectDir) {
    const claudeMdPath = resolve(projectDir, 'CLAUDE.md');
    if (!existsSync(claudeMdPath)) return;

    let content = readFileSync(claudeMdPath, 'utf8');
    const startIdx = content.indexOf(GROOVE_SECTION_START);
    const endIdx = content.indexOf(GROOVE_SECTION_END);

    if (startIdx !== -1 && endIdx !== -1) {
      // Remove the GROOVE section and any surrounding blank lines
      const before = content.slice(0, startIdx).replace(/\n+$/, '');
      const after = content.slice(endIdx + GROOVE_SECTION_END.length).replace(/^\n+/, '');
      content = before + (after ? '\n\n' + after : '') + '\n';
      writeFileSync(claudeMdPath, content);
    }
  }
}
