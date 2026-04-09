// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useEffect } from 'react';
import { useGrooveStore } from '../stores/groove';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { ScrollArea } from '../components/ui/scroll-area';
import { Skeleton } from '../components/ui/skeleton';
import { StatusDot } from '../components/ui/status-dot';
import { OllamaSetup } from '../components/agents/ollama-setup';
import { api } from '../lib/api';
import { cn } from '../lib/cn';
import { fmtUptime } from '../lib/format';
import {
  Key, Eye, EyeOff, Check, Cpu, ChevronDown,
  FolderOpen, RotateCw, Users, Gauge, Zap,
  LogIn, LogOut, User, ShieldCheck, Newspaper,
} from 'lucide-react';

/* ── Toggle ────────────────────────────────────────────────── */

function Toggle({ value, onChange }) {
  return (
    <button
      onClick={() => onChange(!value)}
      className={cn(
        'w-9 h-5 rounded-full p-0.5 transition-colors cursor-pointer',
        value ? 'bg-accent' : 'bg-surface-5',
      )}
    >
      <div className={cn(
        'w-4 h-4 rounded-full bg-white shadow-sm transition-transform',
        value ? 'translate-x-4' : 'translate-x-0',
      )} />
    </button>
  );
}

/* ── Provider Card (always visible, no expand) ─────────────── */

function ProviderCard({ provider, onKeyChange }) {
  const [settingKey, setSettingKey] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [ollamaOpen, setOllamaOpen] = useState(false);
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
      addToast('info', `Removed ${provider.name} key`);
      if (onKeyChange) onKeyChange();
    } catch (err) {
      addToast('error', 'Remove failed', err.message);
    }
  }

  // Ollama gets its own tall card with setup inline
  if (isLocal) {
    return (
      <div className="flex flex-col rounded-lg border border-border-subtle bg-surface-1 overflow-hidden min-w-[220px]">
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border-subtle">
          <StatusDot status={available ? 'running' : 'crashed'} size="sm" />
          <span className="text-[13px] font-semibold text-text-0 font-sans">{provider.name}</span>
          <div className="flex-1" />
          {available ? (
            <Badge variant="success" className="text-2xs gap-1"><Check size={8} /> Ready</Badge>
          ) : (
            <Badge variant="default" className="text-2xs">Not installed</Badge>
          )}
        </div>
        <div className="flex-1">
          {ollamaOpen ? (
            <OllamaSetup isInstalled={available} onModelChange={onKeyChange} />
          ) : (
            <div className="px-4 py-3 space-y-2">
              <div className="text-xs text-text-3 font-sans">
                {available ? `${provider.models?.length || 0} models available` : 'Local AI models — free, private, no API key'}
              </div>
              <Button
                variant={available ? 'secondary' : 'primary'}
                size="sm"
                onClick={() => setOllamaOpen(true)}
                className="w-full h-8 text-2xs gap-1.5"
              >
                <Cpu size={11} />
                {available ? 'Manage Models' : 'Set Up Ollama'}
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col rounded-lg border border-border-subtle bg-surface-1 overflow-hidden min-w-[220px]">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border-subtle">
        <StatusDot status={available ? 'running' : 'crashed'} size="sm" />
        <span className="text-[13px] font-semibold text-text-0 font-sans">{provider.name}</span>
        <div className="flex-1" />
        {available ? (
          <Badge variant="success" className="text-2xs gap-1"><Check size={8} /> Ready</Badge>
        ) : (
          <Badge variant="default" className="text-2xs">No key</Badge>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 px-4 py-3 space-y-2.5">
        {/* Models */}
        {provider.models?.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {provider.models.map((m) => (
              <span key={m.id} className="px-1.5 py-0.5 rounded bg-surface-4 text-2xs font-mono text-text-3">
                {m.name || m.id}
              </span>
            ))}
          </div>
        )}

        {/* Key input form */}
        {settingKey ? (
          <div className="space-y-1.5">
            <div className="flex gap-1.5">
              <div className="flex-1 relative">
                <input
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSetKey()}
                  type={showKey ? 'text' : 'password'}
                  placeholder="Paste API key..."
                  className="w-full h-7 px-2.5 pr-7 text-2xs bg-surface-0 border border-border rounded-md text-text-0 font-mono placeholder:text-text-4 focus:outline-none focus:ring-1 focus:ring-accent"
                  autoFocus
                />
                <button onClick={() => setShowKey(!showKey)} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-4 hover:text-text-2 cursor-pointer">
                  {showKey ? <EyeOff size={10} /> : <Eye size={10} />}
                </button>
              </div>
            </div>
            <div className="flex gap-1.5">
              <Button variant="primary" size="sm" onClick={handleSetKey} disabled={!keyInput.trim()} className="flex-1 h-7 text-2xs">Save</Button>
              <Button variant="ghost" size="sm" onClick={() => { setSettingKey(false); setKeyInput(''); }} className="h-7 text-2xs px-2">Cancel</Button>
            </div>
          </div>
        ) : provider.hasKey ? (
          /* Has API key — show connected state */
          <div className="flex items-center gap-1.5">
            <div className="flex-1 flex items-center gap-1.5 h-7 px-2 bg-success/8 border border-success/20 rounded text-2xs font-sans text-success">
              <Check size={10} /> API Connected
            </div>
            <button onClick={() => { setSettingKey(true); setShowKey(false); setKeyInput(''); }} className="text-2xs text-text-4 hover:text-accent cursor-pointer font-sans">Edit</button>
            <button onClick={handleDeleteKey} className="text-2xs text-text-4 hover:text-danger cursor-pointer font-sans">Remove</button>
          </div>
        ) : provider.authType === 'subscription' ? (
          /* Subscription provider (Claude) — show subscription status + option to add API key */
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 h-7 px-2 bg-accent/8 border border-accent/20 rounded text-2xs font-sans text-accent">
              <Check size={10} /> Subscription active
            </div>
            <button
              onClick={() => { setSettingKey(true); setShowKey(false); setKeyInput(''); }}
              className="text-2xs text-text-4 hover:text-accent cursor-pointer font-sans flex items-center gap-1"
            >
              <Key size={9} /> Add API key for headless mode
            </button>
          </div>
        ) : (
          /* No key, needs one */
          <Button variant="primary" size="sm" onClick={() => { setSettingKey(true); setShowKey(false); setKeyInput(''); }} className="w-full h-7 text-2xs gap-1">
            <Key size={10} /> Add API Key
          </Button>
        )}
      </div>
    </div>
  );
}

/* ── Config Card ───────────────────────────────────────────── */

function ConfigCard({ icon: Icon, label, description, children }) {
  return (
    <div className="rounded-lg border border-border-subtle bg-surface-1 px-4 py-3.5 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded bg-accent/8 flex items-center justify-center flex-shrink-0">
          <Icon size={12} className="text-accent" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-medium text-text-0 font-sans leading-tight">{label}</div>
        </div>
      </div>
      <div className="text-2xs text-text-4 font-sans leading-relaxed">{description}</div>
      <div className="mt-auto pt-1">{children}</div>
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
    api.get('/providers').then((d) => setProviders(Array.isArray(d) ? d : [])).catch(() => {});
  }

  useEffect(() => {
    Promise.all([api.get('/providers'), api.get('/config'), api.get('/status')])
      .then(([p, c, s]) => { setProviders(Array.isArray(p) ? p : []); setConfig(c); setDaemonInfo(s); setLoading(false); })
      .catch(() => setLoading(false));
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
      <div className="flex flex-col h-full">
        <div className="h-16 bg-surface-1 border-b border-border" />
        <div className="flex-1 p-4 space-y-4">
          <div className="flex gap-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="flex-1 h-36 rounded-lg" />)}</div>
          <div className="grid grid-cols-3 gap-3">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-28 rounded-lg" />)}</div>
        </div>
      </div>
    );
  }

  const installedProviders = providers.filter((p) => p.installed || p.hasKey);

  return (
    <div className="flex flex-col h-full">

      {/* ═══════ ACCOUNT HERO BAR ═══════ */}
      <div className="flex items-center gap-4 px-4 py-2.5 bg-surface-1 border-b border-border flex-shrink-0">
        <h2 className="text-sm font-semibold text-text-0 font-sans">Settings</h2>
        <div className="flex-1" />

        {/* Daemon info */}
        <div className="flex items-center gap-4 text-2xs text-text-3 font-sans">
          {daemonInfo?.version && <span>v{daemonInfo.version}</span>}
          {daemonInfo?.port && <span>:{daemonInfo.port}</span>}
          {daemonInfo?.uptime > 0 && <span>Up {fmtUptime(daemonInfo.uptime)}</span>}
        </div>

        <div className="w-px h-4 bg-border-subtle" />

        {/* Account */}
        {marketplaceAuthenticated ? (
          <div className="flex items-center gap-2.5">
            {marketplaceUser?.avatar ? (
              <img src={marketplaceUser.avatar} alt="" className="w-6 h-6 rounded-full" />
            ) : (
              <div className="w-6 h-6 rounded-full bg-accent/10 flex items-center justify-center">
                <User size={12} className="text-accent" />
              </div>
            )}
            <span className="text-xs font-medium text-text-0 font-sans">{marketplaceUser?.displayName || 'User'}</span>
            <button onClick={marketplaceLogout} className="text-2xs text-text-4 hover:text-text-1 cursor-pointer font-sans flex items-center gap-1">
              <LogOut size={10} /> Sign out
            </button>
          </div>
        ) : (
          <Button variant="ghost" size="sm" onClick={marketplaceLogin} className="h-7 text-2xs gap-1.5 text-text-3">
            <LogIn size={11} /> Sign in
          </Button>
        )}

        <StatusDot status="running" size="sm" />
      </div>

      {/* ═══════ SCROLLABLE BODY ═══════ */}
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">

          {/* ═══════ PROVIDERS ROW ═══════ */}
          <div>
            <div className="flex items-center gap-2 mb-2.5 px-0.5">
              <span className="text-2xs font-semibold text-text-3 font-sans uppercase tracking-wider">Providers</span>
              <div className="flex-1 h-px bg-border-subtle" />
              <span className="text-2xs text-text-4 font-sans">{installedProviders.length}/{providers.length} connected</span>
            </div>
            <div className="grid grid-cols-4 gap-3">
              {providers.map((p) => (
                <ProviderCard key={p.id} provider={p} onKeyChange={loadProviders} />
              ))}
            </div>
          </div>

          {/* ═══════ CONFIGURATION GRID ═══════ */}
          {config && (
            <div>
              <div className="flex items-center gap-2 mb-2.5 px-0.5">
                <span className="text-2xs font-semibold text-text-3 font-sans uppercase tracking-wider">Configuration</span>
                <div className="flex-1 h-px bg-border-subtle" />
                <span className="text-2xs text-text-4 font-sans">Auto-saves</span>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <ConfigCard icon={Cpu} label="Default Provider" description="Provider used when spawning new agents.">
                  <select
                    value={config.defaultProvider || 'claude-code'}
                    onChange={(e) => updateConfig('defaultProvider', e.target.value)}
                    className="w-full h-8 px-2.5 text-xs bg-surface-0 border border-border-subtle rounded-md text-text-0 font-mono focus:outline-none focus:ring-1 focus:ring-accent cursor-pointer"
                  >
                    {installedProviders.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </ConfigCard>

                <ConfigCard icon={FolderOpen} label="Working Directory" description="Default root directory for new agents.">
                  <code className="block w-full h-8 px-2.5 flex items-center bg-surface-0 border border-border-subtle rounded-md text-2xs font-mono text-text-2 truncate">
                    {config.defaultWorkingDir || 'Project root'}
                  </code>
                </ConfigCard>

                <ConfigCard icon={RotateCw} label="Auto Rotation" description="Rotate agents automatically when context window degrades.">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono text-text-2">{config.autoRotation !== false ? 'On' : 'Off'}</span>
                    <Toggle value={config.autoRotation !== false} onChange={(v) => updateConfig('autoRotation', v)} />
                  </div>
                </ConfigCard>

                <ConfigCard icon={Gauge} label="Rotation Threshold" description="Token count that triggers rotation. 0 uses adaptive threshold.">
                  <input
                    type="number"
                    value={config.rotationThreshold || 0}
                    onChange={(e) => updateConfig('rotationThreshold', parseInt(e.target.value, 10) || 0)}
                    className="w-full h-8 px-2.5 text-xs bg-surface-0 border border-border-subtle rounded-md text-text-0 font-mono focus:outline-none focus:ring-1 focus:ring-accent"
                    min={0} step={10000}
                  />
                </ConfigCard>

                <ConfigCard icon={ShieldCheck} label="QC Threshold" description="Number of running agents that triggers an auto-QC agent.">
                  <input
                    type="number"
                    value={config.qcThreshold || 4}
                    onChange={(e) => updateConfig('qcThreshold', parseInt(e.target.value, 10) || 4)}
                    className="w-full h-8 px-2.5 text-xs bg-surface-0 border border-border-subtle rounded-md text-text-0 font-mono focus:outline-none focus:ring-1 focus:ring-accent"
                    min={2} max={20}
                  />
                </ConfigCard>

                <ConfigCard icon={Users} label="Max Agents" description="Maximum concurrent agents. 0 means unlimited.">
                  <input
                    type="number"
                    value={config.maxAgents || 0}
                    onChange={(e) => updateConfig('maxAgents', parseInt(e.target.value, 10) || 0)}
                    className="w-full h-8 px-2.5 text-xs bg-surface-0 border border-border-subtle rounded-md text-text-0 font-mono focus:outline-none focus:ring-1 focus:ring-accent"
                    min={0} max={50}
                  />
                </ConfigCard>

                <ConfigCard icon={Newspaper} label="Journalist Interval" description="Seconds between automatic synthesis cycles.">
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      value={config.journalistInterval || 120}
                      onChange={(e) => updateConfig('journalistInterval', parseInt(e.target.value, 10) || 120)}
                      className="flex-1 h-8 px-2.5 text-xs bg-surface-0 border border-border-subtle rounded-md text-text-0 font-mono focus:outline-none focus:ring-1 focus:ring-accent"
                      min={30} step={30}
                    />
                    <span className="text-2xs text-text-4 font-sans">sec</span>
                  </div>
                </ConfigCard>
              </div>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
