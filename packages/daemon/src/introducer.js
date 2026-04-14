// GROOVE — Introduction Protocol
// FSL-1.1-Apache-2.0 — see LICENSE

import { writeFileSync, readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { escapeMd } from './validate.js';

const GROOVE_SECTION_START = '<!-- GROOVE:START -->';
const GROOVE_SECTION_END = '<!-- GROOVE:END -->';

export class Introducer {
  constructor(daemon) {
    this.daemon = daemon;
  }

  generateContext(newAgent, options = {}) {
    const { taskNegotiation, hasTask } = options;
    const agents = this.daemon.registry.getAll();
    // Only include ACTIVE agents — not completed/killed ones from previous sessions
    // Completed agents' work is captured in the journalist's project map, not here
    const others = agents.filter((a) => a.id !== newAgent.id &&
      (a.status === 'running' || a.status === 'starting'));

    const lines = [
      `# GROOVE Agent Context`,
      ``,
      `You are **${newAgent.name}** (role: ${newAgent.role}), managed by GROOVE.`,
    ];

    if (newAgent.workingDir) {
      lines.push(`Your working directory: \`${newAgent.workingDir}\` — you are spawned inside this subdirectory. Stay within it unless coordination requires otherwise.`);
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

    lines.push('');

    if (others.length === 0) {
      lines.push('You are the only agent on this project right now.');
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

      // Project files section — tell the new agent what exists and what to read
      if (allTeamFiles.length > 0) {
        lines.push('');
        lines.push(`## Project Files`);
        lines.push('');
        lines.push(`Your team has created the following files. **Read relevant ones before starting work** to understand what's been built and planned:`);
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
      lines.push(`Your working directory is \`${newAgent.workingDir}\`. Stay inside it. Do NOT modify or delete files outside this directory.`);
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

    // Codebase structure injection — give agents instant orientation
    const structureSummary = this.daemon.indexer?.getStructureSummary();
    if (structureSummary) {
      lines.push('');
      lines.push(`## Codebase Structure (auto-indexed)`);
      lines.push('');
      lines.push(structureSummary);
    }

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
    const KEY_MAP = { codex: 'OPENAI_API_KEY', gemini: 'GEMINI_API_KEY', ollama: 'OLLAMA_API_KEY' };
    try {
      const credProviders = this.daemon.credentials?.listProviders() || [];
      if (credProviders.length > 0) {
        lines.push('');
        lines.push('## Available API Keys');
        lines.push('');
        lines.push('GROOVE has API keys stored and injected into your environment. Do NOT ask the user for these:');
        for (const cp of credProviders) {
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
    let memorySection = '';
    try {
      if (this.daemon.memory) {
        const parts = [];

        const constraints = this.daemon.memory.getConstraintsMarkdown(2000);
        if (constraints) {
          parts.push(`### Constraints (read carefully)\n${constraints}`);
        }

        if (hasTask) {
          const discoveries = this.daemon.memory.getDiscoveriesMarkdown(newAgent.role, 15, 1000);
          if (discoveries) {
            parts.push(`### Known Fixes for ${newAgent.role} Role\n${discoveries}`);
          }

          const handoffs = this.daemon.memory.getRecentHandoffMarkdown(newAgent.role, 2, 1000, newAgent.workingDir);
          if (handoffs) {
            parts.push(`### Recent Handoff History\n${handoffs}`);
          }
        }

        if (parts.length > 0) {
          memorySection = `\n## Project Memory (auto-generated)\n\n${parts.join('\n\n')}\n`;
          // Hard budget: 4K chars total
          if (memorySection.length > 4000) {
            memorySection = memorySection.slice(0, 3997) + '...';
          }
        }
      }
    } catch {
      // Memory injection must never break agent spawn
      memorySection = '';
    }

    return lines.join('\n') + memorySection;
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
      // Clean up if no agents
      const regPath = resolve(projectDir, 'AGENTS_REGISTRY.md');
      if (existsSync(regPath)) {
        writeFileSync(regPath, '');
      }
      return;
    }

    const lines = [
      `# AGENTS REGISTRY`,
      ``,
      `*Auto-generated by GROOVE. Do not edit manually.*`,
      ``,
      `| ID | Name | Role | Provider | Directory | Scope | Status |`,
      `|----|------|------|----------|-----------|-------|--------|`,
    ];

    for (const a of agents) {
      const scope = a.scope?.length > 0 ? `\`${a.scope.join('`, `')}\`` : '-';
      const dir = a.workingDir ? escapeMd(a.workingDir) : '-';
      lines.push(`| ${escapeMd(a.id)} | ${escapeMd(a.name)} | ${escapeMd(a.role)} | ${escapeMd(a.provider)} | ${dir} | ${scope} | ${escapeMd(a.status)} |`);
    }

    lines.push('');
    lines.push(`*Updated: ${new Date().toISOString()}*`);

    writeFileSync(resolve(projectDir, 'AGENTS_REGISTRY.md'), lines.join('\n'));
  }

  injectGrooveSection(projectDir) {
    // Inject a GROOVE section into the project's CLAUDE.md.
    // This section is delimited by markers so we can update it without
    // clobbering the user's content.
    const claudeMdPath = resolve(projectDir, 'CLAUDE.md');
    const agents = this.daemon.registry.getAll();
    const running = agents.filter((a) => a.status === 'running');

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
