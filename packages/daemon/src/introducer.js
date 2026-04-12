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
    const { taskNegotiation } = options;
    const agents = this.daemon.registry.getAll();

    // Team awareness must include completed teammates, not just running ones.
    // Agents that finished an empty-prompt standup (common pattern: spawn the
    // team upfront, then direct them task-by-task) sit in `completed` status
    // until resumed. Hiding them from the new agent's context makes planners
    // falsely conclude "I'm alone" and spawn duplicate roles.
    //
    // Scope to the same team so one team's agents don't leak into another's
    // context. Completed teammates get a 1-hour freshness cutoff so truly
    // stale ones don't clutter the intro.
    const COMPLETED_WINDOW_MS = 60 * 60 * 1000;
    const sameTeam = (a) =>
      a.id !== newAgent.id &&
      (!newAgent.teamId || a.teamId === newAgent.teamId);
    const activeOthers = agents.filter((a) =>
      sameTeam(a) && (a.status === 'running' || a.status === 'starting')
    );
    const recentCompleted = agents.filter((a) => {
      if (!sameTeam(a)) return false;
      if (a.status !== 'completed') return false;
      const ts = a.lastActivity ? new Date(a.lastActivity).getTime() : 0;
      return Date.now() - ts < COMPLETED_WINDOW_MS;
    });
    const others = [...activeOthers, ...recentCompleted];

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

    lines.push('');

    if (others.length === 0) {
      lines.push('You are the only agent on this project right now.');
    } else {
      const activeCount = activeOthers.length;
      const readyCount = recentCompleted.length;
      const parts = [];
      if (activeCount > 0) parts.push(`${activeCount} active`);
      if (readyCount > 0) parts.push(`${readyCount} ready to resume`);
      lines.push(`## Team (${others.length} teammate${others.length > 1 ? 's' : ''} — ${parts.join(', ')})`);
      lines.push('');
      if (readyCount > 0) {
        lines.push(`**Teammates marked "ready" are part of your team.** They finished their last task and will resume their session when assigned new work. If you're a planner, route new tasks to them by role — do NOT spawn duplicates.`);
        lines.push('');
      }

      // Collect all files created by teammates for the project files section
      const allTeamFiles = [];

      for (const other of others) {
        const scope = other.scope?.length > 0 ? other.scope.join(', ') : 'unrestricted';
        const dir = other.workingDir ? ` — dir: ${other.workingDir}` : '';
        const statusLabel = other.status === 'completed' ? 'ready to resume' : other.status;
        lines.push(`- **${other.name}** (${other.role}) — scope: ${scope}${dir} — ${statusLabel}`);

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

      // Project memory (Layer 7) — accumulated wisdom across all prior rotations.
      // Constraints, recent role handoffs, known error→fix patterns. Total cap ~12K chars.
      if (this.daemon.memory) {
        const constraints = this.daemon.memory.getConstraintsMarkdown(4000);
        const recentChain = this.daemon.memory.getRecentHandoffMarkdown(newAgent.role, 3, 4000);
        const discoveries = this.daemon.memory.getDiscoveriesMarkdown(newAgent.role, 20, 4000);

        if (constraints || recentChain || discoveries) {
          lines.push('');
          lines.push(`## Project Memory`);
          lines.push('');
          lines.push(`This is accumulated knowledge from prior agents working on this project. Read carefully — it will save you from rediscovering what others already learned.`);

          if (constraints) {
            lines.push('');
            lines.push(`### Constraints`);
            lines.push('');
            lines.push(constraints);
          }

          if (recentChain) {
            lines.push('');
            lines.push(`### Recent ${newAgent.role} handoffs`);
            lines.push('');
            lines.push(recentChain);
          }

          if (discoveries) {
            lines.push('');
            lines.push(`### Known patterns (from prior ${newAgent.role} agents)`);
            lines.push('');
            lines.push(discoveries);
          }

          // Contributing to memory is opt-in. Only mention if the agent
          // explicitly needs to record something — no proactive prompting.
          // (Optional: `POST /api/memory/discoveries` or `POST /api/memory/constraints`)
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
      lines.push(`Before performing shared/destructive actions (restart server, npm install/build, modify package.json, modify shared config), declare intent via the GROOVE daemon. Another agent holding the same resource will cause a 423 response — wait and retry.`);
      lines.push('');
      lines.push(`Declare:`);
      lines.push('```');
      lines.push(`POST http://127.0.0.1:31415/api/coordination/declare`);
      lines.push(`{ "agentId": "${newAgent.id}", "operation": "npm install", "resources": ["package.json", "node_modules"] }`);
      lines.push('```');
      lines.push('');
      lines.push(`Complete (always call this when done, even on failure):`);
      lines.push('```');
      lines.push(`POST http://127.0.0.1:31415/api/coordination/complete`);
      lines.push(`{ "agentId": "${newAgent.id}" }`);
      lines.push('```');
      lines.push('');
      lines.push(`Operations auto-expire after 10 minutes to prevent deadlock.`);
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
    // which can contain stale context from unrelated sessions in the same dir
    lines.push('');
    lines.push(`## Memory Policy`);
    lines.push('');
    lines.push(`Ignore auto-memory. Do NOT read or write MEMORY.md or any files in the auto-memory directory.`);
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
        lines.push('You have integrations connected via GROOVE. To use them, make HTTP POST requests:');
        lines.push('```');
        lines.push('POST http://localhost:31415/api/integrations/{id}/exec');
        lines.push('Body: {"tool": "tool_name", "params": {...}}');
        lines.push('```');
        lines.push('To discover available tools: `GET http://localhost:31415/api/integrations/{id}/tools`');
        lines.push('');
        lines.push('**Approval gates:** Some tools require human approval (e.g., sending emails, creating charges).');
        lines.push('If you get a `requiresApproval: true` response with an `approvalId`, tell the user the action');
        lines.push('needs approval in the GROOVE GUI. Do NOT retry until the user confirms it has been approved.');
        lines.push('To retry: include `"approvalId": "<id>"` in your next exec request body.');
        lines.push('');
        lines.push(integrationSections.join('\n\n'));
      }
    }

    return lines.join('\n');
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
      `**Memory policy:** Ignore auto-memory. Do not read or write MEMORY.md. GROOVE manages all context.`,
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
