// GROOVE — Timeline Tracker for historical charts and lifecycle events
// FSL-1.1-Apache-2.0 — see LICENSE

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { writeFile } from 'fs/promises';
import { resolve } from 'path';

const MAX_SNAPSHOTS = 2000;
const MAX_EVENTS = 500;
const SNAPSHOT_INTERVAL = 30_000; // 30 seconds

export class TimelineTracker {
  constructor(daemon) {
    this.daemon = daemon;
    this.path = resolve(daemon.grooveDir, 'timeline.json');
    this.snapshots = [];
    this.events = [];
    this.interval = null;
    this._dirty = false;
    this._writing = false;
    this.load();
  }

  load() {
    if (existsSync(this.path)) {
      try {
        const data = JSON.parse(readFileSync(this.path, 'utf8'));
        this.snapshots = data.snapshots || [];
        this.events = data.events || [];
      } catch {
        this.snapshots = [];
        this.events = [];
      }
    }
  }

  save() {
    writeFileSync(this.path, JSON.stringify({
      snapshots: this.snapshots,
      events: this.events,
    }, null, 2));
    this._dirty = false;
  }

  async _saveAsync() {
    if (this._writing) return;
    this._writing = true;
    try {
      await writeFile(this.path, JSON.stringify({
        snapshots: this.snapshots,
        events: this.events,
      }, null, 2));
      this._dirty = false;
    } catch { /* best effort */ }
    this._writing = false;
  }

  start() {
    this.snapshot(); // take initial snapshot
    this.interval = setInterval(() => this.snapshot(), SNAPSHOT_INTERVAL);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.save();
  }

  snapshot() {
    if (!this._dirty) {
      const agents = this.daemon.registry.getAll();
      const running = agents.filter((a) => a.status === 'running').length;
      if (running === 0 && this.snapshots.length > 0) return;
    }

    const agents = this.daemon.registry.getAll();
    const entry = {
      t: Date.now(),
      tokens: this.daemon.tokens.getTotal(),
      costUsd: this.daemon.tokens.getTotalCost(),
      agents: agents.length,
      running: agents.filter((a) => a.status === 'running').length,
      cacheHitRate: this.daemon.tokens.getCacheHitRate(),
    };
    this.snapshots.push(entry);
    if (this.snapshots.length > MAX_SNAPSHOTS) {
      this.snapshots = this.snapshots.slice(-MAX_SNAPSHOTS);
    }
    this._dirty = true;
    this._saveAsync();
  }

  recordEvent(type, data) {
    this.events.push({ t: Date.now(), type, ...data });
    if (this.events.length > MAX_EVENTS) {
      this.events = this.events.slice(-MAX_EVENTS);
    }
    this._dirty = true;
    this._saveAsync();
  }

  getSnapshots(limit = 200) {
    return this.snapshots.slice(-limit);
  }

  getEvents(limit = 100) {
    return this.events.slice(-limit);
  }
}
