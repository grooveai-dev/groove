// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useEffect } from 'react';
import { useGrooveStore } from '../../stores/groove';
import { cn } from '../../lib/cn';
import { Button } from '../ui/button';
import { Select, SelectTrigger, SelectContent, SelectItem } from '../ui/select';
import { TuningSlider } from '../ui/slider';
import {
  Rocket, X, ChevronDown, Settings2, Zap, Shield, Server, Monitor, Code2, TestTube, Cpu, Activity, Gauge,
} from 'lucide-react';

const ROLE_ICONS = { backend: Server, frontend: Monitor, fullstack: Code2, testing: TestTube, security: Shield };
const PROVIDER_TEMP_SUPPORT = new Set(['codex', 'grok', 'local']);
const NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;

function sanitizeName(raw) {
  return raw.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
}

export function RecommendedTeamCard() {
  const recommendedTeam = useGrooveStore((s) => s.recommendedTeam);
  const launchRecommendedTeam = useGrooveStore((s) => s.launchRecommendedTeam);
  const teamLaunchConfig = useGrooveStore((s) => s.teamLaunchConfig);
  const fetchProviders = useGrooveStore((s) => s.fetchProviders);
  const [launching, setLaunching] = useState(false);
  const [editedAgents, setEditedAgents] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [providers, setProviders] = useState([]);

  const [tsProvider, setTsProvider] = useState(teamLaunchConfig?.provider || '');
  const [tsModel, setTsModel] = useState(teamLaunchConfig?.model || '');
  const [tsReasoning, setTsReasoning] = useState(teamLaunchConfig?.reasoningEffort ?? 50);
  const [tsTemp, setTsTemp] = useState(teamLaunchConfig?.temperature ?? 0.5);
  const [expandedAgent, setExpandedAgent] = useState(null);

  useEffect(() => {
    fetchProviders().then((list) => {
      if (Array.isArray(list)) setProviders(list.filter((p) => p.installed));
    }).catch(() => {});
  }, []);

  if (!recommendedTeam?.agents?.length) return null;

  const agents = recommendedTeam.agents;
  const phase1 = agents.filter((a) => !a.phase || a.phase === 1);
  const phase2 = agents.filter((a) => a.phase === 2);

  const agentEdits = editedAgents ?? phase1.map((a) => ({ ...a, name: a.name || '' }));

  const selectedProvider = providers.find((p) => p.id === tsProvider);
  const tsModels = (selectedProvider?.models || []).filter((m) => m.type !== 'image' && !m.disabled);
  const showTemp = PROVIDER_TEMP_SUPPORT.has(tsProvider);

  function handleNameChange(i, raw) {
    const next = agentEdits.map((a, idx) => idx === i ? { ...a, name: sanitizeName(raw) } : a);
    setEditedAgents(next);
  }

  function handleAgentField(i, updates) {
    if (typeof updates === 'string') {
      const [field, value] = [updates, arguments[2]];
      setEditedAgents((prev) => (prev ?? agentEdits).map((a, idx) => idx === i ? { ...a, [field]: value } : a));
    } else {
      setEditedAgents((prev) => (prev ?? agentEdits).map((a, idx) => idx === i ? { ...a, ...updates } : a));
    }
  }

  function handleTsProviderChange(id) {
    setTsProvider(id);
    const p = providers.find((x) => x.id === id);
    const pModels = (p?.models || []).filter((m) => m.type !== 'image' && !m.disabled);
    setTsModel(pModels[0]?.id || '');
  }

  async function handleLaunch() {
    setLaunching(true);
    useGrooveStore.setState({
      teamLaunchConfig: {
        ...(tsProvider && { provider: tsProvider, model: tsModel }),
        reasoningEffort: tsReasoning,
        ...(showTemp && { temperature: tsTemp }),
      },
    });
    try {
      const modified = [...agentEdits, ...phase2];
      await launchRecommendedTeam(modified);
    } catch { /* toast handles */ }
    setLaunching(false);
  }

  function handleDismiss() {
    useGrooveStore.setState({ recommendedTeam: null });
  }

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-50 w-full max-w-lg">
      <div className="mx-4 rounded-lg border border-accent/30 bg-surface-2/95 backdrop-blur-md shadow-xl shadow-accent/5 overflow-hidden">
        <div className="px-4 py-3 border-b border-border-subtle flex items-center gap-2">
          <Rocket size={16} className="text-accent" />
          <span className="text-sm font-semibold text-text-0 font-sans flex-1">Planner Recommends a Team</span>
          <button onClick={handleDismiss} className="text-text-4 hover:text-text-1 cursor-pointer"><X size={14} /></button>
        </div>

        {/* Collapsible Team Settings */}
        <div className="border-b border-border-subtle">
          <button
            onClick={() => setSettingsOpen(!settingsOpen)}
            className="w-full flex items-center gap-2 px-4 py-2 text-left cursor-pointer hover:bg-surface-3/50 transition-colors"
          >
            <ChevronDown size={12} className={cn('text-text-4 transition-transform duration-200', !settingsOpen && '-rotate-90')} />
            <Settings2 size={12} className="text-text-3" />
            <span className="text-2xs font-semibold text-text-2 font-sans uppercase tracking-wider">Team Settings</span>
            {tsProvider && (
              <span className="ml-auto text-2xs text-accent font-mono">{tsProvider}{tsModel ? ` / ${tsModel}` : ''}</span>
            )}
          </button>
          {settingsOpen && (
            <div className="px-4 pb-3 space-y-3">
              <div className="flex gap-3">
                <div className="flex-1 space-y-1">
                  <label className="text-2xs text-text-3 font-sans">Provider</label>
                  <Select value={tsProvider} onValueChange={handleTsProviderChange}>
                    <SelectTrigger placeholder="Default" className="bg-surface-4 h-7 text-xs" />
                    <SelectContent>
                      {providers.map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.displayName || p.name || p.id}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex-1 space-y-1">
                  <label className="text-2xs text-text-3 font-sans">Model</label>
                  <Select value={tsModel} onValueChange={setTsModel}>
                    <SelectTrigger placeholder="Auto" className="bg-surface-4 h-7 text-xs" />
                    <SelectContent>
                      <SelectItem value="auto">Auto</SelectItem>
                      {tsModels.map((m) => (
                        <SelectItem key={m.id} value={m.id}>{m.name || m.id}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <TuningSlider
                label="Reasoning"
                value={tsReasoning}
                onChange={setTsReasoning}
                min={0} max={100} step={1}
              />
              {showTemp && (
                <TuningSlider
                  label="Temperature"
                  value={tsTemp}
                  onChange={setTsTemp}
                  min={0} max={1} step={0.01}
                  formatValue={(v) => v.toFixed(2)}
                />
              )}
            </div>
          )}
        </div>

        <div className="px-4 py-3 space-y-1.5">
          {agentEdits.map((a, i) => {
            const Icon = ROLE_ICONS[a.role] || Code2;
            const nameValid = !a.name || NAME_RE.test(a.name);
            const isExpanded = expandedAgent === i;
            const agentProvider = providers.find((p) => p.id === (a.provider || tsProvider));
            const agentModels = (agentProvider?.models || []).filter((m) => m.type !== 'image' && !m.disabled);
            return (
              <div key={i} className="rounded-md bg-surface-4 border border-border-subtle overflow-hidden">
                <div
                  className="flex items-center gap-2 px-2.5 py-1.5 cursor-pointer hover:bg-surface-5/50 transition-colors"
                  onClick={() => setExpandedAgent(isExpanded ? null : i)}
                >
                  <Icon size={12} className="text-text-2 shrink-0" />
                  <input
                    type="text"
                    value={a.name}
                    onChange={(e) => handleNameChange(i, e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    placeholder={a.role}
                    className={cn(
                      'flex-1 min-w-0 bg-transparent text-xs font-mono text-text-0 outline-none placeholder:text-text-4',
                      !nameValid && 'text-red-400',
                    )}
                    maxLength={64}
                    spellCheck={false}
                  />
                  {a.provider && a.provider !== tsProvider && (
                    <span className="text-2xs text-accent font-mono shrink-0">{a.provider}</span>
                  )}
                  {a.scope?.length > 0 && (
                    <span className="text-2xs text-text-4 font-mono shrink-0 truncate max-w-[120px]">
                      {a.scope[0]}{a.scope.length > 1 ? ` +${a.scope.length - 1}` : ''}
                    </span>
                  )}
                  <ChevronDown size={10} className={cn('text-text-4 shrink-0 transition-transform duration-200', !isExpanded && '-rotate-90')} />
                </div>
                {isExpanded && (
                  <div className="px-2.5 pb-2.5 pt-1 space-y-2.5 border-t border-border-subtle">
                    <div className="flex gap-2">
                      <div className="flex-1 space-y-1">
                        <label className="flex items-center gap-1 text-2xs text-text-3 font-sans"><Cpu size={10} />Provider</label>
                        <Select value={a.provider || ''} onValueChange={(id) => {
                          const p = providers.find((x) => x.id === id);
                          const pModels = (p?.models || []).filter((m) => m.type !== 'image' && !m.disabled);
                          handleAgentField(i, { provider: id, model: pModels[0]?.id || '' });
                        }}>
                          <SelectTrigger placeholder="Team default" className="bg-surface-3 h-7 text-xs" />
                          <SelectContent>
                            <SelectItem value="">Team default</SelectItem>
                            {providers.map((p) => (
                              <SelectItem key={p.id} value={p.id}>{p.displayName || p.name || p.id}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex-1 space-y-1">
                        <label className="text-2xs text-text-3 font-sans">Model</label>
                        <Select value={a.model || ''} onValueChange={(v) => handleAgentField(i, 'model', v)}>
                          <SelectTrigger placeholder="Auto" className="bg-surface-3 h-7 text-xs" />
                          <SelectContent>
                            <SelectItem value="">Auto</SelectItem>
                            {agentModels.map((m) => (
                              <SelectItem key={m.id} value={m.id}>{m.name || m.id}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="flex items-center gap-1 text-2xs text-text-3 font-sans"><Activity size={10} />Model Routing</label>
                      <div className="flex bg-surface-3 rounded-md p-0.5 border border-border-subtle">
                        {[{ value: 'fixed', label: 'Fixed' }, { value: 'auto', label: 'Auto' }, { value: 'auto-floor', label: 'Auto + Floor' }].map((opt) => (
                          <button
                            key={opt.value}
                            onClick={() => handleAgentField(i, 'routingMode', opt.value)}
                            className={cn(
                              'flex-1 px-2 py-1 text-2xs font-semibold font-sans rounded transition-all cursor-pointer',
                              (a.routingMode || 'auto') === opt.value
                                ? 'bg-accent/15 text-accent shadow-sm'
                                : 'text-text-3 hover:text-text-1',
                            )}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="flex items-center gap-1 text-2xs text-text-3 font-sans"><Gauge size={10} />Effort Level</label>
                      <div className="flex bg-surface-3 rounded-md p-0.5 border border-border-subtle">
                        {[{ value: 'min', label: 'Min' }, { value: 'low', label: 'Low' }, { value: 'default', label: 'Default' }, { value: 'high', label: 'High' }, { value: 'max', label: 'Max' }, { value: 'ultra', label: 'Ultra' }].map((opt) => (
                          <button
                            key={opt.value}
                            onClick={() => handleAgentField(i, 'effort', opt.value)}
                            className={cn(
                              'flex-1 px-1.5 py-1 text-2xs font-semibold font-sans rounded transition-all cursor-pointer',
                              (a.effort || 'default') === opt.value
                                ? 'bg-accent/15 text-accent shadow-sm'
                                : 'text-text-3 hover:text-text-1',
                            )}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {recommendedTeam.projectDir && (
            <div className="flex items-center gap-1.5 text-2xs text-text-2 font-mono pt-0.5">
              <span className="text-text-4">Project:</span>
              <span className="text-accent">{recommendedTeam.projectDir}/</span>
            </div>
          )}

          {phase2.length > 0 && (
            <div className="flex items-center gap-1.5 text-2xs text-text-3 font-sans">
              <Shield size={10} />
              <span>{phase2.length} QC agent{phase2.length > 1 ? 's' : ''} will auto-spawn after builders complete</span>
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-border-subtle">
          <Button variant="primary" size="md" onClick={handleLaunch} disabled={launching} className="w-full gap-2">
            <Zap size={14} />
            {launching ? 'Launching...' : `Launch ${phase1.length} Agent${phase1.length > 1 ? 's' : ''}`}
          </Button>
        </div>
      </div>
    </div>
  );
}
