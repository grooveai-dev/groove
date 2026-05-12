// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useEffect } from 'react';
import { useGrooveStore } from '../../stores/groove';
import { Sheet, SheetContent } from '../ui/sheet';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { cn } from '../../lib/cn';
import { roleColor } from '../../lib/status';
import {
  Server, Monitor, Code2, TestTube, Cloud, FileText,
  Shield, Database, Megaphone, Calculator, UserCheck,
  Headphones, BarChart3, Rocket, ChevronDown, Pen, Presentation,
  Sparkles, X, Search, AlertTriangle, Plug, MessageCircle, GitBranch, Globe,
  Check,
} from 'lucide-react';
import { api } from '../../lib/api';
import { Dialog, DialogContent } from '../ui/dialog';
import { INTEGRATION_LOGOS } from '../../lib/integration-logos';

const ROLE_PRESETS = [
  { id: 'chat',      label: 'Chat',       desc: 'Companion, assistant, conversation', icon: MessageCircle, tier: 'Medium' },
  { id: 'planner',   label: 'Planner',    desc: 'Plans the team and tasks',       icon: Rocket,     tier: 'Heavy' },
  { id: 'backend',   label: 'Backend',    desc: 'APIs, services, databases',       icon: Server,     tier: 'Medium' },
  { id: 'frontend',  label: 'Frontend',   desc: 'UI, components, styling',         icon: Monitor,    tier: 'Medium' },
  { id: 'fullstack', label: 'Fullstack',  desc: 'End-to-end implementation',       icon: Code2,      tier: 'Heavy' },
  { id: 'testing',   label: 'Testing',    desc: 'Tests, coverage, QA',             icon: TestTube,   tier: 'Medium' },
  { id: 'devops',    label: 'DevOps',     desc: 'CI/CD, infra, deployment',        icon: Cloud,      tier: 'Medium' },
  { id: 'docs',      label: 'Docs',       desc: 'Documentation, guides',           icon: FileText,   tier: 'Light' },
  { id: 'security',  label: 'Security',   desc: 'Audits, vulnerabilities',         icon: Shield,     tier: 'Medium' },
  { id: 'database',  label: 'Database',   desc: 'Schema, migrations, queries',     icon: Database,   tier: 'Medium' },
  { id: 'cmo',       label: 'CMO',        desc: 'Marketing, content, growth',      icon: Megaphone,  tier: 'Medium' },
  { id: 'cfo',       label: 'CFO',        desc: 'Finance, metrics, forecasting',   icon: Calculator, tier: 'Medium' },
  { id: 'ea',        label: 'EA',         desc: 'Executive assistant, scheduling', icon: UserCheck,  tier: 'Light' },
  { id: 'support',   label: 'Support',    desc: 'Customer support, FAQs',          icon: Headphones, tier: 'Medium' },
  { id: 'analyst',   label: 'Analyst',    desc: 'Data analysis, insights',         icon: BarChart3,  tier: 'Medium' },
  { id: 'creative',  label: 'Writer',     desc: 'Copy, articles, proposals',       icon: Pen,        tier: 'Heavy',  skillHint: true },
  { id: 'slides',    label: 'Slides',     desc: 'Pitch decks, presentations',      icon: Presentation, tier: 'Heavy', skillHint: true },
  { id: 'ambassador', label: 'Ambassador', desc: 'Bridge to federated server',     icon: Globe,        tier: 'Light' },
];

function CheckMark() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" className="text-accent flex-shrink-0">
      <circle cx="7" cy="7" r="6" fill="currentColor" fillOpacity="0.15" stroke="currentColor" strokeWidth="1" />
      <path d="M4.5 7 L6.5 9 L9.5 5.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SpawnWizard() {
  const detailPanel = useGrooveStore((s) => s.detailPanel);
  const closeDetail = useGrooveStore((s) => s.closeDetail);
  const spawnAgent = useGrooveStore((s) => s.spawnAgent);
  const fetchProviders = useGrooveStore((s) => s.fetchProviders);

  const open = detailPanel?.type === 'spawn';
  const [role, setRole] = useState('');
  const [customRole, setCustomRole] = useState('');
  const [name, setName] = useState('');
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [prompt, setPrompt] = useState('');
  const [providers, setProviders] = useState([]);
  const [installedIntegrations, setInstalledIntegrations] = useState([]);
  const [selectedIntegrations, setSelectedIntegrations] = useState([]);
  const [integrationModalOpen, setIntegrationModalOpen] = useState(false);
  const [integrationSearch, setIntegrationSearch] = useState('');
  const [integrationApproval, setIntegrationApproval] = useState('manual');
  const [importedRepos, setImportedRepos] = useState([]);
  const [selectedRepos, setSelectedRepos] = useState([]);
  const [repoModalOpen, setRepoModalOpen] = useState(false);
  const [repoSearch, setRepoSearch] = useState('');
  const [personalities, setPersonalities] = useState([]);
  const [selectedPersonality, setSelectedPersonality] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [spawning, setSpawning] = useState(false);
  const [selectedPeerId, setSelectedPeerId] = useState('');
  const [recommendations, setRecommendations] = useState([]);
  const [preflightDialog, setPreflightDialog] = useState(null);
  const [ollamaInstalled, setOllamaInstalled] = useState([]);
  const [ollamaServerRunning, setOllamaServerRunning] = useState(false);
  const federation = useGrooveStore((s) => s.federation);
  const ollamaRunningModels = useGrooveStore((s) => s.ollamaRunningModels);

  const selectedRole = role || customRole;
  const selectedProvider = providers.find((p) => p.id === provider);
  const availableModels = selectedProvider?.models || [];
  const installedProviders = providers.filter((p) => p.authType === 'api-key' ? (p.installed && p.hasKey) : p.installed);

  useEffect(() => {
    if (open) {
      const _presetProvider = detailPanel?.presetProvider || '';
      const _presetModel = detailPanel?.presetModel || '';

      fetchProviders().then((data) => {
        const list = Array.isArray(data) ? data : data.providers || [];
        setProviders(list);
        const installed = list.filter((p) => p.authType === 'api-key' ? (p.installed && p.hasKey) : p.installed);
        if (installed.length > 0 && !_presetProvider) {
          const priority = ['claude-code', 'gemini', 'codex', 'ollama'];
          const best = priority.find((pid) => installed.some((p) => p.id === pid)) || installed[0].id;
          setProvider(best);
        }
      }).catch(() => {});
      api.get('/integrations/installed').then((data) => {
        setInstalledIntegrations(Array.isArray(data) ? data : []);
      }).catch(() => {});
      api.get('/repos/imported').then((data) => {
        setImportedRepos((Array.isArray(data) ? data : []).filter((r) => r.status === 'active'));
      }).catch(() => {});
      api.get('/personalities').then((data) => {
        setPersonalities(Array.isArray(data) ? data : data.personalities || []);
      }).catch(() => {});
      setRole(''); setCustomRole(''); setName('');
      setProvider(_presetProvider); setModel(_presetModel);
      setPrompt('');
      setSelectedIntegrations([]);
      setIntegrationApproval('manual');
      setSelectedRepos([]);
      setSelectedPersonality('');
      setSelectedPeerId('');
      setShowAdvanced(false);
      setRecommendations([]);
      setPreflightDialog(null);
    }
  }, [open, fetchProviders]);

  useEffect(() => {
    if (!selectedRole || !open) { setRecommendations([]); return; }
    api.get(`/roles/integrations?role=${encodeURIComponent(selectedRole)}`).then((data) => {
      const recs = Array.isArray(data) ? data : data?.recommendations || [];
      setRecommendations(recs);
      const autoSelect = recs
        .filter((r) => r.installed && r.configured && r.authenticated)
        .map((r) => r.id);
      if (autoSelect.length > 0) {
        setSelectedIntegrations((prev) => [...new Set([...prev, ...autoSelect])]);
      }
    }).catch(() => setRecommendations([]));
  }, [selectedRole, open]);

  useEffect(() => {
    if (!open || provider !== 'ollama') { setOllamaInstalled([]); return; }
    api.get('/providers/ollama/models').then((data) => {
      setOllamaInstalled(data.installed || []);
    }).catch(() => setOllamaInstalled([]));
    api.post('/providers/ollama/check').then((data) => {
      setOllamaServerRunning(data.serverRunning);
    }).catch(() => setOllamaServerRunning(false));
  }, [open, provider]);

  async function runSpawn() {
    setSpawning(true);
    try {
      const config = {
        role: selectedRole,
        ...(name && { name: name.replace(/\s+/g, '-') }),
        ...(provider && { provider }),
        ...(model && { model }),
        ...(prompt && { prompt }),
        ...(selectedIntegrations.length > 0 && { integrations: selectedIntegrations }),
        ...(selectedIntegrations.length > 0 && { integrationApproval }),
        ...(selectedRepos.length > 0 && { repos: selectedRepos }),
        ...(selectedPersonality && { personality: selectedPersonality }),
        ...(selectedRole === 'ambassador' && selectedPeerId && { peerId: selectedPeerId }),
      };
      await spawnAgent(config);
      closeDetail();
    } catch { /* toast handles */ }
    setSpawning(false);
  }

  async function handleSpawn() {
    if (!selectedRole) return;
    try {
      const preflight = await api.post('/agents/preflight', {
        role: selectedRole,
        integrations: selectedIntegrations,
      });
      if (preflight?.issues?.length > 0) {
        setPreflightDialog(preflight.issues);
        return;
      }
    } catch { /* preflight endpoint may not exist yet — proceed */ }
    runSpawn();
  }

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) closeDetail(); }}>
      <SheetContent title="Spawn Agent" width={480} onClose={() => closeDetail()}>
        <div className="flex flex-col h-[calc(100%-57px)]">
          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
            {/* Section 1: Role Selection */}
            <div>
              <label className="text-xs font-semibold text-text-2 font-sans uppercase tracking-wider block mb-3">
                Choose Role
              </label>
              <div className="grid grid-cols-2 gap-2">
                {ROLE_PRESETS.map((preset) => {
                  const colors = roleColor(preset.id);
                  const selected = role === preset.id;
                  return (
                    <button
                      key={preset.id}
                      onClick={() => { setRole(preset.id); setCustomRole(''); }}
                      className={cn(
                        'flex items-center gap-2.5 p-3 rounded-md border text-left transition-all cursor-pointer',
                        selected
                          ? 'border-accent bg-accent/5'
                          : 'border-border-subtle bg-surface-1 hover:border-border hover:bg-surface-2',
                      )}
                    >
                      <div
                        className="w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0"
                        style={{ background: colors.bg }}
                      >
                        <preset.icon size={16} style={{ color: colors.text }} />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-semibold text-text-0 font-sans">{preset.label}</span>
                          {preset.skillHint && (
                            <span className="text-2xs font-mono text-warning/70 bg-warning/8 px-1 py-px rounded">skill</span>
                          )}
                        </div>
                        <div className="text-2xs text-text-3 font-sans truncate">{preset.desc}</div>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Custom role */}
              <div className="mt-3">
                <Input
                  placeholder="or type a custom role (e.g. chat-agent)..."
                  value={customRole}
                  onChange={(e) => { setCustomRole(e.target.value.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 50)); setRole(''); }}
                  className="text-xs"
                />
              </div>
            </div>

            {/* Recommended Integrations */}
            {selectedRole && recommendations.length > 0 && (
              <div>
                <label className="text-xs font-semibold text-text-2 font-sans uppercase tracking-wider block mb-2">
                  Recommended Integrations
                </label>
                <div className="space-y-1.5">
                  {recommendations.map((rec) => {
                    const logoUrl = INTEGRATION_LOGOS[rec.id];
                    if (rec.installed && rec.configured && rec.authenticated) {
                      return (
                        <div key={rec.id} className="flex items-center gap-2.5 px-3 py-2 rounded-md bg-success/5 border border-success/20">
                          <Check size={13} className="text-success flex-shrink-0" />
                          {logoUrl ? (
                            <img src={logoUrl} alt="" className="w-3.5 h-3.5 flex-shrink-0" />
                          ) : (
                            <Plug size={12} className="text-text-3 flex-shrink-0" />
                          )}
                          <span className="text-xs font-semibold text-text-0 font-sans">{rec.name || rec.id}</span>
                          <Badge variant="success" className="text-2xs ml-auto">Ready</Badge>
                        </div>
                      );
                    }
                    if (rec.installed) {
                      return (
                        <div key={rec.id} className="flex items-center gap-2.5 px-3 py-2 rounded-md bg-warning/5 border border-warning/20">
                          <AlertTriangle size={13} className="text-warning flex-shrink-0" />
                          {logoUrl ? (
                            <img src={logoUrl} alt="" className="w-3.5 h-3.5 flex-shrink-0" />
                          ) : (
                            <Plug size={12} className="text-text-3 flex-shrink-0" />
                          )}
                          <span className="text-xs font-semibold text-text-0 font-sans">{rec.name || rec.id}</span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="ml-auto text-2xs text-warning h-6 px-2"
                            onClick={() => {
                              closeDetail();
                              useGrooveStore.getState().setActiveView('marketplace');
                            }}
                          >
                            Configure
                          </Button>
                        </div>
                      );
                    }
                    return (
                      <div key={rec.id} className="flex items-center gap-2.5 px-3 py-2 rounded-md bg-surface-1 border border-border-subtle">
                        {logoUrl ? (
                          <img src={logoUrl} alt="" className="w-3.5 h-3.5 flex-shrink-0 opacity-40" />
                        ) : (
                          <Plug size={12} className="text-text-4 flex-shrink-0" />
                        )}
                        <span className="text-xs text-text-3 font-sans">{rec.name || rec.id}</span>
                        <button
                          onClick={() => {
                            closeDetail();
                            useGrooveStore.getState().setActiveView('marketplace');
                          }}
                          className="ml-auto text-2xs text-accent hover:underline font-sans cursor-pointer"
                        >
                          Install in Marketplace
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Ambassador server picker */}
            {selectedRole === 'ambassador' && (() => {
              const eligible = federation.whitelist.filter((e) => typeof e === 'object' && (e.status === 'mutual' || e.status === 'connected'));
              if (eligible.length === 0) {
                return (
                  <div className="rounded-lg border border-dashed border-border-subtle bg-surface-1/50 px-4 py-4 text-center">
                    <Globe size={18} className="text-text-4 mx-auto mb-1.5" />
                    <p className="text-2xs text-text-3 font-sans mb-2">No federated servers connected. Add one in the Federation view.</p>
                    <Button variant="ghost" size="sm" className="text-2xs text-accent" onClick={() => { closeDetail(); useGrooveStore.getState().setActiveView('federation'); }}>
                      Go to Federation
                    </Button>
                  </div>
                );
              }
              return (
                <div>
                  <label className="text-xs font-semibold text-text-2 font-sans uppercase tracking-wider block mb-2">
                    Target Server
                  </label>
                  <div className="relative">
                    <select
                      value={selectedPeerId}
                      onChange={(e) => setSelectedPeerId(e.target.value)}
                      className="w-full h-8 px-3 pr-8 text-sm rounded-md bg-surface-1 border border-border text-text-0 font-sans appearance-none cursor-pointer focus:outline-none focus:ring-1 focus:ring-accent"
                    >
                      <option value="">Select a server...</option>
                      {eligible.map((e) => (
                        <option key={e.ip} value={e.ip}>{e.name || `${e.ip}:${e.port || 31415}`}</option>
                      ))}
                    </select>
                    <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-3 pointer-events-none" />
                  </div>
                </div>
              );
            })()}

            {/* Section 2: Configuration */}
            {selectedRole && (
              <div className="space-y-4">
                <label className="text-xs font-semibold text-text-2 font-sans uppercase tracking-wider block">
                  Configuration
                </label>

                <Input
                  label="Name (optional)"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={`${selectedRole}-1`}
                />

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-text-2 font-sans">Provider</label>
                    <div className="relative">
                      <select
                        value={provider}
                        onChange={(e) => { setProvider(e.target.value); setModel(''); }}
                        className="w-full h-8 px-3 pr-8 text-sm rounded-md bg-surface-1 border border-border text-text-0 font-sans appearance-none cursor-pointer focus:outline-none focus:ring-1 focus:ring-accent"
                      >
                        <option value="">Auto</option>
                        {providers.map((p) => (
                          <option key={p.id} value={p.id} disabled={p.authType === 'api-key' ? !(p.installed && p.hasKey) : !p.installed}>
                            {p.name}{!p.installed ? ' (Not installed)' : (p.authType === 'api-key' && !p.hasKey) ? ' (No API key)' : ''}
                          </option>
                        ))}
                      </select>
                      <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-3 pointer-events-none" />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-medium text-text-2 font-sans">Model</label>
                    <div className="relative">
                      <select
                        value={model}
                        onChange={(e) => setModel(e.target.value)}
                        disabled={!provider}
                        className="w-full h-8 px-3 pr-8 text-sm rounded-md bg-surface-1 border border-border text-text-0 font-sans appearance-none cursor-pointer focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-40"
                      >
                        <option value="">Auto</option>
                        {provider === 'ollama' && ollamaInstalled.length > 0 ? (
                          <>
                            <optgroup label="Installed Models">
                              {ollamaInstalled.map((m) => {
                                const isRunning = ollamaRunningModels.some((r) => r.name === m.id);
                                return (
                                  <option key={m.id} value={m.id}>
                                    {m.name || m.id} ({m.size}){isRunning ? ' ● Running' : ''}
                                  </option>
                                );
                              })}
                            </optgroup>
                            <optgroup label="Catalog">
                              {availableModels
                                .filter((m) => !ollamaInstalled.some((i) => i.id === m.id))
                                .map((m) => (
                                  <option key={m.id} value={m.id}>{m.name} (not installed)</option>
                                ))
                              }
                            </optgroup>
                          </>
                        ) : (
                          availableModels.map((m) => (
                            <option key={m.id} value={m.id}>{m.name}</option>
                          ))
                        )}
                      </select>
                      <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-3 pointer-events-none" />
                    </div>
                  </div>
                </div>

                {provider && selectedProvider && (
                  <div className="text-2xs text-text-3 font-sans flex items-center gap-2 flex-wrap">
                    {selectedProvider.authType === 'local' ? (
                      <Badge variant="success">Local</Badge>
                    ) : selectedProvider.authType === 'subscription' ? (
                      <Badge variant="accent">Subscription</Badge>
                    ) : selectedProvider.hasKey ? (
                      <Badge variant="success">API key set</Badge>
                    ) : (
                      <Badge variant="warning">No API key — set with: groove set-key {provider} YOUR_KEY</Badge>
                    )}
                  </div>
                )}

                {/* Ollama model status */}
                {provider === 'ollama' && model && (
                  <div className="flex items-center gap-2 flex-wrap text-2xs font-sans">
                    {ollamaRunningModels.some((r) => r.name === model) ? (
                      <Badge variant="success" className="text-2xs gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-success" />
                        Ready — running in memory
                      </Badge>
                    ) : ollamaInstalled.some((m) => m.id === model) ? (
                      <Badge variant="subtle" className="text-2xs">Will auto-start when agent spawns</Badge>
                    ) : (
                      <Badge variant="warning" className="text-2xs">Not installed — will pull first</Badge>
                    )}
                    {!ollamaServerRunning && (
                      <span className="text-warning">Server not running — will auto-start</span>
                    )}
                  </div>
                )}

                {/* Integrations */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-text-2 font-sans">Integrations</label>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {selectedIntegrations.map((integrationId) => {
                      const integration = installedIntegrations.find((i) => i.id === integrationId);
                      const logoUrl = INTEGRATION_LOGOS[integrationId];
                      return (
                        <span
                          key={integrationId}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded bg-accent/12 text-accent border border-accent/25 text-2xs font-sans"
                        >
                          {logoUrl ? (
                            <img src={logoUrl} alt="" className="w-2.5 h-2.5" />
                          ) : (
                            <Plug size={9} />
                          )}
                          {integration?.name || integrationId}
                          <button
                            onClick={() => setSelectedIntegrations((prev) => prev.filter((i) => i !== integrationId))}
                            className="ml-0.5 hover:text-text-0 cursor-pointer"
                          >
                            <X size={9} />
                          </button>
                        </span>
                      );
                    })}
                    <button
                      onClick={() => { setIntegrationModalOpen(true); setIntegrationSearch(''); }}
                      className={cn(
                        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-2xs font-sans transition-colors cursor-pointer',
                        'bg-surface-0 text-text-2 border border-border-subtle hover:border-border hover:text-text-0',
                      )}
                    >
                      <Plug size={10} />
                      {selectedIntegrations.length > 0 ? 'Add integration' : 'Attach integration'}
                    </button>
                  </div>
                </div>

                {/* Integration picker modal */}
                <Dialog open={integrationModalOpen} onOpenChange={setIntegrationModalOpen}>
                  <DialogContent title="Select Integration" className="max-w-sm">
                    <div className="space-y-3 p-4">
                      <div className="relative">
                        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-4" />
                        <input
                          value={integrationSearch}
                          onChange={(e) => setIntegrationSearch(e.target.value)}
                          placeholder="Search integrations..."
                          autoFocus
                          className="w-full h-8 pl-8 pr-3 text-xs rounded-md bg-surface-0 border border-border text-text-0 font-sans focus:outline-none focus:ring-1 focus:ring-accent"
                        />
                      </div>
                      <div className="max-h-64 overflow-y-auto space-y-1">
                        {installedIntegrations
                          .filter((i) => {
                            if (!integrationSearch) return true;
                            const q = integrationSearch.toLowerCase();
                            return (i.name || i.id).toLowerCase().includes(q) || (i.description || '').toLowerCase().includes(q);
                          })
                          .map((integration) => {
                            const active = selectedIntegrations.includes(integration.id);
                            const configured = integration.configured !== false;
                            const logoUrl = INTEGRATION_LOGOS[integration.id];
                            const roleMatch = selectedRole && Array.isArray(integration.roles) && integration.roles.includes(selectedRole);
                            return (
                              <button
                                key={integration.id}
                                onClick={() => {
                                  if (!configured) return;
                                  setSelectedIntegrations((prev) =>
                                    active ? prev.filter((i) => i !== integration.id) : [...prev, integration.id]
                                  );
                                }}
                                disabled={!configured}
                                className={cn(
                                  'w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-left transition-colors',
                                  configured ? 'cursor-pointer' : 'opacity-40 cursor-not-allowed',
                                  active
                                    ? 'bg-accent/10 border border-accent/25'
                                    : configured
                                      ? 'hover:bg-surface-3 border border-transparent'
                                      : 'border border-transparent',
                                )}
                              >
                                {logoUrl ? (
                                  <img src={logoUrl} alt="" className="w-4 h-4 flex-shrink-0" />
                                ) : (
                                  <Plug size={12} className={active ? 'text-accent' : 'text-text-3'} />
                                )}
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-xs font-semibold text-text-0 font-sans truncate">{integration.name || integration.id}</span>
                                    {!configured && (
                                      <span className="text-2xs text-text-4 font-sans">(not configured)</span>
                                    )}
                                    {configured && roleMatch && (
                                      <span className="text-2xs font-mono text-accent/70 bg-accent/8 px-1 py-px rounded">
                                        rec
                                      </span>
                                    )}
                                  </div>
                                  {integration.description && (
                                    <div className="text-2xs text-text-3 font-sans truncate">{integration.description}</div>
                                  )}
                                  {!configured && (
                                    <div className="text-2xs text-text-4 font-sans">Configure in Marketplace</div>
                                  )}
                                </div>
                                {active && <CheckMark />}
                              </button>
                            );
                          })}
                        {installedIntegrations.length === 0 && (
                          <div className="text-center py-6 text-xs text-text-3 font-sans">
                            No integrations installed. Visit the Marketplace to install integrations.
                          </div>
                        )}
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>

                {/* Approval mode */}
                {selectedIntegrations.length > 0 && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-text-2 font-sans">Integration Approvals</label>
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => setIntegrationApproval('manual')}
                        className={cn(
                          'flex-1 flex items-center gap-2 px-3 py-2 rounded-md border text-left transition-all cursor-pointer',
                          integrationApproval === 'manual'
                            ? 'border-accent bg-accent/5'
                            : 'border-border-subtle bg-surface-1 hover:border-border',
                        )}
                      >
                        <Shield size={13} className={integrationApproval === 'manual' ? 'text-accent' : 'text-text-3'} />
                        <div>
                          <div className="text-2xs font-semibold text-text-0 font-sans">Manual</div>
                          <div className="text-2xs text-text-3 font-sans">You approve each action</div>
                        </div>
                      </button>
                      <button
                        onClick={() => setIntegrationApproval('auto')}
                        className={cn(
                          'flex-1 flex items-center gap-2 px-3 py-2 rounded-md border text-left transition-all cursor-pointer',
                          integrationApproval === 'auto'
                            ? 'border-warning bg-warning/5'
                            : 'border-border-subtle bg-surface-1 hover:border-border',
                        )}
                      >
                        <Sparkles size={13} className={integrationApproval === 'auto' ? 'text-warning' : 'text-text-3'} />
                        <div>
                          <div className="text-2xs font-semibold text-text-0 font-sans">Auto</div>
                          <div className="text-2xs text-text-3 font-sans">Agent acts without asking</div>
                        </div>
                      </button>
                    </div>
                  </div>
                )}

                {/* Repos */}
                {importedRepos.length > 0 && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-text-2 font-sans">Repos</label>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {selectedRepos.map((importId) => {
                        const repo = importedRepos.find((r) => r.id === importId);
                        return (
                          <span
                            key={importId}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-accent/12 text-accent border border-accent/25 text-2xs font-sans"
                          >
                            <GitBranch size={9} />
                            {repo?.name || importId}
                            <button
                              onClick={() => setSelectedRepos((prev) => prev.filter((r) => r !== importId))}
                              className="ml-0.5 hover:text-text-0 cursor-pointer"
                            >
                              <X size={9} />
                            </button>
                          </span>
                        );
                      })}
                      <button
                        onClick={() => { setRepoModalOpen(true); setRepoSearch(''); }}
                        className={cn(
                          'inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-2xs font-sans transition-colors cursor-pointer',
                          'bg-surface-0 text-text-2 border border-border-subtle hover:border-border hover:text-text-0',
                        )}
                      >
                        <GitBranch size={10} />
                        {selectedRepos.length > 0 ? 'Add repo' : 'Attach repo'}
                      </button>
                    </div>
                  </div>
                )}

                {/* Repo picker modal */}
                <Dialog open={repoModalOpen} onOpenChange={setRepoModalOpen}>
                  <DialogContent title="Select Repository" className="max-w-sm">
                    <div className="space-y-3 p-4">
                      {importedRepos.length > 1 && (
                        <div className="relative">
                          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-4" />
                          <input
                            value={repoSearch}
                            onChange={(e) => setRepoSearch(e.target.value)}
                            placeholder="Search repos..."
                            autoFocus
                            className="w-full h-8 pl-8 pr-3 text-xs rounded-md bg-surface-0 border border-border text-text-0 font-sans focus:outline-none focus:ring-1 focus:ring-accent"
                          />
                        </div>
                      )}
                      <div className="max-h-64 overflow-y-auto space-y-1">
                        {importedRepos
                          .filter((r) => {
                            if (!repoSearch) return true;
                            const q = repoSearch.toLowerCase();
                            return (r.name || r.repo || r.id).toLowerCase().includes(q);
                          })
                          .map((repo) => {
                            const active = selectedRepos.includes(repo.id);
                            return (
                              <button
                                key={repo.id}
                                onClick={() => {
                                  setSelectedRepos((prev) =>
                                    active ? prev.filter((r) => r !== repo.id) : [...prev, repo.id]
                                  );
                                }}
                                className={cn(
                                  'w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-left transition-colors cursor-pointer',
                                  active
                                    ? 'bg-accent/10 border border-accent/25'
                                    : 'hover:bg-surface-3 border border-transparent',
                                )}
                              >
                                <GitBranch size={12} className={active ? 'text-accent' : 'text-text-3'} />
                                <div className="flex-1 min-w-0">
                                  <div className="text-xs font-semibold text-text-0 font-sans truncate">{repo.name || repo.repo}</div>
                                  <div className="text-2xs text-text-4 font-mono truncate">{repo.clonedTo}</div>
                                </div>
                                {active && <CheckMark />}
                              </button>
                            );
                          })}
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>

                {/* Personality — shown for chat role, or via Advanced toggle for others */}
                {(role === 'chat' || showAdvanced) && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-text-2 font-sans">Personality</label>
                    <div className="relative">
                      <select
                        value={selectedPersonality}
                        onChange={(e) => setSelectedPersonality(e.target.value)}
                        className="w-full h-8 px-3 pr-8 text-sm rounded-md bg-surface-1 border border-border text-text-0 font-sans appearance-none cursor-pointer focus:outline-none focus:ring-1 focus:ring-accent"
                      >
                        <option value="">None (blank)</option>
                        {personalities.map((p) => (
                          <option key={p.name || p} value={p.name || p}>{p.name || p}</option>
                        ))}
                      </select>
                      <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-3 pointer-events-none" />
                    </div>
                    <p className="text-2xs text-text-4 font-sans">Personality is injected into every prompt for this agent.</p>
                  </div>
                )}

                {role !== 'chat' && !showAdvanced && (
                  <button
                    onClick={() => setShowAdvanced(true)}
                    className="text-2xs text-text-3 hover:text-accent font-sans transition-colors cursor-pointer"
                  >
                    + Advanced options
                  </button>
                )}

              </div>
            )}
          </div>

          {/* Sticky footer */}
          <div className="border-t border-border-subtle px-5 py-4 bg-surface-1">
            {installedProviders.length === 0 && providers.length > 0 && (
              <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-md bg-warning/8 border border-warning/20">
                <AlertTriangle size={13} className="text-warning flex-shrink-0" />
                <span className="text-2xs font-sans text-text-2">No AI providers installed. Install Claude Code, Gemini CLI, Codex, or Ollama to spawn agents.</span>
              </div>
            )}
            {selectedRole && installedProviders.length > 0 && (
              <div className="flex items-center gap-2 mb-3 text-xs text-text-3 font-sans">
                <span>Spawning</span>
                <Badge variant="accent">{selectedRole}</Badge>
                {provider && <span>on {selectedProvider?.name || provider}</span>}
                {name && <span>as {name.replace(/\s+/g, '-')}</span>}
              </div>
            )}
            <Button
              variant="primary"
              size="lg"
              onClick={handleSpawn}
              disabled={!selectedRole || spawning || installedProviders.length === 0}
              className="w-full"
            >
              {spawning ? 'Spawning...' : 'Spawn Agent'}
            </Button>
          </div>
        </div>
      </SheetContent>

      {/* Preflight confirmation dialog */}
      <Dialog open={!!preflightDialog} onOpenChange={(o) => { if (!o) setPreflightDialog(null); }}>
        <DialogContent title="Integration Warning" className="max-w-sm">
          <div className="space-y-4 p-4">
            <div className="space-y-2">
              {(preflightDialog || []).map((issue, i) => (
                <div key={i} className="flex items-start gap-2 text-xs text-text-1 font-sans">
                  <AlertTriangle size={13} className="text-warning flex-shrink-0 mt-0.5" />
                  <span>{issue.name ? `${issue.name}: ${issue.problem === 'not_installed' ? 'not installed' : issue.problem === 'not_configured' ? 'not configured' : 'not authenticated'}` : issue.message || String(issue)}</span>
                </div>
              ))}
            </div>
            <p className="text-2xs text-text-3 font-sans">Continue anyway?</p>
            <div className="flex gap-2">
              <Button variant="ghost" size="md" onClick={() => setPreflightDialog(null)} className="flex-1">
                Cancel
              </Button>
              <Button variant="warning" size="md" onClick={() => { setPreflightDialog(null); runSpawn(); }} className="flex-1">
                Spawn Anyway
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Sheet>
  );
}
