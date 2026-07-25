// GROOVE — ChatStore tests
// FSL-1.1-Apache-2.0 — see LICENSE

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { resolve } from 'path';
import { ChatStore } from '../src/chatstore.js';

describe('ChatStore', () => {
  let dir, store;

  beforeEach(() => {
    dir = mkdtempSync(resolve(tmpdir(), 'groove-chat-'));
    store = new ChatStore({ grooveDir: dir });
  });
  afterEach(() => {
    store.stop();
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('appends and returns per-agent history', () => {
    store.append('a1', { from: 'user', text: 'hello', timestamp: 1 });
    store.append('a1', { from: 'agent', text: 'hi', timestamp: 2 });
    store.append('a2', { from: 'user', text: 'other', timestamp: 3 });

    assert.equal(store.get('a1').length, 2);
    assert.equal(store.get('a2').length, 1);
    assert.deepEqual(store.getAll().a1.map((m) => m.text), ['hello', 'hi']);
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

    const reloaded = new ChatStore({ grooveDir: dir });
    assert.equal(reloaded.get('a1')[0].text, 'durable');
    reloaded.stop();
  });

  it('writes the file atomically (no stray .tmp left)', () => {
    store.append('a1', { from: 'user', text: 'x', timestamp: 1 });
    store.stop();
    assert.ok(existsSync(resolve(dir, 'chat-history.json')));
    assert.ok(!existsSync(resolve(dir, 'chat-history.json.tmp')));
    const onDisk = JSON.parse(readFileSync(resolve(dir, 'chat-history.json'), 'utf8'));
    assert.equal(onDisk.a1[0].text, 'x');
  });

  it('caps per-agent history', () => {
    for (let i = 0; i < 250; i++) store.append('a1', { from: 'user', text: `m${i}`, timestamp: i });
    const h = store.get('a1');
    assert.equal(h.length, 200);
    assert.equal(h[0].text, 'm50');       // oldest 50 dropped
    assert.equal(h.at(-1).text, 'm249');
  });

  it('replace() swaps an agent history wholesale', () => {
    store.append('a1', { from: 'user', text: 'old' });
    store.replace('a1', [{ from: 'user', text: 'new1' }, { from: 'agent', text: 'new2' }]);
    assert.deepEqual(store.get('a1').map((m) => m.text), ['new1', 'new2']);
  });

  it('remove() deletes an agent history', () => {
    store.append('a1', { from: 'user', text: 'x' });
    store.remove('a1');
    assert.equal(store.get('a1').length, 0);
  });

  it('starts empty when the file is missing or corrupt', () => {
    const empty = new ChatStore({ grooveDir: mkdtempSync(resolve(tmpdir(), 'groove-chat-empty-')) });
    assert.deepEqual(empty.getAll(), {});
    empty.stop();
  });
});
