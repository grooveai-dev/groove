// GROOVE — File Watcher (per-file fs.watch + debounced WS broadcast)
// FSL-1.1-Apache-2.0 — see LICENSE

import { watch } from 'fs';
import { resolve } from 'path';

export class FileWatcher {
  constructor(daemon) {
    this.daemon = daemon;
    this.watchers = new Map(); // relPath → { watcher, timer }
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

  unwatchAll() {
    for (const [relPath] of this.watchers) {
      this.unwatch(relPath);
    }
  }
}
