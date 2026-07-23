// FSL-1.1-Apache-2.0 — see LICENSE

import { loadJSON, persistJSON } from '../helpers.js';

let toastCounter = 0;

export const createUiSlice = (set, get) => ({
  // ── Navigation ────────────────────────────────────────────
  activeView: 'agents',           // 'agents' | 'editor' | 'dashboard' | 'marketplace' | 'teams' | 'auto-agents' | 'settings'
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

  // ── Fleet View ─────────────────────────────────────────────
  fleetSelectedAgents: [null, null],
  fleetSplitMode: false,
  fleetSidebarWidth: Number(localStorage.getItem('groove:fleetSidebarWidth')) || 240,
  fleetSidebarCollapsed: {},
  fleetSearch: '',
  fleetUnreadMap: {},

  // ── Version / Auto-Update ──────────────────────────────────
  version: null,
  updateReady: null,
  updateProgress: null,
  updateModalOpen: false,

  // ── Navigation ────────────────────────────────────────────

  setActiveView(view) {
    const prev = get().activeView;
    const updates = { activeView: view };
    if (prev === 'fleet' && view !== 'fleet') {
      const sel = get().fleetSelectedAgents;
      const primaryId = sel[0] || sel[1];
      if (primaryId) {
        const tid = get().activeTeamId;
        const panel = { type: 'agent', agentId: primaryId };
        updates.detailPanel = panel;
        updates.teamDetailPanels = { ...get().teamDetailPanels, [tid]: panel };
      }
    }
    if (view === 'fleet' && prev !== 'fleet') {
      const dp = get().detailPanel;
      const sel = get().fleetSelectedAgents;
      if (!sel[0] && !sel[1] && dp?.type === 'agent' && dp.agentId) {
        updates.fleetSelectedAgents = [dp.agentId, null];
      }
      const tid = get().activeTeamId;
      updates.detailPanel = null;
      updates.teamDetailPanels = { ...get().teamDetailPanels, [tid]: null };
      const allCollapsed = {};
      for (const t of get().teams) allCollapsed[t.id] = true;
      updates.fleetSidebarCollapsed = allCollapsed;
    }
    set(updates);
  },

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
    const updates = { terminalVisible: v };
    // In fleet view, opening the terminal auto-opens the agent panel so the
    // terminal is constrained to the left column rather than spanning full width.
    if (v && get().activeView === 'fleet') {
      const selectedId = get().fleetSelectedAgents[0];
      if (selectedId && !get().detailPanel) {
        const tid = get().activeTeamId;
        const panel = { type: 'agent', agentId: selectedId };
        updates.detailPanel = panel;
        updates.teamDetailPanels = { ...get().teamDetailPanels, [tid]: panel };
      }
    }
    set(updates);
    localStorage.setItem('groove:terminalVisible', String(v));
  },

  // Cross-component channel for running a command in the terminal panel. The
  // terminal id lives inside the active TerminalInstance, so components can't
  // send to it directly — they drop a command here, the visible instance picks
  // it up (waiting for its PTY to be ready) and clears it.
  terminalPendingCommand: null,
  runInTerminal(command) {
    get().setTerminalVisible(true);
    set({ terminalPendingCommand: { command, ts: Date.now() } });
  },
  clearTerminalPendingCommand() { set({ terminalPendingCommand: null }); },
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

  // ── Fleet View ────────────────────────────────────────────

  fleetSelectAgent(agentId, pane = 0) {
    const selected = [...get().fleetSelectedAgents];
    selected[pane] = agentId;
    const updates = { fleetSelectedAgents: selected };
    if (pane === 1 && agentId !== null && !get().fleetSplitMode) {
      updates.fleetSplitMode = true;
    }
    if (pane === 1 && agentId === null) {
      updates.fleetSplitMode = false;
    }
    set(updates);
  },
  fleetToggleSplit() {
    const next = !get().fleetSplitMode;
    const selected = [...get().fleetSelectedAgents];
    if (!next) selected[1] = null;
    set({ fleetSplitMode: next, fleetSelectedAgents: selected });
  },
  fleetSetSidebarWidth(width) {
    const w = Math.max(180, Math.min(400, width));
    set({ fleetSidebarWidth: w });
    localStorage.setItem('groove:fleetSidebarWidth', String(w));
  },
  fleetToggleTeamCollapsed(teamId) {
    const collapsed = { ...get().fleetSidebarCollapsed };
    collapsed[teamId] = !collapsed[teamId];
    set({ fleetSidebarCollapsed: collapsed });
  },
  fleetSetSearch(text) { set({ fleetSearch: text }); },
  fleetMarkRead(agentId) {
    set((s) => ({ fleetUnreadMap: { ...s.fleetUnreadMap, [agentId]: Date.now() } }));
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
