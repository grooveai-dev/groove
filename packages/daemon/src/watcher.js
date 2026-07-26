// FSL-1.1-Apache-2.0 — see LICENSE

import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import {
  mkdirSync, writeFileSync, readFileSync, existsSync, rmSync,
  openSync, readSync, fstatSync, closeSync,
} from 'fs';
import { resolve } from 'path';
import { deliverInstruction } from './deliver.js';

// Watches are bounded so a wedged process or a condition that never comes true
// can't poll forever or hold a slot indefinitely.
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_TIMEOUT_MS = 24 * 60 * 60 * 1000; // training can run for hours
const DEFAULT_POLL_MS = 15 * 1000;
const MIN_POLL_MS = 3 * 1000;
// Command mode just stats a sentinel file — nearly free, so poll it fast for a
// responsive wake. `until` mode spawns a shell each tick, hence the slower floor.
const COMMAND_POLL_MS = 500;
const MAX_WATCHES_PER_AGENT = 5;
const OUTPUT_TAIL = 4000;
const HISTORY_TTL_MS = 24 * 60 * 60 * 1000; // prune finished watches after a day

/**
 * Wake-on-completion for agents — durable across daemon restarts.
 *
 * An agent promises to "report back when the training finishes", but its
 * process ends when the turn does, so nothing is left to report. A Watch lives
 * in the daemon, not the agent's session: it outlives the turn, and when its
 * target finishes it resumes the agent (from `completed` if need be, via the
 * same pipe as user chat) with the outcome.
 *
 * Crucially, watches survive a daemon restart. They are persisted to disk, and:
 *   - command: the daemon launches the command DETACHED, redirecting output to
 *     a file and writing its exit code to a sentinel file when it finishes. The
 *     job keeps running if the daemon dies; on restart the watcher re-polls the
 *     sentinel and fires when it appears. This is what makes "launch a training,
 *     get notified when done" reliable even if the harness restarts underneath.
 *   - until: the daemon polls a check command for something already running and
 *     wakes the agent when the check first succeeds (exit 0). Re-polled on
 *     restart the same way.
 */
export class Watcher {
  constructor(daemon) {
    this.daemon = daemon;
    this.watches = new Map();
    this.runsDir = resolve(daemon.grooveDir, 'watch-runs');
    this.persistPath = resolve(daemon.grooveDir, 'watches.json');
    try { mkdirSync(this.runsDir, { recursive: true }); } catch { /* exists */ }
  }

  create(agentId, opts = {}) {
    const agent = this.daemon.registry.get(agentId);
    if (!agent) throw new Error('Agent not found');

    const command = typeof opts.command === 'string' ? opts.command.trim() : '';
    const until = typeof opts.until === 'string' ? opts.until.trim() : '';
    if (!command && !until) throw new Error('Provide either "command" (run it) or "until" (poll it)');
    if (command && until) throw new Error('Provide only one of "command" or "until"');

    // Re-attach, never re-execute. A daemon restart resumes the agent mid-turn,
    // so it re-issues the watch it thinks never completed — and a second copy of
    // a long job (training, benchmark) launched against the same working dir
    // corrupts the first one's output and competes for the GPU. If an identical
    // command is still running for this agent, hand back the existing watch.
    // This is the daemon-side equivalent of an flock, and it has to live here
    // because the agent cannot know a duplicate already exists.
    if (command) {
      const dup = [...this.watches.values()].find(
        (w) => w.status === 'active'
          && w.mode === 'command'
          && w.command === command
          && (w.agentName === agent.name || w.agentId === agentId)
          && this._jobAlive(w),
      );
      if (dup) {
        this.daemon.audit?.log('watch.duplicate', { id: dup.id, agent: agentId, label: dup.label });
        console.log(`[Groove:Watcher] Re-attached to running watch ${dup.id} instead of re-running: ${dup.label}`);
        return { ...this._public(dup), reattached: true };
      }
    }

    const active = [...this.watches.values()].filter((w) => w.agentId === agentId && w.status === 'active');
    if (active.length >= MAX_WATCHES_PER_AGENT) {
      throw new Error(`You already have ${MAX_WATCHES_PER_AGENT} active watches — cancel one before adding another`);
    }

    const timeoutMs = Math.min(Number(opts.timeoutMs) || DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
    const watch = {
      id: randomUUID().slice(0, 12),
      agentId,
      agentName: agent.name,
      label: (opts.label && String(opts.label).slice(0, 120)) || command || until,
      mode: command ? 'command' : 'until',
      command, until,
      cwd: agent.workingDir || this.daemon.projectDir,
      pollMs: Math.max(Number(opts.intervalMs) || DEFAULT_POLL_MS, MIN_POLL_MS),
      timeoutMs,
      status: 'active',
      createdAt: Date.now(),
      // populated for command mode:
      pid: null, outFile: null, statusFile: null,
      // runtime-only (never persisted):
      _poll: null, _deadline: null,
    };

    this.watches.set(watch.id, watch);
    if (watch.mode === 'command') this._launchDetached(watch);
    this._arm(watch);
    this._persist();

    this.daemon.audit?.log('watch.create', { id: watch.id, agent: agentId, mode: watch.mode });
    this.daemon.broadcast?.({ type: 'watch:created', data: this._public(watch) });
    return this._public(watch);
  }

  // Start the timers for an active watch (used on both create and restore).
  _arm(watch) {
    // On restore the deadline may already be in the past — fire promptly rather
    // than negative. The floor only guards against a 0/negative timer.
    const remaining = Math.max(50, watch.timeoutMs - (Date.now() - watch.createdAt));
    watch._deadline = setTimeout(() => this._fireTimeout(watch), remaining);
    const interval = watch.mode === 'command' ? COMMAND_POLL_MS : watch.pollMs;
    watch._poll = setInterval(() => this._tick(watch), interval);
    // Check immediately — the job may have finished while the daemon was down,
    // or the `until` condition may already hold.
    this._tick(watch);
  }

  // ── command mode: detached job + exit sentinel ────────────────

  _launchDetached(watch) {
    const dir = resolve(this.runsDir, watch.id);
    mkdirSync(dir, { recursive: true });
    watch.outFile = resolve(dir, 'out.log');
    watch.statusFile = resolve(dir, 'exit');
    const scriptFile = resolve(dir, 'run.sh');

    // Run the command in a SUBSHELL so its own `exit N` can't kill the wrapper
    // before the sentinel is written; tee output to a file, then atomically
    // publish the exit code so the poller never sees a half-written value.
    // Append rather than truncate: if this script is ever run twice, `>` would
    // erase the first run's record — exactly the evidence you need to work out
    // what happened. Appending keeps both.
    const script = [
      '#!/bin/sh',
      '(',
      watch.command,
      `) >> ${shq(watch.outFile)} 2>&1`,
      `echo $? > ${shq(watch.statusFile)}.tmp && mv ${shq(watch.statusFile)}.tmp ${shq(watch.statusFile)}`,
      '',
    ].join('\n');
    writeFileSync(scriptFile, script, { mode: 0o700 });

    try {
      const child = spawn('/bin/sh', [scriptFile], {
        cwd: watch.cwd,
        env: process.env,
        detached: true,      // survive daemon exit
        stdio: 'ignore',
      });
      child.unref();
      watch.pid = child.pid;
    } catch (err) {
      // Fire synchronously via the poller path so the agent still hears about it.
      watch._launchError = `Could not start the command: ${err.message}`;
    }
  }

  // Is this watch's detached job still running? Signal 0 tests for existence
  // without delivering anything. A finished job (sentinel present) is not alive
  // even if the pid happens to have been recycled by another process.
  _jobAlive(watch) {
    if (watch.mode !== 'command') return false;
    if (watch.statusFile && existsSync(watch.statusFile)) return false; // already exited
    if (!watch.pid) return false;
    try { process.kill(watch.pid, 0); return true; } catch { return false; }
  }

  // One poll iteration — checks for completion (sentinel for command mode, the
  // `until` command for until mode) and wakes the agent when it's met.
  _tick(watch) {
    if (watch.status !== 'active') return;

    if (watch._launchError) {
      this._wake(watch, { outcome: 'error', summary: watch._launchError });
      return;
    }

    if (watch.mode === 'command') {
      if (!existsSync(watch.statusFile)) return; // still running
      let code = null;
      try { code = parseInt(readFileSync(watch.statusFile, 'utf8').trim(), 10); } catch { return; }
      if (Number.isNaN(code)) return;
      this._wake(watch, {
        outcome: code === 0 ? 'success' : 'failure',
        exitCode: code,
        summary: `Finished with exit code ${code}.`,
        output: tailFile(watch.outFile, OUTPUT_TAIL),
      });
      return;
    }

    // until mode — run the check command; exit 0 means the condition holds.
    const check = spawn('/bin/sh', ['-c', watch.until], { cwd: watch.cwd, env: process.env });
    const chunks = [];
    check.stdout?.on('data', (b) => chunks.push(b));
    check.stderr?.on('data', (b) => chunks.push(b));
    check.on('error', () => { /* transient — try again next tick */ });
    check.on('close', (code) => {
      if (watch.status !== 'active') return;
      if (code === 0) {
        const output = Buffer.concat(chunks).toString('utf8').slice(-OUTPUT_TAIL).trim();
        this._wake(watch, { outcome: 'success', summary: 'Your watch condition is now true.', output });
      }
    });
  }

  // ── firing ────────────────────────────────────────────────────

  _fireTimeout(watch) {
    if (watch.status !== 'active') return;
    this._wake(watch, {
      outcome: 'timeout',
      summary: `Your watch "${watch.label}" hit its ${Math.round(watch.timeoutMs / 60000)}-minute time limit `
        + 'without finishing. It may still be running — check on it directly.',
    });
  }

  async _wake(watch, result) {
    if (watch.status !== 'active') return;
    watch.status = 'fired';
    watch.firedAt = Date.now();
    watch.result = result;
    this._disarm(watch);

    const message = this._composeMessage(watch, result);

    // Resolve by name, not the id stored at creation: over a long watch the
    // agent has very likely been chatted with and rotated to a new id. Names
    // are stable across rotation, so this follows the agent; a purged agent
    // simply doesn't resolve, rather than resurrecting a killed one.
    const target = this.daemon.registry.getAll().find((a) => a.name === watch.agentName);
    if (!target) {
      watch.status = 'undeliverable';
      watch.deliveryError = `Agent ${watch.agentName} no longer exists`;
      this.daemon.audit?.log('watch.undeliverable', { id: watch.id, reason: 'agent gone' });
    } else {
      try {
        const delivered = await deliverInstruction(this.daemon, target.id, message, { recordFeedback: false });
        watch.agentId = delivered.agentId;
        watch.status = 'delivered';
      } catch (err) {
        watch.status = 'undeliverable';
        watch.deliveryError = err.message;
        this.daemon.audit?.log('watch.undeliverable', { id: watch.id, error: err.message });
      }
    }

    this._cleanupRun(watch);
    this._persist();
    this.daemon.broadcast?.({ type: 'watch:fired', data: this._public(watch) });
  }

  _composeMessage(watch, result) {
    const lines = [`[Watch fired — "${watch.label}"]`, '', result.summary];
    if (result.output) {
      lines.push('', 'Output (tail):', '```', result.output, '```');
    }
    lines.push('', 'This is the notification you set up earlier. Continue from here and report to the user.');
    return lines.join('\n');
  }

  // ── persistence & restart recovery ────────────────────────────

  _persist() {
    try {
      const data = [...this.watches.values()].map((w) => this._serialize(w));
      writeFileSync(this.persistPath, JSON.stringify(data, null, 2), { mode: 0o600 });
    } catch { /* best effort — a lost persist just means one watch won't survive */ }
  }

  // Load persisted watches and re-arm the active ones. Called once at startup,
  // after the registry is available. This is what lets a watch survive a daemon
  // restart: the detached job kept running (or already finished), and here we
  // reconnect to its sentinel.
  restore() {
    if (!existsSync(this.persistPath)) return 0;
    let data;
    try { data = JSON.parse(readFileSync(this.persistPath, 'utf8')); } catch { return 0; }
    if (!Array.isArray(data)) return 0;

    let rearmed = 0;
    let lost = 0;
    const now = Date.now();
    for (const w of data) {
      // Drop stale finished watches; keep recent ones for history.
      if (w.status !== 'active') {
        if (now - (w.firedAt || w.createdAt || 0) < HISTORY_TTL_MS) {
          this.watches.set(w.id, { ...w, _poll: null, _deadline: null });
        }
        continue;
      }
      const watch = { ...w, _poll: null, _deadline: null };
      this.watches.set(watch.id, watch);

      // A command watch whose job is gone with no exit sentinel died while the
      // daemon was down. Polling it would just burn until the timeout and then
      // report "may still be running" — say what actually happened instead.
      if (watch.mode === 'command' && watch.pid
          && !existsSync(watch.statusFile || '') && !this._jobAlive(watch)) {
        lost++;
        this._wake(watch, {
          outcome: 'error',
          summary: `The job for "${watch.label}" is no longer running and never recorded an exit code — `
            + 'it was lost while the daemon was down. Check its output before assuming it finished.',
          output: tailFile(watch.outFile, OUTPUT_TAIL),
        });
        continue;
      }

      this._arm(watch);
      rearmed++;
    }
    if (rearmed > 0) console.log(`[Groove:Watcher] Re-attached to ${rearmed} running watch(es) after restart`);
    if (lost > 0) console.log(`[Groove:Watcher] ${lost} watch(es) lost their job while the daemon was down`);
    this._persist();
    return rearmed;
  }

  // ── lifecycle ─────────────────────────────────────────────────

  cancel(id, agentId = null) {
    const watch = this.watches.get(id);
    if (!watch) return false;
    if (agentId && watch.agentId !== agentId) return false;
    if (watch.status === 'active') {
      watch.status = 'cancelled';
      this._disarm(watch);
      this._killJob(watch);
      this._cleanupRun(watch);
      this._persist();
      this.daemon.broadcast?.({ type: 'watch:cancelled', data: this._public(watch) });
    }
    return true;
  }

  // An agent that is killed/purged shouldn't leave watches firing into a void.
  cancelForAgent(agentId) {
    let changed = false;
    for (const watch of this.watches.values()) {
      if (watch.agentId === agentId && watch.status === 'active') {
        watch.status = 'cancelled';
        this._disarm(watch);
        this._killJob(watch);
        this._cleanupRun(watch);
        changed = true;
      }
    }
    if (changed) this._persist();
  }

  _disarm(watch) {
    if (watch._deadline) { clearTimeout(watch._deadline); watch._deadline = null; }
    if (watch._poll) { clearInterval(watch._poll); watch._poll = null; }
  }

  // Kill the detached job — only on explicit cancel. A fired watch means the
  // job already exited on its own.
  _killJob(watch) {
    if (watch.mode !== 'command' || !watch.pid) return;
    try { process.kill(-watch.pid, 'SIGTERM'); }       // negative → the whole process group
    catch { try { process.kill(watch.pid, 'SIGTERM'); } catch { /* already gone */ } }
  }

  _cleanupRun(watch) {
    if (watch.mode !== 'command') return;
    try { rmSync(resolve(this.runsDir, watch.id), { recursive: true, force: true }); } catch { /* ignore */ }
  }

  list(agentId = null) {
    const all = [...this.watches.values()].sort((a, b) => b.createdAt - a.createdAt);
    return (agentId ? all.filter((w) => w.agentId === agentId) : all).map((w) => this._public(w));
  }

  // Clear in-memory timers on shutdown. Deliberately does NOT kill the detached
  // jobs — they must survive the restart; restore() reconnects to them.
  stop() {
    for (const watch of this.watches.values()) this._disarm(watch);
  }

  _serialize(w) {
    return {
      id: w.id, agentId: w.agentId, agentName: w.agentName, label: w.label,
      mode: w.mode, command: w.command, until: w.until, cwd: w.cwd,
      pollMs: w.pollMs, timeoutMs: w.timeoutMs, status: w.status,
      createdAt: w.createdAt, firedAt: w.firedAt || null, result: w.result || null,
      pid: w.pid || null, outFile: w.outFile || null, statusFile: w.statusFile || null,
      deliveryError: w.deliveryError || null,
    };
  }

  _public(w) {
    return {
      id: w.id, agentId: w.agentId, agentName: w.agentName, label: w.label,
      mode: w.mode, command: w.command, until: w.until, status: w.status,
      createdAt: w.createdAt, firedAt: w.firedAt || null, result: w.result || null,
    };
  }
}

// Single-quote for safe embedding in the runner script.
function shq(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

// Read the last `maxBytes` of a file without loading the whole thing — a
// training log can be huge.
function tailFile(path, maxBytes) {
  if (!path || !existsSync(path)) return '';
  let fd;
  try {
    fd = openSync(path, 'r');
    const size = fstatSync(fd).size;
    const len = Math.min(size, maxBytes);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, size - len);
    return buf.toString('utf8').trim();
  } catch {
    return '';
  } finally {
    if (fd !== undefined) try { closeSync(fd); } catch { /* ignore */ }
  }
}

export { DEFAULT_TIMEOUT_MS, MAX_WATCHES_PER_AGENT };
