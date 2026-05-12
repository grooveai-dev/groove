// GROOVE — Agent Scheduler (Cron-based agent spawning + Automations)
// FSL-1.1-Apache-2.0 — see LICENSE

import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, unlinkSync } from 'fs';
import { resolve } from 'path';
import { randomUUID } from 'crypto';

// Simple cron field parser — supports: *, N, */N, N,N,N (lists), N-N (ranges)
// Fields: minute(0-59) hour(0-23) dayOfMonth(1-31) month(1-12) dayOfWeek(0-6)
function parseCronField(field, min, max) {
  if (field === '*') return null; // any
  if (field.startsWith('*/')) {
    const step = parseInt(field.slice(2), 10);
    if (isNaN(step) || step <= 0) return null;
    return { type: 'step', step };
  }
  if (field.includes(',')) {
    const values = field.split(',').map((v) => parseInt(v.trim(), 10)).filter((v) => !isNaN(v) && v >= min && v <= max);
    if (values.length === 0) return null;
    return { type: 'list', values };
  }
  if (field.includes('-')) {
    const [startStr, endStr] = field.split('-');
    const start = parseInt(startStr, 10);
    const end = parseInt(endStr, 10);
    if (isNaN(start) || isNaN(end) || start < min || end > max) return null;
    return { type: 'range', start, end };
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
  if (parsed.type === 'list') return parsed.values.includes(value);
  if (parsed.type === 'range') return value >= parsed.start && value <= parsed.end;
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
    '0 9,17 * * *': 'Twice daily (9 AM & 5 PM)',
    '0 9 * * 1,4': 'Monday & Thursday at 9 AM',
  };
  return presets[cron] || cron;
}

export { describeCron };

const CHECK_INTERVAL = 60_000; // 1 minute
const MAX_HISTORY = 50;

export class Scheduler {
  constructor(daemon) {
    this.daemon = daemon;
    this.schedulesDir = resolve(daemon.grooveDir, 'schedules');
    mkdirSync(this.schedulesDir, { recursive: true });
    this.schedules = new Map();
    this.runningAgents = new Map(); // scheduleId -> agentId (or Set of agentIds for teams)
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

    // Require either agentConfig or teamConfig
    if (!config.agentConfig && !config.teamConfig) {
      throw new Error('Either agentConfig or teamConfig is required');
    }
    if (config.agentConfig && !config.agentConfig.role) {
      throw new Error('Agent role is required');
    }
    if (config.teamConfig) {
      if (!Array.isArray(config.teamConfig) || config.teamConfig.length === 0) {
        throw new Error('teamConfig must be a non-empty array of agent configs');
      }
      for (const tc of config.teamConfig) {
        if (!tc.role) throw new Error('Each teamConfig entry must have a role');
      }
    }

    // Validate cron (basic check)
    const parts = config.cron.trim().split(/\s+/);
    if (parts.length !== 5) throw new Error('Cron must have 5 fields: minute hour day month weekday');

    // Validate instructionSource
    if (config.instructionSource) {
      const is = config.instructionSource;
      if (!['inline', 'file'].includes(is.type)) {
        throw new Error('instructionSource.type must be "inline" or "file"');
      }
      if (is.type === 'inline' && (!is.content || typeof is.content !== 'string')) {
        throw new Error('instructionSource.content is required for inline type');
      }
      if (is.type === 'file' && (!is.filePath || typeof is.filePath !== 'string')) {
        throw new Error('instructionSource.filePath is required for file type');
      }
    }

    // Validate outputConfig
    if (config.outputConfig) {
      const oc = config.outputConfig;
      if (oc.gatewayIds && !Array.isArray(oc.gatewayIds)) {
        throw new Error('outputConfig.gatewayIds must be an array');
      }
      if (oc.notifyOn && !['complete', 'error', 'always'].includes(oc.notifyOn)) {
        throw new Error('outputConfig.notifyOn must be "complete", "error", or "always"');
      }
      // Validate gateway IDs reference real gateways
      if (oc.gatewayIds && this.daemon.gateways) {
        for (const gid of oc.gatewayIds) {
          if (!this.daemon.gateways.get(gid)) {
            throw new Error(`Gateway not found: ${gid}`);
          }
        }
      }
    }

    // Validate integrationIds
    if (config.integrationIds) {
      if (!Array.isArray(config.integrationIds)) {
        throw new Error('integrationIds must be an array');
      }
      if (this.daemon.integrations) {
        const installed = this.daemon.integrations.getInstalled();
        for (const iid of config.integrationIds) {
          if (!installed.some((i) => i.id === iid)) {
            throw new Error(`Integration not installed: ${iid}`);
          }
        }
      }
    }

    const schedule = {
      id: randomUUID().slice(0, 8),
      name: config.name,
      cron: config.cron.trim(),
      cronDescription: describeCron(config.cron.trim()),
      agentConfig: config.agentConfig || null,
      teamConfig: config.teamConfig || null,
      instructionSource: config.instructionSource || null,
      outputConfig: config.outputConfig || null,
      integrationIds: config.integrationIds || null,
      description: config.description || '',
      teamName: config.teamName || '',
      enabled: config.enabled !== false,
      maxConcurrent: config.maxConcurrent || 1,
      lastRunStatus: null,
      lastRunAt: null,
      lastRunDuration: null,
      lastRunCost: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.schedules.set(schedule.id, schedule);
    this.history.set(schedule.id, []);
    this._save(schedule.id);

    this.daemon.broadcast({ type: 'schedule:created', data: schedule });
    this.daemon.audit.log('schedule.create', { id: schedule.id, name: schedule.name, cron: schedule.cron });

    return schedule;
  }

  /**
   * Update an existing schedule.
   */
  update(id, updates) {
    const schedule = this.schedules.get(id);
    if (!schedule) throw new Error(`Schedule not found: ${id}`);

    const SAFE = [
      'name', 'cron', 'agentConfig', 'teamConfig', 'instructionSource',
      'outputConfig', 'integrationIds', 'description', 'teamName',
      'enabled', 'maxConcurrent',
    ];
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

    this.daemon.broadcast({ type: 'schedule:updated', data: schedule });
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

    this.daemon.broadcast({ type: 'schedule:deleted', data: { id } });
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
    this.daemon.broadcast({ type: 'schedule:updated', data: schedule });
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
    this.daemon.broadcast({ type: 'schedule:updated', data: schedule });
    return schedule;
  }

  /**
   * List all schedules with their current state.
   */
  list() {
    return Array.from(this.schedules.values()).map((s) => {
      const runInfo = this.runningAgents.get(s.id);
      let activeAgentIds = null;
      if (runInfo) {
        if (typeof runInfo === 'string') activeAgentIds = [runInfo];
        else if (runInfo.agentIds) activeAgentIds = runInfo.agentIds;
      }
      return {
        ...s,
        lastRun: this._lastRun(s.id),
        isRunning: this.runningAgents.has(s.id),
        activeAgentIds,
      };
    });
  }

  /**
   * Get a specific schedule with history.
   */
  get(id) {
    const schedule = this.schedules.get(id);
    if (!schedule) return null;
    const runInfo = this.runningAgents.get(id);
    let activeAgentIds = null;
    if (runInfo) {
      if (typeof runInfo === 'string') activeAgentIds = [runInfo];
      else if (runInfo.agentIds) activeAgentIds = runInfo.agentIds;
    }
    return {
      ...schedule,
      history: this.history.get(id) || [],
      lastRun: this._lastRun(id),
      isRunning: this.runningAgents.has(id),
      activeAgentIds,
    };
  }

  /**
   * Get run history for a schedule.
   */
  getRunHistory(id) {
    if (!this.schedules.has(id)) return null;
    return this.history.get(id) || [];
  }

  /**
   * Duplicate a schedule with a new ID.
   */
  duplicate(id) {
    const original = this.schedules.get(id);
    if (!original) throw new Error(`Schedule not found: ${id}`);

    const clone = {
      ...original,
      name: `${original.name} (Copy)`,
      lastRunStatus: null,
      lastRunAt: null,
      lastRunDuration: null,
      lastRunCost: null,
    };
    // create() will assign a new ID and timestamps
    return this.create(clone);
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
          const runInfo = this.runningAgents.get(schedule.id);
          // For team runs, runInfo is { agentIds, teamId, startedAt }
          // For single agent runs, it's an agentId string (backward compat)
          if (typeof runInfo === 'string') {
            const agent = this.daemon.registry.get(runInfo);
            if (agent && (agent.status === 'running' || agent.status === 'starting')) {
              this._recordHistory(schedule.id, null, 'skipped');
              continue;
            }
          } else if (runInfo && runInfo.agentIds) {
            const anyRunning = runInfo.agentIds.some((aid) => {
              const a = this.daemon.registry.get(aid);
              return a && (a.status === 'running' || a.status === 'starting');
            });
            if (anyRunning) {
              this._recordHistory(schedule.id, null, 'skipped');
              continue;
            }
          }
          this.runningAgents.delete(schedule.id);
        }
        this._execute(schedule).catch(() => {});
      }
    }
  }

  /**
   * Resolve the instruction prompt for this schedule.
   */
  _resolveInstruction(schedule) {
    let instruction = null;
    if (schedule.instructionSource) {
      const is = schedule.instructionSource;
      if (is.type === 'inline') instruction = is.content;
      if (is.type === 'file') {
        if (!existsSync(is.filePath)) {
          throw new Error(`Instruction file not found: ${is.filePath}`);
        }
        instruction = readFileSync(is.filePath, 'utf8');
      }
    }

    const oc = schedule.outputConfig;
    if (oc) {
      const parts = [];
      if (oc.filePath) parts.push(`Save output/results to: ${oc.filePath}`);
      if (oc.customInstructions) parts.push(oc.customInstructions);
      if (parts.length > 0) {
        const section = '\n\n## Output\n' + parts.join('\n');
        instruction = instruction ? instruction + section : section;
      }
    }

    return instruction;
  }

  async _execute(schedule) {
    const startedAt = Date.now();

    // Update run status
    schedule.lastRunStatus = 'running';
    schedule.lastRunAt = new Date().toISOString();
    this._save(schedule.id);

    // Resolve instruction prompt
    let instruction;
    try {
      instruction = this._resolveInstruction(schedule);
    } catch (err) {
      this._recordHistory(schedule.id, null, 'error', err.message);
      schedule.lastRunStatus = 'error';
      schedule.lastRunDuration = Date.now() - startedAt;
      this._save(schedule.id);
      throw err;
    }

    // Team-based execution
    if (schedule.teamConfig) {
      return this._executeTeam(schedule, instruction, startedAt);
    }

    // Single agent execution (backward compatible)
    return this._executeSingle(schedule, instruction, startedAt);
  }

  async _executeSingle(schedule, instruction, startedAt) {
    try {
      const config = { ...schedule.agentConfig };
      if (instruction) config.prompt = instruction;
      if (schedule.integrationIds) config.integrations = schedule.integrationIds;
      config.name = `sched-${schedule.name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 20)}`;
      config.metadata = { ...config.metadata, scheduled: true, scheduleId: schedule.id };

      const agent = await this.daemon.processes.spawn(config);
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

      // Watch for completion to update run metadata and send notifications
      this._watchAgent(schedule, agent.id, startedAt);

      return agent;
    } catch (err) {
      this._recordHistory(schedule.id, null, 'error', err.message);
      schedule.lastRunStatus = 'error';
      schedule.lastRunDuration = Date.now() - startedAt;
      this._save(schedule.id);
      this._sendOutputNotification(schedule, 'error', startedAt, err.message);
      throw err;
    }
  }

  async _executeTeam(schedule, instruction, startedAt) {
    try {
      // Create a team for this run
      const teamName = schedule.teamName || schedule.name;
      let team;
      try {
        team = this.daemon.teams.create(teamName);
      } catch {
        // Team name might already exist, use a unique suffix
        team = this.daemon.teams.create(`${teamName}-${Date.now().toString(36)}`);
      }

      const defaultProvider = this.daemon.config?.defaultProvider || 'claude-code';
      const defaultDir = this.daemon.config?.defaultWorkingDir || this.daemon.projectDir;

      // Separate phases
      const phase1Configs = schedule.teamConfig.filter((c) => !c.phase || c.phase === 1);
      const phase2Configs = schedule.teamConfig.filter((c) => c.phase === 2);

      const allAgentIds = [];
      const phase1Ids = [];

      // Spawn phase 1 agents
      for (const tc of phase1Configs) {
        const config = {
          role: tc.role,
          scope: tc.scope || [],
          provider: tc.provider || defaultProvider,
          model: tc.model || 'auto',
          permission: tc.permission || 'auto',
          workingDir: defaultDir,
          name: tc.name || undefined,
        };
        if (instruction) config.prompt = instruction;
        else if (tc.prompt) config.prompt = tc.prompt;
        if (schedule.integrationIds) config.integrations = schedule.integrationIds;
        config.teamId = team.id;
        config.metadata = { scheduled: true, scheduleId: schedule.id };

        try {
          const agent = await this.daemon.processes.spawn(config);
          phase1Ids.push(agent.id);
          allAgentIds.push(agent.id);
        } catch (err) {
          console.log(`[Groove:Scheduler] Failed to spawn ${tc.role}: ${err.message}`);
        }
      }

      if (phase1Ids.length === 0) {
        throw new Error('Failed to spawn any phase 1 agents');
      }

      // Register phase 2 for auto-spawn
      if (phase2Configs.length > 0) {
        this.daemon._pendingPhase2 = this.daemon._pendingPhase2 || [];
        this.daemon._pendingPhase2.push({
          waitFor: phase1Ids,
          agents: phase2Configs.map((c) => ({
            role: c.role,
            scope: c.scope || [],
            prompt: c.prompt || (instruction ? instruction : ''),
            provider: c.provider || defaultProvider,
            model: c.model || 'auto',
            permission: c.permission || 'auto',
            workingDir: defaultDir,
            name: c.name || undefined,
            teamId: team.id,
          })),
        });
      }

      this.runningAgents.set(schedule.id, {
        agentIds: allAgentIds,
        teamId: team.id,
        startedAt,
      });

      this._recordHistory(schedule.id, phase1Ids.join(','), 'spawned');

      this.daemon.broadcast({
        type: 'schedule:execute',
        scheduleId: schedule.id,
        teamId: team.id,
        agentCount: phase1Ids.length,
      });

      this.daemon.audit.log('schedule.executeTeam', {
        id: schedule.id,
        name: schedule.name,
        teamId: team.id,
        phase1: phase1Ids.length,
        phase2Pending: phase2Configs.length,
      });

      // Watch all agents for completion
      for (const aid of allAgentIds) {
        this._watchAgent(schedule, aid, startedAt);
      }

      return { teamId: team.id, agentIds: allAgentIds };
    } catch (err) {
      this._recordHistory(schedule.id, null, 'error', err.message);
      schedule.lastRunStatus = 'error';
      schedule.lastRunDuration = Date.now() - startedAt;
      this._save(schedule.id);
      this._sendOutputNotification(schedule, 'error', startedAt, err.message);
      throw err;
    }
  }

  /**
   * Watch an agent for completion and update run metadata.
   */
  _watchAgent(schedule, agentId, startedAt) {
    const checkInterval = setInterval(() => {
      const agent = this.daemon.registry.get(agentId);
      if (!agent) {
        clearInterval(checkInterval);
        return;
      }

      const terminal = new Set(['completed', 'crashed', 'stopped', 'killed']);
      if (!terminal.has(agent.status)) return;

      clearInterval(checkInterval);

      const runInfo = this.runningAgents.get(schedule.id);

      // For team runs, check if ALL agents are done
      if (runInfo && typeof runInfo === 'object' && runInfo.agentIds) {
        const allDone = runInfo.agentIds.every((aid) => {
          const a = this.daemon.registry.get(aid);
          return !a || terminal.has(a.status);
        });
        if (!allDone) return;

        // Also check for phase 2 agents that were spawned after
        const teamAgents = this.daemon.registry.getAll().filter((a) => a.teamId === runInfo.teamId);
        const teamAllDone = teamAgents.every((a) => terminal.has(a.status));
        if (!teamAllDone) return;

        // All team agents done
        const anyError = teamAgents.some((a) => a.status === 'crashed');
        const totalCost = teamAgents.reduce((sum, a) => sum + (a.costUsd || 0), 0);

        schedule.lastRunStatus = anyError ? 'error' : 'success';
        schedule.lastRunDuration = Date.now() - startedAt;
        schedule.lastRunCost = totalCost;
        this._save(schedule.id);
        this.runningAgents.delete(schedule.id);

        this._recordHistory(schedule.id, runInfo.agentIds.join(','), anyError ? 'error' : 'completed');
        this._sendOutputNotification(schedule, anyError ? 'error' : 'success', startedAt,
          anyError ? `${teamAgents.filter((a) => a.status === 'crashed').length} agent(s) crashed` : null);
        return;
      }

      // Single agent completion
      schedule.lastRunStatus = agent.status === 'completed' ? 'success' : 'error';
      schedule.lastRunDuration = Date.now() - startedAt;
      schedule.lastRunCost = agent.costUsd || 0;
      this._save(schedule.id);
      this.runningAgents.delete(schedule.id);

      this._recordHistory(schedule.id, agentId, agent.status === 'completed' ? 'completed' : 'error');
      this._sendOutputNotification(schedule,
        agent.status === 'completed' ? 'success' : 'error',
        startedAt,
        agent.status !== 'completed' ? `Agent ${agent.status}` : null);
    }, 5000);
  }

  /**
   * Send output notification through configured gateways.
   */
  _sendOutputNotification(schedule, status, startedAt, errorDetails) {
    if (!schedule.outputConfig || !schedule.outputConfig.gatewayIds || schedule.outputConfig.gatewayIds.length === 0) return;

    const notifyOn = schedule.outputConfig.notifyOn || 'always';
    if (notifyOn === 'complete' && status !== 'success') return;
    if (notifyOn === 'error' && status !== 'error') return;

    const duration = Date.now() - startedAt;
    const agentCount = schedule.teamConfig ? schedule.teamConfig.length : 1;

    const summary = {
      name: schedule.name,
      description: schedule.description || '',
      status,
      duration,
      cost: schedule.lastRunCost || 0,
      agentCount,
      errors: errorDetails || null,
    };

    if (this.daemon.gateways && typeof this.daemon.gateways.sendScheduleNotification === 'function') {
      this.daemon.gateways.sendScheduleNotification(schedule.outputConfig.gatewayIds, summary);
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
          agentConfig: data.agentConfig || null,
          teamConfig: data.teamConfig || null,
          instructionSource: data.instructionSource || null,
          outputConfig: data.outputConfig || null,
          integrationIds: data.integrationIds || null,
          description: data.description || '',
          teamName: data.teamName || '',
          enabled: data.enabled !== false,
          maxConcurrent: data.maxConcurrent || 1,
          lastRunStatus: data.lastRunStatus || null,
          lastRunAt: data.lastRunAt || null,
          lastRunDuration: data.lastRunDuration || null,
          lastRunCost: data.lastRunCost || null,
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
        });
        this.history.set(id, data.history || []);
      } catch { /* skip corrupt files */ }
    }
  }
}
