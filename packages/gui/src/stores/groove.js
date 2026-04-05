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

  // UI state
  selectedAgentId: null,
  spawnModalOpen: false,
  journalistOpen: false,
  activityLog: {},
  notifications: [],

  // Connection
  connect() {
    if (get().ws) return;

    const ws = new WebSocket(WS_URL);

    ws.onopen = () => set({ connected: true, ws });

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);

      switch (msg.type) {
        case 'state':
          set({ agents: msg.data });
          break;

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
          get().addNotification(
            msg.status === 'completed' ? `${name} completed`
              : msg.status === 'killed' ? `${name} killed`
              : `${name} crashed (exit ${msg.code})`,
            msg.status === 'crashed' ? 'error' : 'info',
          );
          break;
        }

        case 'rotation:start':
          get().addNotification(`Rotating ${msg.agentName}...`, 'info');
          break;

        case 'rotation:complete':
          get().addNotification(`Rotated ${msg.agentName} (saved ${msg.tokensSaved} tokens)`, 'success');
          break;

        case 'rotation:failed':
          get().addNotification(`Rotation failed: ${msg.error}`, 'error');
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
    get().addNotification(`Spawned ${agent.name}`, 'success');
    return agent;
  },

  async killAgent(id) {
    await fetch(`${API_BASE}/api/agents/${id}`, { method: 'DELETE' });
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

  // UI actions
  selectAgent(id) { set({ selectedAgentId: id }); },
  clearSelection() { set({ selectedAgentId: null }); },
  openSpawnModal() { set({ spawnModalOpen: true }); },
  closeSpawnModal() { set({ spawnModalOpen: false }); },
  toggleJournalist() { set((s) => ({ journalistOpen: !s.journalistOpen })); },

  addNotification(text, type = 'info') {
    const id = Date.now() + Math.random();
    set((s) => ({
      notifications: [...s.notifications, { id, text, type, timestamp: Date.now() }],
    }));
    setTimeout(() => {
      set((s) => ({ notifications: s.notifications.filter((n) => n.id !== id) }));
    }, 4000);
  },

  dismissNotification(id) {
    set((s) => ({ notifications: s.notifications.filter((n) => n.id !== id) }));
  },

  getSelectedAgent() {
    const { agents, selectedAgentId } = get();
    return agents.find((a) => a.id === selectedAgentId) || null;
  },

  getAgentActivity(agentId) {
    return get().activityLog[agentId] || [];
  },
}));
