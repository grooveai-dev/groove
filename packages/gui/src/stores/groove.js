// GROOVE GUI v2 — Zustand Store (composed from slices)
// FSL-1.1-Apache-2.0 — see LICENSE

import { create } from 'zustand';
import { api } from '../lib/api';
import { persistJSON } from './helpers.js';
import { createUiSlice } from './slices/ui-slice.js';
import { createAgentsSlice } from './slices/agents-slice.js';
import { createTeamsSlice } from './slices/teams-slice.js';
import { createChatSlice } from './slices/chat-slice.js';
import { createEditorSlice } from './slices/editor-slice.js';
import { createProvidersSlice } from './slices/providers-slice.js';
import { createNetworkSlice } from './slices/network-slice.js';
import { createPreviewSlice } from './slices/preview-slice.js';
import { createMarketplaceSlice } from './slices/marketplace-slice.js';
import { createAutomationsSlice } from './slices/automations-slice.js';

const WS_URL = `ws://${window.location.hostname}:${window.location.port || 31415}`;

let plannerPollInterval = null;

// Clear stale persisted data on version change
const STORE_VERSION = '0.22.28';
if (localStorage.getItem('groove:storeVersion') !== JSON.stringify(STORE_VERSION)) {
  localStorage.removeItem('groove:chatHistory');
  localStorage.removeItem('groove:activityLog');
  persistJSON('groove:storeVersion', STORE_VERSION);
}

export const useGrooveStore = create((set, get) => ({
  // ── Spread all slices ───────────────────────────────────────
  ...createUiSlice(set, get),
  ...createAgentsSlice(set, get),
  ...createTeamsSlice(set, get),
  ...createChatSlice(set, get),
  ...createEditorSlice(set, get),
  ...createProvidersSlice(set, get),
  ...createNetworkSlice(set, get),
  ...createPreviewSlice(set, get),
  ...createMarketplaceSlice(set, get),
  ...createAutomationsSlice(set, get),

  // ── Connection ────────────────────────────────────────────
  connected: false,
  hydrated: false,
  ws: null,
  daemonHost: null,
  tunneled: false,
  remoteHomedir: null,

  connect() {
    if (get().ws) return;
    const ws = new WebSocket(WS_URL);
    set({ ws });

    ws.onopen = () => {
      set({ connected: true });
      api.get('/status').then((s) => {
        const updates = {};
        if (s.host && s.host !== '127.0.0.1') updates.daemonHost = s.host;
        const browserPort = window.location.port || '80';
        const isTunneled = String(s.port) !== browserPort;
        if (isTunneled) updates.tunneled = true;
        if (s.version) updates.version = s.version;
        if (s.homedir) updates.remoteHomedir = s.homedir;
        if (Object.keys(updates).length > 0) set(updates);
        if (isTunneled) get().fetchProjectDir();
      }).catch(() => {});
      get().fetchTeams();
      get().fetchConversations();
      get().fetchApprovals();
      get().checkMarketplaceAuth();
      get().fetchTunnels();
      get().fetchBetaStatus();
      get().fetchNetworkInstallStatus();
      get().fetchTrainingStatus();
      api.get('/config').then((cfg) => {
        if (cfg?.dataSharingDismissed) set({ dataSharingDismissed: true });
      }).catch(() => {});
      setTimeout(() => {
        const st = get();
        if (!st.trainingOptIn && !st.dataSharingDismissed) {
          set({ dataSharingModalOpen: true });
        }
      }, 1500);
      get().fetchActivePreviews();
      ws.send(JSON.stringify({ type: 'editor:watchdir', path: '' }));
      if (!get().onboardingComplete) get().fetchOnboardingStatus();
      if (window.groove?.auth?.onSubscriptionStatus) {
        window.groove.auth.onSubscriptionStatus((data) => {
          if (data) set({ subscription: { ...get().subscription, ...data } });
        });
      }
      if (window.groove?.update?.onUpdateAvailable) {
        window.groove.update.onUpdateAvailable((data) => {
          set({ updateProgress: { percent: 0, version: data.version } });
        });
      }
      if (window.groove?.update?.onUpdateProgress) {
        window.groove.update.onUpdateProgress((data) => {
          set({ updateProgress: data });
        });
      }
      if (window.groove?.update?.onUpdateDownloaded) {
        window.groove.update.onUpdateDownloaded((data) => {
          set({ updateReady: data.version, updateModalOpen: true, updateProgress: null });
        });
      }
      if (window.groove?.update?.getUpdateStatus) {
        window.groove.update.getUpdateStatus().then((state) => {
          if (!state) return;
          if (state.downloaded) {
            set({ updateReady: state.downloaded.version, updateProgress: null });
          } else if (state.progress) {
            set({ updateProgress: state.progress });
          } else if (state.available) {
            set({ updateProgress: { percent: 0, version: state.available.version } });
          }
        }).catch(() => {});
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
          const st = get();
          for (const id of Object.keys(timeline)) if (!liveIds.has(id)) delete timeline[id];
          const prev = st.agents;
          const changed = msg.data.length !== prev.length || msg.data.some((a, i) => {
            const p = prev[i];
            return !p || p.id !== a.id || p.status !== a.status || p.tokensUsed !== a.tokensUsed
              || p.contextUsage !== a.contextUsage || p.name !== a.name || p.model !== a.model;
          });
          set({ agents: changed ? msg.data : prev, tokenTimeline: timeline, hydrated: true });

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

          let chatText = '';
          let activityText = '';
          if (typeof data.data === 'string') {
            chatText = data.data;
          } else if (Array.isArray(data.data)) {
            chatText = data.data.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
            activityText = data.data.filter((b) => b.type === 'tool_use').map((b) => {
              const summary = `${b.name}: ${typeof b.input === 'string' ? b.input.slice(0, 80) : (b.input?.command || b.input?.path || b.input?.pattern || JSON.stringify(b.input || '').slice(0, 80))}`;
              return b.result ? `${summary}\n${typeof b.result === 'string' ? b.result.slice(0, 500) : JSON.stringify(b.result).slice(0, 500)}` : summary;
            }).join('\n');
          }

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

          const isTokenStream = data.subtype === 'stream';
          const showAsChat = chatText && chatText.trim() && !isTokenStream && (
            data.subtype === 'assistant' || data.subtype === 'text' || data.type === 'result' ||
            (data.type === 'activity' && typeof data.data === 'string')
          );
          if (showAsChat) {
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

            const isDupe = isRecent && (last.text === trimmed || last.text.endsWith(trimmed));

            if (!isDupe) {
              if (isRecent) {
                const sep = data.subtype === 'assistant' ? '\n\n' : ' ';
                arr[arr.length - 1] = { ...last, text: last.text + sep + trimmed, timestamp: Date.now() };
              } else {
                arr.push({ from: 'agent', text: trimmed, timestamp: Date.now() });
              }

              history[agentId] = arr.slice(-100);
              set({ chatHistory: history });
              persistJSON('groove:chatHistory', history);
            }

            const conv = get().conversations.find((c) => c.agentId === agentId);
            if (conv) {
              const convMsgs = { ...get().conversationMessages };
              if (!convMsgs[conv.id]) convMsgs[conv.id] = [];
              const convArr = [...convMsgs[conv.id]];
              const lastConv = convArr[convArr.length - 1];
              const isRecentConv = lastConv && lastConv.from === 'assistant' && (Date.now() - lastConv.timestamp) < 8000;
              const isConvDupe = isRecentConv && (lastConv.text === trimmed || lastConv.text.endsWith(trimmed));
              if (!isConvDupe) {
                if (isRecentConv) {
                  const sep = data.subtype === 'assistant' ? '\n\n' : ' ';
                  convArr[convArr.length - 1] = { ...lastConv, text: lastConv.text + sep + trimmed, timestamp: Date.now() };
                } else {
                  convArr.push({ from: 'assistant', text: trimmed, timestamp: Date.now() });
                }
                convMsgs[conv.id] = convArr.slice(-200);
                set({ conversationMessages: convMsgs, streamingConversationId: conv.id });
                persistJSON('groove:conversationMessages', convMsgs);
              }
            }
          }

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

          if (get().workspaceMode && Array.isArray(data.data)) {
            const WRITE_TOOLS = new Set(['Write', 'Edit', 'write_file', 'edit_file', 'create_file']);
            for (const block of data.data) {
              if (block.type !== 'tool_use' || !WRITE_TOOLS.has(block.name)) continue;
              const filePath = block.input?.file_path || block.input?.path;
              if (filePath && agentId === get().workspaceAgentId) {
                const relPath = filePath.replace(/^\/[^/]+.*?\/groove\//, '');
                get().openFile(relPath);
              }
            }
          }
          break;
        }

        case 'agent:exit': {
          if (msg.status === 'waiting_for_input') {
            const waitAgent = get().agents.find((a) => a.id === msg.agentId);
            get().addToast('info', `${waitAgent?.name || msg.agentId.slice(0, 8)} needs your input`, 'Check the question popup below');
            break;
          }
          const agent = get().agents.find((a) => a.id === msg.agentId);
          const name = agent?.name || msg.agentId;
          const isKill = msg.status === 'killed' || msg.code === 143 || msg.code === 137;
          const text = msg.status === 'completed' ? `${name} completed`
            : isKill ? `${name} stopped`
            : `${name} crashed (exit ${msg.code})`;
          const type = msg.status === 'completed' ? 'success' : isKill ? 'info' : 'warning';
          get().addToast(type, text, msg.error ? msg.error.slice(0, 200) : undefined);

          if (get().thinkingAgents.has(msg.agentId)) {
            set((s) => {
              const next = new Set(s.thinkingAgents);
              next.delete(msg.agentId);
              return { thinkingAgents: next };
            });
          }

          const exitConv = get().conversations.find((c) => c.agentId === msg.agentId);
          if (exitConv && get().streamingConversationId === exitConv.id) {
            set({ sendingMessage: false, streamingConversationId: null });
          }

          if (msg.error && msg.agentId) {
            get().addChatMessage(msg.agentId, 'system', `Crashed: ${msg.error}`);
          }
          if (get().workspaceAgentId === msg.agentId) {
            const teamAgents = get().agents.filter(
              (a) => a.id !== msg.agentId && a.teamId === get().activeTeamId,
            );
            const next = teamAgents.find((a) => a.status === 'running') || teamAgents[0];
            set({ workspaceAgentId: next?.id || null });
          }

          if (agent?.role === 'planner' && msg.status === 'completed') {
            setTimeout(() => get().checkRecommendedTeam(), 1000);
          }
          break;
        }

        case 'phase2:spawned':
          get().addToast('info', `QC agent ${msg.name} auto-spawned`, 'Auditing phase 1 work');
          break;

        case 'preview:ready': {
          const proxyUrl = msg.teamId ? `/api/preview/${msg.teamId}/proxy/` : msg.url;
          set((s) => ({
            teamPreviews: { ...s.teamPreviews, [msg.teamId]: { url: proxyUrl, kind: msg.kind, active: true } },
          }));
          get().addToast(
            'success',
            'Project ready to preview',
            msg.url,
            { label: 'Open Preview', onClick: () => get().openPreview(proxyUrl, msg.teamId, msg.kind) },
            { persistent: true, actions: [{ label: 'View in Browser', url: msg.url }] },
          );
          break;
        }

        case 'preview:failed': {
          const failKind = msg.kind || '';
          if (failKind !== 'no_preview' && failKind !== 'cli' && failKind !== 'none') {
            get().addToast(
              'warning',
              'Preview could not launch',
              msg.reason ? String(msg.reason).slice(0, 200) : 'Unknown error',
            );
          }
          break;
        }

        case 'preview:stopped': {
          const tp = get().teamPreviews[msg.teamId];
          if (tp) {
            set((s) => ({
              teamPreviews: { ...s.teamPreviews, [msg.teamId]: { ...tp, active: false } },
            }));
          }
          break;
        }

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

        case 'agent:question':
          set((s) => ({ pendingQuestions: [...s.pendingQuestions, msg.data] }));
          break;

        case 'agent:question:resolved':
          set((s) => ({ pendingQuestions: s.pendingQuestions.filter((q) => q.agentId !== msg.agentId) }));
          break;

        case 'ollama:pull:progress':
          set({ ollamaPullProgress: { ...get().ollamaPullProgress, [msg.model]: { status: 'pulling', progress: msg.progress } } });
          break;

        case 'ollama:pull:complete': {
          const pullProg = { ...get().ollamaPullProgress };
          delete pullProg[msg.model];
          set({ ollamaPullProgress: pullProg });
          get().fetchOllamaStatus();
          break;
        }

        case 'ollama:pull:error': {
          const pullProg2 = { ...get().ollamaPullProgress };
          delete pullProg2[msg.model];
          set({ ollamaPullProgress: pullProg2 });
          get().addToast('error', `Model pull failed: ${msg.error}`);
          break;
        }

        case 'ollama:model:loaded':
          get().fetchOllamaStatus();
          break;

        case 'ollama:model:unloaded':
          get().fetchOllamaStatus();
          break;

        case 'ollama:model:imported':
          get().fetchOllamaStatus();
          break;

        case 'lab:runtime:added':
        case 'lab:runtime:updated':
        case 'lab:runtime:removed':
        case 'lab:runtime:started':
        case 'lab:runtime:stopped':
        case 'llama:server:stopped':
          get().fetchLabRuntimes();
          break;

        case 'lab:preset:created':
        case 'lab:preset:updated':
        case 'lab:preset:deleted':
          break;

        case 'rotation:start':
          break;

        case 'rotation:complete': {
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
          if (get().workspaceMode && msg.path && !get().workspaceSnapshots[msg.path]) {
            const existing = get().editorFiles[msg.path];
            if (existing?.content) {
              get().captureSnapshot(msg.path, existing.content);
            }
          }
          if (get().editorFiles[msg.path]) {
            get().reloadFile(msg.path);
          }
          break;
        }

        case 'file:tree-changed': {
          get().fetchTreeDir(msg.path || '');
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
          get().fetchAutomations();
          break;

        case 'schedule:created':
        case 'schedule:updated':
        case 'schedule:deleted':
          get().fetchAutomations();
          break;

        case 'gateway:status':
          set({ gateways: msg.data || [] });
          break;

        case 'provider:status-changed':
          set({ _providerRefreshTick: Date.now() });
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
          get().fetchTunnels();
          set({ tunnelConnectStep: null });
          break;

        case 'tunnel.status': {
          set({ tunnelConnectStep: msg.data });
          break;
        }

        case 'tunnel.disconnected':
          get().fetchTunnels();
          break;

        case 'tunnel.health': {
          const tunnels = get().savedTunnels.map((t) =>
            t.id === msg.data?.id ? { ...t, latencyMs: msg.data.latencyMs, healthy: msg.data.healthy } : t,
          );
          set({ savedTunnels: tunnels });
          break;
        }

        case 'tunnel.version-info': {
          const tunnels = get().savedTunnels.map((t) =>
            t.id === msg.data.id ? { ...t, localVersion: msg.data.localVersion, remoteVersion: msg.data.remoteVersion, versionMatch: msg.data.match } : t
          );
          set({ savedTunnels: tunnels });
          break;
        }
        case 'tunnel.version-mismatch': {
          const tunnels = get().savedTunnels.map((t) =>
            t.id === msg.data.id ? { ...t, localVersion: msg.data.localVersion, remoteVersion: msg.data.remoteVersion, versionMatch: false } : t
          );
          set({ savedTunnels: tunnels });
          get().addToast('warning', 'Version mismatch', `Remote v${msg.data.remoteVersion} — local v${msg.data.localVersion}. ${msg.data.message || ''}`);
          break;
        }
        case 'tunnel.upgrade-failed': {
          get().addToast('error', 'Remote upgrade failed', msg.data.error || 'Unknown error');
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

        case 'network:node:status': {
          const { __proto__: _a, constructor: _b, prototype: _c, ...safeData } = msg.data || {};
          set({ networkNode: { ...get().networkNode, ...safeData } });
          break;
        }

        case 'network:node:event': {
          const ev = msg.data || {};
          set((s) => ({
            networkEvents: [...s.networkEvents, { ...ev, timestamp: ev.timestamp || Date.now() }].slice(-100),
          }));
          break;
        }

        case 'signal_connected': {
          const ev = msg.data || {};
          set((s) => ({
            networkEvents: [...s.networkEvents, {
              level: 'connected',
              msg: String(ev.msg || ev.message || 'Connected to signal').slice(0, 500),
              detail: ev.detail || ev.url || undefined,
              timestamp: ev.timestamp || Date.now(),
            }].slice(-100),
          }));
          break;
        }

        case 'matched': {
          const ev = msg.data || {};
          set((s) => ({
            networkEvents: [...s.networkEvents, {
              level: 'session',
              msg: String(ev.msg || ev.message || 'Session matched').slice(0, 500),
              detail: ev.detail || ev.peer || ev.nodeId || undefined,
              timestamp: ev.timestamp || Date.now(),
            }].slice(-100),
          }));
          break;
        }

        case 'network:status': {
          const nsData = msg.data || {};
          const nsUpdate = { networkStatus: { ...get().networkStatus, ...nsData } };
          if (nsData.compute) {
            const c = nsData.compute;
            nsUpdate.networkCompute = {
              totalRamMb: c.totalRamMb ?? c.total_ram_mb ?? 0,
              totalVramMb: c.totalVramMb ?? c.total_vram_mb ?? 0,
              totalCpuCores: c.totalCpuCores ?? c.total_cpu_cores ?? 0,
              totalBandwidthMbps: c.totalBandwidthMbps ?? c.total_bandwidth_mbps ?? 0,
              activeNodes: c.activeNodes ?? c.active_nodes ?? 0,
              totalNodes: c.totalNodes ?? c.total_nodes ?? 0,
              avgLoad: c.avgLoad ?? c.avg_load ?? 0,
            };
          } else if (Array.isArray(nsData.nodes) && nsData.nodes.length > 0) {
            const wsNodes = nsData.nodes;
            const wsActive = wsNodes.filter((n) => n.status === 'active');
            nsUpdate.networkCompute = {
              totalRamMb: wsNodes.reduce((s, n) => s + (n.ram_mb || 0), 0),
              totalVramMb: wsNodes.reduce((s, n) => s + (n.vram_mb || 0), 0),
              totalCpuCores: wsNodes.reduce((s, n) => s + (n.cpu_cores || 0), 0),
              totalBandwidthMbps: wsNodes.reduce((s, n) => s + (n.bandwidth_mbps || 0), 0),
              activeNodes: wsActive.length,
              totalNodes: wsNodes.length,
              avgLoad: wsActive.length > 0 ? wsActive.reduce((s, n) => s + (n.load || 0), 0) / wsActive.length : 0,
            };
          }
          set(nsUpdate);

          const wsNodes = nsData.nodes || [];
          const wsOwnId = get().networkNode.nodeId;
          const wsOwn = wsOwnId ? wsNodes.find((n) => (n.node_id || n.nodeId) === wsOwnId) : null;
          const wsActive = wsNodes.filter((n) => n.status === 'active');
          const wsSnap = {
            t: Date.now(),
            globalSessions: nsData.activeSessions || 0,
            mySessions: wsOwn?.active_sessions ?? wsOwn?.sessions ?? 0,
            nodeCount: wsActive.length,
            avgLoad: wsActive.length > 0 ? wsActive.reduce((s, n) => s + (n.load || 0), 0) / wsActive.length : 0,
            myLoad: wsOwn?.load ?? 0,
            totalVramMb: wsNodes.reduce((s, n) => s + (n.vram_mb || 0), 0),
            totalRamMb: wsNodes.reduce((s, n) => s + (n.ram_mb || 0), 0),
          };
          let wsSnapshots = [...get().networkSnapshots, wsSnap];
          if (wsSnapshots.length > 100) wsSnapshots = wsSnapshots.slice(-100);
          set({ networkSnapshots: wsSnapshots });

          break;
        }

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

        case 'network:update:available': {
          const { installed, latest, updateAvailable } = msg.data || {};
          set({
            networkVersion: {
              installed: installed ?? get().networkVersion.installed,
              latest: latest ?? get().networkVersion.latest,
              updateAvailable: !!updateAvailable,
            },
          });
          break;
        }

        case 'network:update:progress': {
          const { step, message, percent, version, error } = msg.data || {};
          if (step === 'done') {
            set({
              networkUpdateProgress: { updating: false, step: null, message: null, percent: 0, error: null },
              networkVersion: {
                ...get().networkVersion,
                installed: version || get().networkVersion.latest || get().networkVersion.installed,
                updateAvailable: false,
              },
            });
            get().addToast('success', 'Network package updated');
          } else if (step === 'error') {
            set({
              networkUpdateProgress: {
                updating: false,
                step: 'error',
                message: message || error || 'Update failed',
                percent: 0,
                error: message || error || 'Update failed',
              },
            });
            get().addToast('error', 'Network update failed', message || error);
          } else {
            set({
              networkUpdateProgress: {
                updating: true,
                step: step || 'progress',
                message: message || '',
                percent: Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : get().networkUpdateProgress.percent,
                error: null,
              },
            });
          }
          break;
        }

        case 'training:status': {
          const updates = {
            trainingOptIn: msg.data?.optedIn ?? false,
            trainingStats: msg.data,
          };
          if (msg.data?.optedIn) updates.dataSharingModalOpen = false;
          set(updates);
          break;
        }

        case 'config:updated':
          get().fetchBetaStatus();
          get().fetchNetworkInstallStatus();
          break;

        case 'conversation:created': {
          const conv = msg.data;
          if (conv) set((s) => ({ conversations: [conv, ...s.conversations.filter((c) => c.id !== conv.id)] }));
          break;
        }

        case 'conversation:updated': {
          const conv = msg.data;
          if (conv) set((s) => ({ conversations: s.conversations.map((c) => c.id === conv.id ? { ...c, ...conv } : c) }));
          break;
        }

        case 'conversation:deleted': {
          const id = msg.data?.id || msg.id;
          if (id) {
            set((s) => {
              const conversations = s.conversations.filter((c) => c.id !== id);
              const conversationMessages = { ...s.conversationMessages };
              delete conversationMessages[id];
              const activeConversationId = s.activeConversationId === id ? null : s.activeConversationId;
              if (activeConversationId !== s.activeConversationId) localStorage.setItem('groove:activeConversationId', '');
              return { conversations, conversationMessages, activeConversationId };
            });
          }
          break;
        }

        case 'conversation:tool': {
          const { conversationId, name, summary } = msg.data || msg;
          if (!conversationId) break;
          set((s) => {
            const tools = { ...s.conversationActiveTools };
            tools[conversationId] = { name: name || 'Tool', summary: summary || null, timestamp: Date.now() };
            return { conversationActiveTools: tools };
          });
          break;
        }

        case 'conversation:chunk': {
          const { conversationId, text } = msg.data || msg;
          if (!conversationId || !text) break;
          set((s) => {
            const msgs = { ...s.conversationMessages };
            if (!msgs[conversationId]) msgs[conversationId] = [];
            const arr = [...msgs[conversationId]];
            const last = arr[arr.length - 1];
            if (last && last.from === 'assistant' && (Date.now() - last.timestamp) < 30000) {
              arr[arr.length - 1] = { ...last, text: last.text + text, timestamp: Date.now() };
            } else {
              arr.push({ from: 'assistant', text, timestamp: Date.now() });
            }
            msgs[conversationId] = arr.slice(-200);
            const tools = { ...s.conversationActiveTools };
            delete tools[conversationId];
            return { conversationMessages: msgs, streamingConversationId: conversationId, conversationActiveTools: tools };
          });
          break;
        }

        case 'conversation:complete': {
          const { conversationId } = msg.data || msg;
          if (conversationId && get().streamingConversationId === conversationId) {
            const tools = { ...get().conversationActiveTools };
            delete tools[conversationId];
            set({ sendingMessage: false, streamingConversationId: null, conversationActiveTools: tools });
          }
          if (conversationId) persistJSON('groove:conversationMessages', get().conversationMessages);
          break;
        }

        case 'conversation:image': {
          const { conversationId, prompt, url, b64_json, mimeType, model: imgModel, provider: imgProvider } = msg.data || msg;
          if (!conversationId) break;
          const imageUrl = url || (b64_json ? `data:${mimeType || 'image/png'};base64,${b64_json}` : null);
          set((s) => {
            const msgs = { ...s.conversationMessages };
            if (!msgs[conversationId]) msgs[conversationId] = [];
            const arr = [...msgs[conversationId]];
            const loadingIdx = arr.findLastIndex((m) => m.type === 'image-loading' && m.prompt === prompt);
            if (loadingIdx >= 0) {
              arr[loadingIdx] = { from: 'assistant', type: 'image', imageUrl, prompt, model: imgModel, provider: imgProvider, timestamp: Date.now() };
            } else {
              arr.push({ from: 'assistant', type: 'image', imageUrl, prompt, model: imgModel, provider: imgProvider, timestamp: Date.now() });
            }
            msgs[conversationId] = arr.slice(-200);
            persistJSON('groove:conversationMessages', msgs);
            const isActive = s.streamingConversationId === conversationId;
            return { conversationMessages: msgs, sendingMessage: isActive ? false : s.sendingMessage, streamingConversationId: isActive ? null : s.streamingConversationId };
          });
          break;
        }

        case 'conversation:image-progress': {
          const { conversationId, status, prompt: imgPrompt, error: imgError } = msg.data || msg;
          if (!conversationId) break;
          if (status === 'generating') {
            set((s) => {
              const msgs = { ...s.conversationMessages };
              if (!msgs[conversationId]) msgs[conversationId] = [];
              msgs[conversationId] = [...msgs[conversationId], { from: 'assistant', type: 'image-loading', prompt: imgPrompt, timestamp: Date.now() }];
              return { conversationMessages: msgs, streamingConversationId: conversationId };
            });
          } else if (status === 'error') {
            set((s) => {
              const msgs = { ...s.conversationMessages };
              if (!msgs[conversationId]) msgs[conversationId] = [];
              const arr = [...msgs[conversationId]];
              const loadingIdx = arr.findLastIndex((m) => m.type === 'image-loading');
              if (loadingIdx >= 0) arr.splice(loadingIdx, 1);
              arr.push({ from: 'system', text: `Image generation failed: ${imgError || 'Unknown error'}`, timestamp: Date.now() });
              msgs[conversationId] = arr;
              persistJSON('groove:conversationMessages', msgs);
              const isActive = s.streamingConversationId === conversationId;
              return { conversationMessages: msgs, sendingMessage: isActive ? false : s.sendingMessage, streamingConversationId: isActive ? null : s.streamingConversationId };
            });
          }
          break;
        }

        case 'conversation:error': {
          const { conversationId, error } = msg.data || msg;
          if (conversationId) {
            set((s) => {
              const msgs = { ...s.conversationMessages };
              if (!msgs[conversationId]) msgs[conversationId] = [];
              msgs[conversationId] = [...msgs[conversationId], { from: 'system', text: `Error: ${error || 'Unknown error'}`, timestamp: Date.now() }];
              persistJSON('groove:conversationMessages', msgs);
              const isActive = s.streamingConversationId === conversationId;
              return { conversationMessages: msgs, sendingMessage: isActive ? false : s.sendingMessage, streamingConversationId: isActive ? null : s.streamingConversationId };
            });
          }
          break;
        }

        case 'network:token:timing': {
          const { __proto__: _a, constructor: _b, prototype: _c, ...td } = msg.data || {};
          const updates = {
            networkTokenTiming: td,
            networkPerfSnapshots: [...get().networkPerfSnapshots, { t: Date.now(), tps: td.tps || 0 }].slice(-100),
          };
          if (Array.isArray(td.stages)) {
            const telMap = { ...get().networkNodeTelemetry };
            const unsafe = new Set(['__proto__', 'constructor', 'prototype']);
            for (const stage of td.stages) {
              const nid = stage.node_telemetry?.node_id;
              if (nid && typeof nid === 'string' && !unsafe.has(nid)) {
                telMap[nid] = { ...stage.node_telemetry, forward_ms: stage.forward_ms, updatedAt: Date.now() };
              }
            }
            updates.networkNodeTelemetry = telMap;
          }
          set(updates);
          break;
        }

        case 'network:timing:summary': {
          const { __proto__: _a, constructor: _b, prototype: _c, ...sd } = msg.data || {};
          set((s) => ({ networkBenchmarks: [...s.networkBenchmarks, sd].slice(-100) }));
          break;
        }

        case 'keeper:saved':
        case 'keeper:updated':
        case 'keeper:deleted':
          get().fetchKeeperItems();
          break;
      }
    };

    ws.onclose = () => {
      if (plannerPollInterval) {
        clearInterval(plannerPollInterval);
        plannerPollInterval = null;
      }
      set({ connected: false, hydrated: false, ws: null, daemonHost: null, tunneled: false, remoteHomedir: null });
      setTimeout(() => get().connect(), 2000);
    };
    ws.onerror = () => ws.close();
  },
}));
