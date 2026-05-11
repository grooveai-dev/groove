// FSL-1.1-Apache-2.0 — see LICENSE

import { api } from '../../lib/api';

export const createPreviewSlice = (set, get) => ({
  // ── Preview ───────────────────────────────────────────────
  previewState: { url: null, teamId: null, kind: null, deviceSize: 'desktop', screenshotMode: false },
  showPreviewInAgents: false,
  previewChat: [],
  previewIterating: false,
  teamPreviews: {},

  // ── Preview Actions ───────────────────────────────────────

  async fetchActivePreviews() {
    try {
      const data = await api.get('/preview');
      const previews = data.previews || [];
      if (previews.length > 0) {
        const updates = {};
        for (const p of previews) {
          updates[p.teamId] = { url: `/api/preview/${p.teamId}/proxy/`, kind: p.kind, active: true };
        }
        const most = previews.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))[0];
        set((s) => ({
          teamPreviews: { ...s.teamPreviews, ...updates },
          previewState: { url: `/api/preview/${most.teamId}/proxy/`, teamId: most.teamId, kind: most.kind, deviceSize: 'desktop', screenshotMode: false },
          showPreviewInAgents: true,
        }));
      }
    } catch {}
  },

  openPreview(url, teamId, kind) {
    set((s) => ({
      previewState: { url, teamId, kind, deviceSize: 'desktop', screenshotMode: false },
      teamPreviews: { ...s.teamPreviews, [teamId]: { url, kind, active: true } },
      previewChat: [],
      showPreviewInAgents: true,
    }));
  },
  closePreview() {
    set({ showPreviewInAgents: false });
  },
  stopPreview() {
    const { previewState } = get();
    if (previewState.teamId) {
      api.delete(`/preview/${previewState.teamId}`).catch(() => {});
      set((s) => ({
        teamPreviews: {
          ...s.teamPreviews,
          [previewState.teamId]: { ...s.teamPreviews[previewState.teamId], active: false },
        },
        showPreviewInAgents: false,
      }));
    }
  },
  async relaunchPreview(teamId) {
    try {
      const result = await api.post(`/preview/${teamId}/launch`);
      if (result.launched) {
        const proxyUrl = `/api/preview/${teamId}/proxy/`;
        set((s) => ({
          previewState: { url: proxyUrl, teamId, kind: result.kind, deviceSize: 'desktop', screenshotMode: false },
          teamPreviews: { ...s.teamPreviews, [teamId]: { url: proxyUrl, kind: result.kind, active: true } },
          showPreviewInAgents: true,
        }));
      } else {
        get().addToast('warning', 'Preview could not launch', result.reason ? String(result.reason).slice(0, 200) : 'Build or server failed');
      }
    } catch (err) {
      get().addToast('error', 'Failed to launch preview', err.message);
    }
  },
  togglePreviewInAgents() {
    set((s) => ({ showPreviewInAgents: !s.showPreviewInAgents }));
  },
  setPreviewDevice(size) {
    set((s) => ({ previewState: { ...s.previewState, deviceSize: size } }));
  },
  toggleScreenshotMode() {
    set((s) => ({ previewState: { ...s.previewState, screenshotMode: !s.previewState.screenshotMode } }));
  },
  async iteratePreview(message, screenshotBase64) {
    const { previewState } = get();
    if (!previewState.teamId) return;

    const userMsg = { role: 'user', content: message, screenshot: screenshotBase64 || null, timestamp: Date.now() };
    set((s) => ({ previewChat: [...s.previewChat, userMsg], previewIterating: true }));

    try {
      const body = { message };
      if (screenshotBase64) body.screenshot = screenshotBase64;
      const res = await api.post(`/preview/${previewState.teamId}/iterate`, body);
      const assistantMsg = { role: 'assistant', content: res.response || res.message || 'Changes routed to planner.', timestamp: Date.now() };
      set((s) => ({ previewChat: [...s.previewChat, assistantMsg], previewIterating: false }));
    } catch (err) {
      const errMsg = { role: 'assistant', content: `Failed to iterate: ${err.message}`, timestamp: Date.now() };
      set((s) => ({ previewChat: [...s.previewChat, errMsg], previewIterating: false }));
    }
  },
  addPreviewChatMessage(role, content, screenshot) {
    const msg = { role, content, screenshot: screenshot || null, timestamp: Date.now() };
    set((s) => ({ previewChat: [...s.previewChat, msg] }));
  },
  clearPreviewChat() {
    set({ previewChat: [] });
  },
});
