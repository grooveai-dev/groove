// GROOVE — Supervisor Tests
// FSL-1.1-Apache-2.0 — see LICENSE

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Supervisor } from '../src/supervisor.js';

describe('Supervisor', () => {
  let supervisor;
  let broadcasts;

  beforeEach(() => {
    broadcasts = [];
    const mockRegistry = {
      get(id) { return { name: `agent-${id}` }; },
      getAll() { return []; },
    };
    const mockTokens = {
      recordConflictPrevented() {},
    };
    supervisor = new Supervisor({
      broadcast(msg) { broadcasts.push(msg); },
      registry: mockRegistry,
      tokens: mockTokens,
      projectDir: null,
    });
  });

  describe('approvals', () => {
    it('should request approval and return pending status', () => {
      const approval = supervisor.requestApproval('agent-1', {
        type: 'file_write',
        path: 'src/api/auth.js',
      });

      assert.ok(approval.id);
      assert.equal(approval.agentId, 'agent-1');
      assert.equal(approval.status, 'pending');
      assert.ok(approval.requestedAt);
      assert.equal(broadcasts.length, 1);
      assert.equal(broadcasts[0].type, 'approval:request');
    });

    it('should approve a pending request', () => {
      const approval = supervisor.requestApproval('agent-1', { type: 'test' });
      const resolved = supervisor.approve(approval.id);

      assert.equal(resolved.status, 'approved');
      assert.ok(resolved.resolvedAt);
      assert.equal(supervisor.getPending().length, 0);
      assert.equal(supervisor.getResolved().length, 1);
    });

    it('should reject a pending request with reason', () => {
      const approval = supervisor.requestApproval('agent-1', { type: 'test' });
      const resolved = supervisor.reject(approval.id, 'Out of scope');

      assert.equal(resolved.status, 'rejected');
      assert.equal(resolved.reason, 'Out of scope');
      assert.equal(supervisor.getPending().length, 0);
      assert.equal(supervisor.getResolved().length, 1);
    });

    it('should return null for unknown approval id', () => {
      assert.equal(supervisor.approve('nonexistent'), null);
      assert.equal(supervisor.reject('nonexistent'), null);
    });

    it('should list pending approvals', () => {
      supervisor.requestApproval('agent-1', { type: 'test1' });
      supervisor.requestApproval('agent-2', { type: 'test2' });

      assert.equal(supervisor.getPending().length, 2);

      const first = supervisor.getPending()[0];
      supervisor.approve(first.id);

      assert.equal(supervisor.getPending().length, 1);
      assert.equal(supervisor.getResolved().length, 1);
    });

    it('should get approval by id', () => {
      const approval = supervisor.requestApproval('agent-1', { type: 'test' });
      const found = supervisor.getApproval(approval.id);
      assert.equal(found.id, approval.id);

      // Also find resolved
      supervisor.approve(approval.id);
      const resolved = supervisor.getApproval(approval.id);
      assert.equal(resolved.status, 'approved');
    });
  });

  describe('conflicts', () => {
    it('should record a conflict', () => {
      const conflict = supervisor.recordConflict('a1', 'src/api/auth.js', 'a2');

      assert.ok(conflict.timestamp);
      assert.equal(conflict.agentId, 'a1');
      assert.equal(conflict.filePath, 'src/api/auth.js');
      assert.equal(conflict.ownerId, 'a2');
      assert.equal(supervisor.getConflicts().length, 1);
    });

    it('should create an approval when recording a conflict', () => {
      supervisor.recordConflict('a1', 'src/api/auth.js', 'a2');

      assert.equal(supervisor.getPending().length, 1);
      const approval = supervisor.getPending()[0];
      assert.equal(approval.action.type, 'scope_violation');
      assert.ok(approval.action.description.includes('src/api/auth.js'));
    });

    it('should broadcast conflict detection', () => {
      supervisor.recordConflict('a1', 'src/api/auth.js', 'a2');

      const conflictBroadcast = broadcasts.find((b) => b.type === 'conflict:detected');
      assert.ok(conflictBroadcast);
    });
  });

  describe('QC threshold', () => {
    it('should not activate QC below threshold', () => {
      supervisor.daemon = {
        ...supervisor.daemon,
        registry: {
          getAll() {
            return [
              { status: 'running', role: 'backend' },
              { status: 'running', role: 'frontend' },
            ];
          },
        },
      };

      assert.equal(supervisor.checkQcThreshold(), false);
      assert.equal(supervisor.isQcActive(), false);
    });

    it('should activate QC at threshold', () => {
      supervisor.daemon = {
        ...supervisor.daemon,
        registry: {
          getAll() {
            return [
              { status: 'running', role: 'backend' },
              { status: 'running', role: 'frontend' },
              { status: 'running', role: 'testing' },
              { status: 'running', role: 'devops' },
            ];
          },
        },
      };

      assert.equal(supervisor.checkQcThreshold(), true);
      assert.equal(supervisor.isQcActive(), true);
    });

    it('should not re-activate when already active', () => {
      supervisor.qcActive = true;
      assert.equal(supervisor.checkQcThreshold(), false);
    });
  });

  describe('status', () => {
    it('should report status', () => {
      supervisor.requestApproval('a1', { type: 'test' });
      supervisor.recordConflict('a1', 'file.js', 'a2');

      const status = supervisor.getStatus();
      assert.equal(status.pendingApprovals, 2); // 1 manual + 1 from conflict
      assert.equal(status.conflicts, 1);
      assert.equal(status.qcActive, false);
    });
  });
});
