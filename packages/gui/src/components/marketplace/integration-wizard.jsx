// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { api } from '../../lib/api';
import { useToast } from '../../lib/hooks/use-toast';
import {
  Check, CheckCircle, ExternalLink, Loader2, Eye, EyeOff,
  Key, Shield, Trash2, ChevronRight, X,
} from 'lucide-react';

// Reuse integration logos from marketplace-card
const INTEGRATION_LOGOS = {
  slack:       'https://cdn.simpleicons.org/slack/E01E5A',
  github:      'https://cdn.simpleicons.org/github/white',
  stripe:      'https://cdn.simpleicons.org/stripe/635BFF',
  gmail:       'https://cdn.simpleicons.org/gmail/EA4335',
  'google-calendar': 'https://cdn.simpleicons.org/googlecalendar/4285F4',
  'google-drive':    'https://cdn.simpleicons.org/googledrive/4285F4',
  'google-maps':     'https://cdn.simpleicons.org/googlemaps/4285F4',
  postgres:    'https://cdn.simpleicons.org/postgresql/4169E1',
  notion:      'https://cdn.simpleicons.org/notion/white',
  discord:     'https://cdn.simpleicons.org/discord/5865F2',
  linear:      'https://cdn.simpleicons.org/linear/5E6AD2',
  'brave-search': 'https://cdn.simpleicons.org/brave/FB542B',
  'home-assistant': 'https://cdn.simpleicons.org/homeassistant/18BCF2',
};

function IntegrationIcon({ item, size = 48 }) {
  const logoUrl = INTEGRATION_LOGOS[item.id];
  if (logoUrl) {
    return (
      <div className="rounded-lg bg-surface-4 flex items-center justify-center flex-shrink-0 overflow-hidden" style={{ width: size, height: size }}>
        <img src={logoUrl} alt={item.name} className="w-6 h-6" onError={(e) => { e.target.style.display = 'none'; }} />
      </div>
    );
  }
  const initial = (item.name || '?')[0].toUpperCase();
  const hue = item.name ? item.name.charCodeAt(0) * 37 % 360 : 200;
  return (
    <div
      className="rounded-lg flex items-center justify-center flex-shrink-0 text-xl font-bold font-sans"
      style={{ width: size, height: size, background: `hsl(${hue}, 40%, 18%)`, color: `hsl(${hue}, 60%, 65%)` }}
    >
      {initial}
    </div>
  );
}

// ── Password input with show/hide toggle ────────────────
function SecretInput({ value, onChange, placeholder, disabled }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        mono
        className="pr-9"
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-text-4 hover:text-text-1 transition-colors cursor-pointer"
        tabIndex={-1}
      >
        {visible ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </div>
  );
}

// ── Credential row for api-key auth type ────────────────
function CredentialRow({ integrationId, envKey, onSaved }) {
  const toast = useToast();
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(envKey.set);
  const [deleting, setDeleting] = useState(false);

  async function handleSave() {
    if (!value.trim()) return;
    setSaving(true);
    try {
      await api.post(`/integrations/${integrationId}/credentials`, { key: envKey.key, value: value.trim() });
      setSaved(true);
      setValue('');
      toast.success(`${envKey.label} saved`);
      onSaved?.();
    } catch (err) {
      toast.error('Failed to save', err.message);
    }
    setSaving(false);
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await api.delete(`/integrations/${integrationId}/credentials/${envKey.key}`);
      setSaved(false);
      toast.success(`${envKey.label} removed`);
      onSaved?.();
    } catch (err) {
      toast.error('Failed to remove', err.message);
    }
    setDeleting(false);
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <label className="text-xs font-medium text-text-2 font-sans flex items-center gap-1.5">
          <Key size={11} className="text-text-4" />
          {envKey.label}
          {envKey.required && <span className="text-danger">*</span>}
        </label>
        {saved && (
          <span className="flex items-center gap-1 text-2xs text-success font-sans">
            <Check size={10} /> Set
          </span>
        )}
      </div>

      {saved ? (
        <div className="flex items-center gap-2">
          <div className="flex-1 h-8 rounded-md px-3 bg-surface-2 border border-border-subtle flex items-center">
            <span className="text-xs text-text-4 font-mono tracking-widest">{'*'.repeat(16)}</span>
          </div>
          <Button variant="ghost" size="sm" onClick={handleDelete} disabled={deleting} className="text-text-3 hover:text-danger">
            {deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <SecretInput
              value={value}
              onChange={setValue}
              placeholder={envKey.placeholder || `Enter ${envKey.label.toLowerCase()}...`}
              disabled={saving}
            />
          </div>
          <Button variant="primary" size="sm" onClick={handleSave} disabled={saving || !value.trim()}>
            {saving ? <Loader2 size={12} className="animate-spin" /> : 'Save'}
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Step: Overview ──────────────────────────────────────
function OverviewStep({ item, status, installing, onInstall, onUninstall, onNext }) {
  const isInstalled = status?.installed;

  return (
    <div className="px-5 py-5 space-y-5">
      {/* Header */}
      <div className="flex items-start gap-4">
        <IntegrationIcon item={item} size={52} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-text-0 font-sans">{item.name}</h2>
            {(item.verified === 'mcp-official' || item.verified === 'verified') && (
              <Badge variant="accent" className="text-2xs gap-1">
                <Shield size={9} /> Verified
              </Badge>
            )}
          </div>
          <p className="text-xs text-text-3 font-sans mt-0.5">{item.author || 'Community'}</p>
          {item.category && (
            <Badge variant="default" className="text-2xs mt-2">{item.category}</Badge>
          )}
        </div>
      </div>

      {/* Description */}
      <p className="text-sm text-text-2 font-sans leading-relaxed">{item.description}</p>

      {/* Tags */}
      {item.tags?.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {item.tags.map((tag) => (
            <span key={tag} className="text-2xs text-text-3 font-sans px-2 py-0.5 rounded bg-surface-4">{tag}</span>
          ))}
        </div>
      )}

      <div className="h-px bg-border-subtle" />

      {/* Action */}
      {isInstalled ? (
        <div className="flex items-center gap-3">
          <div className="flex-1 flex items-center gap-2">
            <CheckCircle size={16} className="text-success" />
            <span className="text-sm font-medium text-success font-sans">Installed</span>
          </div>
          <Button variant="ghost" size="sm" onClick={onUninstall} className="text-text-3 hover:text-danger gap-1.5">
            <Trash2 size={12} /> Uninstall
          </Button>
          <Button variant="primary" size="sm" onClick={onNext} className="gap-1">
            Configure <ChevronRight size={12} />
          </Button>
        </div>
      ) : (
        <Button
          variant="primary"
          size="lg"
          onClick={onInstall}
          disabled={installing}
          className="w-full gap-2"
        >
          {installing ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              Installing...
            </>
          ) : (
            'Install'
          )}
        </Button>
      )}

      {installing && (
        <p className="text-2xs text-text-4 font-sans text-center">This may take up to 30 seconds...</p>
      )}
    </div>
  );
}

// ── Step: Configure ─────────────────────────────────────
function ConfigureStep({ item, status, onDone, onRefreshStatus }) {
  const toast = useToast();
  const [authenticating, setAuthenticating] = useState(false);
  const authType = item.authType;

  async function handleGoogleAutoAuth() {
    setAuthenticating(true);
    try {
      await api.post(`/integrations/${item.id}/authenticate`);
      toast.success('Browser opened — complete sign-in there');
    } catch (err) {
      toast.error('Auth failed', err.message);
    }
    setAuthenticating(false);
  }

  async function handleOAuthStart() {
    setAuthenticating(true);
    try {
      const data = await api.post(`/integrations/${item.id}/oauth/start`);
      if (data.url) {
        window.open(data.url, '_blank', 'noopener');
        toast.success('Browser opened — complete sign-in there');
      }
    } catch (err) {
      toast.error('OAuth failed', err.message);
    }
    setAuthenticating(false);
  }

  // Check if all required keys are set
  const envKeys = status?.envKeys || [];
  const allRequired = envKeys.filter((ek) => ek.required && !ek.hidden);
  const allSet = allRequired.length === 0 || allRequired.every((ek) => ek.set);

  return (
    <div className="px-5 py-5 space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <IntegrationIcon item={item} size={36} />
        <div>
          <h2 className="text-sm font-bold text-text-0 font-sans">Configure {item.name}</h2>
          <p className="text-2xs text-text-3 font-sans">Set up credentials to connect</p>
        </div>
      </div>

      {/* Setup steps */}
      {item.setupSteps?.length > 0 && (
        <div className="bg-surface-2 rounded-md px-4 py-3 space-y-2">
          <span className="text-xs font-semibold text-text-1 font-sans">Setup guide</span>
          <ol className="space-y-1.5">
            {item.setupSteps.map((step, i) => (
              <li key={i} className="flex gap-2 text-xs text-text-2 font-sans leading-relaxed">
                <span className="text-text-4 font-mono flex-shrink-0 w-4 text-right">{i + 1}.</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
          {item.setupUrl && (
            <a
              href={item.setupUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-accent font-sans hover:underline mt-1"
            >
              <ExternalLink size={11} />
              {new URL(item.setupUrl).hostname}
            </a>
          )}
        </div>
      )}

      <div className="h-px bg-border-subtle" />

      {/* Auth type specific UI */}
      {authType === 'api-key' && (
        <div className="space-y-4">
          {envKeys.filter((ek) => !ek.hidden).map((ek) => (
            <CredentialRow
              key={ek.key}
              integrationId={item.id}
              envKey={ek}
              onSaved={onRefreshStatus}
            />
          ))}
        </div>
      )}

      {authType === 'google-autoauth' && (
        <div className="space-y-3">
          <Button
            variant="primary"
            size="lg"
            onClick={handleGoogleAutoAuth}
            disabled={authenticating}
            className="w-full gap-2"
          >
            {authenticating ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Opening browser...
              </>
            ) : (
              <>
                <img src="https://cdn.simpleicons.org/google/white" alt="" className="w-4 h-4" />
                Sign in with Google
              </>
            )}
          </Button>
          <p className="text-2xs text-text-4 font-sans text-center">
            A browser window will open for Google authorization
          </p>
        </div>
      )}

      {authType === 'oauth-google' && (
        <div className="space-y-3">
          <Button
            variant="primary"
            size="lg"
            onClick={handleOAuthStart}
            disabled={authenticating}
            className="w-full gap-2"
          >
            {authenticating ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Connecting...
              </>
            ) : (
              <>
                <img src="https://cdn.simpleicons.org/google/white" alt="" className="w-4 h-4" />
                Connect with Google
              </>
            )}
          </Button>
          <p className="text-2xs text-text-4 font-sans text-center">
            Authorize Groove to access your {item.name}
          </p>
        </div>
      )}

      {/* Done button */}
      <Button
        variant={allSet ? 'primary' : 'secondary'}
        size="lg"
        onClick={onDone}
        className="w-full gap-1.5"
      >
        {allSet ? (
          <>
            <Check size={14} />
            Done
          </>
        ) : (
          'Skip for now'
        )}
      </Button>
    </div>
  );
}

// ── Step: Done ──────────────────────────────────────────
function DoneStep({ item, onClose }) {
  return (
    <div className="px-5 py-10 flex flex-col items-center text-center space-y-4">
      <div className="w-14 h-14 rounded-full bg-success/15 flex items-center justify-center">
        <CheckCircle size={28} className="text-success" />
      </div>
      <div>
        <h2 className="text-base font-bold text-text-0 font-sans">Integration ready</h2>
        <p className="text-sm text-text-3 font-sans mt-1">
          {item.name} is installed and configured. Agents can now use it.
        </p>
      </div>
      <Button variant="primary" size="lg" onClick={onClose} className="mt-2">
        Close
      </Button>
    </div>
  );
}

// ── Main Wizard ─────────────────────────────────────────
export function IntegrationWizard({ integration, open, onClose }) {
  const toast = useToast();
  const [step, setStep] = useState('overview'); // overview | configure | done
  const [status, setStatus] = useState(null);
  const [installing, setInstalling] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState(true);

  const fetchStatus = useCallback(async () => {
    try {
      const data = await api.get(`/integrations/${integration.id}/status`);
      setStatus(data);
    } catch {
      setStatus(null);
    }
    setLoadingStatus(false);
  }, [integration.id]);

  useEffect(() => {
    if (open && integration) {
      setStep('overview');
      setLoadingStatus(true);
      fetchStatus();
    }
  }, [open, integration, fetchStatus]);

  async function handleInstall() {
    setInstalling(true);
    try {
      await api.post(`/integrations/${integration.id}/install`);
      toast.success(`${integration.name} installed`);
      await fetchStatus();
      setStep('configure');
    } catch (err) {
      toast.error('Install failed', err.message);
    }
    setInstalling(false);
  }

  async function handleUninstall() {
    try {
      await api.delete(`/integrations/${integration.id}`);
      toast.success(`${integration.name} uninstalled`);
      await fetchStatus();
    } catch (err) {
      toast.error('Uninstall failed', err.message);
    }
  }

  function handleConfigureNext() {
    setStep('configure');
  }

  function handleDone() {
    setStep('done');
  }

  if (!integration) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent
        title={step === 'overview' ? integration.name : step === 'configure' ? 'Configure' : 'Complete'}
        description={`Setup wizard for ${integration.name}`}
        className="max-w-md"
      >
        {loadingStatus ? (
          <div className="px-5 py-10 flex items-center justify-center">
            <Loader2 size={20} className="animate-spin text-text-4" />
          </div>
        ) : step === 'overview' ? (
          <OverviewStep
            item={integration}
            status={status}
            installing={installing}
            onInstall={handleInstall}
            onUninstall={handleUninstall}
            onNext={handleConfigureNext}
          />
        ) : step === 'configure' ? (
          <ConfigureStep
            item={integration}
            status={status}
            onDone={handleDone}
            onRefreshStatus={fetchStatus}
          />
        ) : (
          <DoneStep item={integration} onClose={onClose} />
        )}
      </DialogContent>
    </Dialog>
  );
}
