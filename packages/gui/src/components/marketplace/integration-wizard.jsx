// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useEffect, useCallback, useRef } from 'react';
import { Dialog, DialogContent } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { api } from '../../lib/api';
import { useToast } from '../../lib/hooks/use-toast';
import { integrationOAuth } from '../../lib/electron';
import {
  Check, CheckCircle, ExternalLink, Loader2, Eye, EyeOff,
  Key, Shield, Trash2, ChevronRight, X, Copy, RefreshCw,
} from 'lucide-react';

// Reuse integration logos from marketplace-card
const INTEGRATION_LOGOS = {
  slack:       'https://cdn.simpleicons.org/slack/E01E5A',
  github:      'https://cdn.simpleicons.org/github/white',
  stripe:      'https://cdn.simpleicons.org/stripe/635BFF',
  gmail:       'https://cdn.simpleicons.org/gmail/EA4335',
  'google-calendar': 'https://cdn.simpleicons.org/googlecalendar/4285F4',
  'google-drive':    'https://cdn.simpleicons.org/googledrive/4285F4',
  'google-docs':     'https://cdn.simpleicons.org/googledocs/4285F4',
  'google-sheets':   'https://cdn.simpleicons.org/googlesheets/34A853',
  'google-slides':   'https://cdn.simpleicons.org/googleslides/FBBC04',
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

// ── Which APIs each Google integration needs ───────────
const GOOGLE_API_NAMES = {
  gmail:             'Gmail API',
  'google-calendar': 'Google Calendar API',
  'google-drive':    'Google Drive API',
  'google-docs':     'Google Docs API',
  'google-sheets':   'Google Sheets API',
  'google-slides':   'Google Slides API',
};

// ── Google OAuth Setup (shared by google-autoauth + oauth-google) ──
function GoogleOAuthSetup({ integrationId, onConfigured }) {
  const toast = useToast();
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [saving, setSaving] = useState(false);

  const apiName = GOOGLE_API_NAMES[integrationId] || 'the relevant Google API';

  async function handleSave() {
    if (!clientId.trim() || !clientSecret.trim()) return;
    setSaving(true);
    try {
      await api.post('/integrations/google-oauth/setup', {
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim(),
      });
      toast.success('Google OAuth credentials saved');
      onConfigured();
    } catch (err) {
      toast.error('Failed to save', err.message);
    }
    setSaving(false);
  }

  const redirectUri = 'http://localhost:31415/api/integrations/oauth/callback';

  const steps = [
    { text: 'Go to the Google Cloud Console and sign in with your Google account',
      link: { url: 'https://console.cloud.google.com', label: 'Open Google Cloud Console' } },
    { text: 'Create a new project (or select an existing one). Any name is fine — this is just a container for your credentials.' },
    { text: <>Enable the <strong>{apiName}</strong> — search for it in the API Library and click <strong>Enable</strong></>,
      link: { url: 'https://console.cloud.google.com/apis/library', label: 'Open API Library' } },
    { text: <>Go to <strong>Credentials</strong> and click <strong>Create Credentials</strong> &rarr; <strong>OAuth client ID</strong></>,
      link: { url: 'https://console.cloud.google.com/apis/credentials', label: 'Open Credentials page' } },
    { text: <>If prompted to configure the consent screen, choose <strong>External</strong>, fill in an app name (e.g. &quot;Groove&quot;), your email, and save. You can skip optional fields.</> },
    { text: <>For Application type, choose <strong>Web application</strong>. Give it any name.</> },
    { text: <>Under <strong>Authorized redirect URIs</strong>, click <strong>Add URI</strong> and paste this exact URL:</>,
      copyable: redirectUri },
    { text: <>Click <strong>Create</strong>, then copy the <strong>Client ID</strong> and <strong>Client Secret</strong> and paste them below.</> },
  ];

  return (
    <div className="space-y-4">
      <div className="bg-surface-2 rounded-md px-4 py-3 space-y-3">
        <span className="text-xs font-semibold text-text-1 font-sans">How to get your Google credentials</span>
        <ol className="space-y-2.5">
          {steps.map((step, i) => (
            <li key={i} className="flex gap-2.5 text-xs text-text-2 font-sans leading-relaxed">
              <span className="text-accent font-mono font-bold flex-shrink-0 w-4 text-right">{i + 1}.</span>
              <div className="min-w-0">
                <span>{step.text}</span>
                {step.link && (
                  <a
                    href={step.link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-2xs text-accent font-sans hover:underline mt-0.5"
                  >
                    <ExternalLink size={9} />
                    {step.link.label}
                  </a>
                )}
                {step.copyable && (
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <code className="flex-1 min-w-0 text-2xs font-mono text-accent bg-surface-4 px-2.5 py-1.5 rounded select-all break-all">
                      {step.copyable}
                    </code>
                    <button
                      type="button"
                      onClick={() => { navigator.clipboard.writeText(step.copyable); }}
                      className="flex-shrink-0 p-1.5 rounded text-text-3 hover:text-accent hover:bg-accent/10 transition-colors cursor-pointer"
                      title="Copy to clipboard"
                    >
                      <Copy size={12} />
                    </button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div className="bg-accent/8 border border-accent/15 rounded-md px-4 py-2.5">
        <p className="text-2xs text-text-2 font-sans leading-relaxed">
          <strong className="text-text-1">One-time setup</strong> — these same credentials work for
          Gmail, Calendar, Drive, Docs, Sheets, and Slides. You only need to do this once.
          For each integration, just enable the matching API in your Google Cloud project.
        </p>
      </div>

      <div className="h-px bg-border-subtle" />

      <div className="space-y-3">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-text-2 font-sans flex items-center gap-1.5">
            <Key size={11} className="text-text-4" />
            Client ID <span className="text-danger">*</span>
          </label>
          <SecretInput value={clientId} onChange={setClientId} placeholder="123456789.apps.googleusercontent.com" disabled={saving} />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-text-2 font-sans flex items-center gap-1.5">
            <Key size={11} className="text-text-4" />
            Client Secret <span className="text-danger">*</span>
          </label>
          <SecretInput value={clientSecret} onChange={setClientSecret} placeholder="GOCSPX-..." disabled={saving} />
        </div>
      </div>
      <Button
        variant="primary"
        size="lg"
        onClick={handleSave}
        disabled={saving || !clientId.trim() || !clientSecret.trim()}
        className="w-full gap-2"
      >
        {saving ? <><Loader2 size={14} className="animate-spin" /> Saving...</> : 'Save Credentials'}
      </Button>
    </div>
  );
}

// ── Step: Configure ─────────────────────────────────────
function ConfigureStep({ item, status, onDone, onRefreshStatus }) {
  const toast = useToast();
  const [authenticating, setAuthenticating] = useState(false);
  const [googleOAuthReady, setGoogleOAuthReady] = useState(null);
  const authType = item.authType;
  const needsGoogleOAuth = authType === 'google-autoauth' || authType === 'oauth-google';

  useEffect(() => {
    if (needsGoogleOAuth) {
      api.get('/integrations/google-oauth/status')
        .then((d) => setGoogleOAuthReady(d.configured))
        .catch(() => setGoogleOAuthReady(false));
    }
  }, [needsGoogleOAuth]);

  async function handleOAuthStart() {
    setAuthenticating(true);
    try {
      const data = await api.post(`/integrations/${item.id}/oauth/start`);
      if (data.url) {
        const result = await integrationOAuth(data.url);
        if (result?.error) {
          toast.error('Sign-in failed', result.error);
        } else {
          toast.success('Browser opened — complete sign-in there');
        }
      }
    } catch (err) {
      toast.error('Sign-in failed', err.message);
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

      {/* Setup steps — hide when Google OAuth setup guide is showing (it has its own steps) */}
      {item.setupSteps?.length > 0 && !(needsGoogleOAuth && googleOAuthReady === false) && (
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

      {!(needsGoogleOAuth && googleOAuthReady === false) && <div className="h-px bg-border-subtle" />}

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

      {needsGoogleOAuth && googleOAuthReady === false && (
        <GoogleOAuthSetup integrationId={item.id} onConfigured={() => setGoogleOAuthReady(true)} />
      )}

      {needsGoogleOAuth && googleOAuthReady && (
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
            A browser window will open — sign in and allow access to your {item.name}
          </p>
          <button
            type="button"
            onClick={() => setGoogleOAuthReady(false)}
            className="w-full text-2xs text-text-4 font-sans hover:text-text-2 transition-colors cursor-pointer py-1"
          >
            Reconfigure Google OAuth credentials
          </button>
        </div>
      )}

      {needsGoogleOAuth && googleOAuthReady === null && (
        <div className="flex justify-center py-3">
          <Loader2 size={16} className="animate-spin text-text-4" />
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

  const integrationId = integration?.id;

  const fetchStatus = useCallback(async () => {
    if (!integrationId) return;
    try {
      const data = await api.get(`/integrations/${integrationId}/status`);
      setStatus(data);
    } catch {
      setStatus(null);
    }
    setLoadingStatus(false);
  }, [integrationId]);

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

// ── Google Workspace Wizard ────────────────────────────
const GOOGLE_IDS = ['gmail', 'google-calendar', 'google-drive', 'google-docs', 'google-sheets', 'google-slides'];

function ServiceRow({ item, status, onInstall, onUninstall, busy }) {
  const installed = status?.installed;
  const authenticated = status?.authenticated;

  return (
    <div className="flex items-center gap-3 px-3 py-2.5 rounded-md bg-surface-2 border border-border-subtle">
      <IntegrationIcon item={item} size={32} />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-semibold text-text-0 font-sans">{item.name}</div>
        <div className="text-2xs text-text-3 font-sans truncate">{item.description}</div>
      </div>
      {installed && authenticated && !status?.needsReauth && (
        <Badge variant="success" className="text-2xs flex-shrink-0 gap-1">
          <Check size={8} /> Ready
        </Badge>
      )}
      {installed && authenticated && status?.needsReauth && (
        <Badge variant="warning" className="text-2xs flex-shrink-0 gap-1">
          <RefreshCw size={8} /> Update
        </Badge>
      )}
      {installed && !authenticated && (
        <Badge variant="warning" className="text-2xs flex-shrink-0">Needs sign-in</Badge>
      )}
      <Button
        variant={installed ? 'ghost' : 'primary'}
        size="sm"
        onClick={() => installed ? onUninstall(item.id) : onInstall(item.id)}
        disabled={busy === item.id}
        className={installed ? 'text-text-3 hover:text-danger' : ''}
      >
        {busy === item.id ? (
          <Loader2 size={12} className="animate-spin" />
        ) : installed ? (
          <Trash2 size={12} />
        ) : (
          'Install'
        )}
      </Button>
    </div>
  );
}

export function GoogleWorkspaceWizard({ integrations, open, onClose }) {
  const toast = useToast();
  const [googleOAuthReady, setGoogleOAuthReady] = useState(null);
  const [statuses, setStatuses] = useState({});
  const [busy, setBusy] = useState(null);
  const [authenticating, setAuthenticating] = useState(false);
  const [loading, setLoading] = useState(true);
  const pollRef = useRef(null);

  const googleItems = integrations.filter((i) => GOOGLE_IDS.includes(i.id));

  const fetchStatuses = useCallback(async () => {
    const results = {};
    await Promise.all(googleItems.map(async (item) => {
      try {
        results[item.id] = await api.get(`/integrations/${item.id}/status`);
      } catch {
        results[item.id] = null;
      }
    }));
    setStatuses(results);
    setLoading(false);
  }, [googleItems.map((i) => i.id).join(',')]);

  useEffect(() => {
    if (open) {
      setLoading(true);
      api.get('/integrations/google-oauth/status')
        .then((d) => setGoogleOAuthReady(d.configured))
        .catch(() => setGoogleOAuthReady(false));
      fetchStatuses();
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [open]);

  const installedIds = Object.entries(statuses).filter(([, s]) => s?.installed).map(([id]) => id);
  const allAuthenticated = installedIds.length > 0 && installedIds.every((id) => statuses[id]?.authenticated);
  const needsAuth = installedIds.some((id) => !statuses[id]?.authenticated);
  const needsReauth = allAuthenticated && installedIds.some((id) => statuses[id]?.needsReauth);

  async function handleInstall(id) {
    setBusy(id);
    try {
      await api.post(`/integrations/${id}/install`);
      toast.success(`${googleItems.find((i) => i.id === id)?.name} installed`);
      await fetchStatuses();
    } catch (err) {
      toast.error('Install failed', err.message);
    }
    setBusy(null);
  }

  async function handleUninstall(id) {
    setBusy(id);
    try {
      await api.delete(`/integrations/${id}`);
      toast.success(`${googleItems.find((i) => i.id === id)?.name} removed`);
      await fetchStatuses();
    } catch (err) {
      toast.error('Uninstall failed', err.message);
    }
    setBusy(null);
  }

  async function handleConnect() {
    if (!installedIds.length) {
      toast.error('Install at least one service first');
      return;
    }
    setAuthenticating(true);
    try {
      const data = await api.post('/integrations/google-workspace/oauth/start', { integrationIds: installedIds });
      if (data.url) {
        const result = await integrationOAuth(data.url);
        if (result?.error) {
          toast.error('Sign-in failed', result.error);
          setAuthenticating(false);
          return;
        }
        toast.success('Browser opened — complete sign-in there');
        // Poll for auth completion
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = setInterval(async () => {
          await fetchStatuses();
        }, 3000);
        // Stop polling after 3 minutes
        setTimeout(() => { if (pollRef.current) clearInterval(pollRef.current); }, 180_000);
      }
    } catch (err) {
      toast.error('Sign-in failed', err.message);
    }
    setAuthenticating(false);
  }

  // Stop polling once all installed services are authenticated
  useEffect(() => {
    if (allAuthenticated && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, [allAuthenticated]);

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent
        title="Google Workspace"
        description="Connect your Google services"
        className="max-w-md"
      >
        <div className="px-5 py-5 space-y-5">
          {/* Header */}
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-lg bg-surface-4 flex items-center justify-center flex-shrink-0">
              <img src="https://cdn.simpleicons.org/google/white" alt="Google" className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-text-0 font-sans">Google Workspace</h2>
              <p className="text-2xs text-text-3 font-sans">
                One set of credentials for all Google services
              </p>
            </div>
          </div>

          {/* OAuth Setup */}
          {googleOAuthReady === false && (
            <GoogleOAuthSetup integrationId="gmail" onConfigured={() => setGoogleOAuthReady(true)} />
          )}

          {googleOAuthReady === null && (
            <div className="flex justify-center py-3">
              <Loader2 size={16} className="animate-spin text-text-4" />
            </div>
          )}

          {/* Services list */}
          {googleOAuthReady && (
            <>
              <div className="space-y-1.5">
                <span className="text-xs font-semibold text-text-2 font-sans">Services</span>
                <div className="space-y-1.5">
                  {loading ? (
                    Array.from({ length: 4 }).map((_, i) => (
                      <div key={i} className="h-14 rounded-md bg-surface-2 animate-pulse" />
                    ))
                  ) : (
                    googleItems.map((item) => (
                      <ServiceRow
                        key={item.id}
                        item={item}
                        status={statuses[item.id]}
                        onInstall={handleInstall}
                        onUninstall={handleUninstall}
                        busy={busy}
                      />
                    ))
                  )}
                </div>
              </div>

              <div className="h-px bg-border-subtle" />

              {/* Connect button */}
              {installedIds.length > 0 && !allAuthenticated && (
                <div className="space-y-3">
                  <Button
                    variant="primary"
                    size="lg"
                    onClick={handleConnect}
                    disabled={authenticating}
                    className="w-full gap-2"
                  >
                    {authenticating ? (
                      <><Loader2 size={14} className="animate-spin" /> Opening browser...</>
                    ) : (
                      <>
                        <img src="https://cdn.simpleicons.org/google/white" alt="" className="w-4 h-4" />
                        Sign in with Google
                      </>
                    )}
                  </Button>
                  <p className="text-2xs text-text-4 font-sans text-center">
                    Connects {installedIds.length} service{installedIds.length !== 1 ? 's' : ''} with one sign-in
                  </p>
                </div>
              )}

              {allAuthenticated && installedIds.length > 0 && (
                <div className="flex flex-col items-center text-center gap-2 py-2">
                  <div className="w-10 h-10 rounded-full bg-success/15 flex items-center justify-center">
                    <CheckCircle size={20} className="text-success" />
                  </div>
                  <p className="text-sm font-medium text-success font-sans">
                    All services connected
                  </p>
                  <p className="text-2xs text-text-3 font-sans">
                    Your agents can now use these Google integrations.
                  </p>
                  {needsReauth ? (
                    <div className="w-full space-y-2 pt-2">
                      <p className="text-2xs text-warning font-sans">
                        New permissions available — re-authenticate to enable all features.
                      </p>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={handleConnect}
                        disabled={authenticating}
                        className="w-full gap-2"
                      >
                        {authenticating ? (
                          <><Loader2 size={12} className="animate-spin" /> Opening browser...</>
                        ) : (
                          <><RefreshCw size={12} /> Re-authenticate</>
                        )}
                      </Button>
                    </div>
                  ) : (
                    <button
                      onClick={handleConnect}
                      disabled={authenticating}
                      className="text-2xs text-text-4 hover:text-text-2 font-sans underline underline-offset-2 transition-colors mt-1"
                    >
                      {authenticating ? 'Opening browser...' : 'Re-authenticate'}
                    </button>
                  )}
                </div>
              )}

              {installedIds.length === 0 && !loading && (
                <p className="text-xs text-text-4 font-sans text-center py-2">
                  Install at least one service above, then connect with Google.
                </p>
              )}
            </>
          )}

          {/* Close */}
          <Button
            variant="secondary"
            size="lg"
            onClick={onClose}
            className="w-full"
          >
            {allAuthenticated && installedIds.length > 0 ? 'Done' : 'Close'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
