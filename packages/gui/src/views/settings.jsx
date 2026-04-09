// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useEffect } from 'react';
import { useGrooveStore } from '../stores/groove';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { ScrollArea } from '../components/ui/scroll-area';
import { Skeleton } from '../components/ui/skeleton';
import { OllamaSetup } from '../components/agents/ollama-setup';
import { api } from '../lib/api';
import { cn } from '../lib/cn';
import {
  Key, Eye, EyeOff, Check, ChevronDown, Cpu,
  FolderOpen, RotateCw, Users, Gauge, Zap, Server,
  LogIn, LogOut, User, ShieldCheck, Settings,
  Newspaper, Layers, Activity,
} from 'lucide-react';

/* ── Section Header ────────────────────────────────────────── */

function SectionHeader({ icon: Icon, title, description }) {
  return (
    <div className="mb-4">
      <div className="flex items-center gap-2.5 mb-1">
        <div className="w-7 h-7 rounded-md bg-accent/10 flex items-center justify-center flex-shrink-0">
          <Icon size={14} className="text-accent" />
        </div>
        <h3 className="text-sm font-bold text-text-0 font-sans tracking-tight">{title}</h3>
      </div>
      {description && <p className="text-xs text-text-3 font-sans ml-[38px]">{description}</p>}
    </div>
  );
}

/* ── Config Row ────────────────────────────────────────────── */

function ConfigRow({ icon: Icon, label, description, children }) {
  return (
    <div className="flex items-center gap-3.5 py-3 border-b border-border-subtle last:border-b-0">
      <Icon size={15} className="text-text-4 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium text-text-0 font-sans">{label}</div>
        {description && <div className="text-2xs text-text-4 font-sans mt-0.5 leading-relaxed">{description}</div>}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  );
}

/* ── Toggle ────────────────────────────────────────────────── */

function Toggle({ value, onChange }) {
  return (
    <button
      onClick={() => onChange(!value)}
      className={cn(
        'w-10 h-[22px] rounded-full p-0.5 transition-colors cursor-pointer',
        value ? 'bg-accent' : 'bg-surface-5',
      )}
    >
      <div className={cn(
        'w-[18px] h-[18px] rounded-full bg-white shadow-sm transition-transform',
        value ? 'translate-x-[18px]' : 'translate-x-0',
      )} />
    </button>
  );
}

/* ── Number Input ──────────────────────────────────────────── */

function NumberInput({ value, onChange, min, max, step, suffix }) {
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value, 10) || min || 0)}
        className="w-20 h-8 px-2.5 text-xs text-center bg-surface-0 border border-border-subtle rounded-md text-text-0 font-mono focus:outline-none focus:ring-1 focus:ring-accent"
        min={min} max={max} step={step}
      />
      {suffix && <span className="text-2xs text-text-4 font-sans">{suffix}</span>}
    </div>
  );
}

/* ── Provider Card ─────────────────────────────────────────── */

function ProviderCard({ provider, onKeyChange }) {
  const [expanded, setExpanded] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [settingKey, setSettingKey] = useState(false);
  const addToast = useGrooveStore((s) => s.addToast);

  const available = provider.installed || provider.hasKey;
  const isLocal = provider.authType === 'local';

  async function handleSetKey() {
    if (!keyInput.trim()) return;
    try {
      await api.post(`/credentials/${provider.id}`, { key: keyInput.trim() });
      addToast('success', `API key set for ${provider.name}`);
      setKeyInput('');
      setSettingKey(false);
      if (onKeyChange) onKeyChange();
    } catch (err) {
      addToast('error', 'Failed to set key', err.message);
    }
  }

  async function handleDeleteKey() {
    try {
      await api.delete(`/credentials/${provider.id}`);
      addToast('info', `API key removed for ${provider.name}`);
      if (onKeyChange) onKeyChange();
    } catch (err) {
      addToast('error', 'Failed to remove key', err.message);
    }
  }

  return (
    <div className={cn(
      'rounded-lg border overflow-hidden transition-colors',
      available ? 'border-border-subtle bg-surface-1' : 'border-border-subtle bg-surface-1/60',
    )}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-surface-4/30 transition-colors"
      >
        <div className={cn('w-2 h-2 rounded-full flex-shrink-0', available ? 'bg-success' : 'bg-text-4/40')} />
        <span className="text-[13px] font-semibold text-text-0 font-sans flex-1 text-left">{provider.name}</span>
        {available ? (
          <Badge variant="success" className="text-2xs gap-1"><Check size={9} /> Ready</Badge>
        ) : (
          <span className="text-2xs text-text-4 font-sans">{isLocal ? 'Not installed' : 'No key'}</span>
        )}
        <ChevronDown size={13} className={cn('text-text-4 transition-transform', expanded && 'rotate-180')} />
      </button>

      {expanded && (
        <div className="border-t border-border-subtle">
          {isLocal ? (
            <OllamaSetup isInstalled={available} onModelChange={onKeyChange} />
          ) : (
            <div className="px-4 py-3 space-y-3">
              {/* Models */}
              {provider.models?.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {provider.models.map((m) => (
                    <span key={m.id} className="px-2 py-0.5 rounded bg-surface-4 text-2xs font-mono text-text-2">
                      {m.name || m.id}
                    </span>
                  ))}
                </div>
              )}

              {/* API Key */}
              {settingKey ? (
                <div className="flex gap-2">
                  <div className="flex-1 relative">
                    <input
                      value={keyInput}
                      onChange={(e) => setKeyInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSetKey()}
                      type={showKey ? 'text' : 'password'}
                      placeholder={`Paste ${provider.name} API key...`}
                      className="w-full h-8 px-3 pr-8 text-xs bg-surface-0 border border-border rounded-md text-text-0 font-mono placeholder:text-text-4 focus:outline-none focus:ring-1 focus:ring-accent"
                      autoFocus
                    />
                    <button onClick={() => setShowKey(!showKey)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-4 hover:text-text-2 cursor-pointer">
                      {showKey ? <EyeOff size={11} /> : <Eye size={11} />}
                    </button>
                  </div>
                  <Button variant="primary" size="sm" onClick={handleSetKey} disabled={!keyInput.trim()} className="h-8 px-2.5 text-2xs">Save</Button>
                  <Button variant="ghost" size="sm" onClick={() => { setSettingKey(false); setKeyInput(''); }} className="h-8 px-2.5 text-2xs">Cancel</Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <code className="flex-1 h-8 px-3 flex items-center bg-surface-0 border border-border-subtle rounded-md text-2xs font-mono text-text-3 truncate">
                    {provider.hasKey ? '••••••••••••••••••••' : 'No API key configured'}
                  </code>
                  <Button variant="secondary" size="sm" onClick={() => { setSettingKey(true); setShowKey(false); setKeyInput(''); }} className="h-8 px-2.5 text-2xs gap-1">
                    <Key size={10} /> {provider.hasKey ? 'Update' : 'Add Key'}
                  </Button>
                  {provider.hasKey && (
                    <Button variant="danger" size="sm" onClick={handleDeleteKey} className="h-8 px-2.5 text-2xs">Remove</Button>
                  )}
                </div>
              )}

              <div className="text-2xs text-text-4 font-sans">
                {provider.authType === 'subscription' ? 'Uses your Claude subscription — no API key needed' : `Requires a ${provider.name} API key`}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Main Settings View ────────────────────────────────────── */

export default function SettingsView() {
  const [providers, setProviders] = useState([]);
  const [config, setConfig] = useState(null);
  const [daemonInfo, setDaemonInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const addToast = useGrooveStore((s) => s.addToast);
  const marketplaceUser = useGrooveStore((s) => s.marketplaceUser);
  const marketplaceAuthenticated = useGrooveStore((s) => s.marketplaceAuthenticated);
  const marketplaceLogin = useGrooveStore((s) => s.marketplaceLogin);
  const marketplaceLogout = useGrooveStore((s) => s.marketplaceLogout);

  function loadProviders() {
    api.get('/providers').then((data) => setProviders(Array.isArray(data) ? data : [])).catch(() => {});
  }

  useEffect(() => {
    Promise.all([
      api.get('/providers'),
      api.get('/config'),
      api.get('/status'),
    ]).then(([provs, cfg, info]) => {
      setProviders(Array.isArray(provs) ? provs : []);
      setConfig(cfg);
      setDaemonInfo(info);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  async function updateConfig(key, value) {
    try {
      const updated = await api.patch('/config', { [key]: value });
      setConfig(updated);
    } catch (err) {
      addToast('error', 'Update failed', err.message);
    }
  }

  if (loading) {
    return (
      <div className="h-full bg-surface-0 p-8">
        <Skeleton className="h-8 w-40 rounded-md mb-8" />
        <div className="space-y-4">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)}</div>
      </div>
    );
  }

  const installedProviders = providers.filter((p) => p.installed || p.hasKey);

  return (
    <ScrollArea className="h-full">
      <div className="max-w-2xl mx-auto px-8 py-8">

        {/* Page header */}
        <div className="mb-10">
          <h1 className="text-xl font-bold text-text-0 font-sans tracking-tight">Settings</h1>
          <p className="text-sm text-text-3 font-sans mt-1">Manage providers, configuration, and your account.</p>
        </div>

        {/* ═══════ PROVIDERS ═══════ */}
        <section className="mb-10">
          <SectionHeader
            icon={Layers}
            title="Providers"
            description="AI providers that power your agents. Each provider manages its own authentication."
          />
          <div className="space-y-2">
            {providers.map((p) => (
              <ProviderCard key={p.id} provider={p} onKeyChange={loadProviders} />
            ))}
          </div>
        </section>

        {/* ═══════ CONFIGURATION ═══════ */}
        {config && (
          <section className="mb-10">
            <SectionHeader
              icon={Settings}
              title="Configuration"
              description="Daemon behavior and defaults. Changes save automatically."
            />
            <div className="rounded-lg border border-border-subtle bg-surface-1 px-4">
              <ConfigRow icon={Cpu} label="Default Provider" description="Provider for new agents">
                <select
                  value={config.defaultProvider || 'claude-code'}
                  onChange={(e) => updateConfig('defaultProvider', e.target.value)}
                  className="h-8 px-2.5 text-xs bg-surface-0 border border-border-subtle rounded-md text-text-0 font-mono focus:outline-none focus:ring-1 focus:ring-accent cursor-pointer appearance-none pr-7"
                >
                  {installedProviders.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </ConfigRow>

              <ConfigRow icon={FolderOpen} label="Working Directory" description="Default root directory for agents">
                <code className="h-8 px-2.5 flex items-center bg-surface-0 border border-border-subtle rounded-md text-2xs font-mono text-text-2 max-w-[200px] truncate">
                  {config.defaultWorkingDir || 'Project root'}
                </code>
              </ConfigRow>

              <ConfigRow icon={RotateCw} label="Auto Rotation" description="Rotate agents when context degrades">
                <Toggle value={config.autoRotation !== false} onChange={(v) => updateConfig('autoRotation', v)} />
              </ConfigRow>

              <ConfigRow icon={Gauge} label="Rotation Threshold" description="Tokens before rotation (0 = adaptive)">
                <NumberInput value={config.rotationThreshold || 0} onChange={(v) => updateConfig('rotationThreshold', v)} min={0} step={10000} />
              </ConfigRow>

              <ConfigRow icon={ShieldCheck} label="QC Threshold" description="Agents count that triggers auto-QC">
                <NumberInput value={config.qcThreshold || 4} onChange={(v) => updateConfig('qcThreshold', v)} min={2} max={20} />
              </ConfigRow>

              <ConfigRow icon={Users} label="Max Agents" description="Concurrent agent limit (0 = unlimited)">
                <NumberInput value={config.maxAgents || 0} onChange={(v) => updateConfig('maxAgents', v)} min={0} max={50} />
              </ConfigRow>

              <ConfigRow icon={Newspaper} label="Journalist Interval" description="Seconds between synthesis cycles">
                <NumberInput value={config.journalistInterval || 120} onChange={(v) => updateConfig('journalistInterval', v)} min={30} step={30} suffix="sec" />
              </ConfigRow>
            </div>
          </section>
        )}

        {/* ═══════ ACCOUNT ═══════ */}
        <section className="mb-10">
          <SectionHeader
            icon={User}
            title="Account"
            description="Marketplace identity and daemon information."
          />

          {/* Marketplace */}
          <div className="rounded-lg border border-border-subtle bg-surface-1 p-4 mb-3">
            <div className="text-2xs font-semibold text-text-3 font-sans uppercase tracking-wider mb-3">Marketplace</div>
            {marketplaceAuthenticated ? (
              <div className="flex items-center gap-3">
                {marketplaceUser?.avatar ? (
                  <img src={marketplaceUser.avatar} alt="" className="w-9 h-9 rounded-full" />
                ) : (
                  <div className="w-9 h-9 rounded-full bg-accent/10 flex items-center justify-center">
                    <User size={16} className="text-accent" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold text-text-0 font-sans">{marketplaceUser?.displayName || 'User'}</div>
                  <div className="text-2xs text-text-3 font-sans">{marketplaceUser?.email || 'Connected'}</div>
                </div>
                <Button variant="ghost" size="sm" onClick={marketplaceLogout} className="h-8 px-2.5 text-2xs gap-1 text-text-3">
                  <LogOut size={11} /> Sign Out
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-surface-4 flex items-center justify-center">
                  <User size={16} className="text-text-4" />
                </div>
                <div className="flex-1">
                  <div className="text-xs text-text-2 font-sans">Sign in for premium skills, ratings, and favorites.</div>
                </div>
                <Button variant="primary" size="sm" onClick={marketplaceLogin} className="h-8 px-3 text-2xs gap-1.5">
                  <LogIn size={11} /> Sign In
                </Button>
              </div>
            )}
          </div>

          {/* Daemon info */}
          <div className="rounded-lg border border-border-subtle bg-surface-1 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-border-subtle">
              <div className="text-2xs font-semibold text-text-3 font-sans uppercase tracking-wider">Daemon</div>
            </div>
            <div className="grid grid-cols-2 gap-x-6">
              {[
                ['Version', daemonInfo?.version || '—'],
                ['Port', daemonInfo?.port || '31415'],
                ['Host', daemonInfo?.host || '127.0.0.1'],
                ['PID', daemonInfo?.pid || '—'],
                ['Uptime', daemonInfo?.uptime ? `${Math.round(daemonInfo.uptime / 60)}m` : '—'],
                ['Agents', daemonInfo?.agents || '0'],
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between px-4 py-2 border-b border-border-subtle last:border-b-0">
                  <span className="text-2xs text-text-4 font-sans">{label}</span>
                  <span className="text-2xs text-text-1 font-mono">{value}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Footer */}
        <div className="text-center pb-6">
          <p className="text-2xs text-text-4 font-sans">
            Groove Dev · <a href="https://groovedev.ai" target="_blank" rel="noopener" className="text-accent hover:underline">groovedev.ai</a> · <a href="https://docs.groovedev.ai" target="_blank" rel="noopener" className="text-accent hover:underline">docs</a>
          </p>
        </div>
      </div>
    </ScrollArea>
  );
}
