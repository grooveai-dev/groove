// GROOVE — Agent Rename Migration Tests
// FSL-1.1-Apache-2.0 — see LICENSE

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'fs';
import { resolve } from 'path';
import { tmpdir } from 'os';
import { renameAgent } from '../src/rename.js';
import { Registry } from '../src/registry.js';

describe('renameAgent', () => {
  let root, daemon, agent;

  beforeEach(() => {
    root = mkdtempSync(resolve(tmpdir(), 'groove-rename-'));
    const grooveDir = resolve(root, '.groove');
    mkdirSync(resolve(grooveDir, 'logs'), { recursive: true });
    mkdirSync(resolve(grooveDir, 'personalities'), { recursive: true });
    mkdirSync(resolve(root, 'agent-files'), { recursive: true });

    const registry = new Registry({ save() {}, load() { return null; } });
    daemon = {
      registry,
      grooveDir,
      projectDir: root,
      audit: { log() {} },
    };
    agent = registry.add({ role: 'fullstack', name: 'fullstack-1' });

    writeFileSync(resolve(grooveDir, 'logs', 'fullstack-1.log'), 'session history');
    writeFileSync(resolve(grooveDir, 'personalities', 'fullstack-1.md'), 'be terse');
    mkdirSync(resolve(root, 'agent-files', 'fullstack-1'));
    writeFileSync(resolve(root, 'agent-files', 'fullstack-1', 'notes.md'), 'notes');
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const p = {
    log: (n) => resolve(root, '.groove', 'logs', `${n}.log`),
    personality: (n) => resolve(root, '.groove', 'personalities', `${n}.md`),
    files: (n) => resolve(root, 'agent-files', n),
  };

  it('migrates the log, personality and agent-files', () => {
    renameAgent(daemon, agent.id, 'senior-dev');

    assert.equal(daemon.registry.get(agent.id).name, 'senior-dev');

    assert.ok(!existsSync(p.log('fullstack-1')), 'old log removed');
    assert.equal(readFileSync(p.log('senior-dev'), 'utf8'), 'session history');

    assert.ok(!existsSync(p.personality('fullstack-1')));
    assert.equal(readFileSync(p.personality('senior-dev'), 'utf8'), 'be terse');

    assert.ok(!existsSync(p.files('fullstack-1')));
    assert.equal(readFileSync(resolve(p.files('senior-dev'), 'notes.md'), 'utf8'), 'notes');
  });

  it('rejects a name already taken by another agent', () => {
    daemon.registry.add({ role: 'fullstack', name: 'fullstack-2' });
    assert.throws(() => renameAgent(daemon, agent.id, 'fullstack-2'), /already exists/);

    // Nothing moved — the original log must survive a rejected rename.
    assert.equal(daemon.registry.get(agent.id).name, 'fullstack-1');
    assert.equal(readFileSync(p.log('fullstack-1'), 'utf8'), 'session history');
  });

  it('rejects an empty name and no-ops an unchanged one', () => {
    assert.throws(() => renameAgent(daemon, agent.id, '   '), /name is required/);
    const same = renameAgent(daemon, agent.id, 'fullstack-1');
    assert.equal(same.name, 'fullstack-1');
    assert.equal(readFileSync(p.log('fullstack-1'), 'utf8'), 'session history');
  });

  it('throws for an unknown agent', () => {
    assert.throws(() => renameAgent(daemon, 'nope', 'whatever'), /Agent not found/);
  });

  it('tolerates missing artifacts', () => {
    rmSync(p.personality('fullstack-1'));
    rmSync(p.files('fullstack-1'), { recursive: true });

    renameAgent(daemon, agent.id, 'solo');
    assert.equal(readFileSync(p.log('solo'), 'utf8'), 'session history');
    assert.ok(!existsSync(p.personality('solo')));
  });

  it('rejects names that would escape their directory', () => {
    // These become path segments (agent-files/<name>), so a separator or a
    // dot-segment would write outside the intended directory.
    for (const bad of ['front end/dev', '../escape', '..', 'a/../../b', 'has space']) {
      assert.throws(() => renameAgent(daemon, agent.id, bad), /name may only contain|name must be/);
    }
    assert.equal(daemon.registry.get(agent.id).name, 'fullstack-1');
    assert.ok(existsSync(p.log('fullstack-1')));
  });

  it('rejects an over-long name', () => {
    assert.throws(() => renameAgent(daemon, agent.id, 'x'.repeat(65)), /64 characters/);
  });

  it('blocks a bare registry.update from renaming without migration', () => {
    daemon.registry.update(agent.id, { name: 'sneaky' });
    assert.equal(daemon.registry.get(agent.id).name, 'fullstack-1');
    assert.ok(existsSync(p.log('fullstack-1')), 'log was never orphaned');
  });
});
