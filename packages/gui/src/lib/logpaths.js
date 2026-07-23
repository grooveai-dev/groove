// FSL-1.1-Apache-2.0 — see LICENSE

// Pull tailable log targets out of an agent's message so the chat can offer a
// one-click "tail" instead of the user asking "what's the log file?".
//
// Two signals, in priority order:
//   1. An explicit `tail -f <path>` the agent already wrote — highest confidence.
//   2. Any path-like token ending in .log.
// Both are conservative: a bare word like "changelog" is not a path and won't
// match, and results are de-duped by full path.

const TAIL_RE = /tail\s+(?:-[a-zA-Z]+\s+)*([~/]?[\w./-]+)/g;
const DOTLOG_RE = /(?:^|[\s'"`(=])((?:~\/|\/)?(?:[\w.-]+\/)*[\w.-]+\.log)\b/g;

function clean(p) {
  return p.replace(/^['"`]+/, '').replace(/['"`.,;:)]+$/, '');
}

export function extractLogPaths(text) {
  if (!text || typeof text !== 'string') return [];
  const out = [];
  const seen = new Set();

  const add = (raw) => {
    const p = clean(raw);
    // Require something path-shaped: a slash, a ~, or a .log extension. Guards
    // against picking up plain words that followed "tail".
    if (!p || p.length < 3) return;
    if (!p.endsWith('.log') && !p.includes('/') && !p.startsWith('~')) return;
    if (seen.has(p)) return;
    seen.add(p);
    out.push(p);
  };

  for (const m of text.matchAll(TAIL_RE)) add(m[1]);
  for (const m of text.matchAll(DOTLOG_RE)) add(m[1]);

  return out;
}

// A short label for the chip — the basename, which is what the user recognizes.
export function logLabel(path) {
  const base = path.replace(/\/+$/, '').split('/').pop() || path;
  return base.length > 28 ? `…${base.slice(-27)}` : base;
}
