// FSL-1.1-Apache-2.0 — see LICENSE

import { MAX_EXCHANGES } from '../innerchat.js';
import { readFileSync } from 'fs';
import { validatePeer, parsePeerRef } from '../innerchat-relay.js';
import { saveConfig } from '../firstrun.js';

const pkgVersion = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;

// Agents know each other by name, not id. Exact matches win first so
// `fullstack-1` never resolves to `fullstack-14`; only if nothing matches
// exactly do we accept a single unambiguous partial, since agents routinely
// half-remember a teammate's name. An ambiguous partial resolves to nothing
// and the caller gets the candidate list instead of a wrong recipient.
function resolveAgent(daemon, ref) {
  if (!ref || typeof ref !== 'string') return null;
  const all = daemon.registry.getAll();
  const needle = ref.trim().toLowerCase();

  const exact = all.find((a) => a.id === ref)
    || all.find((a) => a.name === ref)
    || all.find((a) => a.name.toLowerCase() === needle);
  if (exact) return exact;

  const partial = all.filter((a) => a.name.toLowerCase().includes(needle)
    || needle.includes(a.name.toLowerCase()));
  return partial.length === 1 ? partial[0] : null;
}

// The calling agent is always local. Writes a 404 and returns null on miss.
function resolveFrom(daemon, from, res) {
  const fromAgent = resolveAgent(daemon, from);
  if (!fromAgent) { res.status(404).json({ error: `Unknown calling agent: ${from}` }); return null; }
  return fromAgent;
}

// Resolve a LOCAL to/message pair, or write the appropriate 400/404 and return
// null. Used only when `to` is a plain (non-peer) name.
function resolveLocalTo(daemon, fromAgent, to, message, res) {
  const toAgent = resolveAgent(daemon, to);
  if (!toAgent) {
    const others = daemon.registry.getAll().filter((a) => a.id !== fromAgent.id);
    const needle = String(to || '').trim().toLowerCase();
    const close = others.filter((a) => a.name.toLowerCase().includes(needle)).map((a) => a.name);
    if (close.length > 1) {
      res.status(404).json({ error: `"${to}" matches more than one agent — use the full name.`, didYouMean: close });
    } else {
      res.status(404).json({ error: `No agent named "${to}".`, availableAgents: others.map((a) => a.name) });
    }
    return null;
  }
  if (!message || typeof message !== 'string' || !message.trim()) {
    res.status(400).json({ error: 'message is required' }); return null;
  }
  return { toAgent, message: message.trim() };
}

// Confirm a relay request is from a configured, signature-verified peer.
// Returns the peer record, or writes a 403 and returns null.
function verifyRelayCaller(daemon, body, res) {
  const { payload, signature } = body || {};
  if (!payload || typeof payload !== 'object' || !signature) {
    res.status(400).json({ error: 'signed relay envelope required ({ payload, signature })' });
    return null;
  }
  const fromDaemonId = payload.fromDaemonId;
  const peer = daemon.innerchat._peerByDaemonId(fromDaemonId);
  if (!peer) {
    res.status(403).json({ error: `Unknown daemon "${String(fromDaemonId).slice(0, 16)}" — not a configured InnerChat peer.` });
    return null;
  }
  if (!daemon.federation.verify(fromDaemonId, payload, signature)) {
    res.status(403).json({ error: 'Signature verification failed.' });
    return null;
  }
  return peer;
}

// A peer relay is accepted only when the sender is BOTH a configured peer
// (in innerchatPeers — the human's decision) AND signature-verifies against a
// stored federation public key. Those are independent gates, which is what
// makes automatic key exchange safe: holding someone's public key grants
// nothing on its own. So adding a peer can fetch and store its key without a
// separate manual pairing step.
async function exchangeKeys(daemon, url, alias) {
  const base = url.replace(/\/+$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${base}/api/innerchat/identity`, { signal: controller.signal });
    if (!res.ok) throw new Error(`peer returned HTTP ${res.status}`);
    const id = await res.json();
    if (!id?.daemonId || !id?.publicKey) throw new Error('peer did not return an identity');

    // Store their key so we can verify what they send us.
    daemon.federation._savePeer({
      id: id.daemonId,
      name: alias,
      host: new URL(base).hostname,
      port: Number(new URL(base).port) || 80,
      publicKey: id.publicKey,
      pairedAt: new Date().toISOString(),
    });

    // Push ours so they can verify what WE send — this is the half that
    // otherwise required a manual step on the other machine.
    let pushed = false;
    try {
      const push = await fetch(`${base}/api/innerchat/identity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          daemonId: daemon.federation.getDaemonId(),
          publicKey: daemon.federation.getPublicKeyPem(),
          name: daemon.config?.daemonName || 'groove',
        }),
        signal: controller.signal,
      });
      pushed = push.ok;
    } catch { /* reachable for GET but not POST — report partial */ }

    return { ok: true, peerDaemonId: id.daemonId, peerVersion: id.version, pushed };
  } finally {
    clearTimeout(timer);
  }
}

export function registerInnerChatRoutes(app, daemon) {
  /**
   * This daemon's federation identity. Read-only and non-secret (a public key
   * plus an id); the peer needs it to verify signed relays from us.
   */
  app.get('/api/innerchat/identity', (req, res) => {
    res.json({
      daemonId: daemon.federation.getDaemonId(),
      publicKey: daemon.federation.getPublicKeyPem(),
      version: pkgVersion,
      port: daemon.port,
      agents: daemon.registry.getAll().map((a) => a.name),
    });
  });

  /**
   * Accept a peer's public key so we can verify its signed relays. Storing a
   * key authorizes nothing by itself — a relay ALSO requires that daemon to be
   * listed in innerchatPeers, which only the user can do. That second gate is
   * what keeps this endpoint safe to accept without a pairing dance.
   */
  app.post('/api/innerchat/identity', (req, res) => {
    const { daemonId, publicKey, name } = req.body || {};
    if (!daemonId || !/^[a-f0-9]{6,64}$/.test(String(daemonId))) {
      return res.status(400).json({ error: 'valid daemonId required' });
    }
    if (!publicKey || typeof publicKey !== 'string' || !publicKey.includes('PUBLIC KEY')) {
      return res.status(400).json({ error: 'publicKey (PEM) required' });
    }
    daemon.federation._savePeer({
      id: daemonId,
      name: typeof name === 'string' && name.trim() ? name.trim().slice(0, 40) : daemonId,
      host: (req.ip || '').replace('::ffff:', '') || '127.0.0.1',
      port: 0,
      publicKey,
      pairedAt: new Date().toISOString(),
    });
    daemon.audit.log('innerchat.key.received', { daemonId });
    res.json({
      ok: true,
      // Hand back ours so a single call completes the exchange either way.
      daemonId: daemon.federation.getDaemonId(),
      publicKey: daemon.federation.getPublicKeyPem(),
    });
  });

  /**
   * Ask another agent a question and BLOCK until it answers.
   *
   * `to` may be a local name or `name@peer`. A peer target is relayed to the
   * configured peer daemon; the reply rides the still-open response back.
   */
  app.post('/api/innerchat/ask', async (req, res) => {
    try {
      const { from, to, message } = req.body || {};
      const fromAgent = resolveFrom(daemon, from, res);
      if (!fromAgent) return;

      // Held open until the target answers — see the class doc in innerchat.js.
      req.setTimeout(0);
      res.setTimeout(0);

      if (daemon.innerchat.isRemoteRef(to)) {
        const { name, alias } = parsePeerRef(to);
        if (!message || !String(message).trim()) return res.status(400).json({ error: 'message is required' });
        const result = await daemon.innerchat.askRemote(fromAgent, name, alias, String(message).trim(), {
          timeoutMs: req.body?.timeoutMs,
        });
        return res.json({ from: `${name}@${alias}`, reply: result.reply, threadId: result.threadId, remote: true });
      }

      const parties = resolveLocalTo(daemon, fromAgent, to, message, res);
      if (!parties) return;

      const result = await daemon.innerchat.ask(fromAgent.id, parties.toAgent.id, parties.message, {
        timeoutMs: req.body?.timeoutMs,
      });

      res.json({
        from: parties.toAgent.name,
        reply: result.reply,
        threadId: result.threadId,
        exchangesUsed: result.exchanges,
        exchangesRemaining: result.remaining,
        maxExchanges: MAX_EXCHANGES,
      });
    } catch (err) {
      // The agent reads this body — keep it actionable, it's the whole signal.
      res.status(409).json({ error: err.message });
    }
  });

  /**
   * Send a message WITHOUT blocking. `to` may be local or `name@peer`. For a
   * peer target the reply (if any) is queued on the peer and picked up by this
   * daemon's outbox poll, then routed back to the sender.
   */
  app.post('/api/innerchat/tell', async (req, res) => {
    try {
      const { from, to, message } = req.body || {};
      const fromAgent = resolveFrom(daemon, from, res);
      if (!fromAgent) return;

      if (daemon.innerchat.isRemoteRef(to)) {
        const { name, alias } = parsePeerRef(to);
        if (!message || !String(message).trim()) return res.status(400).json({ error: 'message is required' });
        const result = await daemon.innerchat.tellRemote(fromAgent, name, alias, String(message).trim());
        return res.json({
          ok: true,
          to: `${name}@${alias}`,
          delivered: result.delivered,
          threadId: result.threadId,
          remote: true,
          note: `Message relayed to ${name}@${alias}. Its reply, if any, will be routed back to you — you can end your turn.`,
        });
      }

      const parties = resolveLocalTo(daemon, fromAgent, to, message, res);
      if (!parties) return;

      const result = await daemon.innerchat.tell(fromAgent.id, parties.toAgent.id, parties.message, {
        threadId: req.body?.threadId,
      });

      res.json({
        ok: true,
        to: parties.toAgent.name,
        delivered: result.delivered,
        threadId: result.threadId,
        exchangesUsed: result.exchanges,
        exchangesRemaining: result.remaining,
        maxExchanges: MAX_EXCHANGES,
        note: `Message delivered. ${parties.toAgent.name}'s reply, if any, will be routed back to you — you can end your turn.`,
      });
    } catch (err) {
      res.status(409).json({ error: err.message });
    }
  });

  // ── Cross-daemon relay endpoints (peer daemon → this daemon) ──

  /**
   * Receive a relayed ask/tell from a peer daemon. Signature-verified and
   * restricted to configured peers. Resolves the target locally and delivers
   * with a guest identity. For 'ask' the response is held open until the local
   * agent answers.
   */
  app.post('/api/innerchat/relay', async (req, res) => {
    const peer = verifyRelayCaller(daemon, req.body, res);
    if (!peer) return;
    const p = req.body.payload;
    if (p.type !== 'innerchat.relay' || (p.kind !== 'ask' && p.kind !== 'tell')) {
      return res.status(400).json({ error: 'invalid relay payload' });
    }
    try {
      req.setTimeout(0);
      res.setTimeout(0);
      const result = await daemon.innerchat.receiveRelay({
        fromName: p.fromName,
        fromRole: p.fromRole,
        fromDaemonId: p.fromDaemonId,
        peerAlias: peer.alias,
        toName: p.toName,
        message: p.message,
        kind: p.kind,
        threadId: p.threadId,
        timeoutMs: p.timeoutMs,
      });
      res.json(result);
    } catch (err) {
      const body = { error: err.message };
      if (err.availableAgents) body.availableAgents = err.availableAgents;
      res.status(404).json(body);
    }
  });

  /**
   * Drain this daemon's outbox of async (tell) replies queued for the calling
   * peer. Signature-verified; returns and removes only that peer's entries.
   */
  app.post('/api/innerchat/relay/outbox', (req, res) => {
    const peer = verifyRelayCaller(daemon, req.body, res);
    if (!peer) return;
    if (req.body.payload.type !== 'innerchat.outbox') {
      return res.status(400).json({ error: 'invalid outbox payload' });
    }
    res.json({ entries: daemon.innerchat.drainOutbox(req.body.payload.fromDaemonId) });
  });

  // ── Peer configuration (alias ↔ url ↔ daemonId) ──────────────

  app.get('/api/innerchat/peers', (req, res) => {
    res.json({ peers: daemon.innerchat._peers() });
  });

  /**
   * Add a peer. The daemonId is discovered from the peer itself rather than
   * typed, and public keys are exchanged automatically, so the user only has
   * to supply a name and a reachable URL.
   */
  app.post('/api/innerchat/peers', async (req, res) => {
    const alias = req.body?.alias;
    const rawUrl = req.body?.url;
    if (!alias || typeof alias !== 'string' || !/^[a-zA-Z0-9_-]{1,40}$/.test(alias)) {
      return res.status(400).json({ error: 'peer name must be 1-40 chars (letters, digits, dash, underscore)' });
    }
    if (!rawUrl || typeof rawUrl !== 'string') return res.status(400).json({ error: 'peer url is required' });

    let url;
    try {
      const parsed = new URL(rawUrl.trim());
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return res.status(400).json({ error: 'peer url must be http(s)' });
      }
      if (parsed.username || parsed.password) return res.status(400).json({ error: 'credentials in the url are not allowed' });
      url = rawUrl.trim().replace(/\/+$/, '');
    } catch { return res.status(400).json({ error: `invalid url: ${rawUrl}` }); }

    // Reach the peer, learn its id, and trade keys. This is the step that used
    // to be a manual federation pairing.
    let exchange;
    try {
      exchange = await exchangeKeys(daemon, url, alias);
    } catch (err) {
      return res.status(502).json({
        error: `Could not reach a Groove daemon at ${url} — ${err.message}. `
          + 'Check the URL (for a tunnelled peer this is the forwarded local port, not 31415) and that the peer daemon is running the current version.',
      });
    }

    if (exchange.peerDaemonId === daemon.federation.getDaemonId()) {
      return res.status(400).json({
        error: `That URL points at THIS daemon, not a peer. For a tunnelled machine use the forwarded local port (e.g. http://127.0.0.1:31416), not ${url}.`,
      });
    }

    const entry = { alias, url, daemonId: exchange.peerDaemonId };
    const check = validatePeer(entry);
    if (check) return res.status(400).json({ error: check });

    const peers = Array.isArray(daemon.config.innerchatPeers) ? daemon.config.innerchatPeers : [];
    const next = peers.filter((p) => p.alias !== alias);
    next.push(entry);
    daemon.config.innerchatPeers = next;
    saveConfig(daemon.grooveDir, daemon.config);
    daemon.audit.log('innerchat.peer.set', { alias, url, daemonId: entry.daemonId });
    // Registry files carry the @peer instructions + alias list — refresh now so
    // running agents see the new peer without waiting for a spawn or restart.
    try { daemon.introducer?.writeRegistryFile?.(daemon.projectDir); } catch { /* best effort */ }

    res.json({
      peers: next,
      exchanged: true,
      keyPushed: exchange.pushed,
      peerDaemonId: exchange.peerDaemonId,
      note: exchange.pushed
        ? `Keys exchanged with ${alias}. Add this machine as a peer there too if you want its agents to start conversations.`
        : `Stored ${alias}'s key, but could not send ours — ${alias} may be running an older version. Update it, then re-add.`,
    });
  });

  /**
   * Verify a configured peer end to end: reachable, identity matches what we
   * stored, and keys are present on both sides.
   */
  app.get('/api/innerchat/peers/:alias/test', async (req, res) => {
    const peer = daemon.innerchat._peerByAlias(req.params.alias);
    if (!peer) return res.status(404).json({ error: `No peer named "${req.params.alias}"` });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const r = await fetch(`${peer.url}/api/innerchat/identity`, { signal: controller.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const id = await r.json();
      const idMatches = id.daemonId === peer.daemonId;
      const weHaveTheirKey = daemon.federation.peers.has(peer.daemonId);
      res.json({
        ok: idMatches && weHaveTheirKey,
        reachable: true,
        idMatches,
        weHaveTheirKey,
        peerDaemonId: id.daemonId,
        peerVersion: id.version,
        agents: Array.isArray(id.agents) ? id.agents : [],
        error: !idMatches
          ? `The daemon at ${peer.url} reports id ${id.daemonId}, but this peer is configured as ${peer.daemonId}. Re-add the peer.`
          : !weHaveTheirKey ? 'Missing this peer\'s public key — re-add the peer to exchange keys.' : null,
      });
    } catch (err) {
      res.json({ ok: false, reachable: false, error: `Could not reach ${peer.url} — ${err.message}` });
    } finally {
      clearTimeout(timer);
    }
  });

  app.delete('/api/innerchat/peers/:alias', (req, res) => {
    const peers = Array.isArray(daemon.config.innerchatPeers) ? daemon.config.innerchatPeers : [];
    const next = peers.filter((p) => p.alias !== req.params.alias);
    daemon.config.innerchatPeers = next;
    saveConfig(daemon.grooveDir, daemon.config);
    daemon.audit.log('innerchat.peer.remove', { alias: req.params.alias });
    res.json({ peers: next });
  });

  app.get('/api/innerchat/threads', (req, res) => {
    const { agentId } = req.query;
    res.json({ threads: daemon.innerchat.getThreads(agentId || null) });
  });

  app.get('/api/innerchat/threads/:id', (req, res) => {
    const thread = daemon.innerchat.getThread(req.params.id);
    if (!thread) return res.status(404).json({ error: 'Thread not found' });
    res.json(thread);
  });

  app.get('/api/innerchat/pending/:agentId', (req, res) => {
    const pending = daemon.innerchat.getPending(req.params.agentId);
    res.json({ pending: pending || null });
  });
}
