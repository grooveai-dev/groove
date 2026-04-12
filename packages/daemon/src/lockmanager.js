// GROOVE — File Lock Manager
// FSL-1.1-Apache-2.0 — see LICENSE
//
// Two lock namespaces:
//   1. File-scope locks (register/release/check) — per-agent glob patterns
//      registered at spawn time to enforce scope ownership
//   2. Operation locks (declareOperation/completeOperation) — short-lived
//      resource claims for coordinated actions (npm install, server restarts,
//      shared config writes). Auto-expire to prevent deadlock if an agent
//      crashes mid-operation.

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { minimatch } from 'minimatch';

const DEFAULT_OPERATION_TTL_MS = 10 * 60 * 1000; // 10 minutes

export class LockManager {
  constructor(grooveDir) {
    this.path = resolve(grooveDir, 'locks.json');
    this.locks = new Map(); // agentId -> glob patterns[]
    this.operations = new Map(); // agentId -> { name, resources, acquiredAt, expiresAt }
    this.load();
  }

  load() {
    if (existsSync(this.path)) {
      try {
        const data = JSON.parse(readFileSync(this.path, 'utf8'));
        for (const [id, patterns] of Object.entries(data)) {
          this.locks.set(id, patterns);
        }
      } catch {
        // Start fresh
      }
    }
  }

  save() {
    const obj = Object.fromEntries(this.locks);
    writeFileSync(this.path, JSON.stringify(obj, null, 2));
  }

  register(agentId, patterns) {
    this.locks.set(agentId, patterns);
    this.save();
  }

  release(agentId) {
    this.locks.delete(agentId);
    this.operations.delete(agentId);
    this.save();
  }

  check(agentId, filePath) {
    for (const [ownerId, patterns] of this.locks) {
      if (ownerId === agentId) continue;
      for (const pattern of patterns) {
        if (minimatch(filePath, pattern)) {
          return { conflict: true, owner: ownerId, pattern };
        }
      }
    }
    return { conflict: false };
  }

  getAll() {
    return Object.fromEntries(this.locks);
  }

  // --- Operation locks (coordination protocol) ---

  _expireOperations() {
    const now = Date.now();
    for (const [id, op] of this.operations) {
      if (op.expiresAt <= now) this.operations.delete(id);
    }
  }

  declareOperation(agentId, operation, resources, ttlMs = DEFAULT_OPERATION_TTL_MS) {
    if (!agentId || !operation || !Array.isArray(resources) || resources.length === 0) {
      return { conflict: false, error: 'agentId, operation, and resources[] required' };
    }
    this._expireOperations();

    for (const [holderId, op] of this.operations) {
      if (holderId === agentId) continue;
      const overlap = op.resources.find((r) => resources.includes(r));
      if (overlap) {
        return {
          conflict: true,
          owner: holderId,
          operation: op.name,
          resource: overlap,
          expiresAt: op.expiresAt,
        };
      }
    }

    const now = Date.now();
    this.operations.set(agentId, {
      name: operation,
      resources,
      acquiredAt: now,
      expiresAt: now + ttlMs,
    });
    return { conflict: false };
  }

  completeOperation(agentId) {
    return this.operations.delete(agentId);
  }

  getOperations() {
    this._expireOperations();
    return Object.fromEntries(this.operations);
  }
}
