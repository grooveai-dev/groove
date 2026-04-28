// FSL-1.1-Apache-2.0 — see LICENSE

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { CURRENT_CONSENT_VERSION } from '../shared/constants.js';

function ensureDir(filePath) {
  const dir = filePath.replace(/[/\\][^/\\]+$/, '');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function readJSON(filePath) {
  if (!existsSync(filePath)) return null;
  try { return JSON.parse(readFileSync(filePath, 'utf-8')); } catch { return null; }
}

function writeJSON(filePath, data) {
  ensureDir(filePath);
  writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
}

export class ConsentManager {
  constructor(consentPath) {
    this._path = consentPath || join(homedir(), '.groove', 'consent.json');
  }

  recordConsent(userId, optedIn, consentVersion) {
    const data = {
      user_id: userId,
      opted_in: !!optedIn,
      consent_version: consentVersion,
      updated_at: new Date().toISOString(),
    };
    writeJSON(this._path, data);
  }

  isOptedIn(userId) {
    const data = readJSON(this._path);
    if (!data) return false;
    if (data.consent_version !== CURRENT_CONSENT_VERSION) return false;
    return data.opted_in === true;
  }

  revokeConsent(userId) {
    this.recordConsent(userId, false, CURRENT_CONSENT_VERSION);
  }

  getOptedInCount() {
    const data = readJSON(this._path);
    if (!data || !data.opted_in || data.consent_version !== CURRENT_CONSENT_VERSION) return 0;
    return 1;
  }

  getConsentHistory(userId) {
    const data = readJSON(this._path);
    if (!data) return [];
    return [{
      user_id: data.user_id,
      opted_in: data.opted_in,
      consent_version: data.consent_version,
      created_at: data.updated_at,
      metadata: null,
    }];
  }

  close() {}

  static getOrCreateUserId(userIdPath) {
    const filePath = userIdPath || join(homedir(), '.groove', 'user_id');
    ensureDir(filePath);
    if (existsSync(filePath)) {
      return readFileSync(filePath, 'utf-8').trim();
    }
    const uid = randomUUID().replace(/-/g, '');
    writeFileSync(filePath, uid, { mode: 0o600 });
    return uid;
  }

  static isCaptureEnabled(userIdPath, consentPath) {
    const filePath = userIdPath || join(homedir(), '.groove', 'user_id');
    if (!existsSync(filePath)) return false;
    const manager = new ConsentManager(consentPath);
    const userId = readFileSync(filePath, 'utf-8').trim();
    return manager.isOptedIn(userId);
  }
}
