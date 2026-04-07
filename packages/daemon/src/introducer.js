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
    // Include ALL agents (running + completed) so new agents know what the team did
    const others = agents.filter((a) => a.id !== newAgent.id &&
      (a.status === 'running' || a.status === 'starting' || a.status === 'completed'));

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
      lines.push(`- Stay within your file scope. Do NOT modify files owned by other agents.`);
      lines.push(`- If you need changes outside your scope, document what you need — GROOVE will coordinate.`);
      lines.push(`- Check AGENTS_REGISTRY.md for the latest team state.`);

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
      lines.push(`Read GROOVE_PROJECT_MAP.md for current project context from The Journalist.`);
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

    // Integration context — list MCP tools available to this agent
    if (newAgent.integrations && newAgent.integrations.length > 0 && this.daemon.integrations) {
      const integrationSections = [];
      for (const integrationId of newAgent.integrations) {
        const entry = this.daemon.integrations.registry.find((s) => s.id === integrationId);
        if (entry) {
          const configured = this.daemon.integrations._isConfigured(entry);
          const status = configured ? 'connected' : 'NOT CONFIGURED — credentials missing';
          integrationSections.push(`- **${entry.name}** (${status}): ${entry.description}`);
        }
      }
      if (integrationSections.length > 0) {
        lines.push('');
        lines.push(`## Integrations (${integrationSections.length} connected)`);
        lines.push('');
        lines.push('You have MCP tools available from these integrations. Use them to interact with external services:');
        lines.push('');
        lines.push(integrationSections.join('\n'));
        lines.push('');
        lines.push('Call these tools directly — they are available in your MCP tool list. Do not attempt to use curl or API calls for services that have an MCP integration attached.');
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
