// FSL-1.1-Apache-2.0 — see LICENSE

import { MAX_EXCHANGES } from '../innerchat.js';

// Agents know each other by name, not id — resolve either, preferring an
// exact name match so `fullstack-1` never resolves to `fullstack-14`.
function resolveAgent(daemon, ref) {
  if (!ref || typeof ref !== 'string') return null;
  const all = daemon.registry.getAll();
  return all.find((a) => a.id === ref)
    || all.find((a) => a.name === ref)
    || all.find((a) => a.name.toLowerCase() === ref.toLowerCase())
    || null;
}

export function registerInnerChatRoutes(app, daemon) {
  /**
   * Ask another agent a question and BLOCK until it answers.
   *
   * This request is held open deliberately — the calling agent is waiting on
   * it, and the response body is the other agent's reply. That's what lets two
   * agents iterate without a human relaying between them.
   */
  app.post('/api/innerchat/ask', async (req, res) => {
    try {
      const { from, to, message, timeoutMs } = req.body || {};

      const fromAgent = resolveAgent(daemon, from);
      if (!fromAgent) return res.status(404).json({ error: `Unknown calling agent: ${from}` });

      const toAgent = resolveAgent(daemon, to);
      if (!toAgent) {
        const names = daemon.registry.getAll()
          .filter((a) => a.id !== fromAgent.id)
          .map((a) => a.name);
        return res.status(404).json({
          error: `No agent named "${to}".`,
          availableAgents: names,
        });
      }

      if (!message || typeof message !== 'string' || !message.trim()) {
        return res.status(400).json({ error: 'message is required' });
      }

      // Held open until the target answers — see the class doc in innerchat.js.
      req.setTimeout(0);
      res.setTimeout(0);

      const result = await daemon.innerchat.ask(fromAgent.id, toAgent.id, message.trim(), { timeoutMs });

      res.json({
        from: toAgent.name,
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
