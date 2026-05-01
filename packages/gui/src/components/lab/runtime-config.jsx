// FSL-1.1-Apache-2.0 — see LICENSE
import { useState } from 'react';
import { useGrooveStore } from '../../stores/groove';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Input } from '../ui/input';
import { Dialog, DialogContent } from '../ui/dialog';
import { Select, SelectTrigger, SelectContent, SelectItem } from '../ui/select';
import { Tooltip } from '../ui/tooltip';
import { ScrollArea } from '../ui/scroll-area';
import { Plus, Trash2, Loader2, Wifi, WifiOff, RotateCcw } from 'lucide-react';
import { cn } from '../../lib/cn';

const RUNTIME_TYPES = [
  { value: 'ollama', label: 'Ollama' },
  { value: 'vllm', label: 'vLLM' },
  { value: 'llama-cpp', label: 'llama.cpp' },
  { value: 'tgi', label: 'TGI' },
  { value: 'openai-compatible', label: 'OpenAI Compatible' },
];

const DEFAULT_ENDPOINTS = {
  ollama: 'http://localhost:11434',
  vllm: 'http://localhost:8000',
  'llama-cpp': 'http://localhost:8080',
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
                {RUNTIME_TYPES.map((rt) => (
                  <SelectItem key={rt.value} value={rt.value}>{rt.label}</SelectItem>
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
  const statusColor = runtime.status === 'connected' ? 'success' : runtime.status === 'error' ? 'danger' : 'default';

  return (
    <button
      onClick={() => onSelect(runtime.id)}
      className={cn(
        'w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-left transition-colors cursor-pointer',
        active ? 'bg-accent/10 text-text-0' : 'text-text-2 hover:bg-surface-5/50 hover:text-text-0',
      )}
    >
      <span className={cn(
        'w-2 h-2 rounded-full flex-shrink-0',
        runtime.status === 'connected' ? 'bg-success' : runtime.status === 'error' ? 'bg-danger' : 'bg-text-4',
      )} />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-sans font-medium truncate">{runtime.name}</div>
        <div className="text-2xs font-mono text-text-4 truncate">{runtime.type}</div>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        {runtime.latency != null && (
          <span className="text-2xs font-mono text-text-3">{Math.round(runtime.latency)}ms</span>
        )}
        <Tooltip content="Test connection">
          <button
            onClick={(e) => { e.stopPropagation(); onTest(runtime.id); }}
            className="p-1 rounded text-text-4 hover:text-accent hover:bg-accent/10 transition-colors cursor-pointer"
          >
            {testing === runtime.id ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
          </button>
        </Tooltip>
        <Tooltip content="Remove">
          <button
            onClick={(e) => { e.stopPropagation(); onRemove(runtime.id); }}
            className="p-1 rounded text-text-4 hover:text-danger hover:bg-danger/10 transition-colors cursor-pointer"
          >
            <Trash2 size={12} />
          </button>
        </Tooltip>
      </div>
    </button>
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
        <span className="text-xs font-semibold font-sans text-text-2 uppercase tracking-wider">Runtimes</span>
        <Tooltip content="Add runtime">
          <button
            onClick={() => setDialogOpen(true)}
            className="p-1 rounded text-text-3 hover:text-accent hover:bg-accent/10 transition-colors cursor-pointer"
          >
            <Plus size={14} />
          </button>
        </Tooltip>
      </div>

      {runtimes.length === 0 ? (
        <div className="px-3 py-4 text-center">
          <WifiOff size={20} className="mx-auto text-text-4 mb-1.5" />
          <p className="text-xs text-text-3 font-sans">No runtimes configured</p>
          <Button variant="ghost" size="sm" className="mt-2" onClick={() => setDialogOpen(true)}>
            <Plus size={12} className="mr-1" /> Add Runtime
          </Button>
        </div>
      ) : (
        <ScrollArea className="max-h-48">
          <div className="space-y-0.5">
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
