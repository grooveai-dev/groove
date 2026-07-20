// GROOVE — Auto Agent Orchestrator
// FSL-1.1-Apache-2.0 — see LICENSE
//
// Manages autonomous agent definitions and their lifecycle:
//   - Create/update/delete auto agent definitions
//   - Cron-driven heartbeat: check status, detect transitions, spawn next iteration
//   - Stale process detection
//   - Goal evaluation and phase transitions
//   - File-based state survives daemon restarts
//
// An auto agent is a DEFINITION that spawns real Groove agents on a schedule.
// Each iteration is a standard spawned agent with full telemetry, chat, and tracking.

import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, unlinkSync, copyFileSync, renameSync } from 'fs';
import { resolve } from 'path';
import { randomUUID } from 'crypto';

const CHECK_INTERVAL = 60_000; // 1 minute
const DEFAULT_TIMEOUT = 600;   // 10 minutes per handoff
const DEFAULT_STALE_MINUTES = 240; // 4 hours
const MAX_HISTORY = 50;

function parseCronField(field, min, max) {
  if (field === '*') return null;
  if (field.startsWith('*/')) {
    const step = parseInt(field.slice(2), 10);
    if (isNaN(step) || step <= 0) return null;
    return { type: 'step', step };
  }
  if (field.includes(',')) {
    const values = field.split(',').map(v => parseInt(v.trim(), 10)).filter(v => !isNaN(v) && v >= min && v <= max);
    if (values.length === 0) return null;
    return { type: 'list', values };
  }
  if (field.includes('-')) {
    const [s, e] = field.split('-');
    const start = parseInt(s, 10), end = parseInt(e, 10);
    if (isNaN(start) || isNaN(end) || start < min || end > max) return null;
    return { type: 'range', start, end };
  }
  const val = parseInt(field, 10);
  if (!isNaN(val) && val >= min && val <= max) return { type: 'exact', value: val };
  return null;
}

function fieldMatches(parsed, value) {
  if (parsed === null) return true;
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
    parseCronField(parts[0], 0, 59),
    parseCronField(parts[1], 0, 23),
    parseCronField(parts[2], 1, 31),
    parseCronField(parts[3], 1, 12),
    parseCronField(parts[4], 0, 6),
  ];
  return (
    fieldMatches(fields[0], date.getMinutes()) &&
    fieldMatches(fields[1], date.getHours()) &&
    fieldMatches(fields[2], date.getDate()) &&
    fieldMatches(fields[3], date.getMonth() + 1) &&
    fieldMatches(fields[4], date.getDay())
  );
}

function describeCron(cron) {
  const presets = {
    '*/15 * * * *': 'Every 15 minutes',
    '*/30 * * * *': 'Every 30 minutes',
    '0 * * * *': 'Every hour',
    '0 */2 * * *': 'Every 2 hours',
    '0 */6 * * *': 'Every 6 hours',
    '0 0 * * *': 'Daily at midnight',
    '0 9 * * *': 'Daily at 9:00 AM',
    '0 9 * * 1-5': 'Weekdays at 9:00 AM',
  };
  return presets[cron] || cron;
}

export class Orchestrator {
  constructor(daemon) {
    this.daemon = daemon;
    this.defsDir = resolve(daemon.grooveDir, 'auto-agents');
    mkdirSync(this.defsDir, { recursive: true });
    this.definitions = new Map();
    this.activeAgents = new Map(); // defId -> agentId
    this.interval = null;
    this._load();
  }

  // --- CRUD ---

  create(config) {
    if (!config.name) throw new Error('Name is required');
    if (!config.cadence) throw new Error('Cadence (cron expression) is required');
    const parts = config.cadence.trim().split(/\s+/);
    if (parts.length !== 5) throw new Error('Invalid cron expression (must be 5 fields)');

    const id = randomUUID().slice(0, 8);
    const def = {
      id,
      name: config.name,
      description: config.description || '',
      cadence: config.cadence.trim(),
      cadenceDescription: describeCron(config.cadence.trim()),
      timeout: config.timeout || DEFAULT_TIMEOUT,
      staleThresholdMinutes: config.staleThresholdMinutes || DEFAULT_STALE_MINUTES,
      enabled: config.enabled !== false,
      paused: false,

      // Agent spawn config
      agentConfig: {
        role: config.role || 'fullstack',
        provider: config.provider || this.daemon.config?.defaultProvider || 'claude-code',
        model: config.model || 'auto',
        permission: config.permission || 'auto',
        scope: config.scope || [],
        workingDir: config.workingDir || this.daemon.config?.defaultWorkingDir || this.daemon.projectDir,
        skills: config.skills || [],
        integrations: config.integrations || [],
      },

      // Notifications
      notifications: config.notifications || [],

      // Guardrails
      guardrails: config.guardrails || [],
      maxIterations: config.maxIterations || null, // null = infinite
      maxCostPerCycle: config.maxCostPerCycle || null,

      // Tracking
      totalCycles: 0,
      totalCost: 0,
      consecutiveFailures: 0,
      lastRunAt: null,
      lastRunStatus: null,
      lastAgentId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.definitions.set(id, def);
    this._save(id);

    // Initialize state layer files
    const autoState = this.daemon.autoState;
    autoState.getState(id); // creates default state
    if (config.prompt) autoState.setPrompt(id, config.prompt);
    if (config.roadmap) autoState.setRoadmap(id, config.roadmap);

    this.daemon.broadcast({ type: 'auto-agent:created', data: def });
    this.daemon.audit.log('autoAgent.create', { id, name: def.name });

    return def;
  }

  get(id) {
    return this.definitions.get(id) || null;
  }

  list() {
    return [...this.definitions.values()];
  }

  update(id, updates) {
    const def = this.definitions.get(id);
    if (!def) throw new Error(`Auto agent not found: ${id}`);

    const allowed = [
      'name', 'description', 'cadence', 'timeout', 'staleThresholdMinutes',
      'enabled', 'notifications', 'guardrails', 'maxIterations', 'maxCostPerCycle',
    ];
    for (const key of allowed) {
      if (key in updates) def[key] = updates[key];
    }

    if (updates.cadence) {
      const parts = updates.cadence.trim().split(/\s+/);
      if (parts.length !== 5) throw new Error('Invalid cron expression');
      def.cadence = updates.cadence.trim();
      def.cadenceDescription = describeCron(def.cadence);
    }

    if (updates.agentConfig) {
      def.agentConfig = { ...def.agentConfig, ...updates.agentConfig };
    }

    def.updatedAt = new Date().toISOString();
    this._save(id);

    this.daemon.broadcast({ type: 'auto-agent:updated', data: def });
    return def;
  }

  delete(id) {
    const def = this.definitions.get(id);
    if (!def) throw new Error(`Auto agent not found: ${id}`);

    // Kill active agent if running
    const activeId = this.activeAgents.get(id);
    if (activeId) {
      try { this.daemon.processes.kill(activeId); } catch { /* already dead */ }
      this.activeAgents.delete(id);
    }

    this.definitions.delete(id);
    const filePath = resolve(this.defsDir, `${id}.json`);
    try { unlinkSync(filePath); } catch { /* already gone */ }

    this.daemon.broadcast({ type: 'auto-agent:deleted', data: { id } });
    this.daemon.audit.log('autoAgent.delete', { id, name: def.name });
    return def;
  }

  // --- Controls ---

  pause(id) {
    const def = this.definitions.get(id);
    if (!def) throw new Error(`Auto agent not found: ${id}`);
    def.paused = true;
    def.updatedAt = new Date().toISOString();
    this._save(id);
    this.daemon.autoState.setState(id, { paused: true });
    this.daemon.broadcast({ type: 'auto-agent:paused', data: { id } });
    this.daemon.audit.log('autoAgent.pause', { id, name: def.name });
    return def;
  }

  resume(id) {
    const def = this.definitions.get(id);
    if (!def) throw new Error(`Auto agent not found: ${id}`);
    def.paused = false;
    def.consecutiveFailures = 0;
    def.updatedAt = new Date().toISOString();
    this._save(id);
    this.daemon.autoState.setState(id, { paused: false, error: null });
    this.daemon.broadcast({ type: 'auto-agent:resumed', data: { id } });
    this.daemon.audit.log('autoAgent.resume', { id, name: def.name });
    return def;
  }

  async trigger(id) {
    const def = this.definitions.get(id);
    if (!def) throw new Error(`Auto agent not found: ${id}`);
    return this._executeIteration(def, 'manual');
  }

  // --- Heartbeat ---

  start() {
    if (this.interval) return;
    this.interval = setInterval(() => this._check(), CHECK_INTERVAL);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  _check() {
    const now = new Date();
    for (const def of this.definitions.values()) {
      if (!def.enabled || def.paused) continue;

      // Max iterations check
      if (def.maxIterations && def.totalCycles >= def.maxIterations) continue;

      // Auto-pause after 5 consecutive failures
      if (def.consecutiveFailures >= 5) {
        if (!def.paused) {
          def.paused = true;
          this._save(def.id);
          this.daemon.autoState.setState(def.id, {
            paused: true,
            error: `Auto-paused after ${def.consecutiveFailures} consecutive failures`,
          });
          this.daemon.broadcast({ type: 'auto-agent:auto-paused', data: { id: def.id, reason: 'consecutive_failures' } });
        }
        continue;
      }

      // Check if an agent is currently running
      const activeId = this.activeAgents.get(def.id);
      if (activeId) {
        const agent = this.daemon.registry.get(activeId);
        if (agent && (agent.status === 'running' || agent.status === 'starting')) {
          this._checkStale(def, agent);
          continue;
        }
        // Agent finished — handle transition
        this.activeAgents.delete(def.id);
        this._handleCompletion(def, agent);
        continue;
      }

      // No agent running — check if cron matches
      if (cronMatches(def.cadence, now)) {
        this._executeIteration(def, 'cron').catch(err => {
          console.log(`[Groove:Orchestrator] Failed to execute ${def.name}: ${err.message}`);
        });
      }
    }
  }

  _checkStale(def, agent) {
    if (!agent.lastActivity) return;
    const staleMs = def.staleThresholdMinutes * 60 * 1000;
    const elapsed = Date.now() - new Date(agent.lastActivity).getTime();
    if (elapsed > staleMs) {
      console.log(`[Groove:Orchestrator] Agent ${agent.id} for ${def.name} is stale (${Math.round(elapsed / 60000)}min idle)`);
      this.daemon.autoState.appendJournal(def.id, {
        event: 'stale_detected',
        details: `Agent ${agent.id} idle for ${Math.round(elapsed / 60000)} minutes — killing`,
        agentId: agent.id,
      });
      try { this.daemon.processes.kill(agent.id); } catch { /* already dead */ }
      this.activeAgents.delete(def.id);
    }
  }

  _handleCompletion(def, agent) {
    const status = agent?.status || 'unknown';
    const runId = randomUUID().slice(0, 8);

    // Log the run
    this.daemon.autoState.logRun(def.id, runId, {
      agentId: agent?.id,
      status,
      startedAt: agent?.spawnedAt,
      completedAt: new Date().toISOString(),
      tokensUsed: agent?.tokensUsed || 0,
      costUsd: agent?.costUsd || 0,
      turns: agent?.turns || 0,
    });

    // Update def tracking
    def.totalCycles++;
    def.totalCost += (agent?.costUsd || 0);
    def.lastRunStatus = status;
    def.lastAgentId = agent?.id;
    def.updatedAt = new Date().toISOString();

    if (status === 'completed') {
      def.consecutiveFailures = 0;
      this.daemon.autoState.appendJournal(def.id, {
        event: 'cycle_completed',
        cycle: def.totalCycles,
        details: `Cycle ${def.totalCycles} completed successfully`,
        agentId: agent?.id,
        cost: agent?.costUsd || 0,
      });
    } else {
      def.consecutiveFailures++;
      this.daemon.autoState.appendJournal(def.id, {
        event: 'cycle_failed',
        cycle: def.totalCycles,
        details: `Cycle ${def.totalCycles} ended with status: ${status}`,
        agentId: agent?.id,
        error: status,
      });
    }

    // Update state
    const state = this.daemon.autoState.getState(def.id);
    this.daemon.autoState.setState(def.id, {
      cycle: def.totalCycles,
      current_run: null,
    });

    this._save(def.id);
    this.daemon.broadcast({ type: 'auto-agent:cycle-complete', data: { id: def.id, cycle: def.totalCycles, status } });
  }

  async _executeIteration(def, trigger) {
    const autoState = this.daemon.autoState;
    const state = autoState.getState(def.id);
    const journal = autoState.getJournal(def.id, { limit: 20 });
    const roadmap = autoState.getRoadmap(def.id);
    const prompt = autoState.getPrompt(def.id);

    // Build the full context prompt
    const contextPrompt = this._buildPrompt(def, state, journal, roadmap, prompt, trigger);

    // Spawn a real Groove agent
    const agentConfig = {
      ...def.agentConfig,
      prompt: contextPrompt,
      name: `auto-${def.name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 20)}-c${(def.totalCycles + 1)}`,
      metadata: {
        autoAgentId: def.id,
        autoAgentName: def.name,
        cycle: def.totalCycles + 1,
        trigger,
        isAutoAgent: true,
      },
    };

    const agent = await this.daemon.processes.spawn(agentConfig);

    this.activeAgents.set(def.id, agent.id);
    def.lastRunAt = new Date().toISOString();
    def.lastRunStatus = 'running';
    def.lastAgentId = agent.id;
    this._save(def.id);

    autoState.setState(def.id, {
      current_run: {
        agentId: agent.id,
        cycle: def.totalCycles + 1,
        trigger,
        startedAt: new Date().toISOString(),
      },
    });

    autoState.appendJournal(def.id, {
      event: 'cycle_started',
      cycle: def.totalCycles + 1,
      trigger,
      agentId: agent.id,
    });

    this.daemon.broadcast({
      type: 'auto-agent:iteration-started',
      data: { id: def.id, agentId: agent.id, cycle: def.totalCycles + 1, trigger },
    });

    this.daemon.audit.log('autoAgent.iterate', {
      id: def.id, name: def.name, agentId: agent.id,
      cycle: def.totalCycles + 1, trigger,
    });

    // Watch for completion
    this._watchAgent(def.id, agent.id);

    return agent;
  }

  _buildPrompt(def, state, journal, roadmap, systemPrompt, trigger) {
    const parts = [];

    // System prompt (identity, tools, rules, philosophy)
    if (systemPrompt) {
      parts.push(systemPrompt);
    } else {
      parts.push(`# Auto Agent: ${def.name}\n\n${def.description || 'Autonomous agent.'}`);
      parts.push(`\nYou are an autonomous agent. You own this task — analyze, decide, execute.`);
      parts.push(`Update your state and journal with your decisions and findings.`);
      parts.push(`\n## How to Think About Failure\nA regression is not a reason to stop — it's a data point. Extract the lesson and design a better experiment. Never park yourself waiting for approval — keep iterating.`);
    }

    // Current situation
    parts.push(`\n---\n## Current Situation`);
    parts.push(`**Trigger:** ${trigger}`);
    parts.push(`**Phase:** ${state.phase || 'idle'}`);
    if (state.phase_note) parts.push(`**Phase Note:** ${state.phase_note}`);
    parts.push(`**Cycle:** ${state.cycle + 1}`);

    if (state.champion) {
      parts.push(`\n**Current Champion:**`);
      parts.push('```json\n' + JSON.stringify(state.champion, null, 2) + '\n```');
    }

    // History (last 10)
    if (Array.isArray(state.history) && state.history.length > 0) {
      parts.push(`\n## Recent History (last ${Math.min(state.history.length, 10)})`);
      for (const h of state.history.slice(-10)) {
        parts.push(`- [${h.timestamp || '?'}] ${h.tag || h.event || 'entry'}: ${h.note || h.details || JSON.stringify(h)}`);
      }
    }

    // Journal (accumulated knowledge)
    if (journal.length > 0) {
      parts.push(`\n## Journal (accumulated knowledge from previous cycles)`);
      for (const j of journal) {
        parts.push(`- [${j.timestamp}] **${j.event}**: ${j.details || ''}`);
        if (j.lesson) parts.push(`  *Lesson:* ${j.lesson}`);
      }
    }

    // Roadmap
    if (roadmap) {
      parts.push(`\n## Roadmap\n${roadmap}`);
    }

    // Guardrails
    if (def.guardrails && def.guardrails.length > 0) {
      parts.push(`\n## Guardrails (MUST NOT violate)`);
      for (const g of def.guardrails) {
        parts.push(`- ${typeof g === 'string' ? g : g.description || JSON.stringify(g)}`);
      }
    }

    // Instructions for state management
    parts.push(`\n---\n## State Management`);
    parts.push(`When you complete work, update your findings by writing to the state files:`);
    parts.push(`- Update phase/phase_note via the GROOVE API: \`POST http://localhost:31415/api/auto-agents/${def.id}/state\``);
    parts.push(`- Add journal entries: \`POST http://localhost:31415/api/auto-agents/${def.id}/journal\``);
    parts.push(`- Add history entries: \`POST http://localhost:31415/api/auto-agents/${def.id}/history\``);
    parts.push(`\nTake ownership. Analyze, decide, and execute. Keep moving forward.`);

    return parts.join('\n');
  }

  _watchAgent(defId, agentId) {
    const checkInterval = setInterval(() => {
      const agent = this.daemon.registry.get(agentId);
      if (!agent) {
        clearInterval(checkInterval);
        this.activeAgents.delete(defId);
        return;
      }
      const terminal = new Set(['completed', 'crashed', 'stopped', 'killed']);
      if (!terminal.has(agent.status)) return;
      clearInterval(checkInterval);

      // Let the next _check() cycle handle the transition
      // (activeAgents still has the mapping, _check will see the terminal status)
    }, 5000);
  }

  // --- Persistence ---

  _load() {
    if (!existsSync(this.defsDir)) return;
    for (const file of readdirSync(this.defsDir)) {
      if (!file.endsWith('.json')) continue;
      try {
        const data = JSON.parse(readFileSync(resolve(this.defsDir, file), 'utf8'));
        if (data.id) {
          // Reset running state on load (daemon restarted)
          data.lastRunStatus = data.lastRunStatus === 'running' ? 'interrupted' : data.lastRunStatus;
          this.definitions.set(data.id, data);
        }
      } catch (err) {
        console.log(`[Groove:Orchestrator] Failed to load ${file}: ${err.message}`);
      }
    }
  }

  _save(id) {
    const def = this.definitions.get(id);
    if (!def) return;
    const filePath = resolve(this.defsDir, `${id}.json`);
    writeFileSync(filePath, JSON.stringify(def, null, 2));
  }

  // --- Status ---

  getStatus(id) {
    const def = this.definitions.get(id);
    if (!def) return null;
    const state = this.daemon.autoState.getState(id);
    const activeAgentId = this.activeAgents.get(id);
    let activeAgent = null;
    if (activeAgentId) {
      const agent = this.daemon.registry.get(activeAgentId);
      if (agent) {
        activeAgent = {
          id: agent.id,
          status: agent.status,
          tokensUsed: agent.tokensUsed,
          costUsd: agent.costUsd,
          turns: agent.turns,
          spawnedAt: agent.spawnedAt,
          lastActivity: agent.lastActivity,
        };
      }
    }
    return {
      definition: def,
      state,
      activeAgent,
    };
  }
}
