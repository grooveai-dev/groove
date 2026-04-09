// GROOVE — Gateway Message Formatter
// FSL-1.1-Apache-2.0 — see LICENSE

/**
 * Truncate text to a maximum length, adding ellipsis if needed.
 */
export function truncate(text, max = 2000) {
  if (!text || text.length <= max) return text || '';
  return text.slice(0, max - 3) + '...';
}

/**
 * Format a duration in ms to human-readable string.
 */
export function formatDuration(ms) {
  if (!ms || ms < 0) return '0s';
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.round((ms % 3_600_000) / 60_000);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/**
 * Format token count with K/M suffix.
 */
export function formatTokens(n) {
  if (!n || n < 0) return '0';
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

/**
 * Format USD cost.
 */
export function formatCost(usd) {
  if (!usd || usd < 0) return '$0.00';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

const STATUS_EMOJI = {
  running: '\u{1f7e2}',    // green circle
  completed: '\u2705',      // check mark
  crashed: '\u{1f534}',     // red circle
  killed: '\u26d4',          // no entry
  starting: '\u{1f7e1}',    // yellow circle
  stopped: '\u26ab',         // black circle
};

/**
 * Get emoji for agent status.
 */
export function statusEmoji(status) {
  return STATUS_EMOJI[status] || '\u2753'; // question mark fallback
}

/**
 * Convert a daemon broadcast event into a human-readable one-liner summary.
 * Returns null if the event shouldn't generate a notification.
 */
export function eventToSummary(event) {
  switch (event.type) {
    case 'agent:exit': {
      const status = event.status || 'unknown';
      const emoji = statusEmoji(status);
      const id = event.agentId ? ` (${event.agentId})` : '';
      return `${emoji} Agent${id} ${status}`;
    }

    case 'approval:request': {
      const d = event.data || {};
      const name = d.agentName || d.agentId || 'unknown';
      const desc = d.action?.description || 'action pending';
      return `\u{1f6a8} Approval needed — ${name}: ${truncate(desc, 200)}`;
    }

    case 'approval:resolved': {
      const d = event.data || {};
      const status = d.status || 'resolved';
      const name = d.agentName || d.agentId || 'unknown';
      return `${status === 'approved' ? '\u2705' : '\u274c'} Approval ${status} — ${name}`;
    }

    case 'conflict:detected': {
      const d = event.data || event;
      return `\u26a0\ufe0f Scope conflict: ${d.agentName || 'agent'} tried to modify ${d.filePath || 'file'} (owned by ${d.ownerName || 'another agent'})`;
    }

    case 'rotation:start':
      return `\u{1f504} Rotating ${event.agentName || 'agent'}...`;

    case 'rotation:complete': {
      const saved = event.tokensSaved ? ` (saved ${formatTokens(event.tokensSaved)} tokens)` : '';
      return `\u{1f504} Rotated ${event.agentName || 'agent'}${saved}`;
    }

    case 'rotation:failed':
      return `\u274c Rotation failed: ${truncate(event.error, 200)}`;

    case 'phase2:spawned':
      return `\u{1f195} QC agent spawned: ${event.name || 'qc'}`;

    case 'schedule:execute':
      return `\u23f0 Scheduled agent spawned (schedule: ${event.scheduleId || 'unknown'})`;

    case 'qc:activated':
      return `\u{1f6e1}\ufe0f QC activated — ${event.agentCount || '4+'} agents running`;

    case 'journalist:cycle': {
      const d = event.data || {};
      const summary = d.lastSynthesis || d.summary;
      if (summary) return `\u{1f4f0} Journalist: ${truncate(summary, 500)}`;
      return `\u{1f4f0} Journalist cycle #${d.cycleCount || d.cycle || '?'}`;
    }

    case 'team:created':
      return `\u{1f4c1} Team created: ${event.team?.name || 'unnamed'}`;

    case 'team:deleted':
      return `\u{1f5d1}\ufe0f Team deleted (agents moved to default)`;

    default:
      return null;
  }
}

/**
 * Format an agent list for display in chat.
 * Returns a multi-line string.
 */
export function agentListText(agents) {
  if (!agents || agents.length === 0) return 'No agents running.';

  const lines = agents.map((a) => {
    const emoji = statusEmoji(a.status);
    const tokens = a.tokensUsed ? ` | ${formatTokens(a.tokensUsed)} tokens` : '';
    const ctx = a.contextUsage ? ` | ctx ${Math.round(a.contextUsage * 100)}%` : '';
    return `${emoji} ${a.name || a.id} (${a.role})${tokens}${ctx}`;
  });

  return lines.join('\n');
}

/**
 * Format a daemon status summary for chat.
 */
export function statusText(agents, uptime) {
  const running = agents.filter((a) => a.status === 'running' || a.status === 'starting');
  const completed = agents.filter((a) => a.status === 'completed');
  const crashed = agents.filter((a) => a.status === 'crashed');

  const lines = [
    `Groove Daemon — ${formatDuration(uptime)} uptime`,
    `Agents: ${running.length} running, ${completed.length} completed, ${crashed.length} crashed`,
  ];

  if (running.length > 0) {
    lines.push('');
    lines.push('Active:');
    for (const a of running) {
      const tokens = a.tokensUsed ? ` | ${formatTokens(a.tokensUsed)}` : '';
      lines.push(`  ${statusEmoji(a.status)} ${a.name || a.id} (${a.role})${tokens}`);
    }
  }

  return lines.join('\n');
}

/**
 * Format a list of approvals for chat.
 */
export function approvalsText(approvals) {
  if (!approvals || approvals.length === 0) return 'No pending approvals.';

  return approvals.map((a) => {
    const desc = a.action?.description || 'action pending';
    return `\u{1f6a8} [${a.id}] ${a.agentName || a.agentId}: ${truncate(desc, 150)}`;
  }).join('\n');
}

/**
 * Format a list of teams for chat.
 */
export function teamsText(teams) {
  if (!teams || teams.length === 0) return 'No teams.';
  return teams.map((t) => `\u{1f4c1} ${t.name}${t.isDefault ? ' (default)' : ''} — ${t.agentCount || 0} agents`).join('\n');
}

/**
 * Format a list of schedules for chat.
 */
export function schedulesText(schedules) {
  if (!schedules || schedules.length === 0) return 'No schedules.';
  return schedules.map((s) => {
    const status = s.enabled ? '\u2705' : '\u26ab';
    const running = s.isRunning ? ' (running)' : '';
    return `${status} ${s.name} — ${s.cronDescription || s.cron}${running}`;
  }).join('\n');
}

/**
 * Format journalist brief for chat.
 */
export function briefText(status, lastSynthesis) {
  const lines = ['\ud83d\udcf0 Project Brief'];

  if (status) {
    const state = status.synthesizing ? 'synthesizing...' : status.running ? 'active' : 'idle';
    lines.push(`Journalist: ${state} | ${status.cycleCount || 0} cycles`);
  }

  if (lastSynthesis) {
    if (lastSynthesis.summary) {
      lines.push('');
      lines.push(lastSynthesis.summary);
    }
    if (lastSynthesis.projectMap) {
      const map = truncate(lastSynthesis.projectMap, 1500);
      lines.push('');
      lines.push(map);
    }
  } else {
    lines.push('No synthesis available yet. Journalist runs after agents produce output.');
  }

  return lines.join('\n');
}

/**
 * Format token usage summary for chat.
 */
export function tokensText(summary) {
  if (!summary) return 'No token data available.';

  const lines = [
    '\ud83d\udcca Token Usage',
    `Agents: ${summary.agentCount} | Turns: ${summary.totalTurns} | Session: ${formatDuration(summary.sessionDurationMs)}`,
    `Tokens: ${formatTokens(summary.totalTokens)} (${formatTokens(summary.totalInputTokens)} in / ${formatTokens(summary.totalOutputTokens)} out)`,
    `Cost: ${formatCost(summary.totalCostUsd)}`,
  ];

  if (summary.cacheHitRate > 0) {
    lines.push(`Cache: ${Math.round(summary.cacheHitRate * 100)}% hit rate (${formatTokens(summary.cacheReadTokens)} reads)`);
  }

  if (summary.savings && summary.savings.total > 0) {
    lines.push('');
    lines.push(`\ud83d\udcb0 Savings: ${formatTokens(summary.savings.total)} tokens (${summary.savings.percentage}%)`);
    if (summary.savings.fromRotation > 0) lines.push(`  Rotation: ${formatTokens(summary.savings.fromRotation)}`);
    if (summary.savings.fromConflictPrevention > 0) lines.push(`  Conflict prevention: ${formatTokens(summary.savings.fromConflictPrevention)}`);
    if (summary.savings.fromColdStartSkip > 0) lines.push(`  Cold-start skip: ${formatTokens(summary.savings.fromColdStartSkip)}`);
  }

  return lines.join('\n');
}

/**
 * Format agent log output for chat.
 */
export function logText(agentName, lines) {
  if (!lines || lines.length === 0) return `No log output for ${agentName}.`;
  return `\ud83d\udccb Log: ${agentName} (last ${lines.length} lines)\n\n${lines.join('\n')}`;
}

/**
 * Format a recommended team plan for chat approval.
 */
export function planText(agents, description) {
  if (!agents || agents.length === 0) return 'Empty plan.';

  const phase1 = agents.filter((a) => !a.phase || a.phase === 1);
  const phase2 = agents.filter((a) => a.phase === 2);

  const lines = [
    `\ud83d\udccb Plan: ${truncate(description || 'New project', 200)}`,
    '',
    `Team: ${agents.length} agents (${phase1.length} builders${phase2.length > 0 ? `, ${phase2.length} QC` : ''})`,
    '',
  ];

  for (const a of phase1) {
    const scope = a.scope?.length > 0 ? ` [${a.scope.join(', ')}]` : '';
    const model = a.model && a.model !== 'auto' ? ` (${a.model})` : '';
    lines.push(`  Phase 1: ${a.role}${model}${scope}`);
    if (a.prompt) lines.push(`    ${truncate(a.prompt, 120)}`);
  }

  for (const a of phase2) {
    lines.push(`  Phase 2: ${a.role} (auto-spawns after Phase 1)`);
    if (a.prompt) lines.push(`    ${truncate(a.prompt, 120)}`);
  }

  return lines.join('\n');
}
