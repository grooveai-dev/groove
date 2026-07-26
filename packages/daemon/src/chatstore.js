// FSL-1.1-Apache-2.0 — see LICENSE

import { resolve } from 'path';
import { existsSync, readFileSync, writeFileSync, renameSync } from 'fs';

// Per-agent history cap and attachment handling mirror the GUI's own limits so
// the two stay in step.
const MAX_PER_AGENT = 200;
const SAVE_DEBOUNCE_MS = 1500;

/**
 * Server-side chat history, keyed by AGENT NAME.
 *
 * Two hard-won identity lessons live here:
 *
 * 1. localStorage is per-origin (scheme://host:PORT), and a tunnelled GUI's
 *    port changes across reconnects — so history kept only in the browser gets
 *    stranded on dead origins. Hence a server-side store at all.
 *
 * 2. Agent IDs are NOT stable: every rotation/resume mints a new id. A store
 *    keyed by id fragments on every rotation — the full history stays under
 *    the dead id while the new id starts near-empty, and a reconnect then
 *    "restores" that near-empty stub over the user's real history. The agent
 *    NAME survives rotation (the Watch system keys by name for the same
 *    reason), so name is the identity here. IDs are accepted at the API edge
 *    and resolved immediately.
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

  // Resolve an id-or-name to the stable storage key (the agent's name).
  // Unknown refs are used verbatim so nothing is ever dropped — an orphaned
  // id key re-merges at boot once its agent is known, or stays parked.
  _keyFor(ref) {
    if (!ref) return null;
    const byId = this.daemon.registry?.get?.(ref);
    if (byId?.name) return byId.name;
    return String(ref);
  }

  /**
   * Fold any id-keyed entries into their agent's name key. Runs at boot (after
   * registry restore) so stores written by the old id-keyed code reattach to
   * the agent wherever the id is still resolvable.
   */
  migrate() {
    const agents = this.daemon.registry?.getAll?.() || [];
    const byId = new Map(agents.map((a) => [a.id, a]));
    let moved = 0;
    for (const key of Object.keys(this.history)) {
      const agent = byId.get(key);
      if (!agent || agent.name === key) continue;
      this.history[agent.name] = mergeMessages(this.history[agent.name], this.history[key]);
      delete this.history[key];
      moved += 1;
    }
    if (moved) this._scheduleSave();
    return moved;
  }

  /**
   * Rotation-time hook: an entry parked under a dead id (written by the old
   * id-keyed code, or by an old GUI posting under ids) follows the agent to
   * its new identity.
   */
  remap(oldRef, newRef) {
    const oldKey = String(oldRef);
    const newKey = this._keyFor(newRef);
    if (!newKey || oldKey === newKey || !this.history[oldKey]) return;
    this.history[newKey] = mergeMessages(this.history[newKey], this.history[oldKey]);
    delete this.history[oldKey];
    this._scheduleSave();
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

  append(ref, message) {
    const key = this._keyFor(ref);
    if (!key) return;
    const clean = this._clean(message);
    if (!clean) return;
    const arr = this.history[key] || [];
    arr.push(clean);
    this.history[key] = arr.slice(-MAX_PER_AGENT);
    this._scheduleSave();
  }

  /**
   * Merge a batch from a client. This is a UNION by (timestamp, from, text) —
   * never a replace — so a browser holding messages the server missed adds
   * them, and a browser with less than the server can never truncate it.
   * A "restore" must be incapable of destroying what it restores from.
   */
  merge(ref, messages) {
    const key = this._keyFor(ref);
    if (!key || !Array.isArray(messages)) return;
    const incoming = messages.map((m) => this._clean(m)).filter(Boolean);
    this.history[key] = mergeMessages(this.history[key], incoming);
    this._scheduleSave();
  }

  /**
   * History for the GUI: live agents keyed by their CURRENT id (what the GUI
   * looks up by), everything else under its stored name key so an agent
   * respawned under the same name picks its history back up.
   */
  view() {
    const out = {};
    const agents = this.daemon.registry?.getAll?.() || [];
    const liveNames = new Map(agents.map((a) => [a.name, a.id]));
    for (const [key, msgs] of Object.entries(this.history)) {
      if (!Array.isArray(msgs) || !msgs.length) continue;
      out[liveNames.get(key) || key] = msgs;
    }
    return out;
  }

  getAll() {
    return this.history;
  }

  get(ref) {
    return this.history[this._keyFor(ref)] || [];
  }

  remove(ref) {
    const key = this._keyFor(ref);
    if (key && this.history[key]) {
      delete this.history[key];
      this._scheduleSave();
    }
  }

  stop() {
    if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
    this._saveNow();
  }
}

// Union of two message arrays, deduped on (timestamp, from, text), time-sorted,
// capped. Exported for tests and the migration path.
export function mergeMessages(a, b) {
  const seen = new Set();
  const out = [];
  for (const m of [...(a || []), ...(b || [])]) {
    if (!m || typeof m !== 'object') continue;
    const sig = `${m.timestamp}:${m.from}:${typeof m.text === 'string' ? m.text.slice(0, 200) : ''}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push(m);
  }
  out.sort((x, y) => (x.timestamp || 0) - (y.timestamp || 0));
  return out.slice(-MAX_PER_AGENT);
}
