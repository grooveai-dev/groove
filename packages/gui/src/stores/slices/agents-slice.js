// FSL-1.1-Apache-2.0 — see LICENSE

import { api } from '../../lib/api';
import { loadJSON, persistJSON } from '../helpers.js';

export const createAgentsSlice = (set, get) => ({
  // ── Agent data ────────────────────────────────────────────
  agents: [],
  activityLog: loadJSON('groove:activityLog'),
  chatHistory: loadJSON('groove:chatHistory'),
  chatInputs: {},   // Per-agent draft input text — persists across tab switches
  tokenTimeline: {},

  // Track which agents are thinking (sent a message, waiting for response)
  thinkingAgents: new Set(),

  // ── Workspace Mode ────────────────────────────────────────
  workspaceMode: localStorage.getItem('groove:workspaceMode') === 'true',
  workspaceAgentId: null,
  workspaceReviewMode: false,
  workspaceReviewFiles: [],

  // ── Keeper (tagged memory) ─────────────────────────────────
  keeperItems: [],
  keeperTree: [],
  keeperEditing: null,  // { tag, content, isNew, readOnly } — drives the editor modal
  keeperInstructOpen: false,

  // ── Agent Actions ─────────────────────────────────────────

  selectAgent(id) {
    const tid = get().activeTeamId;
    const match = get().agents.find((a) => a.id === id);
    if (tid && match && match.teamId && match.teamId !== tid) return;
    const panel = { type: 'agent', agentId: id };
    set((s) => ({ detailPanel: panel, teamDetailPanels: { ...s.teamDetailPanels, [tid]: panel } }));
  },

  async spawnAgent(config) {
    try {
      const teamId = get().activeTeamId;
      const agent = await api.post('/agents', { ...config, teamId });
      get().addToast('success', `Spawned ${agent.name}`);
      return agent;
    } catch (err) {
      let detail = err.message;
      if (detail?.includes('workingDir must be within project directory')) {
        const projDir = get().projectDir || 'unknown';
        const workDir = config.workingDir || 'default';
        detail = `workingDir "${workDir}" is outside project directory "${projDir}". Change the project directory or pick a subfolder within it.`;
      }
      get().addToast('error', 'Spawn failed', detail);
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
    // ── Keeper command interception ─────────────────────────
    const keeperCmd = message.match(/\[(save|append|update|delete|view|doc|link|read|instruct)\]/i);
    if (keeperCmd) {
      const handled = await get()._handleKeeperCommand(id, message, keeperCmd[1].toLowerCase());
      if (handled === true) return { status: 'keeper_handled' };
      if (handled?.passthrough) {
        message = handled.passthrough;
      }
    }

    get().addChatMessage(id, 'user', message, false);
    set((s) => ({ thinkingAgents: new Set([...s.thinkingAgents, id]) }));

    // Auto-attach active file context when in workspace mode
    let enriched = message;
    if (get().workspaceMode && get().workspaceAgentId === id && get().editorActiveFile) {
      const filePath = get().editorActiveFile;
      enriched = `[Active file: ${filePath}]\n\n${message}`;
    }

    const snapshot = {
      chatHistory: [...(get().chatHistory[id] || [])],
      activityLog: [...(get().activityLog[id] || [])],
      tokenTimeline: [...(get().tokenTimeline[id] || [])],
    };

    try {
      const data = await api.post(`/agents/${encodeURIComponent(id)}/instruct`, { message: enriched });

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
      if (get().labAssistantAgentId === id) {
        localStorage.setItem('groove:labAssistantAgentId', newAgent.id);
        set({ labAssistantAgentId: newAgent.id });
      } else {
        get().selectAgent(newAgent.id);
      }
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

  // ── Workspace Mode ────────────────────────────────────────

  setWorkspaceMode(on) {
    set({ workspaceMode: on });
    localStorage.setItem('groove:workspaceMode', String(on));
    if (on) {
      const teamAgents = get().agents.filter((a) => a.teamId === get().activeTeamId);
      const current = get().workspaceAgentId;
      const belongsToTeam = current && teamAgents.some((a) => a.id === current);
      if (!belongsToTeam) {
        const selected = get().detailPanel?.type === 'agent' ? get().detailPanel.agentId : null;
        const selectedInTeam = selected && teamAgents.some((a) => a.id === selected);
        const running = teamAgents.find((a) => a.status === 'running');
        set({ workspaceAgentId: (selectedInTeam ? selected : null) || running?.id || teamAgents[0]?.id || null });
      }
      const agentId = get().workspaceAgentId;
      if (agentId) get().selectAgent(agentId);
    }
  },

  setWorkspaceAgent(id) {
    set({ workspaceAgentId: id });
    if (id) get().selectAgent(id);
  },

  async toggleReviewMode() {
    const st = get();
    if (st.workspaceReviewMode) {
      set({ workspaceReviewMode: false, workspaceReviewFiles: [] });
      return;
    }
    const agentId = st.workspaceAgentId;
    if (!agentId) return;
    try {
      const res = await api.get(`/agents/${agentId}/files-touched`);
      const touched = res.data || [];
      const files = touched
        .filter((f) => f.writes > 0)
        .map((f) => ({ path: f.path, status: 'pending', comment: '' }));
      set({ workspaceReviewMode: true, workspaceReviewFiles: files });
    } catch (err) {
      console.error('Failed to fetch touched files for review:', err);
    }
  },

  approveFile(path) {
    set((s) => ({
      workspaceReviewFiles: s.workspaceReviewFiles.map((f) =>
        f.path === path ? { ...f, status: 'approved' } : f,
      ),
    }));
  },

  rejectFile(path) {
    set((s) => ({
      workspaceReviewFiles: s.workspaceReviewFiles.map((f) =>
        f.path === path ? { ...f, status: 'rejected' } : f,
      ),
    }));
  },

  commentFile(path, comment) {
    set((s) => ({
      workspaceReviewFiles: s.workspaceReviewFiles.map((f) =>
        f.path === path ? { ...f, comment } : f,
      ),
    }));
  },

  // ── Keeper (tagged memory) ────────────────────────────────

  async fetchKeeperItems() {
    try {
      const data = await api.get('/keeper');
      const treeData = await api.get('/keeper/tree');
      set({ keeperItems: data.items || [], keeperTree: treeData.tree || [] });
    } catch { /* ignore */ }
  },

  async saveKeeperItem(tag, content) {
    try {
      const item = await api.post('/keeper', { tag, content });
      get().fetchKeeperItems();
      get().addToast('success', `Saved #${item.tag}`);
      return item;
    } catch (err) {
      get().addToast('error', 'Failed to save memory', err.message);
      throw err;
    }
  },

  async appendKeeperItem(tag, content) {
    try {
      const item = await api.post('/keeper/append', { tag, content });
      get().fetchKeeperItems();
      get().addToast('success', `Appended to #${item.tag}`);
      return item;
    } catch (err) {
      get().addToast('error', 'Failed to append', err.message);
      throw err;
    }
  },

  async updateKeeperItem(tag, content) {
    try {
      const item = await api.patch(`/keeper/${tag}`, { content });
      get().fetchKeeperItems();
      get().addToast('success', `Updated #${item.tag}`);
      return item;
    } catch (err) {
      get().addToast('error', 'Failed to update memory', err.message);
      throw err;
    }
  },

  async deleteKeeperItem(tag) {
    try {
      await api.delete(`/keeper/${tag}`);
      get().fetchKeeperItems();
      get().addToast('success', `Deleted #${tag}`);
    } catch (err) {
      get().addToast('error', 'Failed to delete memory', err.message);
    }
  },

  async getKeeperItem(tag) {
    try {
      return await api.get(`/keeper/${tag}`);
    } catch {
      return null;
    }
  },

  async searchKeeper(query) {
    try {
      const data = await api.get(`/keeper/search?q=${encodeURIComponent(query)}`);
      return data.results || [];
    } catch {
      return [];
    }
  },

  setKeeperEditing(editing) {
    set({ keeperEditing: editing });
  },

  async _handleKeeperCommand(agentId, message, command) {
    const rest = message.replace(/\[\w+[-\w]*\]/i, '').trim();
    const tags = (rest.match(/#[\w/.-]+/g) || []).map(t => t.replace(/^#/, ''));

    const addSystemMsg = (text) => {
      get().addChatMessage(agentId, 'system', text);
    };

    try {
      switch (command) {
        case 'instruct': {
          set({ keeperInstructOpen: true });
          return true;
        }

        case 'save': {
          if (tags.length === 0) { addSystemMsg('Usage: save #tag your message here'); return true; }
          const content = rest.replace(/#[\w/.-]+/g, '').trim();
          if (!content) { addSystemMsg('Usage: save #tag your message here'); return true; }
          await get().saveKeeperItem(tags[0], content);
          addSystemMsg(`Saved to #${tags[0]}`);
          return { passthrough: content };
        }

        case 'append': {
          if (tags.length === 0) { addSystemMsg('Usage: append #tag content to add'); return true; }
          const content = rest.replace(/#[\w/.-]+/g, '').trim();
          if (!content) { addSystemMsg('Usage: append #tag content to add'); return true; }
          await get().appendKeeperItem(tags[0], content);
          addSystemMsg(`Appended to #${tags[0]}`);
          return { passthrough: content };
        }

        case 'update': {
          if (tags.length === 0) { addSystemMsg('Usage: [update] #tag'); return true; }
          get().addChatMessage(agentId, 'user', message, false);
          const existing = await get().getKeeperItem(tags[0]);
          set({ keeperEditing: { tag: tags[0], content: existing?.content || '', isNew: !existing } });
          return true;
        }

        case 'delete': {
          if (tags.length === 0) { addSystemMsg('Usage: [delete] #tag'); return true; }
          get().addChatMessage(agentId, 'user', message, false);
          await get().deleteKeeperItem(tags[0]);
          addSystemMsg(`Deleted #${tags[0]}`);
          return true;
        }

        case 'view': {
          if (tags.length === 0) { addSystemMsg('Usage: [view] #tag'); return true; }
          get().addChatMessage(agentId, 'user', message, false);
          const item = await get().getKeeperItem(tags[0]);
          if (item) {
            set({ keeperEditing: { tag: tags[0], content: item.content, isNew: false, readOnly: true } });
          } else {
            addSystemMsg(`#${tags[0]} not found`);
          }
          return true;
        }

        case 'read': {
          if (tags.length === 0) { addSystemMsg('Usage: [read] #tag1 #tag2 ...'); return true; }
          get().addChatMessage(agentId, 'user', message, false);
          const readBrief = await api.post('/keeper/pull', { tags });
          if (readBrief?.brief) {
            await api.post(`/agents/${encodeURIComponent(agentId)}/instruct`, {
              message: `Here is context from my tagged memories:\n\n${readBrief.brief}`,
            });
            addSystemMsg(`Sent ${tags.map(t => '#' + t).join(', ')} to agent`);
          } else {
            addSystemMsg(`No memories found for ${tags.map(t => '#' + t).join(', ')}`);
          }
          return true;
        }

        case 'doc': {
          if (tags.length === 0) { addSystemMsg('Usage: [doc] #tag'); return true; }
          get().addChatMessage(agentId, 'user', message, false);
          addSystemMsg(`Generating doc for #${tags[0]}...`);
          const history = get().chatHistory[agentId] || [];
          const result = await api.post('/keeper/doc', { tag: tags[0], chatHistory: history, agentId });
          if (result?.content) {
            addSystemMsg(`Doc #${tags[0]} generated (${result.size}B)`);
            set({ keeperEditing: { tag: tags[0], content: result.content, isNew: false } });
          }
          return true;
        }

        case 'link': {
          const linkMatch = rest.match(/^((?:#[\w/.-]+\s*)+)\s+(.+)$/);
          if (!linkMatch || tags.length === 0) { addSystemMsg('Usage: [link] #tag path/to/doc'); return true; }
          const docPath = linkMatch[2].trim();
          get().addChatMessage(agentId, 'user', message, false);
          await api.post('/keeper/link', { tag: tags[0], docPath });
          addSystemMsg(`Linked #${tags[0]} → ${docPath}`);
          return true;
        }
      }
    } catch (err) {
      addSystemMsg(`Keeper error: ${err.message}`);
      return true;
    }
    return false;
  },
});
