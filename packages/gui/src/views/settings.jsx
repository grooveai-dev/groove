// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useEffect } from 'react';
import { useGrooveStore } from '../stores/groove';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { ScrollArea } from '../components/ui/scroll-area';
import { Skeleton } from '../components/ui/skeleton';
import { OllamaSetup } from '../components/agents/ollama-setup';
import { api } from '../lib/api';
import { cn } from '../lib/cn';
import {
  Key, Eye, EyeOff, Check, ChevronDown, Cpu, Layers,
  FolderOpen, RotateCw, Users, Gauge, Zap, Server,
  LogIn, LogOut, User, ShieldCheck,
} from 'lucide-react';

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
    <div className="rounded-lg border border-border-subtle bg-surface-1 overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-surface-4/30 transition-colors"
      >
        <div className={cn('w-2.5 h-2.5 rounded-full flex-shrink-0', available ? 'bg-success' : 'bg-text-4')} />
        <div className="flex-1 text-left">
          <div className="text-sm font-semibold text-text-0 font-sans">{provider.name}</div>
          <div className="text-2xs text-text-3 font-sans mt-0.5">
            {isLocal ? (available ? 'Installed' : 'Not installed') : (available ? 'Connected' : 'No API key')}
            {provider.models?.length > 0 && ` · ${provider.models.length} models`}
          </div>
        </div>
        {available && <Badge variant="success" className="text-2xs">Ready</Badge>}
        <ChevronDown size={14} className={cn('text-text-4 transition-transform', expanded && 'rotate-180')} />
      </button>

      {/* Expanded */}
      {expanded && (
        <div className="border-t border-border-subtle">
          {/* Ollama gets the full setup */}
          {isLocal ? (
            <OllamaSetup isInstalled={available} onModelChange={onKeyChange} />
          ) : (
            <div className="p-4 space-y-3">
              {/* Models list */}
              {provider.models?.length > 0 && (
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-text-1 font-sans">Models</label>
                  <div className="flex flex-wrap gap-1.5">
                    {provider.models.map((m) => (
                      <Badge key={m.id} variant="default" className="font-mono text-xs px-2.5 py-1">
                        {m.name || m.id}
                        <span className="text-text-4 ml-1.5">{m.tier}</span>
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* API Key management */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-text-1 font-sans">API Key</label>
                {settingKey ? (
                  <div className="flex gap-2">
                    <div className="flex-1 relative">
                      <input
                        value={keyInput}
                        onChange={(e) => setKeyInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSetKey()}
                        type={showKey ? 'text' : 'password'}
                        placeholder={`${provider.name} API key...`}
                        className="w-full h-9 px-3 pr-9 text-xs bg-surface-0 border border-border rounded-md text-text-0 font-mono placeholder:text-text-4 focus:outline-none focus:ring-1 focus:ring-accent"
                        autoFocus
                      />
                      <button onClick={() => setShowKey(!showKey)} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-4 hover:text-text-2 cursor-pointer">
                        {showKey ? <EyeOff size={12} /> : <Eye size={12} />}
                      </button>
                    </div>
                    <Button variant="primary" size="sm" onClick={handleSetKey} disabled={!keyInput.trim()} className="h-9 px-3">
                      Save
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => { setSettingKey(false); setKeyInput(''); }} className="h-9 px-3">
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-9 px-3 flex items-center bg-surface-0 border border-border-subtle rounded-md text-xs font-mono text-text-3">
                      {provider.hasKey ? '••••••••••••••••' : 'Not set'}
                    </div>
                    <Button variant="secondary" size="sm" onClick={() => { setSettingKey(true); setShowKey(false); setKeyInput(''); }} className="h-9 px-3 gap-1.5">
                      <Key size={12} />
                      {provider.hasKey ? 'Update' : 'Add Key'}
                    </Button>
                    {provider.hasKey && (
                      <Button variant="danger" size="sm" onClick={handleDeleteKey} className="h-9 px-3">
                        Remove
                      </Button>
                    )}
                  </div>
                )}
              </div>

              {/* Auth info */}
              <div className="text-2xs text-text-4 font-sans">
                Auth type: {provider.authType === 'subscription' ? 'Subscription (no key needed)' : 'API Key'}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Providers Tab ─────────────────────────────────────────── */

function ProvidersTab() {
  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(true);

  function load() {
    api.get('/providers').then((data) => {
      setProviders(Array.isArray(data) ? data : []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  if (loading) return <div className="p-6 space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20 rounded-lg" />)}</div>;

  return (
    <ScrollArea className="flex-1">
      <div className="p-6 space-y-3">
        <p className="text-xs text-text-3 font-sans mb-1">
          Manage AI provider connections. Groove spawns agents using these providers — each manages its own authentication.
        </p>
        {providers.map((p) => (
          <ProviderCard key={p.id} provider={p} onKeyChange={load} />
        ))}
      </div>
    </ScrollArea>
  );
}

/* ── Account Tab ───────────────────────────────────────────── */

function AccountTab() {
  const marketplaceUser = useGrooveStore((s) => s.marketplaceUser);
  const marketplaceAuthenticated = useGrooveStore((s) => s.marketplaceAuthenticated);
  const marketplaceLogin = useGrooveStore((s) => s.marketplaceLogin);
  const marketplaceLogout = useGrooveStore((s) => s.marketplaceLogout);
  const [daemonInfo, setDaemonInfo] = useState(null);

  useEffect(() => {
    api.get('/status').then(setDaemonInfo).catch(() => {});
  }, []);

  return (
    <ScrollArea className="flex-1">
      <div className="p-6 space-y-6">
        {/* Marketplace Account */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <User size={14} className="text-text-3" />
            <h3 className="text-sm font-semibold text-text-0 font-sans">Marketplace Account</h3>
          </div>
          <div className="rounded-lg border border-border-subtle bg-surface-1 p-4">
            {marketplaceAuthenticated ? (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  {marketplaceUser?.avatar ? (
                    <img src={marketplaceUser.avatar} alt="" className="w-10 h-10 rounded-full" />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-accent/15 flex items-center justify-center">
                      <User size={18} className="text-accent" />
                    </div>
                  )}
                  <div>
                    <div className="text-sm font-semibold text-text-0 font-sans">{marketplaceUser?.displayName || 'User'}</div>
                    <div className="text-2xs text-text-3 font-sans">{marketplaceUser?.email || marketplaceUser?.id || 'Signed in'}</div>
                  </div>
                  <Badge variant="success" className="text-2xs ml-auto gap-1"><ShieldCheck size={10} /> Connected</Badge>
                </div>
                <Button variant="secondary" size="sm" onClick={marketplaceLogout} className="gap-1.5">
                  <LogOut size={12} /> Sign Out
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-text-2 font-sans">
                  Sign in to install premium skills, rate marketplace content, and sync your favorites.
                </p>
                <Button variant="primary" size="md" onClick={marketplaceLogin} className="gap-1.5">
                  <LogIn size={14} /> Sign in to Marketplace
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Daemon Info */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Server size={14} className="text-text-3" />
            <h3 className="text-sm font-semibold text-text-0 font-sans">Daemon</h3>
          </div>
          <div className="rounded-lg border border-border-subtle bg-surface-1 divide-y divide-border-subtle">
            {[
              ['Version', daemonInfo?.version || '—'],
              ['Port', daemonInfo?.port || '31415'],
              ['Host', daemonInfo?.host || '127.0.0.1'],
              ['PID', daemonInfo?.pid || '—'],
              ['Uptime', daemonInfo?.uptime ? `${Math.round(daemonInfo.uptime / 60)} min` : '—'],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between px-4 py-2.5">
                <span className="text-xs text-text-3 font-sans">{label}</span>
                <span className="text-xs text-text-1 font-mono">{value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </ScrollArea>
  );
}

/* ── Configuration Tab ─────────────────────────────────────── */

function ConfigTab() {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [providers, setProviders] = useState([]);
  const addToast = useGrooveStore((s) => s.addToast);

  useEffect(() => {
    Promise.all([
      api.get('/config'),
      api.get('/providers'),
    ]).then(([cfg, provs]) => {
      setConfig(cfg);
      setProviders(Array.isArray(provs) ? provs : []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  async function updateConfig(key, value) {
    try {
      const updated = await api.patch('/config', { [key]: value });
      setConfig(updated);
      addToast('success', `Updated ${key}`);
    } catch (err) {
      addToast('error', 'Update failed', err.message);
    }
  }

  if (loading || !config) return <div className="p-6 space-y-3">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}</div>;

  const installedProviders = providers.filter((p) => p.installed || p.hasKey);

  return (
    <ScrollArea className="flex-1">
      <div className="p-6 space-y-6">

        {/* Default Provider */}
        <ConfigRow icon={Cpu} label="Default Provider" description="Provider used when spawning new agents">
          <select
            value={config.defaultProvider || 'claude-code'}
            onChange={(e) => updateConfig('defaultProvider', e.target.value)}
            className="h-9 px-3 text-xs bg-surface-0 border border-border-subtle rounded-md text-text-0 font-mono focus:outline-none focus:ring-1 focus:ring-accent cursor-pointer"
          >
            {installedProviders.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </ConfigRow>

        {/* Default Working Directory */}
        <ConfigRow icon={FolderOpen} label="Default Working Directory" description="Root directory for new agents">
          <div className="flex items-center gap-2">
            <code className="flex-1 h-9 px-3 flex items-center bg-surface-0 border border-border-subtle rounded-md text-xs font-mono text-text-1 truncate min-w-0">
              {config.defaultWorkingDir || process.cwd?.() || '/'}
            </code>
          </div>
        </ConfigRow>

        {/* Auto Rotation */}
        <ConfigRow icon={RotateCw} label="Auto Rotation" description="Automatically rotate agents when context degrades">
          <ToggleSwitch
            value={config.autoRotation !== false}
            onChange={(v) => updateConfig('autoRotation', v)}
          />
        </ConfigRow>

        {/* Rotation Threshold */}
        <ConfigRow icon={Gauge} label="Rotation Threshold" description="Token count that triggers auto-rotation (0 = adaptive)">
          <input
            type="number"
            value={config.rotationThreshold || 0}
            onChange={(e) => updateConfig('rotationThreshold', parseInt(e.target.value, 10) || 0)}
            className="w-24 h-9 px-3 text-xs text-center bg-surface-0 border border-border-subtle rounded-md text-text-0 font-mono focus:outline-none focus:ring-1 focus:ring-accent"
            min={0}
            step={10000}
          />
        </ConfigRow>

        {/* QC Threshold */}
        <ConfigRow icon={ShieldCheck} label="QC Threshold" description="Number of agents that triggers auto-QC agent">
          <input
            type="number"
            value={config.qcThreshold || 4}
            onChange={(e) => updateConfig('qcThreshold', parseInt(e.target.value, 10) || 4)}
            className="w-24 h-9 px-3 text-xs text-center bg-surface-0 border border-border-subtle rounded-md text-text-0 font-mono focus:outline-none focus:ring-1 focus:ring-accent"
            min={2}
            max={20}
          />
        </ConfigRow>

        {/* Max Agents */}
        <ConfigRow icon={Users} label="Max Agents" description="Maximum concurrent agents (0 = unlimited)">
          <input
            type="number"
            value={config.maxAgents || 0}
            onChange={(e) => updateConfig('maxAgents', parseInt(e.target.value, 10) || 0)}
            className="w-24 h-9 px-3 text-xs text-center bg-surface-0 border border-border-subtle rounded-md text-text-0 font-mono focus:outline-none focus:ring-1 focus:ring-accent"
            min={0}
            max={50}
          />
        </ConfigRow>

        {/* Journalist Interval */}
        <ConfigRow icon={Zap} label="Journalist Interval" description="Seconds between automatic synthesis cycles">
          <input
            type="number"
            value={config.journalistInterval || 120}
            onChange={(e) => updateConfig('journalistInterval', parseInt(e.target.value, 10) || 120)}
            className="w-24 h-9 px-3 text-xs text-center bg-surface-0 border border-border-subtle rounded-md text-text-0 font-mono focus:outline-none focus:ring-1 focus:ring-accent"
            min={30}
            step={30}
          />
        </ConfigRow>
      </div>
    </ScrollArea>
  );
}

function ConfigRow({ icon: Icon, label, description, children }) {
  return (
    <div className="flex items-center gap-4 rounded-lg border border-border-subtle bg-surface-1 px-4 py-3">
      <Icon size={16} className="text-text-3 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-text-0 font-sans">{label}</div>
        <div className="text-2xs text-text-3 font-sans mt-0.5">{description}</div>
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  );
}

function ToggleSwitch({ value, onChange }) {
  return (
    <button
      onClick={() => onChange(!value)}
      className={cn(
        'w-10 h-6 rounded-full p-0.5 transition-colors cursor-pointer',
        value ? 'bg-accent' : 'bg-surface-5',
      )}
    >
      <div className={cn(
        'w-5 h-5 rounded-full bg-white shadow-sm transition-transform',
        value ? 'translate-x-4' : 'translate-x-0',
      )} />
    </button>
  );
}

/* ── Main View ─────────────────────────────────────────────── */

export default function SettingsView() {
  return (
    <Tabs defaultValue="providers" className="flex flex-col h-full">
      <div className="px-6 pt-3 bg-surface-1 border-b border-border">
        <div className="flex items-center gap-4 mb-0">
          <h2 className="text-base font-semibold text-text-0 font-sans">Settings</h2>
        </div>
        <TabsList className="border-b-0">
          <TabsTrigger value="providers">Providers</TabsTrigger>
          <TabsTrigger value="config">Configuration</TabsTrigger>
          <TabsTrigger value="account">Account</TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="providers" className="flex-1 min-h-0">
        <ProvidersTab />
      </TabsContent>
      <TabsContent value="config" className="flex-1 min-h-0">
        <ConfigTab />
      </TabsContent>
      <TabsContent value="account" className="flex-1 min-h-0">
        <AccountTab />
      </TabsContent>
    </Tabs>
  );
}
