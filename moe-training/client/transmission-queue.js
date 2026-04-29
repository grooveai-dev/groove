// FSL-1.1-Apache-2.0 — see LICENSE

import { MAX_QUEUE_SIZE } from '../shared/constants.js';

export class TransmissionQueue {
  constructor(centralCommandUrl, maxSize = MAX_QUEUE_SIZE) {
    this._centralCommandUrl = centralCommandUrl;
    this._maxSize = maxSize;
    this._queue = [];
    this._offlineQueue = [];
    this._running = false;
    this._drainPromise = null;
    this._onSent = null;

    if (process.env.NODE_ENV === 'production' && !centralCommandUrl.startsWith('https://')) {
      console.warn('[TransmissionQueue] WARNING: centralCommandUrl does not use HTTPS in production');
    }
  }

  get offlineQueueSize() {
    return this._offlineQueue.length;
  }

  set onSent(fn) {
    this._onSent = typeof fn === 'function' ? fn : null;
  }

  enqueue(signedEnvelope) {
    if (this._queue.length >= this._maxSize) return;
    if (signedEnvelope?.attestation?.session_hmac === 'OFFLINE') {
      this._offlineQueue.push(signedEnvelope);
      return;
    }
    this._queue.push(signedEnvelope);
    if (this._running) this._kick();
  }

  replayOfflineQueue(sessionAttestation) {
    const pending = this._offlineQueue.splice(0);
    for (const envelope of pending) {
      const sessionId = envelope.session_id;
      const resigned = sessionAttestation.signEnvelope(sessionId, envelope);
      if (resigned?.attestation?.session_hmac === 'OFFLINE') {
        this._offlineQueue.push(resigned);
        continue;
      }
      this._queue.push(resigned);
    }
    if (this._running && this._queue.length > 0) this._kick();
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._kick();
  }

  async waitForDrain() {
    while (this._queue.length > 0 || this._drainPromise) {
      if (this._drainPromise) await this._drainPromise;
      else await new Promise((r) => setTimeout(r, 50));
    }
  }

  async stop() {
    this._running = false;
    if (this._drainPromise) {
      await this._drainPromise;
    }
  }

  _kick() {
    if (this._drainPromise) return;
    this._drainPromise = this._drain().finally(() => {
      this._drainPromise = null;
    });
  }

  async _drain() {
    while (this._running && this._queue.length > 0) {
      const envelope = this._queue[0];
      let success = false;

      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          const res = await fetch(`${this._centralCommandUrl}/v1/training/ingest`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(envelope),
            signal: AbortSignal.timeout(30_000),
          });
          if (res.ok) {
            success = true;
            if (this._onSent) this._onSent(envelope);
            break;
          }
        } catch {
          // network error
        }

        if (!this._running) return;
        const delay = Math.min(1000 * Math.pow(2, attempt), 60_000);
        await new Promise((r) => setTimeout(r, delay));
        if (!this._running) return;
      }

      this._queue.shift();
    }
  }
}
