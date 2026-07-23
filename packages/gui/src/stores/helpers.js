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

// The single writer for chat history. Strips attachments and refuses to
// overwrite a populated store with an empty object — a blank write is almost
// always a startup race or partial state, and losing chat is never acceptable.
export function persistChatHistory(history) {
  const clean = stripAttachments(history);
  try {
    if (Object.keys(clean).length === 0) {
      const existing = localStorage.getItem('groove:chatHistory');
      if (existing && existing !== '{}' && existing !== 'null') return;
    }
    localStorage.setItem('groove:chatHistory', JSON.stringify(clean));
  } catch { /* quota — keep the last good value rather than clobbering it */ }
}
