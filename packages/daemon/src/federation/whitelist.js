// GROOVE — Federation IP Whitelist Manager
// FSL-1.1-Apache-2.0 — see LICENSE

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { EventEmitter } from 'events';

const PROBE_INTERVAL = 15_000;
const PROBE_TIMEOUT = 5_000;

const PRIVATE_PATTERNS = [
  /^127\./, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./,
  /^0\./, /^169\.254\./, /^localhost$/i, /^::1$/, /^\[::1\]$/,
  /^fc/i, /^fd/i, /^fe80/i,
];

function isPrivateIp(host) {
  return PRIVATE_PATTERNS.some(p => p.test(host));
}

function validateIp(ip) {
  if (!ip || typeof ip !== 'string') throw new Error('IP is required');
  const trimmed = ip.trim();
  if (trimmed.length > 253) throw new Error('IP too long');
  if (isPrivateIp(trimmed)) throw new Error('Cannot whitelist private/local addresses');
  if (/[;&|`$(){}]/.test(trimmed)) throw new Error('Invalid characters in IP');
  return trimmed;
}

export class WhitelistManager extends EventEmitter {
  constructor(federation) {
    super();
    this.federation = federation;
    this.daemon = federation.daemon;
    this.filePath = resolve(federation.fedDir, 'whitelist.json');
    this.entries = this._load();
    this._probeTimer = null;
  }

  _load() {
    if (!existsSync(this.filePath)) return new Map();
    try {
      const data = JSON.parse(readFileSync(this.filePath, 'utf8'));
      const map = new Map();
      for (const entry of data) {
        map.set(entry.ip, entry);
      }
      return map;
    } catch {
      return new Map();
    }
  }

  _save() {
    const dir = resolve(this.federation.fedDir);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(Array.from(this.entries.values()), null, 2), { mode: 0o600 });
  }

  add(ip, port = 31415) {
    const validated = validateIp(ip);
    if (this.entries.has(validated)) {
      throw new Error(`IP already whitelisted: ${validated}`);
    }

    const entry = {
      ip: validated,
      port: typeof port === 'number' ? port : 31415,
      status: 'waiting',
      addedAt: new Date().toISOString(),
      lastProbe: null,
      remoteDaemonId: null,
    };

    this.entries.set(validated, entry);
    this._save();
    this.daemon.audit.log('federation.whitelist.add', { ip: validated, port: entry.port });
    this.emit('added', entry);
    return entry;
  }

  remove(ip) {
    const trimmed = ip?.trim();
    if (!this.entries.has(trimmed)) {
      throw new Error(`IP not in whitelist: ${trimmed}`);
    }
    const entry = this.entries.get(trimmed);
    this.entries.delete(trimmed);
    this._save();
    this.daemon.audit.log('federation.whitelist.remove', { ip: trimmed });
    this.emit('removed', { ip: trimmed, previousStatus: entry.status });
    return true;
  }

  list() {
    return Array.from(this.entries.values());
  }

  isWhitelisted(ip) {
    return this.entries.has(ip?.trim());
  }

  getEntry(ip) {
    return this.entries.get(ip?.trim()) || null;
  }

  startProbing() {
    if (this._probeTimer) return;
    this._probeTimer = setInterval(() => this._probeAll(), PROBE_INTERVAL);
    this._probeAll();
  }

  stopProbing() {
    if (this._probeTimer) {
      clearInterval(this._probeTimer);
      this._probeTimer = null;
    }
  }

  async _probeAll() {
    for (const entry of this.entries.values()) {
      if (entry.status === 'connected') continue;
      try {
        await this._probePeer(entry);
      } catch {
        // Individual probe failures are expected
      }
    }
  }

  async _probePeer(entry) {
    const url = `http://${entry.ip}:${entry.port}/api/federation/whitelist-check`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT);

    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'X-Groove-DaemonId': this.federation._daemonId() },
      });
      clearTimeout(timeout);

      if (!res.ok) {
        this._updateStatus(entry, 'waiting');
        return;
      }

      const data = await res.json();
      entry.lastProbe = new Date().toISOString();
      entry.remoteDaemonId = data.daemonId || null;

      if (data.whitelisted) {
        this._updateStatus(entry, 'mutual');
      } else {
        this._updateStatus(entry, 'waiting');
      }
    } catch {
      clearTimeout(timeout);
      entry.lastProbe = new Date().toISOString();
    }
  }

  _updateStatus(entry, newStatus) {
    const oldStatus = entry.status;
    if (oldStatus === newStatus) return;
    entry.status = newStatus;
    this._save();
    this.emit('status-change', { ip: entry.ip, oldStatus, newStatus, entry });
  }

  setConnected(ip) {
    const entry = this.entries.get(ip?.trim());
    if (entry) {
      this._updateStatus(entry, 'connected');
    }
  }

  setDisconnected(ip) {
    const entry = this.entries.get(ip?.trim());
    if (entry && entry.status === 'connected') {
      this._updateStatus(entry, 'mutual');
    }
  }

  destroy() {
    this.stopProbing();
    this.removeAllListeners();
  }
}
