// GROOVE — MemoryStore Tests (Layer 7)
// FSL-1.1-Apache-2.0 — see LICENSE

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../src/memory.js';
import { mkdtempSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('MemoryStore', () => {
  let memory;
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'groove-memory-test-'));
    memory = new MemoryStore(tmpDir);
  });

  describe('constraints', () => {
    it('starts with no constraints', () => {
      assert.deepEqual(memory.listConstraints(), []);
      assert.equal(memory.getConstraintsMarkdown(), '');
    });

    it('adds a constraint and returns a hash', () => {
      const result = memory.addConstraint({ text: 'Never touch packages/daemon/index.js', category: 'hard' });
      assert.equal(result.added, true);
      assert.ok(result.hash);

      const list = memory.listConstraints();
      assert.equal(list.length, 1);
      assert.equal(list[0].category, 'hard');
      assert.match(list[0].text, /Never touch/);
    });

    it('dedups identical constraints', () => {
      memory.addConstraint({ text: 'ESM only', category: 'pattern' });
      const result = memory.addConstraint({ text: 'ESM only', category: 'pattern' });
      assert.equal(result.added, false);
      assert.equal(result.reason, 'duplicate');
      assert.equal(memory.listConstraints().length, 1);
    });

    it('rejects empty and oversized text', () => {
      assert.equal(memory.addConstraint({ text: '' }).added, false);
      assert.equal(memory.addConstraint({ text: 'ab' }).added, false);
      assert.equal(memory.addConstraint({ text: 'x'.repeat(600) }).added, false);
    });

    it('removes constraints by hash', () => {
      const r = memory.addConstraint({ text: 'remove me', category: 'test' });
      assert.equal(memory.removeConstraint(r.hash), true);
      assert.equal(memory.listConstraints().length, 0);
      // Removing non-existent hash returns false
      assert.equal(memory.removeConstraint('nonexistent'), false);
    });

    it('getConstraintsMarkdown groups by category', () => {
      memory.addConstraint({ text: 'rule-a', category: 'hard' });
      memory.addConstraint({ text: 'rule-b', category: 'hard' });
      memory.addConstraint({ text: 'pattern-x', category: 'pattern' });
      const md = memory.getConstraintsMarkdown();
      assert.match(md, /\*\*hard:\*\*/);
      assert.match(md, /\*\*pattern:\*\*/);
      assert.match(md, /rule-a/);
      assert.match(md, /pattern-x/);
    });

    it('survives restart', () => {
      memory.addConstraint({ text: 'persists across restart', category: 'test' });
      const memory2 = new MemoryStore(tmpDir);
      assert.equal(memory2.listConstraints().length, 1);
      assert.match(memory2.listConstraints()[0].text, /persists/);
    });
  });

  describe('handoff chain', () => {
    it('starts with no chain', () => {
      assert.deepEqual(memory.getHandoffChain('backend'), []);
      assert.equal(memory.getRecentHandoffMarkdown('backend'), '');
    });

    it('appends a rotation entry', () => {
      const ok = memory.appendHandoffBrief('backend', {
        agentId: 'bk-1',
        newAgentId: 'bk-2',
        reason: 'context_threshold',
        oldTokens: 5_000_000,
        contextUsage: 0.82,
        brief: 'Finished auth refactor, started on payment flow',
        timestamp: '2026-04-12T14:00:00Z',
      });
      assert.equal(ok, true);

      const chain = memory.getHandoffChain('backend');
      assert.equal(chain.length, 1);
      assert.equal(chain[0].rotationN, 1);
      assert.match(chain[0].body, /Rotation 1/);
      assert.match(chain[0].body, /context_threshold/);
    });

    it('increments rotation numbers and keeps newest first', () => {
      memory.appendHandoffBrief('backend', { brief: 'first' });
      memory.appendHandoffBrief('backend', { brief: 'second' });
      memory.appendHandoffBrief('backend', { brief: 'third' });

      const chain = memory.getHandoffChain('backend');
      assert.equal(chain.length, 3);
      assert.equal(chain[0].rotationN, 3);
      assert.equal(chain[2].rotationN, 1);
    });

    it('caps chain at MAX_HANDOFF_ROTATIONS (25)', () => {
      for (let i = 0; i < 30; i++) {
        memory.appendHandoffBrief('backend', { brief: `rotation-${i}` });
      }
      const chain = memory.getHandoffChain('backend');
      assert.equal(chain.length, 25);
      assert.equal(chain[0].rotationN, 30);
    });

    it('separate chains per role', () => {
      memory.appendHandoffBrief('backend', { brief: 'backend work' });
      memory.appendHandoffBrief('frontend', { brief: 'frontend work' });
      assert.equal(memory.getHandoffChain('backend').length, 1);
      assert.equal(memory.getHandoffChain('frontend').length, 1);
      assert.deepEqual(memory.listHandoffRoles().sort(), ['backend', 'frontend']);
    });

    it('getRecentHandoffMarkdown returns N newest', () => {
      for (let i = 0; i < 5; i++) {
        memory.appendHandoffBrief('backend', { brief: `brief-${i}` });
      }
      const md = memory.getRecentHandoffMarkdown('backend', 3);
      assert.match(md, /brief-4/);
      assert.match(md, /brief-3/);
      assert.match(md, /brief-2/);
      assert.ok(!md.includes('brief-1'));
    });

    it('sanitizes role names for filesystem safety', () => {
      const ok = memory.appendHandoffBrief('../evil/role', { brief: 'test' });
      assert.equal(ok, true);
      assert.ok(existsSync(tmpDir));
    });

    it('scopes chains by workspace', () => {
      const wsA = join(tmpDir, '..', 'electron-app');
      const wsB = join(tmpDir, '..', 'agents-team');
      memory.appendHandoffBrief('backend', { brief: 'electron backend work' }, wsA);
      memory.appendHandoffBrief('backend', { brief: 'agents backend work' }, wsB);

      const chainA = memory.getHandoffChain('backend', wsA);
      const chainB = memory.getHandoffChain('backend', wsB);
      assert.equal(chainA.length, 1);
      assert.equal(chainB.length, 1);
      assert.match(chainA[0].body, /electron backend/);
      assert.match(chainB[0].body, /agents backend/);
    });

    it('workspace chains are independent from root chains', () => {
      const ws = join(tmpDir, '..', 'my-workspace');
      memory.appendHandoffBrief('frontend', { brief: 'root work' });
      memory.appendHandoffBrief('frontend', { brief: 'workspace work' }, ws);

      assert.equal(memory.getHandoffChain('frontend').length, 1);
      assert.equal(memory.getHandoffChain('frontend', ws).length, 1);
      assert.match(memory.getRecentHandoffMarkdown('frontend'), /root work/);
      assert.match(memory.getRecentHandoffMarkdown('frontend', 3, 4000, ws), /workspace work/);
    });

    it('listHandoffRoles scoped to workspace', () => {
      const ws = join(tmpDir, '..', 'electron-app');
      memory.appendHandoffBrief('backend', { brief: 'root' });
      memory.appendHandoffBrief('frontend', { brief: 'ws' }, ws);

      const rootRoles = memory.listHandoffRoles();
      const wsRoles = memory.listHandoffRoles(ws);
      assert.ok(rootRoles.includes('backend'));
      assert.ok(!rootRoles.includes('frontend'));
      assert.ok(wsRoles.includes('frontend'));
    });
  });

  describe('discoveries', () => {
    it('starts with no discoveries', () => {
      assert.deepEqual(memory.listDiscoveries(), []);
      assert.equal(memory.getDiscoveriesMarkdown(), '');
    });

    it('adds a success discovery', () => {
      const result = memory.addDiscovery({
        agentId: 'bk-1',
        role: 'backend',
        trigger: 'Cannot find module gray-matter',
        fix: 'npm install gray-matter',
        outcome: 'success',
      });
      assert.equal(result.added, true);

      const list = memory.listDiscoveries();
      assert.equal(list.length, 1);
      assert.equal(list[0].role, 'backend');
    });

    it('rejects non-success outcomes', () => {
      const result = memory.addDiscovery({
        trigger: 'err',
        fix: 'did not work',
        outcome: 'failed',
      });
      assert.equal(result.added, false);
    });

    it('rejects incomplete records', () => {
      assert.equal(memory.addDiscovery({ trigger: 'x' }).added, false);
      assert.equal(memory.addDiscovery({ fix: 'y' }).added, false);
    });

    it('dedups identical trigger+fix pairs', () => {
      memory.addDiscovery({ trigger: 'error X', fix: 'fix X' });
      const result = memory.addDiscovery({ trigger: 'error X', fix: 'fix X' });
      assert.equal(result.added, false);
      assert.equal(result.reason, 'duplicate');
    });

    it('filters by role', () => {
      memory.addDiscovery({ role: 'backend', trigger: 'a', fix: 'fa' });
      memory.addDiscovery({ role: 'frontend', trigger: 'b', fix: 'fb' });
      memory.addDiscovery({ role: 'backend', trigger: 'c', fix: 'fc' });

      assert.equal(memory.listDiscoveries({ role: 'backend' }).length, 2);
      assert.equal(memory.listDiscoveries({ role: 'frontend' }).length, 1);
      assert.equal(memory.listDiscoveries().length, 3);
    });

    it('getDiscoveriesMarkdown formats for agent consumption', () => {
      memory.addDiscovery({ role: 'backend', trigger: 'X error', fix: 'do Y' });
      const md = memory.getDiscoveriesMarkdown('backend');
      assert.match(md, /X error/);
      assert.match(md, /do Y/);
    });
  });

  describe('specializations', () => {
    it('starts empty', () => {
      const all = memory.getAllSpecializations();
      assert.deepEqual(all.perAgent, {});
      assert.deepEqual(all.perProjectRole, {});
    });

    it('updates an agent profile', () => {
      memory.updateSpecialization('bk-1', {
        role: 'backend',
        qualityScore: 80,
        filesTouched: ['src/a.js', 'src/b.js'],
      });
      const spec = memory.getSpecialization('bk-1');
      assert.ok(spec);
      assert.equal(spec.role, 'backend');
      assert.equal(spec.avgQualityScore, 80);
      assert.equal(spec.sessionCount, 1);
      assert.equal(spec.fileTouches['src/a.js'], 1);
    });

    it('averages quality score across sessions', () => {
      memory.updateSpecialization('bk-1', { role: 'backend', qualityScore: 70 });
      memory.updateSpecialization('bk-1', { role: 'backend', qualityScore: 90 });
      assert.equal(memory.getSpecialization('bk-1').avgQualityScore, 80);
      assert.equal(memory.getSpecialization('bk-1').sessionCount, 2);
    });

    it('aggregates per-role stats', () => {
      memory.updateSpecialization('bk-1', { role: 'backend', qualityScore: 80 });
      memory.updateSpecialization('bk-2', { role: 'backend', qualityScore: 60 });
      const all = memory.getAllSpecializations();
      assert.equal(all.perProjectRole.backend.sessionCount, 2);
      assert.equal(all.perProjectRole.backend.avgQualityScore, 70);
    });

    it('survives restart', () => {
      memory.updateSpecialization('bk-1', { role: 'backend', qualityScore: 75 });
      const memory2 = new MemoryStore(tmpDir);
      assert.equal(memory2.getSpecialization('bk-1').avgQualityScore, 75);
    });
  });
});
