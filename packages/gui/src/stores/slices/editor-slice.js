// FSL-1.1-Apache-2.0 — see LICENSE

import { api } from '../../lib/api';

export const createEditorSlice = (set, get) => ({
  // ── Editor state ──────────────────────────────────────────
  editorFiles: {},
  editorActiveFile: null,
  editorOpenTabs: [],
  editorTreeCache: {},
  editorChangedFiles: {},
  editorRecentSaves: {},
  editorSidebarWidth: Number(localStorage.getItem('groove:editorSidebarWidth')) || 240,
  editorTheme: localStorage.getItem('groove:editorTheme') || 'vscodeDark',

  // ── Editor (Cursor-style) ────────────────────────────────
  editorSelectedAgent: null,
  editorPendingSnippet: null,
  editorViewMode: 'code',
  editorAiPanelOpen: false,
  editorAiPanelWidth: Number(localStorage.getItem('groove:editorAiPanelWidth')) || 360,
  editorGitStatus: null,
  editorGitBranch: null,
  editorGitDiff: null,
  editorQuickSearchOpen: false,

  // ── Workspace Snapshots ────────────────────────────────────
  workspaceSnapshots: {},

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
  setEditorTheme(theme) {
    set({ editorTheme: theme });
    localStorage.setItem('groove:editorTheme', theme);
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

  // ── Editor (Cursor-style) ──────────────────────────────────

  setEditorAgent(id) {
    set({ editorSelectedAgent: id });
  },

  setEditorViewMode(mode) {
    set({ editorViewMode: mode });
  },

  toggleAiPanel() {
    set((s) => {
      const open = !s.editorAiPanelOpen;
      return { editorAiPanelOpen: open };
    });
  },

  setEditorAiPanelWidth(width) {
    set({ editorAiPanelWidth: width });
    localStorage.setItem('groove:editorAiPanelWidth', String(width));
  },

  setEditorQuickSearchOpen(open) {
    set({ editorQuickSearchOpen: open });
  },

  attachSnippet(snippet) {
    set({ editorPendingSnippet: snippet });
    if (!get().editorAiPanelOpen) {
      set({ editorAiPanelOpen: true });
    }
  },

  clearSnippet() {
    set({ editorPendingSnippet: null });
  },

  async sendCodeToAgent(agentId, instruction, filePath, lineStart, lineEnd, selectedCode) {
    if (!agentId) return;
    get().attachSnippet({
      type: 'code',
      instruction,
      filePath,
      lineStart,
      lineEnd,
      code: selectedCode,
    });
  },

  async fetchGitStatus() {
    try {
      const data = await api.get('/files/git-status');
      set({ editorGitStatus: data });
      return data;
    } catch { return null; }
  },

  async fetchGitBranch() {
    try {
      const data = await api.get('/files/git-branch');
      set({ editorGitBranch: data });
      return data;
    } catch { return null; }
  },

  async fetchGitDiff(path) {
    try {
      const url = path ? `/files/git-diff?path=${encodeURIComponent(path)}` : '/files/git-diff';
      const data = await api.get(url);
      set({ editorGitDiff: data });
      return data;
    } catch { return null; }
  },
});
