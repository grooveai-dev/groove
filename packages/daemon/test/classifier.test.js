// GROOVE — Task Classifier Tests
// FSL-1.1-Apache-2.0 — see LICENSE

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { TaskClassifier } from '../src/classifier.js';

describe('TaskClassifier', () => {
  let classifier;

  beforeEach(() => {
    classifier = new TaskClassifier();
  });

  it('should default to medium when no events', () => {
    assert.equal(classifier.classify('agent-1'), 'medium');
  });

  it('should classify read-only activity as light', () => {
    for (let i = 0; i < 5; i++) {
      classifier.addEvent('agent-1', { type: 'tool', tool: 'Read', input: 'src/api/auth.js' });
    }
    classifier.addEvent('agent-1', { type: 'tool', tool: 'Grep', input: 'pattern' });
    classifier.addEvent('agent-1', { type: 'tool', tool: 'Glob', input: '**/*.js' });

    assert.equal(classifier.classify('agent-1'), 'light');
  });

  it('should classify multi-file edits as heavy', () => {
    classifier.addEvent('agent-1', { type: 'tool', tool: 'Write', input: 'src/api/auth.js' });
    classifier.addEvent('agent-1', { type: 'tool', tool: 'Write', input: 'src/api/users.js' });
    classifier.addEvent('agent-1', { type: 'tool', tool: 'Write', input: 'src/api/middleware.js' });
    classifier.addEvent('agent-1', { type: 'tool', tool: 'Write', input: 'src/db/schema.js' });
    classifier.addEvent('agent-1', { type: 'tool', tool: 'Write', input: 'src/db/migrations.js' });

    assert.equal(classifier.classify('agent-1'), 'heavy');
  });

  it('should classify refactor keywords as heavy', () => {
    classifier.addEvent('agent-1', { type: 'activity', data: 'I need to refactor the entire auth system' });
    classifier.addEvent('agent-1', { type: 'activity', data: 'This requires a full redesign of the architecture' });
    classifier.addEvent('agent-1', { type: 'activity', data: 'Need to migrate the database schema' });
    classifier.addEvent('agent-1', { type: 'activity', data: 'Rewriting the authentication middleware' });

    assert.equal(classifier.classify('agent-1'), 'heavy');
  });

  it('should classify errors as heavy', () => {
    for (let i = 0; i < 3; i++) {
      classifier.addEvent('agent-1', { type: 'error', text: 'TypeError: undefined' });
    }

    assert.equal(classifier.classify('agent-1'), 'heavy');
  });

  it('should get recommendation with matching model', () => {
    classifier.addEvent('agent-1', { type: 'tool', tool: 'Read', input: 'file.js' });
    classifier.addEvent('agent-1', { type: 'tool', tool: 'Read', input: 'file2.js' });
    classifier.addEvent('agent-1', { type: 'tool', tool: 'Grep', input: 'search' });
    classifier.addEvent('agent-1', { type: 'tool', tool: 'Read', input: 'file3.js' });
    classifier.addEvent('agent-1', { type: 'tool', tool: 'Read', input: 'file4.js' });

    const models = [
      { id: 'opus', name: 'Opus', tier: 'heavy' },
      { id: 'sonnet', name: 'Sonnet', tier: 'medium' },
      { id: 'haiku', name: 'Haiku', tier: 'light' },
    ];

    const rec = classifier.getRecommendation('agent-1', models);
    assert.equal(rec.tier, 'light');
    assert.equal(rec.model.id, 'haiku');
  });

  it('should fall back to medium when no matching tier', () => {
    const models = [
      { id: 'opus', name: 'Opus', tier: 'heavy' },
      { id: 'sonnet', name: 'Sonnet', tier: 'medium' },
    ];

    const rec = classifier.getRecommendation('agent-1', models);
    assert.equal(rec.model.id, 'sonnet');
  });

  it('should maintain sliding window', () => {
    const cap = classifier.windowSize;
    for (let i = 0; i < cap + 10; i++) {
      classifier.addEvent('agent-1', { type: 'tool', tool: 'Read', input: `file${i}.js` });
    }
    assert.equal(classifier.agentWindows['agent-1'].length, cap);
  });

  it('should clear agent window', () => {
    classifier.addEvent('agent-1', { type: 'tool', tool: 'Read', input: 'file.js' });
    classifier.clearAgent('agent-1');
    assert.equal(classifier.classify('agent-1'), 'medium');
  });

  describe('getUpdates()', () => {
    it('should return empty when no agents have 40+ events', () => {
      for (let i = 0; i < 39; i++) {
        classifier.addEvent('agent-1', { type: 'tool', tool: 'Read', input: `file${i}.js` });
      }
      const updates = classifier.getUpdates();
      assert.equal(updates.length, 0);
    });

    it('should return classification when agent has enough events', () => {
      for (let i = 0; i < 45; i++) {
        classifier.addEvent('agent-1', { type: 'tool', tool: 'Read', input: `file${i}.js` });
      }
      const updates = classifier.getUpdates();
      assert.equal(updates.length, 1);
      assert.equal(updates[0].agentId, 'agent-1');
      assert.equal(updates[0].tier, 'light');
      assert.equal(updates[0].eventCount, 45);
    });

    it('should only report changes — no repeat when tier and count stable', () => {
      for (let i = 0; i < 45; i++) {
        classifier.addEvent('agent-1', { type: 'tool', tool: 'Read', input: `file${i}.js` });
      }
      // First call reports
      const first = classifier.getUpdates();
      assert.equal(first.length, 1);

      // Second call with no new events — no report
      const second = classifier.getUpdates();
      assert.equal(second.length, 0);
    });

    it('should report again when tier changes', () => {
      // Start with read-only (light)
      for (let i = 0; i < 45; i++) {
        classifier.addEvent('agent-1', { type: 'tool', tool: 'Read', input: `file${i}.js` });
      }
      classifier.getUpdates(); // consume initial report

      // Add heavy signals to shift classification
      for (let i = 0; i < 50; i++) {
        classifier.addEvent('agent-1', { type: 'error', text: 'TypeError: undefined' });
      }
      const updates = classifier.getUpdates();
      assert.equal(updates.length, 1);
      assert.equal(updates[0].tier, 'heavy');
    });

    it('should report again when event count delta reaches 20', () => {
      for (let i = 0; i < 45; i++) {
        classifier.addEvent('agent-1', { type: 'tool', tool: 'Read', input: `file${i}.js` });
      }
      classifier.getUpdates(); // consume initial report (eventCount=45)

      // Add 20 more events (same tier, but eventCount delta = 20)
      for (let i = 0; i < 20; i++) {
        classifier.addEvent('agent-1', { type: 'tool', tool: 'Read', input: `extra${i}.js` });
      }
      const updates = classifier.getUpdates();
      assert.equal(updates.length, 1);
      assert.equal(updates[0].eventCount, 65);
    });

    it('should not report when event count delta is less than 20', () => {
      for (let i = 0; i < 45; i++) {
        classifier.addEvent('agent-1', { type: 'tool', tool: 'Read', input: `file${i}.js` });
      }
      classifier.getUpdates(); // consume initial report (eventCount=45)

      // Add only 10 more events — delta < 20, same tier
      for (let i = 0; i < 10; i++) {
        classifier.addEvent('agent-1', { type: 'tool', tool: 'Read', input: `extra${i}.js` });
      }
      const updates = classifier.getUpdates();
      assert.equal(updates.length, 0);
    });
  });

  describe('clearAgent() broadcast state', () => {
    it('should clear broadcast state so next getUpdates reports fresh', () => {
      for (let i = 0; i < 45; i++) {
        classifier.addEvent('agent-1', { type: 'tool', tool: 'Read', input: `file${i}.js` });
      }
      classifier.getUpdates(); // consume initial report

      // Clear and re-populate
      classifier.clearAgent('agent-1');
      assert.equal(classifier._lastBroadcast['agent-1'], undefined);

      for (let i = 0; i < 45; i++) {
        classifier.addEvent('agent-1', { type: 'tool', tool: 'Read', input: `file${i}.js` });
      }
      const updates = classifier.getUpdates();
      assert.equal(updates.length, 1); // Reports again because broadcast state was cleared
    });
  });
});
