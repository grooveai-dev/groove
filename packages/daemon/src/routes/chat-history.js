// FSL-1.1-Apache-2.0 — see LICENSE

export function registerChatHistoryRoutes(app, daemon) {
  // Full history for all agents — the GUI loads this on connect so chats are
  // present regardless of which origin/port the tunnel came up on.
  app.get('/api/chat-history', (req, res) => {
    res.json({ history: daemon.chatStore.getAll() });
  });

  // Append a single message for an agent.
  app.post('/api/chat-history/:agentId', (req, res) => {
    const { message } = req.body || {};
    if (!message || typeof message !== 'object') {
      return res.status(400).json({ error: 'message object required' });
    }
    daemon.chatStore.append(req.params.agentId, message);
    res.json({ ok: true });
  });

  // Replace an agent's whole history (batch sync).
  app.put('/api/chat-history/:agentId', (req, res) => {
    const { messages } = req.body || {};
    if (!Array.isArray(messages)) {
      return res.status(400).json({ error: 'messages array required' });
    }
    daemon.chatStore.replace(req.params.agentId, messages);
    res.json({ ok: true });
  });

  app.delete('/api/chat-history/:agentId', (req, res) => {
    daemon.chatStore.remove(req.params.agentId);
    res.json({ ok: true });
  });
}
