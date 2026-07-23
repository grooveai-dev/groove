// GROOVE — Watcher Tests
// FSL-1.1-Apache-2.0 — see LICENSE

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Watcher } from '../src/watcher.js';

// Captures what the watcher hands to deliverInstruction — the wake message and
// which agent it woke — without needing a real process manager.
function makeDaemon() {
  const delivered = [];
  const broadcasts = [];
  return {
    delivered, broadcasts,
    projectDir: process.cwd(),
    registry: {
      _agents: new Map(),
      add(a) { this._agents.set(a.id, a); return a; },
      get(id) { return this._agents.get(id) || null; },
      getAll() { return [...this._agents.values()]; },
    },
    audit: { log() {} },
    broadcast(m) { broadcasts.push(m); },
    // Stand-in for deliverInstruction's daemon-level delivery.
    _deliver(agentId, message) { delivered.push({ agentId, message }); return { agentId }; },
  };
}

// Point deliverInstruction at our capture by giving the agent a live loop the
// real deliver.js would use — simpler here to stub the module boundary.
// The watcher imports deliverInstruction directly, so we exercise it through a
// registry whose agent looks "running with a loop" and a process manager that
// records the send.
function wireDelivery(daemon) {
  daemon.processes = {
    hasAgentLoop: () => true,
    isRunning: () => true,
    async sendMessage(id, msg) { daemon._deliver(id, msg); return true; },
    queueMessage(id, msg) { daemon._deliver(id, msg); },
  };
  daemon.locks = { release() {} };
}

const settle = (ms = 40) => new Promise((r) => setTimeout(r, ms));

describe('Watcher', () => {
  let daemon, watcher;

  beforeEach(() => {
    daemon = makeDaemon();
    wireDelivery(daemon);
    watcher = new Watcher(daemon);
    daemon.watcher = watcher;
    daemon.registry.add({ id: 'a1', name: 'fullstack-1', role: 'fullstack', provider: 'claude-code' });
  });

  // Clear any lingering timers/intervals/children — an active poll watch has a
  // 30-minute deadline that would otherwise keep the test runner alive.
  afterEach(() => watcher.stop());

  it('runs a command and wakes the agent with a success outcome', async () => {
    watcher.create('a1', { command: 'echo hello && exit 0', label: 'greeting' });
    await settle(200);

    assert.equal(daemon.delivered.length, 1);
    const { agentId, message } = daemon.delivered[0];
    assert.equal(agentId, 'a1');
    assert.match(message, /Watch fired — "greeting"/);
    assert.match(message, /exit code 0/);
    assert.match(message, /hello/);
  });

  it('reports a non-zero exit as a failure with output', async () => {
    watcher.create('a1', { command: 'echo boom >&2 && exit 3', label: 'build' });
    await settle(200);

    const { message } = daemon.delivered[0];
    assert.match(message, /exit code 3/);
    assert.match(message, /boom/);
  });

  it('resolves the agent by name so a rotation to a new id still gets woken', async () => {
    watcher.create('a1', { command: 'exit 0', label: 'x' });
    // Agent rotates: same name, new id, old id gone — exactly what resume does.
    daemon.registry._agents.delete('a1');
    daemon.registry.add({ id: 'a1-r1', name: 'fullstack-1', role: 'fullstack', provider: 'claude-code' });
    await settle(200);

    assert.equal(daemon.delivered.length, 1);
    assert.equal(daemon.delivered[0].agentId, 'a1-r1');
  });

  it('marks undeliverable when the agent is gone, without throwing', async () => {
    watcher.create('a1', { command: 'exit 0', label: 'x' });
    daemon.registry._agents.delete('a1'); // purged, no replacement
    await settle(200);

    assert.equal(daemon.delivered.length, 0);
    const w = watcher.list()[0];
    assert.equal(w.status, 'undeliverable');
  });

  it('fires an "until" watch when the condition already holds (immediate check)', async () => {
    const fs = await import('fs');
    const flag = `${process.cwd()}/.watch-test-flag-${Date.now()}`;
    fs.writeFileSync(flag, 'x');
    try {
      // create() checks once immediately before waiting for the poll interval.
      watcher.create('a1', { until: `test -f ${flag}`, label: 'flag present' });
      await settle(120);
      assert.equal(daemon.delivered.length, 1, 'woke because the condition was already true');
      assert.match(daemon.delivered[0].message, /condition is now true/);
    } finally {
      try { fs.unlinkSync(flag); } catch { /* ignore */ }
    }
  });

  it('does not fire an until-watch while the condition stays false', async () => {
    watcher.create('a1', { until: 'exit 1', label: 'never', intervalMs: 3000 });
    await settle(80);
    assert.equal(daemon.delivered.length, 0);
    assert.equal(watcher.list()[0].status, 'active');
  });

  it('fires a timeout when the command runs too long', async () => {
    watcher.create('a1', { command: 'sleep 5', label: 'slow', timeoutMs: 60 });
    await settle(160);

    const { message } = daemon.delivered[0];
    assert.match(message, /time limit/);
  });

  it('rejects bad input', () => {
    assert.throws(() => watcher.create('a1', {}), /Provide either/);
    assert.throws(() => watcher.create('a1', { command: 'x', until: 'y' }), /only one/);
    assert.throws(() => watcher.create('nope', { command: 'x' }), /Agent not found/);
  });

  it('caps active watches per agent', () => {
    for (let i = 0; i < 5; i++) watcher.create('a1', { command: 'sleep 5', label: `w${i}` });
    assert.throws(() => watcher.create('a1', { command: 'sleep 5' }), /already have 5/);
  });

  it('cancels a watch and stops its process', async () => {
    const w = watcher.create('a1', { command: 'sleep 5', label: 'cancel me' });
    assert.equal(watcher.cancel(w.id), true);
    assert.equal(watcher.list()[0].status, 'cancelled');
    await settle(100);
    assert.equal(daemon.delivered.length, 0, 'a cancelled watch never wakes the agent');
  });

  it('cancels all of an agents watches when it is removed', () => {
    watcher.create('a1', { command: 'sleep 5', label: 'a' });
    watcher.create('a1', { command: 'sleep 5', label: 'b' });
    watcher.cancelForAgent('a1');
    assert.ok(watcher.list().every((w) => w.status === 'cancelled'));
  });
});
