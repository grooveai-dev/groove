// FSL-1.1-Apache-2.0 — see LICENSE

export function loadJSON(key, fallback = {}) {
  try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); }
  catch { return fallback; }
}

export function persistJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota */ }
}

// Base64 image data must never reach localStorage — it blows the ~5MB quota,
// after which every write silently fails and history stops persisting. Keep the
// attachment metadata, drop the payload.
export function stripAttachments(history) {
  const out = {};
  for (const [id, msgs] of Object.entries(history || {})) {
    out[id] = (msgs || []).map((m) =>
      m.attachments?.length
        ? { ...m, attachments: m.attachments.map(({ dataUrl, ...rest }) => rest) }
        : m);
  }
  return out;
}

// Stable per-message id. Coalescing an agent's streamed reply keeps the id and
// grows the text, so the server can upsert one message instead of accumulating
// a fragment per chunk.
export function messageId() {
  return `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// The single writer for chat history.
//
// localStorage is a ~5MB CACHE, not the source of truth (the daemon is). Once
// the blob exceeds quota every write silently fails and the cache freezes,
// which is how history used to "stop persisting" with no error. So we keep
// only the newest buckets and trim until the write actually lands.
const LS_MAX_BUCKETS = 40;
const LS_MAX_PER_AGENT = 60;

export function persistChatHistory(history) {
  const clean = stripAttachments(history);
  try {
    if (Object.keys(clean).length === 0) {
      const existing = localStorage.getItem('groove:chatHistory');
      if (existing && existing !== '{}' && existing !== 'null') return;
    }
  } catch { /* ignore */ }

  // Newest-active buckets first, so trimming drops stale agents not live ones.
  const entries = Object.entries(clean)
    .filter(([, msgs]) => Array.isArray(msgs) && msgs.length)
    .map(([k, msgs]) => [k, msgs, msgs[msgs.length - 1]?.timestamp || 0])
    .sort((a, b) => b[2] - a[2]);

  for (const [buckets, perAgent] of [
    [entries.length, Infinity],
    [LS_MAX_BUCKETS, LS_MAX_PER_AGENT],
    [15, 30],
    [5, 15],
  ]) {
    const subset = {};
    for (const [k, msgs] of entries.slice(0, buckets)) {
      subset[k] = perAgent === Infinity ? msgs : msgs.slice(-perAgent);
    }
    try {
      localStorage.setItem('groove:chatHistory', JSON.stringify(subset));
      return;
    } catch { /* too big — fall through to a smaller subset */ }
  }
  // Every attempt failed; keep the last good value rather than clobbering it.
}
