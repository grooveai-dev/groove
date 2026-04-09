// GROOVE — Teams (Live Agent Groups)
// FSL-1.1-Apache-2.0 — see LICENSE

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { randomUUID } from 'crypto';
import { validateTeamName } from './validate.js';

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
    const hasDefault = [...this.teams.values()].some((t) => t.isDefault);
    if (!hasDefault) {
      const id = randomUUID().slice(0, 8);
      const team = { id, name: 'Default', isDefault: true, createdAt: new Date().toISOString() };
      this.teams.set(id, team);
      this._save();
    }
  }

  create(name) {
    validateTeamName(name);
    const id = randomUUID().slice(0, 8);
    const team = { id, name, isDefault: false, createdAt: new Date().toISOString() };
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

  rename(id, name) {
    validateTeamName(name);
    const team = this.teams.get(id);
    if (!team) throw new Error('Team not found');
    team.name = name;
    this._save();
    this.daemon.broadcast({ type: 'team:updated', team });
    return team;
  }

  delete(id) {
    const team = this.teams.get(id);
    if (!team) throw new Error('Team not found');
    if (team.isDefault) throw new Error('Cannot delete the default team');

    const defaultTeam = this.getDefault();
    const agents = this.daemon.registry.getAll().filter((a) => a.teamId === id);
    for (const agent of agents) {
      this.daemon.registry.update(agent.id, { teamId: defaultTeam.id });
    }

    this.teams.delete(id);
    this._save();
    this.daemon.broadcast({ type: 'team:deleted', teamId: id, movedTo: defaultTeam.id });
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
