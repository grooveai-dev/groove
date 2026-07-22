// FSL-1.1-Apache-2.0 — see LICENSE

export function registerInnerChatRoutes(app, daemon) {
  // Relay a message from one agent to another. Opens a thread, or continues
  // an existing one when threadId is supplied.
  app.post('/api/innerchat/send', async (req, res) => {
    try {
      const { from, to, message, threadId } = req.body;
      if (!from || typeof from !== 'string') return res.status(400).json({ error: 'from (agent ID) is required' });
      if (!to || typeof to !== 'string') return res.status(400).json({ error: 'to (agent ID) is required' });
      if (!message || typeof message !== 'string' || !message.trim()) return res.status(400).json({ error: 'message is required' });
      if (from === to) return res.status(400).json({ error: 'cannot send a message to yourself' });
      if (threadId && typeof threadId !== 'string') return res.status(400).json({ error: 'threadId must be a string' });

      const result = await daemon.innerchat.send(from, to, message.trim(), threadId || null);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
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
