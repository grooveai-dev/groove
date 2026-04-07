// GROOVE GUI — Zustand Store + WebSocket
// FSL-1.1-Apache-2.0 — see LICENSE

import { create } from 'zustand';

const WS_URL = `ws://${window.location.hostname}:${window.location.port || 31415}`;
const API_BASE = '';

export const useGrooveStore = create((set, get) => ({
  // Connection state
  agents: [],
  connected: false,
  ws: null,
  daemonHost: null,   // bound host IP (null = localhost)
  tunneled: false,    // true when accessed via SSH tunnel (port mismatch)

  // UI state — unified panel model
  activeTab: 'agents',       // 'agents' | 'stats' | 'teams' | 'approvals' | 'editor'
  detailPanel: null,          // null | { type: 'agent', agentId } | { type: 'spawn' } | { type: 'journalist' }
  activityLog: {},
  statusMessage: null,        // inline status text (replaces toast notifications)
  commandHistory: [],          // last 50 commands for command bar
  chatHistory: {},              // { [agentId]: [{ from, text, timestamp, isQuery }] }
  tokenTimeline: {},            // { [agentId]: [{ t: timestamp, v: tokensUsed }] }
  dashTelemetry: {},            // { [agentId]: [{ t, v, name }] } — persists across tab switches

  // Editor state
  editorFiles: {},           // { [path]: { content, originalContent, language, loadedAt } }
  editorActiveFile: null,    // currently visible file path
  editorOpenTabs: [],        // ordered array of open file paths
  editorTreeCache: {},       // { [dirPath]: entries[] }
  editorChangedFiles: {},    // { [path]: timestamp } — externally modified files
  editorRecentSaves: {},     // { [path]: timestamp } — suppress self-triggered change events

  // Connection
  connect() {
    if (get().ws) return;

    const ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      set({ connected: true, ws });
      // Fetch daemon info for instance badge + tunnel detection
      fetch(`${API_BASE}/api/status`).then((r) => r.json()).then((s) => {
        const updates = {};
        if (s.host && s.host !== '127.0.0.1') {
          updates.daemonHost = s.host;
        }
        // Detect tunnel: browser port differs from daemon's actual port
        const browserPort = window.location.port || '80';
        if (String(s.port) !== browserPort) {
          updates.tunneled = true;
        }
        if (Object.keys(updates).length > 0) set(updates);
      }).catch(() => {});
    };

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
          const panel = get().detailPanel;
          if (panel?.type === 'agent' && panel.agentId === msg.oldAgentId && msg.newAgentId) {
            // Copy chat history and timeline BEFORE switching to new agent
            // (this fires before the HTTP response in instructAgent, preventing empty chat)
            set((s) => {
              const chatHistory = { ...s.chatHistory };
              const tokenTimeline = { ...s.tokenTimeline };
              const oldChat = chatHistory[msg.oldAgentId] || [];
              const oldTimeline = tokenTimeline[msg.oldAgentId] || [];
              if (oldChat.length > 0) chatHistory[msg.newAgentId] = [...oldChat];
              if (oldTimeline.length > 0) tokenTimeline[msg.newAgentId] = [...oldTimeline];
              return {
                chatHistory,
                tokenTimeline,
                detailPanel: { type: 'agent', agentId: msg.newAgentId },
              };
            });
          }
          break;
        }

        case 'rotation:failed':
          get().showStatus(`rotation failed: ${msg.error}`);
          break;

        case 'file:changed': {
          const savedAt = get().editorRecentSaves[msg.path];
          if (savedAt && Date.now() - savedAt < 2000) break; // ignore self-triggered
          set((s) => ({
            editorChangedFiles: { ...s.editorChangedFiles, [msg.path]: msg.timestamp },
          }));
          break;
        }

        case 'journalist:cycle':
          break; // Journalist feed polls separately
      }
    };

    ws.onclose = () => {
      set({ connected: false, ws: null, daemonHost: null, tunneled: false });
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
    // Carry chat history from old agent to new (same conversation, new ID)
    const oldChat = get().chatHistory[id] || [];
    if (oldChat.length > 0) {
      set((s) => {
        const history = { ...s.chatHistory };
        history[newAgent.id] = [...oldChat];
        return { chatHistory: history };
      });
    }
    // Also carry token timeline for continuity in stats
    const oldTimeline = get().tokenTimeline[id] || [];
    if (oldTimeline.length > 0) {
      set((s) => {
        const timeline = { ...s.tokenTimeline };
        timeline[newAgent.id] = [...oldTimeline];
        return { tokenTimeline: timeline };
      });
    }
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

  // Editor actions
  async openFile(path) {
    // Already loaded — just switch tab
    if (get().editorFiles[path] || get().editorOpenTabs.includes(path)) {
      set((s) => ({
        editorActiveFile: path,
        editorOpenTabs: s.editorOpenTabs.includes(path) ? s.editorOpenTabs : [...s.editorOpenTabs, path],
      }));
      return;
    }

    // Media files — open as tab directly (served via /api/files/raw)
    const ext = path.split('.').pop()?.toLowerCase();
    const MEDIA_EXTS = ['png','jpg','jpeg','gif','svg','webp','ico','bmp','avif','mp4','webm','mov','avi','mkv','ogv'];
    if (MEDIA_EXTS.includes(ext)) {
      set((s) => ({
        editorActiveFile: path,
        editorOpenTabs: [...s.editorOpenTabs, path],
      }));
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/api/files/read?path=${encodeURIComponent(path)}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        get().showStatus(err.error || 'Failed to read file');
        return;
      }
      const data = await res.json();
      if (data.binary) {
        get().showStatus('Binary file — cannot open');
        return;
      }
      set((s) => ({
        editorFiles: {
          ...s.editorFiles,
          [path]: { content: data.content, originalContent: data.content, language: data.language, loadedAt: Date.now() },
        },
        editorActiveFile: path,
        editorOpenTabs: s.editorOpenTabs.includes(path) ? s.editorOpenTabs : [...s.editorOpenTabs, path],
      }));
      // Tell daemon to watch this file
      const ws = get().ws;
      if (ws?.readyState === 1) {
        ws.send(JSON.stringify({ type: 'editor:watch', path }));
      }
    } catch {
      get().showStatus('Failed to open file');
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
    // Stop watching
    const ws = get().ws;
    if (ws?.readyState === 1) {
      ws.send(JSON.stringify({ type: 'editor:unwatch', path }));
    }
  },

  setActiveFile(path) {
    set({ editorActiveFile: path });
  },

  updateFileContent(path, content) {
    set((s) => ({
      editorFiles: {
        ...s.editorFiles,
        [path]: { ...s.editorFiles[path], content },
      },
    }));
  },

  async saveFile(path) {
    const file = get().editorFiles[path];
    if (!file) return;
    try {
      const res = await fetch(`${API_BASE}/api/files/write`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, content: file.content }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        get().showStatus(err.error || 'Save failed');
        return;
      }
      set((s) => ({
        editorFiles: {
          ...s.editorFiles,
          [path]: { ...s.editorFiles[path], originalContent: file.content },
        },
        editorChangedFiles: (() => {
          const c = { ...s.editorChangedFiles };
          delete c[path];
          return c;
        })(),
        editorRecentSaves: { ...s.editorRecentSaves, [path]: Date.now() },
      }));
      get().showStatus('Saved');
    } catch {
      get().showStatus('Save failed');
    }
  },

  async reloadFile(path) {
    try {
      const res = await fetch(`${API_BASE}/api/files/read?path=${encodeURIComponent(path)}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.binary) return;
      set((s) => ({
        editorFiles: {
          ...s.editorFiles,
          [path]: { content: data.content, originalContent: data.content, language: data.language, loadedAt: Date.now() },
        },
        editorChangedFiles: (() => {
          const c = { ...s.editorChangedFiles };
          delete c[path];
          return c;
        })(),
      }));
    } catch { /* ignore */ }
  },

  dismissFileChange(path) {
    set((s) => {
      const c = { ...s.editorChangedFiles };
      delete c[path];
      return { editorChangedFiles: c };
    });
  },

  async fetchTreeDir(dirPath) {
    try {
      const res = await fetch(`${API_BASE}/api/files/tree?path=${encodeURIComponent(dirPath)}`);
      if (!res.ok) return;
      const data = await res.json();
      set((s) => ({
        editorTreeCache: { ...s.editorTreeCache, [dirPath]: data.entries },
      }));
    } catch { /* ignore */ }
  },

  async createFile(relPath) {
    try {
      const res = await fetch(`${API_BASE}/api/files/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: relPath }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        get().showStatus(err.error || 'Create failed');
        return false;
      }
      // Refresh parent directory in tree
      const parentDir = relPath.includes('/') ? relPath.split('/').slice(0, -1).join('/') : '';
      await get().fetchTreeDir(parentDir);
      get().showStatus('File created');
      return true;
    } catch {
      get().showStatus('Create failed');
      return false;
    }
  },

  async createDir(relPath) {
    try {
      const res = await fetch(`${API_BASE}/api/files/mkdir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: relPath }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        get().showStatus(err.error || 'Create failed');
        return false;
      }
      const parentDir = relPath.includes('/') ? relPath.split('/').slice(0, -1).join('/') : '';
      await get().fetchTreeDir(parentDir);
      get().showStatus('Folder created');
      return true;
    } catch {
      get().showStatus('Create failed');
      return false;
    }
  },

  async deleteFile(relPath) {
    try {
      const res = await fetch(`${API_BASE}/api/files/delete?path=${encodeURIComponent(relPath)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        get().showStatus(err.error || 'Delete failed');
        return false;
      }
      // Close tab if open
      if (get().editorOpenTabs.includes(relPath)) {
        get().closeFile(relPath);
      }
      // Refresh parent
      const parentDir = relPath.includes('/') ? relPath.split('/').slice(0, -1).join('/') : '';
      await get().fetchTreeDir(parentDir);
      // Also clear cached children if it was a dir
      set((s) => {
        const cache = { ...s.editorTreeCache };
        delete cache[relPath];
        return { editorTreeCache: cache };
      });
      get().showStatus('Deleted');
      return true;
    } catch {
      get().showStatus('Delete failed');
      return false;
    }
  },

  async renameFile(oldPath, newPath) {
    try {
      const res = await fetch(`${API_BASE}/api/files/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPath, newPath }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        get().showStatus(err.error || 'Rename failed');
        return false;
      }
      // Update open tabs if renamed file was open
      set((s) => {
        const tabs = s.editorOpenTabs.map((t) => t === oldPath ? newPath : t);
        const files = { ...s.editorFiles };
        if (files[oldPath]) {
          files[newPath] = files[oldPath];
          delete files[oldPath];
        }
        const active = s.editorActiveFile === oldPath ? newPath : s.editorActiveFile;
        return { editorOpenTabs: tabs, editorFiles: files, editorActiveFile: active };
      });
      // Refresh both parent dirs
      const oldParent = oldPath.includes('/') ? oldPath.split('/').slice(0, -1).join('/') : '';
      const newParent = newPath.includes('/') ? newPath.split('/').slice(0, -1).join('/') : '';
      await get().fetchTreeDir(oldParent);
      if (newParent !== oldParent) await get().fetchTreeDir(newParent);
      get().showStatus('Renamed');
      return true;
    } catch {
      get().showStatus('Rename failed');
      return false;
    }
  },

  addCommand(text) {
    set((s) => ({
      commandHistory: [...s.commandHistory.slice(-49), text],
    }));
  },
}));
