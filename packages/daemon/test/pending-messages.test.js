// GROOVE — Pending message queue tests
// FSL-1.1-Apache-2.0 — see LICENSE

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ProcessManager } from '../src/process.js';

function makeDaemon() {
  return {
    registry: { get: (id) => ({ id, role: 'fullstack', name: id }) },
    rotator: { recordUserMessage() {} },
    broadcast() {},
  };
}

describe('pending message queue', () => {
  let pm;

  beforeEach(() => { pm = new ProcessManager(makeDaemon()); });
  afterEach(() => { if (pm._stallWatchdog) clearInterval(pm._stallWatchdog); });

  it('keeps BOTH messages when two arrive while an agent is busy', () => {
    pm.queueMessage('a1', 'message from the user');
    pm.queueMessage('a1', 'question from another agent');

    const drained = pm.consumePendingMessage('a1');
    assert.equal(drained.count, 2);
    assert.match(drained.message, /message from the user/);
    assert.match(drained.message, /question from another agent/);
    // arrival order preserved
    assert.ok(drained.message.indexOf('user') < drained.message.indexOf('another agent'));
  });

  it('drains the queue so nothing is delivered twice', () => {
    pm.queueMessage('a1', 'one');
    pm.consumePendingMessage('a1');
    assert.equal(pm.consumePendingMessage('a1'), null);
  });

  it('returns null when nothing is queued', () => {
    assert.equal(pm.consumePendingMessage('nobody'), null);
  });

  it('queues are independent per agent', () => {
    pm.queueMessage('a1', 'for a1');
    pm.queueMessage('a2', 'for a2');
    assert.match(pm.consumePendingMessage('a1').message, /for a1/);
    assert.match(pm.consumePendingMessage('a2').message, /for a2/);
  });

  it('preserves order across three queued messages', () => {
    pm.queueMessage('a1', 'first');
    pm.queueMessage('a1', 'second');
    pm.queueMessage('a1', 'third');
    const { message, count } = pm.consumePendingMessage('a1');
    assert.equal(count, 3);
    assert.ok(message.indexOf('first') < message.indexOf('second'));
    assert.ok(message.indexOf('second') < message.indexOf('third'));
  });
});
