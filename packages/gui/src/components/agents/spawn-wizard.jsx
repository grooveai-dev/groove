// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useEffect } from 'react';
import { useGrooveStore } from '../../stores/groove';
import { Sheet, SheetContent } from '../ui/sheet';
import { Button } from '../ui/button';
import { Input, Textarea } from '../ui/input';
import { Badge } from '../ui/badge';
import { cn } from '../../lib/cn';
import { roleColor } from '../../lib/status';
import {
  Server, Monitor, Code2, TestTube, Cloud, FileText,
  Shield, Database, Megaphone, Calculator, UserCheck,
  Headphones, BarChart3, Rocket, ChevronDown, Pen, Presentation,
  Sparkles, X, Search, AlertTriangle,
} from 'lucide-react';
import { api } from '../../lib/api';
import { Dialog, DialogContent } from '../ui/dialog';

const ROLE_PRESETS = [
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
  const [installedSkills, setInstalledSkills] = useState([]);
  const [selectedSkills, setSelectedSkills] = useState([]);
  const [skillModalOpen, setSkillModalOpen] = useState(false);
  const [skillSearch, setSkillSearch] = useState('');
  const [spawning, setSpawning] = useState(false);

  useEffect(() => {
    if (open) {
      fetchProviders().then((data) => {
        const list = Array.isArray(data) ? data : data.providers || [];
        setProviders(list);
        // Auto-select first installed provider
        const installed = list.filter((p) => p.installed);
        if (installed.length > 0 && !provider) {
          const priority = ['claude-code', 'gemini', 'codex', 'ollama'];
          const best = priority.find((pid) => installed.some((p) => p.id === pid)) || installed[0].id;
          setProvider(best);
        }
      }).catch(() => {});
      api.get('/skills/installed').then((data) => {
        setInstalledSkills(Array.isArray(data) ? data : []);
      }).catch(() => {});
      setRole(''); setCustomRole(''); setName(''); setProvider(''); setModel(''); setPrompt('');
      setSelectedSkills([]);
    }
  }, [open, fetchProviders]);

  const selectedRole = role || customRole;
  const selectedProvider = providers.find((p) => p.id === provider);
  const availableModels = selectedProvider?.models || [];
  const installedProviders = providers.filter((p) => p.installed);

  async function handleSpawn() {
    if (!selectedRole) return;
    setSpawning(true);
    try {
      const config = {
        role: selectedRole,
        ...(name && { name: name.replace(/\s+/g, '-') }),
        ...(provider && { provider }),
        ...(model && { model }),
        ...(prompt && { prompt }),
        ...(selectedSkills.length > 0 && { skills: selectedSkills }),
      };
      await spawnAgent(config);
      closeDetail();
    } catch { /* toast handles */ }
    setSpawning(false);
  }

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) closeDetail(); }}>
      <SheetContent title="Spawn Agent" width={480}>
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
                  placeholder="or type a custom role..."
                  value={customRole}
                  onChange={(e) => { setCustomRole(e.target.value); setRole(''); }}
                  className="text-xs"
                />
              </div>
            </div>

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

                {/* Provider select - native for reliability */}
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
                        {installedProviders.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
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
                        {availableModels.map((m) => (
                          <option key={m.id} value={m.id}>{m.name}</option>
                        ))}
                      </select>
                      <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-3 pointer-events-none" />
                    </div>
                  </div>
                </div>

                {/* Provider status hints */}
                {provider && selectedProvider && (
                  <div className="text-2xs text-text-3 font-sans flex items-center gap-2">
                    {selectedProvider.hasKey ? (
                      <Badge variant="success">API key set</Badge>
                    ) : selectedProvider.authType === 'subscription' ? (
                      <Badge variant="accent">Subscription</Badge>
                    ) : (
                      <Badge variant="warning">No API key — set with: groove set-key {provider} YOUR_KEY</Badge>
                    )}
                  </div>
                )}

                {/* Skills */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-text-2 font-sans">Skills</label>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {selectedSkills.map((skillId) => {
                      const skill = installedSkills.find((s) => s.id === skillId);
                      return (
                        <span
                          key={skillId}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded bg-accent/12 text-accent border border-accent/25 text-2xs font-sans"
                        >
                          <Sparkles size={9} />
                          {skill?.name || skillId}
                          <button
                            onClick={() => setSelectedSkills((prev) => prev.filter((s) => s !== skillId))}
                            className="ml-0.5 hover:text-text-0 cursor-pointer"
                          >
                            <X size={9} />
                          </button>
                        </span>
                      );
                    })}
                    <button
                      onClick={() => { setSkillModalOpen(true); setSkillSearch(''); }}
                      className={cn(
                        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-2xs font-sans transition-colors cursor-pointer',
                        'bg-surface-0 text-text-2 border border-border-subtle hover:border-border hover:text-text-0',
                      )}
                    >
                      <Sparkles size={10} />
                      {selectedSkills.length > 0 ? 'Add skill' : 'Attach skill'}
                    </button>
                  </div>
                </div>

                {/* Skill picker modal */}
                <Dialog open={skillModalOpen} onOpenChange={setSkillModalOpen}>
                  <DialogContent title="Select Skill" className="max-w-sm">
                    <div className="space-y-3 p-4">
                      <div className="relative">
                        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-4" />
                        <input
                          value={skillSearch}
                          onChange={(e) => setSkillSearch(e.target.value)}
                          placeholder="Search skills..."
                          autoFocus
                          className="w-full h-8 pl-8 pr-3 text-xs rounded-md bg-surface-0 border border-border text-text-0 font-sans focus:outline-none focus:ring-1 focus:ring-accent"
                        />
                      </div>
                      <div className="max-h-64 overflow-y-auto space-y-1">
                        {installedSkills
                          .filter((s) => {
                            if (!skillSearch) return true;
                            const q = skillSearch.toLowerCase();
                            return (s.name || s.id).toLowerCase().includes(q) || (s.description || '').toLowerCase().includes(q);
                          })
                          .map((skill) => {
                            const active = selectedSkills.includes(skill.id);
                            return (
                              <button
                                key={skill.id}
                                onClick={() => {
                                  setSelectedSkills((prev) =>
                                    active ? prev.filter((s) => s !== skill.id) : [...prev, skill.id]
                                  );
                                }}
                                className={cn(
                                  'w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-left transition-colors cursor-pointer',
                                  active
                                    ? 'bg-accent/10 border border-accent/25'
                                    : 'hover:bg-surface-3 border border-transparent',
                                )}
                              >
                                <Sparkles size={12} className={active ? 'text-accent' : 'text-text-3'} />
                                <div className="flex-1 min-w-0">
                                  <div className="text-xs font-semibold text-text-0 font-sans truncate">{skill.name || skill.id}</div>
                                  {skill.description && (
                                    <div className="text-2xs text-text-3 font-sans truncate">{skill.description}</div>
                                  )}
                                </div>
                                {active && <CheckMark />}
                              </button>
                            );
                          })}
                        {installedSkills.length === 0 && (
                          <div className="text-center py-6 text-xs text-text-3 font-sans">
                            No skills installed. Visit the Marketplace to install skills.
                          </div>
                        )}
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>

                <Textarea
                  label="Prompt (optional)"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="What should this agent work on?"
                  rows={3}
                />
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
    </Sheet>
  );
}
