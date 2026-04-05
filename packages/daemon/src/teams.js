// GROOVE — Teams (Saved Agent Configurations)
// FSL-1.1-Apache-2.0 — see LICENSE

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import { resolve } from 'path';
import { validateTeamName, sanitizeForFilename, validateAgentConfig } from './validate.js';

export class Teams {
  constructor(daemon) {
    this.daemon = daemon;
    this.teamsDir = resolve(daemon.grooveDir, 'teams');
    this.activeTeam = null; // Name of the currently active team
    this.autoSave = false;

    mkdirSync(this.teamsDir, { recursive: true });
  }

  // Save current agents as a team
  save(name) {
    validateTeamName(name);

    const agents = this.daemon.registry.getAll();
    if (agents.length === 0) throw new Error('No agents to save');

    const team = {
      name,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      agents: agents.map((a) => ({
        role: a.role,
        scope: a.scope,
        provider: a.provider,
        model: a.model,
        prompt: a.prompt,
        name: a.name,
      })),
    };

    const path = resolve(this.teamsDir, `${this.sanitizeName(name)}.json`);
    writeFileSync(path, JSON.stringify(team, null, 2));

    this.activeTeam = name;
    this.autoSave = true;

    return team;
  }

  // Load a team — spawns all agents from config
  async load(name) {
    const team = this.get(name);
    if (!team) throw new Error(`Team "${name}" not found`);

    // Kill all running agents first
    await this.daemon.processes.killAll();

    // Clear registry of old entries
    const old = this.daemon.registry.getAll();
    for (const a of old) this.daemon.registry.remove(a.id);

    // Spawn all agents from team config
    const spawned = [];
    for (const config of team.agents) {
      try {
        const agent = await this.daemon.processes.spawn(config);
        spawned.push(agent);
      } catch (err) {
        console.error(`  Failed to spawn ${config.name || config.role}:`, err.message);
      }
    }

    this.activeTeam = name;
    this.autoSave = true;

    this.daemon.broadcast({
      type: 'team:loaded',
      name,
      agentCount: spawned.length,
    });

    return { name, agents: spawned };
  }

  // Get a team definition by name
  get(name) {
    const path = resolve(this.teamsDir, `${this.sanitizeName(name)}.json`);
    if (!existsSync(path)) return null;
    try {
      return JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      return null;
    }
  }

  // List all saved teams
  list() {
    if (!existsSync(this.teamsDir)) return [];

    return readdirSync(this.teamsDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        try {
          const data = JSON.parse(readFileSync(resolve(this.teamsDir, f), 'utf8'));
          return {
            name: data.name,
            agents: data.agents?.length || 0,
            createdAt: data.createdAt,
            updatedAt: data.updatedAt,
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  // Delete a team
  delete(name) {
    const path = resolve(this.teamsDir, `${this.sanitizeName(name)}.json`);
    if (!existsSync(path)) throw new Error(`Team "${name}" not found`);
    unlinkSync(path);
    if (this.activeTeam === name) {
      this.activeTeam = null;
      this.autoSave = false;
    }
    return true;
  }

  // Export team as portable JSON string
  export(name) {
    const team = this.get(name);
    if (!team) throw new Error(`Team "${name}" not found`);
    return JSON.stringify(team, null, 2);
  }

  // Import team from JSON string
  import(jsonStr) {
    let team;
    try {
      team = JSON.parse(jsonStr);
    } catch {
      throw new Error('Invalid JSON');
    }

    if (!team.name || !Array.isArray(team.agents)) {
      throw new Error('Invalid team format: needs "name" and "agents" array');
    }

    validateTeamName(team.name);

    if (team.agents.length > 20) {
      throw new Error('Too many agents in team (max 20)');
    }

    // Validate each agent config
    for (const a of team.agents) {
      validateAgentConfig(a);
    }

    team.updatedAt = new Date().toISOString();
    const path = resolve(this.teamsDir, `${this.sanitizeName(team.name)}.json`);
    writeFileSync(path, JSON.stringify(team, null, 2));

    return team;
  }

  // Auto-save: called when agents change while a team is active
  onAgentChange() {
    if (!this.activeTeam || !this.autoSave) return;

    const agents = this.daemon.registry.getAll().filter(
      (a) => a.status === 'running' || a.status === 'starting'
    );

    if (agents.length === 0) return;

    const path = resolve(this.teamsDir, `${this.sanitizeName(this.activeTeam)}.json`);
    if (!existsSync(path)) return;

    try {
      const team = JSON.parse(readFileSync(path, 'utf8'));
      team.updatedAt = new Date().toISOString();
      team.agents = agents.map((a) => ({
        role: a.role,
        scope: a.scope,
        provider: a.provider,
        model: a.model,
        prompt: a.prompt,
        name: a.name,
      }));
      writeFileSync(path, JSON.stringify(team, null, 2));
    } catch {
      // Non-critical — don't break the flow
    }
  }

  getActiveTeam() {
    return this.activeTeam;
  }

  sanitizeName(name) {
    return sanitizeForFilename(name);
  }
}
