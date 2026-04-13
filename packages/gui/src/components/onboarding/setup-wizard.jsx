// FSL-1.1-Apache-2.0 — see LICENSE

import { useState, useEffect, useCallback, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useGrooveStore } from '../../stores/groove';
import { isElectron } from '../../lib/electron';
import { cn } from '../../lib/cn';
import { ProviderCard } from './provider-card';
import { Badge } from '../ui/badge';
import { Input } from '../ui/input';
import {
  ChevronRight, ChevronLeft, Eye, EyeOff, Check, Sparkles, ArrowRight,
} from 'lucide-react';

// ── Provider definitions ────────────────────────────────────

const PROVIDERS = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    subtitle: 'by Anthropic',
    models: ['Opus 4.6', 'Sonnet 4.6', 'Haiku 4.5'],
    authType: 'Subscription or API key',
    authModes: ['subscription', 'apikey'],
    recommended: true,
    letter: 'C',
    gradientFrom: 'bg-purple/20 text-purple',
    keyPlaceholder: 'sk-ant-...',
    keyLabel: 'Anthropic API Key',
  },
  {
    id: 'codex',
    name: 'Codex',
    subtitle: 'by OpenAI',
    models: ['GPT-5.4 Pro', 'Standard', 'Mini', 'Nano'],
    authType: 'API key or ChatGPT Plus',
    authModes: ['apikey', 'chatgpt-plus'],
    recommended: false,
    letter: 'X',
    gradientFrom: 'bg-success/20 text-success',
    keyPlaceholder: 'sk-...',
    keyLabel: 'OpenAI API Key',
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    subtitle: 'by Google',
    models: ['Gemini 3.1 Pro', '3 Flash'],
    authType: 'API key',
    authModes: ['apikey'],
    recommended: false,
    letter: 'G',
    gradientFrom: 'bg-info/20 text-info',
    keyPlaceholder: 'AIza...',
    keyLabel: 'Gemini API Key',
  },
];

// ── Animation variants ──────────────────────────────────────

const slideVariants = {
  enter: (dir) => ({ x: dir > 0 ? 80 : -80, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir) => ({ x: dir < 0 ? 80 : -80, opacity: 0 }),
};

const transition = { duration: 0.25, ease: [0.4, 0, 0.2, 1] };

// ── Step indicator ──────────────────────────────────────────

function StepDots({ current, total }) {
  return (
    <div className="flex items-center gap-2">
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className={cn(
            'h-1.5 rounded-full transition-all duration-300',
            i === current ? 'w-6 bg-accent' : i < current ? 'w-1.5 bg-accent/50' : 'w-1.5 bg-surface-5',
          )}
        />
      ))}
    </div>
  );
}

// ── Step 1: Welcome ─────────────────────────────────────────

function WelcomeStep({ onNext, onSkip }) {
  return (
    <div className="flex flex-col items-center justify-center text-center gap-6 max-w-lg mx-auto">
      <motion.img
        src="/favicon.png"
        alt="Groove"
        className="w-20 h-20"
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
      />
      <div className="space-y-2">
        <h1 className="text-2xl font-bold text-text-0 font-sans">Welcome to Groove</h1>
        <p className="text-sm text-text-2">Your AI coding team, ready in minutes</p>
      </div>
      <p className="text-xs text-text-3 leading-relaxed max-w-sm">
        Let's set up your AI providers so you can start spawning agents.
        This only takes a moment.
      </p>
      <button
        type="button"
        onClick={onNext}
        className="mt-4 h-11 px-8 rounded-full bg-accent text-surface-0 font-semibold text-sm hover:bg-accent/80 transition-colors duration-100 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-0 flex items-center gap-2"
        autoFocus
      >
        Get Started
        <ArrowRight className="w-4 h-4" />
      </button>
      <button
        type="button"
        onClick={onSkip}
        className="text-xs text-text-4 hover:text-text-2 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent rounded px-2 py-1"
      >
        Skip setup
      </button>
    </div>
  );
}

// ── Step 2: Install Providers ───────────────────────────────

function InstallStep({ providerStatus, selected, onToggle, onInstall, installing }) {
  const hasInstalled = PROVIDERS.some((p) => providerStatus[p.id]?.installed);
  const hasSelected = selected.length > 0;

  return (
    <div className="flex flex-col items-center max-w-3xl mx-auto w-full">
      <div className="text-center mb-8">
        <h2 className="text-xl font-bold text-text-0 mb-2">Choose your AI providers</h2>
        <p className="text-sm text-text-3">Install the coding tools you want to use. You can always add more later.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 w-full mb-8">
        {PROVIDERS.map((p) => (
          <ProviderCard
            key={p.id}
            {...p}
            installed={providerStatus[p.id]?.installed}
            installing={installing[p.id]}
            failed={providerStatus[p.id]?.failed}
            selected={selected.includes(p.id)}
            onToggle={onToggle}
            onInstall={onInstall}
          />
        ))}
      </div>

      <p className="text-2xs text-text-4 text-center">
        {hasInstalled
          ? 'At least one provider is installed — you can continue.'
          : 'Select and install at least one provider to continue.'}
      </p>
    </div>
  );
}

// ── Step 3: Authentication ──────────────────────────────────

function AuthCard({ provider, providerStatus, onSaveKey, onSubscriptionLogin }) {
  const [authMode, setAuthMode] = useState(
    provider.authModes.includes('subscription') ? 'subscription' : 'apikey',
  );
  const [key, setKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(providerStatus?.authenticated || false);

  const handleSave = async () => {
    if (!key.trim()) return;
    setSaving(true);
    try {
      await onSaveKey(provider.id, key.trim());
      setSaved(true);
    } catch {
      // toast handled upstream
    } finally {
      setSaving(false);
    }
  };

  const maskedKey = providerStatus?.maskedKey || (saved && key ? `${key.slice(0, 6)}${'•'.repeat(20)}` : null);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="bg-surface-2 border border-border-subtle rounded-md p-5"
    >
      <div className="flex items-center gap-3 mb-4">
        <div className={cn('w-10 h-10 rounded-md flex items-center justify-center text-sm font-bold font-mono', provider.gradientFrom)}>
          {provider.letter}
        </div>
        <div>
          <h3 className="text-sm font-semibold text-text-0">{provider.name}</h3>
          <p className="text-2xs text-text-3">{provider.subtitle}</p>
        </div>
        {(saved || providerStatus?.authenticated) && (
          <Badge variant="success" className="ml-auto">Connected</Badge>
        )}
      </div>

      {provider.authModes.length > 1 && (
        <div className="flex gap-1 mb-4 bg-surface-3 p-0.5 rounded-md">
          {provider.authModes.map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setAuthMode(mode)}
              className={cn(
                'flex-1 h-7 rounded text-xs font-medium transition-colors duration-100 cursor-pointer',
                'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent',
                authMode === mode ? 'bg-surface-5 text-text-0' : 'text-text-3 hover:text-text-1',
              )}
            >
              {mode === 'subscription' ? 'Subscription' : mode === 'chatgpt-plus' ? 'ChatGPT Plus' : 'API Key'}
            </button>
          ))}
        </div>
      )}

      {authMode === 'subscription' && (
        <div className="space-y-3">
          <p className="text-xs text-text-2">Sign in with your Claude subscription</p>
          <button
            type="button"
            onClick={() => onSubscriptionLogin(provider.id)}
            className="h-8 px-4 rounded-md bg-purple/15 text-purple border border-purple/20 text-xs font-medium hover:bg-purple/25 transition-colors duration-100 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-purple"
          >
            Sign In
          </button>
          {providerStatus?.authenticated && (
            <p className="text-xs text-success flex items-center gap-1.5">
              <Check className="w-3.5 h-3.5" /> Connected
            </p>
          )}
        </div>
      )}

      {authMode === 'chatgpt-plus' && (
        <div className="space-y-3">
          <p className="text-xs text-text-2">
            Run <code className="font-mono text-accent bg-surface-4 px-1.5 py-0.5 rounded text-2xs">codex login</code> in your terminal to authenticate with ChatGPT Plus.
          </p>
          {providerStatus?.authenticated && (
            <p className="text-xs text-success flex items-center gap-1.5">
              <Check className="w-3.5 h-3.5" /> Connected
            </p>
          )}
        </div>
      )}

      {authMode === 'apikey' && (
        <div className="space-y-3">
          {saved || providerStatus?.authenticated ? (
            <div className="flex items-center gap-2">
              <div className="flex-1 h-8 rounded-md bg-surface-1 border border-border px-3 flex items-center">
                <span className="text-xs text-text-3 font-mono truncate">{maskedKey || '••••••••••••••'}</span>
              </div>
              <button
                type="button"
                onClick={() => { setSaved(false); setKey(''); }}
                className="h-8 px-3 rounded-md text-xs text-text-3 hover:text-text-1 bg-surface-4 hover:bg-surface-5 transition-colors duration-100 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
              >
                Change
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder={provider.keyPlaceholder}
                  className="h-8 w-full rounded-md px-3 pr-8 text-sm bg-surface-1 border border-border text-text-0 placeholder:text-text-4 focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent transition-colors duration-100 font-mono"
                  onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                  aria-label={provider.keyLabel}
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-text-4 hover:text-text-2 cursor-pointer"
                  aria-label={showKey ? 'Hide key' : 'Show key'}
                >
                  {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
              <button
                type="button"
                onClick={handleSave}
                disabled={!key.trim() || saving}
                className="h-8 px-4 rounded-md bg-accent text-surface-0 text-xs font-medium hover:bg-accent/80 transition-colors duration-100 cursor-pointer disabled:opacity-40 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}

function AuthStep({ providerStatus, installedIds, onSaveKey, onSubscriptionLogin }) {
  const installed = PROVIDERS.filter((p) => installedIds.includes(p.id) || providerStatus[p.id]?.installed);
  const hasAuthenticated = installed.some((p) => providerStatus[p.id]?.authenticated);

  return (
    <div className="flex flex-col items-center max-w-2xl mx-auto w-full">
      <div className="text-center mb-8">
        <h2 className="text-xl font-bold text-text-0 mb-2">Connect your accounts</h2>
        <p className="text-sm text-text-3">Add credentials for your installed providers.</p>
      </div>

      <div className="flex flex-col gap-4 w-full mb-6">
        {installed.map((p) => (
          <AuthCard
            key={p.id}
            provider={p}
            providerStatus={providerStatus[p.id] || {}}
            onSaveKey={onSaveKey}
            onSubscriptionLogin={onSubscriptionLogin}
          />
        ))}
      </div>

      {installed.length === 0 && (
        <p className="text-sm text-text-3 text-center">No providers installed yet. Go back to install one.</p>
      )}
    </div>
  );
}

// ── Step 4: Default Model ───────────────────────────────────

function DefaultModelStep({ providerStatus, installedIds, defaultProvider, defaultModel, onSetDefault }) {
  const authenticated = PROVIDERS.filter(
    (p) => (installedIds.includes(p.id) || providerStatus[p.id]?.installed) && providerStatus[p.id]?.authenticated,
  );

  return (
    <div className="flex flex-col items-center max-w-2xl mx-auto w-full">
      <div className="text-center mb-8">
        <h2 className="text-xl font-bold text-text-0 mb-2">Set your default</h2>
        <p className="text-sm text-text-3">Choose which provider and model to use by default. You can switch per-agent anytime.</p>
      </div>

      <div className="flex flex-col gap-3 w-full max-w-md mb-6">
        {authenticated.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onSetDefault(p.id, p.models[0])}
            className={cn(
              'flex items-center gap-4 p-4 rounded-md border transition-all duration-200 text-left cursor-pointer',
              'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent',
              defaultProvider === p.id
                ? 'bg-accent/8 border-accent ring-1 ring-accent/30'
                : 'bg-surface-2 border-border-subtle hover:bg-surface-3',
            )}
          >
            <div className={cn('w-10 h-10 rounded-md flex items-center justify-center text-sm font-bold font-mono shrink-0', p.gradientFrom)}>
              {p.letter}
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-text-0">{p.name}</h3>
              <p className="text-2xs text-text-3">{p.subtitle}</p>
            </div>
            <div className={cn(
              'w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors',
              defaultProvider === p.id ? 'border-accent bg-accent' : 'border-border',
            )}>
              {defaultProvider === p.id && (
                <div className="w-2 h-2 rounded-full bg-surface-0" />
              )}
            </div>
          </button>
        ))}

        {authenticated.length === 0 && (
          <p className="text-sm text-text-3 text-center">No authenticated providers. Go back to connect one.</p>
        )}
      </div>

      {defaultProvider && (
        <div className="w-full max-w-md">
          <label className="text-xs font-medium text-text-2 mb-2 block">Model</label>
          <div className="flex flex-wrap gap-2">
            {PROVIDERS.find((p) => p.id === defaultProvider)?.models.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => onSetDefault(defaultProvider, m)}
                className={cn(
                  'h-7 px-3 rounded-full text-xs font-medium transition-colors duration-100 cursor-pointer',
                  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent',
                  defaultModel === m
                    ? 'bg-accent text-surface-0'
                    : 'bg-surface-4 text-text-2 hover:bg-surface-5 hover:text-text-0',
                )}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Step 5: Done ────────────────────────────────────────────

function DoneStep({ providerStatus, defaultProvider, defaultModel, onFinish }) {
  const installedCount = PROVIDERS.filter((p) => providerStatus[p.id]?.installed).length;
  const defName = PROVIDERS.find((p) => p.id === defaultProvider)?.name;

  return (
    <div className="flex flex-col items-center justify-center text-center gap-6 max-w-lg mx-auto">
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 20 }}
        className="w-20 h-20 rounded-full bg-success/15 flex items-center justify-center"
      >
        <Check className="w-10 h-10 text-success" strokeWidth={2.5} />
      </motion.div>

      <div className="space-y-2">
        <h1 className="text-2xl font-bold text-text-0 font-sans">You're all set!</h1>
        <p className="text-sm text-text-2">
          {installedCount} provider{installedCount !== 1 ? 's' : ''} installed
          {defName ? `, default: ${defName}` : ''}
          {defaultModel ? ` (${defaultModel})` : ''}
        </p>
      </div>

      <motion.div
        className="flex gap-3 mt-4"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
      >
        <button
          type="button"
          onClick={onFinish}
          className="h-11 px-8 rounded-full bg-accent text-surface-0 font-semibold text-sm hover:bg-accent/80 transition-colors duration-100 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-0 flex items-center gap-2"
          autoFocus
        >
          <Sparkles className="w-4 h-4" />
          Start Building
        </button>
      </motion.div>
    </div>
  );
}

// ── Main Wizard ─────────────────────────────────────────────

const TOTAL_STEPS = 5;

export function SetupWizard() {
  const dismissOnboarding = useGrooveStore((s) => s.dismissOnboarding);
  const installProvider = useGrooveStore((s) => s.installProvider);
  const setDefaultProvider = useGrooveStore((s) => s.setDefaultProvider);
  const addToast = useGrooveStore((s) => s.addToast);

  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState(1);
  const [selected, setSelected] = useState(['claude-code']);
  const [installing, setInstalling] = useState({});
  const [providerStatus, setProviderStatus] = useState({});
  const [defaultProv, setDefaultProv] = useState(null);
  const [defaultMod, setDefaultMod] = useState(null);
  const containerRef = useRef(null);

  useEffect(() => {
    async function fetchStatus() {
      try {
        const data = await fetch('/api/onboarding/status').then((r) => r.ok ? r.json() : null);
        if (data?.providers) {
          const status = {};
          for (const p of data.providers) {
            const authed = p.authStatus === 'authenticated' || p.authStatus === 'key-set';
            status[p.id] = { installed: p.installed, authenticated: authed };
          }
          setProviderStatus(status);
          return;
        }
      } catch { /* fallback */ }
      try {
        const data = await fetch('/api/providers').then((r) => r.ok ? r.json() : null);
        if (data) {
          const status = {};
          const list = Array.isArray(data) ? data : data.providers || [];
          for (const p of list) {
            status[p.id] = { installed: p.installed || false, authenticated: p.authenticated || false };
          }
          setProviderStatus(status);
        }
      } catch { /* ignore */ }
    }
    fetchStatus();
  }, [step]);

  const goNext = useCallback(() => {
    if (step < TOTAL_STEPS - 1) {
      setDirection(1);
      setStep((s) => s + 1);
    }
  }, [step]);

  const goBack = useCallback(() => {
    if (step > 0) {
      setDirection(-1);
      setStep((s) => s - 1);
    }
  }, [step]);

  const handleSkip = useCallback(() => {
    dismissOnboarding();
  }, [dismissOnboarding]);

  const handleFinish = useCallback(() => {
    dismissOnboarding();
  }, [dismissOnboarding]);

  const handleToggleProvider = useCallback((id) => {
    setSelected((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }, []);

  const handleInstall = useCallback(async (id) => {
    setInstalling((prev) => ({ ...prev, [id]: true }));
    try {
      await installProvider(id);
      setProviderStatus((prev) => ({ ...prev, [id]: { ...prev[id], installed: true } }));
      if (!selected.includes(id)) setSelected((s) => [...s, id]);
    } catch {
      setProviderStatus((prev) => ({ ...prev, [id]: { ...prev[id], failed: true } }));
    } finally {
      setInstalling((prev) => ({ ...prev, [id]: false }));
    }
  }, [installProvider, selected]);

  const handleSaveKey = useCallback(async (providerId, key) => {
    try {
      const res = await fetch(`/api/credentials/${providerId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
      });
      if (!res.ok) throw new Error('Failed to save key');
      setProviderStatus((prev) => ({
        ...prev,
        [providerId]: { ...prev[providerId], authenticated: true, maskedKey: `${key.slice(0, 6)}${'•'.repeat(20)}` },
      }));
      addToast('success', 'API key saved');
    } catch (err) {
      addToast('error', 'Failed to save key', err.message);
      throw err;
    }
  }, [addToast]);

  const handleSubscriptionLogin = useCallback((providerId) => {
    if (isElectron() && window.groove?.auth?.login) {
      window.groove.auth.login();
    } else {
      fetch('/api/auth/login-url')
        .then((r) => r.json())
        .then((d) => { if (d.url) window.open(d.url, '_blank'); })
        .catch(() => addToast('error', 'Failed to start login'));
    }
  }, [addToast]);

  const handleSetDefault = useCallback(async (provider, model) => {
    setDefaultProv(provider);
    setDefaultMod(model);
    try {
      await setDefaultProvider(provider, model);
    } catch { /* toast upstream */ }
  }, [setDefaultProvider]);

  const hasInstalled = PROVIDERS.some((p) => providerStatus[p.id]?.installed);
  const hasAuthenticated = PROVIDERS.some((p) => providerStatus[p.id]?.authenticated);
  const canContinue =
    step === 0 ? true :
    step === 1 ? hasInstalled || selected.length > 0 :
    step === 2 ? hasAuthenticated :
    step === 3 ? !!defaultProv :
    false;

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Enter' && step < TOTAL_STEPS - 1 && canContinue) goNext();
      if (e.key === 'Escape') handleSkip();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [step, canContinue, goNext, handleSkip]);

  const stepContent = [
    <WelcomeStep key="welcome" onNext={goNext} onSkip={handleSkip} />,
    <InstallStep
      key="install"
      providerStatus={providerStatus}
      selected={selected}
      onToggle={handleToggleProvider}
      onInstall={handleInstall}
      installing={installing}
    />,
    <AuthStep
      key="auth"
      providerStatus={providerStatus}
      installedIds={selected}
      onSaveKey={handleSaveKey}
      onSubscriptionLogin={handleSubscriptionLogin}
    />,
    <DefaultModelStep
      key="default"
      providerStatus={providerStatus}
      installedIds={selected}
      defaultProvider={defaultProv}
      defaultModel={defaultMod}
      onSetDefault={handleSetDefault}
    />,
    <DoneStep
      key="done"
      providerStatus={providerStatus}
      defaultProvider={defaultProv}
      defaultModel={defaultMod}
      onFinish={handleFinish}
    />,
  ];

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-50 bg-surface-0 flex flex-col font-sans overflow-hidden"
    >
      {/* Title bar drag region for Electron */}
      {isElectron() && <div className="h-8 w-full electron-drag shrink-0" />}

      {/* Top bar */}
      <div className="flex items-center justify-between px-8 py-4 shrink-0">
        <StepDots current={step} total={TOTAL_STEPS} />
        {step > 0 && step < TOTAL_STEPS - 1 && (
          <button
            type="button"
            onClick={handleSkip}
            className="text-xs text-text-4 hover:text-text-2 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent rounded px-2 py-1"
          >
            Skip setup
          </button>
        )}
      </div>

      {/* Step content */}
      <div className="flex-1 flex items-center justify-center px-8 py-4 overflow-y-auto">
        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={step}
            custom={direction}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={transition}
            className="w-full"
          >
            {stepContent[step]}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Bottom navigation */}
      {step > 0 && step < TOTAL_STEPS - 1 && (
        <div className="flex items-center justify-between px-8 py-6 shrink-0">
          <button
            type="button"
            onClick={goBack}
            className="h-9 px-4 rounded-md text-sm text-text-2 hover:text-text-0 bg-surface-3 hover:bg-surface-4 transition-colors duration-100 cursor-pointer flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
          >
            <ChevronLeft className="w-4 h-4" />
            Back
          </button>
          <button
            type="button"
            onClick={goNext}
            disabled={!canContinue}
            className="h-9 px-6 rounded-md text-sm font-medium bg-accent text-surface-0 hover:bg-accent/80 transition-colors duration-100 cursor-pointer disabled:opacity-40 disabled:pointer-events-none flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
          >
            {step === 3 ? 'Finish Setup' : 'Continue'}
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
