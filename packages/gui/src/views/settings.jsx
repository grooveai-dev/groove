// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useEffect } from 'react';
import { useGrooveStore } from '../stores/groove';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { ScrollArea } from '../components/ui/scroll-area';
import { Skeleton } from '../components/ui/skeleton';
import { StatusDot } from '../components/ui/status-dot';
import { OllamaSetup } from '../components/agents/ollama-setup';
import { FolderBrowser } from '../components/agents/folder-browser';
import { api } from '../lib/api';
import { cn } from '../lib/cn';
import { fmtUptime } from '../lib/format';
import {
  Key, Eye, EyeOff, Check, Cpu, ChevronDown,
  FolderOpen, FolderSearch, RotateCw, Users, Gauge, Zap,
  LogIn, LogOut, User, ShieldCheck, Settings,
  Newspaper, Layers,
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

/* ── Provider Card ─────────────────────────────────────────── */

function ProviderCard({ provider, onKeyChange }) {
  const [settingKey, setSettingKey] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [ollamaOpen, setOllamaOpen] = useState(false);
  const addToast = useGrooveStore((s) => s.addToast);

  const isLocal = provider.authType === 'local';
  const isSubscription = provider.authType === 'subscription';
  // "Ready" means: local + installed, subscription + installed, api-key + hasKey
  const isReady = isLocal ? provider.installed : isSubscription ? provider.installed : provider.hasKey;

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

  // Ollama card
  if (isLocal) {
    return (
      <div className="flex flex-col rounded-lg border border-border-subtle bg-surface-1 overflow-hidden min-w-[220px]">
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border-subtle">
          <StatusDot status={isReady ? 'running' : 'crashed'} size="sm" />
          <span className="text-[13px] font-semibold text-text-0 font-sans">{provider.name}</span>
          <div className="flex-1" />
          {isReady ? (
            <Badge variant="success" className="text-2xs gap-1"><Check size={8} /> Ready</Badge>
          ) : (
            <Badge variant="default" className="text-2xs">Not installed</Badge>
          )}
        </div>
        <div className="flex-1">
          {ollamaOpen ? (
            <OllamaSetup isInstalled={isReady} onModelChange={onKeyChange} />
          ) : (
            <div className="px-4 py-3 flex flex-col h-full">
              <div className="text-xs text-text-3 font-sans flex-1">
                {isReady ? `${provider.models?.length || 0} models available` : 'Local AI models — free, private, no API key'}
              </div>
              <Button
                variant={isReady ? 'secondary' : 'primary'}
                size="sm"
                onClick={() => setOllamaOpen(true)}
                className="w-full h-7 text-2xs gap-1.5 mt-3"
              >
                <Cpu size={11} />
                {isReady ? 'Manage Models' : 'Set Up Ollama'}
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Standard provider card (Claude, Codex, Gemini)
  return (
    <div className="flex flex-col rounded-lg border border-border-subtle bg-surface-1 overflow-hidden min-w-[220px]">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border-subtle">
        <StatusDot status={isReady ? 'running' : 'crashed'} size="sm" />
        <span className="text-[13px] font-semibold text-text-0 font-sans">{provider.name}</span>
        <div className="flex-1" />
        {isReady ? (
          <Badge variant="success" className="text-2xs gap-1"><Check size={8} /> Ready</Badge>
        ) : (
          <Badge variant="default" className="text-2xs">{isSubscription ? 'Not installed' : 'No key'}</Badge>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 flex flex-col px-4 py-3 min-h-[120px]">
        {/* Models */}
        {provider.models?.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-3">
            {provider.models.map((m) => (
              <span key={m.id} className="px-1.5 py-0.5 rounded bg-surface-4 text-2xs font-mono text-text-3">
                {m.name || m.id}
              </span>
            ))}
          </div>
        )}

        {/* Subscription info for Claude */}
        {isSubscription && isReady && !provider.hasKey && !settingKey && (
          <div className="flex items-center gap-1.5 h-8 px-2.5 bg-accent/8 border border-accent/20 rounded-md text-2xs font-sans text-accent mb-3">
            <Check size={10} /> Subscription active
          </div>
        )}

        {/* Connected state */}
        {provider.hasKey && !settingKey && (
          <div className="flex items-center gap-2 mb-3">
            <div className="flex-1 flex items-center gap-1.5 h-8 px-2.5 bg-success/8 border border-success/20 rounded-md text-2xs font-sans text-success">
              <Check size={10} /> API Connected
            </div>
            <button onClick={() => { setSettingKey(true); setShowKey(false); setKeyInput(''); }} className="text-2xs text-text-4 hover:text-accent cursor-pointer font-sans">Edit</button>
            <button onClick={handleDeleteKey} className="text-2xs text-text-4 hover:text-danger cursor-pointer font-sans">Remove</button>
          </div>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Key input form — takes over the bottom area */}
        {settingKey && (
          <div className="space-y-2.5 pt-1">
            <div>
              <label className="text-2xs font-semibold text-text-2 font-sans mb-1.5 block">
                {provider.hasKey ? 'Update API Key' : `${provider.name} API Key`}
              </label>
              <div className="relative">
                <input
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSetKey()}
                  type={showKey ? 'text' : 'password'}
                  placeholder="sk-..."
                  className="w-full h-9 px-3 pr-9 text-xs bg-surface-0 border border-border rounded-md text-text-0 font-mono placeholder:text-text-4 focus:outline-none focus:ring-1 focus:ring-accent"
                  autoFocus
                />
                <button onClick={() => setShowKey(!showKey)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-4 hover:text-text-2 cursor-pointer">
                  {showKey ? <EyeOff size={12} /> : <Eye size={12} />}
                </button>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="primary" size="sm" onClick={handleSetKey} disabled={!keyInput.trim()} className="flex-1 h-8 text-xs">
                Save Key
              </Button>
              <Button variant="ghost" size="sm" onClick={() => { setSettingKey(false); setKeyInput(''); }} className="h-8 text-xs px-3">
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Bottom action — always at card bottom */}
        {!settingKey && !provider.hasKey && (
          <Button
            variant={isSubscription ? 'secondary' : 'primary'}
            size="sm"
            onClick={() => { setSettingKey(true); setShowKey(false); setKeyInput(''); }}
            className="w-full h-8 text-2xs gap-1.5 mt-2"
          >
            <Key size={11} />
            {isSubscription ? 'Add API key for headless mode' : 'Add API Key'}
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
        <div className="text-[13px] font-medium text-text-0 font-sans leading-tight">{label}</div>
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
  const [folderBrowserOpen, setFolderBrowserOpen] = useState(false);
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
        <div className="h-12 bg-surface-1 border-b border-border" />
        <div className="flex-1 p-4 space-y-4">
          <div className="grid grid-cols-4 gap-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-40 rounded-lg" />)}</div>
          <div className="grid grid-cols-3 gap-3">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-28 rounded-lg" />)}</div>
        </div>
      </div>
    );
  }

  const connectedCount = providers.filter((p) => {
    if (p.authType === 'local') return p.installed;
    if (p.authType === 'subscription') return p.installed;
    return p.hasKey;
  }).length;

  // Rotation threshold display: 0 = auto, otherwise show as percentage
  const rotationValue = config?.rotationThreshold || 0;
  const rotationDisplay = rotationValue === 0 ? 'auto' : `${Math.round(rotationValue * 100)}%`;

  return (
    <div className="flex flex-col h-full">

      {/* ═══════ HEADER BAR ═══════ */}
      <div className="flex items-center gap-4 px-4 py-2.5 bg-surface-1 border-b border-border flex-shrink-0">
        <h2 className="text-sm font-semibold text-text-0 font-sans">Settings</h2>
        <div className="flex-1" />

        <div className="flex items-center gap-4 text-2xs text-text-3 font-sans">
          {daemonInfo?.version && <span>v{daemonInfo.version}</span>}
          {daemonInfo?.port && <span>:{daemonInfo.port}</span>}
          {daemonInfo?.uptime > 0 && <span>Up {fmtUptime(daemonInfo.uptime)}</span>}
        </div>

        <div className="w-px h-4 bg-border-subtle" />

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

          {/* ═══════ PROVIDERS ═══════ */}
          <div>
            <div className="flex items-center gap-2 mb-2.5 px-0.5">
              <span className="text-2xs font-semibold text-text-3 font-sans uppercase tracking-wider">Providers</span>
              <div className="flex-1 h-px bg-border-subtle" />
              <span className="text-2xs text-text-4 font-sans">{connectedCount}/{providers.length} connected</span>
            </div>
            <div className="grid grid-cols-4 gap-3">
              {providers.map((p) => (
                <ProviderCard key={p.id} provider={p} onKeyChange={loadProviders} />
              ))}
            </div>
          </div>

          {/* ═══════ CONFIGURATION ═══════ */}
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
                    {providers.filter((p) => p.installed || p.hasKey).map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </ConfigCard>

                <ConfigCard icon={FolderOpen} label="Working Directory" description="Default root directory for new agents.">
                  <div className="flex items-center gap-1.5">
                    <code className="flex-1 h-8 px-2 flex items-center bg-surface-0 border border-border-subtle rounded-md text-2xs font-mono text-text-2 truncate min-w-0">
                      {config.defaultWorkingDir || 'Project root'}
                    </code>
                    <Button variant="secondary" size="sm" onClick={() => setFolderBrowserOpen(true)} className="h-8 px-2 flex-shrink-0">
                      <FolderSearch size={12} />
                    </Button>
                  </div>
                </ConfigCard>

                <ConfigCard icon={Gauge} label="Rotation Threshold" description="Context usage that triggers auto-rotation.">
                  <div className="flex bg-surface-0 rounded-md p-0.5 border border-border-subtle">
                    {['auto', '50%', '65%', '75%', '85%'].map((opt) => {
                      const val = opt === 'auto' ? 0 : parseInt(opt, 10) / 100;
                      const isActive = rotationValue === val;
                      return (
                        <button
                          key={opt}
                          onClick={() => updateConfig('rotationThreshold', val)}
                          className={cn(
                            'flex-1 px-2 py-1.5 text-2xs font-semibold font-sans rounded transition-all cursor-pointer',
                            isActive ? 'bg-accent/15 text-accent shadow-sm' : 'text-text-3 hover:text-text-1',
                          )}
                        >
                          {opt === 'auto' ? 'Auto' : opt}
                        </button>
                      );
                    })}
                  </div>
                </ConfigCard>

                <ConfigCard icon={ShieldCheck} label="QC Threshold" description="Running agents count that triggers auto-QC.">
                  <div className="flex bg-surface-0 rounded-md p-0.5 border border-border-subtle">
                    {[2, 3, 4, 6, 8].map((n) => {
                      const isActive = (config.qcThreshold || 2) === n;
                      return (
                        <button
                          key={n}
                          onClick={() => updateConfig('qcThreshold', n)}
                          className={cn(
                            'flex-1 px-2 py-1.5 text-2xs font-semibold font-sans rounded transition-all cursor-pointer',
                            isActive ? 'bg-accent/15 text-accent shadow-sm' : 'text-text-3 hover:text-text-1',
                          )}
                        >
                          {n}
                        </button>
                      );
                    })}
                  </div>
                </ConfigCard>

                <ConfigCard icon={Users} label="Max Agents" description="Concurrent agent limit. 0 = unlimited.">
                  <div className="flex bg-surface-0 rounded-md p-0.5 border border-border-subtle">
                    {[0, 4, 8, 12, 20].map((n) => {
                      const isActive = (config.maxAgents || 0) === n;
                      return (
                        <button
                          key={n}
                          onClick={() => updateConfig('maxAgents', n)}
                          className={cn(
                            'flex-1 px-2 py-1.5 text-2xs font-semibold font-sans rounded transition-all cursor-pointer',
                            isActive ? 'bg-accent/15 text-accent shadow-sm' : 'text-text-3 hover:text-text-1',
                          )}
                        >
                          {n === 0 ? '\u221E' : n}
                        </button>
                      );
                    })}
                  </div>
                </ConfigCard>

                <ConfigCard icon={Newspaper} label="Journalist Interval" description="Seconds between synthesis cycles.">
                  <div className="flex bg-surface-0 rounded-md p-0.5 border border-border-subtle">
                    {[60, 120, 300, 600].map((n) => {
                      const isActive = (config.journalistInterval || 120) === n;
                      const label = n < 60 ? `${n}s` : `${n / 60}m`;
                      return (
                        <button
                          key={n}
                          onClick={() => updateConfig('journalistInterval', n)}
                          className={cn(
                            'flex-1 px-2 py-1.5 text-2xs font-semibold font-sans rounded transition-all cursor-pointer',
                            isActive ? 'bg-accent/15 text-accent shadow-sm' : 'text-text-3 hover:text-text-1',
                          )}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </ConfigCard>

              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Folder Browser Modal */}
      <FolderBrowser
        open={folderBrowserOpen}
        onOpenChange={setFolderBrowserOpen}
        currentPath={config?.defaultWorkingDir || '/'}
        onSelect={(dir) => updateConfig('defaultWorkingDir', dir)}
      />
    </div>
  );
}
