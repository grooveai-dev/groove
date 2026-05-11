// FSL-1.1-Apache-2.0 — see LICENSE

import { api } from '../../lib/api';

export const createMarketplaceSlice = (set, get) => ({
  // ── Marketplace Auth ───────────────────────────────────────
  marketplaceUser: null,
  marketplaceAuthenticated: false,
  edition: 'community',
  subscription: {
    plan: 'community',
    status: 'none',
    active: false,
    features: [],
    seats: 1,
    periodEnd: null,
    cancelAtPeriodEnd: false,
  },

  // ── Training Data ──────────────────────────────────────────
  trainingOptIn: false,
  trainingStats: null,
  dataSharingDismissed: false,
  dataSharingModalOpen: false,

  // ── Project Directory ───────────────────────────────────────
  projectDir: null,
  recentProjects: [],
  showProjectPicker: false,

  // ── Tunnels ────────────────────────────────────────────────
  savedTunnels: [],
  tunnelConnectStep: null,

  // ── GitHub Repo Import ────────────────────────────────────
  importedRepos: [],
  importInProgress: false,

  // ── Gateways ──────────────────────────────────────────────
  gateways: [],

  // ── Onboarding ────────────────────────────────────────────
  onboardingComplete: localStorage.getItem('groove:onboardingComplete') === 'true',

  // ── Journalist ────────────────────────────────────────────
  journalistStatus: null,

  // ── Marketplace Auth Actions ──────────────────────────────

  async checkMarketplaceAuth() {
    try {
      const data = await api.get('/auth/status');
      set({
        marketplaceAuthenticated: data.authenticated || false,
        marketplaceUser: data.user || null,
      });
      try {
        const edition = await api.get('/edition');
        set({
          edition: edition.edition || 'community',
          subscription: {
            plan: edition.plan || 'community',
            status: edition.status || (edition.subscriptionActive ? 'active' : 'none'),
            active: edition.subscriptionActive === true,
            features: edition.features || [],
            seats: edition.seats || 1,
            periodEnd: edition.periodEnd || null,
            cancelAtPeriodEnd: edition.cancelAtPeriodEnd || false,
          },
        });
      } catch { /* edition endpoint may not exist */ }
    } catch {
      set({ marketplaceAuthenticated: false, marketplaceUser: null });
    }
  },

  async marketplaceLogin() {
    try {
      const data = await api.get('/auth/login-url');
      if (data.url) window.open(data.url, '_blank');
      const poll = setInterval(async () => {
        try {
          const status = await api.get('/auth/status');
          if (status.authenticated) {
            clearInterval(poll);
            set({ marketplaceAuthenticated: true, marketplaceUser: status.user });
            get().addToast('success', `Signed in as ${status.user?.displayName || status.user?.id || 'user'}`);
            try {
              const edition = await api.get('/edition');
              set({
                edition: edition.edition || 'community',
                subscription: {
                  plan: edition.plan || 'community',
                  status: edition.status || (edition.subscriptionActive ? 'active' : 'none'),
                  active: edition.subscriptionActive === true,
                  features: edition.features || [],
                  seats: edition.seats || 1,
                  periodEnd: edition.periodEnd || null,
                  cancelAtPeriodEnd: edition.cancelAtPeriodEnd || false,
                },
              });
            } catch { /* edition endpoint may not exist */ }
            setTimeout(async () => {
              try {
                const e = await api.get('/edition');
                set({
                  edition: e.edition || 'community',
                  subscription: {
                    plan: e.plan || 'community',
                    status: e.status || (e.subscriptionActive ? 'active' : 'none'),
                    active: e.subscriptionActive === true,
                    features: e.features || [],
                    seats: e.seats || 1,
                    periodEnd: e.periodEnd || null,
                    cancelAtPeriodEnd: e.cancelAtPeriodEnd || false,
                  },
                });
              } catch { /* delayed re-fetch may fail */ }
            }, 2000);
          }
        } catch { /* keep polling */ }
      }, 2000);
      setTimeout(() => clearInterval(poll), 300000);
    } catch (err) {
      get().addToast('error', 'Login failed', err.message);
    }
  },

  async marketplaceLogout() {
    try {
      await api.post('/auth/logout');
      set({ marketplaceAuthenticated: false, marketplaceUser: null });
      get().addToast('info', 'Signed out of marketplace');
    } catch (err) {
      get().addToast('error', 'Logout failed', err.message);
    }
  },

  async marketplaceCheckout(skillId) {
    try {
      const data = await api.post('/auth/checkout', { skillId });
      if (data.url) window.open(data.url, '_blank');
      return data;
    } catch (err) {
      get().addToast('error', 'Checkout failed', err.message);
      throw err;
    }
  },

  // ── Subscription ────────────────────────────────────────────

  async fetchSubscriptionPlans() {
    return api.get('/subscription/plans');
  },

  async startCheckout(priceId) {
    try {
      const data = await api.post('/subscription/checkout', { priceId });
      if (data.url) {
        if (window.groove?.openExternal) {
          window.groove.openExternal(data.url);
        } else {
          window.open(data.url, '_blank');
        }
      }
      return data;
    } catch (err) {
      if (err.status === 401 || err.message?.includes('Not authenticated')) {
        get().addToast('info', 'Please sign in to subscribe');
        get().marketplaceLogin();
      } else if (err.status === 409) {
        get().addToast('info', 'Already subscribed', 'Use Manage Subscription to switch plans');
      } else {
        get().addToast('error', 'Checkout failed', err.message);
      }
      throw err;
    }
  },

  async openPortal() {
    try {
      const data = await api.post('/subscription/portal');
      if (data.url) {
        if (window.groove?.openExternal) {
          window.groove.openExternal(data.url);
        } else {
          window.open(data.url, '_blank');
        }
      }
      return data;
    } catch (err) {
      get().addToast('error', 'Portal failed', err.message);
      throw err;
    }
  },

  async updateSeats(seats) {
    try {
      const data = await api.patch('/subscription', { seats });
      set({ subscription: { ...get().subscription, ...data } });
      get().addToast('success', `Updated to ${seats} seat${seats !== 1 ? 's' : ''}`);
      return data;
    } catch (err) {
      get().addToast('error', 'Seat update failed', err.message);
      throw err;
    }
  },

  // ── Training Data ─────────────────────────────────────────

  async setTrainingOptIn(enabled) {
    try {
      await api.post('/training/opt-in', { enabled });
      set({ trainingOptIn: enabled, dataSharingModalOpen: false });
      if (!enabled) set({ trainingStats: null });
    } catch (e) {
      get().addToast('error', 'Failed to update training preference', e.body?.detail || e.message);
    }
  },

  async fetchTrainingStatus() {
    try {
      const data = await api.get('/training/status');
      set({ trainingOptIn: data.optedIn, trainingStats: data });
    } catch { /* endpoint may not exist on older daemons */ }
  },

  async dismissDataSharingModal(permanent) {
    if (permanent) {
      try { await api.patch('/config', { dataSharingDismissed: true }); } catch {}
      set({ dataSharingDismissed: true, dataSharingModalOpen: false });
    } else {
      set({ dataSharingModalOpen: false });
    }
  },

  // ── Project Directory ────────────────────────────────────

  async fetchProjectDir() {
    try {
      const data = await api.get('/project-dir');
      const isHome = /^\/home\/[^/]+$/.test(data.projectDir) || data.projectDir === '/root';
      set({
        projectDir: data.projectDir,
        recentProjects: data.recentProjects || [],
        showProjectPicker: isHome || (data.recentProjects || []).length === 0,
        editorTreeCache: {},
      });
    } catch {}
  },

  async setProjectDir(path) {
    const data = await api.post('/project-dir', { path });
    try { await api.post('/files/root', { root: data.projectDir }); } catch {}
    set({
      projectDir: data.projectDir,
      recentProjects: data.recentProjects || [],
      showProjectPicker: false,
      editorTreeCache: {},
    });
    get().fetchTreeDir('');
  },

  async removeRecentProject(path) {
    try {
      await api.delete('/projects/recent', { path });
    } catch {}
    get().fetchProjectDir();
  },

  toggleProjectPicker() {
    set((s) => ({ showProjectPicker: !s.showProjectPicker }));
  },

  // ── Tunnels ──────────────────────────────────────────────

  async fetchTunnels() {
    try {
      const tunnels = await api.get('/tunnels');
      set({ savedTunnels: Array.isArray(tunnels) ? tunnels : [] });
    } catch {}
  },

  async saveTunnel(config) {
    const result = await api.post('/tunnels', config);
    get().fetchTunnels();
    return result;
  },

  async updateTunnel(id, config) {
    const result = await api.patch(`/tunnels/${encodeURIComponent(id)}`, config);
    get().fetchTunnels();
    return result;
  },

  async deleteTunnel(id) {
    await api.delete(`/tunnels/${encodeURIComponent(id)}`);
    get().fetchTunnels();
  },

  async testTunnel(id) {
    return api.post(`/tunnels/${encodeURIComponent(id)}/test`);
  },

  async connectTunnel(id) {
    try {
      const result = await api.post(`/tunnels/${encodeURIComponent(id)}/connect`);
      get().fetchTunnels();
      if (result.localPort && result.name) {
        if (window.groove?.remote?.openWindow) {
          window.groove.remote.openWindow(result.localPort, result.name);
        } else {
          window.open(`http://localhost:${result.localPort}?instance=${encodeURIComponent(result.name)}`, '_blank');
        }
      }
      return result;
    } finally {
      set({ tunnelConnectStep: null });
    }
  },

  async upgradeTunnel(id) {
    return api.post(`/tunnels/${encodeURIComponent(id)}/upgrade`);
  },

  async disconnectTunnel(id) {
    const tunnel = get().savedTunnels.find(t => t.id === id);
    await api.post(`/tunnels/${encodeURIComponent(id)}/disconnect`);
    get().fetchTunnels();
    if (tunnel?.localPort && window.groove?.remote?.closeByPort) {
      window.groove.remote.closeByPort(tunnel.localPort);
    }
  },

  async installTunnel(id) {
    return api.post(`/tunnels/${encodeURIComponent(id)}/install`);
  },

  async startTunnel(id) {
    return api.post(`/tunnels/${encodeURIComponent(id)}/start`);
  },

  // ── GitHub Repo Import ────────────────────────────────────

  async fetchImportedRepos() {
    try {
      const repos = await api.get('/repos/imported');
      set({ importedRepos: repos });
    } catch { /* ignore */ }
  },

  async previewRepo(repoUrl) {
    return api.post('/repos/preview', { repoUrl });
  },

  async importRepo(repoUrl, targetPath, createTeam, teamName) {
    set({ importInProgress: true });
    try {
      const result = await api.post('/repos/import', { repoUrl, targetPath, createTeam, teamName });
      get().fetchImportedRepos();
      return result;
    } finally {
      set({ importInProgress: false });
    }
  },

  async softRemoveRepo(importId) {
    await api.delete(`/repos/${encodeURIComponent(importId)}/remove`);
    get().fetchImportedRepos();
  },

  async hardNukeRepo(importId, deleteFiles = true) {
    await api.delete(`/repos/${encodeURIComponent(importId)}/nuke?deleteFiles=${deleteFiles}`);
    get().fetchImportedRepos();
  },

  // ── Journalist ────────────────────────────────────────────

  async fetchJournalist() {
    try {
      const data = await api.get('/journalist');
      set({ journalistStatus: data });
      return data;
    } catch { return null; }
  },

  async triggerJournalistCycle() {
    try {
      const data = await api.post('/journalist/cycle');
      get().addToast('success', 'Synthesis cycle triggered');
      set({ journalistStatus: data });
      return data;
    } catch (err) {
      get().addToast('error', 'Synthesis failed', err.message);
      throw err;
    }
  },

  // ── Onboarding ────────────────────────────────────────────

  async fetchOnboardingStatus() {
    try {
      const data = await api.get('/onboarding/status');
      if (data?.complete) {
        set({ onboardingComplete: true });
        localStorage.setItem('groove:onboardingComplete', 'true');
      }
      return data;
    } catch {
      return null;
    }
  },

  dismissOnboarding() {
    set({ onboardingComplete: true });
    localStorage.setItem('groove:onboardingComplete', 'true');
    api.post('/onboarding/dismiss').catch(() => {});
  },

  // ── Integration Agent Install ────────────────────────────

  async installViaExistingAgent(integration, agentId) {
    const message = buildIntegrationPrompt(integration);
    await get().instructAgent(agentId, message);
    get().setActiveView('agents');
    get().selectAgent(agentId);
  },

  async spawnIntegrationTeam(integration) {
    const team = await get().createTeam(integration.name);
    const prompt = buildIntegrationPrompt(integration);
    const agent = await get().spawnAgent({ role: 'planner', prompt, teamId: team.id });
    get().setActiveView('agents');
    get().selectAgent(agent.id);
    return agent;
  },
});

function buildIntegrationPrompt(integration) {
  const lines = [
    `Set up the "${integration.name}" integration for this project.`,
    '',
  ];
  if (integration.description) lines.push(`**Description:** ${integration.description}`);
  if (integration.npmPackage) lines.push(`**npm package:** ${integration.npmPackage}`);
  if (integration.authType) lines.push(`**Auth type:** ${integration.authType}`);
  if (integration.envKeys?.length) {
    lines.push('', '**Environment keys required:**');
    for (const k of integration.envKeys) {
      lines.push(`- \`${k.key}\` — ${k.label}${k.required ? ' (required)' : ''}`);
    }
  }
  if (integration.setupSteps?.length) {
    lines.push('', '**Setup steps:**');
    integration.setupSteps.forEach((step, i) => lines.push(`${i + 1}. ${step}`));
  }
  if (integration.setupUrl) lines.push(``, `**Setup URL:** ${integration.setupUrl}`);
  if (integration.agentInstructions) lines.push('', `**Agent instructions:** ${integration.agentInstructions}`);
  lines.push('', 'Follow the setup steps, configure environment keys, and verify the integration works.');
  return lines.join('\n');
}
