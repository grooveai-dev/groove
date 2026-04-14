// GROOVE — Introducer Tests
// FSL-1.1-Apache-2.0 — see LICENSE

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Introducer } from '../src/introducer.js';
import { Registry } from '../src/registry.js';
import { StateManager } from '../src/state.js';
import { MemoryStore } from '../src/memory.js';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('Introducer', () => {
  let introducer;
  let registry;
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'groove-test-'));
    const state = new StateManager(tmpDir);
    registry = new Registry(state);
    introducer = new Introducer({ registry, projectDir: tmpDir, grooveDir: tmpDir });
  });

  describe('generateContext', () => {
    it('should generate solo context when agent is alone', () => {
      const agent = registry.add({ role: 'backend', scope: ['src/api/**'] });
      const ctx = introducer.generateContext(agent);

      assert.ok(ctx.includes('backend-1'));
      assert.ok(ctx.includes('src/api/**'));
      assert.ok(ctx.includes('only agent'));
    });

    it('should generate team context when other agents exist', () => {
      const a1 = registry.add({ role: 'backend', scope: ['src/api/**'] });
      registry.update(a1.id, { status: 'running' });

      const a2 = registry.add({ role: 'frontend', scope: ['src/components/**'] });

      const ctx = introducer.generateContext(a2);

      assert.ok(ctx.includes('frontend-2'));
      assert.ok(ctx.includes('Team'));
      assert.ok(ctx.includes('backend-1'));
      assert.ok(ctx.includes('src/api/**'));
      assert.ok(ctx.includes('Coordination Rules'));
    });

    it('should not list non-running agents as teammates', () => {
      const a1 = registry.add({ role: 'backend' });
      registry.update(a1.id, { status: 'stopped' });

      const a2 = registry.add({ role: 'frontend' });
      const ctx = introducer.generateContext(a2);

      assert.ok(ctx.includes('only agent'));
      assert.ok(!ctx.includes('backend-1'));
    });

    it('should handle agents with no scope', () => {
      const agent = registry.add({ role: 'fullstack', scope: [] });
      const ctx = introducer.generateContext(agent);

      assert.ok(ctx.includes('no file scope restrictions'));
    });
  });

  describe('writeRegistryFile', () => {
    it('should write AGENTS_REGISTRY.md', () => {
      registry.add({ role: 'backend', scope: ['src/api/**'] });
      registry.add({ role: 'frontend', scope: ['src/components/**'] });

      introducer.writeRegistryFile(tmpDir);

      const content = readFileSync(join(tmpDir, 'AGENTS_REGISTRY.md'), 'utf8');
      assert.ok(content.includes('AGENTS REGISTRY'));
      assert.ok(content.includes('backend-1'));
      assert.ok(content.includes('frontend-2'));
      assert.ok(content.includes('src/api/**'));
      assert.ok(content.includes('src/components/**'));
    });

    it('should clear registry file when no agents', () => {
      // Write some content first
      writeFileSync(join(tmpDir, 'AGENTS_REGISTRY.md'), 'old content');

      introducer.writeRegistryFile(tmpDir);

      const content = readFileSync(join(tmpDir, 'AGENTS_REGISTRY.md'), 'utf8');
      assert.equal(content, '');
    });
  });

  describe('Layer 7 memory injection', () => {
    it('should append memory section at end of context when memory exists', () => {
      const grooveDir = join(tmpDir, '.groove');
      mkdirSync(grooveDir, { recursive: true });
      const memory = new MemoryStore(grooveDir);
      memory.addConstraint({ text: 'Never modify packages/daemon/index.js directly', category: 'hard' });
      memory.addDiscovery({ role: 'backend', trigger: 'Cannot find module X', fix: 'npm install X', outcome: 'success' });

      const daemon = { registry, projectDir: tmpDir, grooveDir, memory };
      const intro = new Introducer(daemon);

      const agent = registry.add({ role: 'backend', scope: ['src/api/**'] });
      const ctx = intro.generateContext(agent, { hasTask: true });

      assert.ok(ctx.includes('## Project Memory (auto-generated)'));
      assert.ok(ctx.includes('Constraints (read carefully)'));
      assert.ok(ctx.includes('Never modify packages/daemon/index.js'));
      assert.ok(ctx.includes('Known Fixes for backend Role'));
      assert.ok(ctx.includes('Cannot find module X'));
    });

    it('should not inject memory section when memory is empty', () => {
      const grooveDir = join(tmpDir, '.groove');
      mkdirSync(grooveDir, { recursive: true });
      const memory = new MemoryStore(grooveDir);

      const daemon = { registry, projectDir: tmpDir, grooveDir, memory };
      const intro = new Introducer(daemon);

      const agent = registry.add({ role: 'backend', scope: [] });
      const ctx = intro.generateContext(agent);

      assert.ok(!ctx.includes('## Project Memory'));
    });

    it('should not break spawn when memory is unavailable', () => {
      const daemon = { registry, projectDir: tmpDir, grooveDir: tmpDir, memory: null };
      const intro = new Introducer(daemon);

      const agent = registry.add({ role: 'backend', scope: [] });
      const ctx = intro.generateContext(agent);

      // Should produce valid context without memory section
      assert.ok(ctx.includes('backend'));
      assert.ok(!ctx.includes('## Project Memory'));
    });

    it('should enforce 4K character budget on memory section', () => {
      const grooveDir = join(tmpDir, '.groove');
      mkdirSync(grooveDir, { recursive: true });
      const memory = new MemoryStore(grooveDir);
      // Add many constraints to exceed budget
      for (let i = 0; i < 40; i++) {
        memory.addConstraint({ text: `Rule ${i}: never touch file-${i}.config.js in the project root directory`, category: 'hard' });
      }

      const daemon = { registry, projectDir: tmpDir, grooveDir, memory };
      const intro = new Introducer(daemon);

      const agent = registry.add({ role: 'backend', scope: [] });
      const ctx = intro.generateContext(agent);

      // Memory section should exist but be truncated
      const memStart = ctx.indexOf('## Project Memory');
      assert.ok(memStart !== -1);
      const memSection = ctx.slice(memStart);
      assert.ok(memSection.length <= 4003); // 4000 + "..." adjustment
    });
  });

  describe('CLAUDE.md injection', () => {
    it('should inject GROOVE section into existing CLAUDE.md', () => {
      writeFileSync(join(tmpDir, 'CLAUDE.md'), '# My Project\n\nSome content.\n');

      const agent = registry.add({ role: 'backend', scope: ['src/api/**'] });
      registry.update(agent.id, { status: 'running' });

      introducer.injectGrooveSection(tmpDir);

      const content = readFileSync(join(tmpDir, 'CLAUDE.md'), 'utf8');
      assert.ok(content.includes('# My Project'));
      assert.ok(content.includes('Some content.'));
      assert.ok(content.includes('<!-- GROOVE:START -->'));
      assert.ok(content.includes('<!-- GROOVE:END -->'));
      assert.ok(content.includes('backend-1'));
    });

    it('should update existing GROOVE section without duplicating', () => {
      writeFileSync(join(tmpDir, 'CLAUDE.md'), '# My Project\n');

      const a1 = registry.add({ role: 'backend' });
      registry.update(a1.id, { status: 'running' });
      introducer.injectGrooveSection(tmpDir);

      const a2 = registry.add({ role: 'frontend' });
      registry.update(a2.id, { status: 'running' });
      introducer.injectGrooveSection(tmpDir);

      const content = readFileSync(join(tmpDir, 'CLAUDE.md'), 'utf8');
      const startCount = (content.match(/GROOVE:START/g) || []).length;
      assert.equal(startCount, 1, 'should only have one GROOVE section');
      assert.ok(content.includes('frontend-2'));
    });

    it('should not create CLAUDE.md if it does not exist', () => {
      introducer.injectGrooveSection(tmpDir);
      assert.ok(!existsSync(join(tmpDir, 'CLAUDE.md')));
    });

    it('should remove GROOVE section cleanly', () => {
      writeFileSync(join(tmpDir, 'CLAUDE.md'), '# My Project\n\nContent before.\n');

      const agent = registry.add({ role: 'backend' });
      registry.update(agent.id, { status: 'running' });
      introducer.injectGrooveSection(tmpDir);

      introducer.removeGrooveSection(tmpDir);

      const content = readFileSync(join(tmpDir, 'CLAUDE.md'), 'utf8');
      assert.ok(!content.includes('GROOVE:START'));
      assert.ok(!content.includes('GROOVE:END'));
      assert.ok(content.includes('# My Project'));
      assert.ok(content.includes('Content before.'));
    });
  });
});
