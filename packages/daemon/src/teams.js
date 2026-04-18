// GROOVE — Teams (Live Agent Groups)
// FSL-1.1-Apache-2.0 — see LICENSE

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, rmSync } from 'fs';
import { resolve } from 'path';
import { randomUUID } from 'crypto';
import { validateTeamName } from './validate.js';

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64) || 'team';
}

export class Teams {
  constructor(daemon) {
    this.daemon = daemon;
    this.filePath = resolve(daemon.grooveDir, 'teams.json');
    this.teams = new Map();
    this._load();
    this._ensureDefault();
  }

  _load() {
    if (!existsSync(this.filePath)) return;
    try {
      const data = JSON.parse(readFileSync(this.filePath, 'utf8'));
      if (Array.isArray(data)) {
        for (const team of data) this.teams.set(team.id, team);
      }
    } catch { /* ignore corrupt file */ }
  }

  _save() {
    writeFileSync(this.filePath, JSON.stringify([...this.teams.values()], null, 2));
  }

  _ensureDefault() {
    const defaultDir = resolve(this.daemon.projectDir, 'default');
    const existing = [...this.teams.values()].find((t) => t.isDefault);

    if (!existing) {
      try { mkdirSync(defaultDir, { recursive: true }); } catch { /* may exist */ }
      const id = randomUUID().slice(0, 8);
      const team = {
        id,
        name: 'Default',
        isDefault: true,
        workingDir: defaultDir,
        createdAt: new Date().toISOString(),
      };
      this.teams.set(id, team);
      this._save();
      return;
    }

    // Migrate legacy default teams that pointed at the project root — give them
    // their own folder so generated files don't pile up alongside source code.
    if (!existing.workingDir || existing.workingDir === this.daemon.projectDir) {
      try { mkdirSync(defaultDir, { recursive: true }); } catch { /* may exist */ }
      existing.workingDir = defaultDir;
      this._save();
    }
  }

  /**
   * Create a team with an auto-managed working directory.
   */
  create(name) {
    validateTeamName(name);
    const id = randomUUID().slice(0, 8);
    const dirName = slugify(name);
    const workingDir = resolve(this.daemon.projectDir, dirName);

    // Create the directory
    mkdirSync(workingDir, { recursive: true });

    const team = {
      id,
      name,
      isDefault: false,
      workingDir,
      createdAt: new Date().toISOString(),
    };

    this.teams.set(id, team);
    this._save();
    this.daemon.broadcast({ type: 'team:created', team });
    return team;
  }

  get(id) {
    return this.teams.get(id) || null;
  }

  list() {
    return [...this.teams.values()];
  }

  getDefault() {
    return [...this.teams.values()].find((t) => t.isDefault) || null;
  }

  /**
   * Rename a team — updates the directory name and all agent references.
   */
  rename(id, name) {
    validateTeamName(name);
    const team = this.teams.get(id);
    if (!team) throw new Error('Team not found');

    const oldName = team.name;
    team.name = name;

    // Rename the directory if it was auto-managed (under projectDir)
    if (team.workingDir && !team.isDefault) {
      const newDirName = slugify(name);
      const newWorkingDir = resolve(this.daemon.projectDir, newDirName);
      const oldWorkingDir = team.workingDir;

      if (oldWorkingDir !== newWorkingDir && existsSync(oldWorkingDir)) {
        try {
          renameSync(oldWorkingDir, newWorkingDir);
          team.workingDir = newWorkingDir;

          // Update all agents in this team with the new working directory
          const agents = this.daemon.registry.getAll().filter((a) => a.teamId === id);
          for (const agent of agents) {
            if (agent.workingDir === oldWorkingDir) {
              this.daemon.registry.update(agent.id, { workingDir: newWorkingDir });
            }
          }
        } catch (err) {
          console.log(`[Groove:Teams] Failed to rename directory: ${err.message}`);
          // Keep old dir — name still updates
        }
      }
    }

    this._save();
    this.daemon.broadcast({ type: 'team:updated', team });
    return team;
  }

  /**
   * Delete a team — kills its agents, removes its directory, drops it from the
   * registry. Deleting the default team regenerates a fresh empty one so users
   * can wipe accumulated state and keep working without restarting the daemon.
   */
  delete(id) {
    const team = this.teams.get(id);
    if (!team) throw new Error('Team not found');

    // Kill any running agents in this team
    const agents = this.daemon.registry.getAll().filter((a) => a.teamId === id);
    for (const agent of agents) {
      if (agent.status === 'running' || agent.status === 'starting') {
        try { this.daemon.processes.kill(agent.id); } catch { /* ignore */ }
      }
    }

    // Remove agents from registry
    for (const agent of agents) {
      this.daemon.registry.remove(agent.id);
    }

    // Remove the team's working directory — refuse to nuke the project root
    // (legacy default teams that were never migrated point there).
    if (
      team.workingDir &&
      team.workingDir !== this.daemon.projectDir &&
      existsSync(team.workingDir)
    ) {
      try {
        rmSync(team.workingDir, { recursive: true, force: true });
      } catch (err) {
        console.log(`[Groove:Teams] Failed to remove directory: ${err.message}`);
      }
    }

    this.teams.delete(id);
    this._save();
    this.daemon.broadcast({ type: 'team:deleted', teamId: id });

    // Always keep a default team available — regenerate one with a clean folder
    if (team.isDefault) {
      this._ensureDefault();
      const fresh = this.getDefault();
      if (fresh) this.daemon.broadcast({ type: 'team:created', team: fresh });
    }

    // Clean up orphaned logs immediately — don't wait for the 24h GC cycle
    try { this.daemon._gc(); } catch { /* gc should never block deletion */ }

    return true;
  }

  // Migrate old agents (teamName but no teamId) to default team
  migrateAgents() {
    const defaultTeam = this.getDefault();
    if (!defaultTeam) return;
    for (const agent of this.daemon.registry.getAll()) {
      if (!agent.teamId) {
        this.daemon.registry.update(agent.id, { teamId: defaultTeam.id });
      }
    }
  }

  // Backward compat stubs
  onAgentChange() {}
  getActiveTeam() { return this.getDefault()?.name || null; }
}
