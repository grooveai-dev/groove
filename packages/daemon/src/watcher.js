// FSL-1.1-Apache-2.0 — see LICENSE

import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { deliverInstruction } from './deliver.js';

// Watches are bounded so a wedged process or a condition that never comes true
// can't poll forever or hold a slot indefinitely.
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_TIMEOUT_MS = 6 * 60 * 60 * 1000;
const DEFAULT_POLL_MS = 15 * 1000;
const MIN_POLL_MS = 3 * 1000;
const MAX_WATCHES_PER_AGENT = 5;
const OUTPUT_TAIL = 4000;

/**
 * Wake-on-completion for agents.
 *
 * An agent promises to "report back when the tests finish", but its process
 * ends when the turn does — so nothing is left to report. A Watch lives in the
 * daemon, not the agent's session: it outlives the turn, and when its target
 * finishes it resumes the agent (from `completed` if need be, via the same
 * pipe as user chat) with the outcome.
 *
 * Two flavours:
 *   - command: the daemon runs a command detached and owns its lifecycle, so
 *     it has the real exit code and output when it finishes.
 *   - until:   the daemon polls a check command for something already running,
 *     and wakes the agent when the check first succeeds (exit 0).
 */
export class Watcher {
  constructor(daemon) {
    this.daemon = daemon;
    this.watches = new Map();
  }

  create(agentId, opts = {}) {
    const agent = this.daemon.registry.get(agentId);
    if (!agent) throw new Error('Agent not found');

    const command = typeof opts.command === 'string' ? opts.command.trim() : '';
    const until = typeof opts.until === 'string' ? opts.until.trim() : '';
    if (!command && !until) throw new Error('Provide either "command" (run it) or "until" (poll it)');
    if (command && until) throw new Error('Provide only one of "command" or "until"');

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
      _child: null,
      _poll: null,
      _deadline: null,
    };

    this.watches.set(watch.id, watch);
    watch._deadline = setTimeout(() => this._fireTimeout(watch), timeoutMs);
    if (watch.mode === 'command') this._runCommand(watch);
    else this._startPolling(watch);

    this.daemon.audit?.log('watch.create', { id: watch.id, agent: agentId, mode: watch.mode });
    this.daemon.broadcast?.({ type: 'watch:created', data: this._public(watch) });
    return this._public(watch);
  }

  // ── command mode: daemon owns the process ─────────────────────

  _runCommand(watch) {
    const child = spawn('/bin/sh', ['-c', watch.command], {
      cwd: watch.cwd,
      env: process.env,
      detached: false,
    });
    watch._child = child;

    const chunks = [];
    let bytes = 0;
    const collect = (buf) => {
      // Keep only the tail — a chatty build shouldn't grow this unbounded.
      chunks.push(buf);
      bytes += buf.length;
      while (bytes > OUTPUT_TAIL * 2 && chunks.length > 1) bytes -= chunks.shift().length;
    };
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);

    child.on('error', (err) => {
      this._wake(watch, {
        outcome: 'error',
        summary: `Could not start the command: ${err.message}`,
      });
    });

    child.on('close', (code, signal) => {
      if (watch.status !== 'active') return; // already timed out / cancelled
      const output = Buffer.concat(chunks).toString('utf8').slice(-OUTPUT_TAIL).trim();
      this._wake(watch, {
        outcome: code === 0 ? 'success' : 'failure',
        exitCode: code,
        signal,
        summary: signal
          ? `Terminated by signal ${signal}.`
          : `Finished with exit code ${code}.`,
        output,
      });
    });
  }

  // ── until mode: poll something already running ────────────────

  _startPolling(watch) {
    const tick = () => {
      if (watch.status !== 'active') return;
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
    };
    watch._poll = setInterval(tick, watch.pollMs);
    tick(); // check immediately — the condition may already hold
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
    this._cleanup(watch);

    const message = this._composeMessage(watch, result);

    // Resolve by name, not the id we stored at creation: over a 30-minute
    // watch the agent has very likely been chatted with and rotated to a new
    // id. Names are stable across rotation, so this follows the agent; a
    // purged/gone agent simply doesn't resolve and the watch is undeliverable
    // rather than resurrecting a killed agent under a stale id.
    const target = this.daemon.registry.getAll().find((a) => a.name === watch.agentName);
    if (!target) {
      watch.status = 'undeliverable';
      watch.deliveryError = `Agent ${watch.agentName} no longer exists`;
      this.daemon.audit?.log('watch.undeliverable', { id: watch.id, reason: 'agent gone' });
      this.daemon.broadcast?.({ type: 'watch:fired', data: this._public(watch) });
      return;
    }

    try {
      const delivered = await deliverInstruction(this.daemon, target.id, message, { recordFeedback: false });
      watch.agentId = delivered.agentId;
      watch.status = 'delivered';
    } catch (err) {
      watch.status = 'undeliverable';
      watch.deliveryError = err.message;
      this.daemon.audit?.log('watch.undeliverable', { id: watch.id, error: err.message });
    }

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

  // ── lifecycle ─────────────────────────────────────────────────

  cancel(id, agentId = null) {
    const watch = this.watches.get(id);
    if (!watch) return false;
    if (agentId && watch.agentId !== agentId) return false;
    if (watch.status === 'active') {
      watch.status = 'cancelled';
      this._cleanup(watch);
      this.daemon.broadcast?.({ type: 'watch:cancelled', data: this._public(watch) });
    }
    return true;
  }

  // An agent that is killed/purged shouldn't leave watches firing into a void.
  cancelForAgent(agentId) {
    for (const watch of this.watches.values()) {
      if (watch.agentId === agentId && watch.status === 'active') {
        watch.status = 'cancelled';
        this._cleanup(watch);
      }
    }
  }

  _cleanup(watch) {
    if (watch._deadline) { clearTimeout(watch._deadline); watch._deadline = null; }
    if (watch._poll) { clearInterval(watch._poll); watch._poll = null; }
    if (watch._child && watch.mode === 'command' && watch.status === 'cancelled') {
      // Only kill the process when the user/agent cancelled — a fired watch
      // means it exited on its own.
      try { watch._child.kill('SIGTERM'); } catch { /* already gone */ }
    }
    watch._child = null;
  }

  list(agentId = null) {
    const all = [...this.watches.values()].sort((a, b) => b.createdAt - a.createdAt);
    return (agentId ? all.filter((w) => w.agentId === agentId) : all).map((w) => this._public(w));
  }

  stop() {
    for (const watch of this.watches.values()) {
      if (watch._deadline) clearTimeout(watch._deadline);
      if (watch._poll) clearInterval(watch._poll);
      if (watch._child) { try { watch._child.kill('SIGTERM'); } catch { /* gone */ } }
      watch._deadline = watch._poll = watch._child = null;
    }
  }

  _public(w) {
    return {
      id: w.id, agentId: w.agentId, agentName: w.agentName, label: w.label,
      mode: w.mode, command: w.command, until: w.until, status: w.status,
      createdAt: w.createdAt, firedAt: w.firedAt || null, result: w.result || null,
    };
  }
}

export { DEFAULT_TIMEOUT_MS, MAX_WATCHES_PER_AGENT };
