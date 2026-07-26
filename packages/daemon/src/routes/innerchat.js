// FSL-1.1-Apache-2.0 — see LICENSE

import { MAX_EXCHANGES } from '../innerchat.js';
import { validatePeer, parsePeerRef } from '../innerchat-relay.js';
import { saveConfig } from '../firstrun.js';

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

export function registerInnerChatRoutes(app, daemon) {
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

  app.post('/api/innerchat/peers', (req, res) => {
    const entry = { alias: req.body?.alias, url: req.body?.url, daemonId: req.body?.daemonId };
    const err = validatePeer(entry);
    if (err) return res.status(400).json({ error: err });
    entry.url = entry.url.replace(/\/+$/, '');

    const peers = Array.isArray(daemon.config.innerchatPeers) ? daemon.config.innerchatPeers : [];
    const next = peers.filter((p) => p.alias !== entry.alias);
    next.push(entry);
    daemon.config.innerchatPeers = next;
    saveConfig(daemon.grooveDir, daemon.config);
    daemon.audit.log('innerchat.peer.set', { alias: entry.alias, url: entry.url });
    res.json({ peers: next });
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
