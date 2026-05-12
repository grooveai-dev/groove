// FSL-1.1-Apache-2.0 — see LICENSE

import { loadJSON, persistJSON } from '../helpers.js';

let toastCounter = 0;

export const createUiSlice = (set, get) => ({
  // ── Navigation ────────────────────────────────────────────
  activeView: 'agents',           // 'agents' | 'editor' | 'dashboard' | 'marketplace' | 'teams' | 'settings'
  detailPanel: null,              // null | { type: 'agent', agentId } | { type: 'spawn' } | { type: 'journalist' }
  teamDetailPanels: {},            // { [teamId]: detailPanel } — persists panel state per team
  commandPaletteOpen: false,
  quickConnectOpen: false,
  upgradeModalOpen: false,

  // ── Node expansion (click-to-open persistent panels) ───────
  expandedNodes: loadJSON('groove:expandedNodes'),

  // ── Layout persistence ────────────────────────────────────
  detailPanelWidth: Number(localStorage.getItem('groove:detailWidth')) || 480,
  terminalVisible: localStorage.getItem('groove:terminalVisible') === 'true',
  terminalHeight: Number(localStorage.getItem('groove:terminalHeight')) || 260,
  terminalFullHeight: false,

  // ── Toasts ────────────────────────────────────────────────
  toasts: [],

  // ── Version / Auto-Update ──────────────────────────────────
  version: null,
  updateReady: null,
  updateProgress: null,
  updateModalOpen: false,

  // ── Navigation ────────────────────────────────────────────

  setActiveView(view) { set({ activeView: view }); },

  openDetail(descriptor) {
    const tid = get().activeTeamId;
    set((s) => ({ detailPanel: descriptor, teamDetailPanels: { ...s.teamDetailPanels, [tid]: descriptor } }));
  },
  closeDetail() {
    const tid = get().activeTeamId;
    set((s) => ({ detailPanel: null, teamDetailPanels: { ...s.teamDetailPanels, [tid]: null } }));
  },
  clearSelection() {
    const tid = get().activeTeamId;
    set((s) => ({ detailPanel: null, teamDetailPanels: { ...s.teamDetailPanels, [tid]: null } }));
  },
  toggleCommandPalette() { set((s) => ({ commandPaletteOpen: !s.commandPaletteOpen })); },
  toggleQuickConnect() { set((s) => ({ quickConnectOpen: !s.quickConnectOpen })); },
  setUpgradeModalOpen: (open) => set({ upgradeModalOpen: open }),

  setDetailPanelWidth(w) {
    set({ detailPanelWidth: w });
    localStorage.setItem('groove:detailWidth', String(w));
  },
  setTerminalVisible(v) {
    set({ terminalVisible: v });
    localStorage.setItem('groove:terminalVisible', String(v));
  },
  setTerminalHeight(h) {
    set({ terminalHeight: h });
    localStorage.setItem('groove:terminalHeight', String(h));
  },
  setTerminalFullHeight(v) { set({ terminalFullHeight: v }); },

  toggleNodeExpanded(id) {
    const expanded = { ...get().expandedNodes };
    expanded[id] = !expanded[id];
    if (!expanded[id]) delete expanded[id];
    set({ expandedNodes: expanded });
    persistJSON('groove:expandedNodes', expanded);
  },

  // ── Toasts ────────────────────────────────────────────────

  addToast(type, message, detail, action, options = {}) {
    const id = ++toastCounter;
    const persistent = !!options.persistent;
    const duration = options.duration;
    const actions = options.actions;
    set((s) => ({ toasts: [...s.toasts, { id, type, message, detail, action, actions, persistent, duration }] }));
  },
  removeToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },

  installUpdate() {
    window.groove?.update?.installUpdate();
  },
  setUpdateModalOpen(open) {
    set({ updateModalOpen: open });
  },
  checkForUpdate() {
    window.groove?.update?.checkForUpdate();
  },
});
