// GROOVE — Auto Agent State Persistence
// FSL-1.1-Apache-2.0 — see LICENSE
//
// Manages the persistent state layer for autonomous agents:
//   .groove/auto/<agentDefId>/
//     state.json    — phase, cycle, history, champion
//     journal.jsonl — append-only accumulated knowledge
//     roadmap.md    — staged goals with graduation criteria
//     prompt.md     — system prompt (identity + tools + rules)
//     runs/         — per-run logs and output

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, readdirSync, renameSync, copyFileSync, statSync, rmSync } from 'fs';
import { resolve } from 'path';
import { randomUUID } from 'crypto';

const MAX_HISTORY = 200;
const MAX_JOURNAL_ENTRIES = 500;

function safeJsonParse(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}

function safeDict(obj, key) {
  const v = obj?.[key];
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

export class AutoState {
  constructor(grooveDir) {
    this.baseDir = resolve(grooveDir, 'auto');
    mkdirSync(this.baseDir, { recursive: true });
  }

  _agentDir(defId) {
    const dir = resolve(this.baseDir, defId);
    mkdirSync(dir, { recursive: true });
    mkdirSync(resolve(dir, 'runs'), { recursive: true });
    return dir;
  }

  // --- State (state.json) ---

  getState(defId) {
    const p = resolve(this._agentDir(defId), 'state.json');
    if (!existsSync(p)) return this._defaultState();
    return safeJsonParse(readFileSync(p, 'utf8'), this._defaultState());
  }

  setState(defId, updates) {
    const dir = this._agentDir(defId);
    const p = resolve(dir, 'state.json');
    const bak = resolve(dir, 'state.json.bak');
    const current = this.getState(defId);

    const merged = { ...current };
    const allowed = ['phase', 'phase_note', 'cycle', 'current_run', 'champion', 'paused', 'error'];
    for (const key of allowed) {
      if (key in updates) merged[key] = updates[key];
    }
    merged.updatedAt = new Date().toISOString();

    if (existsSync(p)) {
      try { copyFileSync(p, bak); } catch { /* best effort */ }
    }
    const tmp = resolve(dir, `state.${randomUUID().slice(0, 8)}.tmp`);
    writeFileSync(tmp, JSON.stringify(merged, null, 2));
    renameSync(tmp, p);
    return merged;
  }

  appendHistory(defId, entry) {
    const state = this.getState(defId);
    if (!Array.isArray(state.history)) state.history = [];
    state.history.push({
      ...entry,
      timestamp: new Date().toISOString(),
    });
    if (state.history.length > MAX_HISTORY) {
      state.history = state.history.slice(-MAX_HISTORY);
    }
    this.setState(defId, { history: state.history });
    return state.history;
  }

  _defaultState() {
    return {
      phase: 'idle',
      phase_note: '',
      cycle: 0,
      current_run: null,
      champion: null,
      history: [],
      paused: false,
      error: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  // --- Journal (journal.jsonl) ---

  getJournal(defId, { limit = 50, since } = {}) {
    const p = resolve(this._agentDir(defId), 'journal.jsonl');
    if (!existsSync(p)) return [];
    const lines = readFileSync(p, 'utf8').trim().split('\n').filter(Boolean);
    let entries = lines.map(l => safeJsonParse(l, null)).filter(Boolean);
    if (since) {
      entries = entries.filter(e => e.timestamp >= since);
    }
    return entries.slice(-limit);
  }

  appendJournal(defId, entry) {
    const p = resolve(this._agentDir(defId), 'journal.jsonl');
    const record = {
      ...entry,
      timestamp: new Date().toISOString(),
    };
    appendFileSync(p, JSON.stringify(record) + '\n');
    this._pruneJournal(defId);
    return record;
  }

  _pruneJournal(defId) {
    const p = resolve(this._agentDir(defId), 'journal.jsonl');
    if (!existsSync(p)) return;
    const lines = readFileSync(p, 'utf8').trim().split('\n').filter(Boolean);
    if (lines.length > MAX_JOURNAL_ENTRIES) {
      writeFileSync(p, lines.slice(-MAX_JOURNAL_ENTRIES).join('\n') + '\n');
    }
  }

  // --- Roadmap (roadmap.md) ---

  getRoadmap(defId) {
    const p = resolve(this._agentDir(defId), 'roadmap.md');
    if (!existsSync(p)) return '';
    return readFileSync(p, 'utf8');
  }

  setRoadmap(defId, content) {
    const p = resolve(this._agentDir(defId), 'roadmap.md');
    writeFileSync(p, content);
  }

  // --- Prompt (prompt.md) ---

  getPrompt(defId) {
    const p = resolve(this._agentDir(defId), 'prompt.md');
    if (!existsSync(p)) return '';
    return readFileSync(p, 'utf8');
  }

  setPrompt(defId, content) {
    const p = resolve(this._agentDir(defId), 'prompt.md');
    writeFileSync(p, content);
  }

  // --- Run Logs ---

  logRun(defId, runId, data) {
    const dir = resolve(this._agentDir(defId), 'runs');
    const p = resolve(dir, `${runId}.json`);
    writeFileSync(p, JSON.stringify(data, null, 2));
  }

  getRunLog(defId, runId) {
    const p = resolve(this._agentDir(defId), 'runs', `${runId}.json`);
    if (!existsSync(p)) return null;
    return safeJsonParse(readFileSync(p, 'utf8'), null);
  }

  listRuns(defId, { limit = 20 } = {}) {
    const dir = resolve(this._agentDir(defId), 'runs');
    if (!existsSync(dir)) return [];
    const files = readdirSync(dir)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        const stat = statSync(resolve(dir, f));
        return { runId: f.replace('.json', ''), mtime: stat.mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, limit);
    return files.map(f => {
      const data = safeJsonParse(readFileSync(resolve(dir, `${f.runId}.json`), 'utf8'), {});
      return { runId: f.runId, ...data };
    });
  }

  // --- Cleanup ---

  deleteAll(defId) {
    const dir = resolve(this.baseDir, defId);
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}
