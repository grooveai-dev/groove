// FSL-1.1-Apache-2.0 — see LICENSE

import { resolve } from 'path';
import { existsSync, renameSync } from 'fs';
import { sanitizeFilename } from './process.js';

/**
 * Rename an agent, migrating everything keyed by its name.
 *
 * Agent logs, personalities and scratch files are keyed by NAME rather than id
 * on purpose — rotation mints a new id, and name-keying is what carries an
 * agent's history across it (see agentLogPath in process.js). The cost is that
 * a bare rename orphans all of it, and the log GC then deletes the orphan. So
 * a rename has to move those artifacts itself.
 *
 * Note the live process keeps the old name in its env (GROOVE_AGENT_NAME) and
 * system prompt until it next respawns — the daemon-side view is what changes.
 */
export function renameAgent(daemon, agentId, newName) {
  const agent = daemon.registry.get(agentId);
  if (!agent) throw new Error('Agent not found');

  const trimmed = String(newName || '').trim();
  if (!trimmed) throw new Error('name is required');

  // The name becomes a path segment (agent-files/<name>, personalities/<name>.md),
  // so anything with a separator or a dot-segment would escape the directory.
  if (!/^[A-Za-z0-9._-]+$/.test(trimmed) || /^\.+$/.test(trimmed)) {
    throw new Error('name may only contain letters, numbers, dots, dashes and underscores');
  }
  if (trimmed.length > 64) throw new Error('name must be 64 characters or fewer');

  if (trimmed === agent.name) return agent;

  // Two agents sharing a name means two agents sharing one log file.
  const collision = daemon.registry.getAll()
    .some((a) => a.id !== agentId && a.name === trimmed);
  if (collision) throw new Error(`An agent named ${trimmed} already exists`);

  const oldName = agent.name;
  const { grooveDir, projectDir } = daemon;

  const moves = [
    // Raw log — the one whose loss breaks chat resume and synthesis.
    [resolve(grooveDir, 'logs', `${sanitizeFilename(oldName)}.log`),
     resolve(grooveDir, 'logs', `${sanitizeFilename(trimmed)}.log`)],
    [resolve(grooveDir, 'personalities', `${oldName}.md`),
     resolve(grooveDir, 'personalities', `${trimmed}.md`)],
    [resolve(projectDir, 'agent-files', oldName),
     resolve(projectDir, 'agent-files', trimmed)],
  ];

  const moved = [];
  try {
    for (const [from, to] of moves) {
      if (!existsSync(from) || existsSync(to)) continue;
      renameSync(from, to);
      moved.push([from, to]);
    }
  } catch (err) {
    // Roll back so a partial migration can't leave artifacts split across
    // two names — that's the state the GC would then eat.
    for (const [from, to] of moved.reverse()) {
      try { renameSync(to, from); } catch { /* best effort */ }
    }
    throw new Error(`Rename failed while migrating files: ${err.message}`);
  }

  const updated = daemon.registry.update(agentId, { name: trimmed }, { allowRename: true });
  daemon.audit.log('agent.rename', { id: agentId, from: oldName, to: trimmed });
  return updated;
}
