// FSL-1.1-Apache-2.0 — see LICENSE
//
// Cross-daemon InnerChat relay transport (spec: plans/cross-daemon-innerchat-spec.md).
//
// An agent addresses a peer's agent as `name@alias`. A plain `name` stays purely
// local (zero behavior change); `name@alias` routes to the daemon configured
// under that alias. Transport is whatever the user can already reach — a
// tunnel-forwarded localhost port today, a Tailscale address tomorrow — so this
// module never assumes the topology: a peer is just a URL. The daemon stays
// bound to loopback; no new listener is opened.

const RELAY_FETCH_TIMEOUT_MS = 30000; // ask holds the peer's request open

// Peer config entry: { alias, url, daemonId }. Reuses the Axom connector's
// endpoint rules for the URL (http(s), no embedded credentials) and pins the
// peer's federation daemon id so replies/signatures resolve to one identity.
export function validatePeer(entry) {
  if (!entry || typeof entry !== 'object') return 'peer must be an object';
  const { alias, url, daemonId } = entry;
  if (!alias || typeof alias !== 'string' || !/^[a-zA-Z0-9_-]{1,40}$/.test(alias)) {
    return 'peer alias must be 1-40 chars (letters, digits, dash, underscore)';
  }
  if (!url || typeof url !== 'string') return 'peer url is required';
  let parsed;
  try { parsed = new URL(url); } catch { return `invalid url: ${url}`; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return 'peer url must be http(s)';
  }
  if (parsed.username || parsed.password) return 'credentials in the url are not allowed';
  if (!daemonId || typeof daemonId !== 'string' || !/^[a-f0-9]{6,64}$/.test(daemonId)) {
    return 'peer daemonId must be lowercase hex (the peer daemon\'s federation id)';
  }
  return null;
}

// Split an InnerChat address. `name` → local (peer null). `name@alias` → remote.
// Agent names never contain '@', so it reliably marks a peer reference. Returns
// null on a malformed reference (empty name or empty/multi alias).
export function parsePeerRef(ref) {
  if (!ref || typeof ref !== 'string' || !ref.includes('@')) return { name: ref, alias: null };
  const parts = ref.split('@');
  if (parts.length !== 2) return null; // transitive/garbled — one hop only
  const [name, alias] = parts.map((s) => s.trim());
  if (!name || !alias) return null;
  return { name, alias };
}

// Thin HTTP client for the relay. Kept injectable so tests can drive the relay
// logic without binding two real servers.
export class RelayClient {
  constructor({ fetchImpl = fetch, timeoutMs = RELAY_FETCH_TIMEOUT_MS } = {}) {
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async _post(url, body, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs || this.timeoutMs);
    try {
      const res = await this.fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const json = await res.json().catch(() => ({}));
      return { ok: res.ok, status: res.status, json };
    } finally {
      clearTimeout(timer);
    }
  }

  // POST a signed relay envelope to a peer. `{ payload, signature }`.
  sendRelay(peerUrl, envelope, timeoutMs) {
    return this._post(`${trimUrl(peerUrl)}/api/innerchat/relay`, envelope, timeoutMs);
  }

  // Drain replies queued on a peer for us (async `tell` answers). Signed so the
  // peer can confirm which daemon is asking and hand back only its entries.
  fetchOutbox(peerUrl, envelope, timeoutMs) {
    return this._post(`${trimUrl(peerUrl)}/api/innerchat/relay/outbox`, envelope, timeoutMs);
  }
}

function trimUrl(url) {
  return url.replace(/\/+$/, '');
}

export { RELAY_FETCH_TIMEOUT_MS };
