// FSL-1.1-Apache-2.0 — see LICENSE

import { resolve, relative } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import { homedir } from 'os';
import { validateAgentConfig, validateTeamMode } from '../validate.js';

export function registerTeamRoutes(app, daemon) {

  // --- Teams (live agent groups) ---

  app.get('/api/teams', (req, res) => {
    res.json({
      teams: daemon.teams.list(),
      defaultTeamId: daemon.teams.getDefault()?.id || null,
    });
  });

  app.post('/api/teams', (req, res) => {
    try {
      const team = daemon.teams.create(req.body.name, { mode: req.body.mode });
      daemon.audit.log('team.create', { id: team.id, name: team.name, mode: team.mode, workingDir: team.workingDir });
      res.status(201).json(team);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/api/teams/archived', (req, res) => {
    res.json({ archived: daemon.teams.listArchived() });
  });

  app.post('/api/teams/archived/:id/restore', (req, res) => {
    try {
      const team = daemon.teams.restore(req.params.id);
      daemon.audit.log('team.restore', { archivedId: req.params.id, newId: team.id, name: team.name });
      res.json(team);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete('/api/teams/archived/:id', (req, res) => {
    try {
      daemon.teams.purge(req.params.id);
      daemon.audit.log('team.purge', { archivedId: req.params.id });
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.patch('/api/teams/:id', (req, res) => {
    try {
      if (req.body.name) daemon.teams.rename(req.params.id, req.body.name);
      if (req.body.workingDir !== undefined) daemon.teams.setWorkingDir(req.params.id, req.body.workingDir);
      const team = daemon.teams.get(req.params.id);
      daemon.audit.log('team.update', { id: team.id, name: team.name, workingDir: team.workingDir });
      res.json(team);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete('/api/teams/:id', (req, res) => {
    try {
      const permanent = req.query.permanent === 'true';
      daemon.teams.delete(req.params.id, { permanent });
      daemon.audit.log(permanent ? 'team.delete' : 'team.archive', { id: req.params.id, permanent });
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/teams/:id/promote', (req, res) => {
    try {
      const result = daemon.teams.promote(req.params.id);
      daemon.audit.log('team.promote', { id: req.params.id, destination: result.destination });
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // --- Project Manager (AI Review Gate) ---

  // Agent knocks on PM before risky operations (Auto permission mode)
  app.post('/api/pm/review', async (req, res) => {
    try {
      const { agent, action, file, description } = req.body;
      if (!agent || !action || !file) {
        return res.status(400).json({ error: 'agent, action, and file are required' });
      }
      const result = await daemon.pm.review({ agent, action, file, description: description || '' });
      res.json(result);
    } catch (err) {
      // On failure, approve by default (don't block agents)
      res.json({ approved: true, reason: `PM error: ${err.message}. Auto-approved.` });
    }
  });

  // PM review history for Approvals tab
  app.get('/api/pm/history', (req, res) => {
    res.json({
      history: daemon.pm.getHistory(),
      stats: daemon.pm.getStats(),
    });
  });

  // --- Recommended Team (from planner) ---

  // Find recommended-team.json — check planner agents first (they write the file),
  // sorted by most recent activity so the latest planner's team wins.
  function findRecommendedTeam() {
    const agents = daemon.registry.getAll();
    const planners = agents
      .filter((a) => a.role === 'planner' && a.workingDir)
      .sort((a, b) => (b.lastActivity || b.spawnedAt || '').localeCompare(a.lastActivity || a.spawnedAt || ''));

    const candidates = [];
    for (const planner of planners) {
      const p = resolve(planner.workingDir, '.groove', 'recommended-team.json');
      if (existsSync(p)) candidates.push({ path: p, teamId: planner.teamId || null, agentId: planner.id || null });
    }
    const fallback = resolve(daemon.grooveDir, 'recommended-team.json');
    if (existsSync(fallback) && !candidates.some(c => c.path === fallback)) {
      candidates.push({ path: fallback, teamId: planners[0]?.teamId || null, agentId: planners[0]?.id || null });
    }
    if (candidates.length === 0) return null;

    for (const c of candidates) {
      try {
        const data = JSON.parse(readFileSync(c.path, 'utf8'));
        if (data._meta?.teamId) {
          return { path: c.path, teamId: data._meta.teamId, agentId: data._meta.agentId || c.agentId };
        }
      } catch {}
    }
    return candidates[0];
  }

  app.get('/api/recommended-team', (req, res) => {
    const found = findRecommendedTeam();
    if (!found) {
      return res.json({ exists: false, agents: [] });
    }
    try {
      const raw = JSON.parse(readFileSync(found.path, 'utf8'));
      delete raw._meta;
      // Support both old format (bare array) and new format ({ projectDir, agents })
      if (Array.isArray(raw)) {
        res.json({ exists: true, agents: raw, teamId: found.teamId });
      } else if (raw && Array.isArray(raw.agents)) {
        res.json({ exists: true, agents: raw.agents, projectDir: raw.projectDir || null, teamId: found.teamId });
      } else {
        res.json({ exists: false, agents: [] });
      }
    } catch {
      res.json({ exists: false, agents: [] });
    }
  });

  app.post('/api/recommended-team/launch', async (req, res) => {
    const found = findRecommendedTeam();
    if (!found) {
      return res.status(404).json({ error: 'No recommended team found. Run a planner first.' });
    }
    const planPath = found.path;
    const planContents = readFileSync(planPath, 'utf8');
    try {
      const raw = JSON.parse(planContents);
      delete raw._meta;

      // Delete immediately after reading to prevent duplicate launches from poll races.
      // If every spawn below fails, we'll restore the plan from planContents so the
      // user can retry without re-prompting the planner.
      try { unlinkSync(planPath); } catch { /* already gone */ }

      // Support both old format (bare array) and new format ({ projectDir, agents, preview })
      let agentConfigs;
      let projectDir = null;
      let previewBlock = null;

      // Frontend Team Builder override — if body.agents is provided, use it
      // instead of the planner's recommended-team.json
      if (Array.isArray(req.body?.agents) && req.body.agents.length > 0) {
        agentConfigs = req.body.agents;
        projectDir = raw.projectDir || null;
        previewBlock = raw.preview || null;
      } else if (Array.isArray(raw)) {
        agentConfigs = raw;
      } else if (raw && Array.isArray(raw.agents)) {
        agentConfigs = raw.agents;
        projectDir = raw.projectDir || null;
        previewBlock = raw.preview || null;
      } else {
        return res.status(400).json({ error: 'Invalid recommended team format' });
      }

      if (agentConfigs.length === 0) {
        return res.status(400).json({ error: 'Recommended team is empty' });
      }

      const maxPhase = agentConfigs.reduce((max, config) => {
        const phase = typeof config.phase === 'number' ? config.phase : 1;
        return Math.max(max, phase);
      }, 1);

      // Resolve base directory from the planner that wrote the file, not the daemon root
      const plannerAgent = found.agentId ? daemon.registry.get(found.agentId) : null;
      const baseDir = plannerAgent?.workingDir || daemon.config?.defaultWorkingDir || daemon.projectDir;
      const plannerProvider = plannerAgent?.provider || undefined;
      const plannerModel = plannerAgent?.model || undefined;

      // Use the planner's teamId so launched agents join the correct team.
      // Priority: explicit from frontend > agent that wrote the file > most recent planner > default
      let launchTeamId = req.body?.teamId || found.teamId || null;
      if (!launchTeamId) {
        const planners = daemon.registry.getAll()
          .filter((a) => a.role === 'planner')
          .sort((a, b) => (b.lastActivity || '').localeCompare(a.lastActivity || ''));
        launchTeamId = planners[0]?.teamId || null;
      }
      const defaultTeamId = launchTeamId || daemon.teams.getDefault()?.id || null;

      // Determine team build mode
      let launchMode;
      try { launchMode = validateTeamMode(req.body?.mode || raw.mode); } catch { launchMode = 'sandbox'; }

      // If planner specified a project directory, create it and use it as workingDir
      // Production mode: always use projectDir directly, skip subdirectory creation
      let projectWorkingDir = baseDir;
      if (launchMode === 'production') {
        projectWorkingDir = daemon.projectDir;
        console.log(`[Groove] Production mode — working in project root: ${projectWorkingDir}`);
      } else if (projectDir) {
        // Sanitize: kebab-case, no path traversal
        const safeName = String(projectDir).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 64);
        projectWorkingDir = resolve(baseDir, safeName);
        mkdirSync(projectWorkingDir, { recursive: true });
        console.log(`[Groove] Project directory: ${projectWorkingDir}`);
      }

      function normalizeScope(patterns, baseDir) {
        if (!patterns || !Array.isArray(patterns)) return patterns;
        return patterns.map((p) => {
          if (typeof p === 'string' && p.startsWith('/')) {
            const rel = relative(baseDir, p);
            if (!rel.startsWith('..')) return rel;
            return p.slice(1);
          }
          return p;
        });
      }

      function resolveProviderAndModel(cfgProvider, cfgModel, fallbackProvider, fallbackModel) {
        const provider = cfgProvider || plannerProvider || daemon.config?.defaultProvider || fallbackProvider || undefined;
        if (cfgModel) return { provider, model: cfgModel };
        if (!cfgProvider && plannerProvider && plannerProvider !== daemon.config?.defaultProvider) {
          return { provider, model: plannerModel || 'auto' };
        }
        return { provider, model: daemon.config?.defaultModel || fallbackModel || 'auto' };
      }

      // Team-level overrides from the pre-planner config panel
      const teamProvider = req.body?.teamProvider || undefined;
      const teamModel = req.body?.teamModel || undefined;
      const teamReasoningEffort = req.body?.teamReasoningEffort != null ? Number(req.body.teamReasoningEffort) : undefined;
      const teamTemperature = req.body?.teamTemperature != null ? Number(req.body.teamTemperature) : undefined;
      const teamVerbosity = req.body?.teamVerbosity != null ? Number(req.body.teamVerbosity) : undefined;

      if (teamProvider || teamModel) {
        for (const c of agentConfigs) {
          if (teamProvider) c.provider = teamProvider;
          if (teamModel) c.model = teamModel;
          if (teamReasoningEffort !== undefined) c.reasoningEffort = teamReasoningEffort;
          if (teamTemperature !== undefined) c.temperature = teamTemperature;
          if (teamVerbosity !== undefined) c.verbosity = teamVerbosity;
        }
      }

      // Separate phase 1 (builders) and phase 2 (QC/finisher)
      const phase1 = agentConfigs.filter((a) => !a.phase || a.phase === 1);
      let phase2 = agentConfigs.filter((a) => a.phase === 2);

      // Safety net: if planner forgot the QC agent, auto-add one
      if (phase2.length === 0 && phase1.length >= 2) {
        const { provider: qcProvider, model: qcModel } = resolveProviderAndModel(teamProvider, teamModel);
        phase2 = [{
          name: 'qc-agent',
          role: 'fullstack', phase: 2, scope: [],
          provider: qcProvider,
          model: qcModel,
          prompt: 'QC Senior Dev: All builder agents have completed. Audit their changes for correctness, fix any issues, run tests, and verify the project builds cleanly (npm run build). Do NOT start long-running dev servers — just verify the build succeeds. Commit all changes. IMPORTANT: Do NOT delete files from other projects or directories outside this project.',
        }];
      }

      // Reset handoff cycle counters for this team so a fresh launch starts clean
      if (daemon._handoffCounts) {
        for (const key of [...daemon._handoffCounts.keys()]) {
          if (key.startsWith(`${defaultTeamId}:`)) daemon._handoffCounts.delete(key);
        }
      }

      // Spawn phase 1 agents — reuse idle team members with matching roles when possible
      const spawned = [];
      const reused = [];
      const failed = [];
      const phase1Ids = [];
      const teamAgents = daemon.registry.getAll().filter((a) => a.teamId === defaultTeamId);

      for (const config of phase1) {
        const prompt = config.prompt || '';

        // Reuse an existing agent with matching role in this team — never spawn
        // duplicates. The team's agents persist across tasks regardless of status.
        const existing = teamAgents.find((a) =>
          a.role === config.role &&
          a.role !== 'planner' &&
          !reused.some((r) => r.id === a.id)
        );

        if (existing) {
          // Role already exists in this team — never spawn a duplicate.
          // With a prompt: kill+respawn with fresh context and the new task.
          // Without a prompt: keep the existing agent as-is (the planner often
          // emits Mode-1 shaped JSON with empty prompts on follow-up; if we
          // let that fall through to "spawn new", we get 2 backends, 2 fronts).
          if (!prompt) {
            reused.push({ id: existing.id, name: existing.name, role: existing.role, reusedFrom: existing.name });
            phase1Ids.push(existing.id);
            continue;
          }
          try {
            if (existing.status === 'running' || existing.status === 'starting') {
              try { await daemon.processes.kill(existing.id); } catch { /* already dead */ }
            }
            daemon.registry.remove(existing.id);
            daemon.locks.release(existing.id);

            // Spawn fresh with the same name/team but new prompt + full context
            const validated = validateAgentConfig({
              role: existing.role,
              scope: normalizeScope(config.scope || existing.scope || [], existing.workingDir || projectWorkingDir),
              prompt,
              ...resolveProviderAndModel(config.provider, config.model, existing.provider, existing.model),
              permission: config.permission || existing.permission || 'auto',
              workingDir: existing.workingDir || projectWorkingDir,
              name: existing.name,
              integrationApproval: config.integrationApproval || existing.integrationApproval || undefined,
              reasoningEffort: config.reasoningEffort,
              temperature: config.temperature,
              verbosity: config.verbosity,
            });
            validated.teamId = defaultTeamId;
            const newAgent = await daemon.processes.spawn(validated);
            reused.push({ id: newAgent.id, name: newAgent.name, role: newAgent.role, reusedFrom: existing.name });
            phase1Ids.push(newAgent.id);
            daemon.audit.log('team.reuse', { oldId: existing.id, newId: newAgent.id, role: config.role });
          } catch (err) {
            failed.push({ role: config.role, error: `reuse failed: ${err.message}` });
          }
        } else {
          // No matching agent — spawn a new one
          try {
            const validated = validateAgentConfig({
              role: config.role,
              scope: normalizeScope(config.scope || [], config.workingDir || projectWorkingDir),
              prompt,
              ...resolveProviderAndModel(config.provider, config.model),
              permission: config.permission || 'auto',
              workingDir: config.workingDir || projectWorkingDir,
              name: config.name || undefined,
              integrationApproval: config.integrationApproval || undefined,
              reasoningEffort: config.reasoningEffort,
              temperature: config.temperature,
              verbosity: config.verbosity,
            });
            validated.teamId = defaultTeamId;
            const agent = await daemon.processes.spawn(validated);
            spawned.push({ id: agent.id, name: agent.name, role: agent.role });
            phase1Ids.push(agent.id);
          } catch (err) {
            failed.push({ role: config.role, error: err.message });
            console.log(`[Groove] Failed to spawn ${config.role}: ${err.message}`);
          }
        }
      }

      if (failed.length > 0) {
        console.warn(`[Groove] Team launch had ${failed.length} failure(s):`, failed.map((f) => `${f.role}: ${f.error}`).join(', '));
      }

      // Phase 2 agents also scoped to projectWorkingDir
      if (phase2.length > 0 && phase1Ids.length > 0) {
        // Dedup: if a running idle fullstack already exists in this team,
        // skip the phase2 queue — _triggerIdleQC will notify it when phase 1 completes
        const existingQC = teamAgents.find((a) =>
          a.role === 'fullstack' &&
          (a.status === 'running' || a.status === 'starting')
        );
        const qcIsIdle = existingQC && (daemon.journalist?.getAgentFiles(existingQC) || []).length === 0;

        if (existingQC && qcIsIdle) {
          daemon.audit.log('phase2.skipQueue', { existingQC: existingQC.id, name: existingQC.name, reason: 'idle fullstack exists' });
        } else {
          daemon._pendingPhase2 = daemon._pendingPhase2 || [];
          daemon._pendingPhase2.push({
            waitFor: phase1Ids,
            agents: phase2.map((c) => ({
              role: c.role, scope: c.scope || [], prompt: c.prompt || '',
              ...resolveProviderAndModel(c.provider, c.model),
              permission: c.permission || 'auto',
              reasoningEffort: c.reasoningEffort, temperature: c.temperature, verbosity: c.verbosity,
              workingDir: c.workingDir || projectWorkingDir,
              name: c.name || undefined,
              teamId: defaultTeamId,
            })),
          });
        }
      }

      // Stash the preview block so the daemon can launch it when the team
      // finishes. The plan file gets deleted seconds after this endpoint returns.
      if (previewBlock && daemon.preview && defaultTeamId) {
        daemon.preview.stashPlan(defaultTeamId, previewBlock, projectWorkingDir, maxPhase, agentConfigs);
      }

      // Restore the plan if nothing actually spawned or was reused — deleting
      // it on a total failure leaves the team with no recovery path. A failed
      // spawn (scope collision, provider unavailable, etc.) should be retryable
      // once the user fixes the condition.
      if (spawned.length === 0 && reused.length === 0 && failed.length > 0) {
        try { writeFileSync(planPath, planContents); } catch { /* best-effort */ }
      }

      daemon.audit.log('team.launch', {
        phase1: spawned.length, reused: reused.length, phase2Pending: phase2.length, failed: failed.length,
        agents: [...spawned, ...reused].map((a) => a.role), projectDir: projectDir || null, preview: !!previewBlock,
      });
      res.json({ launched: spawned.length, reused: reused.length, phase2Pending: phase2.length, agents: [...spawned, ...reused], failed, projectDir: projectDir || null, preview: previewBlock ? previewBlock.kind : null });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Team Templates ---

  const BUILT_IN_TEMPLATES = {
    'dev-team': {
      name: 'Dev Team', description: 'Frontend + Backend + QC', icon: 'code',
      roles: [{ role: 'frontend' }, { role: 'backend' }, { role: 'fullstack', phase: 2 }],
    },
    'full-stack': {
      name: 'Full Stack', description: 'Frontend, Backend, DevOps, Testing + QC', icon: 'layers',
      roles: [{ role: 'frontend' }, { role: 'backend' }, { role: 'devops' }, { role: 'testing' }, { role: 'fullstack', phase: 2 }],
    },
    'marketing': {
      name: 'Marketing', description: 'CMO, Creative, Analyst', icon: 'megaphone',
      roles: [{ role: 'cmo' }, { role: 'creative' }, { role: 'analyst' }],
    },
    'business': {
      name: 'Business', description: 'CFO, CMO, Analyst', icon: 'briefcase',
      roles: [{ role: 'cfo' }, { role: 'cmo' }, { role: 'analyst' }],
    },
    'security-audit': {
      name: 'Security Audit', description: 'Security, Backend + QC', icon: 'shield',
      roles: [{ role: 'security' }, { role: 'backend' }, { role: 'fullstack', phase: 2 }],
    },
    'docs': {
      name: 'Documentation', description: 'Docs + Frontend', icon: 'file-text',
      roles: [{ role: 'docs' }, { role: 'frontend' }],
    },
  };

  function getCustomTemplatesDir() {
    return resolve(homedir(), '.groove', 'team-templates');
  }

  function loadCustomTemplates() {
    const dir = getCustomTemplatesDir();
    if (!existsSync(dir)) return {};
    const templates = {};
    try {
      for (const file of readdirSync(dir).filter(f => f.endsWith('.json'))) {
        try {
          const data = JSON.parse(readFileSync(resolve(dir, file), 'utf8'));
          const key = file.replace(/\.json$/, '');
          templates[key] = { ...data, custom: true };
        } catch { /* skip malformed */ }
      }
    } catch { /* dir read failed */ }
    return templates;
  }

  app.get('/api/team-templates', (req, res) => {
    const custom = loadCustomTemplates();
    const all = {};
    for (const [k, v] of Object.entries(BUILT_IN_TEMPLATES)) {
      all[k] = { ...v, builtIn: true };
    }
    for (const [k, v] of Object.entries(custom)) {
      all[k] = v;
    }
    res.json(all);
  });

  app.post('/api/team-templates', (req, res) => {
    const { name, description, icon, roles, settings } = req.body || {};
    if (!name || typeof name !== 'string' || name.length > 64) {
      return res.status(400).json({ error: 'name is required (max 64 chars)' });
    }
    if (!Array.isArray(roles) || roles.length === 0) {
      return res.status(400).json({ error: 'roles array is required' });
    }
    const key = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64);
    if (!key) return res.status(400).json({ error: 'Invalid template name' });
    if (BUILT_IN_TEMPLATES[key]) {
      return res.status(409).json({ error: 'Cannot overwrite built-in template' });
    }
    const dir = getCustomTemplatesDir();
    mkdirSync(dir, { recursive: true });
    const template = { name, description: description || '', icon: icon || 'users', roles, settings: settings || {} };
    writeFileSync(resolve(dir, `${key}.json`), JSON.stringify(template, null, 2));
    daemon.audit.log('team-template.save', { key, roles: roles.length });
    res.status(201).json({ key, ...template, custom: true });
  });

  app.delete('/api/team-templates/:name', (req, res) => {
    const key = req.params.name;
    if (BUILT_IN_TEMPLATES[key]) {
      return res.status(403).json({ error: 'Cannot delete built-in template' });
    }
    const file = resolve(getCustomTemplatesDir(), `${key}.json`);
    if (!existsSync(file)) return res.status(404).json({ error: 'Template not found' });
    try {
      unlinkSync(file);
      daemon.audit.log('team-template.delete', { key });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Team Builder Launch ---

  app.post('/api/team-builder/launch', async (req, res) => {
    try {
      const { task, roles, settings, launchMode } = req.body || {};
      if (!Array.isArray(roles) || roles.length === 0) {
        return res.status(400).json({ error: 'roles array is required' });
      }
      const mode = launchMode || 'direct';
      const teamSettings = settings || {};
      const teamProvider = teamSettings.provider || daemon.config?.defaultProvider || undefined;
      const teamModel = teamSettings.model || daemon.config?.defaultModel || undefined;

      const defaultTeamId = req.body.teamId || daemon.teams.getDefault()?.id || null;
      const baseDir = daemon.config?.defaultWorkingDir || daemon.projectDir;

      if (mode === 'plan-first') {
        const rolesList = roles.map(r => r.role || r.name || r).join(', ');
        const providerNote = teamProvider ? ` (provider: ${teamProvider})` : '';
        let plannerPrompt;
        if (task) {
          plannerPrompt = `The user wants these agents: ${rolesList}${providerNote}. Task: ${task}`;
        } else {
          plannerPrompt = '';
        }
        const plannerConfig = validateAgentConfig({
          role: 'planner',
          prompt: plannerPrompt,
          provider: teamProvider,
          model: teamModel,
          workingDir: baseDir,
        });
        plannerConfig.teamId = defaultTeamId;
        plannerConfig.teamBuilderRoles = roles.map(r => ({ role: r.role || r, provider: r.provider || null }));
        const planner = await daemon.processes.spawn(plannerConfig);
        daemon.audit.log('team-builder.plan-first', { plannerId: planner.id, roles: roles.length });
        return res.status(202).json({ mode: 'plan-first', plannerId: planner.id, message: 'Planner spawned — waiting for user instructions' });
      }

      const spawned = [];
      const failed = [];
      const phase1Agents = roles.filter(r => !r.phase || r.phase === 1);
      const phase2Agents = roles.filter(r => r.phase === 2);
      const phase1Ids = [];

      for (const roleDef of phase1Agents) {
        try {
          let prompt = roleDef.prompt || '';
          if (task && mode === 'direct') {
            prompt = task + (prompt ? '\n\n' + prompt : '');
          }

          const agentConfig = validateAgentConfig({
            role: roleDef.role,
            name: roleDef.name || undefined,
            scope: roleDef.scope || [],
            prompt: mode === 'await' ? '' : prompt,
            provider: roleDef.provider || teamProvider,
            model: roleDef.model || teamModel,
            reasoningEffort: roleDef.reasoningEffort ?? teamSettings.reasoningEffort,
            temperature: roleDef.temperature ?? teamSettings.temperature,
            verbosity: roleDef.verbosity ?? teamSettings.verbosity,
            workingDir: baseDir,
          });
          agentConfig.teamId = defaultTeamId;
          const agent = await daemon.processes.spawn(agentConfig);
          spawned.push({ id: agent.id, name: agent.name, role: agent.role });
          phase1Ids.push(agent.id);
        } catch (err) {
          failed.push({ role: roleDef.role, error: err.message });
        }
      }

      if (phase2Agents.length > 0 && phase1Ids.length > 0) {
        daemon._pendingPhase2 = daemon._pendingPhase2 || [];
        daemon._pendingPhase2.push({
          waitFor: phase1Ids,
          agents: phase2Agents.map(r => ({
            role: r.role, scope: r.scope || [], prompt: r.prompt || '',
            provider: r.provider || teamProvider || daemon.config?.defaultProvider || undefined,
            model: r.model || teamModel || daemon.config?.defaultModel || 'auto',
            reasoningEffort: r.reasoningEffort ?? teamSettings.reasoningEffort,
            temperature: r.temperature ?? teamSettings.temperature,
            verbosity: r.verbosity ?? teamSettings.verbosity,
            workingDir: baseDir,
            name: r.name || undefined,
            teamId: defaultTeamId,
          })),
        });
      }

      daemon.audit.log('team-builder.launch', {
        mode, phase1: spawned.length, phase2Pending: phase2Agents.length,
        failed: failed.length, task: task ? task.slice(0, 100) : null,
      });
      res.json({
        mode, launched: spawned.length, phase2Pending: phase2Agents.length,
        agents: spawned, failed,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

}
