// GROOVE — Federation WebSocket Connection Manager
// FSL-1.1-Apache-2.0 — see LICENSE

import { EventEmitter } from 'events';
import WebSocket from 'ws';

const HEARTBEAT_INTERVAL = 30_000;
const INITIAL_RECONNECT_DELAY = 2_000;
const MAX_RECONNECT_DELAY = 60_000;
const KNOCK_TIMEOUT = 10_000;

const STATES = {
  DISCONNECTED: 'disconnected',
  WHITELISTED: 'whitelisted',
  MUTUAL: 'mutual',
  KNOCKING: 'knocking',
  CONNECTED: 'connected',
};

class PeerConnection extends EventEmitter {
  constructor(manager, ip, port, remoteDaemonId) {
    super();
    this.manager = manager;
    this.ip = ip;
    this.port = port;
    this.remoteDaemonId = remoteDaemonId;
    this.state = STATES.DISCONNECTED;
    this.ws = null;
    this._heartbeatTimer = null;
    this._reconnectTimer = null;
    this._reconnectDelay = INITIAL_RECONNECT_DELAY;
    this._knockTimeout = null;
    this._destroyed = false;
  }

  get peerId() {
    return this.remoteDaemonId || `${this.ip}:${this.port}`;
  }

  _setState(newState) {
    const old = this.state;
    if (old === newState) return;
    this.state = newState;
    this.emit('state-change', { ip: this.ip, state: newState, oldState: old, newState, peerId: this.peerId });
  }

  async initiateKnock() {
    if (this._destroyed) return;
    this._setState(STATES.KNOCKING);

    const federation = this.manager.federation;
    const challenge = { type: 'knock', daemonId: federation._daemonId() };
    const envelope = federation.sign(challenge);

    try {
      const controller = new AbortController();
      this._knockTimeout = setTimeout(() => controller.abort(), KNOCK_TIMEOUT);

      const url = `http://${this.ip}:${this.port}/api/federation/knock`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          senderId: federation._daemonId(),
          publicKey: federation.getPublicKeyPem(),
          payload: envelope.payload,
          signature: envelope.signature,
        }),
        signal: controller.signal,
      });

      clearTimeout(this._knockTimeout);
      this._knockTimeout = null;

      if (!res.ok) {
        this._setState(STATES.MUTUAL);
        this._scheduleReconnect();
        return;
      }

      const data = await res.json();
      if (!data.accepted) {
        this._setState(STATES.MUTUAL);
        this._scheduleReconnect();
        return;
      }

      if (data.peerId) this.remoteDaemonId = data.peerId;
      if (data.publicKey) {
        this._ensurePeerStored(data);
      }

      this._openWebSocket();
    } catch {
      clearTimeout(this._knockTimeout);
      this._knockTimeout = null;
      this._setState(STATES.MUTUAL);
      this._scheduleReconnect();
    }
  }

  _ensurePeerStored(data) {
    const federation = this.manager.federation;
    if (data.peerId && data.publicKey && !federation.peers.has(data.peerId)) {
      federation._savePeer({
        id: data.peerId,
        name: data.peerName || data.peerId,
        host: this.ip,
        port: this.port,
        publicKey: data.publicKey,
        pairedAt: new Date().toISOString(),
      });
    }
  }

  _openWebSocket() {
    if (this._destroyed) return;

    const federation = this.manager.federation;
    const url = `ws://${this.ip}:${this.port}/ws/federation`;

    try {
      this.ws = new WebSocket(url, {
        headers: {
          'X-Groove-DaemonId': federation._daemonId(),
          'X-Groove-Signature': this._makeAuthHeader(),
        },
        handshakeTimeout: 10_000,
      });
    } catch {
      this._setState(STATES.MUTUAL);
      this._scheduleReconnect();
      return;
    }

    this.ws.on('open', () => {
      this._reconnectDelay = INITIAL_RECONNECT_DELAY;
      this._setState(STATES.CONNECTED);
      this._startHeartbeat();
      this.emit('connected', { ip: this.ip, peerId: this.peerId });
    });

    this.ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw);
        if (msg.type === 'pong') return;
        this.emit('message', msg);
      } catch { /* ignore malformed */ }
    });

    this.ws.on('close', () => {
      this._cleanup();
      if (!this._destroyed) {
        this._setState(STATES.MUTUAL);
        this.emit('disconnected', { ip: this.ip, peerId: this.peerId });
        this._scheduleReconnect();
      }
    });

    this.ws.on('error', () => {
      // close event will fire after error
    });
  }

  _makeAuthHeader() {
    const federation = this.manager.federation;
    const envelope = federation.sign({ type: 'ws-auth', daemonId: federation._daemonId() });
    return Buffer.from(JSON.stringify(envelope)).toString('base64');
  }

  send(message) {
    if (this.state !== STATES.CONNECTED || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    try {
      this.ws.send(JSON.stringify(message));
      return true;
    } catch {
      return false;
    }
  }

  _startHeartbeat() {
    this._stopHeartbeat();
    this._heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping', ts: Date.now() }));
      }
    }, HEARTBEAT_INTERVAL);
  }

  _stopHeartbeat() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }

  _scheduleReconnect() {
    if (this._destroyed || this._reconnectTimer) return;
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      if (!this._destroyed && this.state === STATES.MUTUAL) {
        this.initiateKnock();
      }
    }, this._reconnectDelay);
    this._reconnectDelay = Math.min(this._reconnectDelay * 2, MAX_RECONNECT_DELAY);
  }

  _cleanup() {
    this._stopHeartbeat();
    if (this.ws) {
      try { this.ws.terminate(); } catch { /* */ }
      this.ws = null;
    }
  }

  destroy() {
    this._destroyed = true;
    clearTimeout(this._reconnectTimer);
    clearTimeout(this._knockTimeout);
    this._reconnectTimer = null;
    this._knockTimeout = null;
    this._cleanup();
    this._setState(STATES.DISCONNECTED);
    this.removeAllListeners();
  }
}

export class ConnectionManager extends EventEmitter {
  constructor(federation) {
    super();
    this.federation = federation;
    this.daemon = federation.daemon;
    this.connections = new Map(); // ip -> PeerConnection
    this.inbound = new Map(); // daemonId -> ws (incoming connections from peers)
  }

  onMutual(ip, port, remoteDaemonId) {
    if (this.connections.has(ip)) {
      const existing = this.connections.get(ip);
      if (existing.state === STATES.CONNECTED) return;
      if (existing.state === STATES.KNOCKING) return;
    }

    const conn = this._getOrCreate(ip, port, remoteDaemonId);
    conn.initiateKnock();
  }

  _getOrCreate(ip, port, remoteDaemonId) {
    if (this.connections.has(ip)) {
      const existing = this.connections.get(ip);
      if (remoteDaemonId) existing.remoteDaemonId = remoteDaemonId;
      return existing;
    }

    const conn = new PeerConnection(this, ip, port, remoteDaemonId);

    conn.on('state-change', (info) => {
      this.emit('state-change', info);
      this.daemon.broadcast({ type: 'federation:connection', data: info });
    });

    conn.on('connected', (info) => {
      this.federation.whitelist.setConnected(ip);
      this.emit('connected', info);
      this.daemon.audit.log('federation.connected', { ip, peerId: info.peerId });
    });

    conn.on('disconnected', (info) => {
      this.federation.whitelist.setDisconnected(ip);
      this.emit('disconnected', info);
    });

    conn.on('message', (msg) => {
      this.emit('message', { ip, peerId: conn.peerId, message: msg });
    });

    this.connections.set(ip, conn);
    return conn;
  }

  handleInboundConnection(ws, daemonId) {
    this.inbound.set(daemonId, ws);
    this.emit('inbound-connected', { daemonId });
    this.daemon.audit.log('federation.inbound', { daemonId });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw);
        if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
          return;
        }
        this.emit('message', { daemonId, message: msg, inbound: true });
      } catch { /* ignore */ }
    });

    ws.on('close', () => {
      this.inbound.delete(daemonId);
      this.emit('inbound-disconnected', { daemonId });
    });
  }

  sendTo(peerIdentifier, message) {
    // Try outbound first (by IP)
    for (const [ip, conn] of this.connections) {
      if (ip === peerIdentifier || conn.remoteDaemonId === peerIdentifier || conn.peerId === peerIdentifier) {
        if (conn.send(message)) return true;
      }
    }
    // Try inbound (by daemonId)
    const inboundWs = this.inbound.get(peerIdentifier);
    if (inboundWs?.readyState === WebSocket.OPEN) {
      try {
        inboundWs.send(JSON.stringify(message));
        return true;
      } catch { /* */ }
    }
    return false;
  }

  getStatus() {
    const connections = [];
    for (const [ip, conn] of this.connections) {
      connections.push({
        ip,
        port: conn.port,
        peerId: conn.peerId,
        remoteDaemonId: conn.remoteDaemonId,
        state: conn.state,
        direction: 'outbound',
      });
    }
    for (const [daemonId] of this.inbound) {
      if (!connections.some(c => c.remoteDaemonId === daemonId)) {
        connections.push({
          peerId: daemonId,
          remoteDaemonId: daemonId,
          state: 'connected',
          direction: 'inbound',
        });
      }
    }
    return connections;
  }

  destroy() {
    for (const conn of this.connections.values()) {
      conn.destroy();
    }
    this.connections.clear();
    for (const ws of this.inbound.values()) {
      try { ws.terminate(); } catch { /* */ }
    }
    this.inbound.clear();
    this.removeAllListeners();
  }
}
