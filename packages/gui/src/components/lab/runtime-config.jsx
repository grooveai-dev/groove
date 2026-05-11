// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useEffect } from 'react';
import { useGrooveStore } from '../../stores/groove';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Input } from '../ui/input';
import { Dialog, DialogContent } from '../ui/dialog';
import { Select, SelectTrigger, SelectContent, SelectItem } from '../ui/select';
import { Tooltip } from '../ui/tooltip';
import { ScrollArea } from '../ui/scroll-area';
import { Plus, Trash2, Loader2, WifiOff, RotateCcw, HardDrive, Play, CheckCircle, AlertTriangle, ChevronRight, Wrench } from 'lucide-react';
import { cn } from '../../lib/cn';

const IS_APPLE = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '');

const RUNTIME_TYPES = [
  { value: 'ollama', label: 'Ollama' },
  { value: 'vllm', label: 'vLLM' },
  { value: 'llama-cpp', label: 'llama.cpp' },
  { value: 'mlx', label: 'MLX', suffix: 'Apple Silicon', appleOnly: true },
  { value: 'tgi', label: 'TGI' },
  { value: 'openai-compatible', label: 'OpenAI Compatible' },
];

const DEFAULT_ENDPOINTS = {
  ollama: 'http://localhost:11434',
  vllm: 'http://localhost:8000',
  'llama-cpp': 'http://localhost:8080',
  mlx: 'http://localhost:8080',
  tgi: 'http://localhost:8080',
  'openai-compatible': 'http://localhost:8000',
};

function AddRuntimeDialog({ open, onOpenChange }) {
  const addLabRuntime = useGrooveStore((s) => s.addLabRuntime);
  const [name, setName] = useState('');
  const [type, setType] = useState('ollama');
  const [endpoint, setEndpoint] = useState(DEFAULT_ENDPOINTS.ollama);
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);

  function handleTypeChange(val) {
    setType(val);
    setEndpoint(DEFAULT_ENDPOINTS[val] || '');
  }

  async function handleSave() {
    if (!name.trim() || !endpoint.trim()) return;
    setSaving(true);
    try {
      await addLabRuntime({ name: name.trim(), type, endpoint: endpoint.trim(), apiKey: apiKey.trim() || undefined });
      setName('');
      setType('ollama');
      setEndpoint(DEFAULT_ENDPOINTS.ollama);
      setApiKey('');
      onOpenChange(false);
    } catch { /* toast handled in store */ }
    setSaving(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Add Runtime" description="Configure a new inference runtime">
        <div className="px-5 py-4 space-y-4">
          <Input label="Name" placeholder="My vLLM Server" value={name} onChange={(e) => setName(e.target.value)} />
          <div>
            <label className="block text-xs font-sans text-text-2 mb-1.5">Type</label>
            <Select value={type} onValueChange={handleTypeChange}>
              <SelectTrigger placeholder="Select type" />
              <SelectContent>
                {RUNTIME_TYPES.filter(rt => !rt.appleOnly || IS_APPLE).map((rt) => (
                  <SelectItem key={rt.value} value={rt.value}>{rt.label}{rt.suffix ? ` (${rt.suffix})` : ''}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Input label="Endpoint URL" placeholder="http://localhost:8000" value={endpoint} onChange={(e) => setEndpoint(e.target.value)} mono />
          <Input label="API Key (optional)" placeholder="sk-..." value={apiKey} onChange={(e) => setApiKey(e.target.value)} mono />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button variant="primary" onClick={handleSave} disabled={!name.trim() || !endpoint.trim() || saving}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : 'Add Runtime'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RuntimeItem({ runtime, active, onSelect, onTest, onRemove, testing }) {
  return (
    <button
      onClick={() => onSelect(runtime.id)}
      className={cn(
        'w-full flex items-center gap-2.5 px-2.5 py-2 text-left transition-colors cursor-pointer rounded-sm',
        active ? 'bg-accent/8 text-text-0' : 'text-text-2 hover:bg-surface-3 hover:text-text-0',
      )}
    >
      <span className={cn(
        'w-1.5 h-1.5 rounded-full flex-shrink-0',
        runtime.status === 'connected' ? 'bg-success' : runtime.status === 'error' ? 'bg-danger' : 'bg-text-4',
      )} />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-sans font-medium truncate">{runtime.name}</div>
        <div className="text-2xs text-text-4 flex items-center gap-1.5">
          <span className="font-mono">{runtime.type}</span>
          {runtime.status === 'connected' && <span className="text-success">Healthy</span>}
          {runtime.status === 'error' && <span className="text-danger">Unreachable</span>}
        </div>
      </div>
      <div className="flex items-center gap-0.5 flex-shrink-0">
        {runtime.latency != null && (
          <span className="text-2xs font-mono text-text-4 mr-1">{Math.round(runtime.latency)}ms</span>
        )}
        <Tooltip content="Test connection">
          <button
            onClick={(e) => { e.stopPropagation(); onTest(runtime.id); }}
            className="p-1 text-text-4 hover:text-accent transition-colors cursor-pointer"
          >
            {testing === runtime.id ? <Loader2 size={11} className="animate-spin" /> : <RotateCcw size={11} />}
          </button>
        </Tooltip>
        <Tooltip content="Remove">
          <button
            onClick={(e) => { e.stopPropagation(); onRemove(runtime.id); }}
            className="p-1 text-text-4 hover:text-danger transition-colors cursor-pointer"
          >
            <Trash2 size={11} />
          </button>
        </Tooltip>
      </div>
    </button>
  );
}

function formatSize(bytes) {
  if (!bytes) return '';
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
  return `${(bytes / 1e3).toFixed(0)} KB`;
}

const BACKENDS = [
  ...(IS_APPLE ? [{ id: 'mlx', label: 'MLX', subtitle: 'Apple Silicon optimized, guided setup', recommended: true, autoLaunch: false, appleOnly: true }] : []),
  { id: 'llama-cpp', label: 'llama.cpp', subtitle: 'CPU + GPU, auto-managed', recommended: !IS_APPLE, autoLaunch: true },
  { id: 'vllm', label: 'vLLM', subtitle: 'GPU-optimized, guided setup', autoLaunch: false },
  { id: 'tgi', label: 'TGI', subtitle: 'HuggingFace, guided setup', autoLaunch: false },
];

function LaunchStatus({ phase, error }) {
  if (!phase) return null;
  return (
    <div className={cn(
      'flex items-center gap-2 px-2.5 py-1.5 text-2xs font-sans rounded-sm',
      phase === 'ready' && 'bg-success/8 text-success',
      phase === 'error' && 'bg-danger/8 text-danger',
      (phase === 'starting' || phase === 'checking') && 'bg-accent/8 text-accent',
    )}>
      {phase === 'starting' && <><Loader2 size={11} className="animate-spin" /> Starting server...</>}
      {phase === 'checking' && <><Loader2 size={11} className="animate-spin" /> Checking...</>}
      {phase === 'ready' && <><CheckCircle size={11} /> Server ready</>}
      {phase === 'error' && <><AlertTriangle size={11} /> {error || 'Launch failed'}</>}
    </div>
  );
}

export function LaunchModel() {
  const localModels = useGrooveStore((s) => s.labLocalModels);
  const fetchLocalModels = useGrooveStore((s) => s.fetchLabLocalModels);
  const checkLlama = useGrooveStore((s) => s.checkLlamaStatus);
  const launchModel = useGrooveStore((s) => s.launchLocalModel);
  const launching = useGrooveStore((s) => s.labLaunching);
  const llamaInstalled = useGrooveStore((s) => s.labLlamaInstalled);
  const launchPhase = useGrooveStore((s) => s.labLaunchPhase);
  const launchError = useGrooveStore((s) => s.labLaunchError);
  const launchLabAssistant = useGrooveStore((s) => s.launchLabAssistant);

  const [selectedModel, setSelectedModel] = useState(null);
  const [selectedBackend, setSelectedBackend] = useState(IS_APPLE ? 'mlx' : 'llama-cpp');
  const [assistantLaunching, setAssistantLaunching] = useState(false);

  useEffect(() => { fetchLocalModels(); checkLlama(); }, [fetchLocalModels, checkLlama]);

  const currentBackend = BACKENDS.find((b) => b.id === selectedBackend);
  const canLaunch = selectedModel && currentBackend?.autoLaunch && llamaInstalled && !launching;

  function handleLaunch() {
    if (!canLaunch) return;
    launchModel(selectedModel);
  }

  async function handleLaunchAssistant() {
    if (assistantLaunching) return;
    setAssistantLaunching(true);
    try {
      await launchLabAssistant(currentBackend.id);
    } finally {
      setAssistantLaunching(false);
    }
  }

  return (
    <div className="space-y-3">
      <span className="text-2xs font-semibold font-sans text-text-3 uppercase tracking-wider">Launch Model</span>

      {localModels.length === 0 ? (
        <div className="py-5 text-center">
          <HardDrive size={18} className="mx-auto text-text-4 mb-1.5" />
          <p className="text-xs text-text-3 font-sans">No downloaded models</p>
          <p className="text-2xs text-text-4 font-sans mt-0.5">Download GGUFs from the Models tab</p>
        </div>
      ) : (
        <>
          <ScrollArea className="max-h-36">
            <div className="space-y-px">
              {localModels.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setSelectedModel(m.id)}
                  className={cn(
                    'w-full flex items-center gap-2 px-2.5 py-2 text-left transition-colors cursor-pointer rounded-sm',
                    selectedModel === m.id ? 'bg-accent/8 text-text-0' : 'text-text-2 hover:bg-surface-3 hover:text-text-0',
                  )}
                >
                  <HardDrive size={11} className={cn('flex-shrink-0', selectedModel === m.id ? 'text-accent' : 'text-text-4')} />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-sans font-medium truncate">
                      {m.filename?.replace(/\.gguf$/i, '') || m.id}
                    </div>
                    <div className="text-2xs font-mono text-text-4 flex items-center gap-2">
                      {m.quantization && <span>{m.quantization}</span>}
                      {m.parameters && <span>{m.parameters}</span>}
                      {m.sizeBytes && <span>{formatSize(m.sizeBytes)}</span>}
                    </div>
                  </div>
                  {selectedModel === m.id && <ChevronRight size={11} className="text-accent flex-shrink-0" />}
                </button>
              ))}
            </div>
          </ScrollArea>

          {selectedModel && (
            <div className="space-y-2">
              <span className="text-2xs font-semibold font-sans text-text-4 uppercase tracking-wider">Backend</span>
              <div className="space-y-px">
                {BACKENDS.map((b) => (
                  <button
                    key={b.id}
                    onClick={() => setSelectedBackend(b.id)}
                    className={cn(
                      'w-full flex items-center gap-2.5 px-2.5 py-2 text-left transition-colors cursor-pointer rounded-sm',
                      selectedBackend === b.id ? 'bg-accent/8' : 'hover:bg-surface-3',
                    )}
                  >
                    <span className={cn(
                      'w-2 h-2 rounded-full border-[1.5px] flex-shrink-0',
                      selectedBackend === b.id ? 'border-accent bg-accent' : 'border-text-4',
                    )} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className={cn('text-xs font-sans font-medium', selectedBackend === b.id ? 'text-text-0' : 'text-text-2')}>
                          {b.label}
                        </span>
                        {b.recommended && <Badge variant="success" className="text-2xs">Recommended</Badge>}
                      </div>
                      <div className="text-2xs text-text-4 font-sans">{b.subtitle}</div>
                    </div>
                  </button>
                ))}
              </div>

              {selectedBackend === 'llama-cpp' && (
                <div className="px-2.5">
                  {llamaInstalled === null && (
                    <div className="flex items-center gap-2 text-2xs text-text-3 font-sans">
                      <Loader2 size={10} className="animate-spin" /> Checking llama-server...
                    </div>
                  )}
                  {llamaInstalled === true && (
                    <div className="flex items-center gap-2 text-2xs text-success font-sans">
                      <CheckCircle size={10} /> llama-server found
                    </div>
                  )}
                  {llamaInstalled === false && (
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2 text-2xs text-danger font-sans">
                        <AlertTriangle size={10} /> llama-server not found
                      </div>
                      <code className="block text-2xs font-mono text-text-3 bg-surface-2 px-2 py-1 rounded-sm">brew install llama.cpp</code>
                      <button
                        onClick={checkLlama}
                        className="flex items-center gap-1.5 text-2xs font-sans text-accent hover:text-accent/80 transition-colors cursor-pointer"
                      >
                        <RotateCcw size={10} /> Recheck after install
                      </button>
                    </div>
                  )}
                </div>
              )}

              {!currentBackend?.autoLaunch && (
                <div className="space-y-2">
                  <button
                    onClick={handleLaunchAssistant}
                    disabled={assistantLaunching}
                    className={cn(
                      'w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-sans font-medium rounded-sm transition-colors cursor-pointer',
                      assistantLaunching ? 'bg-accent/20 text-accent' : 'bg-accent text-surface-0 hover:bg-accent/90',
                    )}
                  >
                    {assistantLaunching
                      ? <><Loader2 size={12} className="animate-spin" /> Starting Assistant...</>
                      : <><Wrench size={12} /> Setup {currentBackend?.label} with Assistant</>
                    }
                  </button>
                  <p className="text-2xs text-text-4 font-sans">
                    An AI assistant will check your system and handle the installation, or start your server manually and add it as a Runtime below.
                  </p>
                </div>
              )}

              {currentBackend?.autoLaunch && (
                <div className="space-y-2">
                  <button
                    disabled={!canLaunch}
                    onClick={handleLaunch}
                    className={cn(
                      'w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-sans font-medium rounded-sm transition-colors cursor-pointer',
                      canLaunch ? 'bg-accent text-surface-0 hover:bg-accent/90' : 'bg-surface-3 text-text-4 cursor-not-allowed',
                    )}
                  >
                    {launching ? (
                      <><Loader2 size={12} className="animate-spin" /> Starting...</>
                    ) : (
                      <><Play size={12} /> Launch</>
                    )}
                  </button>
                  <LaunchStatus phase={launchPhase} error={launchError} />
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function RuntimeConfig() {
  const runtimes = useGrooveStore((s) => s.labRuntimes);
  const activeRuntime = useGrooveStore((s) => s.labActiveRuntime);
  const setActiveRuntime = useGrooveStore((s) => s.setLabActiveRuntime);
  const testRuntime = useGrooveStore((s) => s.testLabRuntime);
  const removeRuntime = useGrooveStore((s) => s.removeLabRuntime);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [testing, setTesting] = useState(null);

  async function handleTest(id) {
    setTesting(id);
    await testRuntime(id);
    setTesting(null);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-2xs font-semibold font-sans text-text-3 uppercase tracking-wider">Runtimes</span>
        <Tooltip content="Add runtime">
          <button
            onClick={() => setDialogOpen(true)}
            className="p-1 text-text-4 hover:text-accent transition-colors cursor-pointer"
          >
            <Plus size={13} />
          </button>
        </Tooltip>
      </div>

      {runtimes.length === 0 ? (
        <div className="py-5 text-center">
          <WifiOff size={18} className="mx-auto text-text-4 mb-1.5" />
          <p className="text-xs text-text-3 font-sans">No runtimes configured</p>
          <button
            onClick={() => setDialogOpen(true)}
            className="mt-2 flex items-center gap-1 mx-auto px-3 py-1.5 text-2xs font-sans text-text-3 hover:text-text-1 transition-colors cursor-pointer"
          >
            <Plus size={11} /> Add Runtime
          </button>
        </div>
      ) : (
        <ScrollArea className="max-h-48">
          <div className="space-y-px">
            {runtimes.map((rt) => (
              <RuntimeItem
                key={rt.id}
                runtime={rt}
                active={activeRuntime === rt.id}
                onSelect={setActiveRuntime}
                onTest={handleTest}
                onRemove={removeRuntime}
                testing={testing}
              />
            ))}
          </div>
        </ScrollArea>
      )}

      <AddRuntimeDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  );
}
