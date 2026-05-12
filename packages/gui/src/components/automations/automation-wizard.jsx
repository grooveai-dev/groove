// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useEffect } from 'react';
import { useGrooveStore } from '../../stores/groove';
import { Dialog, DialogContent } from '../ui/dialog';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Input, Textarea } from '../ui/input';
import { Select, SelectTrigger, SelectContent, SelectItem } from '../ui/select';
import { Collapsible } from '../ui/collapsible';
import { CRON_PRESETS, validateCron } from '../../lib/cron';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';
import {
  User, Code, Briefcase, Settings, Plus, X, Clock,
  FileText, Folder, ChevronRight, ChevronLeft, Package,
  FolderOpen, FolderClosed, ArrowUp, HardDrive,
  Loader2, File, Save, MessageSquare, ChevronDown, AlertTriangle,
} from 'lucide-react';

const TEAM_TYPES = [
  { id: 'solo', label: 'Solo Agent', icon: User, description: 'Single agent for focused tasks' },
  { id: 'dev', label: 'Dev Team', icon: Code, description: 'Frontend + Backend + QC' },
  { id: 'business', label: 'Business Team', icon: Briefcase, description: 'CMO + CFO + Analyst' },
  { id: 'custom', label: 'Custom', icon: Settings, description: 'Build your own team' },
];

const DEV_ROLES = [
  { role: 'frontend', phase: 1 },
  { role: 'backend', phase: 1 },
  { role: 'fullstack', phase: 2 },
];

const BUSINESS_ROLES = [
  { role: 'CMO', phase: 1 },
  { role: 'CFO', phase: 1 },
  { role: 'analyst', phase: 2 },
];

const ALL_ROLES = [
  'chat', 'planner', 'backend', 'frontend', 'fullstack',
  'testing', 'devops', 'docs', 'security', 'database',
  'cmo', 'cfo', 'ea', 'support', 'analyst',
  'creative', 'slides', 'ambassador',
];

const ROLE_LABELS = {
  chat: 'Chat', planner: 'Planner', backend: 'Backend', frontend: 'Frontend',
  fullstack: 'Fullstack', testing: 'Testing', devops: 'DevOps', docs: 'Docs',
  security: 'Security', database: 'Database', cmo: 'CMO', cfo: 'CFO',
  ea: 'EA', support: 'Support', analyst: 'Analyst', creative: 'Writer',
  slides: 'Slides', ambassador: 'Ambassador',
};

function roleLabel(r) { return ROLE_LABELS[r] || r; }

const MEMORY_PATTERN = /\[read\]\s*#[\w/.-]+/g;

function detectMemoryRefs(text) {
  if (!text) return [];
  return [...text.matchAll(MEMORY_PATTERN)].map((m) => m[0]);
}

function MemoryBadges({ text }) {
  const refs = detectMemoryRefs(text);
  if (refs.length === 0) return null;
  return (
    <div className="flex items-center gap-1.5 flex-wrap px-1">
      {refs.map((ref, i) => (
        <span key={i} className="text-2xs font-mono text-teal-400">{ref}</span>
      ))}
    </div>
  );
}

const SCHEDULE_UNITS = [
  { value: 'min', label: 'minutes' },
  { value: 'hour', label: 'hours' },
  { value: 'day', label: 'days' },
  { value: 'week', label: 'weeks' },
];

const INITIAL_FORM = {
  name: '',
  description: '',
  teamType: null,
  soloRole: 'planner',
  customRoles: [{ role: 'fullstack', phase: 1 }],
  provider: '',
  model: '',
  runtimeId: '',
  instructionMode: 'write',
  instructions: '',
  filePath: '',
  cronPreset: null,
  scheduleMode: 'preset',
  scheduleCount: 1,
  scheduleUnit: 'hour',
  enabledOnCreate: true,
  gatewayIds: [],
  notifyOn: 'complete',
  integrationIds: [],
  outputFilePath: '',
  outputCustom: '',
};

function simpleToCron(count, unit) {
  const n = parseInt(count, 10);
  if (!n || n < 1) return null;
  switch (unit) {
    case 'min': return `*/${n} * * * *`;
    case 'hour': return n === 1 ? '0 * * * *' : `0 */${n} * * *`;
    case 'day': return n === 1 ? '0 9 * * *' : `0 9 */${n} * *`;
    case 'week': return '0 9 * * 1';
    default: return null;
  }
}

function simpleToCronLabel(count, unit) {
  const n = parseInt(count, 10);
  if (!n || n < 1) return '';
  const labels = { min: 'minute', hour: 'hour', day: 'day', week: 'week' };
  return `Every ${n === 1 ? '' : n + ' '}${labels[unit]}${n !== 1 ? 's' : ''}`;
}

function cronToSimple(cron) {
  if (!cron) return null;
  const p = cron.trim().split(/\s+/);
  if (p.length !== 5) return null;
  const [min, hour, dom, mon, dow] = p;
  if (min.startsWith('*/') && hour === '*' && dom === '*' && mon === '*' && dow === '*')
    return { count: parseInt(min.slice(2)), unit: 'min' };
  if (min === '0' && hour === '*' && dom === '*' && mon === '*' && dow === '*')
    return { count: 1, unit: 'hour' };
  if (min === '0' && hour.startsWith('*/') && dom === '*' && mon === '*' && dow === '*')
    return { count: parseInt(hour.slice(2)), unit: 'hour' };
  if (min === '0' && /^\d+$/.test(hour) && dom === '*' && mon === '*' && dow === '*')
    return { count: 1, unit: 'day' };
  if (min === '0' && /^\d+$/.test(hour) && dom.startsWith('*/') && mon === '*' && dow === '*')
    return { count: parseInt(dom.slice(2)), unit: 'day' };
  if (min === '0' && /^\d+$/.test(hour) && dom === '*' && mon === '*' && /^\d$/.test(dow))
    return { count: 1, unit: 'week' };
  return null;
}

function rolesMatch(a, b) {
  return a.length === b.length &&
    a.every((r, i) => b[i]?.role === r.role && (b[i]?.phase || 1) === r.phase);
}

function automationToForm(a) {
  let teamType = 'custom';
  let soloRole = 'planner';
  let customRoles = [{ role: 'fullstack', phase: 1 }];

  if (a.agentConfig && !a.teamConfig) {
    teamType = 'solo';
    soloRole = a.agentConfig.role || 'planner';
  } else if (a.teamConfig) {
    if (rolesMatch(DEV_ROLES, a.teamConfig)) teamType = 'dev';
    else if (rolesMatch(BUSINESS_ROLES, a.teamConfig)) teamType = 'business';
    else customRoles = a.teamConfig.map((r) => ({ role: r.role, phase: r.phase || 1 }));
  }

  const cronPreset = CRON_PRESETS.find((p) => p.cron === a.cron)?.cron || null;
  let scheduleMode = 'preset';
  let scheduleCount = 1;
  let scheduleUnit = 'hour';

  if (!cronPreset) {
    const simple = cronToSimple(a.cron);
    if (simple) {
      scheduleMode = 'simple';
      scheduleCount = simple.count;
      scheduleUnit = simple.unit;
    }
  }

  let providerVal = a.agentConfig?.provider || (a.teamConfig?.[0]?.provider) || '';
  let modelVal = a.agentConfig?.model || (a.teamConfig?.[0]?.model) || '';
  let runtimeIdVal = '';
  if (providerVal === 'local' && modelVal?.startsWith('runtime:')) {
    const parts = modelVal.split(':');
    runtimeIdVal = parts[1];
    modelVal = parts.slice(2).join(':');
  }

  return {
    name: a.name || '',
    description: a.description || '',
    teamType,
    soloRole,
    customRoles,
    provider: providerVal,
    model: modelVal === 'auto' ? '' : modelVal,
    runtimeId: runtimeIdVal,
    instructionMode: a.instructionSource?.type === 'file' ? 'file' : 'write',
    instructions: a.instructionSource?.type === 'inline' ? (a.instructionSource.content || '') : '',
    filePath: a.instructionSource?.type === 'file' ? (a.instructionSource.filePath || '') : '',
    cronPreset,
    scheduleMode,
    scheduleCount,
    scheduleUnit,
    enabledOnCreate: a.enabled !== false,
    gatewayIds: a.outputConfig?.gatewayIds || [],
    notifyOn: a.outputConfig?.notifyOn || 'complete',
    integrationIds: a.integrationIds || [],
    outputFilePath: a.outputConfig?.filePath || '',
    outputCustom: a.outputConfig?.customInstructions || '',
  };
}

export function AutomationWizard() {
  const open = useGrooveStore((s) => s.automationWizardOpen);
  const close = useGrooveStore((s) => s.closeAutomationWizard);
  const createAutomation = useGrooveStore((s) => s.createAutomation);
  const updateAutomation = useGrooveStore((s) => s.updateAutomation);
  const editingId = useGrooveStore((s) => s.editingAutomationId);
  const automations = useGrooveStore((s) => s.automations);
  const availableGateways = useGrooveStore((s) => s.availableGateways);
  const availableIntegrations = useGrooveStore((s) => s.availableIntegrations);
  const fetchGateways = useGrooveStore((s) => s.fetchGateways);
  const fetchInstalledIntegrations = useGrooveStore((s) => s.fetchInstalledIntegrations);

  const isEditing = !!editingId;
  const [step, setStep] = useState(1);
  const [form, setForm] = useState(INITIAL_FORM);
  const [providers, setProviders] = useState([]);
  const [localModels, setLocalModels] = useState([]);
  const labRuntimes = useGrooveStore((s) => s.labRuntimes);
  const fetchLabRuntimes = useGrooveStore((s) => s.fetchLabRuntimes);

  useEffect(() => {
    if (open) {
      setStep(1);
      if (editingId) {
        const existing = automations.find((a) => a.id === editingId);
        setForm(existing ? automationToForm(existing) : INITIAL_FORM);
      } else {
        setForm(INITIAL_FORM);
      }
      fetchGateways();
      fetchInstalledIntegrations();
      fetchLabRuntimes();
      api.get('/providers').then((data) => {
        const list = Array.isArray(data) ? data : data.providers || [];
        setProviders(list);
        const local = list.find((p) => p.id === 'local');
        if (local?.models?.length) setLocalModels(local.models);
      }).catch(() => setProviders([]));
      api.get('/providers/ollama/models').then((data) => {
        const installed = data.installed || [];
        const catalog = data.catalog || [];
        if (installed.length || catalog.length) {
          setLocalModels((prev) => {
            const ids = new Set(prev.map((m) => m.id));
            const merged = [...prev];
            for (const m of installed) {
              if (!ids.has(m.id)) { merged.push(m); ids.add(m.id); }
            }
            for (const m of catalog) {
              if (!ids.has(m.id)) { merged.push({ id: m.id, name: m.name || m.id }); }
            }
            return merged;
          });
        }
      }).catch(() => {});
    }
  }, [open]);

  function update(patch) {
    setForm((prev) => ({ ...prev, ...patch }));
  }

  function getCronValue() {
    if (form.cronPreset) return form.cronPreset;
    return simpleToCron(form.scheduleCount, form.scheduleUnit);
  }

  function buildTeamConfig() {
    let p = form.provider || undefined;
    let m = form.model || undefined;
    if (p === 'local' && form.runtimeId && m) {
      m = `runtime:${form.runtimeId}:${m}`;
    }
    switch (form.teamType) {
      case 'solo': return { agentConfig: { role: form.soloRole, provider: p, model: m } };
      case 'dev': return { teamConfig: DEV_ROLES.map((r) => ({ ...r, provider: p, model: m })) };
      case 'business': return { teamConfig: BUSINESS_ROLES.map((r) => ({ ...r, provider: p, model: m })) };
      case 'custom': return { teamConfig: form.customRoles.filter((r) => r.role).map((r) => ({ ...r, provider: p, model: m })) };
      default: return {};
    }
  }

  function canProceed() {
    switch (step) {
      case 1: return form.name.trim() && form.teamType;
      case 2: return form.instructionMode === 'write' ? form.instructions.trim() : form.filePath.trim();
      case 3: {
        if (form.cronPreset) return true;
        const cron = simpleToCron(form.scheduleCount, form.scheduleUnit);
        return cron && validateCron(cron).valid;
      }
      case 4: return true;
      default: return false;
    }
  }

  function handleSubmit() {
    const cronVal = getCronValue();
    const config = {
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      cron: cronVal,
      ...buildTeamConfig(),
      instructionSource: form.instructionMode === 'write'
        ? { type: 'inline', content: form.instructions }
        : { type: 'file', filePath: form.filePath },
      outputConfig: {
        gatewayIds: form.gatewayIds,
        notifyOn: form.notifyOn,
        filePath: form.outputFilePath || undefined,
        customInstructions: form.outputCustom || undefined,
      },
      integrationIds: form.integrationIds.length > 0 ? form.integrationIds : undefined,
      enabled: form.enabledOnCreate,
    };
    if (isEditing) {
      updateAutomation(editingId, config);
      close();
    } else {
      createAutomation(config);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && close()}>
      <DialogContent title={isEditing ? 'Edit Automation' : 'New Automation'} description={isEditing ? 'Update this automation' : 'Create a scheduled automation'} className="max-w-xl">
        {/* Step indicator */}
        <div className="px-5 py-3 border-b border-border-subtle flex items-center justify-center gap-2">
          {[1, 2, 3, 4].map((s) => (
            <div key={s} className="flex items-center gap-2">
              <div className={cn(
                'w-2 h-2 rounded-full transition-colors',
                s === step ? 'bg-accent' : s < step ? 'bg-accent/40' : 'bg-surface-5',
              )} />
              {s < 4 && <div className={cn('w-6 h-px', s < step ? 'bg-accent/40' : 'bg-surface-5')} />}
            </div>
          ))}
        </div>

        {/* Step content */}
        <div className="px-5 py-4 min-h-[300px]">
          {step === 1 && <Step1 form={form} update={update} providers={providers} labRuntimes={labRuntimes || []} localModels={localModels} />}
          {step === 2 && <Step2 form={form} update={update} />}
          {step === 3 && <Step3 form={form} update={update} />}
          {step === 4 && (
            <Step4
              form={form}
              update={update}
              gateways={availableGateways}
              integrations={availableIntegrations}
            />
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border-subtle flex items-center justify-between">
          <div>
            {step > 1 && (
              <Button variant="ghost" size="sm" onClick={() => setStep(step - 1)} className="gap-1">
                <ChevronLeft size={12} /> Back
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={close}>Cancel</Button>
            {step < 4 ? (
              <Button variant="primary" size="sm" disabled={!canProceed()} onClick={() => setStep(step + 1)} className="gap-1">
                Next <ChevronRight size={12} />
              </Button>
            ) : (
              <Button variant="primary" size="sm" disabled={!canProceed()} onClick={handleSubmit}>
                {isEditing ? 'Save' : 'Create'}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Step 1: Name + Team Type ────────────────────────────────────

const RUNTIME_TYPE_LABELS = {
  ollama: 'Ollama', vllm: 'vLLM', 'llama-cpp': 'llama.cpp',
  mlx: 'MLX', tgi: 'TGI', 'openai-compatible': 'OpenAI Compatible',
};

function Step1({ form, update, providers, labRuntimes, localModels }) {
  const isLocal = form.provider === 'local';
  const selectedProvider = providers.find((p) => p.id === form.provider);
  const availableModels = isLocal ? (localModels || []) : (selectedProvider?.models || []);
  const selectedRuntime = isLocal ? labRuntimes.find((r) => r.id === form.runtimeId) : null;

  return (
    <div className="space-y-4">
      <Input
        label="Name"
        placeholder="Morning briefing"
        value={form.name}
        onChange={(e) => update({ name: e.target.value })}
      />
      <Input
        label="Description (optional)"
        placeholder="Check email, calendar, and write a daily summary"
        value={form.description}
        onChange={(e) => update({ description: e.target.value })}
      />
      <div className="space-y-2">
        <label className="text-xs font-medium text-text-2 font-sans">Team Type</label>
        <div className="grid grid-cols-2 gap-2">
          {TEAM_TYPES.map((t) => (
            <button
              key={t.id}
              onClick={() => update({ teamType: t.id })}
              className={cn(
                'flex items-center gap-3 p-3 rounded-md border text-left transition-colors cursor-pointer',
                form.teamType === t.id
                  ? 'border-accent bg-accent/5'
                  : 'border-border-subtle bg-surface-0 hover:border-border hover:bg-surface-2',
              )}
            >
              <t.icon size={16} className={cn(form.teamType === t.id ? 'text-accent' : 'text-text-3')} />
              <div className="min-w-0">
                <div className="text-xs font-semibold text-text-0 font-sans">{t.label}</div>
                <div className="text-2xs text-text-3 font-sans">{t.description}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {form.teamType === 'solo' && (
        <Select value={form.soloRole} onValueChange={(v) => update({ soloRole: v })}>
          <SelectTrigger placeholder="Select role" />
          <SelectContent>
            {ALL_ROLES.map((r) => (
              <SelectItem key={r} value={r}>{roleLabel(r)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {form.teamType === 'dev' && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-text-2 font-sans">Roles</label>
          {DEV_ROLES.map((r, i) => (
            <div key={i} className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-surface-0 border border-border-subtle">
              <Badge variant="default" className="text-2xs">{roleLabel(r.role)}</Badge>
              <div className="flex-1" />
              <span className="text-2xs font-mono text-text-4">Phase {r.phase}</span>
            </div>
          ))}
        </div>
      )}

      {form.teamType === 'business' && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-text-2 font-sans">Roles</label>
          {BUSINESS_ROLES.map((r, i) => (
            <div key={i} className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-surface-0 border border-border-subtle">
              <Badge variant="default" className="text-2xs">{roleLabel(r.role)}</Badge>
              <div className="flex-1" />
              <span className="text-2xs font-mono text-text-4">Phase {r.phase}</span>
            </div>
          ))}
        </div>
      )}

      {form.teamType === 'custom' && (
        <div className="space-y-2">
          <label className="text-xs font-medium text-text-2 font-sans">Roles</label>
          {form.customRoles.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <Select value={r.role} onValueChange={(v) => updateCustomRole(form, update, i, { role: v })}>
                <SelectTrigger placeholder="Role" className="flex-1" />
                <SelectContent>
                  {ALL_ROLES.map((role) => (
                    <SelectItem key={role} value={role}>{roleLabel(role)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <button
                onClick={() => updateCustomRole(form, update, i, { phase: r.phase === 1 ? 2 : 1 })}
                className={cn(
                  'h-8 px-2.5 rounded-md text-2xs font-mono border transition-colors cursor-pointer',
                  r.phase === 1
                    ? 'border-accent/30 text-accent bg-accent/5'
                    : 'border-border text-text-3 bg-surface-0',
                )}
              >
                P{r.phase}
              </button>
              <button
                onClick={() => {
                  const updated = form.customRoles.filter((_, idx) => idx !== i);
                  update({ customRoles: updated.length > 0 ? updated : [{ role: 'fullstack', phase: 1 }] });
                }}
                className="p-1.5 text-text-4 hover:text-danger rounded transition-colors cursor-pointer"
              >
                <X size={12} />
              </button>
            </div>
          ))}
          <Button variant="ghost" size="sm" onClick={() => update({ customRoles: [...form.customRoles, { role: 'fullstack', phase: 1 }] })} className="gap-1 text-2xs">
            <Plus size={10} /> Add Role
          </Button>
        </div>
      )}

      {form.teamType && (
        <div className="space-y-2">
          <label className="text-xs font-medium text-text-2 font-sans">Provider & Model</label>
          <div className={cn('grid gap-3', isLocal ? 'grid-cols-3' : 'grid-cols-2')}>
            {/* Provider */}
            <div className="relative">
              <select
                value={form.provider}
                onChange={(e) => update({ provider: e.target.value, model: '', runtimeId: '' })}
                className="w-full h-8 px-3 pr-8 text-sm rounded-md bg-surface-1 border border-border text-text-0 font-sans appearance-none cursor-pointer focus:outline-none focus:ring-1 focus:ring-accent"
              >
                <option value="">Auto</option>
                {providers.filter((p) => p.authType !== 'local').map((p) => (
                  <option key={p.id} value={p.id} disabled={p.authType === 'api-key' ? !(p.installed && p.hasKey) : !p.installed}>
                    {p.name}{!p.installed ? ' (Not installed)' : (p.authType === 'api-key' && !p.hasKey) ? ' (No API key)' : ''}
                  </option>
                ))}
                <option value="local">Local Model</option>
              </select>
              <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-3 pointer-events-none" />
            </div>

            {/* Model */}
            <div className="relative">
              <select
                value={form.model}
                onChange={(e) => update({ model: e.target.value })}
                disabled={!form.provider}
                className="w-full h-8 px-3 pr-8 text-sm rounded-md bg-surface-1 border border-border text-text-0 font-sans appearance-none cursor-pointer focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-40"
              >
                <option value="">Auto</option>
                {availableModels.map((m) => (
                  <option key={m.id} value={m.id}>{m.name || m.id}</option>
                ))}
              </select>
              <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-3 pointer-events-none" />
            </div>

            {/* Runtime (local only) */}
            {isLocal && (
              <div className="relative">
                <select
                  value={form.runtimeId}
                  onChange={(e) => update({ runtimeId: e.target.value })}
                  className="w-full h-8 px-3 pr-8 text-sm rounded-md bg-surface-1 border border-border text-text-0 font-sans appearance-none cursor-pointer focus:outline-none focus:ring-1 focus:ring-accent"
                >
                  <option value="">Select runtime</option>
                  {labRuntimes.map((rt) => (
                    <option key={rt.id} value={rt.id}>
                      {rt.name || RUNTIME_TYPE_LABELS[rt.type] || rt.type}
                      {rt.status === 'connected' ? '' : ' (offline)'}
                    </option>
                  ))}
                </select>
                <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-3 pointer-events-none" />
              </div>
            )}
          </div>

          {isLocal && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-warning/8 border border-warning/20">
              <AlertTriangle size={13} className="text-warning flex-shrink-0 mt-0.5" />
              <span className="text-2xs font-sans text-text-2">
                Make sure your runtime{selectedRuntime ? ` (${selectedRuntime.name || RUNTIME_TYPE_LABELS[selectedRuntime.type] || selectedRuntime.type})` : ''} is running when this automation fires.
              </span>
            </div>
          )}

          {isLocal && labRuntimes.length === 0 && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-surface-4 border border-border-subtle">
              <span className="text-2xs font-sans text-text-3">
                No runtimes configured. Set one up in the Model Lab tab first.
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function updateCustomRole(form, update, idx, patch) {
  update({
    customRoles: form.customRoles.map((r, i) => i === idx ? { ...r, ...patch } : r),
  });
}

// ── Step 2: Instructions ────────────────────────────────────────

function Step2({ form, update }) {
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex gap-1">
        <button
          onClick={() => update({ instructionMode: 'write' })}
          className={cn(
            'px-3 py-1.5 text-xs font-sans rounded-md transition-colors cursor-pointer',
            form.instructionMode === 'write'
              ? 'bg-accent/10 text-accent border border-accent/30'
              : 'text-text-3 border border-border-subtle hover:text-text-1',
          )}
        >
          Write instructions
        </button>
        <button
          onClick={() => update({ instructionMode: 'file' })}
          className={cn(
            'px-3 py-1.5 text-xs font-sans rounded-md transition-colors cursor-pointer',
            form.instructionMode === 'file'
              ? 'bg-accent/10 text-accent border border-accent/30'
              : 'text-text-3 border border-border-subtle hover:text-text-1',
          )}
        >
          Reference a document
        </button>
      </div>

      {form.instructionMode === 'write' ? (
        <div className="space-y-2">
          <Textarea
            mono
            value={form.instructions}
            onChange={(e) => update({ instructions: e.target.value })}
            placeholder={'Describe what this team should do...\n\nExample: Check my Gmail inbox for important emails.\n[read] #daily-briefing-template\nSummarize action items.'}
            className="min-h-[120px]"
            rows={8}
          />
          <MemoryBadges text={form.instructions} />
          <p className="text-2xs text-text-4 font-sans">Use <span className="font-mono text-teal-400">[read] #tag</span> to include a memory</p>
        </div>
      ) : (
        <div className="space-y-3">
          <label className="text-xs font-medium text-text-2 font-sans">Instruction file</label>
          <div className="flex items-center gap-2">
            <div className="flex-1 flex items-center gap-2.5 px-3 py-2.5 rounded-md bg-surface-0 border border-border-subtle min-h-[40px]">
              {form.filePath ? (
                <>
                  <File size={13} className="text-accent flex-shrink-0" />
                  <span className="text-xs font-mono text-text-1 truncate flex-1">{form.filePath}</span>
                  <button
                    onClick={() => update({ filePath: '' })}
                    className="p-0.5 text-text-4 hover:text-text-2 cursor-pointer"
                  >
                    <X size={11} />
                  </button>
                </>
              ) : (
                <span className="text-xs font-sans text-text-4">No file selected</span>
              )}
            </div>
            <Button variant="ghost" size="sm" onClick={() => setPickerOpen(true)} className="gap-1.5 flex-shrink-0">
              <Folder size={12} /> Browse
            </Button>
          </div>
          <Input
            mono
            value={form.filePath}
            onChange={(e) => update({ filePath: e.target.value })}
            placeholder="/path/to/instructions.md"
          />
          <p className="text-2xs text-text-4 font-sans">Select a markdown, text, or any file with instructions for the team</p>
          <FilePicker
            open={pickerOpen}
            onOpenChange={setPickerOpen}
            onSelect={(path) => update({ filePath: path })}
          />
        </div>
      )}
    </div>
  );
}

// ── Step 3: Schedule ────────────────────────────────────────────

function Step3({ form, update }) {
  const isPreset = form.scheduleMode === 'preset' && form.cronPreset;
  const isSimple = form.scheduleMode === 'simple';
  const cronVal = isPreset
    ? form.cronPreset
    : simpleToCron(form.scheduleCount, form.scheduleUnit);
  const label = isSimple ? simpleToCronLabel(form.scheduleCount, form.scheduleUnit) : null;

  return (
    <div className="space-y-5">
      {/* Mode toggle */}
      <div className="flex gap-1">
        <button
          onClick={() => update({ scheduleMode: 'preset', cronPreset: form.cronPreset })}
          className={cn(
            'px-3 py-1.5 text-xs font-sans rounded-md transition-colors cursor-pointer',
            form.scheduleMode === 'preset'
              ? 'bg-accent/10 text-accent border border-accent/30'
              : 'text-text-3 border border-border-subtle hover:text-text-1',
          )}
        >
          Preset
        </button>
        <button
          onClick={() => update({ scheduleMode: 'simple', cronPreset: null })}
          className={cn(
            'px-3 py-1.5 text-xs font-sans rounded-md transition-colors cursor-pointer',
            form.scheduleMode === 'simple'
              ? 'bg-accent/10 text-accent border border-accent/30'
              : 'text-text-3 border border-border-subtle hover:text-text-1',
          )}
        >
          Custom
        </button>
      </div>

      {form.scheduleMode === 'preset' ? (
        <div className="grid grid-cols-2 gap-2">
          {CRON_PRESETS.map((preset) => (
            <button
              key={preset.cron}
              onClick={() => update({ cronPreset: preset.cron })}
              className={cn(
                'p-3 rounded-md border text-left transition-colors cursor-pointer',
                form.cronPreset === preset.cron
                  ? 'border-accent bg-accent/5'
                  : 'border-border-subtle bg-surface-0 hover:border-border hover:bg-surface-2',
              )}
            >
              <div className="text-xs font-semibold text-text-0 font-sans">{preset.label}</div>
              <div className="text-2xs text-text-3 font-sans mt-0.5">{preset.description}</div>
            </button>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-3 p-4 rounded-lg bg-surface-0 border border-border-subtle">
            <span className="text-xs font-sans text-text-2">Every</span>
            <input
              type="text"
              inputMode="numeric"
              value={form.scheduleCount}
              onChange={(e) => {
                const raw = e.target.value.replace(/\D/g, '');
                update({ scheduleCount: raw === '' ? '' : parseInt(raw, 10) });
              }}
              onBlur={() => {
                if (!form.scheduleCount || form.scheduleCount < 1) update({ scheduleCount: 1 });
              }}
              className="w-16 h-8 px-2 text-center text-sm font-mono rounded-md bg-surface-2 border border-border text-text-0 focus:border-accent focus:outline-none"
            />
            <div className="flex gap-1">
              {SCHEDULE_UNITS.map((u) => (
                <button
                  key={u.value}
                  onClick={() => update({ scheduleUnit: u.value })}
                  className={cn(
                    'px-3 py-1.5 text-xs font-sans rounded-md border transition-colors cursor-pointer',
                    form.scheduleUnit === u.value
                      ? 'border-accent bg-accent/10 text-accent'
                      : 'border-border-subtle text-text-3 hover:text-text-1 hover:border-border',
                  )}
                >
                  {u.label}
                </button>
              ))}
            </div>
          </div>

          {label && cronVal && (
            <div className="flex items-center gap-1.5 px-1">
              <Clock size={11} className="text-accent" />
              <span className="text-xs text-accent font-sans">{label}</span>
              <span className="text-2xs text-text-4 font-mono ml-auto">{cronVal}</span>
            </div>
          )}
        </div>
      )}

      {/* Enabled toggle */}
      <div className="flex items-center gap-3 pt-2">
        <button
          onClick={() => update({ enabledOnCreate: !form.enabledOnCreate })}
          className={cn(
            'w-8 h-4.5 rounded-full relative transition-colors cursor-pointer',
            form.enabledOnCreate ? 'bg-accent' : 'bg-surface-5',
          )}
        >
          <div className={cn(
            'absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white transition-transform',
            form.enabledOnCreate ? 'translate-x-4' : 'translate-x-0.5',
          )} />
        </button>
        <span className="text-xs text-text-1 font-sans">Enabled on creation</span>
      </div>
    </div>
  );
}

// ── Step 4: Output ──────────────────────────────────────────────

function Step4({ form, update, gateways, integrations }) {
  const [outputPickerOpen, setOutputPickerOpen] = useState(false);

  function toggleGateway(id) {
    const ids = form.gatewayIds.includes(id)
      ? form.gatewayIds.filter((g) => g !== id)
      : [...form.gatewayIds, id];
    update({ gatewayIds: ids });
  }

  function toggleIntegration(id) {
    const ids = form.integrationIds.includes(id)
      ? form.integrationIds.filter((i) => i !== id)
      : [...form.integrationIds, id];
    update({ integrationIds: ids });
  }

  return (
    <div className="space-y-5">
      {/* Gateways */}
      {gateways.length > 0 && (
        <Collapsible title="Chat Gateways" icon={MessageSquare} defaultOpen={form.gatewayIds.length > 0} badge={gateways.length}>
          <div className="space-y-1.5">
            {gateways.map((gw) => (
              <label
                key={gw.id}
                className="flex items-center gap-3 px-3 py-2 rounded-md bg-surface-0 border border-border-subtle cursor-pointer hover:bg-surface-2 transition-colors"
              >
                <input
                  type="checkbox"
                  checked={form.gatewayIds.includes(gw.id)}
                  onChange={() => toggleGateway(gw.id)}
                  className="rounded accent-accent"
                />
                <span className="text-xs font-sans text-text-0">{gw.name || gw.platform || gw.id}</span>
                <Badge variant={gw.connected ? 'success' : 'default'} className="text-2xs ml-auto">
                  {gw.connected ? 'Connected' : 'Offline'}
                </Badge>
              </label>
            ))}
          </div>
        </Collapsible>
      )}

      {/* Save to file */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-text-2 font-sans flex items-center gap-1.5">
          <Save size={11} /> Save results to file
        </label>
        <div className="flex items-center gap-2">
          <div className="flex-1 flex items-center gap-2.5 px-3 py-2 rounded-md bg-surface-0 border border-border-subtle min-h-[36px]">
            {form.outputFilePath ? (
              <>
                <File size={12} className="text-accent flex-shrink-0" />
                <span className="text-xs font-mono text-text-1 truncate flex-1">{form.outputFilePath}</span>
                <button
                  onClick={() => update({ outputFilePath: '' })}
                  className="p-0.5 text-text-4 hover:text-text-2 cursor-pointer"
                >
                  <X size={11} />
                </button>
              </>
            ) : (
              <span className="text-xs font-sans text-text-4">Optional — choose a file to save output</span>
            )}
          </div>
          <Button variant="ghost" size="sm" onClick={() => setOutputPickerOpen(true)} className="gap-1 flex-shrink-0 text-2xs">
            <Folder size={11} /> Browse
          </Button>
        </div>
        <Input
          mono
          value={form.outputFilePath}
          onChange={(e) => update({ outputFilePath: e.target.value })}
          placeholder="/path/to/output.md"
        />
        <FilePicker
          open={outputPickerOpen}
          onOpenChange={setOutputPickerOpen}
          onSelect={(path) => update({ outputFilePath: path })}
          allowCreate
        />
      </div>

      {/* Custom output instructions */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-text-2 font-sans">Custom output instructions</label>
        <Textarea
          mono
          value={form.outputCustom}
          onChange={(e) => update({ outputCustom: e.target.value })}
          placeholder={'Optional — tell the agent how to deliver results.\n\nExamples:\n• Email me a summary at ryan@example.com\n• Use the Twilio API to send me a text\n• [read] #output-template\n• Create a PR with the changes'}
          className="min-h-[80px]"
          rows={4}
        />
        <MemoryBadges text={form.outputCustom} />
        <p className="text-2xs text-text-4 font-sans">
          Free-form instructions — works with any API or service. Use <span className="font-mono text-teal-400">[read] #tag</span> to include a memory.
        </p>
      </div>

      {/* Notification timing */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-text-2 font-sans">Notify when</label>
        <div className="flex gap-2">
          {[
            { value: 'always', label: 'Every run' },
            { value: 'error', label: 'Only on errors' },
            { value: 'complete', label: 'On completion' },
          ].map((opt) => (
            <button
              key={opt.value}
              onClick={() => update({ notifyOn: opt.value })}
              className={cn(
                'px-3 py-1.5 text-xs font-sans rounded-md border transition-colors cursor-pointer',
                form.notifyOn === opt.value
                  ? 'border-accent bg-accent/5 text-accent'
                  : 'border-border-subtle text-text-3 hover:text-text-1',
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Integrations */}
      {integrations.length > 0 && (
        <Collapsible title="Integrations" icon={Package} badge={integrations.length}>
          <div className="space-y-1.5">
            {integrations.map((intg) => (
              <label
                key={intg.id}
                className="flex items-center gap-3 px-3 py-2 rounded-md bg-surface-0 border border-border-subtle cursor-pointer hover:bg-surface-2 transition-colors"
              >
                <input
                  type="checkbox"
                  checked={form.integrationIds.includes(intg.id)}
                  onChange={() => toggleIntegration(intg.id)}
                  className="rounded accent-accent"
                />
                <span className="text-xs font-sans text-text-0">{intg.name || intg.id}</span>
              </label>
            ))}
          </div>
        </Collapsible>
      )}
    </div>
  );
}

// ── File Picker ─────────────────────────────────────────────────

function FilePicker({ open, onOpenChange, onSelect, allowCreate }) {
  const [root, setRoot] = useState('');
  const [currentPath, setCurrentPath] = useState('');
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [newFileName, setNewFileName] = useState('');

  useEffect(() => {
    if (open) {
      setNewFileName('');
      setError(null);
      api.get('/files/root').then((data) => {
        setRoot(data.root || '');
        loadTree('');
      }).catch(() => setError('Could not load project files'));
    }
  }, [open]);

  async function loadTree(relPath) {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get(`/files/tree?path=${encodeURIComponent(relPath)}`);
      setCurrentPath(relPath);
      setEntries(data.entries || []);
    } catch (err) {
      setError(err.message);
      setEntries([]);
    }
    setLoading(false);
  }

  function selectFile(entry) {
    const abs = root + '/' + entry.path;
    onSelect(abs);
    onOpenChange(false);
  }

  function selectNew() {
    if (!newFileName.trim()) return;
    const rel = currentPath ? currentPath + '/' + newFileName.trim() : newFileName.trim();
    const abs = root + '/' + rel;
    onSelect(abs);
    onOpenChange(false);
  }

  const breadcrumbs = currentPath ? currentPath.split('/') : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Select File" description="Browse project files" className="max-w-[520px]">
        <div className="px-5 py-4 space-y-3">
          {/* Breadcrumb navigation */}
          <div className="flex items-center gap-1 min-w-0 overflow-x-auto py-1 scrollbar-none">
            <button
              onClick={() => loadTree('')}
              className="flex-shrink-0 p-1 rounded hover:bg-surface-5 cursor-pointer text-text-3 hover:text-text-0 transition-colors"
            >
              <HardDrive size={13} />
            </button>
            {breadcrumbs.map((part, i) => {
              const pathTo = breadcrumbs.slice(0, i + 1).join('/');
              return (
                <div key={i} className="flex items-center gap-0.5 flex-shrink-0">
                  <ChevronRight size={11} className="text-text-4" />
                  <button
                    onClick={() => loadTree(pathTo)}
                    className={cn(
                      'px-1.5 py-0.5 rounded text-xs font-mono cursor-pointer transition-colors',
                      i === breadcrumbs.length - 1
                        ? 'text-text-0 bg-surface-4 font-medium'
                        : 'text-text-3 hover:text-text-0 hover:bg-surface-5',
                    )}
                  >
                    {part}
                  </button>
                </div>
              );
            })}
          </div>

          {/* Up button */}
          {currentPath && (
            <button
              onClick={() => {
                const parent = breadcrumbs.slice(0, -1).join('/');
                loadTree(parent);
              }}
              className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-text-3 hover:text-text-0 hover:bg-surface-4 transition-colors cursor-pointer"
            >
              <ArrowUp size={12} /> Up
            </button>
          )}

          {/* File listing */}
          <div className="bg-surface-0 rounded-lg border border-border-subtle overflow-hidden">
            <div className="max-h-[280px] overflow-y-auto">
              {loading && (
                <div className="flex items-center justify-center py-8">
                  <Loader2 size={18} className="text-text-3 animate-spin" />
                </div>
              )}
              {error && (
                <div className="px-4 py-6 text-center">
                  <p className="text-xs text-danger font-sans">{error}</p>
                </div>
              )}
              {!loading && !error && entries.length === 0 && (
                <div className="px-4 py-6 text-center">
                  <p className="text-xs text-text-3 font-sans">Empty directory</p>
                </div>
              )}
              {!loading && !error && entries.map((entry) => (
                <button
                  key={entry.path}
                  onClick={() => entry.type === 'dir' ? loadTree(entry.path) : selectFile(entry)}
                  className={cn(
                    'w-full flex items-center gap-2.5 px-3.5 py-2 text-left cursor-pointer',
                    'hover:bg-surface-4 transition-colors border-b border-border-subtle last:border-0',
                  )}
                >
                  {entry.type === 'dir'
                    ? <FolderClosed size={14} className="text-warning flex-shrink-0" />
                    : <File size={14} className="text-text-3 flex-shrink-0" />
                  }
                  <span className="text-xs text-text-0 font-sans truncate flex-1">{entry.name}</span>
                  {entry.type === 'dir' && entry.hasChildren && (
                    <ChevronRight size={11} className="text-text-4 flex-shrink-0" />
                  )}
                  {entry.type === 'file' && entry.size != null && (
                    <span className="text-2xs font-mono text-text-4 flex-shrink-0">
                      {entry.size > 1024 ? `${(entry.size / 1024).toFixed(1)}K` : `${entry.size}B`}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Create new file */}
          {allowCreate && (
            <div className="flex items-center gap-2">
              <Input
                mono
                value={newFileName}
                onChange={(e) => setNewFileName(e.target.value)}
                placeholder="new-file.md"
                className="flex-1"
              />
              <Button variant="ghost" size="sm" onClick={selectNew} disabled={!newFileName.trim()} className="gap-1 text-2xs flex-shrink-0">
                <Plus size={10} /> Create
              </Button>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
