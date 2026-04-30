// GROOVE — Teams (Live Agent Groups)
// FSL-1.1-Apache-2.0 — see LICENSE

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, rmSync, readdirSync, cpSync } from 'fs';
import { resolve } from 'path';
import { randomUUID } from 'crypto';
import { validateTeamName, validateTeamMode } from './validate.js';

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
        mode: 'sandbox',
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
  create(name, { mode = 'sandbox' } = {}) {
    validateTeamName(name);
    mode = validateTeamMode(mode);
    const id = randomUUID().slice(0, 8);

    let workingDir;
    if (mode === 'production') {
      workingDir = this.daemon.projectDir;
    } else {
      const dirName = slugify(name);
      workingDir = resolve(this.daemon.projectDir, dirName);
      mkdirSync(workingDir, { recursive: true });
    }

    const team = {
      id,
      name,
      isDefault: false,
      mode,
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

    // Production teams use the project root — never rename directories
    // Rename the directory if it was auto-managed (under projectDir)
    if (team.workingDir && !team.isDefault && team.mode !== 'production') {
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
   * Archive a team — kills its agents, moves its directory to archived-teams/,
   * stores metadata.json for later restore.
   */
  archive(id) {
    const team = this.teams.get(id);
    if (!team) throw new Error('Team not found');

    const agents = this._killAndRemoveAgents(id);

    try {
      const archiveDir = resolve(this.daemon.grooveDir, 'archived-teams');
      mkdirSync(archiveDir, { recursive: true });
      const slug = slugify(team.name);
      const archiveName = `${slug}-${Date.now()}`;
      const archivePath = resolve(archiveDir, archiveName);

      if (team.mode === 'production') {
        // Production teams: metadata-only archive (no directory move)
        mkdirSync(archivePath, { recursive: true });
        const metadata = {
          originalName: team.name,
          originalId: team.id,
          mode: team.mode,
          deletedAt: new Date().toISOString(),
          agentCount: agents.length,
          originalWorkingDir: team.workingDir,
        };
        writeFileSync(resolve(archivePath, 'metadata.json'), JSON.stringify(metadata, null, 2));
      } else if (
        team.workingDir &&
        team.workingDir !== this.daemon.projectDir &&
        existsSync(team.workingDir)
      ) {
        try {
          renameSync(team.workingDir, archivePath);
        } catch (err) {
          if (err.code === 'EXDEV') {
            cpSync(team.workingDir, archivePath, { recursive: true });
            rmSync(team.workingDir, { recursive: true, force: true });
          } else {
            throw err;
          }
        }

        const metadata = {
          originalName: team.name,
          originalId: team.id,
          mode: team.mode || 'sandbox',
          deletedAt: new Date().toISOString(),
          agentCount: agents.length,
          originalWorkingDir: team.workingDir,
        };
        writeFileSync(resolve(archivePath, 'metadata.json'), JSON.stringify(metadata, null, 2));
      }
    } catch (err) {
      console.log(`[Groove:Teams] Failed to archive directory: ${err.message}`);
    }

    this._removeTeamAndCleanup(team, id);
    return true;
  }

  /**
   * Delete a team — kills its agents, removes its directory permanently.
   * If permanent is false (default), delegates to archive() instead.
   */
  delete(id, { permanent = false } = {}) {
    if (!permanent) return this.archive(id);

    const team = this.teams.get(id);
    if (!team) throw new Error('Team not found');

    this._killAndRemoveAgents(id);

    if (
      team.workingDir &&
      team.workingDir !== this.daemon.projectDir &&
      existsSync(team.workingDir)
    ) {
      try {
        rmSync(team.workingDir, { recursive: true, force: true });
      } catch (err) {
        console.log(`[Groove:Teams] Failed to delete directory: ${err.message}`);
      }
    }

    this._removeTeamAndCleanup(team, id);
    return true;
  }

  _killAndRemoveAgents(teamId) {
    const agents = this.daemon.registry.getAll().filter((a) => a.teamId === teamId);
    for (const agent of agents) {
      if (agent.status === 'running' || agent.status === 'starting') {
        try { this.daemon.processes.kill(agent.id); } catch { /* ignore */ }
      }
    }
    for (const agent of agents) {
      this.daemon.registry.remove(agent.id);
    }
    return agents;
  }

  _removeTeamAndCleanup(team, id) {
    this.teams.delete(id);
    this._save();
    this.daemon.broadcast({ type: 'team:deleted', teamId: id });

    if (team.isDefault) {
      this._ensureDefault();
      const fresh = this.getDefault();
      if (fresh) this.daemon.broadcast({ type: 'team:created', team: fresh });
    }

    try { this.daemon._gc(); } catch { /* gc should never block deletion */ }
  }

  listArchived() {
    const archiveDir = resolve(this.daemon.grooveDir, 'archived-teams');
    if (!existsSync(archiveDir)) return [];
    const entries = readdirSync(archiveDir, { withFileTypes: true });
    const result = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const metaPath = resolve(archiveDir, entry.name, 'metadata.json');
      try {
        const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
        result.push({ id: entry.name, ...meta });
      } catch {
        result.push({ id: entry.name, originalName: entry.name, deletedAt: null, agentCount: 0 });
      }
    }
    return result;
  }

  restore(archivedId) {
    const archiveDir = resolve(this.daemon.grooveDir, 'archived-teams');
    const archivePath = resolve(archiveDir, archivedId);
    if (!existsSync(archivePath)) throw new Error('Archived team not found');

    let meta = {};
    const metaPath = resolve(archivePath, 'metadata.json');
    try { meta = JSON.parse(readFileSync(metaPath, 'utf8')); } catch { /* use defaults */ }

    const name = meta.originalName || archivedId;
    const mode = meta.mode || 'sandbox';

    let workingDir;
    if (mode === 'production') {
      workingDir = this.daemon.projectDir;
      // Production archive is metadata-only — just remove the archive directory
      try { rmSync(archivePath, { recursive: true, force: true }); } catch { /* ignore */ }
    } else {
      workingDir = meta.originalWorkingDir || resolve(this.daemon.projectDir, slugify(name));

      if (existsSync(workingDir)) {
        workingDir = resolve(this.daemon.projectDir, `${slugify(name)}-${Date.now()}`);
      }

      try {
        renameSync(archivePath, workingDir);
      } catch (err) {
        if (err.code === 'EXDEV') {
          cpSync(archivePath, workingDir, { recursive: true });
          rmSync(archivePath, { recursive: true, force: true });
        } else {
          throw err;
        }
      }

      // Remove the metadata file from the restored directory
      const restoredMetaPath = resolve(workingDir, 'metadata.json');
      try { rmSync(restoredMetaPath); } catch { /* may not exist */ }
    }

    const id = randomUUID().slice(0, 8);
    const team = {
      id,
      name,
      isDefault: false,
      mode,
      workingDir,
      createdAt: new Date().toISOString(),
    };
    this.teams.set(id, team);
    this._save();
    this.daemon.broadcast({ type: 'team:created', team });
    return team;
  }

  purge(archivedId) {
    const archiveDir = resolve(this.daemon.grooveDir, 'archived-teams');
    const archivePath = resolve(archiveDir, archivedId);
    if (!existsSync(archivePath)) throw new Error('Archived team not found');
    rmSync(archivePath, { recursive: true, force: true });
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

  promote(id) {
    const team = this.teams.get(id);
    if (!team) throw new Error('Team not found');
    if (team.mode === 'production') throw new Error('Team is already in production mode');

    const oldDir = team.workingDir;
    const targetDir = this.daemon.projectDir;

    const entries = readdirSync(oldDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === '.groove') continue;
      const src = resolve(oldDir, entry.name);
      const dest = resolve(targetDir, entry.name);
      cpSync(src, dest, { recursive: true, force: true });
    }

    rmSync(oldDir, { recursive: true, force: true });

    const agents = this.daemon.registry.getAll().filter((a) => a.teamId === id);
    for (const agent of agents) {
      if (agent.workingDir === oldDir) {
        this.daemon.registry.update(agent.id, { workingDir: targetDir });
      }
    }

    const wasDefault = team.isDefault;
    this.teams.delete(id);
    this._save();
    this.daemon.broadcast({ type: 'team:deleted', teamId: id });

    if (wasDefault) {
      this._ensureDefault();
      const fresh = this.getDefault();
      if (fresh) this.daemon.broadcast({ type: 'team:created', team: fresh });
    }

    return { promoted: true, destination: targetDir };
  }

  // Backward compat stubs
  onAgentChange() {}
  getActiveTeam() { return this.getDefault()?.name || null; }
}
