// FSL-1.1-Apache-2.0 — see LICENSE

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TransmissionQueue } from '../../client/transmission-queue.js';

describe('TransmissionQueue', () => {
  it('waitForDrain resolves immediately when queue is empty', async () => {
    const queue = new TransmissionQueue('http://localhost:9999');
    await queue.waitForDrain();
    assert.ok(true);
  });

  it('waitForDrain waits for active drain to complete', async () => {
    const queue = new TransmissionQueue('http://localhost:9999');
    queue._queue.push({ session_id: 'test' });
    const drain = Promise.resolve().then(() => {
      queue._queue.length = 0;
    });
    queue._drainPromise = drain.finally(() => {
      queue._drainPromise = null;
    });
    await queue.waitForDrain();
    assert.equal(queue._queue.length, 0);
  });

  it('offlineQueueSize tracks offline envelopes', () => {
    const queue = new TransmissionQueue('http://localhost:9999');
    assert.equal(queue.offlineQueueSize, 0);
    queue.enqueue({ session_id: 'test', attestation: { session_hmac: 'OFFLINE' } });
    assert.equal(queue.offlineQueueSize, 1);
  });
});
