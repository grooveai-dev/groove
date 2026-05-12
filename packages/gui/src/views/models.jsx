// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useEffect, useRef, useMemo } from 'react';
import { Button } from '../components/ui/button';
import { api } from '../lib/api';
import { useToast } from '../lib/hooks/use-toast';
import { useGrooveStore } from '../stores/groove';
import {
  Search, Download, Trash2, HardDrive, Cpu, MemoryStick,
  Check, Loader2, Box, ChevronDown, ChevronRight,
  RefreshCw, Play, Square, Rocket, MoreHorizontal,
  ExternalLink,
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

const STATUS_LABEL = {
  running: 'running',
  ready: 'ready',
  downloaded: 'downloaded',
  downloading: 'pulling',
};

// ── Model Card ─────────────────────────────────────────────────

function ModelCard({
  model, runtimes,
  onStop, onSpawn, onDelete,
  onStartRuntime, onCreateRuntime,
  isStarting, isUnloading, isDeleting,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [runtimeMenuOpen, setRuntimeMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const runtimeRef = useRef(null);

  useEffect(() => {
    if (!menuOpen && !runtimeMenuOpen) return;
    const close = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
      if (runtimeRef.current && !runtimeRef.current.contains(e.target)) setRuntimeMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen, runtimeMenuOpen]);

  function handleRuntimeClick() {
    if (runtimes.length === 0) {
      onCreateRuntime();
    } else if (runtimes.length === 1) {
      onStartRuntime(model.id, runtimes[0]);
    } else {
      setRuntimeMenuOpen(!runtimeMenuOpen);
    }
  }

  const specs = [
    model.parameters,
    model.quantization,
    model.size && model.size !== '—' && model.size,
  ].filter(Boolean);

  const formatTag = model.formatTag || (model.source === 'gguf' ? 'GGUF' : model.source === 'mlx' ? 'MLX' : model.source === 'hf' ? 'HF' : 'Ollama');

  return (
    <div className="group flex flex-col p-5 rounded-md border border-border-subtle bg-surface-1 min-h-[180px]">
      {/* Header: icon + name + menu */}
      <div className="flex items-start gap-3 mb-3">
        <div
          className="w-9 h-9 rounded-md flex items-center justify-center flex-shrink-0 text-base font-bold font-sans mt-0.5"
          style={{
            background: `hsl(${(model.name || '').charCodeAt(0) * 37 % 360}, 40%, 18%)`,
            color: `hsl(${(model.name || '').charCodeAt(0) * 37 % 360}, 60%, 65%)`,
          }}
        >
          {(model.name || '?')[0].toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[14px] font-semibold text-text-0 font-sans truncate">{model.name}</span>
            {model.status === 'running' && (
              <span className="relative flex-shrink-0 w-2 h-2">
                <span className="absolute inset-0 rounded-full bg-success" />
                <span className="absolute inset-[-2px] rounded-full bg-success opacity-30 animate-pulse" />
              </span>
            )}
            {model.status === 'downloading' && (
              <Loader2 size={12} className="animate-spin text-text-3 flex-shrink-0" />
            )}
          </div>
          <span className="text-2xs text-text-3 font-sans">
            {formatTag} · {STATUS_LABEL[model.status]}
          </span>
        </div>
        {/* Overflow menu — upper right */}
        {model.status !== 'downloading' && (
          <div ref={menuRef} className="relative flex-shrink-0 -mt-0.5 -mr-1">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="p-1 rounded text-text-4 hover:text-text-2 transition-colors cursor-pointer"
            >
              <MoreHorizontal size={14} />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 z-50 min-w-[160px] bg-surface-2 border border-border rounded-md shadow-lg py-1">
                <button
                  onClick={() => { onDelete(model); setMenuOpen(false); }}
                  disabled={isDeleting}
                  className="w-full text-left px-3 py-1.5 text-xs font-sans text-danger hover:bg-danger/5 transition-colors cursor-pointer flex items-center gap-2 disabled:opacity-40"
                >
                  <Trash2 size={10} /> Delete
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Specs */}
      <p className="text-xs text-text-2 font-sans leading-relaxed">
        {specs.length > 0 ? specs.join(' · ') : 'Local model'}
        {model.vramGb ? ` · ${model.vramGb} GB VRAM` : ''}
      </p>

      {/* Download progress */}
      {model.status === 'downloading' && model.download && (
        <div className="mt-2">
          <div className="flex items-center gap-2 mb-1">
            <div className="flex-1 h-1.5 rounded-full overflow-hidden bg-surface-4">
              <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${Math.round((model.download.percent || 0) * 100)}%` }} />
            </div>
            <span className="text-2xs font-mono text-text-3 tabular-nums">
              {Math.round((model.download.percent || 0) * 100)}%
            </span>
          </div>
          {model.download.speed && (
            <div className="text-2xs font-mono text-text-4">{formatSpeed(model.download.speed)}</div>
          )}
        </div>
      )}
      {model.status === 'downloading' && model.pullProgress && (
        <div className="flex items-center gap-2 mt-2">
          <Loader2 size={10} className="animate-spin text-text-3" />
          <span className="text-2xs font-sans text-text-3">Pulling…</span>
        </div>
      )}

      <div className="flex-1" />

      {/* Divider + Actions — left-aligned */}
      {model.status !== 'downloading' && (
        <>
          <div className="h-px bg-border-subtle my-2" />
          <div className="flex items-center gap-2">
            {model.status === 'running' ? (
              <>
                <button
                  onClick={() => onStop(model.name)}
                  disabled={isUnloading}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded text-2xs font-sans font-semibold text-text-3 hover:text-text-1 transition-colors cursor-pointer disabled:opacity-40"
                  title="Stop"
                >
                  {isUnloading ? <Loader2 size={10} className="animate-spin" /> : <Square size={10} />} Stop
                </button>
                <button
                  onClick={() => onSpawn(model.name)}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded text-2xs font-sans font-semibold text-accent hover:bg-accent/10 transition-colors cursor-pointer"
                >
                  <Rocket size={10} /> Spawn
                </button>
              </>
            ) : (
              <>
                {/* Runtime picker */}
                <div ref={runtimeRef} className="relative">
                  <button
                    onClick={handleRuntimeClick}
                    disabled={isStarting}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded text-2xs font-sans font-semibold text-accent hover:bg-accent/10 transition-colors cursor-pointer disabled:opacity-40"
                  >
                    {isStarting
                      ? <Loader2 size={10} className="animate-spin" />
                      : <Play size={10} />}
                    {runtimes.length === 0 ? 'Create Runtime' : 'Start Runtime'}
                  </button>
                  {runtimeMenuOpen && runtimes.length > 1 && (
                    <div className="absolute left-0 top-full mt-1 z-50 min-w-[180px] bg-surface-2 border border-border rounded-md shadow-lg py-1">
                      {runtimes.map((rt) => (
                        <button
                          key={rt.id}
                          onClick={() => { onStartRuntime(model.id, rt); setRuntimeMenuOpen(false); }}
                          className="w-full text-left px-3 py-1.5 text-xs font-sans text-text-2 hover:bg-surface-3 transition-colors cursor-pointer flex items-center gap-2"
                        >
                          <Play size={10} />
                          <span className="truncate flex-1">{rt.name}</span>
                          <span className="text-2xs text-text-4 flex-shrink-0">{rt.type}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => onSpawn(model.id)}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded text-2xs font-sans font-semibold text-text-3 hover:text-text-1 transition-colors cursor-pointer"
                >
                  <Rocket size={10} /> Spawn
                </button>
              </>
            )}
          </div>
        </>
      )}
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
    return <div className="py-2 px-4 text-2xs text-text-4 font-mono">Loading variants...</div>;
  }
  if (!files?.length) {
    return <div className="py-2 px-4 text-2xs text-text-4 font-mono">No GGUF files found.</div>;
  }

  return (
    <div className="pl-8 pr-4 pb-1 space-y-0">
      {files.map((f) => {
        const canRun = !f.estimatedRamGb || !systemRamGb || f.estimatedRamGb <= systemRamGb;
        return (
          <div key={f.filename} className={cn(
            'flex items-center gap-2 py-1 text-xs font-mono',
            !canRun && 'opacity-40',
          )}>
            <span className="text-text-2 truncate flex-1 min-w-0">{f.filename}</span>
            {f.quantization && <span className="text-text-4 flex-shrink-0">{f.quantization}</span>}
            <span className="text-text-3 flex-shrink-0 tabular-nums">{formatBytes(f.size)}</span>
            {f.estimatedRamGb && (
              <span className="text-text-4 flex-shrink-0 tabular-nums">~{f.estimatedRamGb} GB</span>
            )}
            {!canRun && <span className="text-2xs text-text-4">too large</span>}
            <button
              onClick={() => handleDownload(f)}
              disabled={downloading === f.filename || !canRun}
              className="p-0.5 rounded text-text-3 hover:text-text-1 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {downloading === f.filename ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
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
  const [unloadingModel, setUnloadingModel] = useState(null);
  const [deletingModel, setDeletingModel] = useState(null);
  const [ggufModels, setGgufModels] = useState([]);
  const [deletingGguf, setDeletingGguf] = useState(null);
  const [startingModel, setStartingModel] = useState(null);
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
  const labRuntimes = useGrooveStore((s) => s.labRuntimes);
  const labLocalModels = useGrooveStore((s) => s.labLocalModels);
  const fetchLabRuntimes = useGrooveStore((s) => s.fetchLabRuntimes);
  const fetchLabLocalModels = useGrooveStore((s) => s.fetchLabLocalModels);
  const launchLocalModel = useGrooveStore((s) => s.launchLocalModel);
  const setActiveView = useGrooveStore((s) => s.setActiveView);
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

  useEffect(() => {
    fetchOllamaStatus();
    fetchLabRuntimes();
    fetchLabLocalModels();
    pollingRef.current = setInterval(fetchOllamaStatus, 10000);
    return () => clearInterval(pollingRef.current);
  }, [fetchOllamaStatus, fetchLabRuntimes, fetchLabLocalModels]);

  useEffect(() => {
    api.get('/models/recommended').then((data) => {
      setRecommended(data.models || []);
    }).catch(() => {});
    api.get('/models/installed').then((data) => {
      setGgufModels((data.models || []).filter((m) => m.exists));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const poll = setInterval(() => {
      api.get('/models/downloads').then(setDownloads).catch(() => {});
    }, 2000);
    return () => clearInterval(poll);
  }, []);

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

  async function handleStartRuntime(modelId, runtime) {
    setStartingModel(modelId);
    try {
      if (runtime.type === 'ollama') {
        await loadModel(modelId);
      } else {
        await launchLocalModel(modelId);
      }
      fetchOllamaStatus();
    } catch {}
    setStartingModel(null);
  }

  function handleCreateRuntime() {
    setActiveView('model-lab');
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

  function isModelInLab(modelId) {
    if (!labActiveModel) return false;
    if (typeof labActiveModel === 'string') return labActiveModel === modelId;
    return labActiveModel.name === modelId || labActiveModel.id === modelId;
  }

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

    for (const m of labLocalModels) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      const tag = m.type === 'mlx' ? 'MLX' : m.type === 'hf' ? 'HF' : 'GGUF';
      models.push({
        id: m.id,
        name: m.name || m.id.replace(/^(mlx|hf|gguf):/, ''),
        source: m.type || 'hf',
        status: 'downloaded',
        size: m.sizeBytes ? formatBytes(m.sizeBytes) : '—',
        parameters: m.parameters,
        quantization: m.quantization,
        formatTag: tag,
        compatibleBackends: m.compatibleBackends,
        isInLab: isModelInLab(m.id),
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
  }, [runningModels, installedModels, ggufModels, labLocalModels, downloads, pullProgress, labActiveModel, catalog]);

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
  const hw = ollamaStatus.hardware;

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex-shrink-0 px-5 pt-3 pb-2.5 bg-surface-1 border-b border-border-subtle space-y-2.5">

        {/* Server status */}
        {!ollamaStatus.installed ? (
          <div className="flex items-center gap-2 text-xs font-mono">
            <span className="w-1.5 h-1.5 rounded-full bg-text-4 flex-shrink-0" />
            <span className="text-text-3">Ollama not installed</span>
            <div className="flex-1" />
            <a href="https://ollama.ai/download" target="_blank" rel="noopener noreferrer"
              className="text-2xs text-text-3 hover:text-text-1 flex items-center gap-1 transition-colors">
              Install <ExternalLink size={9} />
            </a>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-xs font-mono flex-wrap">
            <span className="relative flex-shrink-0 w-1.5 h-1.5">
              <span className={cn('absolute inset-0 rounded-full', ollamaStatus.serverRunning ? 'bg-success' : 'bg-text-4')} />
              {ollamaStatus.serverRunning && <span className="absolute inset-[-2px] rounded-full bg-success opacity-20 animate-pulse" />}
            </span>
            <span className="text-text-1 font-semibold">Ollama</span>
            <span className="text-text-4">{ollamaStatus.serverRunning ? ':11434' : 'stopped'}</span>

            {ollamaStatus.serverRunning && hw && (
              <span className="text-text-4 ml-1">
                {hw.totalRamGb} GB · {hw.cores} cores
                {hw.gpu ? ` · ${hw.gpu.name}${hw.gpu.vram ? ` ${hw.gpu.vram} GB` : ''}` : ''}
                {hw.isAppleSilicon ? ' · unified' : ''}
              </span>
            )}

            <div className="flex-1" />
            {ollamaStatus.serverRunning ? (
              <div className="flex items-center gap-2">
                <button onClick={handleServerRestart} disabled={!!serverAction}
                  className="text-2xs text-text-4 hover:text-text-2 transition-colors cursor-pointer disabled:opacity-40 flex items-center gap-1">
                  <RefreshCw size={9} className={serverAction === 'restarting' ? 'animate-spin' : ''} />
                  {serverAction === 'restarting' ? 'Restarting' : 'Restart'}
                </button>
                <button onClick={handleServerStop} disabled={!!serverAction}
                  className="text-2xs text-text-4 hover:text-text-2 transition-colors cursor-pointer disabled:opacity-40 flex items-center gap-1">
                  <Square size={9} />
                  {serverAction === 'stopping' ? 'Stopping' : 'Stop'}
                </button>
              </div>
            ) : (
              <button onClick={handleServerStart} disabled={!!serverAction}
                className="text-2xs text-text-2 hover:text-text-1 transition-colors cursor-pointer disabled:opacity-40 flex items-center gap-1">
                {serverAction === 'starting' ? <Loader2 size={9} className="animate-spin" /> : <Play size={9} />}
                {serverAction === 'starting' ? 'Starting' : 'Start'}
              </button>
            )}
          </div>
        )}

        {/* Search + Filters */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1 min-w-[160px]">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-4" />
            <input
              ref={searchInputRef}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="Search models or HuggingFace..."
              className="w-full h-7 pl-8 pr-3 text-xs font-mono rounded bg-surface-1 border border-border text-text-1 placeholder:text-text-4 focus:outline-none focus:border-text-3"
            />
          </div>
          <div className="flex items-center gap-0.5 flex-shrink-0">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={cn(
                  'px-2 py-1 rounded text-2xs font-mono transition-colors cursor-pointer',
                  filter === f.id ? 'text-text-1 bg-surface-3' : 'text-text-4 hover:text-text-2',
                )}
              >
                {f.label}
                {filterCounts[f.id] > 0 && (
                  <span className="ml-1 text-text-4 tabular-nums">{filterCounts[f.id]}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">

        {/* Empty state */}
        {hasNoModels && !searchQuery.trim() && filter === 'all' ? (
          <div className="flex flex-col items-center justify-center py-16 px-8">
            <Box size={28} className="text-text-4 mb-3" />
            <div className="text-sm font-mono font-semibold text-text-1 mb-1">No local models</div>
            <div className="text-xs font-mono text-text-3 text-center max-w-sm mb-5">
              Pull from Ollama or search HuggingFace for GGUF models to run locally.
            </div>
            <div className="flex gap-2">
              <Button variant="primary" onClick={() => {
                setDiscoveryOpen(true);
                setDiscoveryTab('recommended');
                discoveryRef.current?.scrollIntoView({ behavior: 'smooth' });
              }} className="gap-1.5 text-xs">
                <Download size={12} /> Pull from Ollama
              </Button>
              <Button variant="secondary" onClick={() => searchInputRef.current?.focus()} className="gap-1.5 text-xs">
                <Search size={12} /> Search HuggingFace
              </Button>
            </div>
          </div>
        ) : filteredModels.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-sm font-sans text-text-4">No models match this filter</div>
          </div>
        ) : (
          /* Model grid */
          <div className="px-5 py-4 grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
            {filteredModels.map((model) => (
              <ModelCard
                key={model.id}
                model={model}
                runtimes={labRuntimes}
                onStop={handleUnloadModel}
                onSpawn={spawnFromModel}
                onDelete={handleDeleteUnified}
                onStartRuntime={handleStartRuntime}
                onCreateRuntime={handleCreateRuntime}
                isStarting={startingModel === model.id}
                isUnloading={unloadingModel === model.id || unloadingModel === model.name}
                isDeleting={deletingModel === model.id || deletingGguf === model.id}
              />
            ))}
          </div>
        )}

        {/* Discovery section */}
        <div ref={discoveryRef} className="border-t border-border mt-2">
          <button
            onClick={() => setDiscoveryOpen(!discoveryOpen)}
            className="flex items-center gap-2 px-5 py-2.5 cursor-pointer group w-full text-left"
          >
            {discoveryOpen
              ? <ChevronDown size={12} className="text-text-4 group-hover:text-text-2 transition-colors" />
              : <ChevronRight size={12} className="text-text-4 group-hover:text-text-2 transition-colors" />}
            <span className="text-2xs font-mono text-text-3 uppercase tracking-wider">Discover Models</span>
          </button>

          {discoveryOpen && (
            <div className="px-5 pb-4 space-y-3">
              <div className="flex gap-0.5">
                {[
                  { id: 'recommended', label: `Recommended (${recommended.length})` },
                  { id: 'search', label: `Search (${searchResults.length})` },
                ].map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setDiscoveryTab(t.id)}
                    className={cn(
                      'px-2 py-1 rounded text-2xs font-mono transition-colors cursor-pointer',
                      discoveryTab === t.id ? 'text-text-1 bg-surface-3' : 'text-text-4 hover:text-text-2',
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {/* Recommended */}
              {discoveryTab === 'recommended' && (
                <>
                  {recommended.length === 0 ? (
                    <div className="py-6 text-center">
                      <div className="text-xs font-mono text-text-3">Detecting hardware...</div>
                      <div className="text-2xs font-mono text-text-4 mt-1">Make sure Ollama is installed.</div>
                    </div>
                  ) : (
                    <>
                      <div className="text-2xs font-mono text-text-4">
                        For your system ({hw?.totalRamGb || '?'} GB RAM)
                      </div>
                      <div className="space-y-0">
                        {recommended.map((m) => {
                          const baseId = m.id.split(':')[0];
                          const isInstalled = installedModels.some((im) =>
                            im.id === m.id || im.id.startsWith(baseId + ':') || im.id === baseId
                          );
                          const isPulling = !!pullProgress[m.id];

                          return (
                            <div key={m.id} className="flex items-center gap-3 py-1.5 border-b border-border last:border-0">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-mono font-semibold text-text-1 truncate">{m.name}</span>
                                  {isInstalled && <Check size={10} className="text-success flex-shrink-0" />}
                                </div>
                                <div className="text-2xs font-mono text-text-4 truncate">{m.description}</div>
                              </div>
                              <span className="text-2xs font-mono text-text-3 tabular-nums flex-shrink-0">{m.sizeGb} GB</span>
                              <span className="text-2xs font-mono text-text-4 tabular-nums flex-shrink-0">{m.ramGb} GB RAM</span>
                              {isInstalled ? (
                                <span className="text-2xs font-mono text-text-4 w-12 text-right">installed</span>
                              ) : (
                                <button
                                  onClick={() => pullModel(m.id)}
                                  disabled={isPulling}
                                  className="text-2xs font-mono text-text-2 hover:text-text-1 transition-colors cursor-pointer disabled:opacity-40 flex items-center gap-1 w-12 justify-end"
                                >
                                  {isPulling ? <Loader2 size={10} className="animate-spin" /> : <Download size={10} />}
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
                    <div className="py-6 text-center">
                      <Loader2 size={16} className="mx-auto text-text-3 animate-spin mb-2" />
                      <div className="text-xs font-mono text-text-3">Searching HuggingFace...</div>
                    </div>
                  ) : searchResults.length === 0 ? (
                    <div className="py-6 text-center">
                      <div className="text-xs font-mono text-text-3">Search for GGUF models</div>
                      <div className="text-2xs font-mono text-text-4 mt-1">
                        Try "qwen coder", "deepseek", "codestral", "llama"
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-0">
                      {searchResults.map((r) => (
                        <div key={r.id}>
                          <button
                            onClick={() => setExpandedResult(expandedResult === r.id ? null : r.id)}
                            className="w-full text-left flex items-center gap-2 py-1.5 border-b border-border hover:bg-surface-2/50 transition-colors cursor-pointer"
                          >
                            <span className="text-xs font-mono font-semibold text-text-1 truncate flex-1">{r.name}</span>
                            <span className="text-2xs font-mono text-text-4">{r.author}</span>
                            <span className="text-2xs font-mono text-text-4 tabular-nums">{r.downloads?.toLocaleString()}</span>
                            {expandedResult === r.id
                              ? <ChevronDown size={10} className="text-text-4" />
                              : <ChevronRight size={10} className="text-text-4" />}
                          </button>
                          {expandedResult === r.id && (
                            <FilePicker repoId={r.id} systemRamGb={hw?.totalRamGb} />
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
  );
}
