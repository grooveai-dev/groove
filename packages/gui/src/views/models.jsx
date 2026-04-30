// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useEffect, useCallback, useRef } from 'react';
import { ScrollArea } from '../components/ui/scroll-area';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { api } from '../lib/api';
import { useToast } from '../lib/hooks/use-toast';
import { useGrooveStore } from '../stores/groove';
import {
  Search, Download, Trash2, HardDrive, Cpu, MemoryStick,
  Check, Loader2, Box, ChevronDown, ChevronRight,
  RefreshCw, Play, Square, Zap, AlertCircle, Monitor, Rocket,
} from 'lucide-react';
import { cn } from '../lib/cn';

const TIER_COLORS = { light: 'text-green-400', medium: 'text-blue-400', heavy: 'text-orange-400' };

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

// ---- Server Status Bar ----
function ServerStatusBar({ serverRunning, installed, onStart, onStop, onRestart, actionInProgress }) {
  if (!installed) {
    return (
      <div className="flex items-center gap-2 bg-surface-1 border border-border-subtle rounded-lg px-3 py-2">
        <span className="w-[6px] h-[6px] rounded-full bg-text-4 flex-shrink-0" />
        <span className="text-xs font-sans text-text-3 font-medium">Ollama Not Installed</span>
        <div className="flex-1" />
        <a
          href="https://ollama.ai/download"
          target="_blank"
          rel="noopener noreferrer"
          className="text-2xs font-sans text-accent hover:underline"
        >
          Install Ollama
        </a>
      </div>
    );
  }

  if (serverRunning) {
    return (
      <div className="flex items-center gap-2 bg-success/8 border border-success/20 rounded-lg px-3 py-2">
        <span className="relative flex-shrink-0 w-[6px] h-[6px]">
          <span className="absolute inset-0 rounded-full bg-success" />
          <span className="absolute inset-[-2px] rounded-full bg-success opacity-20 animate-pulse" />
        </span>
        <span className="text-xs font-sans text-success font-semibold">Server Running</span>
        <span className="text-2xs font-mono text-text-4">:11434</span>
        <div className="flex-1" />
        <button
          onClick={onRestart}
          disabled={!!actionInProgress}
          className="flex items-center gap-1 text-2xs font-sans text-text-3 hover:text-accent cursor-pointer transition-colors disabled:opacity-40"
        >
          <RefreshCw size={10} className={actionInProgress === 'restarting' ? 'animate-spin' : ''} />
          {actionInProgress === 'restarting' ? 'Restarting...' : 'Restart'}
        </button>
        <button
          onClick={onStop}
          disabled={!!actionInProgress}
          className="flex items-center gap-1 text-2xs font-sans text-text-3 hover:text-danger cursor-pointer transition-colors disabled:opacity-40"
        >
          <Square size={10} />
          {actionInProgress === 'stopping' ? 'Stopping...' : 'Stop'}
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 bg-danger/8 border border-danger/20 rounded-lg px-3 py-2">
      <span className="w-[6px] h-[6px] rounded-full bg-danger flex-shrink-0" />
      <span className="text-xs font-sans text-danger font-semibold">Server Stopped</span>
      <span className="text-2xs font-mono text-text-4">:11434</span>
      <div className="flex-1" />
      <Button
        variant="primary"
        size="sm"
        onClick={onStart}
        disabled={!!actionInProgress}
        className="h-6 px-2.5 text-2xs gap-1"
      >
        <Play size={10} />
        {actionInProgress === 'starting' ? 'Starting...' : 'Start Server'}
      </Button>
    </div>
  );
}

// ---- Hardware Info ----
function HardwareBar({ hardware }) {
  if (!hardware) return null;
  return (
    <div className="flex items-center gap-4 px-3 py-2 bg-surface-1 border border-border-subtle rounded-lg text-xs font-sans text-text-2">
      <div className="flex items-center gap-1.5">
        <MemoryStick size={14} className="text-text-3" />
        <span>{hardware.totalRamGb} GB RAM</span>
      </div>
      <div className="flex items-center gap-1.5">
        <Cpu size={14} className="text-text-3" />
        <span>{hardware.cores} cores</span>
      </div>
      {hardware.gpu && (
        <div className="flex items-center gap-1.5">
          <HardDrive size={14} className="text-text-3" />
          <span>{hardware.gpu.name}{hardware.gpu.vram ? ` (${hardware.gpu.vram} GB)` : ''}</span>
        </div>
      )}
      {hardware.isAppleSilicon && (
        <Badge variant="accent" className="text-2xs ml-auto">Unified Memory</Badge>
      )}
    </div>
  );
}

// ---- Running Model Card ----
function RunningModelCard({ model, onUnload, onSpawn, unloading }) {
  const sizeGb = model.size ? (model.size / (1024 ** 3)).toFixed(1) : '?';
  const vramGb = model.vram ? (model.vram / (1024 ** 3)).toFixed(1) : sizeGb;

  return (
    <div className="flex items-center gap-3 px-4 py-3 bg-success/5 border border-success/20 rounded-lg">
      <span className="relative flex-shrink-0 w-2 h-2">
        <span className="absolute inset-0 rounded-full bg-success" />
        <span className="absolute inset-[-2px] rounded-full bg-success opacity-20 animate-pulse" />
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-mono font-bold text-text-0 truncate">{model.name}</span>
          <Badge variant="success" className="text-2xs">Running</Badge>
        </div>
        <div className="text-2xs text-text-3 font-sans mt-0.5">
          {vramGb} GB VRAM &middot; loaded in memory
        </div>
      </div>
      <button
        onClick={() => onSpawn(model.name)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-2xs font-sans font-medium bg-accent/10 text-accent hover:bg-accent/20 transition-colors cursor-pointer"
      >
        <Rocket size={11} />
        Spawn Agent
      </button>
      <button
        onClick={() => onUnload(model.name)}
        disabled={unloading === model.name}
        className="p-1.5 rounded-md text-text-4 hover:text-warning hover:bg-warning/10 transition-colors cursor-pointer disabled:opacity-40"
        title="Unload from memory"
      >
        {unloading === model.name ? <Loader2 size={14} className="animate-spin" /> : <Square size={14} />}
      </button>
    </div>
  );
}

// ---- Installed Model Card ----
function InstalledModelCard({ model, catalogEntry, isRunning, onStart, onSpawn, onDelete, loading, deleting, serverRunning }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 bg-surface-1 border border-border-subtle rounded-lg">
      <Box size={18} className={cn('flex-shrink-0', isRunning ? 'text-success' : 'text-accent')} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-mono font-bold text-text-0 truncate">{model.id}</span>
          {model.tier && (
            <span className={cn('text-2xs font-semibold capitalize', TIER_COLORS[model.tier] || 'text-text-3')}>
              {model.tier}
            </span>
          )}
          {model.category && model.category !== 'other' && (
            <Badge variant="subtle" className="text-2xs">{model.category}</Badge>
          )}
          {isRunning && <Badge variant="success" className="text-2xs">Running</Badge>}
        </div>
        <div className="text-2xs text-text-3 font-sans mt-0.5">
          {model.size || '—'}
          {catalogEntry?.ramGb && <> &middot; ~{catalogEntry.ramGb} GB RAM needed</>}
          {catalogEntry?.description && <> &middot; {catalogEntry.description}</>}
        </div>
      </div>
      <div className="flex items-center gap-1">
        {!isRunning && serverRunning && (
          <button
            onClick={() => onStart(model.id)}
            disabled={!!loading}
            className="flex items-center gap-1 px-2 py-1.5 rounded-md text-2xs font-sans font-medium text-text-2 hover:text-success hover:bg-success/10 transition-colors cursor-pointer disabled:opacity-40"
            title="Load into memory"
          >
            {loading === model.id ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
            Start
          </button>
        )}
        <button
          onClick={() => onSpawn(model.id)}
          className="flex items-center gap-1 px-2 py-1.5 rounded-md text-2xs font-sans font-medium text-accent hover:bg-accent/10 transition-colors cursor-pointer"
          title="Spawn an agent with this model"
        >
          <Rocket size={11} />
          Spawn
        </button>
        <button
          onClick={() => onDelete(model.id)}
          disabled={deleting === model.id}
          className="p-1.5 rounded-md text-text-4 hover:text-red-400 hover:bg-red-400/10 transition-colors cursor-pointer disabled:opacity-40"
          title="Delete model"
        >
          {deleting === model.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
        </button>
      </div>
    </div>
  );
}

// ---- Download Progress Bar ----
function DownloadProgress({ download }) {
  const pct = Math.round((download.percent || 0) * 100);
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-2xs font-sans text-text-3">
        <span>{download.filename}</span>
        <span>{pct}% {formatSpeed(download.speed)}</span>
      </div>
      <div className="h-1.5 bg-surface-3 rounded-full overflow-hidden">
        <div className="h-full bg-accent rounded-full transition-all" style={{ width: `${pct}%` }} />
      </div>
      <div className="text-2xs text-text-4">
        {formatBytes(download.downloaded)} / {formatBytes(download.totalBytes)}
      </div>
    </div>
  );
}

// ---- Pull Progress (Ollama) ----
function PullProgress({ modelId, progress }) {
  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-accent/5 border border-accent/20 rounded-lg">
      <Loader2 size={14} className="animate-spin text-accent flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <span className="text-xs font-mono text-text-0">{modelId}</span>
        <div className="text-2xs text-text-3 font-sans truncate">{progress.progress || 'Pulling...'}</div>
      </div>
    </div>
  );
}

// ---- Recommended Model Card ----
function RecommendedModel({ model, systemRamGb, onPull, pulling, isInstalled }) {
  const categoryIcons = { code: '{}', general: 'AI' };
  const headroom = systemRamGb ? Math.round((1 - model.ramGb / systemRamGb) * 100) : null;

  return (
    <div className={cn(
      'flex items-center gap-3 px-4 py-3 border rounded-lg transition-colors',
      isInstalled ? 'bg-success/5 border-success/20' : 'bg-surface-1 border-border-subtle hover:border-accent/20',
    )}>
      <div className="w-9 h-9 rounded-lg bg-surface-3 flex items-center justify-center text-xs font-mono text-text-2 flex-shrink-0">
        {categoryIcons[model.category] || 'AI'}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-mono font-bold text-text-0 truncate">{model.name}</span>
          <span className={cn('text-2xs font-semibold capitalize', TIER_COLORS[model.tier])}>{model.tier}</span>
          {isInstalled && <Badge variant="success" className="text-2xs gap-1"><Check size={8} /> Installed</Badge>}
        </div>
        <div className="text-2xs text-text-3 font-sans mt-0.5">{model.description}</div>
        <div className="flex items-center gap-3 mt-1 text-2xs font-sans">
          <span className="text-text-2">{model.sizeGb} GB download</span>
          <span className="text-green-400 font-medium">{model.ramGb} GB RAM</span>
          {headroom !== null && <span className="text-text-4">{headroom}% headroom</span>}
        </div>
      </div>
      {isInstalled ? (
        <span className="text-xs text-success font-sans font-medium px-3 py-1.5">Ready</span>
      ) : (
        <button
          onClick={() => onPull(model.id)}
          disabled={pulling === model.id}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-sans font-medium bg-accent/10 text-accent hover:bg-accent/20 transition-colors cursor-pointer disabled:opacity-40"
        >
          {pulling === model.id ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
          Pull
        </button>
      )}
    </div>
  );
}

// ---- Search Result Card (HuggingFace) ----
function SearchResult({ result, onExpand, expanded }) {
  return (
    <button
      onClick={() => onExpand(expanded ? null : result.id)}
      className="w-full text-left px-4 py-3 bg-surface-1 border border-border-subtle rounded-lg hover:border-accent/30 transition-colors cursor-pointer"
    >
      <div className="flex items-center gap-2">
        <span className="text-sm font-mono font-bold text-text-0 truncate flex-1">{result.name}</span>
        <span className="text-2xs text-text-4 font-sans">{result.author}</span>
        {expanded ? <ChevronDown size={14} className="text-text-3" /> : <ChevronRight size={14} className="text-text-3" />}
      </div>
      <div className="text-2xs text-text-3 font-sans mt-0.5 flex gap-3">
        <span>{result.downloads?.toLocaleString()} downloads</span>
        <span>{result.likes} likes</span>
      </div>
    </button>
  );
}

// ---- File Picker (quantization variants) ----
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
            {f.quantization && <Badge variant="subtle" className="text-2xs">{f.quantization}</Badge>}
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
                'p-1 rounded transition-colors',
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

// ---- Section Header ----
function SectionHeader({ title, count, icon: Icon }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      {Icon && <Icon size={14} className="text-text-3" />}
      <span className="text-xs font-semibold font-sans text-text-2 uppercase tracking-wider">{title}</span>
      {count !== undefined && (
        <Badge variant="subtle" className="text-2xs">{count}</Badge>
      )}
    </div>
  );
}

// ---- Main View ----
export default function ModelsView() {
  const [discoveryTab, setDiscoveryTab] = useState('recommended');
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
  const toast = useToast();

  const ollamaStatus = useGrooveStore((s) => s.ollamaStatus);
  const installedModels = useGrooveStore((s) => s.ollamaInstalledModels);
  const runningModels = useGrooveStore((s) => s.ollamaRunningModels);
  const catalog = useGrooveStore((s) => s.ollamaCatalog);
  const pullProgress = useGrooveStore((s) => s.ollamaPullProgress);
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

  // Fetch status on mount and poll every 10s
  useEffect(() => {
    fetchOllamaStatus();
    pollingRef.current = setInterval(fetchOllamaStatus, 10000);
    return () => clearInterval(pollingRef.current);
  }, [fetchOllamaStatus]);

  // Fetch recommended models
  useEffect(() => {
    api.get('/models/recommended').then((data) => {
      setRecommended(data.models || []);
    }).catch(() => {});
  }, []);

  // Poll active GGUF downloads
  useEffect(() => {
    const poll = setInterval(() => {
      api.get('/models/downloads').then(setDownloads).catch(() => {});
    }, 2000);
    return () => clearInterval(poll);
  }, []);

  // WebSocket events for GGUF download progress
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

  async function handlePull(modelId) {
    pullModel(modelId);
  }

  async function handleSearch() {
    if (!searchQuery.trim()) return;
    setSearching(true);
    setDiscoveryTab('search');
    try {
      const results = await api.get(`/models/search?q=${encodeURIComponent(searchQuery.trim())}`);
      setSearchResults(results);
    } catch (err) {
      toast.error(err.message);
    }
    setSearching(false);
  }

  const installedIds = new Set(installedModels.map((m) => m.id));
  const runningIds = new Set(runningModels.map((m) => m.name));
  const catalogByBase = {};
  for (const c of catalog) {
    const base = c.id.split(':')[0];
    catalogByBase[base] = c;
    catalogByBase[c.id] = c;
  }

  function getCatalogEntry(modelId) {
    if (catalogByBase[modelId]) return catalogByBase[modelId];
    const base = modelId.split(':')[0];
    return catalogByBase[base] || null;
  }

  return (
    <div className="h-full flex flex-col bg-surface-0">
      {/* Header */}
      <div className="flex-shrink-0 px-5 pt-4 pb-3 border-b border-border space-y-3">
        <div className="flex items-center justify-between">
          <h1 className="text-base font-bold font-sans text-text-0">Local Models</h1>
          <div className="flex items-center gap-2">
            <Badge variant="subtle" className="text-2xs">{installedModels.length} installed</Badge>
            {runningModels.length > 0 && (
              <Badge variant="success" className="text-2xs">{runningModels.length} running</Badge>
            )}
          </div>
        </div>

        {/* Server Status Bar */}
        <ServerStatusBar
          serverRunning={ollamaStatus.serverRunning}
          installed={ollamaStatus.installed}
          onStart={handleServerStart}
          onStop={handleServerStop}
          onRestart={handleServerRestart}
          actionInProgress={serverAction}
        />

        {/* Hardware Bar */}
        <HardwareBar hardware={ollamaStatus.hardware} />
      </div>

      {/* Active Downloads (GGUF) */}
      {downloads.length > 0 && (
        <div className="px-5 py-3 border-b border-border space-y-2">
          <div className="text-xs font-sans font-semibold text-text-2">Downloading</div>
          {downloads.map((d) => <DownloadProgress key={d.filename} download={d} />)}
        </div>
      )}

      {/* Ollama Pull Progress */}
      {Object.keys(pullProgress).length > 0 && (
        <div className="px-5 py-3 border-b border-border space-y-2">
          <div className="text-xs font-sans font-semibold text-text-2">Pulling Models</div>
          {Object.entries(pullProgress).map(([id, prog]) => (
            <PullProgress key={id} modelId={id} progress={prog} />
          ))}
        </div>
      )}

      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="px-5 py-4 space-y-6">
          {/* Running Models Section */}
          <div>
            <SectionHeader title="Running Models" count={runningModels.length} icon={Zap} />
            {runningModels.length === 0 ? (
              <div className="px-4 py-4 bg-surface-1 border border-border-subtle rounded-lg text-center">
                <p className="text-xs text-text-3 font-sans">
                  {ollamaStatus.serverRunning
                    ? 'No models loaded — start one below'
                    : 'Start the server to load models'}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {runningModels.map((m) => (
                  <RunningModelCard
                    key={m.name}
                    model={m}
                    onUnload={handleUnloadModel}
                    onSpawn={spawnFromModel}
                    unloading={unloadingModel}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Installed Models Section */}
          <div>
            <SectionHeader title="Installed Models" count={installedModels.length} icon={HardDrive} />
            {installedModels.length === 0 ? (
              <div className="px-4 py-6 bg-surface-1 border border-border-subtle rounded-lg text-center">
                <Box size={32} className="mx-auto text-text-4 mb-2" />
                <p className="text-sm text-text-2 font-sans font-medium">No models installed</p>
                <p className="text-xs text-text-3 font-sans mt-1">
                  Pull a model from the Recommended section below, or search HuggingFace.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {installedModels.map((m) => (
                  <InstalledModelCard
                    key={m.id}
                    model={m}
                    catalogEntry={getCatalogEntry(m.id)}
                    isRunning={runningIds.has(m.id)}
                    onStart={handleLoadModel}
                    onSpawn={spawnFromModel}
                    onDelete={handleDeleteModel}
                    loading={loadingModel}
                    deleting={deletingModel}
                    serverRunning={ollamaStatus.serverRunning}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Divider */}
          <div className="border-t border-border-subtle" />

          {/* Discovery Section */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold font-sans text-text-2 uppercase tracking-wider">Discover Models</span>
            </div>

            {/* Search */}
            <div className="flex gap-2 mb-3">
              <div className="relative flex-1">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-4" />
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  placeholder="Search HuggingFace for GGUF models..."
                  className="w-full h-8 pl-9 pr-3 text-sm rounded-md bg-surface-1 border border-border text-text-0 font-sans placeholder:text-text-4 focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>
              <Button onClick={handleSearch} disabled={searching} size="sm" variant="accent">
                {searching ? <Loader2 size={14} className="animate-spin" /> : 'Search'}
              </Button>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 mb-3">
              {[
                { id: 'recommended', label: `Recommended (${recommended.length})` },
                { id: 'search', label: `Search (${searchResults.length})` },
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

            {/* Tab content */}
            <div className="space-y-2">
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
                      <div className="text-xs text-text-3 font-sans mb-2">
                        Top models for your system ({ollamaStatus.hardware?.totalRamGb || '?'} GB RAM). Click Pull to download via Ollama.
                      </div>
                      {recommended.map((m) => {
                        const baseId = m.id.split(':')[0];
                        const isInstalled = installedModels.some((im) =>
                          im.id === m.id || im.id.startsWith(baseId + ':') || im.id === baseId
                        );
                        return (
                          <RecommendedModel
                            key={m.id}
                            model={m}
                            systemRamGb={ollamaStatus.hardware?.totalRamGb}
                            onPull={handlePull}
                            pulling={pullProgress[m.id] ? m.id : null}
                            isInstalled={isInstalled}
                          />
                        );
                      })}
                    </>
                  )}
                </>
              )}

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
                      <p className="text-xs text-text-3 font-sans mt-1">Try "qwen coder", "deepseek", "codestral", "llama"</p>
                    </div>
                  ) : (
                    searchResults.map((r) => (
                      <div key={r.id} className="space-y-1">
                        <SearchResult
                          result={r}
                          expanded={expandedResult === r.id}
                          onExpand={setExpandedResult}
                        />
                        {expandedResult === r.id && (
                          <FilePicker repoId={r.id} systemRamGb={ollamaStatus.hardware?.totalRamGb} />
                        )}
                      </div>
                    ))
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
