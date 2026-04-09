// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useEffect } from 'react';
import {
  Download, Check, Cpu, HardDrive, RefreshCw, Copy,
  Trash2, ChevronDown, Star, Zap, AlertCircle, Monitor,
} from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { cn } from '../../lib/cn';
import { api } from '../../lib/api';
import { useGrooveStore } from '../../stores/groove';

const CATEGORY_LABELS = { code: 'Code', general: 'General' };
const TIER_COLORS = { light: 'text-success', medium: 'text-accent', heavy: 'text-warning' };

function formatSize(gb) {
  return gb < 1 ? `${Math.round(gb * 1024)} MB` : `${gb} GB`;
}

/* ── Hardware Info Bar ──────────────────────────────────────── */

function HardwareBar({ hardware }) {
  if (!hardware) return null;
  const { totalRamGb, gpu, isAppleSilicon } = hardware;
  return (
    <div className="flex items-center gap-3 bg-surface-0 rounded-lg border border-border-subtle px-3 py-2.5">
      <Monitor size={14} className="text-text-3 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-xs font-sans">
          <span className="text-text-0 font-semibold">{totalRamGb} GB RAM</span>
          {gpu && (
            <>
              <span className="text-text-4">·</span>
              <span className="text-text-2">{gpu.name}</span>
            </>
          )}
          {isAppleSilicon && (
            <Badge variant="accent" className="text-2xs">Unified Memory</Badge>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Install Section (not installed) ───────────────────────── */

function InstallSection({ onRecheck }) {
  const [data, setData] = useState(null);
  const [checking, setChecking] = useState(false);
  const [copied, setCopied] = useState(false);
  const addToast = useGrooveStore((s) => s.addToast);

  useEffect(() => {
    api.post('/providers/ollama/check').then(setData).catch(() => {});
  }, []);

  async function handleRecheck() {
    setChecking(true);
    try {
      const result = await api.post('/providers/ollama/check');
      setData(result);
      if (result.installed) {
        addToast('success', 'Ollama detected!');
        onRecheck();
      } else {
        addToast('info', 'Ollama not found — install and try again');
      }
    } catch {}
    setChecking(false);
  }

  function handleCopy(text) {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (!data) return <div className="py-4 text-center text-xs text-text-4 font-sans">Loading...</div>;

  const { hardware, install, requirements } = data;
  const canRun = hardware.totalRamGb >= requirements.minRAM;
  const recommended = hardware.recommended;

  return (
    <div className="space-y-3 p-3">
      <HardwareBar hardware={hardware} />

      {canRun ? (
        <div className="flex items-start gap-2 bg-success/8 border border-success/20 rounded-lg px-3 py-2.5">
          <Check size={14} className="text-success flex-shrink-0 mt-0.5" />
          <div className="text-xs font-sans">
            <span className="text-success font-semibold">Your system is ready.</span>
            <span className="text-text-2 ml-1">
              {recommended.code
                ? `Recommended: ${recommended.code}`
                : `${hardware.totalRamGb} GB RAM available`}
            </span>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-2 bg-warning/8 border border-warning/20 rounded-lg px-3 py-2.5">
          <AlertCircle size={14} className="text-warning flex-shrink-0 mt-0.5" />
          <div className="text-xs font-sans text-text-2">
            <span className="text-warning font-semibold">{hardware.totalRamGb} GB RAM detected.</span>
            {' '}Minimum {requirements.minRAM} GB needed. Smallest models may still work.
          </div>
        </div>
      )}

      {/* Install command */}
      <div className="space-y-1.5">
        <p className="text-xs font-semibold text-text-1 font-sans">Install Ollama</p>
        <div className="flex items-center gap-2">
          <code className="flex-1 bg-surface-0 border border-border-subtle rounded-md px-3 py-2 text-xs font-mono text-text-1 truncate">
            {install.command}
          </code>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => handleCopy(install.command)}
            className="h-8 px-2.5 gap-1 flex-shrink-0"
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
        {install.alt && (
          <p className="text-2xs text-text-4 font-sans">{install.alt}</p>
        )}
      </div>

      <Button variant="secondary" size="md" onClick={handleRecheck} disabled={checking} className="w-full gap-1.5">
        <RefreshCw size={12} className={checking ? 'animate-spin' : ''} />
        {checking ? 'Checking...' : 'I installed it — check again'}
      </Button>
    </div>
  );
}

/* ── Model Row ─────────────────────────────────────────────── */

function ModelRow({ model, isInstalled, isRecommended, canRun, onPull, onDelete, pulling }) {
  const isPulling = pulling === model.id;

  return (
    <div className={cn(
      'flex items-center gap-2 px-3 py-2 border-t border-border-subtle transition-colors',
      !canRun && 'opacity-40',
    )}>
      {isInstalled ? (
        <Check size={12} className="text-success flex-shrink-0" />
      ) : (
        <div className="w-3" />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-mono text-text-1 truncate">{model.name}</span>
          {isRecommended && <Star size={10} className="text-warning flex-shrink-0" />}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className={cn('text-2xs font-semibold font-sans', TIER_COLORS[model.tier])}>
            {model.tier}
          </span>
          <span className="text-2xs text-text-4 font-sans">{formatSize(model.sizeGb)}</span>
          <span className="text-2xs text-text-4 font-sans">· {model.ramGb} GB RAM</span>
        </div>
      </div>
      {isInstalled ? (
        <button
          onClick={() => onDelete(model.id)}
          className="p-1.5 text-text-4 hover:text-danger rounded transition-colors cursor-pointer"
          title="Remove model"
        >
          <Trash2 size={12} />
        </button>
      ) : canRun ? (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onPull(model.id)}
          disabled={!!pulling}
          className="h-7 px-2 text-2xs gap-1"
        >
          {isPulling ? (
            <><RefreshCw size={10} className="animate-spin" /> Pulling...</>
          ) : (
            <><Download size={10} /> Pull</>
          )}
        </Button>
      ) : (
        <span className="text-2xs text-text-4 font-sans">Needs {model.ramGb} GB</span>
      )}
    </div>
  );
}

/* ── Model Browser (installed) ─────────────────────────────── */

function ModelBrowser({ onModelChange }) {
  const [data, setData] = useState(null);
  const [pulling, setPulling] = useState(null);
  const [category, setCategory] = useState('code');
  const [showAll, setShowAll] = useState(false);
  const addToast = useGrooveStore((s) => s.addToast);

  function load() {
    api.get('/providers/ollama/models').then(setData).catch(() => {});
  }

  useEffect(() => { load(); }, []);

  async function handlePull(modelId) {
    setPulling(modelId);
    try {
      await api.post('/providers/ollama/pull', { model: modelId });
      addToast('success', `Pulled ${modelId}`);
      load();
      if (onModelChange) onModelChange();
    } catch (err) {
      addToast('error', `Pull failed: ${err.message}`);
    }
    setPulling(null);
  }

  async function handleDelete(modelId) {
    try {
      await api.delete(`/providers/ollama/models/${encodeURIComponent(modelId)}`);
      addToast('info', `Removed ${modelId}`);
      load();
      if (onModelChange) onModelChange();
    } catch (err) {
      addToast('error', `Delete failed: ${err.message}`);
    }
  }

  if (!data) return <div className="py-4 text-center text-xs text-text-4 font-sans">Loading...</div>;

  const { installed, catalog, hardware } = data;
  const installedIds = new Set(installed.map((m) => m.id));
  const maxRam = hardware.totalRamGb;
  const recommended = [hardware.recommended?.code, hardware.recommended?.general].filter(Boolean);

  const filtered = catalog.filter((m) => m.category === category);
  const visible = showAll ? filtered : filtered.filter((m) => m.ramGb <= maxRam);

  return (
    <div className="space-y-2 p-3">
      <HardwareBar hardware={hardware} />

      {/* Installed count */}
      {installed.length > 0 && (
        <div className="flex items-center gap-1.5 text-xs font-sans text-text-2">
          <HardDrive size={12} className="text-text-3" />
          <span className="font-semibold">{installed.length}</span> model{installed.length !== 1 ? 's' : ''} installed
        </div>
      )}

      {/* Category tabs */}
      <div className="flex bg-surface-0 rounded-lg p-0.5 border border-border-subtle">
        {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setCategory(key)}
            className={cn(
              'flex-1 px-3 py-1.5 text-2xs font-semibold font-sans rounded-md transition-all cursor-pointer',
              category === key
                ? 'bg-accent/15 text-accent shadow-sm'
                : 'text-text-3 hover:text-text-1',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Model list */}
      <div className="rounded-lg border border-border-subtle bg-surface-0 overflow-hidden">
        {visible.map((model) => (
          <ModelRow
            key={model.id}
            model={model}
            isInstalled={installedIds.has(model.id)}
            isRecommended={recommended.includes(model.id)}
            canRun={model.ramGb <= maxRam}
            onPull={handlePull}
            onDelete={handleDelete}
            pulling={pulling}
          />
        ))}
        {visible.length === 0 && (
          <div className="px-3 py-4 text-center text-xs text-text-4 font-sans">
            No {category} models available for your hardware
          </div>
        )}
      </div>

      {/* Show models beyond RAM */}
      {!showAll && filtered.length > visible.length && (
        <button
          onClick={() => setShowAll(true)}
          className="flex items-center gap-1 text-2xs text-text-3 hover:text-accent font-sans cursor-pointer transition-colors"
        >
          <ChevronDown size={10} />
          Show {filtered.length - visible.length} more (exceed your RAM)
        </button>
      )}
    </div>
  );
}

/* ── Main Export ────────────────────────────────────────────── */

export function OllamaSetup({ isInstalled: initialInstalled, onModelChange }) {
  const [installed, setInstalled] = useState(initialInstalled);

  if (!installed) {
    return <InstallSection onRecheck={() => setInstalled(true)} />;
  }

  return <ModelBrowser onModelChange={onModelChange} />;
}
