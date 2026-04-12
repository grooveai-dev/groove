// GROOVE — Project Manager (AI Review Gate)
// FSL-1.1-Apache-2.0 — see LICENSE
//
// On-demand headless Claude reviews for risky agent operations.
// Only activated in Auto permission mode. Full Send skips entirely.
// Designed to be LEAN — minimal prompt, Haiku model, tight budget.

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

export class ProjectManager {
  constructor(daemon) {
    this.daemon = daemon;
    this.history = [];      // Review log for Approvals tab
    this.totalTokens = 0;   // Track PM overhead
    this.totalReviews = 0;
  }

  async review({ agent, action, file, description }) {
    const startTime = Date.now();

    // Build lean context — keep prompt under 1500 tokens
    const projectDir = this.daemon.projectDir;
    const mapPath = resolve(projectDir, 'GROOVE_PROJECT_MAP.md');
    const projectMap = existsSync(mapPath)
      ? readFileSync(mapPath, 'utf8').slice(0, 2000)
      : 'No project map yet.';

    // Get agent registry for scope awareness
    const agents = this.daemon.registry.getAll();
    const agentRecord = agents.find((a) => a.name === agent);
    const scope = agentRecord?.scope?.join(', ') || 'unrestricted';
    const role = agentRecord?.role || 'unknown';

    // Other agents working on overlapping areas
    const others = agents
      .filter((a) => a.name !== agent && (a.status === 'running' || a.status === 'starting'))
      .map((a) => `${a.name} (${a.role}): ${a.scope?.join(', ') || 'unrestricted'}`)
      .join('\n');

    const prompt = `You are a GROOVE Project Manager reviewing an agent action. Be brief.

Project state:
${projectMap}

Agent: ${agent} (role: ${role}, scope: ${scope})
Other active agents:
${others || 'none'}

Proposed action: ${action} ${file}
Description: ${description}

Review: Is this within scope? Conflicts with other agents? Aligns with project? Any risk?
Respond in ONE line: APPROVED: <reason> or REJECTED: <reason>`;

    try {
      const result = await this.daemon.journalist.callHeadless(prompt, { trackAs: '__pm__' });
      const text = (result || '').trim();
      const approved = !text.toUpperCase().startsWith('REJECTED');
      const reason = text.replace(/^(APPROVED|REJECTED):?\s*/i, '').trim();

      const record = {
        agent,
        action,
        file,
        description,
        approved,
        reason: reason || (approved ? 'Action within scope and plan' : 'Review failed'),
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - startTime,
      };

      this.history.push(record);
      if (this.history.length > 200) this.history = this.history.slice(-200);
      this.totalReviews++;

      return { approved, reason: record.reason };
    } catch (err) {
      // If PM review fails, approve by default (don't block agents)
      const record = {
        agent, action, file, description,
        approved: true,
        reason: `PM unavailable: ${err.message}. Auto-approved.`,
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - startTime,
      };
      this.history.push(record);
      this.totalReviews++;

      return { approved: true, reason: record.reason };
    }
  }

  getHistory() {
    return this.history;
  }

  getStats() {
    return {
      totalReviews: this.totalReviews,
      approved: this.history.filter((r) => r.approved).length,
      rejected: this.history.filter((r) => !r.approved).length,
      avgDurationMs: this.history.length > 0
        ? Math.round(this.history.reduce((s, r) => s + (r.durationMs || 0), 0) / this.history.length)
        : 0,
    };
  }
}
