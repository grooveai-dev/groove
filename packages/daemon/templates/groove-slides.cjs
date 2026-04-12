// GROOVE — Slide Deck Layout Engine
// FSL-1.1-Apache-2.0 — see LICENSE
//
// This file is written into every `slides` role agent's working directory at spawn time.
// Do not modify it — Groove overwrites it on every spawn. Theme / style / visual
// components come from a marketplace skill. Layout, measurement, and validation are
// core and baked in here so decks never ship broken regardless of which skill (if any)
// is attached.
//
// Usage in convert-slides.js:
//
//   const pptxgen = require('pptxgenjs');
//   const {
//     LAYOUT, estimateTextHeight, fitFontSize,
//     checkCollisions, checkBounds, checkTextWrap, hardGate, tracker,
//   } = require('./groove-slides.js');
//
//   const pres = new pptxgen();
//   pres.layout = 'LAYOUT_16x9';
//
//   function renderMetricsSlide(data) {
//     const slide = pres.addSlide();
//     const { track, placed } = tracker();
//
//     let Y = LAYOUT.CONTENT_START;
//
//     // Title — box height budgeted first, then font size fit to it
//     const titleBoxH = 1.1;
//     const titleSize = fitFontSize(data.title, 42, 24, LAYOUT.SAFE_W, titleBoxH, { bold: true });
//     slide.addText(data.title, track('title', {
//       x: LAYOUT.SAFE_X, y: Y, w: LAYOUT.SAFE_W, h: titleBoxH,
//       text: data.title, fontSize: titleSize, bold: true,
//     }));
//     Y += titleBoxH + LAYOUT.GAP_STD;
//     // ... more placements ...
//     return { name: 'metrics', elements: placed };
//   }
//
//   const allSlides = [renderMetricsSlide(data.slides[0]), ...];
//   hardGate(allSlides.map((s) => [s.name, s.elements])); // exits 1 on any issue
//   await pres.writeFile({ fileName: 'deck.pptx' });
//
// Rules (enforced by hardGate — no bypasses):
//   1. Every text and shape you place MUST be pushed to `placed[]` via `track()`.
//   2. NEVER add `skipCollision`, `skipBounds`, `skipWrap`, or any other bypass flag.
//      If a legitimate design element overflows the safe area (e.g., an orb bleeding
//      off-slide), use addImage() WITHOUT tracking it. The gate only validates what
//      you declare placed.
//   3. DO NOT use `shrinkText: true`. PowerPoint honors it; Google Slides and
//      LibreOffice PDF export largely do not — text renders at its declared size
//      and overflows. Always use `fitFontSize()` to compute a real font size that
//      fits the box.
//   4. Y advances MUST come from `estimateTextHeight()` or an explicit box budget,
//      never a hardcoded magic number like `Y += 0.95`.
//   5. Every call to `hardGate()` is a build gate. Do not wrap it in try/catch.
//      A failing gate is a build failure — fix the slide generator, don't silence
//      the check.

// ─── Layout constants ───────────────────────────────────────────────────────

const LAYOUT = Object.freeze({
  // 16:9 canvas
  SLIDE_W: 10,
  SLIDE_H: 5.625,

  // Safe margins
  SAFE_X: 0.6,
  SAFE_R: 9.4,
  SAFE_W: 8.8,
  SAFE_TOP: 0.25,         // top of brand zone
  SAFE_BOT: 5.125,        // below this = clipped
  CONTENT_START: 0.65,    // below branding — first Y for content
  CONTENT_H: 4.475,       // SAFE_BOT - CONTENT_START

  // Branding reserved zone (do not place content here)
  BRAND_Y: 0.25,
  BRAND_H: 0.3,

  // Gaps between elements
  GAP_TIGHT: 0.1,
  GAP_STD: 0.25,
  GAP_SECTION: 0.4,
  GAP_DRAMATIC: 0.8,

  // Inset for text beside an accent border / inside a column
  TEXT_INSET: 0.2,
});

// ─── Measurement ────────────────────────────────────────────────────────────

/**
 * Estimate the rendered height of a text box in inches.
 * Handles word-wrap, explicit newlines, and bold/serif width adjustments.
 *
 * @param {string}  text
 * @param {number}  fontSize   points
 * @param {number}  boxWidth   inches
 * @param {object}  [opts]
 * @param {boolean} [opts.bold=false]
 * @param {number}  [opts.margin=0.1]  side margin pptxgenjs applies inside a text box
 * @returns {number} height in inches
 */
function estimateTextHeight(text, fontSize, boxWidth, opts = {}) {
  if (typeof text !== 'string' || text.length === 0) return fontSize / 72;

  const bold = opts.bold === true;
  const margin = typeof opts.margin === 'number' ? opts.margin : 0.1;

  // Average glyph width as a fraction of font size (pt → in)
  // Bold text is ~8% wider in typical sans-serif.
  const charWidthFactor = bold ? 0.0075 : 0.0070;
  const avgCharWidth = fontSize * charWidthFactor;

  const effectiveWidth = Math.max(boxWidth - margin * 2, 0.1);
  const charsPerLine = Math.max(1, Math.floor(effectiveWidth / avgCharWidth));

  // Count wrapped lines — words don't break mid-word.
  // Also respect explicit newlines.
  const paragraphs = text.split('\n');
  let lines = 0;
  for (const p of paragraphs) {
    if (p.length === 0) { lines += 1; continue; }
    const words = p.split(/\s+/).filter(Boolean);
    if (words.length === 0) { lines += 1; continue; }
    let lineLen = 0;
    let paraLines = 1;
    for (const w of words) {
      const addLen = (lineLen > 0 ? 1 : 0) + w.length;
      if (lineLen + addLen > charsPerLine && lineLen > 0) {
        paraLines += 1;
        lineLen = w.length;
      } else {
        lineLen += addLen;
      }
    }
    lines += paraLines;
  }

  // line-height ≈ 1.3 × fontSize
  const lineHeight = (fontSize * 1.3) / 72;
  return Math.max(lines * lineHeight, fontSize / 72);
}

/**
 * Find the largest font size in [minSize, maxSize] (integer points) that fits
 * `text` in a box of `boxW` × `boxH` inches. Returns `minSize` if even that
 * doesn't fit — caller should allocate more space or shorten the text.
 *
 * Use this instead of pptxgenjs `shrinkText: true`, which is inconsistently
 * respected by Google Slides / LibreOffice PDF export.
 */
function fitFontSize(text, maxSize, minSize, boxW, boxH, opts = {}) {
  if (maxSize < minSize) return minSize;
  for (let size = Math.floor(maxSize); size >= Math.floor(minSize); size -= 1) {
    const needed = estimateTextHeight(text, size, boxW, opts);
    if (needed <= boxH) return size;
  }
  return Math.floor(minSize);
}

// ─── Validation gates ──────────────────────────────────────────────────────

function _fmt(n) { return Number(n).toFixed(2); }

function checkCollisions(elements) {
  const issues = [];
  for (let i = 0; i < elements.length; i += 1) {
    for (let j = i + 1; j < elements.length; j += 1) {
      const a = elements[i];
      const b = elements[j];
      const overlapX = a.x < b.x + b.w && a.x + a.w > b.x;
      const overlapY = a.y < b.y + b.h && a.y + a.h > b.y;
      if (overlapX && overlapY) {
        issues.push(
          `OVERLAP: "${a.name}" (${_fmt(a.x)},${_fmt(a.y)}→${_fmt(a.x + a.w)},${_fmt(a.y + a.h)}) ` +
          `↔ "${b.name}" (${_fmt(b.x)},${_fmt(b.y)}→${_fmt(b.x + b.w)},${_fmt(b.y + b.h)})`,
        );
      }
    }
  }
  return issues;
}

function checkBounds(elements, opts = {}) {
  const safeTop = typeof opts.safeTop === 'number' ? opts.safeTop : LAYOUT.SAFE_TOP;
  const safeBot = typeof opts.safeBot === 'number' ? opts.safeBot : LAYOUT.SAFE_BOT;
  const safeL = typeof opts.safeL === 'number' ? opts.safeL : 0;
  const safeR = typeof opts.safeR === 'number' ? opts.safeR : LAYOUT.SLIDE_W;
  const issues = [];
  for (const el of elements) {
    if (el.y < safeTop) {
      issues.push(`TOP-OVERFLOW: "${el.name}" starts y=${_fmt(el.y)} (safe top ${_fmt(safeTop)})`);
    }
    if (el.y + el.h > safeBot) {
      issues.push(`BOTTOM-OVERFLOW: "${el.name}" ends y=${_fmt(el.y + el.h)} (safe bottom ${_fmt(safeBot)}) — CLIPPED`);
    }
    if (el.x < safeL) {
      issues.push(`LEFT-OVERFLOW: "${el.name}" starts x=${_fmt(el.x)} (safe left ${_fmt(safeL)})`);
    }
    if (el.x + el.w > safeR) {
      issues.push(`RIGHT-OVERFLOW: "${el.name}" ends x=${_fmt(el.x + el.w)} (safe right ${_fmt(safeR)})`);
    }
  }
  return issues;
}

function checkTextWrap(elements, opts = {}) {
  const slack = typeof opts.slack === 'number' ? opts.slack : 1.05;
  const issues = [];
  for (const el of elements) {
    if (typeof el.text !== 'string' || typeof el.fontSize !== 'number') continue;
    const needed = estimateTextHeight(el.text, el.fontSize, el.w, {
      bold: el.bold === true,
      margin: typeof el.margin === 'number' ? el.margin : 0.1,
    });
    if (needed > el.h * slack) {
      issues.push(
        `TEXT-WRAP: "${el.name}" needs ~${_fmt(needed)}" at ${el.fontSize}pt but got ${_fmt(el.h)}" — ` +
        `use fitFontSize() to shrink, or increase box height.`,
      );
    }
  }
  return issues;
}

/**
 * Run every gate over every slide's placed elements. Exits the process with
 * code 1 on any issue — this is intentional. Do not wrap in try/catch.
 *
 * @param {Array<[string, Array<object>]>} allSlideElements
 *   Pairs of [slideName, placedElements[]]. Each element must carry at least
 *   { name, x, y, w, h }. Text elements must also carry { text, fontSize }
 *   to participate in the wrap check.
 */
function hardGate(allSlideElements, opts = {}) {
  const issues = [];
  for (const [slideName, elements] of allSlideElements) {
    const slideIssues = [
      ...checkCollisions(elements),
      ...checkBounds(elements, opts),
      ...checkTextWrap(elements, opts),
    ];
    for (const msg of slideIssues) issues.push(`[${slideName}] ${msg}`);
  }
  if (issues.length === 0) {
    console.log(`✓ Layout gate passed — ${allSlideElements.length} slide(s), zero issues.`);
    return;
  }
  console.error(`\n✗ Layout gate FAILED — ${issues.length} issue(s):\n`);
  for (const msg of issues) console.error('  ' + msg);
  console.error('\nFix the slide generator(s) above. Do not add skip flags — the gate has no bypasses.');
  console.error('For text overflow: use fitFontSize() to compute a real font size, or allocate more box height.');
  process.exit(1);
}

// ─── Tracker helper ────────────────────────────────────────────────────────

/**
 * Convenience factory for tracking placed elements.
 *
 *   const { track, placed } = tracker();
 *   slide.addText(data.title, track('title', { x, y, w, h, text, fontSize, bold }));
 *   return { name: 'my-slide', elements: placed };
 *
 * `track()` returns the same options object so you can inline it into
 * `slide.addText()` / `slide.addShape()` calls.
 */
function tracker() {
  const placed = [];
  function track(name, opts) {
    if (typeof name !== 'string' || !name) {
      throw new Error('tracker.track(name, opts): name must be a non-empty string');
    }
    if (!opts || typeof opts !== 'object') {
      throw new Error(`tracker.track("${name}", opts): opts is required`);
    }
    for (const key of ['x', 'y', 'w', 'h']) {
      if (typeof opts[key] !== 'number' || !Number.isFinite(opts[key])) {
        throw new Error(`tracker.track("${name}"): opts.${key} must be a finite number`);
      }
    }
    // Reject bypass flags — the gate has no exemptions.
    for (const flag of ['skipCollision', 'skipBounds', 'skipWrap']) {
      if (opts[flag]) {
        throw new Error(
          `tracker.track("${name}"): "${flag}" is not a supported option. The layout gate has no bypasses. ` +
          `Fix the placement or don't track it.`,
        );
      }
    }
    placed.push({ name, ...opts });
    return opts;
  }
  return { track, placed };
}

module.exports = {
  LAYOUT,
  estimateTextHeight,
  fitFontSize,
  checkCollisions,
  checkBounds,
  checkTextWrap,
  hardGate,
  tracker,
};
