// GROOVE — Federation Ambassador Agent Coordination
// FSL-1.1-Apache-2.0 — see LICENSE

import { EventEmitter } from 'events';
import { validateContract } from './contracts.js';

const MAX_POUCH_LOG = 200;

export class AmbassadorManager extends EventEmitter {
  constructor(federation) {
    super();
    this.federation = federation;
    this.daemon = federation.daemon;
    this.ambassadors = new Map(); // peerId -> agentId
    this.taskQueue = new Map(); // peerId -> [{ contract, from, receivedAt }]
    this.pouchLog = []; // recent pouch messages for GUI
  }

  getAmbassadorForPeer(peerId) {
    const agentId = this.ambassadors.get(peerId);
    if (!agentId) return null;
    const agent = this.daemon.registry.get(agentId);
    if (!agent || agent.status === 'killed' || agent.status === 'completed') {
      this.ambassadors.delete(peerId);
      return null;
    }
    return agent;
  }

  hasAmbassadorForPeer(peerId) {
    return !!this.getAmbassadorForPeer(peerId);
  }

  registerAmbassador(peerId, agentId) {
    if (this.hasAmbassadorForPeer(peerId)) {
      throw new Error(`Ambassador already exists for peer ${peerId}`);
    }
    this.ambassadors.set(peerId, agentId);

    const queued = this.taskQueue.get(peerId) || [];
    if (queued.length > 0) {
      for (const item of queued) {
        this._deliverToAmbassador(agentId, item);
      }
      this.taskQueue.delete(peerId);
    }

    this.daemon.audit.log('federation.ambassador.register', { peerId, agentId });
    this.emit('registered', { peerId, agentId });
  }

  unregisterAmbassador(peerId) {
    const agentId = this.ambassadors.get(peerId);
    this.ambassadors.delete(peerId);
    if (agentId) {
      this.daemon.audit.log('federation.ambassador.unregister', { peerId, agentId });
      this.emit('unregistered', { peerId, agentId });
    }
  }

  receivePouch(senderId, contract, signature) {
    const verified = this.federation.receiveContract(senderId, contract, signature);
    if (!verified.verified) {
      throw new Error('Pouch signature verification failed');
    }

    const validation = validateContract(verified.contract);
    if (!validation.valid) {
      throw new Error(`Invalid pouch contract: ${validation.error}`);
    }

    this._logPouch('inbound', senderId, verified.contract);

    const peerEntry = this._findPeerBySenderId(senderId);
    const peerId = peerEntry?.id || senderId;

    const ambassador = this.getAmbassadorForPeer(peerId);
    if (ambassador) {
      this._deliverToAmbassador(ambassador.id, {
        contract: verified.contract,
        from: senderId,
        receivedAt: new Date().toISOString(),
      });
    } else {
      if (!this.taskQueue.has(peerId)) {
        this.taskQueue.set(peerId, []);
      }
      this.taskQueue.get(peerId).push({
        contract: verified.contract,
        from: senderId,
        receivedAt: new Date().toISOString(),
      });
    }

    this.emit('pouch-received', { from: senderId, type: verified.contract.type });
    return { received: true, queued: !ambassador };
  }

  async sendPouch(peerId, contract) {
    const validation = validateContract(contract);
    if (!validation.valid) {
      throw new Error(`Invalid outbound contract: ${validation.error}`);
    }

    const envelope = this.federation.sign({
      ...contract,
      from: this.federation._daemonId(),
    });

    const sent = this.federation.connections.sendTo(peerId, {
      type: 'pouch',
      senderId: this.federation._daemonId(),
      payload: envelope.payload,
      signature: envelope.signature,
    });

    if (!sent) {
      const peer = this.federation.peers.get(peerId);
      if (!peer) throw new Error(`Unknown peer: ${peerId}`);

      const url = `http://${peer.host}:${peer.port}/api/federation/pouch`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          senderId: this.federation._daemonId(),
          payload: envelope.payload,
          signature: envelope.signature,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Pouch delivery failed: HTTP ${res.status}`);
      }
    }

    this._logPouch('outbound', peerId, contract);
    this.daemon.audit.log('federation.pouch.send', { peerId, type: contract.type });
    this.emit('pouch-sent', { to: peerId, type: contract.type });
    return { sent: true };
  }

  _deliverToAmbassador(agentId, item) {
    this.daemon.broadcast({
      type: 'federation:pouch',
      data: {
        agentId,
        from: item.from,
        contract: item.contract,
        receivedAt: item.receivedAt,
      },
    });
    this.emit('delivered', { agentId, from: item.from, type: item.contract.type });
  }

  _findPeerBySenderId(senderId) {
    for (const peer of this.federation.peers.values()) {
      if (peer.id === senderId) return peer;
    }
    return null;
  }

  _logPouch(direction, peer, contract) {
    this.pouchLog.push({
      direction,
      peer,
      type: contract.type,
      taskId: contract.spec?.taskId || null,
      timestamp: new Date().toISOString(),
    });
    if (this.pouchLog.length > MAX_POUCH_LOG) {
      this.pouchLog = this.pouchLog.slice(-MAX_POUCH_LOG);
    }
    this.daemon.broadcast({
      type: 'federation:pouch-log',
      data: this.pouchLog.slice(-1)[0],
    });
  }

  getPouchLog(limit = 50) {
    return this.pouchLog.slice(-limit);
  }

  getStatus() {
    const ambassadors = [];
    for (const [peerId, agentId] of this.ambassadors) {
      const agent = this.daemon.registry.get(agentId);
      ambassadors.push({
        peerId,
        agentId,
        agentStatus: agent?.status || 'unknown',
        queuedTasks: (this.taskQueue.get(peerId) || []).length,
      });
    }
    return { ambassadors, totalQueued: Array.from(this.taskQueue.values()).reduce((s, q) => s + q.length, 0) };
  }

  destroy() {
    this.ambassadors.clear();
    this.taskQueue.clear();
    this.removeAllListeners();
  }
}
