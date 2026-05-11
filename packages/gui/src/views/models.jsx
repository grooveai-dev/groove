// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useEffect, useRef, useMemo } from 'react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { api } from '../lib/api';
import { useToast } from '../lib/hooks/use-toast';
import { useGrooveStore } from '../stores/groove';
import {
  Search, Download, Trash2, HardDrive, Cpu, MemoryStick,
  Check, Loader2, Box, ChevronDown, ChevronRight,
  RefreshCw, Play, Square, Rocket, MoreHorizontal,
  Sparkles, FlaskConical, ExternalLink,
} from 'lucide-react';
import { cn } from '../lib/cn';

function formatBytes(bytes) {
  if (!bytes) return '—';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatSpeed(bytesPerSec) {
  if (!bytesPerSec) return '';
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(0)} KB/s`;
  return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
}

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'running', label: 'Running' },
  { id: 'ready', label: 'Ready' },
  { id: 'downloaded', label: 'Downloaded' },
];

const STATUS_CONFIG = {
  running:     { label: 'Running',     variant: 'success', dot: 'pulse' },
  ready:       { label: 'Ready',       variant: 'info',    dot: true },
  downloaded:  { label: 'Downloaded',  variant: 'purple',  dot: true },
  downloading: { label: 'Downloading', variant: 'accent',  dot: 'pulse' },
};

// ── Unified Model Card ──────────────────────────────────────────

function UnifiedModelCard({
  model, serverRunning,
  onStart, onStop, onSpawn, onDelete, onImport,
  isLoading, isUnloading, isDeleting, isImporting,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

  const status = STATUS_CONFIG[model.status] || STATUS_CONFIG.ready;

  return (
    <div className={cn(
      'group rounded-xl border p-4 transition-all',
      model.status === 'running'
        ? 'bg-success/5 border-success/20 hover:border-success/40'
        : 'bg-surface-1 border-border-subtle hover:border-accent/30',
    )}>
      {/* Header: name + badges + menu */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0 flex-1">
          <span className="text-sm font-mono font-bold text-text-0 truncate block">{model.name}</span>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            <Badge variant={model.source === 'ollama' ? 'info' : 'purple'} className="text-2xs">
              {model.source === 'ollama' ? 'Ollama' : 'GGUF'}
            </Badge>
            <Badge variant={status.variant} dot={status.dot} className="text-2xs">
              {status.label}
            </Badge>
            {model.isInLab && (
              <Badge variant="accent" className="text-2xs gap-0.5">
                <FlaskConical size={8} /> Lab
              </Badge>
            )}
          </div>
        </div>

        {model.status !== 'downloading' && (
          <div ref={menuRef} className="relative flex-shrink-0">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="p-1.5 rounded-md text-text-4 hover:text-text-2 hover:bg-surface-3 transition-colors cursor-pointer"
            >
              <MoreHorizontal size={14} />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 z-50 min-w-[160px] bg-surface-3 border border-border rounded-lg shadow-lg py-1">
                {model.source === 'gguf' && (
                  <button
                    onClick={() => { onImport(model.id); setMenuOpen(false); }}
                    disabled={isImporting}
                    className="w-full text-left px-3 py-1.5 text-xs font-sans text-text-1 hover:bg-surface-4 transition-colors cursor-pointer flex items-center gap-2 disabled:opacity-40"
                  >
                    <Rocket size={12} /> Import to Ollama
                  </button>
                )}
                <button
                  onClick={() => { onDelete(model); setMenuOpen(false); }}
                  disabled={isDeleting}
                  className="w-full text-left px-3 py-1.5 text-xs font-sans text-danger hover:bg-danger/10 transition-colors cursor-pointer flex items-center gap-2 disabled:opacity-40"
                >
                  <Trash2 size={12} /> Delete
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Specs */}
      <div className="text-2xs text-text-3 font-sans mb-3 flex items-center gap-1.5 flex-wrap">
        {model.parameters && <span>{model.parameters}</span>}
        {model.parameters && model.quantization && <span className="text-text-4">&middot;</span>}
        {model.quantization && <span>{model.quantization}</span>}
        {(model.parameters || model.quantization) && model.size && model.size !== '—' && (
          <span className="text-text-4">&middot;</span>
        )}
        {model.size && model.size !== '—' && <span>{model.size}</span>}
        {model.vramGb && (
          <>
            <span className="text-text-4">&middot;</span>
            <span className="text-green-400">{model.vramGb} GB VRAM</span>
          </>
        )}
        {model.repoId && (
          <>
            <span className="text-text-4">&middot;</span>
            <span className="truncate max-w-[140px]">{model.repoId}</span>
          </>
        )}
      </div>

      {/* Download progress inline */}
      {model.status === 'downloading' && model.download && (
        <div className="mb-3 space-y-1">
          <div className="flex items-center justify-between text-2xs font-sans text-text-3">
            <span className="truncate">{model.download.filename}</span>
            <span>{Math.round((model.download.percent || 0) * 100)}% {formatSpeed(model.download.speed)}</span>
          </div>
          <div className="h-1.5 bg-surface-3 rounded-full overflow-hidden">
            <div
              className="h-full bg-accent rounded-full transition-all"
              style={{ width: `${Math.round((model.download.percent || 0) * 100)}%` }}
            />
          </div>
          <div className="text-2xs text-text-4">
            {formatBytes(model.download.downloaded)} / {formatBytes(model.download.totalBytes)}
          </div>
        </div>
      )}
      {model.status === 'downloading' && model.pullProgress && (
        <div className="mb-3">
          <div className="flex items-center gap-2">
            <Loader2 size={12} className="animate-spin text-accent flex-shrink-0" />
            <span className="text-2xs text-text-3 font-sans truncate">
              {model.pullProgress.progress || 'Pulling...'}
            </span>
          </div>
          <div className="mt-1.5 h-1.5 bg-surface-3 rounded-full overflow-hidden">
            <div className="h-full bg-accent rounded-full animate-pulse w-full" />
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-2 mt-auto">
        {model.status === 'running' && (
          <>
            <button
              onClick={() => onStop(model.name)}
              disabled={isUnloading}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-2xs font-sans font-medium text-text-2 hover:text-warning hover:bg-warning/10 transition-colors cursor-pointer disabled:opacity-40"
            >
              {isUnloading ? <Loader2 size={11} className="animate-spin" /> : <Square size={11} />}
              Stop
            </button>
            <button
              onClick={() => onSpawn(model.name)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-2xs font-sans font-medium bg-accent/10 text-accent hover:bg-accent/20 transition-colors cursor-pointer"
            >
              <Rocket size={11} /> Spawn Agent
            </button>
          </>
        )}
        {model.status === 'ready' && (
          <>
            {serverRunning && (
              <button
                onClick={() => onStart(model.id)}
                disabled={isLoading}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-2xs font-sans font-medium text-text-2 hover:text-success hover:bg-success/10 transition-colors cursor-pointer disabled:opacity-40"
              >
                {isLoading ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
                Run
              </button>
            )}
            <button
              onClick={() => onSpawn(model.id)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-2xs font-sans font-medium bg-accent/10 text-accent hover:bg-accent/20 transition-colors cursor-pointer"
            >
              <Rocket size={11} /> Spawn Agent
            </button>
          </>
        )}
        {model.status === 'downloaded' && (
          <button
            onClick={() => onImport(model.id)}
            disabled={isImporting}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-2xs font-sans font-medium bg-accent/10 text-accent hover:bg-accent/20 transition-colors cursor-pointer disabled:opacity-40"
          >
            {isImporting ? <Loader2 size={11} className="animate-spin" /> : <Rocket size={11} />}
            {isImporting ? 'Importing...' : 'Launch'}
          </button>
        )}
      </div>
    </div>
  );
}

// ── File Picker (quantization variants for HuggingFace results) ──

function FilePicker({ repoId, onDownload, systemRamGb }) {
  const [files, setFiles] = useState(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(null);
  const toast = useToast();

  useEffect(() => {
    setLoading(true);
    api.get(`/models/${repoId}/files`)
      .then((data) => setFiles(data.files || []))
      .catch(() => toast.error('Failed to load model files'))
      .finally(() => setLoading(false));
  }, [repoId]);

  async function handleDownload(file) {
    setDownloading(file.filename);
    try {
      await api.post('/models/download', { repoId, filename: file.filename });
      toast.success(`Downloading ${file.filename}`);
      onDownload?.(file.filename);
    } catch (err) {
      toast.error(err.message);
    }
    setDownloading(null);
  }

  if (loading) {
    return <div className="py-3 px-4 text-2xs text-text-4 font-sans">Loading quantization variants...</div>;
  }
  if (!files?.length) {
    return <div className="py-3 px-4 text-2xs text-text-4 font-sans">No GGUF files found in this repo.</div>;
  }

  return (
    <div className="pl-6 pr-4 pb-2 space-y-1.5">
      {files.map((f) => {
        const canRun = !f.estimatedRamGb || !systemRamGb || f.estimatedRamGb <= systemRamGb;
        const tight = f.estimatedRamGb && systemRamGb && f.estimatedRamGb > systemRamGb * 0.8 && canRun;
        return (
          <div key={f.filename} className={cn(
            'flex items-center gap-2 py-1.5 px-3 rounded-md text-xs font-sans',
            canRun ? 'bg-surface-2' : 'bg-red-500/5 border border-red-500/15',
          )}>
            <span className="font-mono text-text-1 truncate flex-1">{f.filename}</span>
            {f.quantization && <Badge variant="default" className="text-2xs">{f.quantization}</Badge>}
            <span className="text-text-2 text-2xs w-16 text-right">{formatBytes(f.size)}</span>
            {f.estimatedRamGb && (
              <span className={cn(
                'text-2xs w-20 text-right font-medium',
                !canRun ? 'text-red-400' : tight ? 'text-yellow-400' : 'text-green-400',
              )}>
                ~{f.estimatedRamGb} GB RAM
              </span>
            )}
            {!canRun && <span className="text-2xs text-red-400 font-medium">too large</span>}
            <button
              onClick={() => handleDownload(f)}
              disabled={downloading === f.filename || !canRun}
              className={cn(
                'p-1 rounded transition-colors cursor-pointer',
                canRun ? 'text-accent hover:bg-accent/10' : 'text-text-4 cursor-not-allowed',
                'disabled:opacity-40',
              )}
            >
              {downloading === f.filename ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ── Main View ────────────────────────────────────────────────────

export default function ModelsView() {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [recommended, setRecommended] = useState([]);
  const [downloads, setDownloads] = useState([]);
  const [expandedResult, setExpandedResult] = useState(null);
  const [serverAction, setServerAction] = useState(null);
  const [loadingModel, setLoadingModel] = useState(null);
  const [unloadingModel, setUnloadingModel] = useState(null);
  const [deletingModel, setDeletingModel] = useState(null);
  const [ggufModels, setGgufModels] = useState([]);
  const [deletingGguf, setDeletingGguf] = useState(null);
  const [importingGguf, setImportingGguf] = useState(null);
  const [filter, setFilter] = useState('all');
  const [discoveryOpen, setDiscoveryOpen] = useState(true);
  const [discoveryTab, setDiscoveryTab] = useState('recommended');
  const toast = useToast();
  const searchInputRef = useRef(null);
  const discoveryRef = useRef(null);

  const ollamaStatus = useGrooveStore((s) => s.ollamaStatus);
  const installedModels = useGrooveStore((s) => s.ollamaInstalledModels);
  const runningModels = useGrooveStore((s) => s.ollamaRunningModels);
  const catalog = useGrooveStore((s) => s.ollamaCatalog);
  const pullProgress = useGrooveStore((s) => s.ollamaPullProgress);
  const labActiveModel = useGrooveStore((s) => s.labActiveModel);
  const fetchOllamaStatus = useGrooveStore((s) => s.fetchOllamaStatus);
  const startServer = useGrooveStore((s) => s.startOllamaServer);
  const stopServer = useGrooveStore((s) => s.stopOllamaServer);
  const restartServer = useGrooveStore((s) => s.restartOllamaServer);
  const pullModel = useGrooveStore((s) => s.pullOllamaModel);
  const deleteModel = useGrooveStore((s) => s.deleteOllamaModel);
  const loadModel = useGrooveStore((s) => s.loadOllamaModel);
  const unloadModel = useGrooveStore((s) => s.unloadOllamaModel);
  const spawnFromModel = useGrooveStore((s) => s.spawnFromModel);

  const pollingRef = useRef(null);

  // Poll Ollama status
  useEffect(() => {
    fetchOllamaStatus();
    pollingRef.current = setInterval(fetchOllamaStatus, 10000);
    return () => clearInterval(pollingRef.current);
  }, [fetchOllamaStatus]);

  // Fetch recommended + GGUF on mount
  useEffect(() => {
    api.get('/models/recommended').then((data) => {
      setRecommended(data.models || []);
    }).catch(() => {});
    api.get('/models/installed').then((data) => {
      setGgufModels((data.models || []).filter((m) => m.exists));
    }).catch(() => {});
  }, []);

  // Poll active downloads
  useEffect(() => {
    const poll = setInterval(() => {
      api.get('/models/downloads').then(setDownloads).catch(() => {});
    }, 2000);
    return () => clearInterval(poll);
  }, []);

  // WebSocket events for GGUF downloads
  useEffect(() => {
    function handleWs(event) {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'model:download:progress') {
          setDownloads((prev) => {
            const idx = prev.findIndex((d) => d.filename === msg.data.filename);
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = msg.data;
              return next;
            }
            return [...prev, msg.data];
          });
        }
        if (msg.type === 'model:download:complete') {
          setDownloads((prev) => prev.filter((d) => d.filename !== msg.data.filename));
          toast.success(`${msg.data.filename} downloaded`);
          api.get('/models/installed').then((data) => {
            setGgufModels((data.models || []).filter((m) => m.exists));
          }).catch(() => {});
        }
        if (msg.type === 'model:download:error') {
          setDownloads((prev) => prev.filter((d) => d.filename !== msg.data.filename));
          toast.error(`Download failed: ${msg.data.error}`);
        }
      } catch {}
    }
    const ws = useGrooveStore.getState().ws;
    if (ws) ws.addEventListener('message', handleWs);
    return () => { if (ws) ws.removeEventListener('message', handleWs); };
  }, [toast]);

  // ── Handlers ──────────────────────────────────────────────────

  async function handleServerStart() {
    setServerAction('starting');
    try { await startServer(); } catch {}
    setServerAction(null);
  }

  async function handleServerStop() {
    setServerAction('stopping');
    try { await stopServer(); } catch {}
    setServerAction(null);
  }

  async function handleServerRestart() {
    setServerAction('restarting');
    try { await restartServer(); } catch {}
    setServerAction(null);
  }

  async function handleLoadModel(modelId) {
    setLoadingModel(modelId);
    try { await loadModel(modelId); } catch {}
    setLoadingModel(null);
  }

  async function handleUnloadModel(modelId) {
    setUnloadingModel(modelId);
    try { await unloadModel(modelId); } catch {}
    setUnloadingModel(null);
  }

  async function handleDeleteModel(modelId) {
    setDeletingModel(modelId);
    try { await deleteModel(modelId); } catch {}
    setDeletingModel(null);
  }

  async function handleImportToOllama(modelId) {
    setImportingGguf(modelId);
    try {
      const result = await api.post(`/models/${encodeURIComponent(modelId)}/import-to-ollama`);
      toast.success(`Imported as "${result.ollamaName}" — now available in Ollama`);
      fetchOllamaStatus();
      setGgufModels((prev) => prev.filter((m) => m.id !== modelId));
    } catch (err) {
      toast.error(`Import failed: ${err.message}`);
    }
    setImportingGguf(null);
  }

  async function handleDeleteGguf(modelId) {
    setDeletingGguf(modelId);
    try {
      await api.delete(`/models/${encodeURIComponent(modelId)}`);
      setGgufModels((prev) => prev.filter((m) => m.id !== modelId));
      toast.success(`Removed ${modelId}`);
    } catch (err) {
      toast.error(`Delete failed: ${err.message}`);
    }
    setDeletingGguf(null);
  }

  function handleDeleteUnified(model) {
    if (model.source === 'gguf') handleDeleteGguf(model.id);
    else handleDeleteModel(model.id);
  }

  async function handleSearch() {
    if (!searchQuery.trim()) return;
    setSearching(true);
    setDiscoveryOpen(true);
    setDiscoveryTab('search');
    try {
      const results = await api.get(`/models/search?q=${encodeURIComponent(searchQuery.trim())}`);
      setSearchResults(results);
    } catch (err) {
      toast.error(err.message);
    }
    setSearching(false);
  }

  // ── Computed: catalog lookup ───────────────────────────────────

  const catalogByBase = useMemo(() => {
    const map = {};
    for (const c of catalog) {
      const base = c.id.split(':')[0];
      map[base] = c;
      map[c.id] = c;
    }
    return map;
  }, [catalog]);

  function getCatalogEntry(modelId) {
    if (catalogByBase[modelId]) return catalogByBase[modelId];
    return catalogByBase[modelId.split(':')[0]] || null;
  }

  // ── Computed: lab model check ──────────────────────────────────

  function isModelInLab(modelId) {
    if (!labActiveModel) return false;
    if (typeof labActiveModel === 'string') return labActiveModel === modelId;
    return labActiveModel.name === modelId || labActiveModel.id === modelId;
  }

  // ── Computed: unified model list ──────────────────────────────

  const unifiedModels = useMemo(() => {
    const models = [];
    const seen = new Set();

    for (const m of runningModels) {
      seen.add(m.name);
      const installed = installedModels.find((im) => im.id === m.name);
      const cat = getCatalogEntry(m.name);
      models.push({
        id: m.name,
        name: m.name,
        source: 'ollama',
        status: 'running',
        size: installed?.size || (m.size ? formatBytes(m.size) : '—'),
        parameters: cat?.parameters || installed?.parameters,
        quantization: installed?.quantization,
        tier: installed?.tier,
        vramGb: m.vram ? (m.vram / (1024 ** 3)).toFixed(1) : m.size ? (m.size / (1024 ** 3)).toFixed(1) : null,
        isInLab: isModelInLab(m.name),
      });
    }

    for (const m of installedModels) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      const cat = getCatalogEntry(m.id);
      models.push({
        id: m.id,
        name: m.id,
        source: 'ollama',
        status: 'ready',
        size: m.size || '—',
        parameters: cat?.parameters || m.parameters,
        quantization: m.quantization,
        tier: m.tier,
        category: m.category,
        isInLab: isModelInLab(m.id),
        catalogEntry: cat,
      });
    }

    for (const m of ggufModels) {
      seen.add(m.id);
      models.push({
        id: m.id,
        name: m.id,
        source: 'gguf',
        status: 'downloaded',
        size: m.sizeBytes ? formatBytes(m.sizeBytes) : '—',
        parameters: m.parameters,
        quantization: m.quantization,
        isInLab: isModelInLab(m.id),
        repoId: m.repoId,
        contextWindow: m.contextWindow,
      });
    }

    for (const d of downloads) {
      if (seen.has(d.filename)) continue;
      models.push({
        id: `dl-${d.filename}`,
        name: d.filename,
        source: 'gguf',
        status: 'downloading',
        download: d,
      });
    }

    for (const [id, prog] of Object.entries(pullProgress)) {
      if (seen.has(id)) continue;
      models.push({
        id: `pull-${id}`,
        name: id,
        source: 'ollama',
        status: 'downloading',
        pullProgress: prog,
      });
    }

    return models;
  }, [runningModels, installedModels, ggufModels, downloads, pullProgress, labActiveModel, catalog]);

  // ── Computed: filter + search ──────────────────────────────────

  const filteredModels = useMemo(() => {
    let list = unifiedModels;
    if (filter === 'running') list = list.filter((m) => m.status === 'running');
    else if (filter === 'ready') list = list.filter((m) => m.status === 'ready');
    else if (filter === 'downloaded') list = list.filter((m) => m.status === 'downloaded' || m.status === 'downloading');
    if (searchQuery.trim() && discoveryTab !== 'search') {
      const q = searchQuery.toLowerCase();
      list = list.filter((m) => m.name.toLowerCase().includes(q));
    }
    return list;
  }, [unifiedModels, filter, searchQuery, discoveryTab]);

  const filterCounts = useMemo(() => ({
    all: unifiedModels.length,
    running: unifiedModels.filter((m) => m.status === 'running').length,
    ready: unifiedModels.filter((m) => m.status === 'ready').length,
    downloaded: unifiedModels.filter((m) => m.status === 'downloaded' || m.status === 'downloading').length,
  }), [unifiedModels]);

  const hasNoModels = unifiedModels.length === 0;

  // ── Render ─────────────────────────────────────────────────────

  return (
    <div className="h-full flex flex-col bg-surface-0">
      {/* ════ ZONE 1: Sticky Toolbar ════ */}
      <div className="flex-shrink-0 px-5 pt-4 pb-3 border-b border-border space-y-3">

        {/* Server status row */}
        {!ollamaStatus.installed ? (
          <div className="flex items-center gap-2 bg-surface-1 border border-border-subtle rounded-lg px-3 py-2">
            <span className="w-1.5 h-1.5 rounded-full bg-text-4 flex-shrink-0" />
            <span className="text-xs font-sans text-text-3 font-medium">Ollama Not Installed</span>
            <div className="flex-1" />
            <a
              href="https://ollama.ai/download"
              target="_blank"
              rel="noopener noreferrer"
              className="text-2xs font-sans text-accent hover:underline flex items-center gap-1"
            >
              Install <ExternalLink size={10} />
            </a>
          </div>
        ) : ollamaStatus.serverRunning ? (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="relative flex-shrink-0 w-1.5 h-1.5">
              <span className="absolute inset-0 rounded-full bg-success" />
              <span className="absolute inset-[-2px] rounded-full bg-success opacity-20 animate-pulse" />
            </span>
            <span className="text-xs font-sans text-text-1 font-medium">Ollama</span>
            <span className="text-2xs font-mono text-text-4">:11434</span>

            {ollamaStatus.hardware && (
              <div className="flex items-center gap-1.5 ml-2">
                <div className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-surface-2 text-2xs font-sans text-text-2">
                  <MemoryStick size={10} className="text-text-3" />
                  {ollamaStatus.hardware.totalRamGb} GB
                </div>
                <div className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-surface-2 text-2xs font-sans text-text-2">
                  <Cpu size={10} className="text-text-3" />
                  {ollamaStatus.hardware.cores} cores
                </div>
                {ollamaStatus.hardware.gpu && (
                  <div className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-surface-2 text-2xs font-sans text-text-2">
                    <HardDrive size={10} className="text-text-3" />
                    {ollamaStatus.hardware.gpu.name}
                    {ollamaStatus.hardware.gpu.vram ? ` (${ollamaStatus.hardware.gpu.vram} GB)` : ''}
                  </div>
                )}
                {ollamaStatus.hardware.isAppleSilicon && (
                  <Badge variant="accent" className="text-2xs">Unified Memory</Badge>
                )}
              </div>
            )}

            <div className="flex-1" />
            <button
              onClick={handleServerRestart}
              disabled={!!serverAction}
              className="flex items-center gap-1 text-2xs font-sans text-text-3 hover:text-accent cursor-pointer transition-colors disabled:opacity-40"
            >
              <RefreshCw size={10} className={serverAction === 'restarting' ? 'animate-spin' : ''} />
              {serverAction === 'restarting' ? 'Restarting...' : 'Restart'}
            </button>
            <button
              onClick={handleServerStop}
              disabled={!!serverAction}
              className="flex items-center gap-1 text-2xs font-sans text-text-3 hover:text-danger cursor-pointer transition-colors disabled:opacity-40"
            >
              <Square size={10} />
              {serverAction === 'stopping' ? 'Stopping...' : 'Stop'}
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 bg-danger/8 border border-danger/20 rounded-lg px-3 py-2">
            <span className="w-1.5 h-1.5 rounded-full bg-danger flex-shrink-0" />
            <span className="text-xs font-sans text-danger font-semibold">Ollama Stopped</span>
            <span className="text-2xs font-mono text-text-4">:11434</span>
            <div className="flex-1" />
            <Button
              variant="primary"
              size="sm"
              onClick={handleServerStart}
              disabled={!!serverAction}
              className="h-6 px-2.5 text-2xs gap-1"
            >
              <Play size={10} />
              {serverAction === 'starting' ? 'Starting...' : 'Start Server'}
            </Button>
          </div>
        )}

        {/* Search + Filter row */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-md">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-4" />
            <input
              ref={searchInputRef}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="Search models or HuggingFace..."
              className="w-full h-8 pl-9 pr-3 text-sm rounded-md bg-surface-1 border border-border text-text-0 font-sans placeholder:text-text-4 focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>

          <div className="flex items-center gap-1">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={cn(
                  'px-2.5 py-1 rounded-md text-2xs font-sans font-medium transition-colors cursor-pointer',
                  filter === f.id
                    ? 'bg-accent/12 text-accent'
                    : 'text-text-3 hover:text-text-1 hover:bg-surface-3',
                )}
              >
                {f.label}
                {filterCounts[f.id] > 0 && (
                  <span className={cn('ml-1', filter === f.id ? 'text-accent/60' : 'text-text-4')}>
                    {filterCounts[f.id]}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ════ ZONE 2 + 3: Scrollable Content ════ */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="p-5 space-y-6">

          {/* Empty State */}
          {hasNoModels && !searchQuery.trim() && filter === 'all' ? (
            <div className="flex flex-col items-center justify-center py-16 px-8">
              <Box size={48} className="text-text-4 mb-4" />
              <h2 className="text-lg font-sans font-bold text-text-0 mb-1">Get started with local models</h2>
              <p className="text-sm text-text-3 font-sans text-center max-w-md mb-6">
                Run AI models locally for privacy, speed, and zero API costs.
                Pull popular models from Ollama or download GGUF files from HuggingFace.
              </p>
              <div className="flex gap-3">
                <Button
                  variant="primary"
                  onClick={() => {
                    setDiscoveryOpen(true);
                    setDiscoveryTab('recommended');
                    discoveryRef.current?.scrollIntoView({ behavior: 'smooth' });
                  }}
                  className="gap-2"
                >
                  <Download size={14} /> Pull from Ollama
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    searchInputRef.current?.focus();
                  }}
                  className="gap-2"
                >
                  <Search size={14} /> Search HuggingFace
                </Button>
              </div>
            </div>
          ) : filteredModels.length === 0 ? (
            <div className="text-center py-12">
              <Search size={32} className="mx-auto text-text-4 mb-2" />
              <p className="text-sm text-text-2 font-sans font-medium">No models match your filter</p>
              <p className="text-xs text-text-3 font-sans mt-1">
                Try changing the filter or clearing your search.
              </p>
            </div>
          ) : (
            /* ── Card Grid ── */
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
              {filteredModels.map((model) => (
                <UnifiedModelCard
                  key={model.id}
                  model={model}
                  serverRunning={ollamaStatus.serverRunning}
                  onStart={handleLoadModel}
                  onStop={handleUnloadModel}
                  onSpawn={spawnFromModel}
                  onDelete={handleDeleteUnified}
                  onImport={handleImportToOllama}
                  isLoading={loadingModel === model.id}
                  isUnloading={unloadingModel === model.id || unloadingModel === model.name}
                  isDeleting={deletingModel === model.id || deletingGguf === model.id}
                  isImporting={importingGguf === model.id}
                />
              ))}
            </div>
          )}

          {/* ════ ZONE 3: Discovery ════ */}
          <div ref={discoveryRef} className="border-t border-border-subtle pt-4">
            <button
              onClick={() => setDiscoveryOpen(!discoveryOpen)}
              className="flex items-center gap-2 mb-3 cursor-pointer group"
            >
              {discoveryOpen
                ? <ChevronDown size={14} className="text-text-3 group-hover:text-text-1 transition-colors" />
                : <ChevronRight size={14} className="text-text-3 group-hover:text-text-1 transition-colors" />}
              <Sparkles size={14} className="text-text-3" />
              <span className="text-xs font-semibold font-sans text-text-2 uppercase tracking-wider">
                Discover Models
              </span>
            </button>

            {discoveryOpen && (
              <div className="space-y-4">
                {/* Discovery tabs */}
                <div className="flex gap-1">
                  {[
                    { id: 'recommended', label: `Recommended (${recommended.length})` },
                    { id: 'search', label: `Search Results (${searchResults.length})` },
                  ].map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setDiscoveryTab(t.id)}
                      className={cn(
                        'px-3 py-1 rounded-md text-xs font-sans font-medium transition-colors cursor-pointer',
                        discoveryTab === t.id ? 'bg-accent/12 text-accent' : 'text-text-3 hover:text-text-1 hover:bg-surface-3',
                      )}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>

                {/* Recommended — horizontal scroll */}
                {discoveryTab === 'recommended' && (
                  <>
                    {recommended.length === 0 ? (
                      <div className="text-center py-8">
                        <Cpu size={32} className="mx-auto text-text-4 mb-2" />
                        <p className="text-sm text-text-2 font-sans font-medium">Detecting hardware...</p>
                        <p className="text-xs text-text-3 font-sans mt-1">Make sure Ollama is installed so we can check your system.</p>
                      </div>
                    ) : (
                      <>
                        <div className="text-xs text-text-3 font-sans">
                          Top models for your system ({ollamaStatus.hardware?.totalRamGb || '?'} GB RAM). Click Pull to download via Ollama.
                        </div>
                        <div className="flex gap-3 overflow-x-auto pb-2">
                          {recommended.map((m) => {
                            const baseId = m.id.split(':')[0];
                            const isInstalled = installedModels.some((im) =>
                              im.id === m.id || im.id.startsWith(baseId + ':') || im.id === baseId
                            );
                            const headroom = ollamaStatus.hardware?.totalRamGb
                              ? Math.round((1 - m.ramGb / ollamaStatus.hardware.totalRamGb) * 100)
                              : null;
                            const isPulling = !!pullProgress[m.id];

                            return (
                              <div
                                key={m.id}
                                className={cn(
                                  'flex-shrink-0 w-[240px] p-3 rounded-xl border transition-colors',
                                  isInstalled
                                    ? 'bg-success/5 border-success/20'
                                    : 'bg-surface-1 border-border-subtle hover:border-accent/30',
                                )}
                              >
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="text-sm font-mono font-bold text-text-0 truncate">{m.name}</span>
                                  {isInstalled && <Check size={12} className="text-success flex-shrink-0" />}
                                </div>
                                <div className="text-2xs text-text-3 font-sans line-clamp-1 mb-2">{m.description}</div>
                                <div className="flex items-center gap-2 text-2xs font-sans mb-2">
                                  <span className="text-text-2">{m.sizeGb} GB</span>
                                  <span className="text-green-400 font-medium">{m.ramGb} GB RAM</span>
                                  {headroom !== null && <span className="text-text-4">{headroom}%</span>}
                                </div>
                                {isInstalled ? (
                                  <Badge variant="success" className="text-2xs">Installed</Badge>
                                ) : (
                                  <button
                                    onClick={() => pullModel(m.id)}
                                    disabled={isPulling}
                                    className="w-full flex items-center justify-center gap-1.5 h-7 rounded-md text-xs font-sans font-medium bg-accent/10 text-accent hover:bg-accent/20 transition-colors cursor-pointer disabled:opacity-40"
                                  >
                                    {isPulling ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                                    Pull
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </>
                )}

                {/* Search results */}
                {discoveryTab === 'search' && (
                  <>
                    {searching ? (
                      <div className="text-center py-8">
                        <Loader2 size={24} className="mx-auto text-accent animate-spin mb-2" />
                        <p className="text-sm text-text-3 font-sans">Searching HuggingFace...</p>
                      </div>
                    ) : searchResults.length === 0 ? (
                      <div className="text-center py-8">
                        <Search size={32} className="mx-auto text-text-4 mb-2" />
                        <p className="text-sm text-text-2 font-sans font-medium">Search for GGUF models</p>
                        <p className="text-xs text-text-3 font-sans mt-1">
                          Type a query above and press Enter — try "qwen coder", "deepseek", "codestral", "llama"
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {searchResults.map((r) => (
                          <div key={r.id} className="space-y-1">
                            <button
                              onClick={() => setExpandedResult(expandedResult === r.id ? null : r.id)}
                              className="w-full text-left px-4 py-3 bg-surface-1 border border-border-subtle rounded-lg hover:border-accent/30 transition-colors cursor-pointer"
                            >
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-mono font-bold text-text-0 truncate flex-1">{r.name}</span>
                                <span className="text-2xs text-text-4 font-sans">{r.author}</span>
                                {expandedResult === r.id
                                  ? <ChevronDown size={14} className="text-text-3" />
                                  : <ChevronRight size={14} className="text-text-3" />}
                              </div>
                              <div className="text-2xs text-text-3 font-sans mt-0.5 flex gap-3">
                                <span>{r.downloads?.toLocaleString()} downloads</span>
                                <span>{r.likes} likes</span>
                              </div>
                            </button>
                            {expandedResult === r.id && (
                              <FilePicker repoId={r.id} systemRamGb={ollamaStatus.hardware?.totalRamGb} />
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
