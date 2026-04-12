// GROOVE — Model Router Tests
// FSL-1.1-Apache-2.0 — see LICENSE

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ModelRouter } from '../src/router.js';
import { TaskClassifier } from '../src/classifier.js';
import { mkdtempSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('ModelRouter', () => {
  let router;
  let mockDaemon;

  beforeEach(() => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'groove-test-'));
    const grooveDir = join(tmpDir, '.groove');
    mkdirSync(grooveDir, { recursive: true });

    const classifier = new TaskClassifier();

    mockDaemon = {
      grooveDir,
      classifier,
      registry: {
        get(id) {
          return { id, provider: 'claude-code' };
        },
      },
    };

    router = new ModelRouter(mockDaemon);
  });

  it('should default to fixed mode', () => {
    const mode = router.getMode('agent-1');
    assert.equal(mode.mode, 'fixed');
  });

  it('should set and get mode', () => {
    router.setMode('agent-1', 'auto');
    assert.equal(router.getMode('agent-1').mode, 'auto');

    router.setMode('agent-2', 'auto-floor', { floorModel: 'claude-sonnet-4-6' });
    const mode = router.getMode('agent-2');
    assert.equal(mode.mode, 'auto-floor');
    assert.equal(mode.floorModel, 'claude-sonnet-4-6');
  });

  it('should recommend fixed model in fixed mode', () => {
    router.setMode('agent-1', 'fixed', { fixedModel: 'claude-sonnet-4-6' });
    const rec = router.recommend('agent-1');
    assert.ok(rec);
    assert.equal(rec.mode, 'fixed');
    assert.equal(rec.reason, 'Fixed model');
  });

  it('should recommend based on classifier in auto mode', () => {
    router.setMode('agent-1', 'auto');

    // Add light activity
    for (let i = 0; i < 5; i++) {
      mockDaemon.classifier.addEvent('agent-1', { type: 'tool', tool: 'Read', input: `file${i}.js` });
    }

    const rec = router.recommend('agent-1');
    assert.ok(rec);
    assert.equal(rec.mode, 'auto');
  });

  it('should record usage', () => {
    router.recordUsage('agent-1', 'claude-sonnet-4-6', 100, 'medium');
    router.recordUsage('agent-1', 'claude-haiku-4-5-20251001', 50, 'light');

    const status = router.getStatus();
    assert.equal(status.costLogSize, 2);
  });

  it('should return null for unknown agent', () => {
    mockDaemon.registry.get = () => null;
    const rec = router.recommend('nonexistent');
    assert.equal(rec, null);
  });

  it('should report status', () => {
    router.setMode('agent-1', 'auto');
    const status = router.getStatus();

    assert.ok(status.agentModes);
    assert.ok(status.modes);
    assert.equal(status.modes.FIXED, 'fixed');
    assert.equal(status.modes.AUTO, 'auto');
    assert.equal(status.modes.AUTO_FLOOR, 'auto-floor');
  });

  describe('getSuggestion (downshift only, never auto-applied)', () => {
    beforeEach(() => {
      // Mock registry returns an agent on claude-code with heavy model
      mockDaemon.registry.get = (id) => ({
        id,
        provider: 'claude-code',
        model: 'claude-opus-4-6',
        role: 'backend',
      });
    });

    it('returns null when agent not found', () => {
      mockDaemon.registry.get = () => null;
      assert.equal(router.getSuggestion('missing'), null);
    });

    it('returns null when classifier has too few events', () => {
      // Add a handful — below the 40-event threshold
      for (let i = 0; i < 10; i++) {
        mockDaemon.classifier.addEvent('agent-1', { type: 'tool', tool: 'Read', input: `f${i}.js` });
      }
      assert.equal(router.getSuggestion('agent-1'), null);
    });

    it('suggests a lighter model when classification is light with enough data', () => {
      for (let i = 0; i < 50; i++) {
        mockDaemon.classifier.addEvent('agent-1', { type: 'tool', tool: 'Read', input: `f${i}.js` });
      }
      const s = router.getSuggestion('agent-1');
      assert.ok(s, 'expected a suggestion');
      assert.equal(s.classifiedTier, 'light');
      assert.equal(s.currentModel.tier, 'heavy');
      assert.ok(['medium', 'light'].includes(s.suggestedModel.tier));
    });

    it('does not suggest upshift (never silently escalates)', () => {
      // Heavy-signal events
      for (let i = 0; i < 50; i++) {
        mockDaemon.classifier.addEvent('agent-1', {
          type: 'tool', tool: 'Edit', input: `f${i}.js`, data: 'complex refactor migrate schema',
        });
      }
      // Current model is already heavy; never suggest going heavier
      const s = router.getSuggestion('agent-1');
      // Either null (no lower tier) or only suggests lighter
      if (s) {
        const tierRank = { heavy: 3, medium: 2, light: 1 };
        assert.ok(tierRank[s.suggestedModel.tier] < tierRank[s.currentModel.tier]);
      }
    });

    it('returns null when current model already matches classification', () => {
      mockDaemon.registry.get = (id) => ({
        id, provider: 'claude-code',
        model: 'claude-haiku-4-5-20251001', // light tier
        role: 'backend',
      });
      for (let i = 0; i < 50; i++) {
        mockDaemon.classifier.addEvent('agent-1', { type: 'tool', tool: 'Read', input: `f${i}.js` });
      }
      assert.equal(router.getSuggestion('agent-1'), null);
    });
  });
});
