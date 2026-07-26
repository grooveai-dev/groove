// GROOVE — ChatStore tests
// FSL-1.1-Apache-2.0 — see LICENSE

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { resolve } from 'path';
import { ChatStore, mergeMessages } from '../src/chatstore.js';

// Minimal registry: id -> {id, name}. Lets tests exercise the id→name
// resolution that makes history survive rotation.
function makeDaemon(agents = []) {
  const map = new Map(agents.map((a) => [a.id, a]));
  return {
    grooveDir: null, // set per test
    registry: {
      _map: map,
      get(id) { return map.get(id) || null; },
      getAll() { return [...map.values()]; },
      set(a) { map.set(a.id, a); },
      delete(id) { map.delete(id); },
    },
  };
}

describe('ChatStore', () => {
  let dir, daemon, store;

  beforeEach(() => {
    dir = mkdtempSync(resolve(tmpdir(), 'groove-chat-'));
    daemon = makeDaemon([{ id: 'a1', name: 'fullstack-1' }, { id: 'a2', name: 'planner-1' }]);
    daemon.grooveDir = dir;
    store = new ChatStore(daemon);
  });
  afterEach(() => {
    store.stop();
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('appends under the agent NAME when given an id', () => {
    store.append('a1', { from: 'user', text: 'hello', timestamp: 1 });
    store.append('fullstack-1', { from: 'agent', text: 'hi', timestamp: 2 });

    // Both routes land in one bucket — the name.
    assert.deepEqual(store.get('a1').map((m) => m.text), ['hello', 'hi']);
    assert.deepEqual(store.getAll()['fullstack-1'].map((m) => m.text), ['hello', 'hi']);
    assert.equal(store.getAll().a1, undefined);
  });

  it('history survives rotation: new id, same name, same history', () => {
    store.append('a1', { from: 'user', text: 'before rotation', timestamp: 1 });

    // Rotation mints a new id; the name is stable.
    daemon.registry.delete('a1');
    daemon.registry.set({ id: 'a1-r9', name: 'fullstack-1' });

    store.append('a1-r9', { from: 'agent', text: 'after rotation', timestamp: 2 });
    assert.deepEqual(store.get('a1-r9').map((m) => m.text), ['before rotation', 'after rotation']);
  });

  it('remap() folds a dead-id entry into the live agent', () => {
    // Simulates data written under an id while the registry didn't know it
    // (stale client post mid-rotation) — the rotation:complete hook remaps it.
    store.history['dead-id'] = [{ from: 'user', text: 'stranded', timestamp: 1 }];
    store.remap('dead-id', 'a1');
    assert.equal(store.history['dead-id'], undefined);
    assert.deepEqual(store.get('a1').map((m) => m.text), ['stranded']);
  });

  it('migrate() reattaches id-keyed histories from the old store format', () => {
    store.history = {
      a1: [{ from: 'user', text: 'legacy', timestamp: 1 }],
      'fullstack-1': [{ from: 'agent', text: 'current', timestamp: 2 }],
      'ghost-id': [{ from: 'user', text: 'unresolvable', timestamp: 3 }],
    };
    const moved = store.migrate();
    assert.equal(moved, 1);
    assert.deepEqual(store.getAll()['fullstack-1'].map((m) => m.text), ['legacy', 'current']);
    // Unresolvable keys are parked, never dropped.
    assert.equal(store.getAll()['ghost-id'][0].text, 'unresolvable');
  });

  it('view() keys live agents by CURRENT id and parks the rest by name', () => {
    store.append('a1', { from: 'user', text: 'live', timestamp: 1 });
    store.history['departed-agent'] = [{ from: 'user', text: 'old', timestamp: 2 }];
    const v = store.view();
    assert.equal(v.a1[0].text, 'live');            // fullstack-1 → its live id
    assert.equal(v['fullstack-1'], undefined);
    assert.equal(v['departed-agent'][0].text, 'old'); // no live agent — name key
  });

  it('merge() is a union — a sparse client can never truncate server history', () => {
    for (let i = 0; i < 10; i++) store.append('a1', { from: 'user', text: `m${i}`, timestamp: i });
    // Client syncs only 2 messages (1 duplicate, 1 new).
    store.merge('a1', [
      { from: 'user', text: 'm3', timestamp: 3 },
      { from: 'agent', text: 'fresh', timestamp: 99 },
    ]);
    const texts = store.get('a1').map((m) => m.text);
    assert.equal(texts.length, 11);
    assert.equal(texts.at(-1), 'fresh');
    assert.ok(texts.includes('m0') && texts.includes('m9'));
  });

  it('strips attachment data URLs but keeps metadata', () => {
    store.append('a1', {
      from: 'user', text: 'pic', timestamp: 1,
      attachments: [{ name: 'x.png', size: 9, dataUrl: 'data:image/png;base64,AAAA' }],
    });
    const m = store.get('a1')[0];
    assert.equal(m.attachments[0].dataUrl, undefined);
    assert.equal(m.attachments[0].name, 'x.png');
  });

  it('persists across instances (survives a daemon restart)', () => {
    store.append('a1', { from: 'user', text: 'durable', timestamp: 1 });
    store.stop(); // flushes synchronously

    const reloaded = new ChatStore(daemon);
    assert.equal(reloaded.get('a1')[0].text, 'durable');
    reloaded.stop();
  });

  it('writes the file atomically (no stray .tmp left)', () => {
    store.append('a1', { from: 'user', text: 'x', timestamp: 1 });
    store.stop();
    assert.ok(existsSync(resolve(dir, 'chat-history.json')));
    assert.ok(!existsSync(resolve(dir, 'chat-history.json.tmp')));
    const onDisk = JSON.parse(readFileSync(resolve(dir, 'chat-history.json'), 'utf8'));
    assert.equal(onDisk['fullstack-1'][0].text, 'x');
  });

  it('caps per-agent history', () => {
    for (let i = 0; i < 250; i++) store.append('a1', { from: 'user', text: `m${i}`, timestamp: i });
    const h = store.get('a1');
    assert.equal(h.length, 200);
    assert.equal(h[0].text, 'm50');       // oldest 50 dropped
    assert.equal(h.at(-1).text, 'm249');
  });

  it('remove() deletes by name so a purge cannot haunt a future same-name agent', () => {
    store.append('a1', { from: 'user', text: 'x' });
    store.remove('fullstack-1');
    assert.equal(store.get('a1').length, 0);
  });

  it('works without a registry (refs pass through verbatim)', () => {
    const bare = new ChatStore({ grooveDir: mkdtempSync(resolve(tmpdir(), 'groove-chat-bare-')) });
    bare.append('some-id', { from: 'user', text: 'x', timestamp: 1 });
    assert.equal(bare.get('some-id')[0].text, 'x');
    bare.stop();
  });

  it('starts empty when the file is missing or corrupt', () => {
    const empty = new ChatStore({ grooveDir: mkdtempSync(resolve(tmpdir(), 'groove-chat-empty-')) });
    assert.deepEqual(empty.getAll(), {});
    empty.stop();
  });
});

describe('mergeMessages', () => {
  it('dedupes on (timestamp, from, text) and sorts by time', () => {
    const merged = mergeMessages(
      [{ from: 'u', text: 'b', timestamp: 2 }, { from: 'u', text: 'a', timestamp: 1 }],
      [{ from: 'u', text: 'a', timestamp: 1 }, { from: 'u', text: 'c', timestamp: 3 }],
    );
    assert.deepEqual(merged.map((m) => m.text), ['a', 'b', 'c']);
  });

  it('treats same text at different timestamps as distinct messages', () => {
    const merged = mergeMessages(
      [{ from: 'u', text: 'ok', timestamp: 1 }],
      [{ from: 'u', text: 'ok', timestamp: 2 }],
    );
    assert.equal(merged.length, 2);
  });
});
