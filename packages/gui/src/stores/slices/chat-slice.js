// FSL-1.1-Apache-2.0 — see LICENSE

import { api } from '../../lib/api';
import { loadJSON, persistJSON } from '../helpers.js';

const _modeChangePending = new Set();

export const createChatSlice = (set, get) => ({
  // ── Conversations (Chat view) ────────────────────────────
  conversations: [],
  activeConversationId: localStorage.getItem('groove:activeConversationId') || null,
  conversationMessages: loadJSON('groove:conversationMessages'),
  sendingMessage: false,
  streamingConversationId: null,
  conversationRoles: loadJSON('groove:conversationRoles'),
  conversationReasoningEffort: loadJSON('groove:conversationReasoningEffort'),
  conversationVerbosity: loadJSON('groove:conversationVerbosity'),

  // ── Conversations (Chat view) ────────────────────────────

  async fetchConversations() {
    try {
      const data = await api.get('/conversations');
      set({ conversations: data.conversations || data || [] });
    } catch { /* endpoint may not exist yet */ }
  },

  async createConversation(provider, model, mode = 'api') {
    try {
      const conv = await api.post('/conversations', { provider, model, mode });
      set((s) => ({
        conversations: [conv, ...s.conversations.filter((c) => c.id !== conv.id)],
        activeConversationId: conv.id,
      }));
      localStorage.setItem('groove:activeConversationId', conv.id);
      return conv;
    } catch (err) {
      get().addToast('error', 'Failed to create conversation', err.message);
      throw err;
    }
  },

  async setConversationMode(id, mode) {
    if (_modeChangePending.has(id)) return;
    _modeChangePending.add(id);
    try {
      const conv = await api.patch(`/conversations/${encodeURIComponent(id)}`, { mode });
      set((s) => ({ conversations: s.conversations.map((c) => c.id === id ? { ...c, ...conv } : c) }));
    } catch (err) {
      get().addToast('error', 'Mode change failed', err.message);
    } finally {
      _modeChangePending.delete(id);
    }
  },

  async setConversationModel(id, provider, model) {
    try {
      const conv = await api.patch(`/conversations/${encodeURIComponent(id)}`, { provider, model });
      set((s) => ({ conversations: s.conversations.map((c) => c.id === id ? { ...c, ...conv } : c) }));
    } catch (err) {
      get().addToast('error', 'Model change failed', err.message);
    }
  },

  async stopChatStreaming(conversationId) {
    try {
      await api.post(`/conversations/${encodeURIComponent(conversationId)}/stop`);
      set({ sendingMessage: false, streamingConversationId: null });
    } catch { /* ignore */ }
  },

  async deleteConversation(id) {
    try {
      await api.delete(`/conversations/${encodeURIComponent(id)}`);
      set((s) => {
        const conversations = s.conversations.filter((c) => c.id !== id);
        const conversationMessages = { ...s.conversationMessages };
        delete conversationMessages[id];
        persistJSON('groove:conversationMessages', conversationMessages);
        const activeConversationId = s.activeConversationId === id
          ? (conversations[0]?.id || null)
          : s.activeConversationId;
        localStorage.setItem('groove:activeConversationId', activeConversationId || '');
        const conversationRoles = { ...s.conversationRoles };
        delete conversationRoles[id];
        persistJSON('groove:conversationRoles', conversationRoles);
        const conversationReasoningEffort = { ...s.conversationReasoningEffort };
        delete conversationReasoningEffort[id];
        persistJSON('groove:conversationReasoningEffort', conversationReasoningEffort);
        const conversationVerbosity = { ...s.conversationVerbosity };
        delete conversationVerbosity[id];
        persistJSON('groove:conversationVerbosity', conversationVerbosity);
        return { conversations, conversationMessages, conversationRoles, conversationReasoningEffort, conversationVerbosity, activeConversationId };
      });
    } catch (err) {
      get().addToast('error', 'Delete failed', err.message);
    }
  },

  async renameConversation(id, title) {
    try {
      const conv = await api.patch(`/conversations/${encodeURIComponent(id)}`, { title });
      set((s) => ({ conversations: s.conversations.map((c) => c.id === id ? { ...c, ...conv } : c) }));
    } catch (err) {
      get().addToast('error', 'Rename failed', err.message);
    }
  },

  async pinConversation(id, pinned) {
    try {
      const conv = await api.patch(`/conversations/${encodeURIComponent(id)}`, { pinned });
      set((s) => ({ conversations: s.conversations.map((c) => c.id === id ? { ...c, ...conv } : c) }));
    } catch (err) {
      get().addToast('error', 'Pin failed', err.message);
    }
  },

  setActiveConversation(id) {
    set({ activeConversationId: id });
    localStorage.setItem('groove:activeConversationId', id || '');
  },

  setConversationRole(id, role) {
    set((s) => {
      const roles = { ...s.conversationRoles };
      if (role) {
        roles[id] = role;
      } else {
        delete roles[id];
      }
      persistJSON('groove:conversationRoles', roles);
      return { conversationRoles: roles };
    });
  },

  setConversationReasoningEffort(id, effort) {
    set((s) => {
      const map = { ...s.conversationReasoningEffort };
      map[id] = effort || 'medium';
      persistJSON('groove:conversationReasoningEffort', map);
      return { conversationReasoningEffort: map };
    });
  },

  setConversationVerbosity(id, verbosity) {
    set((s) => {
      const map = { ...s.conversationVerbosity };
      map[id] = verbosity || 'medium';
      persistJSON('groove:conversationVerbosity', map);
      return { conversationVerbosity: map };
    });
  },

  async sendChatMessage(conversationId, message) {
    const conv = get().conversations.find((c) => c.id === conversationId);
    if (!conv) return;

    // Add user message to local state immediately
    set((s) => {
      const msgs = { ...s.conversationMessages };
      if (!msgs[conversationId]) msgs[conversationId] = [];
      msgs[conversationId] = [...msgs[conversationId], { from: 'user', text: message, timestamp: Date.now() }];
      persistJSON('groove:conversationMessages', msgs);
      return { conversationMessages: msgs, sendingMessage: true, streamingConversationId: conversationId };
    });

    try {
      const body = { message };
      const history = get().conversationMessages[conversationId] || [];
      body.history = history.slice(0, -1);

      const role = get().conversationRoles?.[conversationId];
      const rules = ['Never use emojis in your responses.', 'Be professional, concise, and direct.'];
      if (role && role !== 'chat') rules.unshift(`You are a professional ${role}. Respond with deep expertise in that domain.`);
      if (role === 'research') rules.unshift('You are a research assistant. Help explore ideas, synthesize information, and provide thorough analysis with sources when possible.');
      const systemCtx = rules.join(' ');
      body.history = [
        { from: 'user', text: `Instructions: ${systemCtx}` },
        { from: 'assistant', text: 'Understood.' },
        ...body.history,
      ];
      const effort = get().conversationReasoningEffort?.[conversationId] || 'medium';
      const verbosity = get().conversationVerbosity?.[conversationId] || 'medium';
      if (conv.provider === 'codex') {
        body.reasoning_effort = effort;
        body.verbosity = verbosity;
      }
      await api.post(`/conversations/${encodeURIComponent(conversationId)}/message`, body);
    } catch (err) {
      set((s) => {
        const msgs = { ...s.conversationMessages };
        if (!msgs[conversationId]) msgs[conversationId] = [];
        msgs[conversationId] = [...msgs[conversationId], { from: 'system', text: `Failed: ${err.message}`, timestamp: Date.now() }];
        persistJSON('groove:conversationMessages', msgs);
        return { conversationMessages: msgs, sendingMessage: false, streamingConversationId: null };
      });
      get().addToast('error', 'Message failed', err.message);
    }
  },

  async sendImageMessage(conversationId, prompt, { model, size, quality } = {}) {
    const conv = get().conversations.find((c) => c.id === conversationId);
    if (!conv) return;

    set((s) => {
      const msgs = { ...s.conversationMessages };
      if (!msgs[conversationId]) msgs[conversationId] = [];
      msgs[conversationId] = [...msgs[conversationId], { from: 'user', text: prompt, timestamp: Date.now() }];
      persistJSON('groove:conversationMessages', msgs);
      return { conversationMessages: msgs, sendingMessage: true, streamingConversationId: conversationId };
    });

    try {
      await api.post(`/conversations/${encodeURIComponent(conversationId)}/generate-image`, { prompt, model, size, quality });
    } catch (err) {
      set((s) => {
        const msgs = { ...s.conversationMessages };
        if (!msgs[conversationId]) msgs[conversationId] = [];
        msgs[conversationId] = [...msgs[conversationId], { from: 'system', text: `Image failed: ${err.message}`, timestamp: Date.now() }];
        persistJSON('groove:conversationMessages', msgs);
        return { conversationMessages: msgs, sendingMessage: false, streamingConversationId: null };
      });
      get().addToast('error', 'Image generation failed', err.message);
    }
  },
});
