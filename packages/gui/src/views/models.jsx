// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useEffect, useCallback } from 'react';
import { ScrollArea } from '../components/ui/scroll-area';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { api } from '../lib/api';
import { useToast } from '../lib/hooks/use-toast';
import { useGrooveStore } from '../stores/groove';
import {
  Search, Download, Trash2, HardDrive, Cpu, MemoryStick,
  Check, X, Loader2, ExternalLink, Box, ChevronDown, ChevronRight,
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

// ---- Hardware Info ----
function HardwareBar({ hardware }) {
  if (!hardware) return null;
  return (
    <div className="flex items-center gap-4 px-4 py-2.5 bg-surface-1 border border-border-subtle rounded-lg text-xs font-sans text-text-2">
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
      {hardware.recommended?.code && (
        <div className="ml-auto text-accent">
          Recommended: {hardware.recommended.code}
        </div>
      )}
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

// ---- Installed Model Card ----
function InstalledModel({ model, onDelete }) {
  const [deleting, setDeleting] = useState(false);
  const tierColors = { light: 'text-green-400', medium: 'text-blue-400', heavy: 'text-orange-400' };

  return (
    <div className="flex items-center gap-3 px-4 py-3 bg-surface-1 border border-border-subtle rounded-lg">
      <Box size={18} className="text-accent flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-mono font-bold text-text-0 truncate">{model.id}</span>
          {model.quantization && <Badge variant="subtle" className="text-2xs">{model.quantization}</Badge>}
          {model.parameters && <Badge variant="subtle" className="text-2xs">{model.parameters}</Badge>}
          <span className={cn('text-2xs font-medium capitalize', tierColors[model.tier] || 'text-text-3')}>{model.tier}</span>
        </div>
        <div className="text-2xs text-text-3 font-sans mt-0.5">
          {formatBytes(model.sizeBytes)} &middot; ctx {(model.contextWindow || 0).toLocaleString()} &middot; {model.category}
          {model.repoId && <span className="text-text-4"> &middot; {model.repoId}</span>}
        </div>
      </div>
      <button
        onClick={async () => { setDeleting(true); await onDelete(model.id); setDeleting(false); }}
        disabled={deleting}
        className="p-1.5 rounded-md text-text-4 hover:text-red-400 hover:bg-red-400/10 transition-colors"
      >
        {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
      </button>
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

// ---- Recommended Model Card ----
function RecommendedModel({ model, systemRamGb, onPull, pulling, isInstalled }) {
  const tierColors = { light: 'text-green-400', medium: 'text-blue-400', heavy: 'text-orange-400' };
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
          <span className={cn('text-2xs font-semibold capitalize', tierColors[model.tier])}>{model.tier}</span>
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

// ---- Main View ----
export default function ModelsView() {
  const [tab, setTab] = useState('recommended'); // recommended | installed | search
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [installed, setInstalled] = useState([]);
  const [recommended, setRecommended] = useState([]);
  const [downloads, setDownloads] = useState([]);
  const [hardware, setHardware] = useState(null);
  const [expandedResult, setExpandedResult] = useState(null);
  const [pulling, setPulling] = useState(null);
  const [ollamaModels, setOllamaModels] = useState([]);
  const toast = useToast();

  // Fetch installed models
  const fetchInstalled = useCallback(() => {
    api.get('/models/installed').then((data) => {
      setInstalled(data.models || []);
    }).catch(() => {});
  }, []);

  const fetchOllamaModels = useCallback(() => {
    api.get('/providers/ollama/models').then((data) => {
      setOllamaModels((data.installed || []).map((m) => m.id));
    }).catch(() => {});
  }, []);

  // Fetch hardware info + recommended models + Ollama installed
  useEffect(() => {
    api.get('/providers/ollama/hardware').then(setHardware).catch(() => {});
    api.get('/models/recommended').then((data) => {
      setRecommended(data.models || []);
      if (!hardware && data.hardware) setHardware(data.hardware);
    }).catch(() => {});
    fetchInstalled();
    fetchOllamaModels();
  }, [fetchInstalled, fetchOllamaModels]);

  async function handlePull(modelId) {
    setPulling(modelId);
    try {
      await api.post('/providers/ollama/pull', { model: modelId });
      toast.success(`${modelId} ready to use`);
      // Refresh all model lists so UI reflects the new install
      fetchInstalled();
      fetchOllamaModels();
      // Also optimistically mark it installed immediately
      setOllamaModels((prev) => [...prev, modelId]);
    } catch (err) {
      toast.error(`Pull failed: ${err.message}`);
    }
    setPulling(null);
  }

  // Listen for download progress via WebSocket
  useEffect(() => {
    const unsub = useGrooveStore.subscribe((state, prev) => {
      // Refresh on model events
    });

    // Poll active downloads
    const poll = setInterval(() => {
      api.get('/models/downloads').then(setDownloads).catch(() => {});
    }, 2000);

    return () => { unsub(); clearInterval(poll); };
  }, []);

  // WebSocket events for download progress
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
          fetchInstalled();
          toast.success(`${msg.data.filename} downloaded`);
        }
        if (msg.type === 'model:download:error') {
          setDownloads((prev) => prev.filter((d) => d.filename !== msg.data.filename));
          toast.error(`Download failed: ${msg.data.error}`);
        }
      } catch {}
    }
    const ws = useGrooveStore.getState()._ws;
    if (ws) ws.addEventListener('message', handleWs);
    return () => { if (ws) ws.removeEventListener('message', handleWs); };
  }, [fetchInstalled, toast]);

  async function handleSearch() {
    if (!searchQuery.trim()) return;
    setSearching(true);
    setTab('search');
    try {
      const results = await api.get(`/models/search?q=${encodeURIComponent(searchQuery.trim())}`);
      setSearchResults(results);
    } catch (err) {
      toast.error(err.message);
    }
    setSearching(false);
  }

  async function handleDelete(modelId) {
    try {
      await api.delete(`/models/${modelId}`);
      setInstalled((prev) => prev.filter((m) => m.id !== modelId));
      toast.success('Model deleted');
    } catch (err) {
      toast.error(err.message);
    }
  }

  return (
    <div className="h-full flex flex-col bg-surface-0">
      {/* Header */}
      <div className="flex-shrink-0 px-5 pt-4 pb-3 border-b border-border space-y-3">
        <div className="flex items-center justify-between">
          <h1 className="text-base font-bold font-sans text-text-0">Local Models</h1>
          <Badge variant="subtle" className="text-2xs">{installed.length} installed</Badge>
        </div>

        <HardwareBar hardware={hardware} />

        {/* Search */}
        <div className="flex gap-2">
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
        <div className="flex gap-1">
          {[
            { id: 'recommended', label: `Recommended (${recommended.length})` },
            { id: 'installed', label: `Installed (${installed.length})` },
            { id: 'search', label: `Search (${searchResults.length})` },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'px-3 py-1 rounded-md text-xs font-sans font-medium transition-colors cursor-pointer',
                tab === t.id ? 'bg-accent/12 text-accent' : 'text-text-3 hover:text-text-1 hover:bg-surface-3',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Active Downloads */}
      {downloads.length > 0 && (
        <div className="px-5 py-3 border-b border-border space-y-2">
          <div className="text-xs font-sans font-semibold text-text-2">Downloading</div>
          {downloads.map((d) => <DownloadProgress key={d.filename} download={d} />)}
        </div>
      )}

      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="px-5 py-4 space-y-2">
          {tab === 'recommended' && (
            <>
              {recommended.length === 0 ? (
                <div className="text-center py-12">
                  <Cpu size={40} className="mx-auto text-text-4 mb-3" />
                  <p className="text-sm text-text-2 font-sans font-medium">Detecting hardware...</p>
                  <p className="text-xs text-text-3 font-sans mt-1">Make sure Ollama is installed so we can check your system.</p>
                </div>
              ) : (
                <>
                  <div className="text-xs text-text-3 font-sans mb-2">
                    Top models for your system ({hardware?.totalRamGb || '?'} GB RAM). Click Pull to download via Ollama.
                  </div>
                  {recommended.map((m) => {
                    // Check if this model (or a variant) is already installed in Ollama
                    const baseId = m.id.split(':')[0];
                    const isInstalled = ollamaModels.some((id) => id === m.id || id.startsWith(baseId + ':') || id === baseId);
                    return (
                      <RecommendedModel
                        key={m.id}
                        model={m}
                        systemRamGb={hardware?.totalRamGb}
                        onPull={handlePull}
                        pulling={pulling}
                        isInstalled={isInstalled}
                      />
                    );
                  })}
                </>
              )}
            </>
          )}

          {tab === 'installed' && (
            <>
              {installed.length === 0 ? (
                <div className="text-center py-12">
                  <Box size={40} className="mx-auto text-text-4 mb-3" />
                  <p className="text-sm text-text-2 font-sans font-medium">No local models yet</p>
                  <p className="text-xs text-text-3 font-sans mt-1">Search HuggingFace to download GGUF models, or pull models via Ollama.</p>
                </div>
              ) : (
                installed.map((m) => <InstalledModel key={m.id} model={m} onDelete={handleDelete} />)
              )}
            </>
          )}

          {tab === 'search' && (
            <>
              {searching ? (
                <div className="text-center py-12">
                  <Loader2 size={24} className="mx-auto text-accent animate-spin mb-3" />
                  <p className="text-sm text-text-3 font-sans">Searching HuggingFace...</p>
                </div>
              ) : searchResults.length === 0 ? (
                <div className="text-center py-12">
                  <Search size={40} className="mx-auto text-text-4 mb-3" />
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
                      <FilePicker repoId={r.id} onDownload={() => fetchInstalled()} systemRamGb={hardware?.totalRamGb} />
                    )}
                  </div>
                ))
              )}
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
