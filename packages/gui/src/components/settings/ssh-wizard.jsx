// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useEffect } from 'react';
import { Button } from '../ui/button';
import { StatusDot } from '../ui/status-dot';
import { FolderBrowser } from '../agents/folder-browser';
import { useGrooveStore } from '../../stores/groove';
import { cn } from '../../lib/cn';
import {
  FolderSearch, Check, X, AlertTriangle, Loader2,
  ExternalLink, Server, KeyRound, Settings, Plug,
} from 'lucide-react';

const STEPS = [
  { id: 'details', label: 'Server Details', icon: Server },
  { id: 'auth', label: 'Authentication', icon: KeyRound },
  { id: 'setup', label: 'Setup', icon: Settings },
  { id: 'connected', label: 'Connected', icon: Plug },
];

function StepIndicator({ steps, currentStep, completedSteps, onStepClick }) {
  return (
    <div className="flex items-center gap-1 mb-4">
      {steps.map((step, i) => {
        const isActive = currentStep === i;
        const isCompleted = completedSteps.includes(i);
        const isClickable = isCompleted || i < currentStep;
        const Icon = step.icon;

        return (
          <div key={step.id} className="flex items-center gap-1 flex-1">
            <button
              onClick={() => isClickable && onStepClick(i)}
              disabled={!isClickable}
              className={cn(
                'flex items-center gap-1.5 px-2 py-1 rounded-md transition-colors text-2xs font-sans font-medium',
                isActive
                  ? 'bg-accent/12 text-accent'
                  : isCompleted
                    ? 'text-success cursor-pointer hover:bg-surface-3'
                    : 'text-text-4',
                isClickable && !isActive && 'cursor-pointer',
              )}
            >
              <div className={cn(
                'w-5 h-5 rounded-full flex items-center justify-center text-2xs font-semibold border transition-colors',
                isActive
                  ? 'border-accent bg-accent/15 text-accent'
                  : isCompleted
                    ? 'border-success/40 bg-success/10 text-success'
                    : 'border-border-subtle bg-surface-3 text-text-4',
              )}>
                {isCompleted ? <Check size={10} /> : i + 1}
              </div>
              <span className="hidden sm:inline">{step.label}</span>
            </button>
            {i < steps.length - 1 && (
              <div className={cn(
                'flex-1 h-px mx-1',
                isCompleted ? 'bg-success/30' : 'bg-border-subtle',
              )} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function ToggleSwitch({ value, onChange }) {
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

function FieldCard({ icon: Icon, title, children }) {
  return (
    <div className="rounded-lg border border-border-subtle bg-surface-1 px-4 py-3.5 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded bg-accent/8 flex items-center justify-center flex-shrink-0">
          <Icon size={12} className="text-accent" />
        </div>
        <span className="text-[13px] font-medium text-text-0 font-sans leading-tight">{title}</span>
      </div>
      <div className="mt-1">{children}</div>
    </div>
  );
}

export function SSHWizard({ server, onSave, onTest, onConnect, onCancel }) {
  const remoteHomedir = useGrooveStore((s) => s.remoteHomedir);
  const [step, setStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState([]);

  const [name, setName] = useState('');
  const [host, setHost] = useState('');
  const [user, setUser] = useState('');
  const [sshPort, setSshPort] = useState(22);
  const [sshKeyPath, setSshKeyPath] = useState('');
  const [autoStart, setAutoStart] = useState(false);
  const [autoConnect, setAutoConnect] = useState(false);
  const [keyBrowserOpen, setKeyBrowserOpen] = useState(false);

  const [testLoading, setTestLoading] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    if (server) {
      setName(server.name || '');
      setHost(server.host || '');
      setUser(server.user || '');
      setSshPort(server.port || 22);
      setSshKeyPath(server.sshKeyPath || '');
      setAutoStart(server.autoStart || false);
      setAutoConnect(server.autoConnect || false);
      setCompletedSteps([0, 1]);
      setStep(2);
    } else {
      setName('');
      setHost('');
      setUser('');
      setSshPort(22);
      setSshKeyPath('');
      setAutoStart(false);
      setAutoConnect(false);
      setCompletedSteps([]);
      setStep(0);
    }
  }, [server]);

  function buildData() {
    const data = {
      name: name.trim(),
      host: host.trim(),
      user: user.trim(),
      port: sshPort,
      sshKeyPath: sshKeyPath.trim(),
      autoStart,
      autoConnect,
    };
    if (server?.id) data.id = server.id;
    return data;
  }

  function canAdvanceStep0() {
    return name.trim() && host.trim() && user.trim();
  }

  function handleNext() {
    if (step === 0 && !canAdvanceStep0()) return;
    setCompletedSteps((prev) => prev.includes(step) ? prev : [...prev, step]);
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  function handleBack() {
    setStep((s) => Math.max(s - 1, 0));
  }

  async function handleTest() {
    setTestLoading(true);
    setTestResult(null);
    try {
      const data = buildData();
      setSaving(true);
      await onSave(data);
      setSaving(false);
      const result = await onTest();
      setTestResult(result);
    } catch (err) {
      setTestResult({ error: err.message || 'Test failed' });
      setSaving(false);
    }
    setTestLoading(false);
  }

  async function handleSaveAndSetup() {
    setSaving(true);
    try {
      const data = buildData();
      await onSave(data);
      setCompletedSteps((prev) => prev.includes(step) ? prev : [...prev, step]);
      setStep(2);
    } catch (err) {
      setTestResult({ error: err.message || 'Save failed' });
    }
    setSaving(false);
  }

  async function handleConnect() {
    setConnecting(true);
    try {
      const data = buildData();
      await onSave(data);
      await onConnect();
      setCompletedSteps((prev) => [...new Set([...prev, 2])]);
      setStep(3);
    } catch (err) {
      setTestResult({ error: err?.body?.error || err?.message || 'Connection failed' });
    }
    setConnecting(false);
  }

  const inputCls = 'h-8 px-2.5 text-xs bg-surface-0 border border-border-subtle rounded-md text-text-0 font-sans placeholder:text-text-4 focus:outline-none focus:ring-1 focus:ring-accent';
  const monoInputCls = 'h-8 px-2.5 text-xs bg-surface-0 border border-border-subtle rounded-md text-text-0 font-mono placeholder:text-text-4 focus:outline-none focus:ring-1 focus:ring-accent';

  return (
    <div className="p-4">
      <StepIndicator
        steps={STEPS}
        currentStep={step}
        completedSteps={completedSteps}
        onStepClick={setStep}
      />

      {/* Step 0: Server Details */}
      {step === 0 && (
        <div className="grid grid-cols-2 gap-3">
          <FieldCard icon={Server} title="Server Info">
            <div className="space-y-2.5">
              <div>
                <label className="text-2xs font-semibold text-text-2 font-sans mb-1 block">Name</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="api-vps"
                  className={cn(inputCls, 'w-full')}
                  autoFocus
                />
              </div>
              <div>
                <label className="text-2xs font-semibold text-text-2 font-sans mb-1 block">Host</label>
                <input
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  placeholder="165.22.180.45"
                  className={cn(monoInputCls, 'w-full')}
                />
              </div>
            </div>
          </FieldCard>

          <FieldCard icon={Settings} title="Connection">
            <div className="space-y-2.5">
              <div>
                <label className="text-2xs font-semibold text-text-2 font-sans mb-1 block">User</label>
                <input
                  value={user}
                  onChange={(e) => setUser(e.target.value)}
                  placeholder="root"
                  className={cn(monoInputCls, 'w-full')}
                />
              </div>
              <div>
                <label className="text-2xs font-semibold text-text-2 font-sans mb-1 block">SSH Port</label>
                <input
                  value={sshPort}
                  onChange={(e) => setSshPort(Number(e.target.value) || 22)}
                  type="number"
                  className={cn(monoInputCls, 'w-24')}
                />
              </div>
            </div>
          </FieldCard>
        </div>
      )}

      {/* Step 1: Authentication */}
      {step === 1 && (
        <div className="grid grid-cols-2 gap-3">
          <FieldCard icon={KeyRound} title="SSH Key">
            <div className="space-y-2.5">
              <div>
                <label className="text-2xs font-semibold text-text-2 font-sans mb-1 block">Key Path</label>
                <div className="flex items-center gap-1.5">
                  <input
                    value={sshKeyPath}
                    onChange={(e) => setSshKeyPath(e.target.value)}
                    placeholder="~/.ssh/id_ed25519"
                    className={cn(monoInputCls, 'flex-1 min-w-0')}
                    autoFocus
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setKeyBrowserOpen(true)}
                    className="h-8 px-2 flex-shrink-0"
                  >
                    <FolderSearch size={12} />
                  </Button>
                </div>
                <p className="text-2xs text-text-4 font-sans mt-1">
                  Leave blank to use default SSH agent.
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleTest}
                disabled={testLoading}
                className="h-7 text-2xs gap-1.5"
              >
                {testLoading ? <Loader2 size={11} className="animate-spin" /> : <Plug size={11} />}
                Test Connection
              </Button>
            </div>
          </FieldCard>

          <div className="space-y-3">
            <div className="rounded-lg border border-border-subtle bg-surface-1 px-4 py-3.5">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-6 h-6 rounded bg-accent/8 flex items-center justify-center flex-shrink-0">
                  <Server size={12} className="text-accent" />
                </div>
                <span className="text-[13px] font-medium text-text-0 font-sans">Target</span>
              </div>
              <div className="space-y-1.5 text-2xs font-sans">
                <div className="flex items-center justify-between">
                  <span className="text-text-3">Host</span>
                  <span className="text-text-1 font-mono">{host || '—'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-text-3">User</span>
                  <span className="text-text-1 font-mono">{user || '—'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-text-3">Port</span>
                  <span className="text-text-1 font-mono">{sshPort}</span>
                </div>
              </div>
            </div>

            {testResult && (
              <div className={cn(
                'px-3 py-2.5 rounded-lg text-2xs font-sans flex items-start gap-2',
                testResult.error
                  ? 'bg-danger/8 border border-danger/20 text-danger'
                  : testResult.reachable
                    ? 'bg-success/8 border border-success/20 text-success'
                    : 'bg-warning/8 border border-warning/20 text-warning',
              )}>
                {testResult.error ? (
                  <><X size={11} className="mt-0.5 flex-shrink-0" /> {testResult.error}</>
                ) : testResult.reachable ? (
                  <><Check size={11} className="mt-0.5 flex-shrink-0" /> Server reachable</>
                ) : (
                  <><AlertTriangle size={11} className="mt-0.5 flex-shrink-0" /> Host unreachable</>
                )}
              </div>
            )}
          </div>

          <FolderBrowser
            open={keyBrowserOpen}
            onOpenChange={setKeyBrowserOpen}
            currentPath={sshKeyPath || '~/.ssh'}
            homePath={remoteHomedir}
            onSelect={(path) => setSshKeyPath(path)}
          />
        </div>
      )}

      {/* Step 2: Setup */}
      {step === 2 && (
        <div className="grid grid-cols-2 gap-3">
          <FieldCard icon={Settings} title="Behavior">
            <div className="space-y-3">
              <label className="flex items-center justify-between cursor-pointer">
                <div>
                  <span className="text-xs text-text-1 font-sans block">Auto-start daemon</span>
                  <span className="text-2xs text-text-4 font-sans">Start Groove on the remote when connecting</span>
                </div>
                <ToggleSwitch value={autoStart} onChange={setAutoStart} />
              </label>
              <label className="flex items-center justify-between cursor-pointer">
                <div>
                  <span className="text-xs text-text-1 font-sans block">Auto-connect on launch</span>
                  <span className="text-2xs text-text-4 font-sans">Connect when Groove starts</span>
                </div>
                <ToggleSwitch value={autoConnect} onChange={setAutoConnect} />
              </label>
            </div>
          </FieldCard>

          {testResult && !testResult.error && (
            <div className="rounded-lg border border-border-subtle bg-surface-1 px-4 py-3.5">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-6 h-6 rounded bg-success/10 flex items-center justify-center flex-shrink-0">
                  <Check size={12} className="text-success" />
                </div>
                <span className="text-[13px] font-medium text-text-0 font-sans">Test Results</span>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-2xs font-sans">
                  <StatusDot status={testResult.reachable ? 'running' : 'crashed'} size="sm" />
                  <span className="text-text-1">Reachable</span>
                </div>
                <div className="flex items-center gap-2 text-2xs font-sans">
                  <StatusDot status={testResult.grooveInstalled ? 'running' : 'stopped'} size="sm" />
                  <span className="text-text-1">Groove Installed</span>
                </div>
                <div className="flex items-center gap-2 text-2xs font-sans">
                  <StatusDot status={testResult.daemonRunning ? 'running' : 'stopped'} size="sm" />
                  <span className="text-text-1">Daemon Running</span>
                </div>
              </div>
            </div>
          )}

          {(!testResult || testResult.error) && (
            <div className="rounded-lg border border-border-subtle bg-surface-1 px-4 py-3.5">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-6 h-6 rounded bg-accent/8 flex items-center justify-center flex-shrink-0">
                  <Server size={12} className="text-accent" />
                </div>
                <span className="text-[13px] font-medium text-text-0 font-sans">{name || 'Server'}</span>
              </div>
              <div className="space-y-1.5 text-2xs font-sans">
                <div className="flex items-center justify-between">
                  <span className="text-text-3">Connection</span>
                  <span className="text-text-1 font-mono">{user}@{host}:{sshPort}</span>
                </div>
                {sshKeyPath && (
                  <div className="flex items-center justify-between">
                    <span className="text-text-3">SSH Key</span>
                    <span className="text-text-1 font-mono truncate max-w-40">{sshKeyPath}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Step 3: Connected */}
      {step === 3 && (
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-success/30 bg-success/5 px-4 py-5 text-center">
            <div className="w-10 h-10 rounded-full bg-success/15 flex items-center justify-center mx-auto mb-3">
              <Check size={20} className="text-success" />
            </div>
            <h3 className="text-sm font-semibold text-text-0 font-sans mb-1">Connected</h3>
            <p className="text-2xs text-text-3 font-sans">
              Successfully connected to <span className="font-mono text-text-1">{name}</span>
            </p>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                const port = server?.localPort;
                const n = encodeURIComponent(name);
                window.open(`http://localhost:${port}?instance=${n}`, '_blank');
              }}
              className="h-8 text-xs gap-1.5 mt-4"
            >
              <ExternalLink size={12} />
              Open Remote GUI
            </Button>
          </div>

          <div className="rounded-lg border border-border-subtle bg-surface-1 px-4 py-3.5">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-6 h-6 rounded bg-accent/8 flex items-center justify-center flex-shrink-0">
                <Server size={12} className="text-accent" />
              </div>
              <span className="text-[13px] font-medium text-text-0 font-sans">Connection Info</span>
            </div>
            <div className="space-y-1.5 text-2xs font-sans">
              <div className="flex items-center justify-between">
                <span className="text-text-3">Connection</span>
                <span className="text-text-1 font-mono">{user}@{host}:{sshPort}</span>
              </div>
              {sshKeyPath && (
                <div className="flex items-center justify-between">
                  <span className="text-text-3">SSH Key</span>
                  <span className="text-text-1 font-mono truncate max-w-40">{sshKeyPath}</span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-text-3">Auto-start</span>
                <span className="text-text-1">{autoStart ? 'On' : 'Off'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-text-3">Auto-connect</span>
                <span className="text-text-1">{autoConnect ? 'On' : 'Off'}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Navigation footer */}
      <div className="flex items-center justify-between mt-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={step === 0 ? onCancel : step === 3 ? onCancel : handleBack}
          className="h-8 text-xs px-4 text-text-3"
        >
          {step === 0 ? 'Cancel' : step === 3 ? 'Done' : 'Back'}
        </Button>
        {step < 3 && (
          <div className="flex gap-2">
            {step === 2 ? (
              <Button
                variant="primary"
                size="sm"
                onClick={handleConnect}
                disabled={connecting || saving}
                className="h-8 text-xs px-4 gap-1.5"
              >
                {connecting ? <Loader2 size={12} className="animate-spin" /> : <Plug size={12} />}
                {connecting ? 'Connecting...' : 'Connect'}
              </Button>
            ) : step === 1 ? (
              <Button
                variant="primary"
                size="sm"
                onClick={handleSaveAndSetup}
                disabled={saving}
                className="h-8 text-xs px-4"
              >
                {saving ? 'Saving...' : 'Next'}
              </Button>
            ) : (
              <Button
                variant="primary"
                size="sm"
                onClick={handleNext}
                disabled={!canAdvanceStep0()}
                className="h-8 text-xs px-4"
              >
                Next
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
