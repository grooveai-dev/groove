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
});
