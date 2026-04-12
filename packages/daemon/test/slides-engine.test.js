// GROOVE — Slides Layout Engine Tests
// FSL-1.1-Apache-2.0 — see LICENSE

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const engine = require(resolve(__dirname, '../templates/groove-slides.cjs'));

describe('slides-engine / LAYOUT', () => {
  it('exposes frozen constants with the documented 16:9 safe zone', () => {
    assert.equal(engine.LAYOUT.SLIDE_W, 10);
    assert.equal(engine.LAYOUT.SLIDE_H, 5.625);
    assert.equal(engine.LAYOUT.SAFE_BOT, 5.125);
    assert.equal(engine.LAYOUT.CONTENT_START, 0.65);
    assert.throws(() => { engine.LAYOUT.SLIDE_W = 99; }, /read only|Cannot assign/i);
  });
});

describe('slides-engine / estimateTextHeight', () => {
  it('returns single-line height for short text', () => {
    const h = engine.estimateTextHeight('Hello', 18, 5.0);
    const lineH = (18 * 1.3) / 72;
    assert.ok(Math.abs(h - lineH) < 0.01, `expected ~${lineH}, got ${h}`);
  });

  it('accounts for word wrap on long text in a narrow box', () => {
    const short = engine.estimateTextHeight('One two', 24, 8.0);
    const long = engine.estimateTextHeight(
      'This sentence is long enough to wrap across multiple lines in a narrow box',
      24, 2.0,
    );
    assert.ok(long > short * 2, `long (${long}) should be at least 2× short (${short})`);
  });

  it('respects explicit newlines', () => {
    const h = engine.estimateTextHeight('one\ntwo\nthree', 12, 8.0);
    const lineH = (12 * 1.3) / 72;
    assert.ok(h >= lineH * 3 - 0.01, `expected ≥ 3 lines, got ${h}`);
  });

  it('does not divide by zero on empty text', () => {
    assert.ok(engine.estimateTextHeight('', 18, 5.0) > 0);
  });
});

describe('slides-engine / fitFontSize', () => {
  it('returns maxSize when text already fits', () => {
    const size = engine.fitFontSize('Short', 48, 18, 8.0, 2.0);
    assert.equal(size, 48);
  });

  it('shrinks text to fit a constrained box', () => {
    const long = 'AI coding tools are broken at the multi-agent level.';
    const fitted = engine.fitFontSize(long, 48, 18, 5.5, 0.85, { bold: true });
    assert.ok(fitted < 48, `should have shrunk from 48, got ${fitted}`);
    const needed = engine.estimateTextHeight(long, fitted, 5.5, { bold: true });
    assert.ok(needed <= 0.85, `fitted size ${fitted} still overflows: needs ${needed}`);
  });

  it('returns minSize when even that does not fit', () => {
    const impossibleText = 'a '.repeat(500);
    const size = engine.fitFontSize(impossibleText, 48, 10, 1.0, 0.3);
    assert.equal(size, 10);
  });
});

describe('slides-engine / checkCollisions', () => {
  it('detects overlapping rectangles', () => {
    const issues = engine.checkCollisions([
      { name: 'a', x: 0, y: 0, w: 2, h: 1 },
      { name: 'b', x: 1, y: 0.5, w: 2, h: 1 },
    ]);
    assert.equal(issues.length, 1);
    assert.match(issues[0], /OVERLAP/);
  });

  it('returns empty for non-overlapping rectangles', () => {
    const issues = engine.checkCollisions([
      { name: 'a', x: 0, y: 0, w: 2, h: 1 },
      { name: 'b', x: 3, y: 0, w: 2, h: 1 },
    ]);
    assert.deepEqual(issues, []);
  });

  it('ignores skipCollision flag — no bypasses allowed', () => {
    const issues = engine.checkCollisions([
      { name: 'a', x: 0, y: 0, w: 2, h: 1, skipCollision: true },
      { name: 'b', x: 1, y: 0.5, w: 2, h: 1, skipCollision: true },
    ]);
    assert.equal(issues.length, 1, 'skipCollision flag must not bypass the check');
  });
});

describe('slides-engine / checkBounds', () => {
  it('flags elements that overflow the safe bottom', () => {
    const issues = engine.checkBounds([
      { name: 'footer', x: 0.6, y: 5.0, w: 8.8, h: 0.5 },
    ]);
    assert.equal(issues.length, 1);
    assert.match(issues[0], /BOTTOM-OVERFLOW/);
  });

  it('flags top / left / right overflow', () => {
    const issues = engine.checkBounds([
      { name: 'above', x: 0.6, y: -0.1, w: 1, h: 0.2 },
      { name: 'leftOut', x: -0.5, y: 1, w: 0.3, h: 0.2 },
      { name: 'rightOut', x: 9.8, y: 1, w: 0.5, h: 0.2 },
    ]);
    assert.ok(issues.some((m) => /TOP-OVERFLOW/.test(m)));
    assert.ok(issues.some((m) => /LEFT-OVERFLOW/.test(m)));
    assert.ok(issues.some((m) => /RIGHT-OVERFLOW/.test(m)));
  });

  it('ignores skipBounds flag — no bypasses allowed', () => {
    const issues = engine.checkBounds([
      { name: 'footer', x: 0.6, y: 5.0, w: 8.8, h: 0.5, skipBounds: true },
    ]);
    assert.equal(issues.length, 1, 'skipBounds flag must not bypass the check');
  });
});

describe('slides-engine / checkTextWrap', () => {
  it('flags text that needs more height than its box', () => {
    const issues = engine.checkTextWrap([
      { name: 'title', x: 0, y: 0, w: 5.5, h: 0.85,
        text: 'AI coding tools are broken at the multi-agent level.',
        fontSize: 38, bold: true },
    ]);
    assert.equal(issues.length, 1);
    assert.match(issues[0], /TEXT-WRAP/);
  });

  it('does NOT bypass check on shrinkText — that flag is ignored', () => {
    const issues = engine.checkTextWrap([
      { name: 'title', x: 0, y: 0, w: 5.5, h: 0.85,
        text: 'AI coding tools are broken at the multi-agent level.',
        fontSize: 38, bold: true, shrinkText: true },
    ]);
    assert.equal(issues.length, 1, 'shrinkText must NOT exempt an element from the wrap check');
  });

  it('passes when text fits', () => {
    const issues = engine.checkTextWrap([
      { name: 'label', x: 0, y: 0, w: 5.0, h: 0.3,
        text: 'WHY THIS MATTERS', fontSize: 11, bold: true },
    ]);
    assert.deepEqual(issues, []);
  });
});

describe('slides-engine / hardGate', () => {
  it('returns quietly on an empty / valid deck', () => {
    // Capture stdout
    const origLog = console.log;
    const logs = [];
    console.log = (msg) => logs.push(String(msg));
    try {
      engine.hardGate([
        ['slide-1', [{ name: 'title', x: 0.6, y: 0.65, w: 8.8, h: 1.0,
          text: 'Hello world', fontSize: 24, bold: true }]],
      ]);
    } finally {
      console.log = origLog;
    }
    assert.ok(logs.some((l) => /Layout gate passed/.test(l)));
  });

  it('calls process.exit(1) when any issue is found', () => {
    const origExit = process.exit;
    const origError = console.error;
    let exitCode = null;
    process.exit = (code) => { exitCode = code; throw new Error('__exit__'); };
    console.error = () => {};
    try {
      engine.hardGate([
        ['slide-1', [
          { name: 'a', x: 0, y: 0, w: 2, h: 1 },
          { name: 'b', x: 1, y: 0.5, w: 2, h: 1 },
        ]],
      ]);
      assert.fail('hardGate should have exited');
    } catch (e) {
      if (e.message !== '__exit__') throw e;
    } finally {
      process.exit = origExit;
      console.error = origError;
    }
    assert.equal(exitCode, 1);
  });
});

describe('slides-engine / tracker', () => {
  it('collects placed elements in order', () => {
    const { track, placed } = engine.tracker();
    track('a', { x: 0, y: 0, w: 1, h: 1 });
    track('b', { x: 2, y: 0, w: 1, h: 1 });
    assert.equal(placed.length, 2);
    assert.equal(placed[0].name, 'a');
    assert.equal(placed[1].name, 'b');
  });

  it('returns the opts object so it can be spread into addText', () => {
    const { track } = engine.tracker();
    const opts = track('a', { x: 0, y: 0, w: 1, h: 1, fontSize: 14 });
    assert.equal(opts.fontSize, 14);
  });

  it('rejects skipCollision / skipBounds / skipWrap flags with a clear error', () => {
    const { track } = engine.tracker();
    for (const flag of ['skipCollision', 'skipBounds', 'skipWrap']) {
      assert.throws(
        () => track('a', { x: 0, y: 0, w: 1, h: 1, [flag]: true }),
        new RegExp(`"${flag}" is not a supported option`),
        `${flag} must be rejected by tracker`,
      );
    }
  });

  it('rejects non-finite coordinates', () => {
    const { track } = engine.tracker();
    assert.throws(() => track('a', { x: NaN, y: 0, w: 1, h: 1 }));
    assert.throws(() => track('a', { x: 0, y: Infinity, w: 1, h: 1 }));
    assert.throws(() => track('a', { x: 0, y: 0, w: 'wide', h: 1 }));
  });
});
