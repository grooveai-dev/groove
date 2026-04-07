// GROOVE — Federation (Ed25519 key exchange + contract signing)
// FSL-1.1-Apache-2.0 — see LICENSE

import { generateKeyPairSync, sign, verify, createPublicKey, createPrivateKey, createHash } from 'crypto';
import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync, readdirSync } from 'fs';
import { resolve } from 'path';

// Peer IDs must be safe for filenames — hex only (from SHA-256 fingerprint)
const PEER_ID_PATTERN = /^[a-f0-9]{1,64}$/;

function validatePeerId(id) {
  if (!id || typeof id !== 'string' || !PEER_ID_PATTERN.test(id)) {
    throw new Error(`Invalid peer ID: must be lowercase hex (got: ${String(id).slice(0, 20)})`);
  }
}

export class Federation {
  constructor(daemon) {
    this.daemon = daemon;
    this.fedDir = resolve(daemon.grooveDir, 'federation');
    this.peersDir = resolve(this.fedDir, 'peers');
    mkdirSync(this.peersDir, { recursive: true });

    // Load or generate this daemon's keypair
    this.keyPath = resolve(this.fedDir, 'identity.key');
    this.pubPath = resolve(this.fedDir, 'identity.pub');
    this._ensureKeypair();

    // In-memory peer cache
    this.peers = this._loadPeers();

    // Pending pairing requests (in-memory, short-lived)
    this.pendingPairs = new Map();
  }

  // --- Key Management ---

  _ensureKeypair() {
    if (existsSync(this.keyPath) && existsSync(this.pubPath)) {
      this.privateKey = createPrivateKey(readFileSync(this.keyPath));
      this.publicKey = createPublicKey(readFileSync(this.pubPath));
      return;
    }

    const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    writeFileSync(this.keyPath, privateKey, { mode: 0o600 });
    writeFileSync(this.pubPath, publicKey, { mode: 0o644 });

    this.privateKey = createPrivateKey(privateKey);
    this.publicKey = createPublicKey(publicKey);
  }

  getPublicKeyPem() {
    return readFileSync(this.pubPath, 'utf8');
  }

  // --- Signing / Verification ---

  /**
   * Sign a payload (contract or message).
   * @param {object} payload — JSON-serializable data
   * @returns {{ payload: object, signature: string }}
   */
  sign(payload) {
    const data = Buffer.from(JSON.stringify(payload), 'utf8');
    const sig = sign(null, data, this.privateKey);
    return {
      payload,
      signature: sig.toString('base64'),
    };
  }

  /**
   * Verify a signed message from a peer.
   * @param {string} peerId — the peer's ID
   * @param {object} payload — the original payload
   * @param {string} signature — base64 signature
   * @returns {boolean}
   */
  verify(peerId, payload, signature) {
    const peer = this.peers.get(peerId);
    if (!peer) return false;

    try {
      const data = Buffer.from(JSON.stringify(payload), 'utf8');
      const sig = Buffer.from(signature, 'base64');
      const pubKey = createPublicKey(peer.publicKey);
      return verify(null, data, pubKey, sig);
    } catch {
      return false;
    }
  }

  // --- Peer Management ---

  _loadPeers() {
    const peers = new Map();
    if (!existsSync(this.peersDir)) return peers;

    for (const file of readdirSync(this.peersDir)) {
      if (!file.endsWith('.json')) continue;
      try {
        const data = JSON.parse(readFileSync(resolve(this.peersDir, file), 'utf8'));
        peers.set(data.id, data);
      } catch { /* skip corrupt files */ }
    }
    return peers;
  }

  _savePeer(peer) {
    validatePeerId(peer.id);
    const file = resolve(this.peersDir, `${peer.id}.json`);
    writeFileSync(file, JSON.stringify(peer, null, 2), { mode: 0o600 });
    this.peers.set(peer.id, peer);
  }

  _removePeer(peerId) {
    validatePeerId(peerId);
    const file = resolve(this.peersDir, `${peerId}.json`);
    if (existsSync(file)) unlinkSync(file);
    this.peers.delete(peerId);
  }

  /**
   * Initiate pairing with a remote daemon.
   * Sends our public key + daemon info to the remote.
   * @param {string} remoteUrl — http://<ip>:<port> of remote daemon
   * @returns {object} pairing result
   */
  async initiatePairing(remoteUrl) {
    const localInfo = this._localInfo();

    // Send our public key to the remote daemon's pairing endpoint
    const res = await fetch(`${remoteUrl}/api/federation/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: localInfo.id,
        name: localInfo.name,
        host: localInfo.host,
        port: localInfo.port,
        publicKey: this.getPublicKeyPem(),
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Pairing failed: HTTP ${res.status}`);
    }

    const remote = await res.json();

    // Validate remote response before trusting it
    if (!remote.id || !remote.publicKey) {
      throw new Error('Remote returned invalid pairing response');
    }
    validatePeerId(remote.id);
    try {
      createPublicKey(remote.publicKey);
    } catch {
      throw new Error('Remote returned invalid public key');
    }

    // Store the remote's public key as a trusted peer
    this._savePeer({
      id: remote.id,
      name: remote.name,
      host: remote.host,
      port: remote.port,
      publicKey: remote.publicKey,
      pairedAt: new Date().toISOString(),
    });

    this.daemon.audit.log('federation.pair', { peerId: remote.id, peerHost: remote.host });

    return {
      peerId: remote.id,
      peerName: remote.name,
      peerHost: remote.host,
    };
  }

  /**
   * Handle incoming pairing request from a remote daemon.
   * @param {object} remoteInfo — { id, name, host, port, publicKey }
   * @returns {object} our info + public key for the remote to store
   */
  acceptPairing(remoteInfo) {
    if (!remoteInfo.id || !remoteInfo.publicKey) {
      throw new Error('Invalid pairing request: missing id or publicKey');
    }

    validatePeerId(remoteInfo.id);

    // Validate the public key is parseable PEM
    try {
      createPublicKey(remoteInfo.publicKey);
    } catch {
      throw new Error('Invalid pairing request: publicKey is not valid PEM');
    }

    // Store the remote peer
    this._savePeer({
      id: remoteInfo.id,
      name: remoteInfo.name || remoteInfo.id,
      host: remoteInfo.host,
      port: remoteInfo.port,
      publicKey: remoteInfo.publicKey,
      pairedAt: new Date().toISOString(),
    });

    this.daemon.audit.log('federation.pair', { peerId: remoteInfo.id, peerHost: remoteInfo.host });

    // Return our info so the remote can store us
    const localInfo = this._localInfo();
    return {
      id: localInfo.id,
      name: localInfo.name,
      host: localInfo.host,
      port: localInfo.port,
      publicKey: this.getPublicKeyPem(),
    };
  }

  /**
   * Remove a peer.
   */
  unpair(peerId) {
    if (!this.peers.has(peerId)) {
      throw new Error(`Peer not found: ${peerId}`);
    }
    const peer = this.peers.get(peerId);
    this._removePeer(peerId);
    this.daemon.audit.log('federation.unpair', { peerId, peerHost: peer.host });
  }

  // --- Contracts ---

  /**
   * Send a signed contract to a peer daemon.
   * @param {string} peerId — target peer
   * @param {object} contract — { type, spec, from, to }
   * @returns {object} remote response
   */
  async sendContract(peerId, contract) {
    const peer = this.peers.get(peerId);
    if (!peer) throw new Error(`Unknown peer: ${peerId}`);

    const envelope = this.sign({
      ...contract,
      from: this._localInfo().id,
      timestamp: new Date().toISOString(),
    });

    const url = `http://${peer.host}:${peer.port}/api/federation/contract`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ senderId: this._localInfo().id, ...envelope }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Contract delivery failed: HTTP ${res.status}`);
    }

    this.daemon.audit.log('federation.contract.send', { peerId, type: contract.type });

    return res.json();
  }

  /**
   * Receive and verify a contract from a peer.
   * @param {string} senderId — claimed sender
   * @param {object} payload — the contract data
   * @param {string} signature — base64 Ed25519 signature
   * @returns {object} verified contract
   */
  receiveContract(senderId, payload, signature) {
    if (!this.peers.has(senderId)) {
      throw new Error(`Unknown sender: ${senderId}. Not a paired peer.`);
    }

    if (!this.verify(senderId, payload, signature)) {
      throw new Error(`Signature verification failed for sender: ${senderId}`);
    }

    // Replay protection — reject contracts older than 5 minutes
    if (payload.timestamp) {
      const age = Date.now() - new Date(payload.timestamp).getTime();
      if (age > 5 * 60 * 1000) {
        throw new Error(`Contract too old (${Math.round(age / 1000)}s). Possible replay.`);
      }
      if (age < -60 * 1000) {
        throw new Error('Contract timestamp is in the future. Clock skew?');
      }
    }

    this.daemon.audit.log('federation.contract.recv', {
      senderId,
      type: payload.type,
    });

    return { verified: true, contract: payload };
  }

  // --- Info / Status ---

  _localInfo() {
    return {
      id: this._daemonId(),
      name: this._daemonId(),
      host: this.daemon.host,
      port: this.daemon.port,
    };
  }

  _daemonId() {
    // Stable ID derived from keypair — fingerprint of public key
    const idPath = resolve(this.fedDir, 'daemon.id');
    if (existsSync(idPath)) {
      return readFileSync(idPath, 'utf8').trim();
    }
    const pubPem = this.getPublicKeyPem();
    const id = createHash('sha256').update(pubPem).digest('hex').slice(0, 12);
    writeFileSync(idPath, id, { mode: 0o600 });
    return id;
  }

  getPeers() {
    return Array.from(this.peers.values()).map((p) => ({
      id: p.id,
      name: p.name,
      host: p.host,
      port: p.port,
      pairedAt: p.pairedAt,
    }));
  }

  getStatus() {
    return {
      id: this._daemonId(),
      peers: this.getPeers(),
      peerCount: this.peers.size,
      hasKeypair: existsSync(this.keyPath),
    };
  }
}
