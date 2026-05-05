// GROOVE GUI v2 — Zustand Store
// FSL-1.1-Apache-2.0 — see LICENSE

import { create } from 'zustand';
import { api } from '../lib/api';

const WS_URL = `ws://${window.location.hostname}:${window.location.port || 31415}`;

let toastCounter = 0;
let plannerPollInterval = null;
const _modeChangePending = new Set();

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
  remoteHomedir: null,

  // ── Teams ─────────────────────────────────────────────────
  teams: [],
  archivedTeams: [],
  activeTeamId: localStorage.getItem('groove:activeTeamId') || null,

  // ── Gateways ──────────────────────────────────────────────
  gateways: [],

  // ── Providers ────────────────────────────────────────────
  _providerRefreshTick: 0,

  // ── Local Models (Ollama) ─────────────────────────────────
  ollamaStatus: { installed: false, serverRunning: false, hardware: null },
  ollamaInstalledModels: [],
  ollamaRunningModels: [],
  ollamaCatalog: [],
  ollamaPullProgress: {},

  // ── Federation ────────────────────────────────────────────
  federation: {
    peers: [],
    whitelist: [],
    connections: [],
    pouchLog: [],
    ambassadors: [],
    selectedPeerId: null,
  },

  // ── Preview ───────────────────────────────────────────────
  previewState: { url: null, teamId: null, kind: null, deviceSize: 'desktop', screenshotMode: false },
  showPreviewInAgents: false,
  previewChat: [],
  previewIterating: false,

  // ── Team Launch Config (set during planner spawn, cascades to team) ──
  teamLaunchConfig: null, // { provider, model, reasoningEffort, temperature, verbosity, mode }

  // ── Team Builder ──────────────────────────────────────────
  teamBuilderOpen: false,
  teamBuilderRoles: [],
  teamBuilderSettings: { provider: null, model: null, reasoningEffort: 50, temperature: 0.5 },
  teamBuilderTask: '',
  teamTemplates: { builtIn: [], custom: [] },

  // ── Navigation ────────────────────────────────────────────
  activeView: 'agents',           // 'agents' | 'editor' | 'dashboard' | 'marketplace' | 'teams' | 'settings' | 'preview'
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

  // ── Conversations (Chat view) ────────────────────────────
  conversations: [],
  activeConversationId: localStorage.getItem('groove:activeConversationId') || null,
  conversationMessages: loadJSON('groove:conversationMessages'),
  sendingMessage: false,
  streamingConversationId: null,
  conversationRoles: loadJSON('groove:conversationRoles'),
  conversationReasoningEffort: loadJSON('groove:conversationReasoningEffort'),
  conversationVerbosity: loadJSON('groove:conversationVerbosity'),

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
  networkStatusReachable: false,
  networkEvents: [],
  networkVersion: { installed: null, latest: null, updateAvailable: false },
  networkUpdateProgress: { updating: false, step: null, message: null, percent: 0, error: null },
  networkCompute: { totalRamMb: 0, totalVramMb: 0, totalCpuCores: 0, totalBandwidthMbps: 0, activeNodes: 0, totalNodes: 0, avgLoad: 0 },
  networkSnapshots: [],
  networkTokenTiming: null,
  networkBenchmarks: [],
  networkTraces: [],
  networkPerfSnapshots: [],
  networkNodeTelemetry: {},
  networkWallet: { connected: false, address: null, balance: '0.00', token: 'GROOVE', chain: 'base-l2' },
  networkEarnings: { today: 0, thisWeek: 0, allTime: 0, history: [] },

  // ── Training Data ──────────────────────────────────────────
  trainingOptIn: false,
  trainingStats: null,
  dataSharingDismissed: false,
  dataSharingModalOpen: false,

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
  updateProgress: null,
  updateModalOpen: false,

  // ── Toasts ────────────────────────────────────────────────
  toasts: [],

  // ── Project Directory ───────────────────────────────────────
  projectDir: null,
  recentProjects: [],
  showProjectPicker: false,

  // ── Tunnels ────────────────────────────────────────────────
  savedTunnels: [],
  tunnelConnectStep: null,

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

  // ── Workspace Mode ────────────────────────────────────────
  workspaceMode: localStorage.getItem('groove:workspaceMode') === 'true',
  workspaceAgentId: null,
  workspaceSnapshots: {},
  workspaceReviewMode: false,
  workspaceReviewFiles: [],

  // ── Model Lab ──────────────────────────────────────────────
  labRuntimes: loadJSON('groove:labRuntimes', []),
  labActiveRuntime: null,
  labModels: [],
  labActiveModel: null,
  labPresets: loadJSON('groove:labPresets', []),
  labActivePreset: null,
  labSessions: [],
  labActiveSession: null,
  labMetrics: { ttft: null, tokensPerSec: null, tokensPerSecHistory: [], memory: null, totalTokens: 0, generationTime: null },
  labParameters: loadJSON('groove:labParameters', {
    temperature: 0.7, topP: 0.9, topK: 40, repeatPenalty: 1.1,
    maxTokens: 2048, frequencyPenalty: 0, presencePenalty: 0,
  }),
  labSystemPrompt: localStorage.getItem('groove:labSystemPrompt') || '',
  labStreaming: false,
  labLocalModels: [],
  labLaunching: null,
  labLlamaInstalled: null,
  labLaunchPhase: null,
  labLaunchError: null,
  labAssistantAgentId: localStorage.getItem('groove:labAssistantAgentId') || null,
  labAssistantMode: false,
  labAssistantBackend: localStorage.getItem('groove:labAssistantBackend') || null,

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
            activityText = data.data.filter((b) => b.type === 'tool_use').map((b) => {
              const summary = `${b.name}: ${typeof b.input === 'string' ? b.input.slice(0, 80) : (b.input?.command || b.input?.path || b.input?.pattern || JSON.stringify(b.input || '').slice(0, 80))}`;
              return b.result ? `${summary}\n${typeof b.result === 'string' ? b.result.slice(0, 500) : JSON.stringify(b.result).slice(0, 500)}` : summary;
            }).join('\n');
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

            // Mirror to conversation messages if this agent belongs to a conversation
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

          // Open-on-write: auto-open files the agent writes in workspace mode
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

          // Clear conversation streaming state
          const exitConv = get().conversations.find((c) => c.agentId === msg.agentId);
          if (exitConv && get().streamingConversationId === exitConv.id) {
            set({ sendingMessage: false, streamingConversationId: null });
          }

          // Log crash error to agent chat so user can see what happened
          if (msg.error && msg.agentId) {
            get().addChatMessage(msg.agentId, 'system', `Crashed: ${msg.error}`);
          }
          // Clear workspace if the exiting agent was the workspace target
          if (get().workspaceAgentId === msg.agentId) {
            const teamAgents = get().agents.filter(
              (a) => a.id !== msg.agentId && a.teamId === get().activeTeamId,
            );
            const next = teamAgents.find((a) => a.status === 'running') || teamAgents[0];
            set({ workspaceAgentId: next?.id || null });
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
            { label: 'Open Preview', onClick: () => get().openPreview(msg.url, msg.teamId, msg.kind) },
            { persistent: true },
          );
          break;

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
          const ps = get().previewState;
          if (ps.teamId && ps.teamId === msg.teamId) {
            set({ previewState: { url: null, teamId: null, kind: null, deviceSize: 'desktop', screenshotMode: false }, previewChat: [], previewIterating: false });
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
          get().fetchLabRuntimes();
          break;

        case 'lab:preset:created':
        case 'lab:preset:updated':
        case 'lab:preset:deleted':
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
          // Auto-capture workspace snapshot for diff viewer
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

          // Push snapshot for activity chart
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
            return { conversationMessages: msgs, streamingConversationId: conversationId };
          });
          break;
        }

        case 'conversation:complete': {
          const { conversationId } = msg.data || msg;
          if (conversationId && get().streamingConversationId === conversationId) {
            set({ sendingMessage: false, streamingConversationId: null });
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

  async createTeam(name, workingDir, mode) {
    try {
      const body = { name };
      if (workingDir) body.workingDir = workingDir;
      if (mode) body.mode = mode;
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

  async archiveTeam(id) {
    const team = get().teams.find((t) => t.id === id);
    try {
      await api.delete(`/teams/${encodeURIComponent(id)}`);
      const wiped = team?.isDefault ? 'wiped' : 'archived';
      get().addToast('success', `Team "${team?.name}" ${wiped}`, wiped === 'archived' ? 'Files preserved — restore anytime from Archived Teams' : undefined);
      get().fetchArchivedTeams();
    } catch (err) {
      get().addToast('error', 'Failed to archive team', err.message);
    }
  },

  async deleteTeamPermanently(id) {
    const team = get().teams.find((t) => t.id === id);
    try {
      await api.delete(`/teams/${encodeURIComponent(id)}?permanent=true`);
      get().addToast('success', `Team "${team?.name}" permanently deleted`);
    } catch (err) {
      get().addToast('error', 'Failed to delete team', err.message);
    }
  },

  async deleteTeam(id) {
    return get().archiveTeam(id);
  },

  reorderTeams(fromIndex, toIndex) {
    const teams = [...get().teams];
    const [moved] = teams.splice(fromIndex, 1);
    teams.splice(toIndex, 0, moved);
    set({ teams });
    try { localStorage.setItem('groove:teamOrder', JSON.stringify(teams.map((t) => t.id))); } catch {}
  },

  async fetchArchivedTeams() {
    try {
      const data = await api.get('/teams/archived');
      set({ archivedTeams: data.archived || data.teams || [] });
    } catch { /* endpoint may not exist yet */ }
  },

  async restoreTeam(archivedId) {
    try {
      await api.post(`/teams/archived/${encodeURIComponent(archivedId)}/restore`);
      get().addToast('success', 'Team restored');
      get().fetchArchivedTeams();
    } catch (err) {
      get().addToast('error', 'Failed to restore team', err.message);
    }
  },

  async purgeTeam(archivedId) {
    try {
      await api.delete(`/teams/archived/${encodeURIComponent(archivedId)}`);
      get().addToast('info', 'Archived team permanently deleted');
      get().fetchArchivedTeams();
    } catch (err) {
      get().addToast('error', 'Failed to purge team', err.message);
    }
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

  async promoteTeam(id) {
    try {
      const team = await api.post(`/teams/${encodeURIComponent(id)}/promote`);
      set((s) => ({ teams: s.teams.filter((t) => t.id !== id) }));
      get().addToast('success', 'Team promoted — files moved to project directory');
      return team;
    } catch (err) {
      get().addToast('error', 'Failed to promote team', err.message);
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
    const match = get().agents.find((a) => a.id === id);
    if (tid && match && match.teamId && match.teamId !== tid) return;
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

  // ── Preview ──────────────────────────────────────────────

  async fetchActivePreviews() {
    try {
      const data = await api.get('/preview');
      const previews = data.previews || [];
      if (previews.length > 0) {
        const p = previews.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))[0];
        set({
          previewState: { url: `/api/preview/${p.teamId}/proxy/`, teamId: p.teamId, kind: p.kind, deviceSize: 'desktop', screenshotMode: false },
          showPreviewInAgents: true,
        });
      }
    } catch {}
  },

  openPreview(url, teamId, kind) {
    set({ previewState: { url, teamId, kind, deviceSize: 'desktop', screenshotMode: false }, previewChat: [], showPreviewInAgents: true });
  },
  closePreview() {
    const { previewState } = get();
    if (previewState.teamId) {
      api.delete(`/preview/${previewState.teamId}`).catch(() => {});
    }
    set({ previewState: { url: null, teamId: null, kind: null, deviceSize: 'desktop', screenshotMode: false }, previewChat: [], previewIterating: false, showPreviewInAgents: false, activeView: 'agents' });
  },
  togglePreviewInAgents() {
    set((s) => ({ showPreviewInAgents: !s.showPreviewInAgents }));
  },
  setPreviewDevice(size) {
    set((s) => ({ previewState: { ...s.previewState, deviceSize: size } }));
  },
  toggleScreenshotMode() {
    set((s) => ({ previewState: { ...s.previewState, screenshotMode: !s.previewState.screenshotMode } }));
  },
  async iteratePreview(message, screenshotBase64) {
    const { previewState } = get();
    if (!previewState.teamId) return;

    const userMsg = { role: 'user', content: message, screenshot: screenshotBase64 || null, timestamp: Date.now() };
    set((s) => ({ previewChat: [...s.previewChat, userMsg], previewIterating: true }));

    try {
      const body = { message };
      if (screenshotBase64) body.screenshot = screenshotBase64;
      const res = await api.post(`/preview/${previewState.teamId}/iterate`, body);
      const assistantMsg = { role: 'assistant', content: res.response || res.message || 'Changes routed to planner.', timestamp: Date.now() };
      set((s) => ({ previewChat: [...s.previewChat, assistantMsg], previewIterating: false }));
    } catch (err) {
      const errMsg = { role: 'assistant', content: `Failed to iterate: ${err.message}`, timestamp: Date.now() };
      set((s) => ({ previewChat: [...s.previewChat, errMsg], previewIterating: false }));
    }
  },
  addPreviewChatMessage(role, content, screenshot) {
    const msg = { role, content, screenshot: screenshot || null, timestamp: Date.now() };
    set((s) => ({ previewChat: [...s.previewChat, msg] }));
  },
  clearPreviewChat() {
    set({ previewChat: [] });
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
  setUpdateModalOpen(open) {
    set({ updateModalOpen: open });
  },
  checkForUpdate() {
    window.groove?.update?.checkForUpdate();
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
            const tlc = get().teamLaunchConfig;
            const result = await api.post('/recommended-team/launch', {
              teamId,
              ...(tlc?.provider && { teamProvider: tlc.provider }),
              ...(tlc?.model && { teamModel: tlc.model }),
              ...(tlc?.reasoningEffort != null && { teamReasoningEffort: tlc.reasoningEffort }),
              ...(tlc?.temperature != null && { teamTemperature: tlc.temperature }),
            });
            const agents = result.agents || [];
            const failures = result.failed || [];
            const names = agents.map((a) => a.name).join(', ') || '';

            if (agents.length === 0 && failures.length > 0) {
              get().addToast('error', 'Delegation failed', failures.map(f => f.role + ': ' + f.error).join(', '));
            } else {
              get().addToast('success', 'Planner delegated work', names ? `→ ${names}` : undefined);
              if (failures.length > 0) {
                get().addToast('warning', `${failures.length} agent(s) failed to spawn`, failures.map(f => f.role + ': ' + f.error).join(', '));
              }
            }
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
      const tlc = get().teamLaunchConfig;
      set({ recommendedTeam: null }); // Dismiss modal immediately
      get().addToast('info', 'Launching team...');
      const body = {
        ...(modifiedAgents && { agents: modifiedAgents }),
        ...(teamId && { teamId }),
        ...(tlc?.provider && { teamProvider: tlc.provider }),
        ...(tlc?.model && { teamModel: tlc.model }),
        ...(tlc?.reasoningEffort != null && { teamReasoningEffort: tlc.reasoningEffort }),
        ...(tlc?.temperature != null && { teamTemperature: tlc.temperature }),
        ...(tlc?.verbosity != null && { teamVerbosity: tlc.verbosity }),
        ...(tlc?.mode && { mode: tlc.mode }),
      };
      const result = await api.post('/recommended-team/launch', body);
      const totalOk = (result.launched || 0) + (result.reused || 0);
      const failures = result.failed || [];

      if (totalOk === 0 && failures.length > 0) {
        get().addToast('error', 'Team launch failed', failures.map(f => f.role + ': ' + f.error).join(', '));
      } else {
        const sub = [
          result.phase2Pending ? `${result.phase2Pending} QC queued` : '',
          result.projectDir ? `→ ${result.projectDir}/` : '',
        ].filter(Boolean).join(' · ');
        get().addToast('success', `Launched ${totalOk} agents`, sub || undefined);
        if (failures.length > 0) {
          get().addToast('warning', `${failures.length} agent(s) failed to spawn`, failures.map(f => f.role + ': ' + f.error).join(', '));
        }
      }
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

  // ── Team Builder ──────────────────────────────────────────

  openTeamBuilder() { set({ teamBuilderOpen: true }); },
  closeTeamBuilder() {
    set({
      teamBuilderOpen: false,
      teamBuilderRoles: [],
      teamBuilderSettings: { provider: null, model: null, reasoningEffort: 50, temperature: 0.5 },
      teamBuilderTask: '',
    });
  },
  addTeamBuilderRole(role) {
    set((s) => ({
      teamBuilderRoles: [...s.teamBuilderRoles, {
        role, name: '', provider: null, model: null,
        reasoningEffort: null, temperature: null, prompt: '',
      }],
    }));
  },
  removeTeamBuilderRole(index) {
    set((s) => ({ teamBuilderRoles: s.teamBuilderRoles.filter((_, i) => i !== index) }));
  },
  updateTeamBuilderRole(index, updates) {
    set((s) => ({
      teamBuilderRoles: s.teamBuilderRoles.map((r, i) => i === index ? { ...r, ...updates } : r),
    }));
  },
  applyTemplate(template) {
    set({
      teamBuilderRoles: (template.roles || []).map((r) => ({
        role: typeof r === 'string' ? r : r.role,
        name: '', provider: null, model: null,
        reasoningEffort: null, temperature: null, prompt: '',
      })),
    });
  },
  setTeamBuilderSettings(settings) {
    set((s) => ({ teamBuilderSettings: { ...s.teamBuilderSettings, ...settings } }));
  },
  setTeamBuilderTask(task) { set({ teamBuilderTask: task }); },

  async fetchTeamTemplates() {
    try {
      const data = await api.get('/team-templates');
      const builtIn = [];
      const custom = [];
      for (const [key, tmpl] of Object.entries(data || {})) {
        const entry = { ...tmpl, name: key };
        if (tmpl.builtIn) builtIn.push(entry);
        else custom.push(entry);
      }
      set({ teamTemplates: { builtIn, custom } });
    } catch { /* endpoint may not exist yet */ }
  },

  async saveTeamTemplate(name) {
    try {
      const { teamBuilderRoles, teamBuilderSettings } = get();
      await api.post('/team-templates', {
        name,
        roles: teamBuilderRoles.map((r) => r.role),
        settings: teamBuilderSettings,
      });
      get().addToast('success', `Template "${name}" saved`);
      get().fetchTeamTemplates();
    } catch (err) {
      get().addToast('error', 'Failed to save template', err.message);
    }
  },

  async deleteTeamTemplate(name) {
    try {
      await api.delete(`/team-templates/${encodeURIComponent(name)}`);
      get().addToast('info', `Template "${name}" deleted`);
      get().fetchTeamTemplates();
    } catch (err) {
      get().addToast('error', 'Failed to delete template', err.message);
    }
  },

  async launchTeamBuilder() {
    const { teamBuilderRoles, teamBuilderSettings, teamBuilderTask, activeTeamId } = get();
    if (teamBuilderRoles.length === 0) return;
    set({ teamLaunchConfig: {
      provider: teamBuilderSettings.provider || null,
      model: teamBuilderSettings.model || null,
      reasoningEffort: teamBuilderSettings.reasoningEffort,
      temperature: teamBuilderSettings.temperature,
    }});
    get().closeTeamBuilder();
    try {
      const body = {
        task: teamBuilderTask,
        roles: teamBuilderRoles,
        settings: teamBuilderSettings,
        launchMode: 'plan-first',
        teamId: activeTeamId,
      };
      const result = await api.post('/team-builder/launch', body);
      get().addToast('success', 'Planner spawned — team will build automatically');
      return result;
    } catch (err) {
      get().addToast('error', 'Team launch failed', err.message);
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
        editorTreeCache: {},
      });
    } catch {}
  },

  async setProjectDir(path) {
    const data = await api.post('/project-dir', { path });
    try { await api.post('/files/root', { root: data.projectDir }); } catch {}
    set({
      projectDir: data.projectDir,
      recentProjects: data.recentProjects || [],
      showProjectPicker: false,
      editorTreeCache: {},
    });
    get().fetchTreeDir('');
  },

  async removeRecentProject(path) {
    try {
      await api.delete('/projects/recent', { path });
    } catch {}
    get().fetchProjectDir();
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
    try {
      const result = await api.post(`/tunnels/${encodeURIComponent(id)}/connect`);
      get().fetchTunnels();
      if (result.localPort && result.name) {
        if (window.groove?.remote?.openWindow) {
          window.groove.remote.openWindow(result.localPort, result.name);
        } else {
          window.open(`http://localhost:${result.localPort}?instance=${encodeURIComponent(result.name)}`, '_blank');
        }
      }
      return result;
    } finally {
      set({ tunnelConnectStep: null });
    }
  },

  async upgradeTunnel(id) {
    return api.post(`/tunnels/${encodeURIComponent(id)}/upgrade`);
  },

  async disconnectTunnel(id) {
    const tunnel = get().savedTunnels.find(t => t.id === id);
    await api.post(`/tunnels/${encodeURIComponent(id)}/disconnect`);
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

  async fetchProviders() {
    return api.get('/providers');
  },

  // ── Local Models (Ollama) ─────────────────────────────────

  async fetchOllamaStatus() {
    try {
      const check = await api.post('/providers/ollama/check');
      const updates = {
        ollamaStatus: { installed: check.installed, serverRunning: check.serverRunning, hardware: check.hardware },
      };
      if (check.installed) {
        try {
          const models = await api.get('/providers/ollama/models');
          updates.ollamaInstalledModels = models.installed || [];
          updates.ollamaCatalog = models.catalog || [];
        } catch {}
      }
      if (check.serverRunning) {
        try {
          const running = await api.get('/providers/ollama/running');
          updates.ollamaRunningModels = running.models || [];
        } catch {
          updates.ollamaRunningModels = [];
        }
      } else {
        updates.ollamaRunningModels = [];
      }
      set(updates);
      return updates.ollamaStatus;
    } catch {
      return get().ollamaStatus;
    }
  },

  async startOllamaServer() {
    try {
      const result = await api.post('/providers/ollama/serve');
      if (result.ok) {
        get().addToast('success', 'Ollama server started');
        await new Promise((r) => setTimeout(r, 2000));
        await get().fetchOllamaStatus();
      }
      return result;
    } catch (err) {
      get().addToast('error', 'Could not start server', err.message);
      throw err;
    }
  },

  async stopOllamaServer() {
    try {
      const result = await api.post('/providers/ollama/stop');
      if (result.ok) {
        get().addToast('info', 'Ollama server stopped');
        set((s) => ({
          ollamaStatus: { ...s.ollamaStatus, serverRunning: false },
          ollamaRunningModels: [],
        }));
      }
      return result;
    } catch (err) {
      get().addToast('error', 'Stop failed', err.message);
      throw err;
    }
  },

  async restartOllamaServer() {
    try {
      const result = await api.post('/providers/ollama/restart');
      if (result.ok) {
        get().addToast('success', 'Ollama server restarted');
        await new Promise((r) => setTimeout(r, 2000));
        await get().fetchOllamaStatus();
      }
      return result;
    } catch (err) {
      get().addToast('error', 'Restart failed', err.message);
      throw err;
    }
  },

  async pullOllamaModel(modelId) {
    try {
      set((s) => ({ ollamaPullProgress: { ...s.ollamaPullProgress, [modelId]: { status: 'pulling', progress: '' } } }));
      await api.post('/providers/ollama/pull', { model: modelId });
      set((s) => {
        const progress = { ...s.ollamaPullProgress };
        delete progress[modelId];
        return { ollamaPullProgress: progress };
      });
      get().addToast('success', `${modelId} ready to use`);
      get().fetchOllamaStatus();
    } catch (err) {
      set((s) => {
        const progress = { ...s.ollamaPullProgress };
        delete progress[modelId];
        return { ollamaPullProgress: progress };
      });
      get().addToast('error', `Pull failed: ${err.message}`);
    }
  },

  async deleteOllamaModel(modelId) {
    try {
      await api.delete(`/providers/ollama/models/${encodeURIComponent(modelId)}`);
      set((s) => ({ ollamaInstalledModels: s.ollamaInstalledModels.filter((m) => m.id !== modelId) }));
      get().addToast('success', `Removed ${modelId}`);
    } catch (err) {
      get().addToast('error', `Delete failed: ${err.message}`);
    }
  },

  async loadOllamaModel(modelId) {
    try {
      await api.post('/providers/ollama/load', { model: modelId });
      get().addToast('success', `${modelId} loaded into memory`);
      get().fetchOllamaStatus();
    } catch (err) {
      get().addToast('error', `Could not load model: ${err.message}`);
    }
  },

  async unloadOllamaModel(modelId) {
    try {
      await api.post('/providers/ollama/unload', { model: modelId });
      set((s) => ({ ollamaRunningModels: s.ollamaRunningModels.filter((m) => m.name !== modelId) }));
      get().addToast('info', `${modelId} unloaded`);
    } catch (err) {
      get().addToast('error', `Unload failed: ${err.message}`);
    }
  },

  spawnFromModel(modelId) {
    get().openDetail({ type: 'spawn', presetProvider: 'ollama', presetModel: modelId });
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

  // ── Provider Setup (Settings) ──────────────────────────────

  providerInstallProgress: {},

  async installProvider(providerId) {
    const update = (patch) => set((s) => ({
      providerInstallProgress: {
        ...s.providerInstallProgress,
        [providerId]: { ...s.providerInstallProgress[providerId], ...patch },
      },
    }));

    update({ installing: true, percent: 0, message: 'Starting install...', error: null, done: false });

    try {
      const res = await fetch(`/api/providers/${encodeURIComponent(providerId)}/install`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(err || `Install failed (${res.status})`);
      }

      let body;
      try {
        body = await res.text();
      } catch (e) {
        throw new Error(`Failed to read response: ${e.message}`);
      }

      let lastError = null;
      let completed = false;
      for (const line of body.split('\n')) {
        if (!line.trim()) continue;
        try {
          const ev = JSON.parse(line);
          const isError = ev.status === 'error';
          const isDone = ev.status === 'complete';
          if (isError) lastError = ev.output || 'Install failed';
          if (isDone) completed = true;
          update({
            percent: ev.progress ?? get().providerInstallProgress[providerId]?.percent ?? 0,
            message: ev.output || get().providerInstallProgress[providerId]?.message,
            error: isError ? (ev.output || 'Install failed') : null,
            done: isDone,
            installing: !isDone && !isError,
          });
        } catch { /* skip malformed line */ }
      }

      if (lastError) throw new Error(lastError);
      if (!completed) throw new Error(body.slice(0, 500) || 'Install ended without confirmation');

      update({ installing: false, percent: 100, message: 'Installed', error: null, done: true });
      set({ _providerRefreshTick: Date.now() });
      get().addToast('success', `${providerId} installed`);
    } catch (err) {
      update({ installing: false, percent: 0, message: null, error: err.message, done: false });
      get().addToast('error', `Install failed: ${providerId}`, err.message);
      throw err;
    }
  },

  async loginProvider(providerId, body) {
    try {
      const data = await api.post(`/providers/${encodeURIComponent(providerId)}/login`, body);
      if (data?.url && !data?.browserOpened) window.open(data.url, '_blank');
      return data;
    } catch (err) {
      get().addToast('error', `Login failed`, err.message);
      throw err;
    }
  },

  async setProviderPath(providerId, path) {
    try {
      await api.post(`/providers/${encodeURIComponent(providerId)}/set-path`, { path });
      get().addToast('success', `Custom path set for ${providerId}`);
    } catch (err) {
      get().addToast('error', 'Failed to set path', err.message);
      throw err;
    }
  },

  async verifyProvider(providerId) {
    try {
      const data = await api.post(`/providers/${encodeURIComponent(providerId)}/verify`);
      return data;
    } catch (err) {
      get().addToast('error', `Verification failed`, err.message);
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
      if (conv.mode === 'api' || !conv.mode) {
        const history = get().conversationMessages[conversationId] || [];
        body.history = history.slice(0, -1);

        const role = get().conversationRoles?.[conversationId];
        const rules = ['Never use emojis in your responses.', 'Be professional, concise, and direct.'];
        if (role) rules.unshift(`You are a professional ${role}. Respond with deep expertise in that domain.`);
        const systemCtx = rules.join(' ');
        body.history = [
          { from: 'user', text: `Instructions: ${systemCtx}` },
          { from: 'assistant', text: 'Understood.' },
          ...body.history,
        ];
      }
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
      set((s) => ({ editorTreeCache: { ...s.editorTreeCache, [dirPath]: data.entries || [] } }));
      const ws = get().ws;
      if (ws?.readyState === 1) ws.send(JSON.stringify({ type: 'editor:watchdir', path: dirPath }));
    } catch (err) {
      console.error('[file-tree] fetchTreeDir failed for', dirPath, err.message);
      set((s) => ({ editorTreeCache: { ...s.editorTreeCache, [dirPath]: [] } }));
    }
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

  captureSnapshot(path, content) {
    set((s) => {
      if (s.workspaceSnapshots[path]) return s;
      const next = { ...s.workspaceSnapshots, [path]: content };
      const keys = Object.keys(next);
      if (keys.length > 200) {
        delete next[keys[0]];
      }
      return { workspaceSnapshots: next };
    });
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

  async disconnectPeer(peerId) {
    try {
      await api.delete(`/federation/peers/${encodeURIComponent(peerId)}`);
      get().addToast('info', 'Peer disconnected');
      get().fetchFederationStatus();
    } catch (err) {
      get().addToast('error', 'Disconnect failed', err.message);
    }
  },

  // ── Training Data ─────────────────────────────────────────

  async setTrainingOptIn(enabled) {
    try {
      await api.post('/training/opt-in', { enabled });
      set({ trainingOptIn: enabled, dataSharingModalOpen: false });
      if (!enabled) set({ trainingStats: null });
    } catch (e) {
      get().addToast('error', 'Failed to update training preference', e.body?.detail || e.message);
    }
  },

  async fetchTrainingStatus() {
    try {
      const data = await api.get('/training/status');
      set({ trainingOptIn: data.optedIn, trainingStats: data });
    } catch { /* endpoint may not exist on older daemons */ }
  },

  async dismissDataSharingModal(permanent) {
    if (permanent) {
      try { await api.patch('/config', { dataSharingDismissed: true }); } catch {}
      set({ dataSharingDismissed: true, dataSharingModalOpen: false });
    } else {
      set({ dataSharingModalOpen: false });
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
      const update = {
        networkStatus: { ...get().networkStatus, ...(data || {}) },
        networkStatusReachable: true,
      };
      if (data?.compute) {
        const c = data.compute;
        update.networkCompute = {
          totalRamMb: c.totalRamMb ?? c.total_ram_mb ?? 0,
          totalVramMb: c.totalVramMb ?? c.total_vram_mb ?? 0,
          totalCpuCores: c.totalCpuCores ?? c.total_cpu_cores ?? 0,
          totalBandwidthMbps: c.totalBandwidthMbps ?? c.total_bandwidth_mbps ?? 0,
          activeNodes: c.activeNodes ?? c.active_nodes ?? 0,
          totalNodes: c.totalNodes ?? c.total_nodes ?? 0,
          avgLoad: c.avgLoad ?? c.avg_load ?? 0,
        };
      } else if (Array.isArray(data?.nodes) && data.nodes.length > 0) {
        const nodes = data.nodes;
        const active = nodes.filter((n) => n.status === 'active');
        update.networkCompute = {
          totalRamMb: nodes.reduce((s, n) => s + (n.ram_mb || 0), 0),
          totalVramMb: nodes.reduce((s, n) => s + (n.vram_mb || 0), 0),
          totalCpuCores: nodes.reduce((s, n) => s + (n.cpu_cores || 0), 0),
          totalBandwidthMbps: nodes.reduce((s, n) => s + (n.bandwidth_mbps || 0), 0),
          activeNodes: active.length,
          totalNodes: nodes.length,
          avgLoad: active.length > 0 ? active.reduce((s, n) => s + (n.load || 0), 0) / active.length : 0,
        };
      }
      set(update);

      // Push snapshot for activity chart
      if (data) {
        const ownId = get().networkNode.nodeId;
        const nodes = data.nodes || [];
        const ownNode = ownId ? nodes.find((n) => (n.node_id || n.nodeId) === ownId) : null;
        const activeNodes = nodes.filter((n) => n.status === 'active');
        const snap = {
          t: Date.now(),
          globalSessions: data.activeSessions || 0,
          mySessions: ownNode?.active_sessions ?? ownNode?.sessions ?? 0,
          nodeCount: activeNodes.length,
          avgLoad: activeNodes.length > 0 ? activeNodes.reduce((s, n) => s + (n.load || 0), 0) / activeNodes.length : 0,
          myLoad: ownNode?.load ?? 0,
          totalVramMb: nodes.reduce((s, n) => s + (n.vram_mb || 0), 0),
          totalRamMb: nodes.reduce((s, n) => s + (n.ram_mb || 0), 0),
        };
        let snapshots = [...get().networkSnapshots, snap];
        if (snapshots.length > 100) snapshots = snapshots.slice(-100);
        set({ networkSnapshots: snapshots });
      }

      return data;
    } catch {
      set({ networkStatusReachable: false });
      return null;
    }
  },

  async checkNetworkUpdate() {
    try {
      const data = await api.get('/network/update/check');
      if (!data) return null;
      set({
        networkVersion: {
          installed: data.installed ?? null,
          latest: data.latest ?? null,
          updateAvailable: !!data.updateAvailable,
        },
      });
      return data;
    } catch { return null; }
  },

  async updateNetworkPackage() {
    set({
      networkUpdateProgress: {
        updating: true,
        step: 'starting',
        message: 'Starting update…',
        percent: 0,
        error: null,
      },
    });
    try {
      await api.post('/network/update');
    } catch (err) {
      set({
        networkUpdateProgress: {
          updating: false,
          step: 'error',
          message: err.message,
          percent: 0,
          error: err.message,
        },
      });
      get().addToast('error', 'Update failed', err.message);
    }
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

  async fetchNetworkWallet() {
    return get().networkWallet;
  },
  async fetchNetworkEarnings() {
    return get().networkEarnings;
  },

  async fetchNetworkBenchmarks() {
    try {
      const data = await api.get('/network/benchmarks');
      if (Array.isArray(data)) set({ networkBenchmarks: data.slice(-100) });
      return data;
    } catch { return null; }
  },

  async fetchNetworkTraces() {
    try {
      const data = await api.get('/network/traces');
      if (Array.isArray(data)) set({ networkTraces: data });
      return data;
    } catch { return null; }
  },

  async fetchNetworkTrace(filename) {
    try {
      return await api.get(`/network/traces/${encodeURIComponent(filename)}`);
    } catch { return null; }
  },

  async fetchLiveTrace(offset = 0) {
    try {
      return await api.get(`/network/traces/live?offset=${offset}`);
    } catch { return null; }
  },

  // ── Model Lab Actions ──────────────────────────────────────

  setLabParameter(key, value) {
    const params = { ...get().labParameters, [key]: value };
    set({ labParameters: params });
    persistJSON('groove:labParameters', params);
  },

  setLabSystemPrompt(text) {
    set({ labSystemPrompt: text });
    localStorage.setItem('groove:labSystemPrompt', text);
  },

  async fetchLabRuntimes() {
    try {
      const raw = await api.get('/lab/runtimes');
      const data = raw.map((rt) => ({
        ...rt,
        status: rt.online === true ? 'connected' : rt.online === false ? 'error' : rt.status,
      }));
      set({ labRuntimes: data });
      persistJSON('groove:labRuntimes', data);
      if (data.length > 0 && !get().labActiveRuntime) {
        get().setLabActiveRuntime(data[0].id);
      } else if (get().labActiveRuntime) {
        get().fetchLabModels(get().labActiveRuntime);
      }
    } catch { /* backend may not have lab endpoints yet */ }
  },

  async fetchLabLocalModels() {
    try {
      const data = await api.get('/lab/local-models');
      set({ labLocalModels: data });
    } catch { set({ labLocalModels: [] }); }
  },

  async checkLlamaStatus() {
    try {
      const data = await api.get('/llama/status');
      set({ labLlamaInstalled: !!data.installed });
    } catch { set({ labLlamaInstalled: false }); }
  },

  async launchLocalModel(modelId) {
    set({ labLaunching: modelId, labLaunchPhase: 'starting', labLaunchError: null });
    try {
      const result = await api.post('/lab/launch-local', { modelId });
      const runtimes = await api.get('/lab/runtimes');
      set({ labRuntimes: runtimes });
      persistJSON('groove:labRuntimes', runtimes);
      get().setLabActiveRuntime(result.runtime.id);
      set({ labActiveModel: result.model, labLaunching: null, labLaunchPhase: 'ready' });
      get().addToast('success', `Launched ${result.model}`);
      setTimeout(() => { if (get().labLaunchPhase === 'ready') set({ labLaunchPhase: null }); }, 3000);
      return result;
    } catch (err) {
      set({ labLaunching: null, labLaunchPhase: 'error', labLaunchError: err.message });
      get().addToast('error', 'Failed to launch model', err.message);
      throw err;
    }
  },

  async addLabRuntime(runtime) {
    try {
      const created = await api.post('/lab/runtimes', runtime);
      const runtimes = [...get().labRuntimes, created];
      set({ labRuntimes: runtimes });
      persistJSON('groove:labRuntimes', runtimes);
      get().setLabActiveRuntime(created.id);
      get().addToast('success', `Runtime "${runtime.name}" added`);
      return created;
    } catch (err) {
      get().addToast('error', 'Failed to add runtime', err.message);
      throw err;
    }
  },

  async removeLabRuntime(id) {
    try {
      await api.delete(`/lab/runtimes/${id}`);
      const runtimes = get().labRuntimes.filter((r) => r.id !== id);
      const active = get().labActiveRuntime === id ? null : get().labActiveRuntime;
      set({ labRuntimes: runtimes, labActiveRuntime: active, labModels: active ? get().labModels : [] });
      persistJSON('groove:labRuntimes', runtimes);
      get().addToast('success', 'Runtime removed');
    } catch (err) {
      get().addToast('error', 'Failed to remove runtime', err.message);
    }
  },

  async testLabRuntime(id) {
    try {
      const result = await api.post(`/lab/runtimes/${id}/test`);
      const runtimes = get().labRuntimes.map((r) =>
        r.id === id ? { ...r, status: result.ok ? 'connected' : 'error', latency: result.latency } : r,
      );
      const updates = { labRuntimes: runtimes };
      if (result.ok && result.models && get().labActiveRuntime === id) {
        updates.labModels = result.models;
      }
      set(updates);
      persistJSON('groove:labRuntimes', runtimes);
      return result;
    } catch (err) {
      const runtimes = get().labRuntimes.map((r) =>
        r.id === id ? { ...r, status: 'error' } : r,
      );
      set({ labRuntimes: runtimes });
      persistJSON('groove:labRuntimes', runtimes);
      return { ok: false, error: err.message };
    }
  },

  setLabActiveRuntime(id) {
    set({ labActiveRuntime: id, labModels: [], labActiveModel: null });
    if (id) get().fetchLabModels(id);
  },

  setLabActiveModel(model) {
    set({ labActiveModel: model });
  },

  async fetchLabModels(runtimeId) {
    try {
      const data = await api.get(`/lab/runtimes/${runtimeId}/models`);
      set({ labModels: data });
    } catch { set({ labModels: [] }); }
  },

  newLabSession() {
    const id = `lab-${Date.now()}`;
    const session = { id, messages: [], createdAt: Date.now() };
    set((s) => ({
      labSessions: [session, ...s.labSessions],
      labActiveSession: id,
      labMetrics: { ttft: null, tokensPerSec: null, tokensPerSecHistory: [], memory: null, totalTokens: 0, generationTime: null },
    }));
    return id;
  },

  loadLabSession(id) {
    set({ labActiveSession: id });
  },

  async sendLabMessage(text) {
    const st = get();
    if (st.labStreaming) return;
    let sessionId = st.labActiveSession;
    if (!sessionId) sessionId = get().newLabSession();

    const userMsg = { role: 'user', content: text, timestamp: Date.now() };
    set((s) => {
      const sessions = s.labSessions.map((sess) =>
        sess.id === sessionId ? { ...sess, messages: [...sess.messages, userMsg] } : sess,
      );
      return { labSessions: sessions, labStreaming: true };
    });

    const assistantMsg = { role: 'assistant', content: '', timestamp: Date.now(), metrics: null };
    set((s) => {
      const sessions = s.labSessions.map((sess) =>
        sess.id === sessionId ? { ...sess, messages: [...sess.messages, assistantMsg] } : sess,
      );
      return { labSessions: sessions };
    });

    const startTime = performance.now();
    let firstTokenTime = null;
    let tokenCount = 0;

    try {
      const p = st.labParameters;
      const parameters = {};
      if (p.temperature !== undefined) parameters.temperature = p.temperature;
      if (p.topP !== undefined) parameters.top_p = p.topP;
      if (p.topK !== undefined) parameters.top_k = p.topK;
      if (p.repeatPenalty !== undefined) parameters.repeat_penalty = p.repeatPenalty;
      if (p.maxTokens !== undefined) parameters.max_tokens = p.maxTokens;
      if (p.frequencyPenalty !== undefined) parameters.frequency_penalty = p.frequencyPenalty;
      if (p.presencePenalty !== undefined) parameters.presence_penalty = p.presencePenalty;

      const messages = [];
      if (st.labSystemPrompt) messages.push({ role: 'system', content: st.labSystemPrompt });
      const sessionMsgs = get().labSessions.find((s) => s.id === sessionId)?.messages || [];
      for (const m of sessionMsgs) {
        if (m.role === 'assistant' && !m.content) continue;
        messages.push({ role: m.role, content: m.content });
      }

      const body = {
        runtimeId: st.labActiveRuntime,
        model: st.labActiveModel,
        messages,
        parameters,
        sessionId,
      };

      const res = await fetch('/api/lab/inference', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        let errMsg;
        try { errMsg = (await res.json()).error || `HTTP ${res.status}`; } catch { errMsg = `HTTP ${res.status}`; }
        throw new Error(errMsg);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6);
          if (payload === '[DONE]') continue;
          try {
            const chunk = JSON.parse(payload);
            if (chunk.type === 'token' && chunk.content) {
              if (!firstTokenTime) firstTokenTime = performance.now();
              tokenCount++;
              fullContent += chunk.content;
              set((s) => {
                const sessions = s.labSessions.map((sess) => {
                  if (sess.id !== sessionId) return sess;
                  const msgs = [...sess.messages];
                  msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], content: fullContent };
                  return { ...sess, messages: msgs };
                });
                return { labSessions: sessions };
              });
            }
            if (chunk.type === 'done' && chunk.metrics) {
              const elapsed = performance.now() - startTime;
              const ttft = firstTokenTime ? firstTokenTime - startTime : null;
              const tps = tokenCount > 0 && elapsed > 0 ? (tokenCount / (elapsed / 1000)) : null;
              const msgMetrics = { ttft, tokensPerSec: tps, tokens: tokenCount, generationTime: elapsed, ...chunk.metrics };

              set((s) => {
                const tpsHist = [...s.labMetrics.tokensPerSecHistory, tps].slice(-10);
                const sessions = s.labSessions.map((sess) => {
                  if (sess.id !== sessionId) return sess;
                  const msgs = [...sess.messages];
                  msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], metrics: msgMetrics };
                  return { ...sess, messages: msgs };
                });
                return {
                  labSessions: sessions,
                  labMetrics: {
                    ttft, tokensPerSec: tps, tokensPerSecHistory: tpsHist,
                    memory: chunk.metrics.memoryUsage || s.labMetrics.memory,
                    totalTokens: s.labMetrics.totalTokens + (chunk.metrics.totalTokens || tokenCount),
                    generationTime: chunk.metrics.generationTime || elapsed,
                  },
                };
              });
            }
            if (chunk.type === 'error') {
              throw new Error(chunk.error || 'Inference error');
            }
          } catch (e) {
            if (e.message && e.message !== 'Inference error' && !e.message.startsWith('HTTP ')) continue;
            throw e;
          }
        }
      }

      // Final metrics if no done event came
      if (!get().labSessions.find((s) => s.id === sessionId)?.messages.slice(-1)[0]?.metrics) {
        const elapsed = performance.now() - startTime;
        const ttft = firstTokenTime ? firstTokenTime - startTime : null;
        const tps = tokenCount > 0 && elapsed > 0 ? (tokenCount / (elapsed / 1000)) : null;
        set((s) => {
          const tpsHist = [...s.labMetrics.tokensPerSecHistory, tps].slice(-10);
          return {
            labMetrics: { ...s.labMetrics, ttft, tokensPerSec: tps, tokensPerSecHistory: tpsHist, totalTokens: s.labMetrics.totalTokens + tokenCount, generationTime: elapsed },
          };
        });
      }
    } catch (err) {
      set((s) => {
        const sessions = s.labSessions.map((sess) => {
          if (sess.id !== sessionId) return sess;
          const msgs = [...sess.messages];
          msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], content: `Error: ${err.message}`, error: true };
          return { ...sess, messages: msgs };
        });
        return { labSessions: sessions };
      });
    } finally {
      set({ labStreaming: false });
    }
  },

  saveLabPreset(name) {
    const st = get();
    const preset = {
      id: `preset-${Date.now()}`,
      name,
      parameters: { ...st.labParameters },
      systemPrompt: st.labSystemPrompt,
      runtimeId: st.labActiveRuntime,
      model: st.labActiveModel,
      createdAt: Date.now(),
    };
    const presets = [...st.labPresets.filter((p) => p.name !== name), preset];
    set({ labPresets: presets, labActivePreset: preset.id });
    persistJSON('groove:labPresets', presets);
    get().addToast('success', `Preset "${name}" saved`);
    return preset;
  },

  loadLabPreset(id) {
    const preset = get().labPresets.find((p) => p.id === id);
    if (!preset) return;
    const updates = {
      labParameters: { ...preset.parameters },
      labSystemPrompt: preset.systemPrompt || '',
      labActivePreset: id,
    };
    if (preset.model) updates.labActiveModel = preset.model;
    set(updates);
    persistJSON('groove:labParameters', preset.parameters);
    if (preset.systemPrompt !== undefined) localStorage.setItem('groove:labSystemPrompt', preset.systemPrompt);
  },

  deleteLabPreset(id) {
    const presets = get().labPresets.filter((p) => p.id !== id);
    set({ labPresets: presets, labActivePreset: get().labActivePreset === id ? null : get().labActivePreset });
    persistJSON('groove:labPresets', presets);
    get().addToast('success', 'Preset deleted');
  },

  async launchLabAssistant(backend) {
    const existing = get().labAssistantAgentId;
    if (existing) {
      const agent = get().agents.find((a) => a.id === existing);
      if (agent && agent.status === 'running') {
        set({ labAssistantMode: true });
        return;
      }
    }
    try {
      const data = await api.post('/lab/assistant', { backend });
      localStorage.setItem('groove:labAssistantAgentId', data.agentId);
      localStorage.setItem('groove:labAssistantBackend', backend);
      set({ labAssistantAgentId: data.agentId, labAssistantMode: true, labAssistantBackend: backend });
      get().addToast('info', `Lab Assistant started for ${backend}`);
    } catch (err) {
      get().addToast('error', 'Failed to start assistant', err.message);
    }
  },

  dismissLabAssistant() {
    set({ labAssistantMode: false });
  },

  clearLabAssistant() {
    const id = get().labAssistantAgentId;
    if (id) api.delete(`/agents/${encodeURIComponent(id)}`).catch(() => {});
    localStorage.removeItem('groove:labAssistantAgentId');
    localStorage.removeItem('groove:labAssistantBackend');
    set({ labAssistantAgentId: null, labAssistantMode: false, labAssistantBackend: null });
  },

  setLabAssistantMode(mode) {
    set({ labAssistantMode: mode });
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
