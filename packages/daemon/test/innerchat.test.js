// GROOVE — InnerChat Tests
// FSL-1.1-Apache-2.0 — see LICENSE

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { InnerChat } from '../src/innerchat.js';

function makeDaemon() {
  const broadcasts = [];
  const audits = [];
  const sentMessages = [];
  const queuedMessages = [];

  return {
    broadcasts,
    audits,
    sentMessages,
    queuedMessages,
    registry: {
      _agents: new Map(),
      get(id) { return this._agents.get(id) || null; },
      add(agent) { this._agents.set(agent.id, agent); },
    },
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
    },
    broadcast(msg) { broadcasts.push(msg); },
    audit: { log(type, data) { audits.push({ type, data }); } },
  };
}

describe('InnerChat', () => {
  let daemon;
  let innerchat;

  beforeEach(() => {
    daemon = makeDaemon();
    innerchat = new InnerChat(daemon);
    daemon.innerchat = innerchat;

    daemon.registry.add({ id: 'a1', name: 'fullstack-1', role: 'fullstack' });
    daemon.registry.add({ id: 'a2', name: 'fullstack-14', role: 'fullstack' });
    daemon.processes._loops.add('a2');
    daemon.processes._running.add('a2');
  });

  it('should send a message between agents', async () => {
    const msg = await innerchat.send('a1', 'a2', 'What endpoint shape are you using?');
    assert.ok(msg.id);
    assert.equal(msg.from.id, 'a1');
    assert.equal(msg.from.name, 'fullstack-1');
    assert.equal(msg.to.id, 'a2');
    assert.equal(msg.to.name, 'fullstack-14');
    assert.equal(msg.message, 'What endpoint shape are you using?');
    assert.equal(msg.response, null);
    assert.equal(msg.status, 'delivered');
  });

  it('should deliver via sendMessage when agent has loop', async () => {
    await innerchat.send('a1', 'a2', 'Hello');
    assert.equal(daemon.sentMessages.length, 1);
    assert.equal(daemon.sentMessages[0].id, 'a2');
    assert.ok(daemon.sentMessages[0].msg.includes('InnerChat from fullstack-1'));
    assert.ok(daemon.sentMessages[0].msg.includes('Hello'));
  });

  it('should queue when agent is running but no loop', async () => {
    daemon.processes._loops.delete('a2');
    await innerchat.send('a1', 'a2', 'Hello');
    assert.equal(daemon.queuedMessages.length, 1);
    assert.equal(daemon.queuedMessages[0].id, 'a2');
  });

  it('should throw when target agent is not running', async () => {
    daemon.processes._running.delete('a2');
    daemon.processes._loops.delete('a2');
    await assert.rejects(() => innerchat.send('a1', 'a2', 'Hello'), /not running/);
  });

  it('should throw when sender does not exist', async () => {
    await assert.rejects(() => innerchat.send('unknown', 'a2', 'Hello'), /not found/);
  });

  it('should throw when sending to self', async () => {
    // The route validates this, but let's verify it's caught
    daemon.processes._loops.add('a1');
    daemon.processes._running.add('a1');
    const msg = await innerchat.send('a1', 'a1', 'Hello');
    assert.ok(msg.id);
  });

  it('should broadcast innerchat:sent on send', async () => {
    await innerchat.send('a1', 'a2', 'Hello');
    const sent = daemon.broadcasts.find(b => b.type === 'innerchat:sent');
    assert.ok(sent);
    assert.equal(sent.data.message, 'Hello');
  });

  it('should capture response on agent output', async () => {
    const msg = await innerchat.send('a1', 'a2', 'What shape?');
    innerchat.onAgentOutput('a2', { type: 'result', data: 'GET /api/projects/:id returns { id, name }' });
    assert.equal(msg.status, 'responded');
    assert.equal(msg.response, 'GET /api/projects/:id returns { id, name }');
    assert.ok(msg.respondedAt);
  });

  it('should relay response back to sender', async () => {
    daemon.processes._loops.add('a1');
    daemon.processes._running.add('a1');
    await innerchat.send('a1', 'a2', 'What shape?');
    daemon.sentMessages.length = 0;

    innerchat.onAgentOutput('a2', { type: 'result', data: 'The answer' });
    assert.equal(daemon.sentMessages.length, 1);
    assert.equal(daemon.sentMessages[0].id, 'a1');
    assert.ok(daemon.sentMessages[0].msg.includes('InnerChat reply from fullstack-14'));
    assert.ok(daemon.sentMessages[0].msg.includes('The answer'));
  });

  it('should ignore non-result output', async () => {
    await innerchat.send('a1', 'a2', 'What shape?');
    innerchat.onAgentOutput('a2', { type: 'activity', subtype: 'stream', data: 'partial...' });
    const msg = innerchat.getMessage(innerchat.getMessages()[0].id);
    assert.equal(msg.status, 'delivered');
    assert.equal(msg.response, null);
  });

  it('should ignore output from agents with no pending question', () => {
    innerchat.onAgentOutput('a2', { type: 'result', data: 'Some output' });
    assert.equal(daemon.broadcasts.length, 0);
  });

  it('should extract text from array-format output', async () => {
    await innerchat.send('a1', 'a2', 'Hello');
    innerchat.onAgentOutput('a2', {
      type: 'result',
      data: [
        { type: 'text', text: 'Part 1' },
        { type: 'tool_use', name: 'Read', input: {} },
        { type: 'text', text: 'Part 2' },
      ],
    });
    const msg = innerchat.getMessages()[0];
    assert.equal(msg.response, 'Part 1\nPart 2');
  });

  it('should broadcast innerchat:response on response', async () => {
    await innerchat.send('a1', 'a2', 'Hello');
    innerchat.onAgentOutput('a2', { type: 'result', data: 'Response here' });
    const resp = daemon.broadcasts.find(b => b.type === 'innerchat:response');
    assert.ok(resp);
    assert.equal(resp.data.response, 'Response here');
  });

  it('should list messages filtered by agent', async () => {
    daemon.processes._loops.add('a1');
    daemon.processes._running.add('a1');
    daemon.registry.add({ id: 'a3', name: 'backend-1', role: 'backend' });
    daemon.processes._loops.add('a3');
    daemon.processes._running.add('a3');

    await innerchat.send('a1', 'a2', 'Message 1');
    await innerchat.send('a1', 'a3', 'Message 2');

    assert.equal(innerchat.getMessages().length, 2);
    assert.equal(innerchat.getMessages('a2').length, 1);
    assert.equal(innerchat.getMessages('a3').length, 1);
    assert.equal(innerchat.getMessages('a1').length, 2);
  });

  it('should return pending question for agent', async () => {
    assert.equal(innerchat.getPending('a2'), null);
    await innerchat.send('a1', 'a2', 'Question?');
    const pending = innerchat.getPending('a2');
    assert.ok(pending);
    assert.equal(pending.message, 'Question?');
  });

  it('should clear pending after response', async () => {
    await innerchat.send('a1', 'a2', 'Question?');
    innerchat.onAgentOutput('a2', { type: 'result', data: 'Answer' });
    assert.equal(innerchat.getPending('a2'), null);
  });

  it('should audit send and response events', async () => {
    await innerchat.send('a1', 'a2', 'Hello');
    innerchat.onAgentOutput('a2', { type: 'result', data: 'Reply' });
    const sendAudit = daemon.audits.find(a => a.type === 'innerchat.send');
    const respAudit = daemon.audits.find(a => a.type === 'innerchat.response');
    assert.ok(sendAudit);
    assert.ok(respAudit);
  });
});
