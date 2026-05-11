// FSL-1.1-Apache-2.0 — see LICENSE

import { api } from '../../lib/api';

export const createNetworkSlice = (set, get) => ({
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

  // ── Federation ────────────────────────────────────────────
  federation: {
    peers: [],
    whitelist: [],
    connections: [],
    pouchLog: [],
    ambassadors: [],
    selectedPeerId: null,
  },

  // ── Network Actions ───────────────────────────────────────

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
});
