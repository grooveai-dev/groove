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
    this.locks = new Map(); // agentId -> { patterns, workingDir }
    this._compiledPatterns = new Map(); // agentId -> RegExp[]
    this.operations = new Map(); // agentId -> { name, resources, acquiredAt, expiresAt }
    this.load();
  }

  load() {
    if (existsSync(this.path)) {
      try {
        const data = JSON.parse(readFileSync(this.path, 'utf8'));
        for (const [id, val] of Object.entries(data)) {
          // Backward compat: old format stored just patterns array
          const entry = Array.isArray(val) ? { patterns: val, workingDir: null } : val;
          this.locks.set(id, entry);
          this._compilePatterns(id, entry.patterns);
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

  _compilePatterns(agentId, patterns) {
    const compiled = patterns.map((p) => {
      const re = minimatch.makeRe(p);
      return { pattern: p, re };
    });
    this._compiledPatterns.set(agentId, compiled);
  }

  register(agentId, patterns, workingDir = null) {
    this.locks.set(agentId, { patterns, workingDir: workingDir || null });
    this._compilePatterns(agentId, patterns);
    this.save();
  }

  release(agentId) {
    this.locks.delete(agentId);
    this._compiledPatterns.delete(agentId);
    this.operations.delete(agentId);
    this.save();
  }

  // Scopes are per-team — only conflict with owners in the same workingDir.
  // Pass workingDir=null to skip the filter (legacy behavior).
  check(agentId, filePath, workingDir = null) {
    for (const [ownerId, compiled] of this._compiledPatterns) {
      if (ownerId === agentId) continue;
      const ownerEntry = this.locks.get(ownerId);
      if (workingDir && ownerEntry?.workingDir && ownerEntry.workingDir !== workingDir) continue;
      for (const { pattern, re } of compiled) {
        if (re && re.test(filePath)) {
          return { conflict: true, owner: ownerId, pattern };
        }
      }
    }
    return { conflict: false };
  }

  /**
   * Prefix-based overlap test between two scope pattern sets.
   * Two scopes overlap if any pair of patterns has a prefix containment
   * relationship (one prefix is a parent dir of the other) or shares an
   * identical prefix. An empty/broad pattern (e.g. `**`) always overlaps.
   *
   * Used at spawn time to block two agents claiming the same files.
   * Intentionally conservative: returns overlap for ambiguous cases so
   * collisions fail loud rather than silently.
   */
  static scopesOverlap(patternsA, patternsB) {
    if (!Array.isArray(patternsA) || !Array.isArray(patternsB)) return false;
    if (patternsA.length === 0 || patternsB.length === 0) return false;
    const prefixOf = (p) => {
      const idx = p.search(/[*?[{]/);
      const head = idx === -1 ? p : p.slice(0, idx);
      return head.replace(/\/+$/, '');
    };
    for (const a of patternsA) {
      const pa = prefixOf(a);
      for (const b of patternsB) {
        const pb = prefixOf(b);
        if (pa === pb) return { overlap: true, a, b };
        if (pa === '' || pb === '') return { overlap: true, a, b };
        const longer = pa.length > pb.length ? pa : pb;
        const shorter = pa.length > pb.length ? pb : pa;
        if (longer.startsWith(shorter + '/')) return { overlap: true, a, b };
      }
    }
    return { overlap: false };
  }

  /**
   * Find any currently-locked agent whose scope overlaps with candidateScope.
   * Returns { overlap: true, owner, ... } for the first conflict, else {overlap:false}.
   * Pass workingDir to limit the search to the same team folder (scopes are per-team).
   */
  findOverlappingOwner(candidateScope, workingDir = null) {
    for (const [ownerId, entry] of this.locks) {
      if (workingDir && entry.workingDir && entry.workingDir !== workingDir) continue;
      const res = LockManager.scopesOverlap(candidateScope, entry.patterns);
      if (res.overlap) return { overlap: true, owner: ownerId, ownerScope: entry.patterns, ...res };
    }
    return { overlap: false };
  }

  purgeOrphans(aliveAgentIds) {
    const alive = new Set(aliveAgentIds);
    let purged = 0;
    for (const id of this.locks.keys()) {
      if (!alive.has(id)) {
        this.locks.delete(id);
        this._compiledPatterns.delete(id);
        purged++;
      }
    }
    for (const id of this.operations.keys()) {
      if (!alive.has(id)) {
        this.operations.delete(id);
      }
    }
    if (purged > 0) this.save();
    return purged;
  }

  getAll() {
    const obj = {};
    for (const [id, entry] of this.locks) obj[id] = entry.patterns;
    return obj;
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
