// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useEffect } from 'react';
import {
  FolderOpen, Cpu, Zap, Shield, ChevronDown, X, Plus,
  Gauge, FolderSearch, Key, Check, Eye, EyeOff,
  AlertCircle, Layers, Activity,
  RotateCw, Skull, Copy, Trash2,
  Sparkles, Calendar, Plug, MessageCircle, Save, GitBranch,
  ExternalLink, Loader2,
} from 'lucide-react';
import { useGrooveStore } from '../../stores/groove';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { FolderBrowser } from './folder-browser';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';
import { timeAgo } from '../../lib/format';
import { OllamaSetup } from './ollama-setup';
import { INTEGRATION_LOGOS } from '../../lib/integration-logos';

/* ── Segmented Control ─────────────────────────────────────── */

function SegmentedControl({ options, value, onChange }) {
  return (
    <div className="flex bg-surface-0 rounded-lg p-0.5 border border-border-subtle">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            'flex-1 px-3 py-1.5 text-2xs font-semibold font-sans rounded-md transition-all cursor-pointer',
            value === opt.value
              ? 'bg-accent/15 text-accent shadow-sm'
              : 'text-text-3 hover:text-text-1',
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

/* ── Config Section Row ────────────────────────────────────── */

function ConfigSection({ label, icon: Icon, children, description }) {
  return (
    <div className="space-y-2">
      <div>
        <label className="flex items-center gap-1.5 text-xs font-semibold text-text-1 font-sans">
          {Icon && <Icon size={13} className="text-text-3" />}
          {label}
        </label>
        {description && <p className="text-2xs text-text-4 font-sans mt-0.5">{description}</p>}
      </div>
      {children}
    </div>
  );
}

/* ── Agent Actions ──────────────────────────────────────────── */

function AgentActions({ agent }) {
  const killAgent = useGrooveStore((s) => s.killAgent);
  const rotateAgent = useGrooveStore((s) => s.rotateAgent);
  const spawnAgent = useGrooveStore((s) => s.spawnAgent);
  const closeDetail = useGrooveStore((s) => s.closeDetail);
  const addToast = useGrooveStore((s) => s.addToast);

  const [loading, setLoading] = useState(null);
  const [confirmKill, setConfirmKill] = useState(false);

  const isAlive = agent.status === 'running' || agent.status === 'starting';

  async function handleRotate() {
    setLoading('rotate');
    try { await rotateAgent(agent.id); } catch {}
    setLoading(null);
  }

  async function handleKill() {
    if (!confirmKill) { setConfirmKill(true); setTimeout(() => setConfirmKill(false), 3000); return; }
    setLoading('kill');
    try { await killAgent(agent.id, !isAlive); closeDetail(); } catch {}
    setLoading(null);
    setConfirmKill(false);
  }

  async function handleClone() {
    setLoading('clone');
    try {
      await spawnAgent({
        role: agent.role, provider: agent.provider, model: agent.model,
        name: `${agent.name}-clone`, scope: agent.scope, workingDir: agent.workingDir,
      });
      addToast('success', `Cloned ${agent.name}`);
    } catch {}
    setLoading(null);
  }

  if (isAlive) {
    return (
      <div className="space-y-2">
        <div className="grid grid-cols-3 gap-2">
          <Button variant="primary" size="md" onClick={handleRotate} disabled={loading === 'rotate'} className="gap-1.5">
            <RotateCw size={12} className={loading === 'rotate' ? 'animate-spin' : ''} />
            Rotate
          </Button>
          <Button variant="info" size="md" onClick={handleClone} disabled={!!loading} className="gap-1.5">
            <Copy size={12} /> Clone
          </Button>
          <Button
            variant="danger"
            size="md"
            onClick={handleKill}
            disabled={loading === 'kill'}
            className="gap-1.5"
          >
            <Skull size={12} />
            {confirmKill ? 'Confirm' : 'Kill'}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-2">
      <Button variant="info" size="md" onClick={handleClone} disabled={!!loading} className="gap-1.5">
        <Copy size={12} /> Clone
      </Button>
      <Button
        variant="danger"
        size="md"
        onClick={handleKill}
        disabled={loading === 'kill'}
        className="gap-1.5"
      >
        <Trash2 size={12} />
        {confirmKill ? 'Confirm' : 'Remove'}
      </Button>
    </div>
  );
}

/* ── Main Config Component ─────────────────────────────────── */

export function AgentConfig({ agent }) {
  const addToast = useGrooveStore((s) => s.addToast);
  const [providers, setProviders] = useState([]);
  const [selectedModel, setSelectedModel] = useState(agent.model || '');
  const [scopeInput, setScopeInput] = useState('');
  const [effort, setEffort] = useState(agent.effort || 'default');
  const [folderBrowserOpen, setFolderBrowserOpen] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [settingKeyFor, setSettingKeyFor] = useState(null);
  const [showKey, setShowKey] = useState(false);
  const [expandedProvider, setExpandedProvider] = useState(null);
  const [routingMode, setRoutingMode] = useState(agent.routingMode || 'auto');
  const [installedSkills, setInstalledSkills] = useState([]);
  const [importedRepos, setImportedRepos] = useState([]);
  const [scheduleUnit, setScheduleUnit] = useState('hr');
  const [scheduleCount, setScheduleCount] = useState('1');
  const [scheduling, setScheduling] = useState(false);
  const [personalityContent, setPersonalityContent] = useState('');
  const [personalityLoaded, setPersonalityLoaded] = useState(false);
  const [personalities, setPersonalities] = useState([]);
  const [savingPersonality, setSavingPersonality] = useState(false);
  const [installedIntegrations, setInstalledIntegrations] = useState([]);
  const [claudeAuth, setClaudeAuth] = useState(null);
  const [claudeAuthLoading, setClaudeAuthLoading] = useState(false);
  const [claudeAuthPolling, setClaudeAuthPolling] = useState(false);

  const isAlive = agent.status === 'running' || agent.status === 'starting';

  useEffect(() => {
    loadProviders();
    api.get('/skills/installed').then((data) => setInstalledSkills(Array.isArray(data) ? data : data.skills || [])).catch(() => {});
    api.get('/integrations/installed').then((data) => setInstalledIntegrations(Array.isArray(data) ? data : [])).catch(() => {});
    api.get('/repos/imported').then((data) => setImportedRepos((Array.isArray(data) ? data : []).filter((r) => r.status === 'active'))).catch(() => {});
    if (agent.provider === 'claude-code') {
      api.get('/providers/claude-code/auth').then((data) => setClaudeAuth(data)).catch(() => setClaudeAuth(null));
    }
    function onChanged() { loadProviders(); }
    window.addEventListener('groove:providers-changed', onChanged);
    return () => window.removeEventListener('groove:providers-changed', onChanged);
  }, []);

  function loadProviders() {
    api.get('/providers').then((data) => setProviders(Array.isArray(data) ? data : [])).catch(() => {});
  }

  useEffect(() => {
    setSelectedModel(agent.model || '');
    api.get(`/agents/${agent.id}/routing/recommend`).then((data) => {
      setRoutingMode(data?.mode || 'fixed');
    }).catch(() => {});
  }, [agent.id, agent.model]);

  useEffect(() => {
    setPersonalityLoaded(false);
    if (agent.personality) {
      api.get(`/personalities/${agent.name}`).then((data) => {
        setPersonalityContent(data?.content || '');
        setPersonalityLoaded(true);
      }).catch(() => {
        setPersonalityContent('');
        setPersonalityLoaded(true);
      });
    } else {
      setPersonalityContent('');
      setPersonalityLoaded(true);
    }
    api.get('/personalities').then((data) => {
      setPersonalities(Array.isArray(data) ? data : data.personalities || []);
    }).catch(() => {});
  }, [agent.id, agent.name]);

  useEffect(() => {
    if (!claudeAuthPolling) return;
    const start = Date.now();
    const interval = setInterval(() => {
      if (Date.now() - start > 300000) { setClaudeAuthPolling(false); clearInterval(interval); return; }
      api.get('/providers/claude-code/auth').then((data) => {
        if (data?.authenticated) {
          setClaudeAuth(data);
          setClaudeAuthPolling(false);
          setClaudeAuthLoading(false);
          clearInterval(interval);
        }
      }).catch(() => {});
    }, 2000);
    return () => clearInterval(interval);
  }, [claudeAuthPolling]);

  const currentProvider = providers.find((p) => p.id === agent.provider);

  async function handleModelSwap(providerId, modelId) {
    setSelectedModel(modelId);
    try {
      const updates = { model: modelId };
      // Switch provider if selecting a model from a different provider
      if (providerId && providerId !== agent.provider) {
        updates.provider = providerId;
      }
      await api.patch(`/agents/${agent.id}`, updates);
      addToast('success', `Model → ${modelId}${updates.provider ? ` (${providerId})` : ''}`);
    } catch (err) {
      addToast('error', 'Model swap failed', err.message);
    }
  }

  async function handleWorkingDir(dir) {
    try {
      await api.patch(`/agents/${agent.id}`, { workingDir: dir });
      addToast('success', `Working dir → ${dir.split('/').pop() || dir}`);
    } catch (err) {
      addToast('error', 'Update failed', err.message);
    }
  }

  async function handleEffort(val) {
    setEffort(val);
    try {
      await api.patch(`/agents/${agent.id}`, { effort: val });
      addToast('success', `Effort → ${val}`);
    } catch (err) {
      addToast('error', 'Update failed', err.message);
    }
  }

  async function handleAddScope(pattern) {
    if (!pattern.trim()) return;
    const newScope = [...(agent.scope || []), pattern.trim()];
    try {
      await api.patch(`/agents/${agent.id}`, { scope: newScope });
      setScopeInput('');
    } catch (err) {
      addToast('error', 'Scope update failed', err.message);
    }
  }

  async function handleRemoveScope(idx) {
    const newScope = (agent.scope || []).filter((_, i) => i !== idx);
    try {
      await api.patch(`/agents/${agent.id}`, { scope: newScope });
    } catch (err) {
      addToast('error', 'Scope update failed', err.message);
    }
  }

  async function handleSetKey(providerId) {
    if (!keyInput.trim()) return;
    try {
      await api.post(`/credentials/${providerId}`, { key: keyInput.trim() });
      addToast('success', `API key set for ${providerId}`);
      setKeyInput('');
      setSettingKeyFor(null);
      loadProviders();
      window.dispatchEvent(new CustomEvent('groove:providers-changed'));
    } catch (err) {
      addToast('error', 'Failed to set key', err.message);
    }
  }

  async function handleClaudeLogin() {
    setClaudeAuthLoading(true);
    try {
      await api.post('/providers/claude-code/login');
      setClaudeAuthPolling(true);
    } catch {
      setClaudeAuthLoading(false);
    }
  }

  const spawned = agent.spawnedAt || agent.createdAt;

  return (
    <div className="px-5 py-5 space-y-6 overflow-y-auto h-full">

      {/* ── Active Model ──────────────────────────────────── */}
      <ConfigSection label="Active Model" icon={Cpu}>
        <div className="bg-surface-0 rounded-lg border border-border-subtle px-3.5 py-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-bold font-mono text-text-0">{agent.model || 'auto'}</div>
              <div className="text-2xs text-text-3 font-sans mt-0.5">{currentProvider?.name || agent.provider}</div>
            </div>
            {currentProvider?.canHotSwap && isAlive && (
              <Badge variant="accent" className="text-2xs gap-1"><Zap size={8} /> Hot-swap</Badge>
            )}
          </div>
          {/* Quick model switch for current provider */}
          {currentProvider?.models?.length > 1 && (
            <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-border-subtle">
              {currentProvider.models.filter(m => !m.disabled).map((m) => {
                const isCurrent = m.id === agent.model;
                const canSelect = true;
                return (
                  <button
                    key={m.id}
                    onClick={() => canSelect && handleModelSwap(agent.provider, m.id)}
                    disabled={!canSelect}
                    className={cn(
                      'px-2.5 py-1 rounded-md text-xs font-mono transition-all',
                      canSelect ? 'cursor-pointer' : 'cursor-not-allowed opacity-40',
                      isCurrent
                        ? 'bg-accent/15 text-accent font-semibold'
                        : 'bg-surface-4 text-text-2 hover:bg-surface-5 hover:text-text-0',
                    )}
                  >
                    {m.name || m.id}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </ConfigSection>

      {/* ── Agent Actions ──────────────────────────────────── */}
      <AgentActions agent={agent} />

      {/* ── Providers ──────────────────────────────────────── */}
      <ConfigSection label="Providers" icon={Layers} description="Click a provider to see its models and connection status.">
        <div className="space-y-1.5">
          {providers.map((p) => {
            const isActive = p.id === agent.provider;
            const available = p.authType === 'subscription' ? (p.installed || p.authStatus?.authenticated) : p.authType === 'local' ? p.installed : (p.installed && p.hasKey);
            const isExpanded = expandedProvider === p.id;
            const models = p.models || [];
            return (
              <div key={p.id} className="rounded-lg border border-border-subtle bg-surface-0 overflow-hidden">
                {/* Provider row — clickable */}
                <button
                  onClick={() => setExpandedProvider(isExpanded ? null : p.id)}
                  className="w-full flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-surface-4/50 transition-colors"
                >
                  <div className={cn('w-2 h-2 rounded-full flex-shrink-0', available ? 'bg-success' : 'bg-text-4')} />
                  <span className={cn('text-xs font-semibold font-sans flex-1 text-left', available ? 'text-text-0' : 'text-text-3')}>
                    {p.name || p.id}
                  </span>
                  {isActive && <Badge variant="accent" className="text-2xs">Active</Badge>}
                  {!available && <span className="text-2xs text-text-4 font-sans">{!p.installed ? 'Not installed' : 'No key'}</span>}
                  <ChevronDown size={12} className={cn('text-text-4 transition-transform', isExpanded && 'rotate-180')} />
                </button>

                {/* Expanded: models + key management */}
                {isExpanded && p.authType === 'local' && (
                  <div className="border-t border-border-subtle">
                    <OllamaSetup isInstalled={available} onModelChange={loadProviders} />
                  </div>
                )}
                {isExpanded && p.authType !== 'local' && (
                  <div className="border-t border-border-subtle">
                    {/* API Key row */}
                    {(!available || p.hasKey) && (
                      <div className="px-3 py-2 bg-surface-1/50">
                        {settingKeyFor === p.id ? (
                          <div className="flex gap-1.5">
                            <div className="flex-1 relative">
                              <input
                                value={keyInput}
                                onChange={(e) => setKeyInput(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleSetKey(p.id)}
                                type={showKey ? 'text' : 'password'}
                                placeholder={`${p.name || p.id} API key...`}
                                className="w-full h-7 px-2.5 pr-7 text-2xs bg-surface-0 border border-border rounded-md text-text-0 font-mono placeholder:text-text-4 focus:outline-none focus:ring-1 focus:ring-accent"
                                autoFocus
                              />
                              <button onClick={() => setShowKey(!showKey)} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-4 hover:text-text-2 cursor-pointer">
                                {showKey ? <EyeOff size={10} /> : <Eye size={10} />}
                              </button>
                            </div>
                            <Button variant="primary" size="sm" onClick={() => handleSetKey(p.id)} disabled={!keyInput.trim()} className="h-7 px-2 text-2xs">
                              Save
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => { setSettingKeyFor(null); setKeyInput(''); }} className="h-7 px-2 text-2xs">
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <button
                            onClick={() => { setSettingKeyFor(p.id); setKeyInput(''); setShowKey(false); }}
                            className="flex items-center gap-1.5 text-2xs text-text-3 hover:text-accent font-sans cursor-pointer transition-colors"
                          >
                            <Key size={10} />
                            {available ? 'Update API key' : 'Add API key to enable'}
                          </button>
                        )}
                      </div>
                    )}

                    {/* Models */}
                    {available && models.filter(m => !m.disabled).length > 0 && models.filter(m => !m.disabled).map((m) => {
                      const isCurrent = p.id === agent.provider && m.id === agent.model;
                      const canSelect = true;
                      return (
                        <button
                          key={m.id}
                          onClick={() => canSelect && handleModelSwap(p.id, m.id)}
                          disabled={!canSelect}
                          className={cn(
                            'w-full flex items-center gap-2 px-3 py-2 text-left text-xs font-sans transition-colors',
                            'border-t border-border-subtle',
                            canSelect ? 'cursor-pointer hover:bg-surface-4/50' : 'cursor-not-allowed opacity-40',
                            isCurrent ? 'text-accent' : 'text-text-2',
                          )}
                        >
                          {isCurrent ? <Check size={11} className="text-accent flex-shrink-0" /> : <div className="w-[11px]" />}
                          <span className="font-mono flex-1 truncate">{m.name || m.id}</span>
                          <Badge variant={isCurrent ? 'accent' : 'default'} className="text-2xs">{m.tier}</Badge>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {isAlive && (
          <div className="flex items-center gap-1.5 text-2xs text-text-3 font-sans mt-1.5">
            <AlertCircle size={10} />
            <span>Model changes apply on next rotation or respawn.</span>
          </div>
        )}
      </ConfigSection>

      {/* ── Claude Code Auth ──────────────────────────────── */}
      {agent.provider === 'claude-code' && claudeAuth && !claudeAuth.authenticated && (
        <div className="rounded-lg border border-warning/30 bg-warning/5 px-4 py-3 space-y-2">
          <div className="flex items-center gap-2">
            <AlertCircle size={13} className="text-warning flex-shrink-0" />
            <span className="text-xs font-semibold text-text-0 font-sans">Claude Code is not signed in</span>
          </div>
          {claudeAuthLoading ? (
            <div className="flex items-center gap-2 text-2xs text-text-2 font-sans">
              <Loader2 size={12} className="animate-spin text-accent" />
              Waiting for browser authentication...
            </div>
          ) : (
            <Button variant="primary" size="sm" onClick={handleClaudeLogin} className="text-2xs gap-1.5">
              <ExternalLink size={10} />
              Sign in to Claude
            </Button>
          )}
        </div>
      )}
      {agent.provider === 'claude-code' && claudeAuth?.authenticated && (
        <div className="flex items-center gap-2 text-2xs text-text-2 font-sans">
          <div className="w-2 h-2 rounded-full bg-success flex-shrink-0" />
          Signed in as {claudeAuth.email || 'Claude user'} ({claudeAuth.subscriptionType || 'subscription'})
        </div>
      )}

      {/* ── Working Directory ──────────────────────────────── */}
      <ConfigSection label="Working Directory" icon={FolderOpen} description="The root directory this agent operates in.">
        <div className="flex gap-2">
          <div className="flex-1 bg-surface-0 rounded-lg px-3 py-2.5 text-sm font-mono text-text-1 border border-border-subtle truncate min-w-0">
            {agent.workingDir || 'Project root'}
          </div>
          <Button variant="secondary" size="md" onClick={() => setFolderBrowserOpen(true)} className="gap-1.5 flex-shrink-0">
            <FolderSearch size={14} /> Browse
          </Button>
        </div>
      </ConfigSection>

      {/* ── Permission Mode ────────────────────────────────── */}
      <ConfigSection label="Permission Mode" icon={Shield} description="Full Send = no approvals. Agent Approve = Fullstack Manager reviews risky operations.">
        <SegmentedControl
          options={[
            { value: 'full', label: 'Full Send' },
            { value: 'auto', label: 'Agent Approve' },
          ]}
          value={agent.permission || 'full'}
          onChange={async (val) => {
            try {
              await api.patch(`/agents/${agent.id}`, { permission: val });
              addToast('success', `Permission → ${val === 'full' ? 'Full Send' : 'Agent Approve'}`);
            } catch (err) {
              addToast('error', 'Update failed', err.message);
            }
          }}
        />
      </ConfigSection>

      {/* ── Model Routing ────────────────────────────────────── */}
      <ConfigSection label="Model Routing" icon={Activity} description="How Groove selects models for this agent's tasks.">
        <SegmentedControl
          options={[
            { value: 'fixed', label: 'Fixed' },
            { value: 'auto', label: 'Auto' },
            { value: 'auto-floor', label: 'Auto + Floor' },
          ]}
          value={routingMode}
          onChange={async (val) => {
            setRoutingMode(val);
            try {
              await api.post(`/agents/${agent.id}/routing`, { mode: val });
              addToast('success', `Routing → ${val}`);
            } catch (err) {
              addToast('error', 'Update failed', err.message);
            }
          }}
        />
        <div className="text-2xs text-text-4 font-sans mt-1">
          {routingMode === 'fixed' && 'Uses the selected model for all tasks.'}
          {routingMode === 'auto' && 'Groove picks Opus/Sonnet/Haiku based on task complexity.'}
          {routingMode === 'auto-floor' && 'Auto-routes but never drops below Sonnet.'}
        </div>
      </ConfigSection>

      {/* ── File Scope ─────────────────────────────────────── */}
      <ConfigSection label="File Scope" icon={Shield} description="Restrict which files this agent can access. Empty = unrestricted.">
        <div className="flex flex-wrap gap-2">
          {(agent.scope || []).map((s, i) => (
            <Badge key={i} variant="default" className="font-mono text-xs gap-1.5 px-2.5 py-1">
              {s}
              <button onClick={() => handleRemoveScope(i)} className="hover:text-danger cursor-pointer">
                <X size={10} />
              </button>
            </Badge>
          ))}
          <div className="flex items-center gap-1.5">
            <input
              value={scopeInput}
              onChange={(e) => setScopeInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddScope(scopeInput)}
              placeholder="e.g. src/**"
              className="w-28 h-7 px-2.5 text-xs bg-surface-0 border border-border-subtle rounded-md text-text-0 font-mono placeholder:text-text-4 focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <button
              onClick={() => handleAddScope(scopeInput)}
              disabled={!scopeInput.trim()}
              className="w-7 h-7 flex items-center justify-center rounded-md bg-surface-4 border border-border-subtle text-text-3 hover:text-accent cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <Plus size={12} />
            </button>
          </div>
        </div>
      </ConfigSection>

      {/* ── Effort Level ───────────────────────────────────── */}
      <ConfigSection label="Effort Level" icon={Gauge} description="Controls how deep the agent reasons. Higher = more tokens but better results.">
        <SegmentedControl
          options={[
            { value: 'min', label: 'Min' },
            { value: 'low', label: 'Low' },
            { value: 'default', label: 'Default' },
            { value: 'high', label: 'High' },
            { value: 'max', label: 'Max' },
          ]}
          value={effort}
          onChange={handleEffort}
        />
      </ConfigSection>

      {/* ── Agent Details ──────────────────────────────────── */}
      <ConfigSection label="Agent Details" icon={Layers}>
        <div className="bg-surface-0 rounded-lg border border-border-subtle divide-y divide-border-subtle">
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-xs text-text-3 font-sans">ID</span>
            <span className="text-xs text-text-1 font-mono">{agent.id}</span>
          </div>
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-xs text-text-3 font-sans">Role</span>
            <span className="text-xs text-text-1 font-sans capitalize">{agent.role}</span>
          </div>
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-xs text-text-3 font-sans">Provider</span>
            <span className="text-xs text-text-1 font-mono">{agent.provider}</span>
          </div>
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-xs text-text-3 font-sans">Model</span>
            <span className="text-xs text-text-1 font-mono">{agent.model || 'auto'}</span>
          </div>
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-xs text-text-3 font-sans">Status</span>
            <span className="text-xs text-text-1 font-sans capitalize">{agent.status}</span>
          </div>
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-xs text-text-3 font-sans">Spawned</span>
            <span className="text-xs text-text-1 font-sans">{spawned ? timeAgo(spawned) : '—'}</span>
          </div>
          {agent.sessionId && (
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-xs text-text-3 font-sans">Session</span>
              <span className="text-xs text-text-1 font-mono">{agent.sessionId.slice(0, 16)}...</span>
            </div>
          )}
        </div>
      </ConfigSection>

      {/* ── Skills ────────────────────────────────────────── */}
      <ConfigSection label="Skills" icon={Sparkles} description="Attach installed skills to this agent's context.">
        <div className="flex flex-wrap gap-1.5">
          {(agent.skills || []).map((skillId) => (
            <Badge key={skillId} variant="accent" className="font-mono text-xs gap-1.5 px-2.5 py-1">
              {skillId}
              <button
                onClick={async () => {
                  try {
                    await api.delete(`/agents/${agent.id}/skills/${skillId}`);
                    addToast('success', `Detached ${skillId}`);
                  } catch (err) { addToast('error', 'Detach failed', err.message); }
                }}
                className="hover:text-danger cursor-pointer"
              >
                <X size={10} />
              </button>
            </Badge>
          ))}
          {installedSkills.filter((s) => !(agent.skills || []).includes(s.id)).length > 0 && (
            <div className="relative group">
              <button className="w-7 h-7 flex items-center justify-center rounded-md bg-surface-4 border border-border-subtle text-text-3 hover:text-accent cursor-pointer transition-colors">
                <Plus size={12} />
              </button>
              <div className="absolute top-full left-0 mt-1 z-20 hidden group-hover:block bg-surface-2 border border-border-subtle rounded-lg shadow-xl py-1 min-w-[160px]">
                {installedSkills.filter((s) => !(agent.skills || []).includes(s.id)).map((skill) => (
                  <button
                    key={skill.id}
                    onClick={async () => {
                      try {
                        await api.post(`/agents/${agent.id}/skills/${skill.id}`);
                        addToast('success', `Attached ${skill.name || skill.id}`);
                      } catch (err) { addToast('error', 'Attach failed', err.message); }
                    }}
                    className="w-full text-left px-3 py-1.5 text-xs font-sans text-text-1 hover:bg-surface-4 cursor-pointer transition-colors"
                  >
                    {skill.name || skill.id}
                  </button>
                ))}
              </div>
            </div>
          )}
          {(agent.skills || []).length === 0 && installedSkills.length === 0 && (
            <span className="text-2xs text-text-4 font-sans">No skills installed — browse the Marketplace</span>
          )}
        </div>
      </ConfigSection>

      {/* ── Integrations ─────────────────────────────────── */}
      <ConfigSection label="Integrations" icon={Plug} description="Attach MCP integrations for external services.">
        <div className="flex flex-wrap gap-1.5">
          {(agent.integrations || []).map((integrationId) => {
            const logoUrl = INTEGRATION_LOGOS[integrationId];
            const integration = installedIntegrations.find((i) => i.id === integrationId);
            return (
              <Badge key={integrationId} variant="accent" className="font-mono text-xs gap-1.5 px-2.5 py-1">
                {logoUrl ? (
                  <img src={logoUrl} alt="" className="w-2.5 h-2.5" />
                ) : (
                  <Plug size={9} />
                )}
                {integration?.name || integrationId}
                <button
                  onClick={async () => {
                    try {
                      await api.delete(`/agents/${agent.id}/integrations/${integrationId}`);
                      addToast('success', `Detached ${integration?.name || integrationId}`);
                    } catch (err) { addToast('error', 'Detach failed', err.message); }
                  }}
                  className="hover:text-danger cursor-pointer"
                >
                  <X size={10} />
                </button>
              </Badge>
            );
          })}
          {installedIntegrations.filter((i) => i.configured !== false && !(agent.integrations || []).includes(i.id)).length > 0 && (
            <div className="relative group">
              <button className="w-7 h-7 flex items-center justify-center rounded-md bg-surface-4 border border-border-subtle text-text-3 hover:text-accent cursor-pointer transition-colors">
                <Plus size={12} />
              </button>
              <div className="absolute top-full left-0 mt-1 z-20 hidden group-hover:block bg-surface-2 border border-border-subtle rounded-lg shadow-xl py-1 min-w-[200px]">
                {installedIntegrations.filter((i) => i.configured !== false && !(agent.integrations || []).includes(i.id)).map((integration) => {
                  const logoUrl = INTEGRATION_LOGOS[integration.id];
                  return (
                    <button
                      key={integration.id}
                      onClick={async () => {
                        try {
                          await api.post(`/agents/${agent.id}/integrations/${integration.id}`);
                          addToast('success', `Attached ${integration.name || integration.id}`);
                        } catch (err) { addToast('error', 'Attach failed', err.message); }
                      }}
                      className="w-full flex items-center gap-2 text-left px-3 py-1.5 text-xs font-sans text-text-1 hover:bg-surface-4 cursor-pointer transition-colors"
                    >
                      {logoUrl ? (
                        <img src={logoUrl} alt="" className="w-3.5 h-3.5 flex-shrink-0" />
                      ) : (
                        <Plug size={12} className="text-text-3 flex-shrink-0" />
                      )}
                      {integration.name || integration.id}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {(agent.integrations || []).length === 0 && installedIntegrations.length === 0 && (
            <span className="text-2xs text-text-4 font-sans">No integrations installed — browse the Marketplace</span>
          )}
        </div>
        {(agent.integrations || []).length > 0 && (
          <div className="mt-3">
            <label className="text-2xs font-medium text-text-3 font-sans block mb-1.5">Integration Approvals</label>
            <SegmentedControl
              options={[
                { value: 'auto', label: 'Auto' },
                { value: 'manual', label: 'Manual' },
              ]}
              value={agent.integrationApproval || 'manual'}
              onChange={async (val) => {
                try {
                  await api.patch(`/agents/${agent.id}`, { integrationApproval: val });
                  addToast('success', `Integration approvals → ${val === 'auto' ? 'Auto' : 'Manual'}`);
                } catch (err) { addToast('error', 'Update failed', err.message); }
              }}
            />
          </div>
        )}
      </ConfigSection>

      {/* ── Repos ─────────────────────────────────────────── */}
      {importedRepos.length > 0 && (
        <ConfigSection label="Repos" icon={GitBranch} description="Attach imported repos so this agent knows where they are.">
          <div className="flex flex-wrap gap-1.5">
            {(agent.repos || []).map((importId) => {
              const repo = importedRepos.find((r) => r.id === importId);
              return (
                <Badge key={importId} variant="accent" className="font-mono text-xs gap-1.5 px-2.5 py-1">
                  {repo?.name || importId}
                  <button
                    onClick={async () => {
                      try {
                        await api.delete(`/agents/${agent.id}/repos/${importId}`);
                        addToast('success', `Detached ${repo?.name || importId}`);
                      } catch (err) { addToast('error', 'Detach failed', err.message); }
                    }}
                    className="hover:text-danger cursor-pointer"
                  >
                    <X size={10} />
                  </button>
                </Badge>
              );
            })}
            {importedRepos.filter((r) => !(agent.repos || []).includes(r.id)).length > 0 && (
              <div className="relative group">
                <button className="w-7 h-7 flex items-center justify-center rounded-md bg-surface-4 border border-border-subtle text-text-3 hover:text-accent cursor-pointer transition-colors">
                  <Plus size={12} />
                </button>
                <div className="absolute top-full left-0 mt-1 z-20 hidden group-hover:block bg-surface-2 border border-border-subtle rounded-lg shadow-xl py-1 min-w-[200px]">
                  {importedRepos.filter((r) => !(agent.repos || []).includes(r.id)).map((repo) => (
                    <button
                      key={repo.id}
                      onClick={async () => {
                        try {
                          await api.post(`/agents/${agent.id}/repos/${repo.id}`);
                          addToast('success', `Attached ${repo.name || repo.id}`);
                        } catch (err) { addToast('error', 'Attach failed', err.message); }
                      }}
                      className="w-full text-left px-3 py-1.5 text-xs font-sans text-text-1 hover:bg-surface-4 cursor-pointer transition-colors"
                    >
                      <div className="font-semibold">{repo.name || repo.repo}</div>
                      <div className="text-2xs text-text-4 font-mono truncate">{repo.clonedTo}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {(agent.repos || []).length === 0 && (
              <span className="text-2xs text-text-4 font-sans">No repos attached — import one from the Marketplace</span>
            )}
          </div>
        </ConfigSection>
      )}

      {/* ── Schedule ──────────────────────────────────────── */}
      <ConfigSection label="Schedule" icon={Calendar} description="Run this agent on a recurring schedule.">
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-2 font-sans">Every</span>
          <input
            value={scheduleCount}
            onChange={(e) => setScheduleCount(e.target.value.replace(/\D/g, '').slice(0, 3))}
            className="w-12 h-7 px-2 text-xs text-center bg-surface-0 border border-border-subtle rounded-md text-text-0 font-mono focus:outline-none focus:ring-1 focus:ring-accent"
            placeholder="1"
          />
          <div className="flex bg-surface-0 rounded-lg p-0.5 border border-border-subtle">
            {[
              { value: 'min', label: 'Min' },
              { value: 'hr', label: 'Hr' },
              { value: 'day', label: 'Day' },
              { value: 'wk', label: 'Wk' },
              { value: 'mo', label: 'Mo' },
            ].map((opt) => (
              <button
                key={opt.value}
                onClick={() => setScheduleUnit(opt.value)}
                className={cn(
                  'px-2 py-1 text-2xs font-semibold font-sans rounded-md transition-all cursor-pointer',
                  scheduleUnit === opt.value
                    ? 'bg-accent/15 text-accent shadow-sm'
                    : 'text-text-3 hover:text-text-1',
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <Button
            variant="primary"
            size="sm"
            disabled={scheduling || !scheduleCount || parseInt(scheduleCount, 10) < 1}
            onClick={async () => {
              const count = parseInt(scheduleCount, 10);
              if (!count || count < 1) return;
              const cronMap = {
                min: count === 1 ? '* * * * *' : `*/${count} * * * *`,
                hr: count === 1 ? '0 * * * *' : `0 */${count} * * *`,
                day: count === 1 ? '0 0 * * *' : `0 0 */${count} * *`,
                wk: `0 0 * * ${count === 1 ? '1' : '*'}`,
                mo: `0 0 ${count === 1 ? '1' : count} * *`,
              };
              setScheduling(true);
              try {
                await api.post('/schedules', {
                  name: `${agent.name} schedule`,
                  cron: cronMap[scheduleUnit],
                  agentConfig: {
                    role: agent.role,
                    provider: agent.provider,
                    model: agent.model,
                    scope: agent.scope,
                    workingDir: agent.workingDir,
                    prompt: agent.prompt,
                  },
                });
                addToast('success', `Scheduled every ${count} ${scheduleUnit}`);
              } catch (err) {
                addToast('error', 'Schedule failed', err.message);
              }
              setScheduling(false);
            }}
            className="h-7 px-3 text-2xs gap-1"
          >
            <Calendar size={10} />
            {scheduling ? '...' : 'Set'}
          </Button>
        </div>
      </ConfigSection>

      {/* ── Personality ──────────────────────────────────── */}
      <ConfigSection label="Personality" icon={MessageCircle} description="Injected into every prompt. Changes apply on next spawn or rotation.">
        <textarea
          value={personalityContent}
          onChange={(e) => setPersonalityContent(e.target.value)}
          placeholder={personalityLoaded ? 'Describe this agent\'s personality, tone, and behavior...' : 'Loading...'}
          rows={4}
          className="w-full min-h-[4rem] max-h-[10rem] resize-y bg-surface-0 border border-border-subtle rounded-md p-2 text-xs font-mono text-text-1 placeholder:text-text-4 focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <div className="flex items-center gap-2">
          <Button
            variant="primary"
            size="sm"
            disabled={savingPersonality}
            onClick={async () => {
              setSavingPersonality(true);
              try {
                await api.put(`/personalities/${agent.name}`, { content: personalityContent });
                addToast('success', 'Personality saved');
              } catch (err) {
                addToast('error', 'Save failed', err.message);
              }
              setSavingPersonality(false);
            }}
            className="h-7 px-3 text-2xs gap-1"
          >
            <Save size={10} />
            {savingPersonality ? 'Saving...' : 'Save'}
          </Button>
          {personalities.length > 0 && (
            <div className="relative">
              <select
                value=""
                onChange={(e) => {
                  if (!e.target.value) return;
                  const p = personalities.find((x) => (x.name || x) === e.target.value);
                  if (p) {
                    api.get(`/personalities/${p.name || p}`).then((data) => {
                      if (data?.content) setPersonalityContent(data.content);
                    }).catch(() => {});
                  }
                }}
                className="h-7 px-2 pr-7 text-2xs rounded-md bg-surface-1 border border-border-subtle text-text-2 font-sans appearance-none cursor-pointer focus:outline-none focus:ring-1 focus:ring-accent"
              >
                <option value="">Clone from...</option>
                {personalities.filter((p) => (p.name || p) !== agent.name).map((p) => (
                  <option key={p.name || p} value={p.name || p}>{p.name || p}</option>
                ))}
              </select>
              <ChevronDown size={10} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-4 pointer-events-none" />
            </div>
          )}
        </div>
      </ConfigSection>

      {/* ── Original Prompt ────────────────────────────────── */}
      {agent.prompt && (
        <ConfigSection label="Original Prompt" icon={Activity}>
          <div className="bg-surface-0 rounded-lg border border-border-subtle px-3 py-3 text-xs text-text-2 font-sans leading-relaxed max-h-40 overflow-y-auto">
            {agent.prompt}
          </div>
        </ConfigSection>
      )}

      {/* Folder Browser Modal */}
      <FolderBrowser
        open={folderBrowserOpen}
        onOpenChange={setFolderBrowserOpen}
        currentPath={agent.workingDir || '/'}
        onSelect={handleWorkingDir}
      />
    </div>
  );
}
