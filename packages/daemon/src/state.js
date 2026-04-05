// GROOVE — State Persistence
// FSL-1.1-Apache-2.0 — see LICENSE

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';

export class StateManager {
  constructor(grooveDir) {
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

  save() {
    writeFileSync(this.path, JSON.stringify(this.data, null, 2));
  }

  get(key) {
    return this.data[key];
  }

  set(key, value) {
    this.data[key] = value;
  }
}
