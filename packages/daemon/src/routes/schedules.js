// FSL-1.1-Apache-2.0 — see LICENSE

export function registerScheduleRoutes(app, daemon) {

  // --- Schedules ---

  app.get('/api/schedules', (req, res) => {
    res.json(daemon.scheduler.list());
  });

  app.post('/api/schedules', (req, res) => {
    try {
      const schedule = daemon.scheduler.create(req.body);
      res.status(201).json(schedule);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/api/schedules/presets', (req, res) => {
    const presets = [
      { label: 'Every minute', cron: '* * * * *', description: 'Runs every minute' },
      { label: 'Every 5 minutes', cron: '*/5 * * * *', description: 'Runs every 5 minutes' },
      { label: 'Every 15 minutes', cron: '*/15 * * * *', description: 'Runs every 15 minutes' },
      { label: 'Every 30 minutes', cron: '*/30 * * * *', description: 'Runs every 30 minutes' },
      { label: 'Every hour', cron: '0 * * * *', description: 'Runs at the top of every hour' },
      { label: 'Every 2 hours', cron: '0 */2 * * *', description: 'Runs every 2 hours' },
      { label: 'Every 6 hours', cron: '0 */6 * * *', description: 'Runs every 6 hours' },
      { label: 'Daily at midnight', cron: '0 0 * * *', description: 'Runs once daily at midnight' },
      { label: 'Daily at 9:00 AM', cron: '0 9 * * *', description: 'Runs once daily at 9 AM' },
      { label: 'Twice daily (9 AM & 5 PM)', cron: '0 9,17 * * *', description: 'Runs at 9 AM and 5 PM every day' },
      { label: 'Weekdays at 9:00 AM', cron: '0 9 * * 1-5', description: 'Runs Monday through Friday at 9 AM' },
      { label: 'Monday & Thursday at 9 AM', cron: '0 9 * * 1,4', description: 'Runs on Monday and Thursday at 9 AM' },
      { label: 'Weekly (Sunday midnight)', cron: '0 0 * * 0', description: 'Runs once per week on Sunday at midnight' },
      { label: 'Weekly (Monday midnight)', cron: '0 0 * * 1', description: 'Runs once per week on Monday at midnight' },
      { label: 'Monthly (1st at midnight)', cron: '0 0 1 * *', description: 'Runs on the 1st of every month at midnight' },
    ];
    res.json(presets);
  });

  app.get('/api/schedules/:id', (req, res) => {
    const schedule = daemon.scheduler.get(req.params.id);
    if (!schedule) return res.status(404).json({ error: 'Schedule not found' });
    res.json(schedule);
  });

  app.get('/api/schedules/:id/runs', (req, res) => {
    const history = daemon.scheduler.getRunHistory(req.params.id);
    if (history === null) return res.status(404).json({ error: 'Schedule not found' });
    res.json(history);
  });

  app.patch('/api/schedules/:id', (req, res) => {
    try {
      const schedule = daemon.scheduler.update(req.params.id, req.body);
      res.json(schedule);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete('/api/schedules/:id', (req, res) => {
    try {
      daemon.scheduler.delete(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/schedules/:id/enable', (req, res) => {
    try {
      res.json(daemon.scheduler.enable(req.params.id));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/schedules/:id/disable', (req, res) => {
    try {
      res.json(daemon.scheduler.disable(req.params.id));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/schedules/:id/run', async (req, res) => {
    try {
      const result = await daemon.scheduler.run(req.params.id);
      if (result && result.teamId) {
        res.json({ ok: true, teamId: result.teamId, agentIds: result.agentIds });
      } else {
        res.json({ ok: true, agentId: result.id });
      }
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/schedules/:id/duplicate', (req, res) => {
    try {
      const schedule = daemon.scheduler.duplicate(req.params.id);
      daemon.audit.log('schedule.duplicate', { originalId: req.params.id, newId: schedule.id });
      res.status(201).json(schedule);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

}
