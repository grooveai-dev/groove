// GROOVE GUI v2 — Zustand Store
// FSL-1.1-Apache-2.0 — see LICENSE

import { create } from 'zustand';
import { api } from '../lib/api';

const WS_URL = `ws://${window.location.hostname}:${window.location.port || 31415}`;

let toastCounter = 0;
let plannerPollInterval = null;

function loadJSON(key, fallback = {}) {
  try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); }
  catch { return fallback; }
}

function persistJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota */ }
}

// Clear stale persisted data on version change
const STORE_VERSION = '0.22.28';
if (loadJSON('groove:storeVersion') !== STORE_VERSION) {
  localStorage.removeItem('groove:chatHistory');
  localStorage.removeItem('groove:activityLog');
  persistJSON('groove:storeVersion', STORE_VERSION);
}

export const useGrooveStore = create((set, get) => ({
  // ── Connection ────────────────────────────────────────────
  agents: [],
  connected: false,
  hydrated: false,  // true after first WS state message — gates the UI to prevent flicker
  ws: null,
  daemonHost: null,
  tunneled: false,

  // ── Teams ─────────────────────────────────────────────────
  teams: [],
  activeTeamId: localStorage.getItem('groove:activeTeamId') || null,

  // ── Gateways ──────────────────────────────────────────────
  gateways: [],

  // ── Federation ────────────────────────────────────────────
  federation: {
    peers: [],
    whitelist: [],
    connections: [],
    pouchLog: [],
    ambassadors: [],
    selectedPeerId: null,
  },

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

  // ── Agent data ────────────────────────────────────────────
  activityLog: loadJSON('groove:activityLog'),
  chatHistory: loadJSON('groove:chatHistory'),
  chatInputs: {},   // Per-agent draft input text — persists across tab switches
  tokenTimeline: {},

  // ── Approvals ─────────────────────────────────────────────
  pendingApprovals: [],
  resolvedApprovals: [],

  // ── Recommended Team ──────────────────────────────────────
  recommendedTeam: null,  // { name, agents: [...] } from planner
  _delegatingTeamIds: new Set(),

  // ── Journalist ────────────────────────────────────────────
  journalistStatus: null, // { cycleCount, lastCycleTime, history, lastSynthesis }

  // ── Network (Early Access) ────────────────────────────────
  networkUnlocked: false,
  networkInstalled: false,
  networkInstallProgress: { installing: false, step: null, message: null, percent: 0, error: null },
  networkNode: { active: false, status: 'disconnected', nodeId: null, layers: null, model: null, sessions: 0, hardware: null },
  networkStatus: { nodes: [], coverage: 0, totalLayers: 0, models: [], activeSessions: 0 },
  networkEvents: [],

  // ── Marketplace Auth ───────────────────────────────────────
  marketplaceUser: null,        // { id, displayName, avatar, ... } or null
  marketplaceAuthenticated: false,
  edition: 'community',         // 'community' | 'pro' — runtime edition from /edition
  subscription: {
    plan: 'community',
    status: 'none',
    active: false,
    features: [],
    seats: 1,
    periodEnd: null,
    cancelAtPeriodEnd: false,
  },

  // ── Version / Auto-Update ──────────────────────────────────
  version: null,
  updateReady: null,

  // ── Toasts ────────────────────────────────────────────────
  toasts: [],

  // ── Project Directory ───────────────────────────────────────
  projectDir: null,
  recentProjects: [],
  showProjectPicker: false,

  // ── Tunnels ────────────────────────────────────────────────
  savedTunnels: [],
  activeTunnelId: null,

  // ── GitHub Repo Import ────────────────────────────────────
  importedRepos: [],
  importInProgress: false,

  // ── Editor state ──────────────────────────────────────────
  editorFiles: {},
  editorActiveFile: null,
  editorOpenTabs: [],
  editorTreeCache: {},
  editorChangedFiles: {},
  editorRecentSaves: {},
  editorSidebarWidth: Number(localStorage.getItem('groove:editorSidebarWidth')) || 240,

  // ── Onboarding ────────────────────────────────────────────
  onboardingComplete: localStorage.getItem('groove:onboardingComplete') === 'true',

  // ── Connection ────────────────────────────────────────────

  connect() {
    if (get().ws) return;
    const ws = new WebSocket(WS_URL);
    set({ ws }); // Claim slot immediately to prevent StrictMode double-connect

    ws.onopen = () => {
      set({ connected: true });
      api.get('/status').then((s) => {
        const updates = {};
        if (s.host && s.host !== '127.0.0.1') updates.daemonHost = s.host;
        const browserPort = window.location.port || '80';
        const isTunneled = String(s.port) !== browserPort;
        if (isTunneled) updates.tunneled = true;
        if (s.version) updates.version = s.version;
        if (Object.keys(updates).length > 0) set(updates);
        if (isTunneled) get().fetchProjectDir();
      }).catch(() => {});
      get().fetchTeams();
      get().fetchApprovals();
      get().checkMarketplaceAuth();
      get().fetchTunnels();
      get().fetchBetaStatus();
      get().fetchNetworkInstallStatus();
      if (!get().onboardingComplete) get().fetchOnboardingStatus();
      if (window.groove?.auth?.onSubscriptionStatus) {
        window.groove.auth.onSubscriptionStatus((data) => {
          if (data) set({ subscription: { ...get().subscription, ...data } });
        });
      }
      if (window.groove?.update?.onUpdateDownloaded) {
        window.groove.update.onUpdateDownloaded((data) => {
          set({ updateReady: data.version });
          get().addToast('info', 'Update available', `v${data.version} downloaded — restart to apply`);
        });
      }
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (!msg || typeof msg !== 'object' || Object.hasOwn(msg, '__proto__') || Object.hasOwn(msg, 'constructor')) return;
      switch (msg.type) {
        case 'state': {
          const timeline = { ...get().tokenTimeline };
          const now = Date.now();
          const liveIds = new Set(msg.data.map((a) => a.id));
          for (const agent of msg.data) {
            if (!timeline[agent.id]) timeline[agent.id] = [];
            const arr = timeline[agent.id];
            const last = arr[arr.length - 1];
            if (!last || agent.tokensUsed !== last.v || now - last.t > 5000) {
              arr.push({ t: now, v: agent.tokensUsed || 0 });
              if (arr.length > 200) timeline[agent.id] = arr.slice(-200);
            }
          }
          // Prune stale tokenTimeline (high-volume metrics, safe to drop).
          // chatHistory and activityLog are NOT pruned here — they must survive
          // the gap between registry.remove() and rotation:complete so the
          // rotation handler can migrate them to the new agent ID.  Explicit
          // cleanup happens in killAgent(purge=true) and rotation:complete.
          const st = get();
          for (const id of Object.keys(timeline)) if (!liveIds.has(id)) delete timeline[id];
          // Only replace agents array if something meaningful changed
          // (prevents React Flow tree flicker on every lastActivity update)
          const prev = st.agents;
          const changed = msg.data.length !== prev.length || msg.data.some((a, i) => {
            const p = prev[i];
            return !p || p.id !== a.id || p.status !== a.status || p.tokensUsed !== a.tokensUsed
              || p.contextUsage !== a.contextUsage || p.name !== a.name || p.model !== a.model;
          });
          set({ agents: changed ? msg.data : prev, tokenTimeline: timeline, hydrated: true });

          // Poll for recommended-team.json while a planner is running
          const hasRunningPlanner = msg.data.some((a) => a.role === 'planner' && a.status === 'running');
          if (hasRunningPlanner && !plannerPollInterval && !get().recommendedTeam) {
            plannerPollInterval = setInterval(() => {
              if (get().recommendedTeam) {
                clearInterval(plannerPollInterval);
                plannerPollInterval = null;
                return;
              }
              get().checkRecommendedTeam();
            }, 3000);
          } else if ((!hasRunningPlanner || get().recommendedTeam) && plannerPollInterval) {
            clearInterval(plannerPollInterval);
            plannerPollInterval = null;
          }
          break;
        }

        case 'state:delta': {
          const { changed = [], removed = [] } = msg.data || {};
          const st = get();
          let agents = st.agents;
          if (removed.length > 0) {
            const removedSet = new Set(removed);
            agents = agents.filter((a) => !removedSet.has(a.id));
          }
          if (changed.length > 0) {
            const changedMap = new Map(changed.map((a) => [a.id, a]));
            let found = 0;
            agents = agents.map((a) => {
              const upd = changedMap.get(a.id);
              if (upd) { found++; return upd; }
              return a;
            });
            // New agents not yet in the list
            if (found < changed.length) {
              for (const a of changed) {
                if (!agents.some((ex) => ex.id === a.id)) agents.push(a);
              }
            }
          }
          const timeline = { ...st.tokenTimeline };
          const now = Date.now();
          for (const agent of changed) {
            if (!timeline[agent.id]) timeline[agent.id] = [];
            const arr = timeline[agent.id];
            const last = arr[arr.length - 1];
            if (!last || agent.tokensUsed !== last.v || now - last.t > 5000) {
              arr.push({ t: now, v: agent.tokensUsed || 0 });
              if (arr.length > 200) timeline[agent.id] = arr.slice(-200);
            }
          }
          for (const id of removed) delete timeline[id];
          set({ agents, tokenTimeline: timeline, hydrated: true });
          break;
        }

        case 'agent:output': {
          const { agentId, data } = msg;

          // Separate text content from tool calls
          let chatText = '';
          let activityText = '';
          if (typeof data.data === 'string') {
            chatText = data.data;
          } else if (Array.isArray(data.data)) {
            chatText = data.data.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
            activityText = data.data.filter((b) => b.type === 'tool_use').map((b) => `${b.name}: ${typeof b.input === 'string' ? b.input.slice(0, 80) : (b.input?.command || b.input?.path || b.input?.pattern || JSON.stringify(b.input || '').slice(0, 80))}`).join('\n');
          }

          // Update agent metrics in real-time (contextUsage, tokensUsed)
          if (data.contextUsage !== undefined || data.tokensUsed !== undefined) {
            const agents = get().agents.map((a) => {
              if (a.id !== agentId) return a;
              const updates = {};
              if (data.contextUsage !== undefined) updates.contextUsage = data.contextUsage;
              if (data.tokensUsed !== undefined) updates.tokensUsed = data.tokensUsed;
              return { ...a, ...updates };
            });
            set({ agents });
          }

          // Text responses → chat bubbles
          // Skip pure token-level stream chunks (subtype='stream') — too granular
          // Show: subtype='assistant' (Claude Code), subtype='text' (agent loop), type='result',
          //        and plain activity events with string data (Gemini/Codex/Ollama CLI)
          const isTokenStream = data.subtype === 'stream';
          const showAsChat = chatText && chatText.trim() && !isTokenStream && (
            data.subtype === 'assistant' || data.subtype === 'text' || data.type === 'result' ||
            (data.type === 'activity' && typeof data.data === 'string')
          );
          if (showAsChat) {
            // Clear thinking indicator only when actual text renders as a chat bubble
            if (get().thinkingAgents.has(agentId)) {
              set((s) => {
                const next = new Set(s.thinkingAgents);
                next.delete(agentId);
                return { thinkingAgents: next };
              });
            }

            const trimmed = chatText.trim();
            const history = { ...get().chatHistory };
            if (!history[agentId]) history[agentId] = [];
            const arr = [...history[agentId]];
            const last = arr[arr.length - 1];
            const isRecent = last && last.from === 'agent' && (Date.now() - last.timestamp) < 8000;

            // Skip duplicate text — Claude Code sends 'assistant' then 'result' with same content
            const isDupe = isRecent && (last.text === trimmed || last.text.endsWith(trimmed));

            if (!isDupe) {
              if (isRecent) {
                // Append to the last agent message (streaming from any provider)
                // Claude Code blocks use \n\n separator; plain text uses space
                const sep = data.subtype === 'assistant' ? '\n\n' : ' ';
                arr[arr.length - 1] = { ...last, text: last.text + sep + trimmed, timestamp: Date.now() };
              } else {
                // New message bubble
                arr.push({ from: 'agent', text: trimmed, timestamp: Date.now() });
              }

              history[agentId] = arr.slice(-100);
              set({ chatHistory: history });
              persistJSON('groove:chatHistory', history);
            }
          }

          // Tool calls → activity log (shown in streaming bar, not as chat bubbles)
          if (activityText && activityText.trim()) {
            const log = { ...get().activityLog };
            if (!log[agentId]) log[agentId] = [];
            log[agentId] = [...log[agentId].slice(-200), {
              timestamp: Date.now(),
              text: activityText.trim(),
              type: data.type,
              subtype: 'tool',
            }];
            set({ activityLog: log });
            persistJSON('groove:activityLog', log);
          }
          break;
        }

        case 'agent:exit': {
          const agent = get().agents.find((a) => a.id === msg.agentId);
          const name = agent?.name || msg.agentId;
          const isKill = msg.status === 'killed' || msg.code === 143 || msg.code === 137;
          const text = msg.status === 'completed' ? `${name} completed`
            : isKill ? `${name} stopped`
            : `${name} crashed (exit ${msg.code})`;
          const type = msg.status === 'completed' ? 'success' : isKill ? 'info' : 'warning';
          get().addToast(type, text, msg.error ? msg.error.slice(0, 200) : undefined);

          // Clear thinking indicator — agent is no longer active
          if (get().thinkingAgents.has(msg.agentId)) {
            set((s) => {
              const next = new Set(s.thinkingAgents);
              next.delete(msg.agentId);
              return { thinkingAgents: next };
            });
          }

          // Log crash error to agent chat so user can see what happened
          if (msg.error && msg.agentId) {
            get().addChatMessage(msg.agentId, 'system', `Crashed: ${msg.error}`);
          }
          // Check for recommended team when planner completes
          if (agent?.role === 'planner' && msg.status === 'completed') {
            setTimeout(() => get().checkRecommendedTeam(), 1000);
          }
          break;
        }

        case 'phase2:spawned':
          get().addToast('info', `QC agent ${msg.name} auto-spawned`, 'Auditing phase 1 work');
          break;

        case 'preview:ready':
          get().addToast(
            'success',
            'Project ready to preview',
            msg.url,
            { label: 'View Site', url: msg.url },
            { persistent: true },
          );
          break;

        case 'preview:failed':
          get().addToast(
            'warning',
            'Preview could not launch',
            msg.reason ? String(msg.reason).slice(0, 200) : 'Unknown error',
          );
          break;

        case 'preview:stopped':
          break;

        case 'agent:stalled': {
          const name = msg.agentName || msg.agentId;
          const secs = Math.round((msg.silentMs || 0) / 1000);
          get().addToast('warning', `${name} may be stalled`, `No output for ${secs}s — API stream may be hung`);
          break;
        }

        case 'knock:denied': {
          const name = msg.agentName || msg.agentId;
          get().addToast('warning', `${name} blocked`, `${msg.toolName} on ${msg.target} — ${msg.reason || 'scope conflict'}`);
          break;
        }

        case 'phase2:failed':
          get().addToast('error', `QC agent failed to spawn`, msg.error || 'Unknown error');
          break;

        case 'agent:message_queued':
          get().addChatMessage(msg.agentId, 'system', 'Agent is working — message will be delivered when it finishes.');
          break;

        case 'rotation:start':
          break;

        case 'rotation:complete': {
          // Migrate all agent-keyed state to the new ID so chat history,
          // activity log, and token timeline carry forward seamlessly.
          // The broadcast sends `agentId` (new) and `oldAgentId` (old).
          const newId = msg.agentId;
          const oldId = msg.oldAgentId;
          if (!newId || !oldId) break;
          set((s) => {
            const chatHistory = { ...s.chatHistory };
            const tokenTimeline = { ...s.tokenTimeline };
            const activityLog = { ...s.activityLog };
            const chatInputs = { ...s.chatInputs };
            if (chatHistory[oldId]?.length) {
              chatHistory[newId] = [...chatHistory[oldId]];
              delete chatHistory[oldId];
            }
            if (tokenTimeline[oldId]?.length) {
              tokenTimeline[newId] = [...tokenTimeline[oldId]];
              delete tokenTimeline[oldId];
            }
            if (activityLog[oldId]?.length) {
              activityLog[newId] = [...activityLog[oldId]];
              delete activityLog[oldId];
            }
            if (chatInputs[oldId]) {
              chatInputs[newId] = chatInputs[oldId];
              delete chatInputs[oldId];
            }
            const panel = s.detailPanel;
            let detailPanel = panel;
            let teamDetailPanels = s.teamDetailPanels;
            if (panel?.type === 'agent' && panel.agentId === oldId) {
              const newPanel = { type: 'agent', agentId: newId };
              detailPanel = newPanel;
              const tid = get().activeTeamId;
              teamDetailPanels = { ...s.teamDetailPanels, [tid]: newPanel };
            }
            try { localStorage.setItem('groove:chatHistory', JSON.stringify(chatHistory)); } catch {}
            return { chatHistory, tokenTimeline, activityLog, chatInputs, detailPanel, teamDetailPanels };
          });
          break;
        }

        case 'rotation:failed':
          get().addToast('error', 'Rotation failed', msg.error);
          break;

        case 'file:changed': {
          const savedAt = get().editorRecentSaves[msg.path];
          if (savedAt && Date.now() - savedAt < 2000) break;
          set((s) => ({ editorChangedFiles: { ...s.editorChangedFiles, [msg.path]: msg.timestamp } }));
          break;
        }

        case 'team:created':
        case 'team:deleted':
        case 'team:updated':
          get().fetchTeams();
          break;

        case 'approval:request':
          set((s) => ({ pendingApprovals: [...s.pendingApprovals, msg.data] }));
          break;

        case 'approval:resolved': {
          const resolved = msg.data;
          set((s) => ({
            pendingApprovals: s.pendingApprovals.filter((a) => a.id !== resolved.id),
            resolvedApprovals: [resolved, ...s.resolvedApprovals].slice(0, 200),
          }));
          break;
        }

        case 'conflict:detected':
          get().addToast('error', `Scope conflict: ${msg.agentName || 'agent'}`, msg.filePath ? `File: ${msg.filePath}` : undefined);
          break;

        case 'qc:activated':
          get().addToast('info', 'QC agent activated', `${msg.agentCount || '4+'} agents running`);
          break;

        case 'journalist:cycle':
          set({ journalistStatus: msg.data || null });
          break;

        case 'schedule:execute':
          get().addToast('info', `Scheduled agent spawned: ${msg.name || msg.role || 'agent'}`);
          break;

        case 'gateway:status':
          set({ gateways: msg.data || [] });
          break;

        case 'federation:whitelist':
          set((s) => ({ federation: { ...s.federation, whitelist: msg.data || [] } }));
          break;

        case 'federation:connection':
          set((s) => {
            const conns = [...s.federation.connections];
            const idx = conns.findIndex((c) => c.ip === msg.data?.ip);
            if (idx >= 0) conns[idx] = { ...conns[idx], ...msg.data };
            else conns.push(msg.data);
            return { federation: { ...s.federation, connections: conns } };
          });
          break;

        case 'federation:pouch':
        case 'federation:pouch-log':
          set((s) => ({
            federation: {
              ...s.federation,
              pouchLog: [...s.federation.pouchLog, msg.data].slice(-200),
            },
          }));
          break;

        case 'project-dir:changed':
          set({ projectDir: msg.data?.projectDir, showProjectPicker: false });
          break;

        case 'tunnel.connected':
          set({ activeTunnelId: msg.data?.id || null });
          get().fetchTunnels();
          break;

        case 'tunnel.disconnected':
          set({ activeTunnelId: null });
          get().fetchTunnels();
          break;

        case 'tunnel.health': {
          const tunnels = get().savedTunnels.map((t) =>
            t.id === msg.data?.id ? { ...t, latencyMs: msg.data.latencyMs, healthy: msg.data.healthy } : t,
          );
          set({ savedTunnels: tunnels });
          break;
        }

        case 'subscription:updated': {
          const subUpdate = { subscription: msg.data };
          if (msg.data?.active === true && !get().marketplaceAuthenticated) {
            subUpdate.marketplaceAuthenticated = true;
          }
          set(subUpdate);
          api.get('/edition').then((ed) => {
            set({
              edition: ed.edition || 'community',
              subscription: {
                plan: ed.plan || 'community',
                status: ed.status || (ed.subscriptionActive ? 'active' : 'none'),
                active: ed.subscriptionActive === true,
                features: ed.features || [],
                seats: ed.seats || 1,
                periodEnd: ed.periodEnd || null,
                cancelAtPeriodEnd: ed.cancelAtPeriodEnd || false,
              },
            });
          }).catch(() => {});
          get().fetchTunnels();
          break;
        }

        case 'auth:expired':
          set({ marketplaceAuthenticated: false, marketplaceUser: null });
          get().addToast('warning', 'Session expired', 'Please sign in again');
          break;

        case 'network:node:status':
          set({ networkNode: { ...get().networkNode, ...(msg.data || {}) } });
          break;

        case 'network:node:event': {
          const ev = msg.data || {};
          set((s) => ({
            networkEvents: [...s.networkEvents, { ...ev, timestamp: ev.timestamp || Date.now() }].slice(-100),
          }));
          break;
        }

        case 'network:status':
          set({ networkStatus: { ...get().networkStatus, ...(msg.data || {}) } });
          break;

        case 'network:install:progress': {
          const { step, message, percent } = msg.data || {};
          if (step === 'done') {
            set({
              networkInstalled: true,
              networkInstallProgress: { installing: false, step: null, message: null, percent: 0, error: null },
            });
            get().addToast('success', 'Network package installed');
          } else if (step === 'error') {
            set({
              networkInstallProgress: {
                installing: false,
                step: 'error',
                message: message || 'Install failed',
                percent: 0,
                error: message || 'Install failed',
              },
            });
          } else {
            set({
              networkInstallProgress: {
                installing: true,
                step: step || 'progress',
                message: message || '',
                percent: Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : get().networkInstallProgress.percent,
                error: null,
              },
            });
          }
          break;
        }

        case 'config:updated':
          get().fetchBetaStatus();
          get().fetchNetworkInstallStatus();
          break;
      }
    };

    ws.onclose = () => {
      if (plannerPollInterval) {
        clearInterval(plannerPollInterval);
        plannerPollInterval = null;
      }
      set({ connected: false, hydrated: false, ws: null, daemonHost: null, tunneled: false });
      setTimeout(() => get().connect(), 2000);
    };
    ws.onerror = () => ws.close();
  },

  // ── Navigation ────────────────────────────────────────────

  setActiveView(view) { set({ activeView: view }); },

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
    const { activeTeamId, detailPanel, teamDetailPanels } = get();
    const updated = { ...teamDetailPanels };
    if (activeTeamId) updated[activeTeamId] = detailPanel;
    const restored = updated[id] || null;
    set({ activeTeamId: id, detailPanel: restored, teamDetailPanels: updated });
    localStorage.setItem('groove:activeTeamId', id);
  },

  async createTeam(name, workingDir) {
    try {
      const body = { name };
      if (workingDir) body.workingDir = workingDir;
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

  async deleteTeam(id) {
    const team = get().teams.find((t) => t.id === id);
    try {
      await api.delete(`/teams/${encodeURIComponent(id)}`);
      // WS team:deleted handler removes from array and switches activeTeamId.
      // Deleting the default team regenerates a fresh one server-side; the
      // team:created event arrives separately so the list stays populated.
      const wiped = team?.isDefault ? 'wiped' : 'deleted';
      get().addToast('info', `Team "${team?.name}" ${wiped}`);
    } catch (err) {
      get().addToast('error', 'Failed to delete team', err.message);
    }
  },

  reorderTeams(fromIndex, toIndex) {
    const teams = [...get().teams];
    const [moved] = teams.splice(fromIndex, 1);
    teams.splice(toIndex, 0, moved);
    set({ teams });
    try { localStorage.setItem('groove:teamOrder', JSON.stringify(teams.map((t) => t.id))); } catch {}
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
  openDetail(descriptor) {
    const tid = get().activeTeamId;
    set((s) => ({ detailPanel: descriptor, teamDetailPanels: { ...s.teamDetailPanels, [tid]: descriptor } }));
  },
  closeDetail() {
    const tid = get().activeTeamId;
    set((s) => ({ detailPanel: null, teamDetailPanels: { ...s.teamDetailPanels, [tid]: null } }));
  },
  selectAgent(id) {
    const tid = get().activeTeamId;
    const panel = { type: 'agent', agentId: id };
    set((s) => ({ detailPanel: panel, teamDetailPanels: { ...s.teamDetailPanels, [tid]: panel } }));
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
    set((s) => ({ toasts: [...s.toasts, { id, type, message, detail, action, persistent, duration }] }));
  },
  removeToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },

  installUpdate() {
    window.groove?.update?.installUpdate();
  },

  // ── Marketplace Auth ────────────────────────────────────────

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
      // Poll for auth completion (user logs in via browser)
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
      // Stop polling after 5 minutes
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

  // ── Approvals ──────────────────────────────────────────────

  async fetchApprovals() {
    try {
      const data = await api.get('/approvals');
      set({
        pendingApprovals: data.pending || [],
        resolvedApprovals: data.resolved || [],
      });
    } catch { /* ignore */ }
  },

  async approveRequest(id) {
    try {
      await api.post(`/approvals/${encodeURIComponent(id)}/approve`);
      set((s) => ({ pendingApprovals: s.pendingApprovals.filter((a) => a.id !== id) }));
      get().addToast('success', 'Approved');
    } catch (err) {
      get().addToast('error', 'Approve failed', err.message);
    }
  },

  async rejectRequest(id, reason = '') {
    try {
      await api.post(`/approvals/${encodeURIComponent(id)}/reject`, { reason });
      set((s) => ({ pendingApprovals: s.pendingApprovals.filter((a) => a.id !== id) }));
      get().addToast('info', 'Rejected');
    } catch (err) {
      get().addToast('error', 'Reject failed', err.message);
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
            const result = await api.post('/recommended-team/launch', { teamId });
            const agents = result.agents || [];
            const names = agents.map((a) => a.name).join(', ') || '';
            get().addToast('success', 'Planner delegated work', names ? `→ ${names}` : undefined);
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
      set({ recommendedTeam: null }); // Dismiss modal immediately
      get().addToast('info', 'Launching team...');
      const body = { ...(modifiedAgents && { agents: modifiedAgents }), ...(teamId && { teamId }) };
      const result = await api.post('/recommended-team/launch', body);
      const sub = [
        result.phase2Pending ? `${result.phase2Pending} QC queued` : '',
        result.projectDir ? `→ ${result.projectDir}/` : '',
      ].filter(Boolean).join(' · ');
      get().addToast('success', `Launched ${(result.launched || 0) + (result.reused || 0)} agents`, sub || undefined);
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

  // ── Project Directory ────────────────────────────────────

  async fetchProjectDir() {
    try {
      const data = await api.get('/project-dir');
      const isHome = /^\/home\/[^/]+$/.test(data.projectDir) || data.projectDir === '/root';
      set({
        projectDir: data.projectDir,
        recentProjects: data.recentProjects || [],
        showProjectPicker: isHome || (data.recentProjects || []).length === 0,
      });
    } catch {}
  },

  async setProjectDir(path) {
    const data = await api.post('/project-dir', { path });
    set({
      projectDir: data.projectDir,
      recentProjects: data.recentProjects || [],
      showProjectPicker: false,
    });
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
    const result = await api.post(`/tunnels/${encodeURIComponent(id)}/connect`);
    set({ activeTunnelId: id });
    get().fetchTunnels();
    if (result.localPort && result.name) {
      if (window.groove?.remote?.openWindow) {
        window.groove.remote.openWindow(result.localPort, result.name);
      } else {
        window.open(`http://localhost:${result.localPort}?instance=${encodeURIComponent(result.name)}`, '_blank');
      }
    }
    return result;
  },

  async disconnectTunnel(id) {
    const tunnel = get().savedTunnels.find(t => t.id === id);
    await api.post(`/tunnels/${encodeURIComponent(id)}/disconnect`);
    set({ activeTunnelId: null });
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

  // ── Agent Actions ─────────────────────────────────────────

  async spawnAgent(config) {
    try {
      const teamId = get().activeTeamId;
      const agent = await api.post('/agents', { ...config, teamId });
      get().addToast('success', `Spawned ${agent.name}`);
      return agent;
    } catch (err) {
      get().addToast('error', 'Spawn failed', err.message);
      throw err;
    }
  },

  async killAgent(id, purge = false) {
    try {
      await api.delete(`/agents/${encodeURIComponent(id)}?purge=${purge}`);
      if (purge) {
        set((s) => {
          const chatHistory = { ...s.chatHistory };
          const activityLog = { ...s.activityLog };
          const tokenTimeline = { ...s.tokenTimeline };
          delete chatHistory[id];
          delete activityLog[id];
          delete tokenTimeline[id];
          persistJSON('groove:chatHistory', chatHistory);
          persistJSON('groove:activityLog', activityLog);
          return { chatHistory, activityLog, tokenTimeline };
        });
      }
    } catch (err) {
      get().addToast('error', 'Kill failed', err.message);
    }
  },

  async rotateAgent(id) {
    try {
      return await api.post(`/agents/${encodeURIComponent(id)}/rotate`);
    } catch (err) {
      get().addToast('error', 'Rotation failed', err.message);
      throw err;
    }
  },

  async fetchProviders() {
    return api.get('/providers');
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

  async installProvider(providerId) {
    try {
      const data = await api.post('/onboarding/install-provider', { provider: providerId });
      get().addToast('success', `${providerId} installed`);
      return data;
    } catch (err) {
      get().addToast('error', `Install failed: ${providerId}`, err.message);
      throw err;
    }
  },

  async setDefaultProvider(provider, model) {
    try {
      await api.post('/onboarding/set-default', { provider, model });
      get().addToast('success', `Default set to ${provider} (${model})`);
    } catch (err) {
      get().addToast('error', 'Failed to set default', err.message);
      throw err;
    }
  },

  // ── Chat ──────────────────────────────────────────────────

  addChatMessage(agentId, from, text, isQuery = false) {
    set((s) => {
      const history = { ...s.chatHistory };
      if (!history[agentId]) history[agentId] = [];
      history[agentId] = [...history[agentId].slice(-100), { from, text, timestamp: Date.now(), isQuery }];
      persistJSON('groove:chatHistory', history);
      return { chatHistory: history };
    });
  },

  // Track which agents are thinking (sent a message, waiting for response)
  thinkingAgents: new Set(),

  async stopAgent(id) {
    try {
      await api.post(`/agents/${encodeURIComponent(id)}/stop`);
      // Clear thinking indicator
      set((s) => {
        const next = new Set(s.thinkingAgents);
        next.delete(id);
        return { thinkingAgents: next };
      });
      get().addToast('info', 'Stopped agent');
    } catch (err) {
      get().addToast('error', 'Stop failed', err.message);
    }
  },

  async instructAgent(id, message) {
    get().addChatMessage(id, 'user', message, false);
    set((s) => ({ thinkingAgents: new Set([...s.thinkingAgents, id]) }));

    // Snapshot per-agent state before the async call — a WebSocket state broadcast
    // can arrive before the HTTP response returns and prune chatHistory[id], losing
    // the user's message.  The snapshot guarantees the transfer to the new agent ID
    // always has the full history.
    const snapshot = {
      chatHistory: [...(get().chatHistory[id] || [])],
      activityLog: [...(get().activityLog[id] || [])],
      tokenTimeline: [...(get().tokenTimeline[id] || [])],
    };

    try {
      const data = await api.post(`/agents/${encodeURIComponent(id)}/instruct`, { message });

      if (data.status === 'message_sent') {
        return data;
      }
      if (data.status === 'message_queued') {
        set((s) => {
          const next = new Set(s.thinkingAgents);
          next.delete(id);
          return { thinkingAgents: next };
        });
        return data;
      }

      // CLI agent: was stopped + resumed/rotated — transfer state to new agent ID
      const newAgent = data;
      for (const key of ['chatHistory', 'activityLog', 'tokenTimeline']) {
        if (snapshot[key]?.length) {
          set((s) => ({ [key]: { ...s[key], [newAgent.id]: [...snapshot[key]] } }));
        }
      }
      set((s) => {
        const next = new Set(s.thinkingAgents);
        next.delete(id);
        next.add(newAgent.id);
        return { thinkingAgents: next };
      });
      if (get().chatHistory[newAgent.id]?.length) persistJSON('groove:chatHistory', get().chatHistory);
      if (get().activityLog[newAgent.id]?.length) persistJSON('groove:activityLog', get().activityLog);
      get().selectAgent(newAgent.id);
      return newAgent;
    } catch (err) {
      set((s) => {
        const next = new Set(s.thinkingAgents);
        next.delete(id);
        return { thinkingAgents: next };
      });
      get().addChatMessage(id, 'system', `failed: ${err.message}`);
      throw err;
    }
  },

  async queryAgent(id, message) {
    get().addChatMessage(id, 'user', message, true);
    try {
      const data = await api.post(`/agents/${encodeURIComponent(id)}/query`, { message });
      get().addChatMessage(id, 'agent', data.response);
      return data;
    } catch (err) {
      get().addChatMessage(id, 'system', `query failed: ${err.message}`);
      throw err;
    }
  },

  // ── Editor ────────────────────────────────────────────────

  async openFile(path) {
    if (get().editorFiles[path] || get().editorOpenTabs.includes(path)) {
      set((s) => ({
        editorActiveFile: path,
        editorOpenTabs: s.editorOpenTabs.includes(path) ? s.editorOpenTabs : [...s.editorOpenTabs, path],
      }));
      return;
    }
    const ext = path.split('.').pop()?.toLowerCase();
    const MEDIA = ['png','jpg','jpeg','gif','svg','webp','ico','bmp','avif','mp4','webm','mov','avi','mkv','ogv'];
    if (MEDIA.includes(ext)) {
      set((s) => ({ editorActiveFile: path, editorOpenTabs: [...s.editorOpenTabs, path] }));
      return;
    }
    try {
      const data = await api.get(`/files/read?path=${encodeURIComponent(path)}`);
      if (data.binary) { get().addToast('warning', 'Binary file — cannot open'); return; }
      set((s) => ({
        editorFiles: { ...s.editorFiles, [path]: { content: data.content, originalContent: data.content, language: data.language, loadedAt: Date.now() } },
        editorActiveFile: path,
        editorOpenTabs: s.editorOpenTabs.includes(path) ? s.editorOpenTabs : [...s.editorOpenTabs, path],
      }));
      const ws = get().ws;
      if (ws?.readyState === 1) ws.send(JSON.stringify({ type: 'editor:watch', path }));
    } catch (err) {
      get().addToast('error', 'Failed to open file', err.message);
    }
  },

  closeFile(path) {
    set((s) => {
      const tabs = s.editorOpenTabs.filter((t) => t !== path);
      const files = { ...s.editorFiles };
      delete files[path];
      const changed = { ...s.editorChangedFiles };
      delete changed[path];
      let active = s.editorActiveFile;
      if (active === path) {
        const idx = s.editorOpenTabs.indexOf(path);
        active = tabs[Math.min(idx, tabs.length - 1)] || null;
      }
      return { editorOpenTabs: tabs, editorFiles: files, editorChangedFiles: changed, editorActiveFile: active };
    });
    const ws = get().ws;
    if (ws?.readyState === 1) ws.send(JSON.stringify({ type: 'editor:unwatch', path }));
  },

  setActiveFile(path) { set({ editorActiveFile: path }); },

  setEditorSidebarWidth(width) {
    set({ editorSidebarWidth: width });
    localStorage.setItem('groove:editorSidebarWidth', String(width));
  },

  updateFileContent(path, content) {
    set((s) => ({ editorFiles: { ...s.editorFiles, [path]: { ...s.editorFiles[path], content } } }));
  },

  async saveFile(path) {
    const file = get().editorFiles[path];
    if (!file) return;
    try {
      await api.post('/files/write', { path, content: file.content });
      set((s) => ({
        editorFiles: { ...s.editorFiles, [path]: { ...s.editorFiles[path], originalContent: file.content } },
        editorChangedFiles: (() => { const c = { ...s.editorChangedFiles }; delete c[path]; return c; })(),
        editorRecentSaves: { ...s.editorRecentSaves, [path]: Date.now() },
      }));
      get().addToast('success', 'File saved');
    } catch (err) {
      get().addToast('error', 'Save failed', err.message);
    }
  },

  async reloadFile(path) {
    try {
      const data = await api.get(`/files/read?path=${encodeURIComponent(path)}`);
      if (data.binary) return;
      set((s) => ({
        editorFiles: { ...s.editorFiles, [path]: { content: data.content, originalContent: data.content, language: data.language, loadedAt: Date.now() } },
        editorChangedFiles: (() => { const c = { ...s.editorChangedFiles }; delete c[path]; return c; })(),
      }));
    } catch { /* ignore */ }
  },

  dismissFileChange(path) {
    set((s) => { const c = { ...s.editorChangedFiles }; delete c[path]; return { editorChangedFiles: c }; });
  },

  async fetchTreeDir(dirPath) {
    try {
      const data = await api.get(`/files/tree?path=${encodeURIComponent(dirPath)}`);
      set((s) => ({ editorTreeCache: { ...s.editorTreeCache, [dirPath]: data.entries } }));
    } catch { /* ignore */ }
  },

  async createFile(relPath) {
    try {
      await api.post('/files/create', { path: relPath });
      const parent = relPath.includes('/') ? relPath.split('/').slice(0, -1).join('/') : '';
      await get().fetchTreeDir(parent);
      get().addToast('success', 'File created');
      return true;
    } catch (err) {
      get().addToast('error', 'Create failed', err.message);
      return false;
    }
  },

  async createDir(relPath) {
    try {
      await api.post('/files/mkdir', { path: relPath });
      const parent = relPath.includes('/') ? relPath.split('/').slice(0, -1).join('/') : '';
      await get().fetchTreeDir(parent);
      get().addToast('success', 'Folder created');
      return true;
    } catch (err) {
      get().addToast('error', 'Create failed', err.message);
      return false;
    }
  },

  async deleteFile(relPath) {
    try {
      await api.delete(`/files/delete?path=${encodeURIComponent(relPath)}`);
      if (get().editorOpenTabs.includes(relPath)) get().closeFile(relPath);
      const parent = relPath.includes('/') ? relPath.split('/').slice(0, -1).join('/') : '';
      await get().fetchTreeDir(parent);
      set((s) => { const cache = { ...s.editorTreeCache }; delete cache[relPath]; return { editorTreeCache: cache }; });
      get().addToast('success', 'Deleted');
      return true;
    } catch (err) {
      get().addToast('error', 'Delete failed', err.message);
      return false;
    }
  },

  // ── Federation ────────────────────────────────────────────

  async fetchFederationStatus() {
    try {
      const data = await api.get('/federation');
      set((s) => ({
        federation: {
          ...s.federation,
          peers: data.peers || [],
          whitelist: data.whitelist || [],
          connections: data.connections || [],
          ambassadors: data.ambassadors?.ambassadors || data.ambassadors || [],
        },
      }));
      return data;
    } catch { return null; }
  },

  async addToWhitelist(ip, port = 31415, name) {
    try {
      await api.post('/federation/whitelist', { ip, port, ...(name && { name }) });
      get().addToast('success', `Added ${ip} to whitelist`);
      get().fetchFederationStatus();
    } catch (err) {
      get().addToast('error', 'Whitelist failed', err.message);
      throw err;
    }
  },

  async removeFromWhitelist(ip) {
    try {
      await api.delete(`/federation/whitelist/${encodeURIComponent(ip)}`);
      get().addToast('info', `Removed ${ip}`);
      get().fetchFederationStatus();
    } catch (err) {
      get().addToast('error', 'Remove failed', err.message);
    }
  },

  setSelectedPeer(peerId) {
    set((s) => ({ federation: { ...s.federation, selectedPeerId: peerId } }));
  },

  async fetchPouchLog(peerId) {
    try {
      const data = await api.get(`/federation/pouch/log${peerId ? `?peerId=${encodeURIComponent(peerId)}` : ''}`);
      set((s) => ({ federation: { ...s.federation, pouchLog: data || [] } }));
    } catch { /* ignore */ }
  },

  async sendPouch(peerId, contract) {
    try {
      const result = await api.post('/federation/pouch/send', { peerId, contract });
      get().addToast('success', 'Pouch sent');
      return result;
    } catch (err) {
      get().addToast('error', 'Pouch send failed', err.message);
      throw err;
    }
  },

  // ── Network (Early Access) ────────────────────────────────

  async fetchBetaStatus() {
    try {
      const data = await api.get('/beta/status');
      set({ networkUnlocked: !!data?.unlocked });
    } catch { /* endpoint may not exist yet */ }
  },

  async activateBeta(code) {
    const data = await api.post('/beta/activate', { code });
    if (!data?.unlocked) {
      throw new Error(data?.message || 'Invalid invite code');
    }
    set({ networkUnlocked: true });
    return data;
  },

  async deactivateBeta() {
    try {
      await api.post('/beta/deactivate');
      set({
        networkUnlocked: false,
        activeView: get().activeView === 'network' ? 'agents' : get().activeView,
      });
    } catch (err) {
      get().addToast('error', 'Deactivate failed', err.message);
      throw err;
    }
  },

  async fetchNetworkNodeStatus() {
    try {
      const data = await api.get('/network/node/status');
      const update = { networkNode: { ...get().networkNode, ...(data || {}) } };
      if (data && typeof data.installed === 'boolean') {
        update.networkInstalled = data.installed;
      }
      set(update);
      return data;
    } catch { return null; }
  },

  async fetchNetworkInstallStatus() {
    try {
      const data = await api.get('/network/install/status');
      if (data && typeof data.installed === 'boolean') {
        set({ networkInstalled: data.installed });
      }
      return data;
    } catch { return null; }
  },

  async installNetworkPackage() {
    set({
      networkInstallProgress: {
        installing: true,
        step: 'starting',
        message: 'Starting install…',
        percent: 0,
        error: null,
      },
    });
    try {
      await api.post('/network/install');
    } catch (err) {
      set({
        networkInstallProgress: {
          installing: false,
          step: 'error',
          message: err.message,
          percent: 0,
          error: err.message,
        },
      });
      get().addToast('error', 'Install failed', err.message);
    }
  },

  async uninstallNetworkPackage() {
    try {
      await api.post('/network/uninstall');
      set({
        networkInstalled: false,
        networkNode: { active: false, status: 'disconnected', nodeId: null, layers: null, model: null, sessions: 0, hardware: null },
        networkInstallProgress: { installing: false, step: null, message: null, percent: 0, error: null },
      });
      get().addToast('success', 'Network package uninstalled');
    } catch (err) {
      get().addToast('error', 'Uninstall failed', err.message);
      throw err;
    }
  },

  async fetchNetworkStatus() {
    try {
      const data = await api.get('/network/status');
      set({ networkStatus: { ...get().networkStatus, ...(data || {}) } });
      return data;
    } catch { return null; }
  },

  async startNetworkNode() {
    set({ networkNode: { ...get().networkNode, status: 'connecting' } });
    try {
      const data = await api.post('/network/node/start');
      set({ networkNode: { ...get().networkNode, active: true, ...(data || {}) } });
      get().addToast('success', 'Node started', 'Connecting to the Groove network');
      return data;
    } catch (err) {
      set({ networkNode: { ...get().networkNode, status: 'disconnected', active: false } });
      get().addToast('error', 'Node start failed', err.message);
      throw err;
    }
  },

  async stopNetworkNode() {
    try {
      await api.post('/network/node/stop');
      set({ networkNode: { ...get().networkNode, active: false, status: 'disconnected' } });
      get().addToast('info', 'Node stopped');
    } catch (err) {
      get().addToast('error', 'Node stop failed', err.message);
      throw err;
    }
  },

  async renameFile(oldPath, newPath) {
    try {
      await api.post('/files/rename', { oldPath, newPath });
      set((s) => {
        const tabs = s.editorOpenTabs.map((t) => t === oldPath ? newPath : t);
        const files = { ...s.editorFiles };
        if (files[oldPath]) { files[newPath] = files[oldPath]; delete files[oldPath]; }
        const active = s.editorActiveFile === oldPath ? newPath : s.editorActiveFile;
        return { editorOpenTabs: tabs, editorFiles: files, editorActiveFile: active };
      });
      const oldParent = oldPath.includes('/') ? oldPath.split('/').slice(0, -1).join('/') : '';
      const newParent = newPath.includes('/') ? newPath.split('/').slice(0, -1).join('/') : '';
      await get().fetchTreeDir(oldParent);
      if (newParent !== oldParent) await get().fetchTreeDir(newParent);
      get().addToast('success', 'Renamed');
      return true;
    } catch (err) {
      get().addToast('error', 'Rename failed', err.message);
      return false;
    }
  },
}));
