// GROOVE — State Persistence
// FSL-1.1-Apache-2.0 — see LICENSE

import { readFileSync, existsSync, readdirSync, unlinkSync } from 'fs';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'path';

export class StateManager {
  constructor(grooveDir) {
    this.grooveDir = grooveDir;
    this.path = resolve(grooveDir, 'state.json');
    this.data = {};
  }

  load() {
    if (existsSync(this.path)) {
      try {
        this.data = JSON.parse(readFileSync(this.path, 'utf8'));
      } catch {
        this.data = {};
      }
    }
  }

  async save() {
    await writeFile(this.path, JSON.stringify(this.data, null, 2));
  }

  get(key) {
    return this.data[key];
  }

  set(key, value) {
    this.data[key] = value;
  }

  getResumableSessions() {
    const sessionsDir = resolve(this.grooveDir, 'sessions');
    if (!existsSync(sessionsDir)) return [];
    try {
      return readdirSync(sessionsDir)
        .filter(f => f.endsWith('.json'))
        .map(f => f.replace('.json', ''));
    } catch { return []; }
  }

  cleanupSessions(agentIds) {
    const sessionsDir = resolve(this.grooveDir, 'sessions');
    for (const id of agentIds) {
      const sessionPath = resolve(sessionsDir, `${id}.json`);
      try { if (existsSync(sessionPath)) unlinkSync(sessionPath); } catch { /* non-fatal */ }
    }
  }
}
