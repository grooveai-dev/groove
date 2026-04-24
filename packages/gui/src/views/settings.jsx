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
import { ProviderSetupWizard } from '../components/settings/ProviderSetupWizard';
import { Sheet, SheetContent } from '../components/ui/sheet';
import { api } from '../lib/api';
import { cn } from '../lib/cn';
import { fmtUptime } from '../lib/format';
import {
  Key, Eye, EyeOff, Check, Cpu, Download, Loader2, RefreshCw, Terminal, Copy,
  FolderOpen, FolderSearch, Users, Gauge, ChevronRight,
  ShieldCheck, Settings, Lock,
  Newspaper, Radio, Send, MessageSquare, MessageCircle,
  Plus, Trash2, Plug, PlugZap, TestTube, X, HelpCircle, ExternalLink,
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

const KEY_PLACEHOLDERS = {
  'claude-code': 'sk-ant-...',
  codex: 'Paste from platform.openai.com',
  gemini: 'Paste from aistudio.google.com',
  grok: 'xai-...',
};

function ProviderCard({ provider, onKeyChange }) {
  const [settingKey, setSettingKey] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [ollamaOpen, setOllamaOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(0);
  const [customPathOpen, setCustomPathOpen] = useState(false);
  const [customPath, setCustomPath] = useState('');
  const [savingPath, setSavingPath] = useState(false);
  const [loginPending, setLoginPending] = useState(false);
  const addToast = useGrooveStore((s) => s.addToast);
  const installProgress = useGrooveStore((s) => s.providerInstallProgress[provider.id]);
  const loginProvider = useGrooveStore((s) => s.loginProvider);
  const setProviderPath = useGrooveStore((s) => s.setProviderPath);
  const verifyProvider = useGrooveStore((s) => s.verifyProvider);
  const installProvider = useGrooveStore((s) => s.installProvider);
  const [checking, setChecking] = useState(false);

  const isLocal = provider.authType === 'local';
  const isSubscription = provider.authType === 'subscription';
  const isReady = isLocal ? provider.installed
    : isSubscription ? (provider.installed || provider.authStatus?.authenticated)
    : (provider.installed && provider.hasKey);

  async function handleSetKey() {
    if (!keyInput.trim()) return;
    try {
      await api.post(`/credentials/${encodeURIComponent(provider.id)}`, { key: keyInput.trim() });
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
      await api.delete(`/credentials/${encodeURIComponent(provider.id)}`);
      addToast('info', `Removed ${provider.name} key`);
      if (onKeyChange) onKeyChange();
    } catch (err) {
      addToast('error', 'Remove failed', err.message);
    }
  }

  async function handleLogin(body) {
    try {
      setLoginPending(true);
      await loginProvider(provider.id, body);
    } catch {
      setLoginPending(false);
    }
  }

  async function handleSavePath() {
    if (!customPath.trim()) return;
    setSavingPath(true);
    try {
      await setProviderPath(provider.id, customPath.trim());
      setCustomPathOpen(false);
      if (onKeyChange) onKeyChange();
    } catch { /* handled in store */ }
    setSavingPath(false);
  }

  function openWizard(step = 0) {
    setWizardStep(step);
    setWizardOpen(true);
  }

  // Local models card
  if (isLocal) {
    const installedCount = provider.models?.filter(m => !m.disabled)?.length || 0;
    const goToModels = () => useGrooveStore.getState().setActiveView('models');
    return (
      <div className="flex flex-col rounded-lg border border-border-subtle bg-surface-1 overflow-hidden min-w-[220px]">
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border-subtle">
          <StatusDot status={isReady && installedCount > 0 ? 'running' : 'crashed'} size="sm" />
          <span className="text-[13px] font-semibold text-text-0 font-sans">{provider.name}</span>
          <div className="flex-1" />
          {isReady && installedCount > 0 ? (
            <Badge variant="success" className="text-2xs gap-1"><Check size={8} /> {installedCount} models</Badge>
          ) : isReady ? (
            <Badge variant="warning" className="text-2xs">No models pulled</Badge>
          ) : (
            <Badge variant="default" className="text-2xs">Not set up</Badge>
          )}
        </div>
        <div className="flex-1">
          {ollamaOpen ? (
            <>
              <OllamaSetup isInstalled={isReady} onModelChange={onKeyChange} />
              <div className="px-4 py-2 border-t border-border-subtle flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => setOllamaOpen(false)} className="flex-1 h-7 text-2xs">
                  Back
                </Button>
                <Button variant="secondary" size="sm" onClick={() => { setOllamaOpen(false); goToModels(); }} className="flex-1 h-7 text-2xs gap-1">
                  Models Tab
                </Button>
              </div>
            </>
          ) : (
            <div className="px-4 py-3 flex flex-col h-full">
              <div className="text-xs text-text-3 font-sans flex-1">
                {isReady && installedCount > 0
                  ? 'Full agentic runtime — tool calling, context rotation, zero cloud cost'
                  : isReady
                    ? 'Ollama is running. Pull a model to start using local agents.'
                    : 'Run any open-source model locally — free, private, fully offline. Requires Ollama.'}
              </div>
              <div className="flex gap-2 mt-3">
                {!isReady ? (
                  <Button variant="primary" size="sm" onClick={() => setOllamaOpen(true)} className="flex-1 h-7 text-2xs gap-1.5">
                    <Cpu size={11} /> Set Up Ollama
                  </Button>
                ) : (
                  <Button variant="primary" size="sm" onClick={() => setOllamaOpen(true)} className="flex-1 h-7 text-2xs gap-1.5">
                    <Cpu size={11} /> {installedCount > 0 ? 'Manage' : 'Pull Models'}
                  </Button>
                )}
                <Button variant="secondary" size="sm" onClick={goToModels} className="flex-1 h-7 text-2xs gap-1.5">
                  Models Tab
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  const isInstalling = installProgress?.installing;

  // Standard provider card (Claude, Codex, Gemini)
  return (
    <>
      <div className="flex flex-col rounded-lg border border-border-subtle bg-surface-1 overflow-hidden min-w-[220px]">
        {/* Header */}
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border-subtle">
          <StatusDot status={isReady ? 'running' : isInstalling ? 'idle' : 'crashed'} size="sm" />
          <span className="text-[13px] font-semibold text-text-0 font-sans">{provider.name}</span>
          <div className="flex-1" />
          {isReady ? (
            <Badge variant="success" className="text-2xs gap-1"><Check size={8} /> Ready</Badge>
          ) : isInstalling ? (
            <Badge variant="default" className="text-2xs gap-1"><Loader2 size={8} className="animate-spin" /> Installing</Badge>
          ) : (
            <Badge variant="default" className="text-2xs">{!provider.installed ? 'Not installed' : isSubscription ? 'Not signed in' : 'No key'}</Badge>
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

          {/* Installing progress bar */}
          {isInstalling && (
            <div className="space-y-2 mb-3">
              <div className="h-1.5 bg-surface-4 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-accent to-accent/60 rounded-full transition-all duration-500 ease-out"
                  style={{ width: `${Math.max(installProgress?.percent || 0, 5)}%` }}
                />
              </div>
              <p className="text-2xs text-text-3 font-sans">{installProgress?.message || 'Installing...'}</p>
            </div>
          )}

          {/* Not installed */}
          {!provider.installed && !isInstalling && !settingKey && (
            <div className="flex flex-col gap-2.5 flex-1">
              {/* Install error from last attempt */}
              {installProgress?.error && (
                <div className="p-2.5 bg-danger/5 border border-danger/15 rounded-md">
                  <p className="text-2xs text-danger font-sans break-all">{installProgress.error}</p>
                </div>
              )}

              {/* Auto-install button */}
              <Button
                variant="primary"
                size="sm"
                onClick={() => installProvider(provider.id).catch(() => {})}
                className="w-full h-8 text-2xs gap-1.5"
              >
                <Download size={11} /> Install {provider.name}
              </Button>

              {/* Manual install command */}
              {provider.installCommand && (
                <div className="space-y-1">
                  <p className="text-2xs text-text-4 font-sans">Or install manually in your terminal:</p>
                  <div className="flex items-center gap-1">
                    <code className="flex-1 px-2 py-1.5 bg-surface-0 border border-border-subtle rounded text-2xs font-mono text-text-2 select-all">
                      {provider.installCommand}
                    </code>
                    <button
                      onClick={() => { navigator.clipboard.writeText(provider.installCommand); addToast('success', 'Copied'); }}
                      className="p-1.5 text-text-4 hover:text-text-2 cursor-pointer"
                    >
                      <Copy size={10} />
                    </button>
                  </div>
                </div>
              )}

              {/* Re-check + custom path */}
              <div className="flex items-center gap-2 pt-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={async () => {
                    setChecking(true);
                    try {
                      await verifyProvider(provider.id);
                      if (onKeyChange) onKeyChange();
                    } catch { /* handled in store */ }
                    setChecking(false);
                  }}
                  disabled={checking}
                  className="h-7 text-2xs gap-1 px-2"
                >
                  <RefreshCw size={10} className={checking ? 'animate-spin' : ''} /> Re-check
                </Button>
                <button
                  onClick={() => setCustomPathOpen(!customPathOpen)}
                  className="text-2xs text-text-4 hover:text-accent cursor-pointer font-sans"
                >
                  Set custom path
                </button>
              </div>

              {/* Custom path input (shown for not-installed too) */}
              {customPathOpen && (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <input
                      value={customPath}
                      onChange={(e) => setCustomPath(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSavePath()}
                      placeholder={`/path/to/${provider.id}`}
                      className="flex-1 h-7 px-2 text-2xs bg-surface-0 border border-border-subtle rounded-md text-text-0 font-mono placeholder:text-text-4 focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                    <Button variant="primary" size="sm" onClick={handleSavePath} disabled={!customPath.trim() || savingPath} className="h-7 text-2xs px-2.5">
                      {savingPath ? '...' : 'Save'}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Installed but needs auth */}
          {provider.installed && !isReady && !settingKey && !isInstalling && (
            <div className="flex flex-col gap-3 flex-1">
              {/* ── Claude Code auth ── */}
              {provider.id === 'claude-code' && !loginPending && (
                <>
                  <div className="space-y-1.5">
                    <p className="text-xs text-text-1 font-sans font-medium">Sign in with your Claude account</p>
                    <p className="text-2xs text-text-3 font-sans">A browser window will open where you can sign in with your existing Anthropic account or Claude subscription.</p>
                  </div>
                  <Button variant="primary" size="sm" onClick={() => handleLogin()} className="w-full h-9 text-xs gap-1.5">
                    <ExternalLink size={12} /> Sign In
                  </Button>
                  <button
                    onClick={() => { setSettingKey(true); setShowKey(false); setKeyInput(''); }}
                    className="text-2xs text-text-4 hover:text-accent cursor-pointer font-sans text-center"
                  >
                    I have an API key instead
                  </button>
                </>
              )}

              {/* ── Codex auth ── */}
              {provider.id === 'codex' && !loginPending && (
                <>
                  <div className="space-y-1.5">
                    <p className="text-xs text-text-1 font-sans font-medium">Sign in with your ChatGPT account</p>
                    <p className="text-2xs text-text-3 font-sans">A browser window will open where you can sign in with your ChatGPT Plus or Teams subscription.</p>
                  </div>
                  <Button variant="primary" size="sm" onClick={() => handleLogin({ method: 'chatgpt-plus' })} className="w-full h-9 text-xs gap-1.5">
                    <ExternalLink size={12} /> Sign In
                  </Button>
                  <button
                    onClick={() => { setSettingKey(true); setShowKey(false); setKeyInput(''); }}
                    className="text-2xs text-text-4 hover:text-accent cursor-pointer font-sans text-center"
                  >
                    I have an API key instead
                  </button>
                </>
              )}

              {/* ── Gemini auth ── */}
              {provider.id === 'gemini' && (
                <>
                  <div className="space-y-2">
                    <p className="text-xs text-text-1 font-sans font-medium">Add your Gemini API key</p>
                    <div className="space-y-1.5">
                      <div className="flex items-start gap-2">
                        <span className="text-2xs font-bold text-accent font-mono mt-0.5">1</span>
                        <p className="text-2xs text-text-2 font-sans">
                          Go to <button onClick={() => window.open('https://aistudio.google.com/apikey', '_blank')} className="text-accent hover:underline cursor-pointer font-sans">aistudio.google.com</button> and sign in with Google
                        </p>
                      </div>
                      <div className="flex items-start gap-2">
                        <span className="text-2xs font-bold text-accent font-mono mt-0.5">2</span>
                        <p className="text-2xs text-text-2 font-sans">Click "Create API Key" and copy it</p>
                      </div>
                      <div className="flex items-start gap-2">
                        <span className="text-2xs font-bold text-accent font-mono mt-0.5">3</span>
                        <p className="text-2xs text-text-2 font-sans">Paste it below</p>
                      </div>
                    </div>
                  </div>
                  <div className="relative">
                    <input
                      value={keyInput}
                      onChange={(e) => setKeyInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSetKey()}
                      type={showKey ? 'text' : 'password'}
                      placeholder="AIza..."
                      className="w-full h-9 px-3 pr-9 text-xs bg-surface-0 border border-border rounded-md text-text-0 font-mono placeholder:text-text-4 focus:outline-none focus:ring-1 focus:ring-accent"
                      autoFocus
                    />
                    <button onClick={() => setShowKey(!showKey)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-4 hover:text-text-2 cursor-pointer">
                      {showKey ? <EyeOff size={12} /> : <Eye size={12} />}
                    </button>
                  </div>
                  <Button variant="primary" size="sm" onClick={handleSetKey} disabled={!keyInput.trim()} className="w-full h-8 text-xs">
                    Save Key
                  </Button>
                </>
              )}

              {/* ── Grok (xAI) auth ── */}
              {provider.id === 'grok' && (
                <>
                  <div className="space-y-2">
                    <p className="text-xs text-text-1 font-sans font-medium">Add your xAI API key</p>
                    <div className="space-y-1.5">
                      <div className="flex items-start gap-2">
                        <span className="text-2xs font-bold text-accent font-mono mt-0.5">1</span>
                        <p className="text-2xs text-text-2 font-sans">
                          Go to <button onClick={() => window.open('https://console.x.ai', '_blank')} className="text-accent hover:underline cursor-pointer font-sans">console.x.ai</button> and sign in
                        </p>
                      </div>
                      <div className="flex items-start gap-2">
                        <span className="text-2xs font-bold text-accent font-mono mt-0.5">2</span>
                        <p className="text-2xs text-text-2 font-sans">Create an API key and copy it</p>
                      </div>
                      <div className="flex items-start gap-2">
                        <span className="text-2xs font-bold text-accent font-mono mt-0.5">3</span>
                        <p className="text-2xs text-text-2 font-sans">Paste it below</p>
                      </div>
                    </div>
                  </div>
                  <div className="relative">
                    <input
                      value={keyInput}
                      onChange={(e) => setKeyInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSetKey()}
                      type={showKey ? 'text' : 'password'}
                      placeholder="xai-..."
                      className="w-full h-9 px-3 pr-9 text-xs bg-surface-0 border border-border rounded-md text-text-0 font-mono placeholder:text-text-4 focus:outline-none focus:ring-1 focus:ring-accent"
                      autoFocus
                    />
                    <button onClick={() => setShowKey(!showKey)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-4 hover:text-text-2 cursor-pointer">
                      {showKey ? <EyeOff size={12} /> : <Eye size={12} />}
                    </button>
                  </div>
                  <Button variant="primary" size="sm" onClick={handleSetKey} disabled={!keyInput.trim()} className="w-full h-8 text-xs">
                    Save Key
                  </Button>
                </>
              )}

              {/* ── Any provider: login pending state ── */}
              {(provider.id === 'claude-code' || provider.id === 'codex') && loginPending && (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-2 p-3 bg-accent/5 border border-accent/15 rounded-md">
                    <Loader2 size={14} className="text-accent animate-spin" />
                    <div>
                      <p className="text-xs text-accent font-sans font-medium">Check your browser</p>
                      <p className="text-2xs text-text-3 font-sans">Complete the sign-in in the browser window that opened.</p>
                    </div>
                  </div>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => { setLoginPending(false); if (onKeyChange) onKeyChange(); }}
                    className="w-full h-8 text-xs gap-1.5"
                  >
                    <Check size={12} /> I've signed in
                  </Button>
                  <button
                    onClick={() => setLoginPending(false)}
                    className="text-2xs text-text-4 hover:text-text-2 cursor-pointer font-sans text-center"
                  >
                    Cancel
                  </button>
                </div>
              )}
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

          {/* Key input form */}
          {settingKey && (
            <div className="space-y-2.5 pt-1">
              <div>
                <label className="text-2xs font-semibold text-text-2 font-sans mb-1.5 block">
                  {provider.hasKey ? 'Update API Key' : `${provider.name} API Key`}
                </label>
                {!provider.hasKey && provider.id === 'claude-code' && (
                  <p className="text-2xs text-text-3 font-sans mb-1.5">
                    Get yours at <button onClick={() => window.open('https://console.anthropic.com/settings/keys', '_blank')} className="text-accent hover:underline cursor-pointer font-sans">console.anthropic.com</button>
                  </p>
                )}
                {!provider.hasKey && provider.id === 'codex' && (
                  <p className="text-2xs text-text-3 font-sans mb-1.5">
                    Get yours at <button onClick={() => window.open('https://platform.openai.com/api-keys', '_blank')} className="text-accent hover:underline cursor-pointer font-sans">platform.openai.com</button>
                  </p>
                )}
                {!provider.hasKey && provider.id === 'gemini' && (
                  <p className="text-2xs text-text-3 font-sans mb-1.5">
                    Get yours at <button onClick={() => window.open('https://aistudio.google.com/apikey', '_blank')} className="text-accent hover:underline cursor-pointer font-sans">aistudio.google.com</button>
                  </p>
                )}
                {!provider.hasKey && provider.id === 'grok' && (
                  <p className="text-2xs text-text-3 font-sans mb-1.5">
                    Get yours at <button onClick={() => window.open('https://console.x.ai', '_blank')} className="text-accent hover:underline cursor-pointer font-sans">console.x.ai</button>
                  </p>
                )}
                <div className="relative">
                  <input
                    value={keyInput}
                    onChange={(e) => setKeyInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSetKey()}
                    type={showKey ? 'text' : 'password'}
                    placeholder={KEY_PLACEHOLDERS[provider.id] || 'sk-...'}
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

          {/* Bottom action for ready cards — add key for headless */}
          {isReady && !settingKey && !provider.hasKey && isSubscription && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => { setSettingKey(true); setShowKey(false); setKeyInput(''); }}
              className="w-full h-8 text-2xs gap-1.5 mt-2"
            >
              <Key size={11} />
              Add API key for headless mode
            </Button>
          )}
        </div>

        {/* Custom path section */}
        {provider.installed && (
          <div className="border-t border-border-subtle">
            <button
              onClick={() => setCustomPathOpen(!customPathOpen)}
              className="w-full flex items-center gap-2 px-4 py-2 text-left cursor-pointer hover:bg-surface-5/30 transition-colors"
            >
              <ChevronRight
                size={10}
                className={cn('text-text-4 transition-transform duration-200', customPathOpen && 'rotate-90')}
              />
              <span className="text-2xs text-text-4 font-sans">Set custom path</span>
            </button>
            {customPathOpen && (
              <div className="px-4 pb-3 space-y-2">
                <div className="flex gap-2">
                  <input
                    value={customPath}
                    onChange={(e) => setCustomPath(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSavePath()}
                    placeholder={`/path/to/${provider.id}`}
                    className="flex-1 h-7 px-2 text-2xs bg-surface-0 border border-border-subtle rounded-md text-text-0 font-mono placeholder:text-text-4 focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                  <Button variant="primary" size="sm" onClick={handleSavePath} disabled={!customPath.trim() || savingPath} className="h-7 text-2xs px-2.5">
                    {savingPath ? '...' : 'Save'}
                  </Button>
                </div>
                <p className="text-2xs text-text-4 font-sans">For non-standard install locations</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Setup wizard modal */}
      <ProviderSetupWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        providerId={provider.id}
        initialStep={wizardStep}
        onComplete={onKeyChange}
      />
    </>
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

/* ── Gateway Icons ─────────────────────────────────────────── */

const GATEWAY_ICONS = { telegram: Send, discord: MessageSquare, slack: MessageCircle };
const GATEWAY_LABELS = { telegram: 'Telegram', discord: 'Discord', slack: 'Slack' };
const GATEWAY_PLACEHOLDERS = { telegram: 'Bot token from @BotFather', discord: 'Bot token from Developer Portal', slack: 'Bot token (xoxb-...)' };
const NOTIFICATION_PRESETS = ['critical', 'lifecycle', 'all'];

/* ── Gateway Setup Guide (Sheet Panel) ────────────────────── */

function GatewaySetupGuide({ type, open, onOpenChange }) {
  if (!type) return null;

  const guides = {
    telegram: {
      title: 'Set Up Telegram',
      icon: Send,
      intro: 'Create a Telegram bot and connect it to Groove in under 2 minutes. No dependencies required.',
      sections: [
        {
          title: 'Create Your Bot',
          steps: [
            { text: 'Open Telegram on any device and search for', link: 'https://t.me/BotFather', linkText: '@BotFather' },
            { text: 'Send /newbot to start the setup' },
            { text: 'Choose a display name — we suggest GroovePilot' },
            { text: 'Choose a username (must end in "bot") — e.g. GroovePilot_bot' },
            { text: 'BotFather will reply with your bot token — copy it' },
          ],
        },
        {
          title: 'Connect to Groove',
          steps: [
            { text: 'In Groove Settings > Gateways, click Set Token on the Telegram card' },
            { text: 'Paste your bot token and click Save' },
            { text: 'The gateway will connect automatically' },
          ],
        },
        {
          title: 'Link a Chat',
          steps: [
            { text: 'Open a chat with your new bot in Telegram' },
            { text: 'Send any message (e.g. "hello") — Groove captures the chat ID automatically' },
            { text: 'Click Test in the gateway card to verify' },
          ],
        },
        {
          title: 'Commands',
          note: 'All commands use / prefix in Telegram:',
          commands: ['/instruct <team> <msg>', '/query <team> <question>', '/plan <description>', '/log <team>', '/brief', '/tokens', '/status', '/agents', '/help'],
        },
      ],
    },
    discord: {
      title: 'Set Up Discord',
      icon: MessageSquare,
      intro: 'Create a Discord bot and add it to your server. Requires discord.js (installed automatically with Groove).',
      sections: [
        {
          title: 'Create the Application',
          steps: [
            { text: 'Go to the', link: 'https://discord.com/developers/applications', linkText: 'Discord Developer Portal' },
            { text: 'Click New Application and name it GroovePilot' },
            { text: 'Go to the Bot tab in the left sidebar' },
            { text: 'Click Reset Token and copy the bot token' },
          ],
        },
        {
          title: 'Set Permissions & Invite',
          steps: [
            { text: 'Go to OAuth2 > URL Generator' },
            { text: 'Under Scopes, check bot' },
            { text: 'Under Bot Permissions, check:' },
          ],
          scopes: ['Send Messages', 'Read Message History', 'Embed Links', 'Use External Emojis'],
          after: [
            { text: 'Copy the generated URL at the bottom and open it in your browser' },
            { text: 'Select your server and click Authorize' },
          ],
        },
        {
          title: 'Enable Message Content Intent',
          steps: [
            { text: 'Go back to the Bot tab in the Developer Portal' },
            { text: 'Scroll to Privileged Gateway Intents' },
            { text: 'Enable Message Content Intent — required for the bot to read commands' },
            { text: 'Click Save Changes' },
          ],
        },
        {
          title: 'Connect to Groove',
          steps: [
            { text: 'In Groove Settings > Gateways, click Set Token on the Discord card' },
            { text: 'Paste your bot token and click Save' },
            { text: 'Send a message in any channel where the bot is — Groove captures the channel automatically' },
          ],
        },
        {
          title: 'Commands',
          note: 'All commands use / prefix in Discord:',
          commands: ['/instruct <team> <msg>', '/query <team> <question>', '/plan <description>', '/log <team>', '/brief', '/tokens', '/status', '/agents', '/help'],
        },
      ],
    },
    slack: {
      title: 'Set Up Slack',
      icon: MessageCircle,
      intro: 'Create a Slack app with Socket Mode — no public URL needed. Requires @slack/bolt (installed automatically with Groove).',
      sections: [
        {
          title: 'Create the App',
          steps: [
            { text: 'Go to', link: 'https://api.slack.com/apps', linkText: 'api.slack.com/apps' },
            { text: 'Click Create New App > From scratch' },
            { text: 'Name it GroovePilot and select your workspace' },
          ],
        },
        {
          title: 'Enable Socket Mode',
          steps: [
            { text: 'In the left sidebar, go to Settings > Socket Mode' },
            { text: 'Toggle Enable Socket Mode to on' },
            { text: 'It will ask you to create an App-Level Token' },
            { text: 'Name it "groove", add the connections:write scope' },
            { text: 'Click Generate — copy the xapp-... token (this is your App Token)' },
          ],
          important: 'Save this token now — you can\'t view it again after closing the dialog.',
        },
        {
          title: 'Set Bot Token Scopes',
          steps: [
            { text: 'Go to Features > OAuth & Permissions' },
            { text: 'Scroll to Bot Token Scopes and add all of these:' },
          ],
          scopes: ['chat:write', 'channels:read', 'channels:history', 'groups:read', 'groups:history', 'im:history', 'app_mentions:read'],
          after: [
            { text: 'Scroll up and click Install to Workspace' },
            { text: 'Click Allow to grant permissions' },
            { text: 'Copy the Bot User OAuth Token (xoxb-...) — this is your Bot Token' },
          ],
        },
        {
          title: 'Enable Events',
          steps: [
            { text: 'Go to Features > Event Subscriptions' },
            { text: 'Toggle Enable Events to on' },
            { text: 'Under Subscribe to bot events, add:' },
          ],
          scopes: ['message.channels', 'message.im', 'app_mention'],
          after: [
            { text: 'Click Save Changes at the bottom' },
          ],
        },
        {
          title: 'Connect to Groove',
          steps: [
            { text: 'In Groove Settings > Gateways, click Set Token on the Slack card' },
            { text: 'Paste your Bot Token (xoxb-...) in the first field' },
            { text: 'Paste your App Token (xapp-...) in the second field' },
            { text: 'Click Save — Groove will auto-connect' },
          ],
        },
        {
          title: 'Link a Channel',
          steps: [
            { text: 'Invite the bot to a channel: /invite @GroovePilot' },
            { text: 'Select the channel from the dropdown in the gateway card' },
            { text: 'Or @mention the bot — it will auto-capture the channel' },
            { text: 'Click Test to verify' },
          ],
          important: 'For private channels, make sure you added the groups:read scope.',
        },
        {
          title: 'Commands',
          note: 'In Slack, use plain text commands (no / prefix) or @mention the bot:',
          commands: ['instruct <team> <msg>', 'query <team> <question>', 'plan <description>', 'log <team>', 'brief', 'tokens', 'status', 'agents', 'help', '@GroovePilot status'],
        },
      ],
    },
  };

  const guide = guides[type];
  if (!guide) return null;
  const Icon = guide.icon;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent title={guide.title} width={480}>
        <div className="px-5 py-4 space-y-5">
          {/* Intro */}
          <div className="flex items-start gap-3 p-3 bg-accent/5 border border-accent/15 rounded-lg">
            <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center flex-shrink-0 mt-0.5">
              <Icon size={16} className="text-accent" />
            </div>
            <p className="text-xs text-text-2 font-sans leading-relaxed">{guide.intro}</p>
          </div>

          {/* Sections */}
          {guide.sections.map((section, si) => (
            <div key={si}>
              <h3 className="text-xs font-semibold text-text-0 font-sans mb-2.5 flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-accent/10 flex items-center justify-center text-2xs font-bold text-accent">{si + 1}</span>
                {section.title}
              </h3>

              {section.note && (
                <p className="text-2xs text-text-3 font-sans mb-2">{section.note}</p>
              )}

              {section.steps && (
                <ol className="space-y-2 mb-2">
                  {section.steps.map((step, i) => (
                    <li key={i} className="flex gap-2 text-2xs text-text-2 font-sans leading-relaxed">
                      <span className="text-text-4 font-mono w-4 flex-shrink-0 pt-px">{i + 1}.</span>
                      <span>
                        {step.text}
                        {step.link && (
                          <>
                            {' '}
                            <a href={step.link} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline inline-flex items-center gap-0.5 font-medium">
                              {step.linkText}<ExternalLink size={9} />
                            </a>
                          </>
                        )}
                      </span>
                    </li>
                  ))}
                </ol>
              )}

              {section.scopes && (
                <div className="flex flex-wrap gap-1.5 mb-2 ml-6">
                  {section.scopes.map((s) => (
                    <code key={s} className="px-2 py-0.5 rounded bg-surface-4 text-2xs font-mono text-accent">{s}</code>
                  ))}
                </div>
              )}

              {section.after && (
                <ol className="space-y-2 mb-2" start={(section.steps?.length || 0) + 1}>
                  {section.after.map((step, i) => (
                    <li key={i} className="flex gap-2 text-2xs text-text-2 font-sans leading-relaxed">
                      <span className="text-text-4 font-mono w-4 flex-shrink-0 pt-px">{(section.steps?.length || 0) + i + 1}.</span>
                      <span>{step.text}</span>
                    </li>
                  ))}
                </ol>
              )}

              {section.important && (
                <div className="ml-6 p-2 bg-warning/8 border border-warning/20 rounded-md text-2xs text-warning font-sans">
                  {section.important}
                </div>
              )}

              {section.commands && (
                <div className="ml-6 p-2.5 bg-surface-0 border border-border-subtle rounded-md space-y-1">
                  {section.commands.map((cmd) => (
                    <code key={cmd} className="block text-2xs font-mono text-text-1">{cmd}</code>
                  ))}
                </div>
              )}
            </div>
          ))}

          {/* Link to full docs */}
          <a
            href="https://docs.groovedev.ai/guide/gateways"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-2xs text-accent hover:text-accent/80 font-sans font-medium mt-2"
          >
            <ExternalLink size={10} />
            Full documentation at docs.groovedev.ai
          </a>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ── Gateway Card ─────────────────────────────────────────── */

function GatewayCard({ gateway, onRefresh }) {
  const [settingToken, setSettingToken] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [appTokenInput, setAppTokenInput] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [testing, setTesting] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [channels, setChannels] = useState([]);
  const [showGuide, setShowGuide] = useState(false);
  const addToast = useGrooveStore((s) => s.addToast);

  // Fetch channels when connected Slack gateway has no chatId
  useEffect(() => {
    if (gateway.connected && !gateway.chatId && gateway.type === 'slack') {
      api.get(`/gateways/${encodeURIComponent(gateway.id)}/channels`).then((ch) => setChannels(Array.isArray(ch) ? ch : [])).catch(() => {});
    }
  }, [gateway.connected, gateway.chatId, gateway.id, gateway.type]);

  const Icon = GATEWAY_ICONS[gateway.type] || Radio;
  const isSlack = gateway.type === 'slack';

  async function handleSaveToken() {
    if (!tokenInput.trim()) return;
    try {
      await api.post(`/gateways/${encodeURIComponent(gateway.id)}/credentials`, { key: 'bot_token', value: tokenInput.trim() });
      if (isSlack && appTokenInput.trim()) {
        await api.post(`/gateways/${encodeURIComponent(gateway.id)}/credentials`, { key: 'app_token', value: appTokenInput.trim() });
      }
      addToast('success', `Token saved — connecting...`);
      setTokenInput('');
      setAppTokenInput('');
      setSettingToken(false);
      // Auto-connect after saving tokens
      try {
        await api.post(`/gateways/${encodeURIComponent(gateway.id)}/connect`);
        addToast('success', `${GATEWAY_LABELS[gateway.type]} connected!`);
      } catch (connErr) {
        addToast('error', 'Token saved but connect failed', connErr.message);
      }
      onRefresh();
    } catch (err) {
      addToast('error', 'Failed to save token', err.message);
    }
  }

  async function handleTest() {
    setTesting(true);
    try {
      await api.post(`/gateways/${encodeURIComponent(gateway.id)}/test`);
      addToast('success', 'Test message sent!');
    } catch (err) {
      addToast('error', 'Test failed', err.message);
    }
    setTesting(false);
  }

  async function handleToggleConnect() {
    setConnecting(true);
    try {
      if (gateway.connected) {
        await api.post(`/gateways/${encodeURIComponent(gateway.id)}/disconnect`);
        addToast('info', `${GATEWAY_LABELS[gateway.type]} disconnected`);
      } else {
        await api.post(`/gateways/${encodeURIComponent(gateway.id)}/connect`);
        addToast('success', `${GATEWAY_LABELS[gateway.type]} connected!`);
      }
      onRefresh();
    } catch (err) {
      addToast('error', gateway.connected ? 'Disconnect failed' : 'Connect failed', err.message);
    }
    setConnecting(false);
  }

  async function handleToggleEnabled(enabled) {
    try {
      await api.patch(`/gateways/${encodeURIComponent(gateway.id)}`, { enabled });
      onRefresh();
    } catch (err) {
      addToast('error', 'Update failed', err.message);
    }
  }

  async function handlePresetChange(preset) {
    try {
      await api.patch(`/gateways/${encodeURIComponent(gateway.id)}`, { notifications: { preset } });
      onRefresh();
    } catch (err) {
      addToast('error', 'Update failed', err.message);
    }
  }

  async function handlePermissionChange(perm) {
    try {
      await api.patch(`/gateways/${encodeURIComponent(gateway.id)}`, { commandPermission: perm });
      onRefresh();
    } catch (err) {
      addToast('error', 'Update failed', err.message);
    }
  }

  async function handleDelete() {
    try {
      await api.delete(`/gateways/${encodeURIComponent(gateway.id)}`);
      addToast('info', `${GATEWAY_LABELS[gateway.type]} gateway removed`);
      onRefresh();
    } catch (err) {
      addToast('error', 'Delete failed', err.message);
    }
  }

  const currentPreset = gateway.notifications?.preset || 'critical';

  return (
    <div className="flex flex-col rounded-lg border border-border-subtle bg-surface-1 overflow-hidden min-w-[220px]">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border-subtle">
        <StatusDot status={gateway.connected ? 'running' : 'crashed'} size="sm" />
        <Icon size={13} className="text-text-2" />
        <span className="text-[13px] font-semibold text-text-0 font-sans">{GATEWAY_LABELS[gateway.type]}</span>
        <div className="flex-1" />
        {gateway.connected ? (
          <Badge variant="success" className="text-2xs gap-1"><PlugZap size={8} /> Connected</Badge>
        ) : gateway.enabled ? (
          <Badge variant="warning" className="text-2xs">Disconnected</Badge>
        ) : (
          <Badge variant="default" className="text-2xs">Disabled</Badge>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 flex flex-col px-4 py-3 min-h-[140px]">

        {/* Connected state */}
        {gateway.connected && !settingToken && (
          <>
            <div className="flex items-center gap-1.5 h-8 px-2.5 bg-success/8 border border-success/20 rounded-md text-2xs font-sans text-success mb-3">
              <Check size={10} /> Gateway active
              {gateway.botUsername && <span className="text-text-4 ml-1">@{gateway.botUsername}</span>}
              {gateway.botTag && <span className="text-text-4 ml-1">{gateway.botTag}</span>}
            </div>

            {/* Channel / Chat ID */}
            <div className="mb-3">
              <label className="text-2xs font-semibold text-text-3 font-sans mb-1.5 block">
                {gateway.type === 'slack' ? 'Channel' : 'Chat ID'}
              </label>
              {gateway.chatId ? (
                <div className="flex items-center gap-2">
                  <code className="flex-1 flex items-center h-7 px-2 bg-surface-0 border border-border-subtle rounded-md text-2xs font-mono text-text-2">
                    {gateway.type === 'slack' && channels.length > 0
                      ? `#${channels.find((c) => c.id === gateway.chatId)?.name || gateway.chatId}`
                      : gateway.chatId}
                  </code>
                  <button
                    onClick={async () => {
                      try { await api.patch(`/gateways/${encodeURIComponent(gateway.id)}`, { chatId: null }); onRefresh(); }
                      catch (err) { addToast('error', 'Failed', err.message); }
                    }}
                    className="text-2xs text-text-4 hover:text-text-1 cursor-pointer font-sans"
                  >Change</button>
                </div>
              ) : gateway.type === 'slack' && channels.length > 0 ? (
                <select
                  onChange={async (e) => {
                    if (!e.target.value) return;
                    try {
                      await api.patch(`/gateways/${encodeURIComponent(gateway.id)}`, { chatId: e.target.value });
                      onRefresh();
                    } catch (err) { addToast('error', 'Failed to set channel', err.message); }
                  }}
                  className="w-full h-7 px-2 text-2xs bg-surface-0 border border-border-subtle rounded-md text-text-0 font-sans focus:outline-none focus:ring-1 focus:ring-accent cursor-pointer"
                  defaultValue=""
                >
                  <option value="" disabled>Select a channel...</option>
                  {channels.map((c) => (
                    <option key={c.id} value={c.id}>#{c.name}</option>
                  ))}
                </select>
              ) : (
                <div className="text-2xs text-warning font-sans">
                  {gateway.type === 'slack'
                    ? 'No channels found — invite the bot to a channel first.'
                    : 'Send a message to the bot to auto-capture, or enter manually:'}
                  <input
                    placeholder={gateway.type === 'slack' ? 'C0123456789' : 'Chat ID'}
                    className="mt-1 w-full h-7 px-2 text-2xs bg-surface-0 border border-border rounded-md text-text-0 font-mono placeholder:text-text-4 focus:outline-none focus:ring-1 focus:ring-accent"
                    onKeyDown={async (e) => {
                      if (e.key === 'Enter' && e.target.value.trim()) {
                        try {
                          await api.patch(`/gateways/${encodeURIComponent(gateway.id)}`, { chatId: e.target.value.trim() });
                          onRefresh();
                        } catch (err) { addToast('error', 'Failed to set channel', err.message); }
                      }
                    }}
                  />
                </div>
              )}
            </div>

            {/* Notification preset */}
            <div className="mb-3">
              <label className="text-2xs font-semibold text-text-3 font-sans mb-1.5 block">Notifications</label>
              <div className="flex bg-surface-0 rounded-md p-0.5 border border-border-subtle">
                {NOTIFICATION_PRESETS.map((p) => (
                  <button
                    key={p}
                    onClick={() => handlePresetChange(p)}
                    className={cn(
                      'flex-1 px-2 py-1.5 text-2xs font-semibold font-sans rounded transition-all cursor-pointer capitalize',
                      currentPreset === p ? 'bg-accent/15 text-accent shadow-sm' : 'text-text-3 hover:text-text-1',
                    )}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

            {/* Command permissions */}
            <div className="mb-3">
              <label className="text-2xs font-semibold text-text-3 font-sans mb-1.5 block">Commands</label>
              <div className="flex bg-surface-0 rounded-md p-0.5 border border-border-subtle">
                {['full', 'read-only'].map((p) => (
                  <button
                    key={p}
                    onClick={() => handlePermissionChange(p)}
                    className={cn(
                      'flex-1 px-2 py-1.5 text-2xs font-semibold font-sans rounded transition-all cursor-pointer capitalize',
                      (gateway.commandPermission || 'full') === p ? 'bg-accent/15 text-accent shadow-sm' : 'text-text-3 hover:text-text-1',
                    )}
                  >
                    {p === 'full' ? 'Full Access' : 'Read Only'}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Not connected, not editing — show state */}
        {!gateway.connected && !settingToken && (
          <>
            <div className="text-xs text-text-3 font-sans mb-2">
              {!gateway.enabled ? 'Gateway is disabled.' : gateway.hasCredentials ? 'Tokens saved — click Connect.' : 'Configure bot token to connect.'}
            </div>
            {!gateway.hasCredentials && (
              <button
                onClick={() => setShowGuide(true)}
                className="flex items-center gap-1.5 text-2xs text-accent hover:text-accent/80 font-sans font-medium cursor-pointer mb-2"
              >
                <HelpCircle size={11} />
                How to set up
                <ExternalLink size={9} />
              </button>
            )}
          </>
        )}

        {/* Setup guide sheet */}
        <GatewaySetupGuide type={gateway.type} open={showGuide} onOpenChange={setShowGuide} />

        <div className="flex-1" />

        {/* Token input form */}
        {settingToken && (
          <div className="space-y-2.5 pt-1">
            {/* Open setup guide */}
            <button
              onClick={() => setShowGuide(true)}
              className="flex items-center gap-1.5 text-2xs text-accent hover:text-accent/80 font-sans font-medium cursor-pointer"
            >
              <HelpCircle size={11} />
              Where do I get these?
            </button>
            <div>
              <label className="text-2xs font-semibold text-text-2 font-sans mb-1.5 block">Bot Token</label>
              <div className="relative">
                <input
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !isSlack && handleSaveToken()}
                  type={showToken ? 'text' : 'password'}
                  placeholder={GATEWAY_PLACEHOLDERS[gateway.type]}
                  className="w-full h-9 px-3 pr-9 text-xs bg-surface-0 border border-border rounded-md text-text-0 font-mono placeholder:text-text-4 focus:outline-none focus:ring-1 focus:ring-accent"
                  autoFocus
                />
                <button onClick={() => setShowToken(!showToken)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-4 hover:text-text-2 cursor-pointer">
                  {showToken ? <EyeOff size={12} /> : <Eye size={12} />}
                </button>
              </div>
            </div>
            {isSlack && (
              <div>
                <label className="text-2xs font-semibold text-text-2 font-sans mb-1.5 block">App Token (Socket Mode)</label>
                <input
                  value={appTokenInput}
                  onChange={(e) => setAppTokenInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveToken()}
                  type={showToken ? 'text' : 'password'}
                  placeholder="xapp-..."
                  className="w-full h-9 px-3 text-xs bg-surface-0 border border-border rounded-md text-text-0 font-mono placeholder:text-text-4 focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>
            )}
            <div className="flex gap-2">
              <Button variant="primary" size="sm" onClick={handleSaveToken} disabled={!tokenInput.trim()} className="flex-1 h-8 text-xs">
                Save Token
              </Button>
              <Button variant="ghost" size="sm" onClick={() => { setSettingToken(false); setTokenInput(''); setAppTokenInput(''); }} className="h-8 text-xs px-3">
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Bottom actions */}
        {!settingToken && (
          <div className="flex gap-2 mt-2">
            {!gateway.connected && (
              <Button variant="primary" size="sm" onClick={() => setSettingToken(true)} className="flex-1 h-7 text-2xs gap-1.5">
                <Key size={11} />
                {gateway.enabled ? 'Set Token' : 'Configure'}
              </Button>
            )}
            {gateway.connected && (
              <>
                <Button variant="secondary" size="sm" onClick={handleTest} disabled={testing} className="flex-1 h-7 text-2xs gap-1.5">
                  <TestTube size={11} />
                  {testing ? 'Sending...' : 'Test'}
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setSettingToken(true)} className="h-7 text-2xs px-2.5">
                  <Key size={11} />
                </Button>
              </>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={handleToggleConnect}
              disabled={connecting}
              className="h-7 text-2xs px-2.5"
              title={gateway.connected ? 'Disconnect' : 'Connect'}
            >
              {gateway.connected ? <Plug size={11} /> : <PlugZap size={11} />}
            </Button>
            <Toggle value={gateway.enabled} onChange={handleToggleEnabled} />
            <button onClick={handleDelete} className="text-text-4 hover:text-danger cursor-pointer p-1" title="Remove gateway">
              <Trash2 size={11} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Add Gateway Button ───────────────────────────────────── */

function AddGatewayCard({ existingTypes, onAdd }) {
  const [open, setOpen] = useState(false);
  const available = ['telegram', 'discord', 'slack'].filter((t) => !existingTypes.includes(t));

  if (available.length === 0) return null;

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border-subtle bg-surface-1/50 hover:bg-surface-1 hover:border-accent/30 min-h-[140px] min-w-[220px] cursor-pointer transition-all group"
      >
        <div className="w-8 h-8 rounded-full bg-accent/8 group-hover:bg-accent/15 flex items-center justify-center mb-2 transition-colors">
          <Plus size={14} className="text-accent" />
        </div>
        <span className="text-2xs font-semibold text-text-3 group-hover:text-text-1 font-sans transition-colors">Add Gateway</span>
      </button>
    );
  }

  return (
    <div className="flex flex-col rounded-lg border border-accent/30 bg-surface-1 overflow-hidden min-w-[220px]">
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border-subtle">
        <Radio size={13} className="text-accent" />
        <span className="text-[13px] font-semibold text-text-0 font-sans">Add Gateway</span>
        <div className="flex-1" />
        <button onClick={() => setOpen(false)} className="text-text-4 hover:text-text-1 cursor-pointer"><X size={12} /></button>
      </div>
      <div className="p-3 space-y-2">
        {available.map((type) => {
          const Icon = GATEWAY_ICONS[type];
          return (
            <button
              key={type}
              onClick={() => { onAdd(type); setOpen(false); }}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md bg-surface-0 hover:bg-accent/8 border border-border-subtle hover:border-accent/20 cursor-pointer transition-all group"
            >
              <Icon size={14} className="text-text-3 group-hover:text-accent" />
              <span className="text-xs font-medium text-text-1 group-hover:text-accent font-sans">{GATEWAY_LABELS[type]}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ── Early Access Section ─────────────────────────────────── */

function EarlyAccessSection() {
  const networkUnlocked = useGrooveStore((s) => s.networkUnlocked);
  const activateBeta = useGrooveStore((s) => s.activateBeta);
  const deactivateBeta = useGrooveStore((s) => s.deactivateBeta);
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(''), 3000);
    return () => clearTimeout(t);
  }, [error]);

  async function handleSubmit() {
    const trimmed = code.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      await activateBeta(trimmed);
      setCode('');
    } catch (err) {
      setError(err.message || 'Invalid code');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeactivate() {
    try { await deactivateBeta(); } catch { /* toast handled in store */ }
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-2.5 px-0.5">
        <span className="text-2xs font-semibold text-text-3 font-sans uppercase tracking-wider">Early Access</span>
        <div className="flex-1 h-px bg-border-subtle" />
      </div>
      <div className="rounded-lg border border-border-subtle bg-surface-1 px-4 py-3.5 max-w-md">
        {networkUnlocked ? (
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded-full bg-success/10 flex items-center justify-center flex-shrink-0">
              <Check size={12} className="text-success" />
            </div>
            <div className="flex-1 text-xs font-sans text-text-1">Early access enabled</div>
            <button
              onClick={handleDeactivate}
              className="text-2xs text-text-4 hover:text-danger cursor-pointer font-sans"
            >
              Deactivate
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Lock size={12} className="text-text-4 flex-shrink-0" />
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
              type="text"
              placeholder="Enter invite code"
              className="flex-1 h-8 px-2.5 text-xs bg-surface-0 border border-border rounded-md text-text-0 font-mono placeholder:text-text-4 focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <Button
              variant="primary"
              size="sm"
              onClick={handleSubmit}
              disabled={!code.trim() || submitting}
              className="h-8 text-xs px-3"
            >
              {submitting ? '...' : 'Submit'}
            </Button>
          </div>
        )}
        {error && !networkUnlocked && (
          <div className="mt-2 text-2xs text-danger font-sans">{error}</div>
        )}
      </div>
    </div>
  );
}

/* ── Main Settings View ────────────────────────────────────── */

export default function SettingsView() {
  const [providers, setProviders] = useState([]);
  const [config, setConfig] = useState(null);
  const [daemonInfo, setDaemonInfo] = useState(null);
  const [gwList, setGwList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [folderBrowserOpen, setFolderBrowserOpen] = useState(false);
  const addToast = useGrooveStore((s) => s.addToast);
  const remoteHomedir = useGrooveStore((s) => s.remoteHomedir);
  const providerRefreshTick = useGrooveStore((s) => s._providerRefreshTick);

  function loadProviders() {
    api.get('/providers').then((d) => setProviders(Array.isArray(d) ? d : [])).catch(() => {});
  }

  function loadGateways() {
    api.get('/gateways').then((d) => setGwList(Array.isArray(d) ? d : [])).catch(() => {});
  }

  useEffect(() => {
    Promise.all([api.get('/providers'), api.get('/config'), api.get('/status'), api.get('/gateways')])
      .then(([p, c, s, g]) => { setProviders(Array.isArray(p) ? p : []); setConfig(c); setDaemonInfo(s); setGwList(Array.isArray(g) ? g : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (providerRefreshTick) loadProviders();
  }, [providerRefreshTick]);

  async function addGateway(type) {
    try {
      await api.post('/gateways', { type });
      addToast('success', `${GATEWAY_LABELS[type]} gateway added`);
      loadGateways();
    } catch (err) {
      addToast('error', 'Failed to add gateway', err.message);
    }
  }

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

  const visibleProviders = providers.filter((p) => p.id !== 'groove-network');
  const connectedCount = visibleProviders.filter((p) => {
    if (p.authType === 'local') return p.installed;
    if (p.authType === 'subscription') return p.installed;
    return p.installed && p.hasKey;
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
              <span className="text-2xs text-text-4 font-sans">{connectedCount}/{visibleProviders.length} connected</span>
            </div>
            <div className="grid grid-cols-4 gap-3">
              {visibleProviders.map((p) => (
                <ProviderCard key={p.id} provider={p} onKeyChange={loadProviders} />
              ))}
            </div>
          </div>

          {/* ═══════ GATEWAYS ═══════ */}
          <div>
            <div className="flex items-center gap-2 mb-2.5 px-0.5">
              <span className="text-2xs font-semibold text-text-3 font-sans uppercase tracking-wider">Gateways</span>
              <div className="flex-1 h-px bg-border-subtle" />
              <span className="text-2xs text-text-4 font-sans">
                {gwList.filter((g) => g.connected).length}/{gwList.length} connected
              </span>
            </div>
            <div className="grid grid-cols-4 gap-3">
              {gwList.map((gw) => (
                <GatewayCard key={gw.id} gateway={gw} onRefresh={loadGateways} />
              ))}
              <AddGatewayCard existingTypes={gwList.map((g) => g.type)} onAdd={addGateway} />
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
                    {visibleProviders.filter((p) => p.installed && (p.authType === 'local' || p.authType === 'subscription' || p.hasKey)).map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </ConfigCard>

                <ConfigCard icon={Cpu} label="Default Model" description="Model used for new agents. Auto routes by role.">
                  <select
                    value={config.defaultModel || ''}
                    onChange={(e) => updateConfig('defaultModel', e.target.value || null)}
                    className="w-full h-8 px-2.5 text-xs bg-surface-0 border border-border-subtle rounded-md text-text-0 font-mono focus:outline-none focus:ring-1 focus:ring-accent cursor-pointer"
                  >
                    <option value="">Auto (route by role)</option>
                    {(providers.find((p) => p.id === (config.defaultProvider || 'claude-code'))?.models || []).map((m) => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                </ConfigCard>

                <ConfigCard icon={FolderOpen} label="Working Directory" description="Default root directory for new agents.">
                  <div className="flex items-center gap-1.5">
                    <code className="flex-1 h-8 px-2 flex items-center bg-surface-0 border border-border-subtle rounded-md text-2xs font-mono text-text-2 truncate min-w-0">
                      {config.defaultWorkingDir || 'Project root'}
                    </code>
                    <Button variant="secondary" size="sm" onClick={async () => {
                      if (window.groove?.folders?.select) {
                        const dir = await window.groove.folders.select({
                          title: 'Select Working Directory',
                          defaultPath: config?.defaultWorkingDir || undefined,
                        });
                        if (dir) updateConfig('defaultWorkingDir', dir);
                      } else {
                        setFolderBrowserOpen(true);
                      }
                    }} className="h-8 px-2 flex-shrink-0">
                      <FolderSearch size={12} />
                    </Button>
                  </div>
                </ConfigCard>

                <ConfigCard icon={MessageSquare} label="Default Chat Model" description="Provider and model for new chat conversations.">
                  <div className="space-y-2">
                    <select
                      value={config.defaultChatProvider || config.defaultProvider || 'claude-code'}
                      onChange={(e) => {
                        updateConfig('defaultChatProvider', e.target.value);
                        const prov = providers.find((p) => p.id === e.target.value);
                        const chatModels = (prov?.models || []).filter((m) => {
                          const id = (typeof m === 'string' ? m : m.id || '').toLowerCase();
                          return !id.includes('dall-e') && !id.includes('imagen') && !id.includes('image');
                        });
                        if (chatModels.length > 0) {
                          const first = typeof chatModels[0] === 'string' ? chatModels[0] : chatModels[0].id;
                          updateConfig('defaultChatModel', first);
                        }
                      }}
                      className="w-full h-8 px-2.5 text-xs bg-surface-0 border border-border-subtle rounded-md text-text-0 font-mono focus:outline-none focus:ring-1 focus:ring-accent cursor-pointer"
                    >
                      {visibleProviders.filter((p) => p.installed && (p.authType === 'local' || p.authType === 'subscription' || p.hasKey)).map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                    <select
                      value={config.defaultChatModel || ''}
                      onChange={(e) => updateConfig('defaultChatModel', e.target.value || null)}
                      className="w-full h-8 px-2.5 text-xs bg-surface-0 border border-border-subtle rounded-md text-text-0 font-mono focus:outline-none focus:ring-1 focus:ring-accent cursor-pointer"
                    >
                      <option value="">Auto (Sonnet)</option>
                      {(providers.find((p) => p.id === (config.defaultChatProvider || config.defaultProvider || 'claude-code'))?.models || [])
                        .filter((m) => {
                          const id = (typeof m === 'string' ? m : m.id || '').toLowerCase();
                          return !id.includes('dall-e') && !id.includes('imagen') && !id.includes('image');
                        })
                        .map((m) => {
                          const id = typeof m === 'string' ? m : m.id;
                          const name = typeof m === 'string' ? m : m.name || m.id;
                          return <option key={id} value={id}>{name}</option>;
                        })}
                    </select>
                  </div>
                </ConfigCard>

              </div>
            </div>
          )}

          {/* ═══════ EARLY ACCESS ═══════ */}
          <EarlyAccessSection />

        </div>
      </ScrollArea>

      {/* Folder Browser Modal */}
      <FolderBrowser
        open={folderBrowserOpen}
        onOpenChange={setFolderBrowserOpen}
        currentPath={config?.defaultWorkingDir || remoteHomedir || '/'}
        homePath={remoteHomedir}
        onSelect={(dir) => updateConfig('defaultWorkingDir', dir)}
      />
    </div>
  );
}
