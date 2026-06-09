// FSL-1.1-Apache-2.0 — see LICENSE

export function registerInnerChatRoutes(app, daemon) {
  app.post('/api/innerchat/send', async (req, res) => {
    try {
      const { from, to, message } = req.body;
      if (!from || typeof from !== 'string') return res.status(400).json({ error: 'from (agent ID) is required' });
      if (!to || typeof to !== 'string') return res.status(400).json({ error: 'to (agent ID) is required' });
      if (!message || typeof message !== 'string' || !message.trim()) return res.status(400).json({ error: 'message is required' });
      if (from === to) return res.status(400).json({ error: 'cannot send a message to yourself' });

      const msg = await daemon.innerchat.send(from, to, message.trim());
      res.json(msg);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/api/innerchat/messages', (req, res) => {
    const { agentId } = req.query;
    res.json({ messages: daemon.innerchat.getMessages(agentId || null) });
  });

  app.get('/api/innerchat/messages/:id', (req, res) => {
    const msg = daemon.innerchat.getMessage(req.params.id);
    if (!msg) return res.status(404).json({ error: 'Message not found' });
    res.json(msg);
  });

  app.get('/api/innerchat/pending/:agentId', (req, res) => {
    const pending = daemon.innerchat.getPending(req.params.agentId);
    res.json({ pending: pending || null });
  });
}
