// GROOVE — File Watcher (per-file fs.watch + debounced WS broadcast)
// FSL-1.1-Apache-2.0 — see LICENSE

import { watch } from 'fs';
import { resolve } from 'path';

export class FileWatcher {
  constructor(daemon) {
    this.daemon = daemon;
    this.watchers = new Map(); // relPath → { watcher, timer }
    this.dirWatchers = new Map(); // relPath → { watcher, timer }
  }

  watch(relPath) {
    if (!relPath || typeof relPath !== 'string') return;
    if (this.watchers.has(relPath)) return; // already watching

    const fullPath = resolve(this.daemon.projectDir, relPath);

    try {
      const watcher = watch(fullPath, () => {
        const entry = this.watchers.get(relPath);
        if (!entry) return;

        // Debounce 300ms — agents write in bursts
        if (entry.timer) clearTimeout(entry.timer);
        entry.timer = setTimeout(() => {
          this.daemon.broadcast({
            type: 'file:changed',
            path: relPath,
            timestamp: Date.now(),
          });
        }, 300);
      });

      watcher.on('error', () => {
        this.unwatch(relPath);
      });

      this.watchers.set(relPath, { watcher, timer: null });
    } catch {
      // File doesn't exist or not watchable — ignore
    }
  }

  unwatch(relPath) {
    const entry = this.watchers.get(relPath);
    if (!entry) return;

    if (entry.timer) clearTimeout(entry.timer);
    try { entry.watcher.close(); } catch { /* already closed */ }
    this.watchers.delete(relPath);
  }

  watchDir(relPath) {
    if (typeof relPath !== 'string') return;
    if (relPath && relPath.includes('..')) return;
    if (this.dirWatchers.has(relPath)) return;

    const fullPath = relPath ? resolve(this.daemon.projectDir, relPath) : this.daemon.projectDir;

    try {
      const watcher = watch(fullPath, () => {
        const entry = this.dirWatchers.get(relPath);
        if (!entry) return;

        if (entry.timer) clearTimeout(entry.timer);
        entry.timer = setTimeout(() => {
          this.daemon.broadcast({
            type: 'file:tree-changed',
            path: relPath,
            timestamp: Date.now(),
          });
        }, 300);
      });

      watcher.on('error', () => {
        this.unwatchDir(relPath);
      });

      this.dirWatchers.set(relPath, { watcher, timer: null });
    } catch {
      // Directory doesn't exist or not watchable — ignore
    }
  }

  unwatchDir(relPath) {
    const entry = this.dirWatchers.get(relPath);
    if (!entry) return;

    if (entry.timer) clearTimeout(entry.timer);
    try { entry.watcher.close(); } catch { /* already closed */ }
    this.dirWatchers.delete(relPath);
  }

  unwatchAll() {
    for (const [relPath] of this.watchers) {
      this.unwatch(relPath);
    }
    for (const [relPath] of this.dirWatchers) {
      this.unwatchDir(relPath);
    }
  }
}
