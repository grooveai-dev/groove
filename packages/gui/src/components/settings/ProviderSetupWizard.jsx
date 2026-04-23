// FSL-1.1-Apache-2.0 — see LICENSE

import { useState, useEffect } from 'react';
import { useGrooveStore } from '../../stores/groove';
import { Dialog, DialogContent } from '../ui/dialog';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { cn } from '../../lib/cn';
import { api } from '../../lib/api';
import {
  Download, Loader2, Check, ChevronDown, ChevronUp,
  Eye, EyeOff, Key, RotateCcw, ExternalLink, Sparkles,
} from 'lucide-react';

const PROVIDER_META = {
  'claude-code': {
    name: 'Claude Code',
    letter: 'C',
    color: 'bg-purple/20 text-purple',
    installLabel: 'We are downloading Claude Code for you',
    authLabel: 'Sign in with your Anthropic account',
    keyPlaceholder: 'sk-ant-...',
    keyHint: 'Paste from console.anthropic.com',
    loginLabel: 'Sign In with Anthropic',
    authType: 'subscription',
  },
  codex: {
    name: 'Codex',
    letter: 'X',
    color: 'bg-success/20 text-success',
    installLabel: 'We are downloading Codex for you',
    authLabel: 'Connect your OpenAI account',
    keyPlaceholder: 'sk-...',
    keyHint: 'Paste from platform.openai.com',
    loginLabel: 'Sign in with ChatGPT Plus',
    authType: 'apikey',
  },
  gemini: {
    name: 'Gemini CLI',
    letter: 'G',
    color: 'bg-info/20 text-info',
    installLabel: 'We are downloading Gemini CLI for you',
    authLabel: 'Add your Gemini API key',
    keyPlaceholder: 'AIza...',
    keyHint: 'Paste from aistudio.google.com',
    authType: 'apikey',
  },
};

const STEPS = ['Install', 'Authenticate', 'Verify', 'Done'];

function StepIndicator({ current }) {
  return (
    <div className="flex items-center gap-1 mb-6">
      {STEPS.map((label, i) => (
        <div key={label} className="flex items-center gap-1">
          <div className={cn(
            'w-6 h-6 rounded-full flex items-center justify-center text-2xs font-bold font-mono transition-colors',
            i < current ? 'bg-success/15 text-success' :
            i === current ? 'bg-accent/15 text-accent ring-1 ring-accent/30' :
            'bg-surface-4 text-text-4',
          )}>
            {i < current ? <Check size={10} strokeWidth={3} /> : i + 1}
          </div>
          <span className={cn(
            'text-2xs font-sans font-medium hidden sm:inline',
            i === current ? 'text-text-0' : 'text-text-4',
          )}>{label}</span>
          {i < STEPS.length - 1 && (
            <div className={cn('w-6 h-px mx-1', i < current ? 'bg-success/40' : 'bg-border-subtle')} />
          )}
        </div>
      ))}
    </div>
  );
}

function InstallStep({ providerId, meta }) {
  const installProvider = useGrooveStore((s) => s.installProvider);
  const progress = useGrooveStore((s) => s.providerInstallProgress[providerId]);
  const [showDetails, setShowDetails] = useState(false);
  const [started, setStarted] = useState(false);

  const isInstalling = progress?.installing;
  const isDone = progress?.done;
  const hasError = progress?.error;
  const percent = progress?.percent || 0;

  useEffect(() => {
    if (!started) {
      setStarted(true);
      installProvider(providerId).catch(() => {});
    }
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold font-mono', meta.color)}>
          {meta.letter}
        </div>
        <div>
          <p className="text-sm font-medium text-text-0 font-sans">{meta.installLabel}</p>
          <p className="text-2xs text-text-3 font-sans">This may take a minute</p>
        </div>
      </div>

      <div className="space-y-2">
        <div className="h-2 bg-surface-4 rounded-full overflow-hidden">
          {isInstalling ? (
            <div
              className="h-full bg-gradient-to-r from-accent to-accent/60 rounded-full transition-all duration-500 ease-out"
              style={{ width: `${Math.max(percent, 5)}%` }}
            />
          ) : isDone ? (
            <div className="h-full bg-success rounded-full w-full" />
          ) : hasError ? (
            <div className="h-full bg-danger rounded-full" style={{ width: '100%' }} />
          ) : null}
        </div>
        <div className="flex items-center justify-between">
          <span className={cn(
            'text-2xs font-sans',
            hasError ? 'text-danger' : isDone ? 'text-success' : 'text-text-3',
          )}>
            {hasError ? (typeof hasError === 'string' ? hasError : 'Something went wrong') : isDone ? 'Installed successfully' : progress?.message || 'Preparing...'}
          </span>
          {isInstalling && (
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="flex items-center gap-1 text-2xs text-text-4 hover:text-text-2 cursor-pointer font-sans"
            >
              {showDetails ? 'Hide' : 'Show'} details
              {showDetails ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
            </button>
          )}
        </div>
      </div>

      {showDetails && progress?.message && (
        <div className="p-3 bg-surface-0 border border-border-subtle rounded-md max-h-24 overflow-y-auto">
          <p className="text-2xs font-mono text-text-3 whitespace-pre-wrap">{progress.message}</p>
        </div>
      )}

      {hasError && (
        <div className="space-y-3">
          {typeof hasError === 'string' && hasError.length > 40 && (
            <div className="p-3 bg-surface-0 border border-border-subtle rounded-md max-h-24 overflow-y-auto">
              <p className="text-2xs font-mono text-danger/80 whitespace-pre-wrap break-all">{hasError}</p>
            </div>
          )}
          <p className="text-xs text-text-2 font-sans">Check that npm is in your PATH and try again.</p>
          <Button
            variant="primary"
            size="sm"
            onClick={() => installProvider(providerId).catch(() => {})}
            className="gap-1.5"
          >
            <RotateCcw size={11} /> Try Again
          </Button>
        </div>
      )}
    </div>
  );
}

function AuthenticateStep({ providerId, meta, onSaveKey }) {
  const loginProvider = useGrooveStore((s) => s.loginProvider);
  const addToast = useGrooveStore((s) => s.addToast);
  const [key, setKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loginStarted, setLoginStarted] = useState(false);
  const [authMode, setAuthMode] = useState(meta.authType === 'subscription' ? 'subscription' : 'apikey');

  async function handleSaveKey() {
    if (!key.trim()) return;
    setSaving(true);
    try {
      await api.post(`/credentials/${encodeURIComponent(providerId)}`, { key: key.trim() });
      addToast('success', `API key saved for ${meta.name}`);
      onSaveKey();
    } catch (err) {
      addToast('error', 'Failed to save key', err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleLogin() {
    const body = authMode === 'chatgpt-plus' ? { method: 'chatgpt-plus' } : undefined;
    try {
      await loginProvider(providerId, body);
      setLoginStarted(true);
    } catch { /* handled in store */ }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm font-medium text-text-0 font-sans">{meta.authLabel}</p>

      {providerId === 'claude-code' && (
        <div className="flex gap-1 bg-surface-3 p-0.5 rounded-md mb-4">
          <button
            onClick={() => { setAuthMode('subscription'); setLoginStarted(false); }}
            className={cn(
              'flex-1 h-7 rounded text-xs font-medium transition-colors cursor-pointer font-sans',
              authMode === 'subscription' ? 'bg-surface-5 text-text-0' : 'text-text-3 hover:text-text-1',
            )}
          >
            Subscription
          </button>
          <button
            onClick={() => { setAuthMode('apikey'); setLoginStarted(false); }}
            className={cn(
              'flex-1 h-7 rounded text-xs font-medium transition-colors cursor-pointer font-sans',
              authMode === 'apikey' ? 'bg-surface-5 text-text-0' : 'text-text-3 hover:text-text-1',
            )}
          >
            API Key
          </button>
        </div>
      )}

      {providerId === 'codex' && (
        <div className="flex gap-1 bg-surface-3 p-0.5 rounded-md mb-4">
          <button
            onClick={() => { setAuthMode('apikey'); setLoginStarted(false); }}
            className={cn(
              'flex-1 h-7 rounded text-xs font-medium transition-colors cursor-pointer font-sans',
              authMode === 'apikey' ? 'bg-surface-5 text-text-0' : 'text-text-3 hover:text-text-1',
            )}
          >
            API Key
          </button>
          <button
            onClick={() => { setAuthMode('chatgpt-plus'); setLoginStarted(false); }}
            className={cn(
              'flex-1 h-7 rounded text-xs font-medium transition-colors cursor-pointer font-sans',
              authMode === 'chatgpt-plus' ? 'bg-surface-5 text-text-0' : 'text-text-3 hover:text-text-1',
            )}
          >
            ChatGPT Plus
          </button>
        </div>
      )}

      {authMode === 'subscription' && (
        <div className="space-y-3">
          <p className="text-xs text-text-2 font-sans">
            Click below to sign in with your existing Claude subscription.
          </p>
          {!loginStarted ? (
            <Button variant="primary" size="md" onClick={handleLogin} className="gap-1.5">
              <ExternalLink size={12} /> {meta.loginLabel}
            </Button>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2 p-3 bg-accent/5 border border-accent/15 rounded-md">
                <ExternalLink size={12} className="text-accent" />
                <span className="text-xs text-accent font-sans">Sign-in opened in your browser</span>
              </div>
              <Button variant="primary" size="sm" onClick={onSaveKey} className="gap-1.5">
                <Check size={11} /> I've signed in
              </Button>
            </div>
          )}
          <p className="text-2xs text-text-4 font-sans">
            A browser window will open for you to sign in.
          </p>
        </div>
      )}

      {authMode === 'chatgpt-plus' && (
        <div className="space-y-3">
          <p className="text-xs text-text-2 font-sans">
            Click below to sign in with your ChatGPT Plus subscription.
          </p>
          {!loginStarted ? (
            <Button variant="primary" size="md" onClick={handleLogin} className="gap-1.5">
              <ExternalLink size={12} /> {meta.loginLabel}
            </Button>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2 p-3 bg-accent/5 border border-accent/15 rounded-md">
                <ExternalLink size={12} className="text-accent" />
                <span className="text-xs text-accent font-sans">Sign-in opened in your browser</span>
              </div>
              <Button variant="primary" size="sm" onClick={onSaveKey} className="gap-1.5">
                <Check size={11} /> I've signed in
              </Button>
            </div>
          )}
        </div>
      )}

      {authMode === 'apikey' && (
        <div className="space-y-3">
          <label className="text-2xs font-semibold text-text-2 font-sans block">
            {meta.name} API Key
          </label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                type={showKey ? 'text' : 'password'}
                value={key}
                onChange={(e) => setKey(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSaveKey()}
                placeholder={meta.keyPlaceholder}
                className="w-full h-9 px-3 pr-9 text-xs bg-surface-0 border border-border rounded-md text-text-0 font-mono placeholder:text-text-4 focus:outline-none focus:ring-1 focus:ring-accent"
                autoFocus
              />
              <button
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-4 hover:text-text-2 cursor-pointer"
              >
                {showKey ? <EyeOff size={12} /> : <Eye size={12} />}
              </button>
            </div>
            <Button variant="primary" size="lg" onClick={handleSaveKey} disabled={!key.trim() || saving}>
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </div>
          <p className="text-2xs text-text-4 font-sans">{meta.keyHint}</p>
        </div>
      )}
    </div>
  );
}

function VerifyStep({ providerId, meta, onVerified }) {
  const verifyProvider = useGrooveStore((s) => s.verifyProvider);
  const [status, setStatus] = useState('verifying');
  const [error, setError] = useState(null);

  async function runVerify() {
    setStatus('verifying');
    setError(null);
    try {
      const result = await verifyProvider(providerId);
      if (result?.installed && !result?.error) {
        setStatus('success');
        onVerified();
      } else {
        setStatus('failed');
        setError(result?.error || 'Could not verify the provider. Please check your credentials.');
      }
    } catch (err) {
      setStatus('failed');
      setError(err.message || 'Verification failed. Please try again.');
    }
  }

  useEffect(() => { runVerify(); }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold font-mono', meta.color)}>
          {meta.letter}
        </div>
        <p className="text-sm font-medium text-text-0 font-sans">
          {status === 'verifying' ? 'Checking your connection...' :
           status === 'success' ? 'Everything looks good!' :
           'We could not verify the connection'}
        </p>
      </div>

      {status === 'verifying' && (
        <div className="flex items-center gap-2 p-3 bg-accent/5 border border-accent/15 rounded-md">
          <Loader2 size={14} className="text-accent animate-spin" />
          <span className="text-xs text-accent font-sans">Verifying {meta.name}...</span>
        </div>
      )}

      {status === 'success' && (
        <div className="flex items-center gap-2 p-3 bg-success/8 border border-success/20 rounded-md">
          <Check size={14} className="text-success" />
          <span className="text-xs text-success font-sans">{meta.name} is connected and ready to use</span>
        </div>
      )}

      {status === 'failed' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 p-3 bg-danger/8 border border-danger/20 rounded-md">
            <span className="text-xs text-danger font-sans">{error}</span>
          </div>
          <Button variant="primary" size="sm" onClick={runVerify} className="gap-1.5">
            <RotateCcw size={11} /> Try Again
          </Button>
        </div>
      )}
    </div>
  );
}

function DoneStep({ meta }) {
  return (
    <div className="flex flex-col items-center text-center gap-4 py-4">
      <div className="w-14 h-14 rounded-full bg-success/15 flex items-center justify-center">
        <Check size={24} className="text-success" strokeWidth={2.5} />
      </div>
      <div>
        <p className="text-base font-semibold text-text-0 font-sans">{meta.name} is ready!</p>
        <p className="text-xs text-text-3 font-sans mt-1">You can now spawn agents using {meta.name}.</p>
      </div>
    </div>
  );
}

export function ProviderSetupWizard({ open, onOpenChange, providerId, initialStep = 0, onComplete }) {
  const meta = PROVIDER_META[providerId] || PROVIDER_META['claude-code'];
  const [step, setStep] = useState(initialStep);
  const [verified, setVerified] = useState(false);
  const installDone = useGrooveStore((s) => s.providerInstallProgress[providerId]?.done);

  useEffect(() => {
    if (open) {
      setStep(initialStep);
      setVerified(false);
    }
  }, [open, providerId]);

  function handleAuthDone() {
    setStep(2);
  }

  function handleVerified() {
    setVerified(true);
  }

  function handleClose() {
    onOpenChange(false);
    if (onComplete) onComplete();
  }

  const canNext =
    step === 0 ? !!installDone :
    step === 1 ? true :
    step === 2 ? verified :
    true;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={`Set up ${meta.name}`}
        description={`Install and configure ${meta.name}`}
        className="max-w-md"
      >
        <div className="px-5 py-4">
          <StepIndicator current={step} />

          {step === 0 && <InstallStep providerId={providerId} meta={meta} />}
          {step === 1 && <AuthenticateStep providerId={providerId} meta={meta} onSaveKey={handleAuthDone} />}
          {step === 2 && <VerifyStep providerId={providerId} meta={meta} onVerified={handleVerified} />}
          {step === 3 && <DoneStep meta={meta} />}

          <div className="flex justify-between mt-6 pt-4 border-t border-border-subtle">
            {step > 0 && step < 3 ? (
              <Button variant="ghost" size="sm" onClick={() => setStep(step - 1)}>
                Back
              </Button>
            ) : <div />}
            {step < 3 ? (
              <Button
                variant="primary"
                size="sm"
                disabled={!canNext}
                onClick={() => setStep(step + 1)}
                className="gap-1.5"
              >
                {step === 0 ? 'Next' : step === 1 ? 'Skip verification' : 'Continue'}
              </Button>
            ) : (
              <Button variant="primary" size="sm" onClick={handleClose} className="gap-1.5">
                <Sparkles size={11} /> Done
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
