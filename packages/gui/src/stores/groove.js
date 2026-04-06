// GROOVE GUI — Zustand Store + WebSocket
// FSL-1.1-Apache-2.0 — see LICENSE

import { create } from 'zustand';

const WS_URL = `ws://${window.location.hostname}:${window.location.port || 3141}`;
const API_BASE = '';

export const useGrooveStore = create((set, get) => ({
  // Connection state
  agents: [],
  connected: false,
  ws: null,

  // UI state — unified panel model
  activeTab: 'agents',       // 'agents' | 'stats' | 'teams' | 'approvals'
  detailPanel: null,          // null | { type: 'agent', agentId } | { type: 'spawn' } | { type: 'journalist' }
  activityLog: {},
  statusMessage: null,        // inline status text (replaces toast notifications)
  commandHistory: [],          // last 50 commands for command bar
  chatHistory: {},              // { [agentId]: [{ from, text, timestamp, isQuery }] }
  tokenTimeline: {},            // { [agentId]: [{ t: timestamp, v: tokensUsed }] }

  // Connection
  connect() {
    if (get().ws) return;

    const ws = new WebSocket(WS_URL);

    ws.onopen = () => set({ connected: true, ws });

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);

      switch (msg.type) {
        case 'state': {
          // Track token timeline for live charts
          const timeline = { ...get().tokenTimeline };
          const now = Date.now();
          for (const agent of msg.data) {
            if (!timeline[agent.id]) timeline[agent.id] = [];
            const arr = timeline[agent.id];
            const last = arr[arr.length - 1];
            // Only record if tokens changed or every 5s for heartbeat
            if (!last || agent.tokensUsed !== last.v || now - last.t > 5000) {
              arr.push({ t: now, v: agent.tokensUsed || 0 });
              // Keep last 200 points
              if (arr.length > 200) timeline[agent.id] = arr.slice(-200);
            }
          }
          set({ agents: msg.data, tokenTimeline: timeline });
          break;
        }

        case 'agent:output': {
          const { agentId, data } = msg;
          const log = { ...get().activityLog };
          if (!log[agentId]) log[agentId] = [];
          log[agentId] = [...log[agentId].slice(-200), {
            timestamp: Date.now(),
            text: typeof data.data === 'string' ? data.data : JSON.stringify(data.data),
            type: data.type,
          }];
          set({ activityLog: log });
          break;
        }

        case 'agent:exit': {
          const agent = get().agents.find((a) => a.id === msg.agentId);
          const name = agent?.name || msg.agentId;
          const text = msg.status === 'completed' ? `${name} completed`
            : msg.status === 'killed' ? `${name} killed`
            : `${name} crashed (exit ${msg.code})`;
          get().showStatus(text);
          break;
        }

        case 'rotation:start':
          get().showStatus(`rotating ${msg.agentName}...`);
          break;

        case 'rotation:complete': {
          get().showStatus(`rotated ${msg.agentName} (saved ${msg.tokensSaved} tokens)`);
          // Auto-update detail panel if the rotated agent was selected
          const panel = get().detailPanel;
          if (panel?.type === 'agent' && panel.agentId === msg.oldAgentId && msg.newAgentId) {
            set({ detailPanel: { type: 'agent', agentId: msg.newAgentId } });
          }
          break;
        }

        case 'rotation:failed':
          get().showStatus(`rotation failed: ${msg.error}`);
          break;

        case 'journalist:cycle':
          break; // Journalist feed polls separately
      }
    };

    ws.onclose = () => {
      set({ connected: false, ws: null });
      setTimeout(() => get().connect(), 2000);
    };

    ws.onerror = () => ws.close();
  },

  // Agent actions
  async spawnAgent(config) {
    const res = await fetch(`${API_BASE}/api/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Spawn failed');
    }
    const agent = await res.json();
    get().showStatus(`spawned ${agent.name}`);
    return agent;
  },

  async killAgent(id, purge = false) {
    await fetch(`${API_BASE}/api/agents/${id}?purge=${purge}`, { method: 'DELETE' });
  },

  async rotateAgent(id) {
    const res = await fetch(`${API_BASE}/api/agents/${id}/rotate`, { method: 'POST' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Rotation failed');
    }
    return res.json();
  },

  async fetchProviders() {
    const res = await fetch(`${API_BASE}/api/providers`);
    return res.json();
  },

  // UI actions — unified panel control
  setActiveTab(tab) { set({ activeTab: tab }); },

  openDetail(descriptor) { set({ detailPanel: descriptor }); },
  closeDetail() { set({ detailPanel: null }); },

  selectAgent(id) { set({ detailPanel: { type: 'agent', agentId: id } }); },
  clearSelection() { set({ detailPanel: null }); },

  showStatus(text) {
    set({ statusMessage: text });
    setTimeout(() => {
      if (get().statusMessage === text) set({ statusMessage: null });
    }, 4000);
  },

  // Agent interaction
  addChatMessage(agentId, from, text, isQuery = false) {
    set((s) => {
      const history = { ...s.chatHistory };
      if (!history[agentId]) history[agentId] = [];
      history[agentId] = [...history[agentId].slice(-100), {
        from, text, timestamp: Date.now(), isQuery,
      }];
      return { chatHistory: history };
    });
  },

  async instructAgent(id, message) {
    const agent = get().agents.find((a) => a.id === id);
    const isAlive = agent && (agent.status === 'running' || agent.status === 'starting');

    get().addChatMessage(id, 'user', message, false);
    get().addChatMessage(id, 'system', isAlive ? 'sending instruction...' : 'continuing conversation...');
    const res = await fetch(`${API_BASE}/api/agents/${id}/instruct`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      get().addChatMessage(id, 'system', `failed: ${err.error || 'unknown error'}`);
      throw new Error(err.error || 'Instruction failed');
    }
    const newAgent = await res.json();
    // Select the new agent (same name, new ID after rotation/continuation)
    get().selectAgent(newAgent.id);
    get().addChatMessage(newAgent.id, 'system', 'agent resumed with context');
    return newAgent;
  },

  async queryAgent(id, message) {
    get().addChatMessage(id, 'user', message, true);
    const res = await fetch(`${API_BASE}/api/agents/${id}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      get().addChatMessage(id, 'system', `query failed: ${err.error || 'unknown error'}`);
      throw new Error(err.error || 'Query failed');
    }
    const data = await res.json();
    get().addChatMessage(id, 'agent', data.response);
    return data;
  },

  addCommand(text) {
    set((s) => ({
      commandHistory: [...s.commandHistory.slice(-49), text],
    }));
  },
}));
