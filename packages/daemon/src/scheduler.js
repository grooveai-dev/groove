// GROOVE — Agent Scheduler (Cron-based agent spawning)
// FSL-1.1-Apache-2.0 — see LICENSE

import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, unlinkSync } from 'fs';
import { resolve } from 'path';
import { randomUUID } from 'crypto';

// Simple cron field parser — supports: *, N, */N
// Fields: minute(0-59) hour(0-23) dayOfMonth(1-31) month(1-12) dayOfWeek(0-6)
function parseCronField(field, min, max) {
  if (field === '*') return null; // any
  if (field.startsWith('*/')) {
    const step = parseInt(field.slice(2), 10);
    if (isNaN(step) || step <= 0) return null;
    return { type: 'step', step };
  }
  const val = parseInt(field, 10);
  if (!isNaN(val) && val >= min && val <= max) {
    return { type: 'exact', value: val };
  }
  return null;
}

function fieldMatches(parsed, value) {
  if (parsed === null) return true; // wildcard
  if (parsed.type === 'exact') return value === parsed.value;
  if (parsed.type === 'step') return value % parsed.step === 0;
  return true;
}

function cronMatches(cronExpr, date) {
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length !== 5) return false;

  const fields = [
    parseCronField(parts[0], 0, 59),   // minute
    parseCronField(parts[1], 0, 23),   // hour
    parseCronField(parts[2], 1, 31),   // day of month
    parseCronField(parts[3], 1, 12),   // month
    parseCronField(parts[4], 0, 6),    // day of week
  ];

  return (
    fieldMatches(fields[0], date.getMinutes()) &&
    fieldMatches(fields[1], date.getHours()) &&
    fieldMatches(fields[2], date.getDate()) &&
    fieldMatches(fields[3], date.getMonth() + 1) &&
    fieldMatches(fields[4], date.getDay())
  );
}

// Human-readable cron description
function describeCron(cron) {
  const presets = {
    '* * * * *': 'Every minute',
    '*/5 * * * *': 'Every 5 minutes',
    '*/15 * * * *': 'Every 15 minutes',
    '*/30 * * * *': 'Every 30 minutes',
    '0 * * * *': 'Every hour',
    '0 */2 * * *': 'Every 2 hours',
    '0 */6 * * *': 'Every 6 hours',
    '0 0 * * *': 'Daily at midnight',
    '0 9 * * *': 'Daily at 9:00 AM',
    '0 9 * * 1-5': 'Weekdays at 9:00 AM',
    '0 0 * * 0': 'Weekly (Sunday midnight)',
    '0 0 * * 1': 'Weekly (Monday midnight)',
    '0 0 1 * *': 'Monthly (1st at midnight)',
  };
  return presets[cron] || cron;
}

const CHECK_INTERVAL = 60_000; // 1 minute
const MAX_HISTORY = 50;

export class Scheduler {
  constructor(daemon) {
    this.daemon = daemon;
    this.schedulesDir = resolve(daemon.grooveDir, 'schedules');
    mkdirSync(this.schedulesDir, { recursive: true });
    this.schedules = new Map();
    this.runningAgents = new Map(); // scheduleId -> agentId
    this.history = new Map();       // scheduleId -> [{ timestamp, agentId, status }]
    this.interval = null;
    this._load();
  }

  /**
   * Create a new schedule.
   */
  create(config) {
    if (!config.name) throw new Error('Schedule name is required');
    if (!config.cron) throw new Error('Cron expression is required');
    if (!config.agentConfig) throw new Error('Agent config is required');
    if (!config.agentConfig.role) throw new Error('Agent role is required');

    // Validate cron (basic check)
    const parts = config.cron.trim().split(/\s+/);
    if (parts.length !== 5) throw new Error('Cron must have 5 fields: minute hour day month weekday');

    const schedule = {
      id: randomUUID().slice(0, 8),
      name: config.name,
      cron: config.cron.trim(),
      cronDescription: describeCron(config.cron.trim()),
      agentConfig: config.agentConfig,
      enabled: config.enabled !== false,
      maxConcurrent: config.maxConcurrent || 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.schedules.set(schedule.id, schedule);
    this.history.set(schedule.id, []);
    this._save(schedule.id);

    this.daemon.audit.log('schedule.create', { id: schedule.id, name: schedule.name, cron: schedule.cron });

    return schedule;
  }

  /**
   * Update an existing schedule.
   */
  update(id, updates) {
    const schedule = this.schedules.get(id);
    if (!schedule) throw new Error(`Schedule not found: ${id}`);

    const SAFE = ['name', 'cron', 'agentConfig', 'enabled', 'maxConcurrent'];
    for (const key of Object.keys(updates)) {
      if (SAFE.includes(key)) {
        schedule[key] = updates[key];
      }
    }
    if (updates.cron) {
      schedule.cronDescription = describeCron(updates.cron.trim());
    }
    schedule.updatedAt = new Date().toISOString();
    this._save(id);

    return schedule;
  }

  /**
   * Delete a schedule.
   */
  delete(id) {
    if (!this.schedules.has(id)) throw new Error(`Schedule not found: ${id}`);
    this.schedules.delete(id);
    this.history.delete(id);
    this.runningAgents.delete(id);

    const filePath = resolve(this.schedulesDir, `${id}.json`);
    if (existsSync(filePath)) unlinkSync(filePath);

    this.daemon.audit.log('schedule.delete', { id });
  }

  /**
   * Enable a schedule.
   */
  enable(id) {
    const schedule = this.schedules.get(id);
    if (!schedule) throw new Error(`Schedule not found: ${id}`);
    schedule.enabled = true;
    schedule.updatedAt = new Date().toISOString();
    this._save(id);
    return schedule;
  }

  /**
   * Disable a schedule.
   */
  disable(id) {
    const schedule = this.schedules.get(id);
    if (!schedule) throw new Error(`Schedule not found: ${id}`);
    schedule.enabled = false;
    schedule.updatedAt = new Date().toISOString();
    this._save(id);
    return schedule;
  }

  /**
   * List all schedules with their current state.
   */
  list() {
    return Array.from(this.schedules.values()).map((s) => ({
      ...s,
      lastRun: this._lastRun(s.id),
      isRunning: this.runningAgents.has(s.id),
    }));
  }

  /**
   * Get a specific schedule with history.
   */
  get(id) {
    const schedule = this.schedules.get(id);
    if (!schedule) return null;
    return {
      ...schedule,
      history: this.history.get(id) || [],
      lastRun: this._lastRun(id),
      isRunning: this.runningAgents.has(id),
    };
  }

  /**
   * Manually trigger a schedule (run now).
   */
  async run(id) {
    const schedule = this.schedules.get(id);
    if (!schedule) throw new Error(`Schedule not found: ${id}`);
    return this._execute(schedule);
  }

  /**
   * Start the scheduler (check every minute).
   */
  start() {
    if (this.interval) return;
    this.interval = setInterval(() => this._check(), CHECK_INTERVAL);
  }

  /**
   * Stop the scheduler.
   */
  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  // --- Internal ---

  _check() {
    const now = new Date();
    for (const schedule of this.schedules.values()) {
      if (!schedule.enabled) continue;
      if (cronMatches(schedule.cron, now)) {
        // Check concurrency
        if (this.runningAgents.has(schedule.id)) {
          const agentId = this.runningAgents.get(schedule.id);
          const agent = this.daemon.registry.get(agentId);
          if (agent && (agent.status === 'running' || agent.status === 'starting')) {
            // Still running — skip
            this._recordHistory(schedule.id, null, 'skipped');
            continue;
          }
          // Agent finished — clear
          this.runningAgents.delete(schedule.id);
        }
        this._execute(schedule).catch(() => {});
      }
    }
  }

  async _execute(schedule) {
    try {
      const agent = await this.daemon.processes.spawn({
        ...schedule.agentConfig,
        name: `sched-${schedule.name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 20)}`,
      });
      this.runningAgents.set(schedule.id, agent.id);
      this._recordHistory(schedule.id, agent.id, 'spawned');

      this.daemon.broadcast({
        type: 'schedule:execute',
        scheduleId: schedule.id,
        agentId: agent.id,
      });

      this.daemon.audit.log('schedule.execute', {
        id: schedule.id,
        name: schedule.name,
        agentId: agent.id,
      });

      return agent;
    } catch (err) {
      this._recordHistory(schedule.id, null, 'error', err.message);
      throw err;
    }
  }

  _recordHistory(scheduleId, agentId, status, error) {
    const history = this.history.get(scheduleId) || [];
    history.unshift({
      timestamp: new Date().toISOString(),
      agentId,
      status,
      error,
    });
    // Keep only last N entries
    if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
    this.history.set(scheduleId, history);
  }

  _lastRun(scheduleId) {
    const history = this.history.get(scheduleId) || [];
    return history[0] || null;
  }

  _save(id) {
    const schedule = this.schedules.get(id);
    if (!schedule) return;
    const filePath = resolve(this.schedulesDir, `${id}.json`);
    writeFileSync(filePath, JSON.stringify({
      ...schedule,
      history: this.history.get(id) || [],
    }, null, 2));
  }

  _load() {
    if (!existsSync(this.schedulesDir)) return;
    for (const file of readdirSync(this.schedulesDir)) {
      if (!file.endsWith('.json')) continue;
      try {
        const data = JSON.parse(readFileSync(resolve(this.schedulesDir, file), 'utf8'));
        const id = data.id || file.replace('.json', '');
        this.schedules.set(id, {
          id,
          name: data.name,
          cron: data.cron,
          cronDescription: describeCron(data.cron),
          agentConfig: data.agentConfig,
          enabled: data.enabled !== false,
          maxConcurrent: data.maxConcurrent || 1,
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
        });
        this.history.set(id, data.history || []);
      } catch { /* skip corrupt files */ }
    }
  }
}
