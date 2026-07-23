// FSL-1.1-Apache-2.0 — see LICENSE

import { MAX_EXCHANGES } from '../innerchat.js';

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

// Resolve the from/to pair from a request body, or write the appropriate
// 400/404 and return null so the caller bails.
function resolveParties(daemon, req, res) {
  const { from, to, message } = req.body || {};

  const fromAgent = resolveAgent(daemon, from);
  if (!fromAgent) { res.status(404).json({ error: `Unknown calling agent: ${from}` }); return null; }

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
  return { fromAgent, toAgent, message: message.trim() };
}

export function registerInnerChatRoutes(app, daemon) {
  /**
   * Ask another agent a question and BLOCK until it answers.
   *
   * This request is held open deliberately — the calling agent is waiting on
   * it, and the response body is the other agent's reply. Best for tight
   * interface negotiation, where the finite exchange budget keeps both sides
   * writing decision-dense messages.
   */
  app.post('/api/innerchat/ask', async (req, res) => {
    try {
      const parties = resolveParties(daemon, req, res);
      if (!parties) return;

      // Held open until the target answers — see the class doc in innerchat.js.
      req.setTimeout(0);
      res.setTimeout(0);

      const result = await daemon.innerchat.ask(parties.fromAgent.id, parties.toAgent.id, parties.message, {
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
   * Send a message WITHOUT blocking — returns as soon as it's delivered. If the
   * target replies, the reply is routed back to the sender asynchronously
   * (resuming it if its turn ended). Best for handing off to a heads-down agent
   * where waiting out a timeout would waste the turn.
   */
  app.post('/api/innerchat/tell', async (req, res) => {
    try {
      const parties = resolveParties(daemon, req, res);
      if (!parties) return;

      const result = await daemon.innerchat.tell(parties.fromAgent.id, parties.toAgent.id, parties.message, {
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
