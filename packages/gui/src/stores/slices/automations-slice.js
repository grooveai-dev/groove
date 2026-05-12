// FSL-1.1-Apache-2.0 — see LICENSE

import { api } from '../../lib/api';

export const createAutomationsSlice = (set, get) => ({
  automations: [],
  automationWizardOpen: false,
  editingAutomationId: null,
  availableGateways: [],
  availableIntegrations: [],

  async fetchAutomations() {
    try {
      const data = await api.get('/schedules');
      set({ automations: data.schedules || data || [] });
    } catch { /* ignore */ }
  },

  async createAutomation(config) {
    try {
      await api.post('/schedules', config);
      get().addToast('success', 'Automation created');
      get().fetchAutomations();
      set({ automationWizardOpen: false, editingAutomationId: null });
    } catch (err) {
      get().addToast('error', 'Failed to create automation', err.message);
    }
  },

  async updateAutomation(id, updates) {
    try {
      await api.patch(`/schedules/${encodeURIComponent(id)}`, updates);
      get().addToast('success', 'Automation updated');
      get().fetchAutomations();
    } catch (err) {
      get().addToast('error', 'Failed to update automation', err.message);
    }
  },

  async deleteAutomation(id) {
    try {
      await api.delete(`/schedules/${encodeURIComponent(id)}`);
      get().addToast('info', 'Automation deleted');
      get().fetchAutomations();
    } catch (err) {
      get().addToast('error', 'Failed to delete automation', err.message);
    }
  },

  async toggleAutomation(id, currentEnabled) {
    try {
      const action = currentEnabled ? 'disable' : 'enable';
      await api.post(`/schedules/${encodeURIComponent(id)}/${action}`);
      get().fetchAutomations();
    } catch (err) {
      get().addToast('error', 'Failed to toggle automation', err.message);
    }
  },

  async runAutomation(id) {
    try {
      await api.post(`/schedules/${encodeURIComponent(id)}/run`);
      get().addToast('success', 'Automation triggered');
    } catch (err) {
      get().addToast('error', 'Failed to run automation', err.message);
    }
  },

  async duplicateAutomation(id) {
    try {
      await api.post(`/schedules/${encodeURIComponent(id)}/duplicate`);
      get().addToast('success', 'Automation duplicated');
      get().fetchAutomations();
    } catch (err) {
      get().addToast('error', 'Failed to duplicate automation', err.message);
    }
  },

  openAutomationWizard() { set({ automationWizardOpen: true }); },
  closeAutomationWizard() { set({ automationWizardOpen: false, editingAutomationId: null }); },
  setEditingAutomation(id) { set({ editingAutomationId: id }); },

  async fetchGateways() {
    try {
      const data = await api.get('/gateways');
      set({ availableGateways: data.gateways || data || [] });
    } catch { /* ignore */ }
  },

  async fetchInstalledIntegrations() {
    try {
      const data = await api.get('/integrations/installed');
      set({ availableIntegrations: data.integrations || data || [] });
    } catch { /* ignore */ }
  },
});
