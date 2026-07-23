// FSL-1.1-Apache-2.0 — see LICENSE

// Agents identify themselves by name; resolve to the live record.
function resolveAgent(daemon, ref) {
  if (!ref || typeof ref !== 'string') return null;
  const all = daemon.registry.getAll();
  return all.find((a) => a.id === ref)
    || all.find((a) => a.name === ref)
    || all.find((a) => a.name.toLowerCase() === ref.trim().toLowerCase())
    || null;
}

export function registerWatchRoutes(app, daemon) {
  // Register a watch and return immediately — the agent's turn ends, and the
  // wake comes later when the watched thing finishes. This does NOT block.
  app.post('/api/watch', (req, res) => {
    try {
      const { agent, command, until, label, timeoutMs, intervalMs } = req.body || {};
      const who = resolveAgent(daemon, agent);
      if (!who) return res.status(404).json({ error: `Unknown agent: ${agent}` });

      const watch = daemon.watcher.create(who.id, { command, until, label, timeoutMs, intervalMs });
      res.json({
        ok: true,
        watchId: watch.id,
        message: `Watching "${watch.label}". You'll be resumed with the result when it ${watch.mode === 'command' ? 'finishes' : 'condition is met'}. You can end your turn now.`,
      });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/api/watch', (req, res) => {
    res.json({ watches: daemon.watcher.list(req.query.agentId || null) });
  });

  app.delete('/api/watch/:id', (req, res) => {
    const ok = daemon.watcher.cancel(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Watch not found' });
    res.json({ ok: true });
  });
}
