// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useEffect, useRef } from 'react';
import { useGrooveStore } from '../../stores/groove';
import { SidebarSection } from '../../views/model-lab';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Input } from '../ui/input';
import { Dialog, DialogContent } from '../ui/dialog';
import { Select, SelectTrigger, SelectContent, SelectItem } from '../ui/select';
import { Tooltip } from '../ui/tooltip';
import { ScrollArea } from '../ui/scroll-area';
import { Plus, Trash2, Loader2, WifiOff, RotateCcw, HardDrive, Play, Square, CheckCircle, AlertTriangle, ChevronRight, Wrench, Settings2 } from 'lucide-react';
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

function RuntimeItem({ runtime, active, onSelect, onTest, onRemove, onStop, onStart, testing }) {
  const online = runtime.status === 'connected';
  const starting = runtime.status === 'starting';
  const managed = !!(runtime._localModelId || runtime._mlxModelId || runtime.launchConfig || runtime.type === 'mlx' || runtime.type === 'llama-cpp');
  return (
    <button
      onClick={() => onSelect(runtime.id)}
      className={cn(
        'w-full flex items-center gap-2.5 px-2.5 py-2 text-left transition-colors cursor-pointer rounded',
        active ? 'bg-accent/8 ring-1 ring-accent/20' : 'hover:bg-surface-2',
      )}
    >
      <span className={cn(
        'w-1.5 h-1.5 rounded-full flex-shrink-0',
        starting ? 'bg-warning animate-pulse' : online ? 'bg-success' : runtime.status === 'error' ? 'bg-danger' : 'bg-text-4',
      )} />
      <div className="flex-1 min-w-0">
        <div className={cn('text-[11px] font-sans font-medium truncate', active ? 'text-text-0' : 'text-text-2')}>
          {RUNTIME_TYPES.find((t) => t.value === runtime.type)?.label || runtime.type}
        </div>
        <div className="text-[10px] text-text-4 flex items-center gap-1.5">
          <span className={cn('font-sans', starting ? 'text-warning' : online ? 'text-success' : 'text-danger')}>
            {starting ? 'Starting...' : online ? 'Online' : 'Offline'}
          </span>
          {runtime.latency != null && online && (
            <span className="font-mono">{Math.round(runtime.latency)}ms</span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-px flex-shrink-0">
        {managed && online && (
          <Tooltip content="Stop server">
            <button
              onClick={(e) => { e.stopPropagation(); onStop(runtime.id); }}
              className="p-1 text-text-4 hover:text-danger transition-colors cursor-pointer"
            >
              <Square size={10} />
            </button>
          </Tooltip>
        )}
        {starting && (
          <Tooltip content="Starting server...">
            <span className="p-1 text-warning">
              <Loader2 size={10} className="animate-spin" />
            </span>
          </Tooltip>
        )}
        {managed && !online && !starting && (
          <Tooltip content="Start server">
            <button
              onClick={(e) => { e.stopPropagation(); onStart(runtime.id); }}
              className="p-1 text-text-4 hover:text-success transition-colors cursor-pointer"
            >
              <Play size={10} />
            </button>
          </Tooltip>
        )}
        <Tooltip content="Test connection">
          <button
            onClick={(e) => { e.stopPropagation(); onTest(runtime.id); }}
            className="p-1 text-text-4 hover:text-accent transition-colors cursor-pointer"
          >
            {testing === runtime.id ? <Loader2 size={10} className="animate-spin" /> : <RotateCcw size={10} />}
          </button>
        </Tooltip>
        <Tooltip content="Remove runtime">
          <button
            onClick={(e) => { e.stopPropagation(); onRemove(runtime.id); }}
            className="p-1 text-text-4 hover:text-danger transition-colors cursor-pointer"
          >
            <Trash2 size={10} />
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
  ...(IS_APPLE ? [{ id: 'mlx', label: 'MLX', subtitle: 'Apple Silicon optimized', recommended: true, autoLaunch: true, appleOnly: true }] : []),
  { id: 'llama-cpp', label: 'llama.cpp', subtitle: 'CPU + GPU, auto-managed', recommended: !IS_APPLE, autoLaunch: true },
  { id: 'vllm', label: 'vLLM', subtitle: 'GPU-optimized, guided setup', autoLaunch: false },
  { id: 'tgi', label: 'TGI', subtitle: 'HuggingFace, guided setup', autoLaunch: false },
];

function StatusBanner({ variant, icon: Icon, children }) {
  const styles = {
    success: 'bg-success/8 text-success',
    danger: 'bg-danger/8 text-danger',
    accent: 'bg-accent/8 text-accent',
    warning: 'bg-warning/8 text-warning',
  };
  return (
    <div className={cn('flex items-center gap-2 px-2.5 py-2 text-[11px] font-sans rounded', styles[variant])}>
      <Icon size={11} className={variant === 'accent' ? 'animate-spin' : ''} />
      <span>{children}</span>
    </div>
  );
}

function LaunchStatus({ phase, error }) {
  if (!phase) return null;
  if (phase === 'starting') return <StatusBanner variant="accent" icon={Loader2}>Starting server...</StatusBanner>;
  if (phase === 'checking') return <StatusBanner variant="accent" icon={Loader2}>Checking...</StatusBanner>;
  if (phase === 'ready') return <StatusBanner variant="success" icon={CheckCircle}>Server ready</StatusBanner>;
  if (phase === 'error') return <StatusBanner variant="danger" icon={AlertTriangle}>{error || 'Launch failed'}</StatusBanner>;
  return null;
}

function getIncompatibilityReason(modelType, backendId) {
  if (modelType === 'gguf' && backendId === 'mlx') return 'GGUF model — MLX needs MLX-format weights';
  if (modelType === 'gguf' && (backendId === 'vllm' || backendId === 'tgi')) return 'GGUF model — needs standard HuggingFace weights';
  if (modelType === 'mlx' && backendId === 'llama-cpp') return 'MLX model — llama.cpp needs a GGUF file';
  if (modelType === 'mlx' && (backendId === 'vllm' || backendId === 'tgi')) return 'MLX model — needs standard HuggingFace weights';
  if (modelType === 'hf' && backendId === 'mlx') return 'HF model — MLX needs MLX-converted weights';
  if (modelType === 'hf' && backendId === 'llama-cpp') return 'HF model — llama.cpp needs a GGUF file';
  return 'Incompatible format';
}

function getBackendCompat(model, backends) {
  if (!model) return backends.map((b) => ({ ...b, compatible: true, reason: null }));
  const compat = model.compatibleBackends || (model.type === 'gguf' ? ['llama-cpp'] : model.type === 'mlx' ? ['mlx'] : ['vllm', 'tgi']);
  return backends.map((b) => ({
    ...b,
    compatible: compat.includes(b.id),
    reason: compat.includes(b.id) ? null : getIncompatibilityReason(model.type, b.id),
  }));
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
  const labAssistantAgentId = useGrooveStore((s) => s.labAssistantAgentId);
  const labAssistantBackend = useGrooveStore((s) => s.labAssistantBackend);
  const labAssistantMode = useGrooveStore((s) => s.labAssistantMode);
  const setLabAssistantMode = useGrooveStore((s) => s.setLabAssistantMode);
  const agents = useGrooveStore((s) => s.agents);
  const runtimes = useGrooveStore((s) => s.labRuntimes);
  const activeRuntime = useGrooveStore((s) => s.labActiveRuntime);

  const [selectedModel, setSelectedModel] = useState(null);
  const [selectedBackend, setSelectedBackend] = useState(IS_APPLE ? 'mlx' : 'llama-cpp');
  const [assistantLaunching, setAssistantLaunching] = useState(false);
  const [suggestion, setSuggestion] = useState(null);

  useEffect(() => { fetchLocalModels(); checkLlama(); }, [fetchLocalModels, checkLlama]);

  const selectedModelObj = localModels.find((m) => m.id === selectedModel);
  const backendsWithCompat = getBackendCompat(selectedModelObj, BACKENDS);
  const currentBackend = backendsWithCompat.find((b) => b.id === selectedBackend);
  const isCompatible = currentBackend?.compatible ?? true;

  const backendReady = selectedBackend === 'mlx' || selectedBackend === 'llama-cpp' ? (selectedBackend === 'mlx' || llamaInstalled) : true;
  const canLaunch = selectedModel && currentBackend?.autoLaunch && backendReady && !launching && isCompatible;

  const assistantAgent = labAssistantAgentId ? agents.find((a) => a.id === labAssistantAgentId) : null;
  const assistantRunning = assistantAgent?.status === 'running';
  const assistantComplete = assistantAgent && assistantAgent.status !== 'running';
  const hasActiveAssistant = !!(labAssistantAgentId && (assistantRunning || assistantComplete));

  const activeRt = activeRuntime ? runtimes.find((r) => r.id === activeRuntime) : null;
  const serverRunning = activeRt?.status === 'connected';

  useEffect(() => {
    if (!selectedModel || !selectedBackend || isCompatible) { setSuggestion(null); return; }
    let cancelled = false;
    fetch(`/api/lab/suggest-model?modelId=${encodeURIComponent(selectedModel)}&targetBackend=${selectedBackend}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (!cancelled) setSuggestion(data?.suggestion || null); })
      .catch(() => { if (!cancelled) setSuggestion(null); });
    return () => { cancelled = true; };
  }, [selectedModel, selectedBackend, isCompatible]);

  function handleModelChange(e) {
    const id = e.target.value || null;
    setSelectedModel(id);
    if (!id) return;
    const model = localModels.find((m) => m.id === id);
    if (!model) return;
    const compat = model.compatibleBackends || [];
    const preferred = IS_APPLE ? ['mlx', 'llama-cpp', 'vllm', 'tgi'] : ['llama-cpp', 'vllm', 'tgi'];
    const best = preferred.find((b) => compat.includes(b));
    if (best) setSelectedBackend(best);
  }

  function handleLaunch() {
    if (!canLaunch) return;
    launchModel(selectedModel);
  }

  async function handleLaunchAssistant() {
    if (assistantLaunching) return;
    setAssistantLaunching(true);
    try {
      const model = localModels.find((m) => m.id === selectedModel);
      await launchLabAssistant(currentBackend.id, model || undefined);
    } finally {
      setAssistantLaunching(false);
    }
  }

  return (
    <SidebarSection label="Launch Model">
      {localModels.length === 0 ? (
        <div className="py-6 text-center rounded-md bg-surface-1/50 border border-border-subtle">
          <HardDrive size={16} className="mx-auto text-text-4 mb-2" />
          <p className="text-[11px] text-text-3 font-sans">No downloaded models</p>
          <p className="text-[10px] text-text-4 font-sans mt-0.5">Download models from the Models tab</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="relative">
            <select
              value={selectedModel || ''}
              onChange={handleModelChange}
              className="w-full h-9 px-2.5 pr-7 text-[11px] rounded bg-surface-1 border border-border text-text-0 font-sans appearance-none cursor-pointer focus:outline-none focus:ring-1 focus:ring-accent/50 focus:border-accent/50 transition-colors"
            >
              <option value="">Select a model</option>
              {localModels.map((m) => {
                const label = m.filename?.replace(/\.gguf$/i, '') || m.id;
                const tag = m.type === 'mlx' ? 'MLX' : m.type === 'hf' ? 'HF' : 'GGUF';
                const meta = [tag, m.quantization, m.parameters, m.sizeBytes ? formatSize(m.sizeBytes) : null].filter(Boolean).join(' · ');
                return (
                  <option key={m.id} value={m.id}>
                    {label}{meta ? ` (${meta})` : ''}
                  </option>
                );
              })}
            </select>
            <ChevronRight size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-4 pointer-events-none rotate-90" />
          </div>

          {selectedModel && (
            <div className="space-y-4">
              <div className="space-y-2">
                <span className="text-[10px] font-semibold font-sans text-text-4 uppercase tracking-widest">Backend</span>
                <div className="space-y-1 rounded-md bg-surface-1/50 border border-border-subtle p-2">
                  {backendsWithCompat.map((b) => (
                    <Tooltip key={b.id} content={b.reason} side="right">
                      <button
                        onClick={() => setSelectedBackend(b.id)}
                        className={cn(
                          'w-full flex items-center gap-2.5 px-2.5 py-2 text-left transition-colors cursor-pointer rounded',
                          selectedBackend === b.id ? 'bg-accent/10' : 'hover:bg-surface-3',
                          !b.compatible && 'opacity-40',
                        )}
                      >
                        <span className={cn(
                          'w-2 h-2 rounded-full border-[1.5px] flex-shrink-0 transition-colors',
                          selectedBackend === b.id ? 'border-accent bg-accent' : 'border-text-4',
                        )} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className={cn('text-[11px] font-sans font-medium', selectedBackend === b.id ? 'text-text-0' : 'text-text-2')}>
                              {b.label}
                            </span>
                            {b.compatible && b.recommended && <Badge variant="success" className="text-[9px]">Recommended</Badge>}
                          </div>
                          <div className="text-[10px] text-text-4 font-sans">{b.subtitle}</div>
                        </div>
                      </button>
                    </Tooltip>
                  ))}
                </div>
              </div>

              {!isCompatible && (
                <StatusBanner variant="warning" icon={AlertTriangle}>
                  {currentBackend?.reason}
                  {suggestion && (
                    <> — try <span className="font-mono font-medium">{suggestion.repoId}</span></>
                  )}
                </StatusBanner>
              )}

              {isCompatible && selectedBackend === 'llama-cpp' && (
                <div>
                  {llamaInstalled === null && (
                    <div className="flex items-center gap-2 text-[11px] text-text-3 font-sans">
                      <Loader2 size={10} className="animate-spin" /> Checking llama-server...
                    </div>
                  )}
                  {llamaInstalled === true && (
                    <div className="flex items-center gap-2 text-[11px] text-success font-sans">
                      <CheckCircle size={10} /> llama-server found
                    </div>
                  )}
                  {llamaInstalled === false && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-[11px] text-danger font-sans">
                        <AlertTriangle size={10} /> llama-server not found
                      </div>
                      <code className="block text-[10px] font-mono text-text-3 bg-surface-2 px-2.5 py-1.5 rounded">brew install llama.cpp</code>
                      <button
                        onClick={checkLlama}
                        className="flex items-center gap-1.5 text-[11px] font-sans text-accent hover:text-accent/80 transition-colors cursor-pointer"
                      >
                        <RotateCcw size={10} /> Recheck after install
                      </button>
                    </div>
                  )}
                </div>
              )}

              {isCompatible && !currentBackend?.autoLaunch && (
                <div className="space-y-2">
                  {hasActiveAssistant && labAssistantBackend === selectedBackend ? (
                    <div className="space-y-2">
                      {assistantRunning ? (
                        <StatusBanner variant="accent" icon={Loader2}>
                          Assistant is setting up {currentBackend?.label}...
                        </StatusBanner>
                      ) : (
                        <StatusBanner variant="success" icon={CheckCircle}>Setup complete</StatusBanner>
                      )}
                      {!labAssistantMode && (
                        <button
                          onClick={() => setLabAssistantMode(true)}
                          className="w-full flex items-center justify-center gap-1.5 h-8 text-[11px] font-sans font-medium text-text-1 bg-surface-2 hover:bg-surface-3 rounded transition-colors cursor-pointer"
                        >
                          View Assistant
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <button
                        onClick={handleLaunchAssistant}
                        disabled={assistantLaunching}
                        className={cn(
                          'w-full flex items-center justify-center gap-1.5 h-8 text-[11px] font-sans font-medium rounded transition-colors cursor-pointer',
                          assistantLaunching ? 'bg-accent/20 text-accent' : 'bg-accent text-surface-0 hover:bg-accent/90',
                        )}
                      >
                        {assistantLaunching
                          ? <><Loader2 size={11} className="animate-spin" /> Starting Assistant...</>
                          : <><Wrench size={11} /> Setup {currentBackend?.label} with Assistant</>
                        }
                      </button>
                      <p className="text-[10px] text-text-4 font-sans text-center">
                        An AI assistant will check your system and handle the installation.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {isCompatible && currentBackend?.autoLaunch && (
                <div className="space-y-2">
                  {serverRunning ? (
                    <StatusBanner variant="success" icon={CheckCircle}>Server Running</StatusBanner>
                  ) : (
                    <button
                      disabled={!canLaunch}
                      onClick={handleLaunch}
                      className={cn(
                        'w-full flex items-center justify-center gap-1.5 h-8 text-[11px] font-sans font-medium rounded transition-colors cursor-pointer',
                        canLaunch ? 'bg-accent text-surface-0 hover:bg-accent/90' : 'bg-surface-3 text-text-4 cursor-not-allowed',
                      )}
                    >
                      {launching ? (
                        <><Loader2 size={11} className="animate-spin" /> Starting...</>
                      ) : (
                        <><Play size={11} /> Launch</>
                      )}
                    </button>
                  )}
                  <LaunchStatus phase={launchPhase} error={launchError} />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </SidebarSection>
  );
}

export function RuntimeConfig() {
  const runtimes = useGrooveStore((s) => s.labRuntimes);
  const activeRuntime = useGrooveStore((s) => s.labActiveRuntime);
  const setActiveRuntime = useGrooveStore((s) => s.setLabActiveRuntime);
  const testRuntime = useGrooveStore((s) => s.testLabRuntime);
  const removeRuntime = useGrooveStore((s) => s.removeLabRuntime);
  const stopRuntime = useGrooveStore((s) => s.stopLabRuntime);
  const startRuntime = useGrooveStore((s) => s.startLabRuntime);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [testing, setTesting] = useState(null);

  async function handleTest(id) {
    setTesting(id);
    await testRuntime(id);
    setTesting(null);
  }

  return (
    <SidebarSection
      label="Runtimes"
      action={
        <Tooltip content="Add runtime">
          <button
            onClick={() => setDialogOpen(true)}
            className="p-1 text-text-4 hover:text-accent transition-colors cursor-pointer"
          >
            <Plus size={12} />
          </button>
        </Tooltip>
      }
    >
      {runtimes.length === 0 ? (
        <div className="py-6 text-center rounded-md bg-surface-1/50 border border-border-subtle">
          <WifiOff size={16} className="mx-auto text-text-4 mb-2" />
          <p className="text-[11px] text-text-3 font-sans">No runtimes configured</p>
          <button
            onClick={() => setDialogOpen(true)}
            className="mt-2 inline-flex items-center gap-1 px-2.5 py-1 text-[10px] font-sans text-accent hover:text-accent/80 transition-colors cursor-pointer"
          >
            <Plus size={10} /> Add Runtime
          </button>
        </div>
      ) : (
        <ScrollArea className="max-h-48">
          <div className="space-y-1 rounded-md bg-surface-1/50 border border-border-subtle p-2">
            {runtimes.map((rt) => (
              <RuntimeItem
                key={rt.id}
                runtime={rt}
                active={activeRuntime === rt.id}
                onSelect={setActiveRuntime}
                onTest={handleTest}
                onRemove={removeRuntime}
                onStop={stopRuntime}
                onStart={startRuntime}
                testing={testing}
              />
            ))}
          </div>
        </ScrollArea>
      )}

      <AddRuntimeDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </SidebarSection>
  );
}

export function RuntimeSection() {
  const runtimes = useGrooveStore((s) => s.labRuntimes);
  const activeRuntime = useGrooveStore((s) => s.labActiveRuntime);
  const activeModel = useGrooveStore((s) => s.labActiveModel);
  const [expanded, setExpanded] = useState(true);
  const wasRunning = useRef(false);

  const activeRt = activeRuntime ? runtimes.find((r) => r.id === activeRuntime) : null;
  const serverRunning = activeRt?.status === 'connected';
  const runtimeLabel = activeRt ? (RUNTIME_TYPES.find((t) => t.value === activeRt.type)?.label || activeRt.type) : null;

  useEffect(() => {
    if (serverRunning && !wasRunning.current) setExpanded(false);
    wasRunning.current = serverRunning;
  }, [serverRunning]);

  if (!serverRunning || expanded) {
    return (
      <div className="space-y-6">
        <LaunchModel />
        <RuntimeConfig />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-md bg-surface-1/50 border border-border-subtle">
      <span className="w-2 h-2 rounded-full bg-success flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-sans font-medium text-text-0 truncate">{runtimeLabel}</div>
        <div className="text-[10px] text-text-4 font-sans truncate">
          {activeModel || 'Ready'}{activeRt?.latency != null ? ` · ${Math.round(activeRt.latency)}ms` : ''}
        </div>
      </div>
      <Tooltip content="Runtime settings">
        <button
          onClick={() => setExpanded(true)}
          className="p-1 text-text-4 hover:text-text-1 transition-colors cursor-pointer"
        >
          <Settings2 size={12} />
        </button>
      </Tooltip>
    </div>
  );
}
