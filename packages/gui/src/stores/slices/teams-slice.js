// FSL-1.1-Apache-2.0 — see LICENSE

import { api } from '../../lib/api';

export const createTeamsSlice = (set, get) => ({
  // ── Teams ─────────────────────────────────────────────────
  teams: [],
  archivedTeams: [],
  activeTeamId: localStorage.getItem('groove:activeTeamId') || null,

  // ── Team Launch Config (set during planner spawn, cascades to team) ──
  teamLaunchConfig: null, // { provider, model, reasoningEffort, temperature, verbosity, mode }

  // ── Team Builder ──────────────────────────────────────────
  teamBuilderOpen: false,
  teamBuilderRoles: [],
  teamBuilderSettings: { provider: null, model: null, reasoningEffort: 50, temperature: 0.5 },
  teamBuilderTask: '',
  teamTemplates: { builtIn: [], custom: [] },

  // ── Recommended Team ──────────────────────────────────────
  recommendedTeam: null,  // { name, agents: [...] } from planner
  _delegatingTeamIds: new Set(),

  // ── Teams ─────────────────────────────────────────────────

  async fetchTeams() {
    try {
      const data = await api.get('/teams');
      let teams = data.teams || [];
      const defaultTeamId = data.defaultTeamId;
      try {
        const saved = JSON.parse(localStorage.getItem('groove:teamOrder') || '[]');
        if (saved.length) {
          const byId = Object.fromEntries(teams.map((t) => [t.id, t]));
          const ordered = saved.filter((id) => byId[id]).map((id) => byId[id]);
          const remaining = teams.filter((t) => !saved.includes(t.id));
          teams = [...ordered, ...remaining];
        }
      } catch {}
      const { activeTeamId } = get();
      const ids = teams.map((t) => t.id);
      const resolved = ids.includes(activeTeamId) ? activeTeamId : defaultTeamId;
      set({ teams, activeTeamId: resolved });
      if (resolved) localStorage.setItem('groove:activeTeamId', resolved);
    } catch { /* ignore */ }
  },

  switchTeam(id) {
    const { activeTeamId, detailPanel, teamDetailPanels, teamPreviews } = get();
    const updated = { ...teamDetailPanels };
    if (activeTeamId) updated[activeTeamId] = detailPanel;
    const restored = updated[id] || null;
    const tp = teamPreviews[id];
    const previewUpdate = tp
      ? { previewState: { url: tp.url, teamId: id, kind: tp.kind, deviceSize: 'desktop', screenshotMode: false } }
      : {};
    set({ activeTeamId: id, detailPanel: restored, teamDetailPanels: updated, ...previewUpdate });
    localStorage.setItem('groove:activeTeamId', id);
  },

  async createTeam(name, workingDir, mode) {
    try {
      const body = { name };
      if (workingDir) body.workingDir = workingDir;
      if (mode) body.mode = mode;
      const team = await api.post('/teams', body);
      // Only set activeTeamId — the WS team:created handler adds to the teams array
      set({ activeTeamId: team.id });
      localStorage.setItem('groove:activeTeamId', team.id);
      get().addToast('success', `Team "${name}" created`);
      return team;
    } catch (err) {
      get().addToast('error', 'Failed to create team', err.message);
      throw err;
    }
  },

  async archiveTeam(id) {
    const team = get().teams.find((t) => t.id === id);
    try {
      await api.delete(`/teams/${encodeURIComponent(id)}`);
      const wiped = team?.isDefault ? 'wiped' : 'archived';
      get().addToast('success', `Team "${team?.name}" ${wiped}`, wiped === 'archived' ? 'Files preserved — restore anytime from Archived Teams' : undefined);
      get().fetchArchivedTeams();
    } catch (err) {
      get().addToast('error', 'Failed to archive team', err.message);
    }
  },

  async deleteTeamPermanently(id) {
    const team = get().teams.find((t) => t.id === id);
    try {
      await api.delete(`/teams/${encodeURIComponent(id)}?permanent=true`);
      get().addToast('success', `Team "${team?.name}" permanently deleted`);
    } catch (err) {
      get().addToast('error', 'Failed to delete team', err.message);
    }
  },

  async deleteTeam(id) {
    return get().archiveTeam(id);
  },

  reorderTeams(fromIndex, toIndex) {
    const teams = [...get().teams];
    const [moved] = teams.splice(fromIndex, 1);
    teams.splice(toIndex, 0, moved);
    set({ teams });
    try { localStorage.setItem('groove:teamOrder', JSON.stringify(teams.map((t) => t.id))); } catch {}
  },

  async fetchArchivedTeams() {
    try {
      const data = await api.get('/teams/archived');
      set({ archivedTeams: data.archived || data.teams || [] });
    } catch { /* endpoint may not exist yet */ }
  },

  async restoreTeam(archivedId) {
    try {
      await api.post(`/teams/archived/${encodeURIComponent(archivedId)}/restore`);
      get().addToast('success', 'Team restored');
      get().fetchArchivedTeams();
    } catch (err) {
      get().addToast('error', 'Failed to restore team', err.message);
    }
  },

  async purgeTeam(archivedId) {
    try {
      await api.delete(`/teams/archived/${encodeURIComponent(archivedId)}`);
      get().addToast('info', 'Archived team permanently deleted');
      get().fetchArchivedTeams();
    } catch (err) {
      get().addToast('error', 'Failed to purge team', err.message);
    }
  },

  async cloneTeam(id) {
    const team = get().teams.find((t) => t.id === id);
    if (!team) return;
    const sourceAgents = get().agents.filter((a) => a.teamId === id);
    try {
      const newTeam = await api.post('/teams', { name: `${team.name} (copy)` });
      set({ activeTeamId: newTeam.id });
      localStorage.setItem('groove:activeTeamId', newTeam.id);
      for (const agent of sourceAgents) {
        await api.post('/agents', {
          role: agent.role,
          name: agent.name,
          provider: agent.provider,
          model: agent.model,
          scope: agent.scope,
          teamId: newTeam.id,
        });
      }
      get().addToast('success', `Cloned "${team.name}" with ${sourceAgents.length} agent${sourceAgents.length !== 1 ? 's' : ''}`);
      return newTeam;
    } catch (err) {
      get().addToast('error', 'Failed to clone team', err.message);
    }
  },

  async renameTeam(id, name) {
    try {
      const team = await api.patch(`/teams/${encodeURIComponent(id)}`, { name });
      set((s) => ({ teams: s.teams.map((t) => (t.id === id ? team : t)) }));
      return team;
    } catch (err) {
      get().addToast('error', 'Failed to rename team', err.message);
      throw err;
    }
  },

  async promoteTeam(id) {
    try {
      const team = await api.post(`/teams/${encodeURIComponent(id)}/promote`);
      set((s) => ({ teams: s.teams.filter((t) => t.id !== id) }));
      get().addToast('success', 'Team promoted — files moved to project directory');
      return team;
    } catch (err) {
      get().addToast('error', 'Failed to promote team', err.message);
      throw err;
    }
  },

  // ── Recommended Team ──────────────────────────────────────

  async checkRecommendedTeam() {
    try {
      const data = await api.get('/recommended-team');
      if (!data || !data.agents?.length) {
        set({ recommendedTeam: null });
        return;
      }

      // Check if all recommended roles already exist in the planner's team.
      // If so, auto-delegate instead of showing the "Launch Team" modal.
      const teamId = data.teamId || null;

      if (teamId) {
        const teamAgents = get().agents.filter((a) => a.teamId === teamId && a.role !== 'planner');
        const phase1Roles = data.agents.filter((a) => !a.phase || a.phase === 1).map((a) => a.role);
        const allExist = phase1Roles.every((role) => teamAgents.some((a) => a.role === role));

        if (allExist && phase1Roles.length > 0) {
          // Guard: skip if already delegating for this team (poll race)
          if (get()._delegatingTeamIds.has(teamId)) return;
          set((s) => ({ recommendedTeam: null, _delegatingTeamIds: new Set([...s._delegatingTeamIds, teamId]) }));
          try {
            const tlc = get().teamLaunchConfig;
            const result = await api.post('/recommended-team/launch', {
              teamId,
              ...(tlc?.provider && { teamProvider: tlc.provider }),
              ...(tlc?.model && { teamModel: tlc.model }),
              ...(tlc?.reasoningEffort != null && { teamReasoningEffort: tlc.reasoningEffort }),
              ...(tlc?.temperature != null && { teamTemperature: tlc.temperature }),
            });
            const agents = result.agents || [];
            const failures = result.failed || [];
            const names = agents.map((a) => a.name).join(', ') || '';

            if (agents.length === 0 && failures.length > 0) {
              get().addToast('error', 'Delegation failed', failures.map(f => f.role + ': ' + f.error).join(', '));
            } else {
              get().addToast('success', 'Planner delegated work', names ? `→ ${names}` : undefined);
              if (failures.length > 0) {
                get().addToast('warning', `${failures.length} agent(s) failed to spawn`, failures.map(f => f.role + ': ' + f.error).join(', '));
              }
            }
            if (agents.length > 0) {
              set((s) => ({
                thinkingAgents: new Set([...s.thinkingAgents, ...agents.map((a) => a.id)]),
              }));
            }
          } finally {
            set((s) => {
              const next = new Set(s._delegatingTeamIds);
              next.delete(teamId);
              return { _delegatingTeamIds: next };
            });
          }
          return;
        }
      }

      // New agents needed — show the modal for approval
      set({ recommendedTeam: { ...data, teamId: data.teamId || null } });
    } catch {
      set({ recommendedTeam: null });
    }
  },

  async launchRecommendedTeam(modifiedAgents) {
    try {
      const teamId = get().recommendedTeam?.teamId || null;
      const tlc = get().teamLaunchConfig;
      set({ recommendedTeam: null }); // Dismiss modal immediately
      get().addToast('info', 'Launching team...');
      const body = {
        ...(modifiedAgents && { agents: modifiedAgents }),
        ...(teamId && { teamId }),
        ...(tlc?.provider && { teamProvider: tlc.provider }),
        ...(tlc?.model && { teamModel: tlc.model }),
        ...(tlc?.reasoningEffort != null && { teamReasoningEffort: tlc.reasoningEffort }),
        ...(tlc?.temperature != null && { teamTemperature: tlc.temperature }),
        ...(tlc?.verbosity != null && { teamVerbosity: tlc.verbosity }),
      };
      const result = await api.post('/recommended-team/launch', body);
      const totalOk = (result.launched || 0) + (result.reused || 0);
      const failures = result.failed || [];

      if (totalOk === 0 && failures.length > 0) {
        get().addToast('error', 'Team launch failed', failures.map(f => f.role + ': ' + f.error).join(', '));
      } else {
        const sub = [
          result.phase2Pending ? `${result.phase2Pending} QC queued` : '',
          result.projectDir ? `→ ${result.projectDir}/` : '',
        ].filter(Boolean).join(' · ');
        get().addToast('success', `Launched ${totalOk} agents`, sub || undefined);
        if (failures.length > 0) {
          get().addToast('warning', `${failures.length} agent(s) failed to spawn`, failures.map(f => f.role + ': ' + f.error).join(', '));
        }
      }
      // Set thinking indicator for all launched/reused agents
      const launchedAgents = result.agents || [];
      if (launchedAgents.length > 0) {
        set((s) => ({
          thinkingAgents: new Set([...s.thinkingAgents, ...launchedAgents.map((a) => a.id)]),
        }));
      }
      // Clean up stale files — scoped to the launched team so plans in other
      // teams' workspaces survive. The launch endpoint already unlinks the
      // exact plan it read; this is a belt-and-suspenders sweep.
      const launchedTeamId = body?.teamId || result?.teamId || null;
      if (launchedTeamId) {
        api.post('/cleanup', { teamId: launchedTeamId }).catch(() => {});
      }
      return result;
    } catch (err) {
      get().addToast('error', 'Launch failed', err.message);
      throw err;
    }
  },

  // ── Team Builder ──────────────────────────────────────────

  openTeamBuilder() { set({ teamBuilderOpen: true }); },
  closeTeamBuilder() {
    set({
      teamBuilderOpen: false,
      teamBuilderRoles: [],
      teamBuilderSettings: { provider: null, model: null, reasoningEffort: 50, temperature: 0.5 },
      teamBuilderTask: '',
    });
  },
  addTeamBuilderRole(role) {
    set((s) => ({
      teamBuilderRoles: [...s.teamBuilderRoles, {
        role, name: '', provider: null, model: null,
        reasoningEffort: null, temperature: null, prompt: '',
      }],
    }));
  },
  removeTeamBuilderRole(index) {
    set((s) => ({ teamBuilderRoles: s.teamBuilderRoles.filter((_, i) => i !== index) }));
  },
  updateTeamBuilderRole(index, updates) {
    set((s) => ({
      teamBuilderRoles: s.teamBuilderRoles.map((r, i) => i === index ? { ...r, ...updates } : r),
    }));
  },
  applyTemplate(template) {
    set({
      teamBuilderRoles: (template.roles || []).map((r) => ({
        role: typeof r === 'string' ? r : r.role,
        name: '', provider: null, model: null,
        reasoningEffort: null, temperature: null, prompt: '',
      })),
    });
  },
  setTeamBuilderSettings(settings) {
    set((s) => ({ teamBuilderSettings: { ...s.teamBuilderSettings, ...settings } }));
  },
  setTeamBuilderTask(task) { set({ teamBuilderTask: task }); },

  async fetchTeamTemplates() {
    try {
      const data = await api.get('/team-templates');
      const builtIn = [];
      const custom = [];
      for (const [key, tmpl] of Object.entries(data || {})) {
        const entry = { ...tmpl, name: key };
        if (tmpl.builtIn) builtIn.push(entry);
        else custom.push(entry);
      }
      set({ teamTemplates: { builtIn, custom } });
    } catch { /* endpoint may not exist yet */ }
  },

  async saveTeamTemplate(name) {
    try {
      const { teamBuilderRoles, teamBuilderSettings } = get();
      await api.post('/team-templates', {
        name,
        roles: teamBuilderRoles.map((r) => r.role),
        settings: teamBuilderSettings,
      });
      get().addToast('success', `Template "${name}" saved`);
      get().fetchTeamTemplates();
    } catch (err) {
      get().addToast('error', 'Failed to save template', err.message);
    }
  },

  async deleteTeamTemplate(name) {
    try {
      await api.delete(`/team-templates/${encodeURIComponent(name)}`);
      get().addToast('info', `Template "${name}" deleted`);
      get().fetchTeamTemplates();
    } catch (err) {
      get().addToast('error', 'Failed to delete template', err.message);
    }
  },

  async launchTeamBuilder() {
    const { teamBuilderRoles, teamBuilderSettings, teamBuilderTask, activeTeamId } = get();
    if (teamBuilderRoles.length === 0) return;
    set({ teamLaunchConfig: {
      provider: teamBuilderSettings.provider || null,
      model: teamBuilderSettings.model || null,
      reasoningEffort: teamBuilderSettings.reasoningEffort,
      temperature: teamBuilderSettings.temperature,
    }});
    get().closeTeamBuilder();
    try {
      const body = {
        task: teamBuilderTask,
        roles: teamBuilderRoles,
        settings: teamBuilderSettings,
        launchMode: 'plan-first',
        teamId: activeTeamId,
      };
      const result = await api.post('/team-builder/launch', body);
      get().addToast('success', 'Planner spawned — team will build automatically');
      return result;
    } catch (err) {
      get().addToast('error', 'Team launch failed', err.message);
      throw err;
    }
  },
});
