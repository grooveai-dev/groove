// GROOVE — InnerChat Tests
// FSL-1.1-Apache-2.0 — see LICENSE

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { InnerChat, MAX_EXCHANGES } from '../src/innerchat.js';

// Mirrors the daemon surface deliverInstruction touches. `_loops` marks an
// interactive loop, `_running` a busy CLI agent; anything in neither is
// stopped (resume path, which mints a new id).
function makeDaemon() {
  const broadcasts = [];
  const audits = [];
  const sent = [];
  const queued = [];
  const resumes = [];
  let idCounter = 0;

  return {
    broadcasts, audits, sent, queued, resumes,
    registry: {
      _agents: new Map(),
      get(id) { return this._agents.get(id) || null; },
      getAll() { return [...this._agents.values()]; },
      add(agent) { this._agents.set(agent.id, agent); return agent; },
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
      async sendMessage(id, msg) { sent.push({ id, msg }); return true; },
      queueMessage(id, msg) { queued.push({ id, msg }); },
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

const result = (text) => ({ type: 'result', data: text });
const tick = () => new Promise((r) => setImmediate(r));

describe('InnerChat', () => {
  let daemon, innerchat;

  beforeEach(() => {
    daemon = makeDaemon();
    daemon.processes._agentsRef = daemon.registry._agents;
    daemon.rotator._daemon = daemon;
    innerchat = new InnerChat(daemon);
    daemon.innerchat = innerchat;

    for (const [id, name] of [['a1', 'fullstack-1'], ['a2', 'fullstack-14']]) {
      daemon.registry.add({ id, name, role: 'fullstack', provider: 'claude-code' });
      daemon.processes._loops.add(id);
      daemon.processes._running.add(id);
    }
  });

  // ── The blocking round trip ───────────────────────────────

  it('blocks until the target answers, then resolves with the reply', async () => {
    const pending = innerchat.ask('a1', 'a2', 'What endpoint shape?');

    let settled = false;
    pending.then(() => { settled = true; });
    await tick();
    assert.equal(settled, false, 'must not resolve before an answer arrives');

    const delivered = daemon.sent.at(-1);
    assert.equal(delivered.id, 'a2');
    assert.match(delivered.msg, /fullstack-1 \(fullstack\) is asking you a question/);
    assert.match(delivered.msg, /BLOCKED waiting on your answer/);

    innerchat.onAgentOutput('a2', result('REST, /api/v2/orders'));
    const res = await pending;

    assert.equal(res.reply, 'REST, /api/v2/orders');
    assert.equal(res.exchanges, 1);
    assert.equal(res.remaining, MAX_EXCHANGES - 1);
  });

  it('ignores non-result and empty output while waiting', async () => {
    const pending = innerchat.ask('a1', 'a2', 'What shape?');
    await tick();

    innerchat.onAgentOutput('a2', { type: 'assistant', data: 'thinking…' });
    innerchat.onAgentOutput('a2', result('   '));
    await tick();

    assert.ok(innerchat.getPending('a2'), 'still waiting');
    innerchat.onAgentOutput('a2', result('done'));
    assert.equal((await pending).reply, 'done');
  });

  it('skips the in-flight result when the question queued behind live work', async () => {
    daemon.processes._loops.delete('a2'); // running, no loop → queued
    const pending = innerchat.ask('a1', 'a2', 'What shape?');
    await tick();
    assert.equal(daemon.queued.at(-1).id, 'a2');

    innerchat.onAgentOutput('a2', result('finished the PREVIOUS task'));
    await tick();
    assert.ok(innerchat.getPending('a2'), 'prior task result must not be taken as the answer');

    innerchat.onAgentOutput('a2', result('the actual answer'));
    assert.equal((await pending).reply, 'the actual answer');
  });

  // ── Guardrails ────────────────────────────────────────────

  it('refuses a call that would deadlock and says how to resolve it', async () => {
    const outbound = innerchat.ask('a1', 'a2', 'question for 14');
    await tick();

    // a2 tries to ask a1 back while a1 is blocked on a2.
    await assert.rejects(
      () => innerchat.ask('a2', 'a1', 'counter-question'),
      /waiting for YOUR answer/,
    );

    innerchat.onAgentOutput('a2', result('fine'));
    await outbound;
  });

  it('refuses a second concurrent question to a busy target', async () => {
    daemon.registry.add({ id: 'a3', name: 'fullstack-9', role: 'fullstack', provider: 'claude-code' });
    daemon.processes._loops.add('a3');
    daemon.processes._running.add('a3');

    const first = innerchat.ask('a1', 'a2', 'q1');
    await tick();
    await assert.rejects(() => innerchat.ask('a3', 'a2', 'q2'), /already answering/);

    innerchat.onAgentOutput('a2', result('a'));
    await first;
  });

  it('enforces the exchange cap and tells the agent to report', async () => {
    for (let i = 0; i < MAX_EXCHANGES; i++) {
      const p = innerchat.ask('a1', 'a2', `q${i}`);
      await tick();
      innerchat.onAgentOutput('a2', result(`a${i}`));
      await p;
    }
    await assert.rejects(
      () => innerchat.ask('a1', 'a2', 'one more'),
      new RegExp(`${MAX_EXCHANGES}-exchange limit`),
    );
  });

  it('counts exchanges down across a continuing conversation', async () => {
    const p1 = innerchat.ask('a1', 'a2', 'q1');
    await tick(); innerchat.onAgentOutput('a2', result('a1'));
    const r1 = await p1;

    const p2 = innerchat.ask('a1', 'a2', 'q2');
    await tick(); innerchat.onAgentOutput('a2', result('a2'));
    const r2 = await p2;

    assert.equal(r1.threadId, r2.threadId, 'same conversation continues');
    assert.equal(r2.exchanges, 2);
    assert.equal(r2.remaining, MAX_EXCHANGES - 2);
  });

  it('times out rather than blocking forever', async () => {
    await assert.rejects(
      () => innerchat.ask('a1', 'a2', 'silence', { timeoutMs: 20 }),
      /No answer within/,
    );
    // The slot must be released, or the pair is wedged for good.
    assert.equal(innerchat.getPending('a2'), null);
    assert.equal(innerchat.blockedOn.get('a1'), undefined);
  });

  it('unblocks the asker when the target dies mid-question', async () => {
    const pending = innerchat.ask('a1', 'a2', 'q');
    await tick();
    innerchat.onAgentGone('a2', 'crashed');
    await assert.rejects(() => pending, /crashed before answering/);
    assert.equal(innerchat.blockedOn.get('a1'), undefined);
  });

  it('rejects unknown, self-addressed and empty asks', async () => {
    await assert.rejects(() => innerchat.ask('nope', 'a2', 'x'), /not found/);
    await assert.rejects(() => innerchat.ask('a1', 'nope', 'x'), /not found/);
    await assert.rejects(() => innerchat.ask('a1', 'a1', 'x'), /cannot ask itself/);
    await assert.rejects(() => innerchat.ask('a1', 'a2', '  '), /message is required/);
  });

  it('surfaces a delivery failure as an unreachable error', async () => {
    daemon.processes.sendMessage = async () => { throw new Error('pipe closed'); };
    await assert.rejects(() => innerchat.ask('a1', 'a2', 'x'), /Could not reach fullstack-14: pipe closed/);
    assert.equal(innerchat.blockedOn.get('a1'), undefined);
  });

  // ── Stopped targets / id remapping ────────────────────────

  it('resumes a stopped target and matches the answer on its new id', async () => {
    daemon.processes._loops.delete('a2');
    daemon.processes._running.delete('a2');

    const pending = innerchat.ask('a1', 'a2', 'ping');
    await tick();

    const newId = daemon.resumes.at(-1).newId;
    assert.notEqual(newId, 'a2');
    assert.equal(innerchat.getPending('a2'), null, 'old id no longer tracked');
    assert.ok(innerchat.getPending(newId), 'awaited on the new id');

    innerchat.onAgentOutput(newId, result('pong'));
    assert.equal((await pending).reply, 'pong');
  });

  // ── Conversation context ──────────────────────────────────

  it('replays prior turns so neither side re-explains', async () => {
    const p1 = innerchat.ask('a1', 'a2', 'What shape?');
    await tick(); innerchat.onAgentOutput('a2', result('REST'));
    await p1;

    const p2 = innerchat.ask('a1', 'a2', 'Versioned?');
    await tick();
    const msg = daemon.sent.at(-1).msg;
    assert.match(msg, /Earlier in this conversation/);
    assert.match(msg, /fullstack-1: What shape\?/);
    assert.match(msg, /fullstack-14: REST/);
    assert.match(msg, /Versioned\?/);

    innerchat.onAgentOutput('a2', result('v2'));
    await p2;
  });

  it('broadcasts and audits both directions', async () => {
    const p = innerchat.ask('a1', 'a2', 'q');
    await tick();
    innerchat.onAgentOutput('a2', result('a'));
    await p;

    const turns = daemon.broadcasts.filter((b) => b.type === 'innerchat:turn');
    assert.equal(turns.length, 2);
    assert.equal(turns[0].data.turn.kind, 'ask');
    assert.equal(turns[1].data.turn.kind, 'answer');
    assert.ok(daemon.audits.some((a) => a.type === 'innerchat.ask'));
    assert.ok(daemon.audits.some((a) => a.type === 'innerchat.answer'));
  });
});
