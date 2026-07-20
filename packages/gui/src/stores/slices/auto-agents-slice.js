// FSL-1.1-Apache-2.0 — see LICENSE

import { api } from '../../lib/api';

export const createAutoAgentsSlice = (set, get) => ({
  autoAgents: [],
  autoAgentWizardOpen: false,
  autoAgentWizardStep: 'chat',
  autoAgentSetupMessages: [],
  autoAgentSetupConfig: null,
  selectedAutoAgentId: null,

  async fetchAutoAgents() {
    try {
      const data = await api.get('/auto-agents');
      set({ autoAgents: Array.isArray(data) ? data : [] });
    } catch { /* ignore */ }
  },

  async createAutoAgent(config) {
    try {
      const result = await api.post('/auto-agents', config);
      get().addToast('success', 'Auto agent created');
      get().fetchAutoAgents();
      set({ autoAgentWizardOpen: false, autoAgentSetupMessages: [], autoAgentSetupConfig: null });
      return result;
    } catch (err) {
      get().addToast('error', 'Failed to create auto agent', err.message);
    }
  },

  async updateAutoAgent(id, updates) {
    try {
      await api.patch(`/auto-agents/${encodeURIComponent(id)}`, updates);
      get().fetchAutoAgents();
    } catch (err) {
      get().addToast('error', 'Failed to update', err.message);
    }
  },

  async deleteAutoAgent(id) {
    try {
      await api.delete(`/auto-agents/${encodeURIComponent(id)}`);
      get().addToast('info', 'Auto agent deleted');
      get().fetchAutoAgents();
      if (get().selectedAutoAgentId === id) set({ selectedAutoAgentId: null });
    } catch (err) {
      get().addToast('error', 'Failed to delete', err.message);
    }
  },

  async pauseAutoAgent(id) {
    try {
      await api.post(`/auto-agents/${encodeURIComponent(id)}/pause`);
      get().fetchAutoAgents();
    } catch (err) {
      get().addToast('error', 'Failed to pause', err.message);
    }
  },

  async resumeAutoAgent(id) {
    try {
      await api.post(`/auto-agents/${encodeURIComponent(id)}/resume`);
      get().fetchAutoAgents();
    } catch (err) {
      get().addToast('error', 'Failed to resume', err.message);
    }
  },

  async triggerAutoAgent(id) {
    try {
      const result = await api.post(`/auto-agents/${encodeURIComponent(id)}/trigger`);
      get().addToast('success', 'Iteration triggered');
      get().fetchAutoAgents();
      return result;
    } catch (err) {
      get().addToast('error', 'Failed to trigger', err.message);
    }
  },

  async fetchAutoAgentDetail(id) {
    try {
      return await api.get(`/auto-agents/${encodeURIComponent(id)}`);
    } catch { return null; }
  },

  async fetchAutoAgentJournal(id) {
    try {
      return await api.get(`/auto-agents/${encodeURIComponent(id)}/journal?limit=100`);
    } catch { return []; }
  },

  async fetchAutoAgentRuns(id) {
    try {
      return await api.get(`/auto-agents/${encodeURIComponent(id)}/runs?limit=30`);
    } catch { return []; }
  },

  async fetchAutoAgentRoadmap(id) {
    try {
      const res = await fetch(`/api/auto-agents/${encodeURIComponent(id)}/roadmap`);
      return await res.text();
    } catch { return ''; }
  },

  async fetchAutoAgentPrompt(id) {
    try {
      const res = await fetch(`/api/auto-agents/${encodeURIComponent(id)}/prompt`);
      return await res.text();
    } catch { return ''; }
  },

  async updateAutoAgentPrompt(id, content) {
    try {
      await api.put(`/auto-agents/${encodeURIComponent(id)}/prompt`, { content });
      get().addToast('success', 'Prompt updated');
    } catch (err) {
      get().addToast('error', 'Failed to update prompt', err.message);
    }
  },

  async updateAutoAgentRoadmap(id, content) {
    try {
      await api.put(`/auto-agents/${encodeURIComponent(id)}/roadmap`, { content });
      get().addToast('success', 'Roadmap updated');
    } catch (err) {
      get().addToast('error', 'Failed to update roadmap', err.message);
    }
  },

  openAutoAgentWizard() {
    set({
      autoAgentWizardOpen: true,
      autoAgentWizardStep: 'chat',
      autoAgentSetupMessages: [],
      autoAgentSetupConfig: null,
    });
  },
  closeAutoAgentWizard() {
    set({ autoAgentWizardOpen: false, autoAgentSetupMessages: [], autoAgentSetupConfig: null });
  },
  selectAutoAgent(id) { set({ selectedAutoAgentId: id }); },

  addAutoAgentSetupMessage(msg) {
    set((s) => ({ autoAgentSetupMessages: [...s.autoAgentSetupMessages, msg] }));
  },
  setAutoAgentSetupConfig(config) { set({ autoAgentSetupConfig: config }); },
  setAutoAgentWizardStep(step) { set({ autoAgentWizardStep: step }); },
});
