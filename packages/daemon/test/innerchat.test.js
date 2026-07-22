// GROOVE — InnerChat Tests
// FSL-1.1-Apache-2.0 — see LICENSE

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { InnerChat } from '../src/innerchat.js';

// Mirrors the daemon surface deliverInstruction touches. Agents live in the
// registry; `_loops` marks an interactive loop, `_running` a busy CLI agent,
// and anything in neither is stopped (resume path, which mints a new id).
function makeDaemon() {
  const broadcasts = [];
  const audits = [];
  const sentMessages = [];
  const queuedMessages = [];
  const resumes = [];

  let idCounter = 0;

  return {
    broadcasts,
    audits,
    sentMessages,
    queuedMessages,
    resumes,
    registry: {
      _agents: new Map(),
      get(id) { return this._agents.get(id) || null; },
      add(agent) { this._agents.set(agent.id, agent); },
      remove(id) { this._agents.delete(id); },
      flushPendingRemovals() {},
      update() {},
    },
    locks: { release() {} },
    processes: {
      _loops: new Set(),
      _running: new Set(),
      hasAgentLoop(id) { return this._loops.has(id); },
      isRunning(id) { return this._running.has(id); },
      async sendMessage(id, msg, source) {
        sentMessages.push({ id, msg, source });
        return true;
      },
      queueMessage(id, msg) {
        queuedMessages.push({ id, msg });
      },
      // Resume mints a new agent id, exactly as the real one does.
      async resume(id, msg) {
        const old = this._agentsRef.get(id);
        const fresh = { ...old, id: `${id}-r${++idCounter}` };
        this._agentsRef.delete(id);
        this._agentsRef.set(fresh.id, fresh);
        resumes.push({ id, msg, newId: fresh.id });
        return fresh;
      },
    },
    rotator: {
      async rotate(id, opts) { return this._daemon.processes.resume(id, opts.additionalPrompt); },
    },
    broadcast(msg) { broadcasts.push(msg); },
    audit: { log(type, data) { audits.push({ type, data }); } },
  };
}

function wire(daemon) {
  daemon.processes._agentsRef = daemon.registry._agents;
  daemon.rotator._daemon = daemon;
}

const result = (text) => ({ type: 'result', data: text });

describe('InnerChat', () => {
  let daemon;
  let innerchat;

  beforeEach(() => {
    daemon = makeDaemon();
    wire(daemon);
    innerchat = new InnerChat(daemon);
    daemon.innerchat = innerchat;

    daemon.registry.add({ id: 'a1', name: 'fullstack-1', role: 'fullstack', provider: 'claude-code' });
    daemon.registry.add({ id: 'a2', name: 'fullstack-14', role: 'fullstack', provider: 'claude-code' });
    daemon.processes._loops.add('a1');
    daemon.processes._running.add('a1');
    daemon.processes._loops.add('a2');
    daemon.processes._running.add('a2');
  });

  // ── Sending ───────────────────────────────────────────────

  it('opens a thread and delivers the relay to the target', async () => {
    const { thread, turn } = await innerchat.send('a1', 'a2', 'What endpoint shape are you using?');

    assert.ok(thread.id);
    assert.equal(thread.status, 'awaiting_reply');
    assert.equal(thread.turns.length, 1);
    assert.equal(turn.kind, 'relay');
    assert.equal(turn.from.id, 'a1');
    assert.equal(turn.to.id, 'a2');

    const delivered = daemon.sentMessages.at(-1);
    assert.equal(delivered.id, 'a2');
    assert.match(delivered.msg, /InnerChat from fullstack-1/);
    assert.match(delivered.msg, /What endpoint shape are you using\?/);
  });

  it('rejects unknown, self-addressed, and empty relays', async () => {
    await assert.rejects(() => innerchat.send('nope', 'a2', 'hi'), /not found/);
    await assert.rejects(() => innerchat.send('a1', 'nope', 'hi'), /not found/);
    await assert.rejects(() => innerchat.send('a1', 'a1', 'hi'), /itself/);
    await assert.rejects(() => innerchat.send('a1', 'a2', '   '), /message is required/);
  });

  it('rejects an unknown threadId', async () => {
    await assert.rejects(() => innerchat.send('a1', 'a2', 'hi', 'bogus'), /not found/);
  });

  // ── Reply capture and auto-forward ────────────────────────

  it('forwards the reply back to the asker automatically', async () => {
    await innerchat.send('a1', 'a2', 'What shape?');
    innerchat.onAgentOutput('a2', result('REST, /api/v2/orders'));
    await new Promise((r) => setImmediate(r));

    const forwarded = daemon.sentMessages.at(-1);
    assert.equal(forwarded.id, 'a1');
    assert.match(forwarded.msg, /InnerChat reply from fullstack-14/);
    assert.match(forwarded.msg, /REST, \/api\/v2\/orders/);
  });

  it('ignores output from agents with no relay outstanding', () => {
    const before = daemon.sentMessages.length;
    innerchat.onAgentOutput('a2', result('unrelated work'));
    assert.equal(daemon.sentMessages.length, before);
  });

  it('ignores non-result and empty output', async () => {
    await innerchat.send('a1', 'a2', 'What shape?');
    innerchat.onAgentOutput('a2', { type: 'assistant', data: 'thinking...' });
    innerchat.onAgentOutput('a2', result('   '));
    await new Promise((r) => setImmediate(r));

    assert.equal(daemon.sentMessages.at(-1).id, 'a2', 'no forward should have happened');
    assert.ok(innerchat.getPending('a2'), 'relay is still outstanding');
  });

  it('captures a reply only once', async () => {
    await innerchat.send('a1', 'a2', 'What shape?');
    innerchat.onAgentOutput('a2', result('first'));
    innerchat.onAgentOutput('a2', result('second'));
    await new Promise((r) => setImmediate(r));

    const forwards = daemon.sentMessages.filter((m) => /InnerChat reply/.test(m.msg));
    assert.equal(forwards.length, 1);
    assert.match(forwards[0].msg, /first/);
  });

  it('skips the in-flight result when the relay was queued behind live work', async () => {
    // No loop, but running → the relay queues behind the current task.
    daemon.processes._loops.delete('a2');
    await innerchat.send('a1', 'a2', 'What shape?');
    assert.equal(daemon.queuedMessages.at(-1).id, 'a2');

    // This result belongs to the task that was already underway.
    innerchat.onAgentOutput('a2', result('finished the previous task'));
    await new Promise((r) => setImmediate(r));
    assert.equal(daemon.sentMessages.filter((m) => /InnerChat reply/.test(m.msg)).length, 0);

    // This one is the actual answer.
    innerchat.onAgentOutput('a2', result('REST, /api/v2/orders'));
    await new Promise((r) => setImmediate(r));
    const forwarded = daemon.sentMessages.at(-1);
    assert.equal(forwarded.id, 'a1');
    assert.match(forwarded.msg, /REST, \/api\/v2\/orders/);
  });

  // ── Stopped agents / id remapping ─────────────────────────

  it('resumes a stopped target and tracks it under its new id', async () => {
    daemon.processes._loops.delete('a2');
    daemon.processes._running.delete('a2');

    const { thread, turn } = await innerchat.send('a1', 'a2', 'ping');
    const newId = daemon.resumes.at(-1).newId;

    assert.notEqual(newId, 'a2');
    assert.equal(turn.to.id, newId);
    assert.ok(thread.participants.some((p) => p.id === newId));
    assert.equal(innerchat.getPending('a2'), null, 'old id no longer tracked');
    assert.ok(innerchat.getPending(newId), 'reply is awaited on the new id');

    // The reply arrives on the new id and still forwards correctly.
    daemon.processes._loops.add(newId);
    innerchat.onAgentOutput(newId, result('pong'));
    await new Promise((r) => setImmediate(r));
    assert.match(daemon.sentMessages.at(-1).msg, /pong/);
  });

  it('resumes a stopped asker to deliver the reply', async () => {
    await innerchat.send('a1', 'a2', 'What shape?');
    daemon.processes._loops.delete('a1');
    daemon.processes._running.delete('a1');

    innerchat.onAgentOutput('a2', result('REST'));
    await new Promise((r) => setImmediate(r));

    const resume = daemon.resumes.at(-1);
    assert.equal(resume.id, 'a1');
    assert.match(resume.msg, /InnerChat reply from fullstack-14/);
  });

  it('marks the turn failed when delivery throws', async () => {
    daemon.processes.sendMessage = async () => { throw new Error('pipe closed'); };
    await assert.rejects(() => innerchat.send('a1', 'a2', 'ping'), /pipe closed/);

    const thread = innerchat.getThreads('a1')[0];
    assert.equal(thread.status, 'failed');
    assert.equal(thread.turns[0].status, 'failed');
    assert.equal(thread.turns[0].error, 'pipe closed');
  });

  // ── Threads ───────────────────────────────────────────────

  it('continues a thread and replays prior turns as context', async () => {
    const first = await innerchat.send('a1', 'a2', 'What shape?');
    innerchat.onAgentOutput('a2', result('REST'));
    await new Promise((r) => setImmediate(r));

    await innerchat.send('a1', 'a2', 'Versioned?', first.thread.id);

    const relay = daemon.sentMessages.filter((m) => /InnerChat from/.test(m.msg)).at(-1);
    assert.match(relay.msg, /Earlier in this conversation/);
    assert.match(relay.msg, /fullstack-1: What shape\?/);
    assert.match(relay.msg, /fullstack-14: REST/);
    assert.match(relay.msg, /Versioned\?/);

    assert.equal(innerchat.getThreads().length, 1, 'reused the existing thread');
    assert.equal(first.thread.turns.length, 3);
  });

  it('keeps concurrent relays to different agents separate', async () => {
    daemon.registry.add({ id: 'a3', name: 'fullstack-9', role: 'fullstack', provider: 'claude-code' });
    daemon.processes._loops.add('a3');
    daemon.processes._running.add('a3');

    const one = await innerchat.send('a1', 'a2', 'question for 14');
    const two = await innerchat.send('a1', 'a3', 'question for 9');
    assert.notEqual(one.thread.id, two.thread.id);

    innerchat.onAgentOutput('a3', result('answer from 9'));
    await new Promise((r) => setImmediate(r));

    assert.equal(two.thread.turns.at(-1).text, 'answer from 9');
    assert.equal(one.thread.turns.length, 1, 'the other thread is untouched');
    assert.ok(innerchat.getPending('a2'), 'still awaiting the first reply');
  });

  it('filters threads by participant', async () => {
    daemon.registry.add({ id: 'a3', name: 'fullstack-9', role: 'fullstack', provider: 'claude-code' });
    daemon.processes._loops.add('a3');
    daemon.processes._running.add('a3');

    await innerchat.send('a1', 'a2', 'hi');
    await innerchat.send('a1', 'a3', 'hi');

    assert.equal(innerchat.getThreads().length, 2);
    assert.equal(innerchat.getThreads('a1').length, 2);
    assert.equal(innerchat.getThreads('a2').length, 1);
    assert.equal(innerchat.getThreads('a3').length, 1);
    assert.equal(innerchat.getThreads('nobody').length, 0);
  });

  // ── Broadcast & audit ─────────────────────────────────────

  it('broadcasts and audits both hops', async () => {
    await innerchat.send('a1', 'a2', 'What shape?');
    innerchat.onAgentOutput('a2', result('REST'));
    await new Promise((r) => setImmediate(r));

    const turns = daemon.broadcasts.filter((b) => b.type === 'innerchat:turn');
    assert.equal(turns.length, 2);
    assert.equal(turns[0].data.turn.kind, 'relay');
    assert.equal(turns[1].data.turn.kind, 'reply');

    assert.ok(daemon.audits.some((a) => a.type === 'innerchat.send'));
    assert.ok(daemon.audits.some((a) => a.type === 'innerchat.reply'));
  });
});
