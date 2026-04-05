// GROOVE — Credential Storage (AES-256-GCM encrypted)
// FSL-1.1-Apache-2.0 — see LICENSE

import { readFileSync, writeFileSync, existsSync, chmodSync } from 'fs';
import { resolve } from 'path';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import { hostname, homedir } from 'os';

const ALGORITHM = 'aes-256-gcm';
const SALT_PREFIX = 'groove-v1';

export class CredentialStore {
  constructor(grooveDir) {
    this.path = resolve(grooveDir, 'credentials.json');
    this.data = {};
    this.encryptionKey = this.deriveKey();
    this.load();
  }

  // Derive encryption key from machine-specific data
  // Not unbreakable, but much better than base64 — credentials file is
  // meaningless if copied to another machine or read without this process.
  deriveKey() {
    const machineId = `${SALT_PREFIX}:${homedir()}:${hostname()}`;
    return scryptSync(machineId, 'groove-credential-salt', 32);
  }

  load() {
    if (existsSync(this.path)) {
      try {
        this.data = JSON.parse(readFileSync(this.path, 'utf8'));
      } catch {
        this.data = {};
      }
    }
  }

  save() {
    writeFileSync(this.path, JSON.stringify(this.data, null, 2));
    try { chmodSync(this.path, 0o600); } catch { /* Windows */ }
  }

  setKey(provider, key) {
    if (!provider || typeof provider !== 'string') throw new Error('Provider required');
    if (!key || typeof key !== 'string') throw new Error('Key required');

    this.data[provider] = {
      key: this.encrypt(key),
      setAt: new Date().toISOString(),
    };
    this.save();
  }

  getKey(provider) {
    const entry = this.data[provider];
    if (!entry) return null;
    try {
      return this.decrypt(entry.key);
    } catch {
      // Key was encrypted with different machine key, or corrupted
      return null;
    }
  }

  deleteKey(provider) {
    delete this.data[provider];
    this.save();
  }

  listProviders() {
    return Object.entries(this.data).map(([provider, entry]) => {
      const key = this.getKey(provider);
      return {
        provider,
        setAt: entry.setAt,
        masked: key ? this.mask(key) : '(unable to decrypt)',
      };
    });
  }

  hasKey(provider) {
    return !!this.data[provider];
  }

  getEnvForProvider(provider, providerInfo) {
    const key = this.getKey(provider);
    if (!key || !providerInfo?.envKey) return {};
    return { [providerInfo.envKey]: key };
  }

  encrypt(text) {
    const iv = randomBytes(16);
    const cipher = createCipheriv(ALGORITHM, this.encryptionKey, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();
    // Format: iv:authTag:ciphertext
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  decrypt(encoded) {
    const parts = encoded.split(':');
    if (parts.length !== 3) {
      // Legacy base64 format — migrate on read
      return Buffer.from(encoded, 'base64').toString('utf8');
    }
    const [ivHex, authTagHex, ciphertext] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = createDecipheriv(ALGORITHM, this.encryptionKey, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  mask(key) {
    if (!key || key.length < 8) return '****';
    return key.slice(0, 4) + '...' + key.slice(-4);
  }
}
