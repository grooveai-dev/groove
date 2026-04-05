// GROOVE — File Lock Manager
// FSL-1.1-Apache-2.0 — see LICENSE

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { minimatch } from 'minimatch';

export class LockManager {
  constructor(grooveDir) {
    this.path = resolve(grooveDir, 'locks.json');
    this.locks = new Map(); // agentId -> glob patterns[]
    this.load();
  }

  load() {
    if (existsSync(this.path)) {
      try {
        const data = JSON.parse(readFileSync(this.path, 'utf8'));
        for (const [id, patterns] of Object.entries(data)) {
          this.locks.set(id, patterns);
        }
      } catch {
        // Start fresh
      }
    }
  }

  save() {
    const obj = Object.fromEntries(this.locks);
    writeFileSync(this.path, JSON.stringify(obj, null, 2));
  }

  register(agentId, patterns) {
    this.locks.set(agentId, patterns);
    this.save();
  }

  release(agentId) {
    this.locks.delete(agentId);
    this.save();
  }

  check(agentId, filePath) {
    for (const [ownerId, patterns] of this.locks) {
      if (ownerId === agentId) continue;
      for (const pattern of patterns) {
        if (minimatch(filePath, pattern)) {
          return { conflict: true, owner: ownerId, pattern };
        }
      }
    }
    return { conflict: false };
  }

  getAll() {
    return Object.fromEntries(this.locks);
  }
}
