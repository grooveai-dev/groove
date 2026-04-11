// GROOVE GUI v2 — Zustand Store
// FSL-1.1-Apache-2.0 — see LICENSE

import { create } from 'zustand';
import { api } from '../lib/api';

const WS_URL = `ws://${window.location.hostname}:${window.location.port || 31415}`;

let toastCounter = 0;

function loadJSON(key, fallback = {}) {
  try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); }
  catch { return fallback; }
}

function persistJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota */ }
}

// Clear stale persisted data on version change
const STORE_VERSION = '0.22.27';
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

  // ── Navigation ────────────────────────────────────────────
  activeView: 'agents',           // 'agents' | 'editor' | 'dashboard' | 'marketplace' | 'teams' | 'settings'
  detailPanel: null,              // null | { type: 'agent', agentId } | { type: 'spawn' } | { type: 'journalist' }
  commandPaletteOpen: false,

  // ── Layout persistence ────────────────────────────────────
  detailPanelWidth: Number(localStorage.getItem('groove:detailWidth')) || 480,
  terminalVisible: localStorage.getItem('groove:terminalVisible') === 'true',
  terminalHeight: Number(localStorage.getItem('groove:terminalHeight')) || 260,
  terminalFullHeight: false,

  // ── Agent data ────────────────────────────────────────────
  activityLog: loadJSON('groove:activityLog'),
  chatHistory: loadJSON('groove:chatHistory'),
  tokenTimeline: {},
  dashTelemetry: {},
  ccChartTimeline: [],

  // ── Approvals ─────────────────────────────────────────────
  pendingApprovals: [],
  resolvedApprovals: [],

  // ── Recommended Team ──────────────────────────────────────
  recommendedTeam: null,  // { name, agents: [...] } from planner

  // ── Journalist ────────────────────────────────────────────
  journalistStatus: null, // { cycleCount, lastCycleTime, history, lastSynthesis }

  // ── Marketplace Auth ───────────────────────────────────────
  marketplaceUser: null,        // { id, displayName, avatar, ... } or null
  marketplaceAuthenticated: false,

  // ── Toasts ────────────────────────────────────────────────
  toasts: [],

  // ── Editor state ──────────────────────────────────────────
  editorFiles: {},
  editorActiveFile: null,
  editorOpenTabs: [],
  editorTreeCache: {},
  editorChangedFiles: {},
  editorRecentSaves: {},

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
        if (String(s.port) !== browserPort) updates.tunneled = true;
        if (Object.keys(updates).length > 0) set(updates);
      }).catch(() => {});
      get().fetchTeams();
      get().fetchApprovals();
      get().checkMarketplaceAuth();
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      switch (msg.type) {
        case 'state': {
          const timeline = { ...get().tokenTimeline };
          const now = Date.now();
          for (const agent of msg.data) {
            if (!timeline[agent.id]) timeline[agent.id] = [];
            const arr = timeline[agent.id];
            const last = arr[arr.length - 1];
            if (!last || agent.tokensUsed !== last.v || now - last.t > 5000) {
              arr.push({ t: now, v: agent.tokensUsed || 0 });
              if (arr.length > 200) timeline[agent.id] = arr.slice(-200);
            }
          }
          // Only replace agents array if something meaningful changed
          // (prevents React Flow tree flicker on every lastActivity update)
          const prev = get().agents;
          const changed = msg.data.length !== prev.length || msg.data.some((a, i) => {
            const p = prev[i];
            return !p || p.id !== a.id || p.status !== a.status || p.tokensUsed !== a.tokensUsed
              || p.contextUsage !== a.contextUsage || p.name !== a.name || p.model !== a.model;
          });
          set({ agents: changed ? msg.data : prev, tokenTimeline: timeline, hydrated: true });
          break;
        }

        case 'agent:output': {
          const { agentId, data } = msg;

          // Clear thinking indicator when agent responds
          if (get().thinkingAgents.has(agentId)) {
            set((s) => {
              const next = new Set(s.thinkingAgents);
              next.delete(agentId);
              return { thinkingAgents: next };
            });
          }

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

        case 'phase2:failed':
          get().addToast('error', `QC agent failed to spawn`, msg.error || 'Unknown error');
          break;

        case 'rotation:start':
          get().addToast('info', `Rotating ${msg.agentName}...`);
          break;

        case 'rotation:complete': {
          get().addToast('success', `Rotated ${msg.agentName}`, `Saved ${msg.tokensSaved} tokens`);
          const panel = get().detailPanel;
          if (panel?.type === 'agent' && panel.agentId === msg.oldAgentId && msg.newAgentId) {
            set((s) => {
              const chatHistory = { ...s.chatHistory };
              const tokenTimeline = { ...s.tokenTimeline };
              const activityLog = { ...s.activityLog };
              if (chatHistory[msg.oldAgentId]?.length) chatHistory[msg.newAgentId] = [...chatHistory[msg.oldAgentId]];
              if (tokenTimeline[msg.oldAgentId]?.length) tokenTimeline[msg.newAgentId] = [...tokenTimeline[msg.oldAgentId]];
              if (activityLog[msg.oldAgentId]?.length) activityLog[msg.newAgentId] = [...activityLog[msg.oldAgentId]];
              return { chatHistory, tokenTimeline, activityLog, detailPanel: { type: 'agent', agentId: msg.newAgentId } };
            });
          }
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
          get().addToast('warning', `Approval needed: ${msg.data?.agentName || 'agent'}`, msg.data?.action?.description);
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
      }
    };

    ws.onclose = () => {
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
      const teams = data.teams || [];
      const defaultTeamId = data.defaultTeamId;
      const { activeTeamId } = get();
      const ids = teams.map((t) => t.id);
      const resolved = ids.includes(activeTeamId) ? activeTeamId : defaultTeamId;
      set({ teams, activeTeamId: resolved });
      if (resolved) localStorage.setItem('groove:activeTeamId', resolved);
    } catch { /* ignore */ }
  },

  switchTeam(id) {
    set({ activeTeamId: id, detailPanel: null });
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
    if (team?.isDefault) { get().addToast('warning', 'Cannot delete the default team'); return; }
    try {
      await api.delete(`/teams/${id}`);
      // WS team:deleted handler removes from array and switches activeTeamId
      get().addToast('info', `Team "${team?.name}" deleted`);
    } catch (err) {
      get().addToast('error', 'Failed to delete team', err.message);
    }
  },

  async renameTeam(id, name) {
    try {
      const team = await api.patch(`/teams/${id}`, { name });
      set((s) => ({ teams: s.teams.map((t) => (t.id === id ? team : t)) }));
      return team;
    } catch (err) {
      get().addToast('error', 'Failed to rename team', err.message);
      throw err;
    }
  },
  openDetail(descriptor) { set({ detailPanel: descriptor }); },
  closeDetail() { set({ detailPanel: null }); },
  selectAgent(id) { set({ detailPanel: { type: 'agent', agentId: id } }); },
  clearSelection() { set({ detailPanel: null }); },
  toggleCommandPalette() { set((s) => ({ commandPaletteOpen: !s.commandPaletteOpen })); },

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

  // ── Toasts ────────────────────────────────────────────────

  addToast(type, message, detail) {
    const id = ++toastCounter;
    set((s) => ({ toasts: [...s.toasts, { id, type, message, detail }] }));
  },
  removeToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },

  // ── Marketplace Auth ────────────────────────────────────────

  async checkMarketplaceAuth() {
    try {
      const data = await api.get('/auth/status');
      set({
        marketplaceAuthenticated: data.authenticated || false,
        marketplaceUser: data.user || null,
      });
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
      await api.post(`/approvals/${id}/approve`);
      set((s) => ({ pendingApprovals: s.pendingApprovals.filter((a) => a.id !== id) }));
      get().addToast('success', 'Approved');
    } catch (err) {
      get().addToast('error', 'Approve failed', err.message);
    }
  },

  async rejectRequest(id, reason = '') {
    try {
      await api.post(`/approvals/${id}/reject`, { reason });
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
      if (data && data.agents?.length) {
        set({ recommendedTeam: data });
      } else {
        set({ recommendedTeam: null });
      }
    } catch {
      set({ recommendedTeam: null });
    }
  },

  async launchRecommendedTeam() {
    try {
      set({ recommendedTeam: null }); // Dismiss modal immediately
      get().addToast('info', 'Launching team...');
      const result = await api.post('/recommended-team/launch');
      const sub = [
        result.phase2Pending ? `${result.phase2Pending} QC queued` : '',
        result.projectDir ? `→ ${result.projectDir}/` : '',
      ].filter(Boolean).join(' · ');
      get().addToast('success', `Launched ${result.launched} agents`, sub || undefined);
      // Clean up stale files
      api.post('/cleanup').catch(() => {});
      return result;
    } catch (err) {
      get().addToast('error', 'Launch failed', err.message);
      throw err;
    }
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
      await api.delete(`/agents/${id}?purge=${purge}`);
    } catch (err) {
      get().addToast('error', 'Kill failed', err.message);
    }
  },

  async rotateAgent(id) {
    try {
      return await api.post(`/agents/${id}/rotate`);
    } catch (err) {
      get().addToast('error', 'Rotation failed', err.message);
      throw err;
    }
  },

  async fetchProviders() {
    return api.get('/providers');
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

  async instructAgent(id, message) {
    const agent = get().agents.find((a) => a.id === id);
    const isAlive = agent && (agent.status === 'running' || agent.status === 'starting');

    // Running agent: use query (non-destructive) instead of killing it
    if (isAlive) {
      get().addChatMessage(id, 'user', message, false);
      try {
        const data = await api.post(`/agents/${id}/query`, { message });
        // Agent loop agents: response comes via WebSocket, show thinking indicator
        if (data.status === 'pending' || data.response === 'Message sent to agent') {
          set((s) => ({ thinkingAgents: new Set([...s.thinkingAgents, id]) }));
          return data;
        }
        get().addChatMessage(id, 'agent', data.response);
        return data;
      } catch (err) {
        get().addChatMessage(id, 'system', `failed: ${err.message}`);
        throw err;
      }
    }

    // Completed/stopped agent: resume with full context
    get().addChatMessage(id, 'user', message, false);
    // Show thinking indicator immediately — stays until first WebSocket output
    set((s) => ({ thinkingAgents: new Set([...s.thinkingAgents, id]) }));
    try {
      const newAgent = await api.post(`/agents/${id}/instruct`, { message });
      // Carry history + thinking state to new agent ID
      for (const key of ['chatHistory', 'activityLog', 'tokenTimeline']) {
        const old = get()[key][id];
        if (old?.length) {
          set((s) => ({ [key]: { ...s[key], [newAgent.id]: [...old] } }));
        }
      }
      // Transfer thinking indicator to the new agent
      set((s) => {
        const next = new Set(s.thinkingAgents);
        next.delete(id);
        next.add(newAgent.id);
        return { thinkingAgents: next };
      });
      if (get().chatHistory[id]?.length) persistJSON('groove:chatHistory', get().chatHistory);
      if (get().activityLog[id]?.length) persistJSON('groove:activityLog', get().activityLog);
      get().selectAgent(newAgent.id);
      return newAgent;
    } catch (err) {
      // Clear thinking indicator on failure
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
      const data = await api.post(`/agents/${id}/query`, { message });
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
