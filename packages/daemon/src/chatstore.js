// FSL-1.1-Apache-2.0 — see LICENSE

import { resolve } from 'path';
import { existsSync, readFileSync, writeFileSync, renameSync } from 'fs';

// Per-agent history cap and attachment handling mirror the GUI's own limits so
// the two stay in step.
const MAX_PER_AGENT = 200;
const SAVE_DEBOUNCE_MS = 1500;

/**
 * Server-side chat history.
 *
 * The GUI used to keep chat history only in the browser's localStorage, which
 * is scoped per origin (scheme://host:PORT). For a remote GUI reached over an
 * SSH tunnel the local port changes across reconnects, so the origin — and thus
 * the entire chat store — changed out from under the user, stranding history on
 * old ports. Keeping it on the daemon makes it independent of port, origin, and
 * even which machine connects: reconnect from anywhere and the chats are there.
 */
export class ChatStore {
  constructor(daemon) {
    this.daemon = daemon;
    this.path = resolve(daemon.grooveDir, 'chat-history.json');
    this.history = this._load();
    this._saveTimer = null;
  }

  _load() {
    try {
      if (existsSync(this.path)) {
        const data = JSON.parse(readFileSync(this.path, 'utf8'));
        if (data && typeof data === 'object') return data;
      }
    } catch { /* corrupt or missing — start empty rather than throw */ }
    return {};
  }

  _scheduleSave() {
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this._saveNow();
    }, SAVE_DEBOUNCE_MS);
    if (this._saveTimer.unref) this._saveTimer.unref();
  }

  _saveNow() {
    try {
      const tmp = `${this.path}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.history), { mode: 0o600 });
      renameSync(tmp, this.path); // atomic — a reader never sees a half-written file
    } catch { /* best effort */ }
  }

  // Strip base64 attachment payloads — metadata only. Keeping data URLs would
  // bloat the file the same way it bloated localStorage.
  _clean(message) {
    if (!message || typeof message !== 'object') return null;
    const out = { ...message };
    if (Array.isArray(out.attachments) && out.attachments.length) {
      out.attachments = out.attachments.map(({ dataUrl, ...rest }) => rest);
    }
    return out;
  }

  append(agentId, message) {
    if (!agentId) return;
    const clean = this._clean(message);
    if (!clean) return;
    const arr = this.history[agentId] || [];
    arr.push(clean);
    this.history[agentId] = arr.slice(-MAX_PER_AGENT);
    this._scheduleSave();
  }

  // Replace an agent's whole history — used when the GUI syncs a batch (e.g.
  // messages it recorded while briefly disconnected).
  replace(agentId, messages) {
    if (!agentId || !Array.isArray(messages)) return;
    this.history[agentId] = messages.map((m) => this._clean(m)).filter(Boolean).slice(-MAX_PER_AGENT);
    this._scheduleSave();
  }

  getAll() {
    return this.history;
  }

  get(agentId) {
    return this.history[agentId] || [];
  }

  remove(agentId) {
    if (this.history[agentId]) {
      delete this.history[agentId];
      this._scheduleSave();
    }
  }

  stop() {
    if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
    this._saveNow();
  }
}
