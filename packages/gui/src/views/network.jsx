// FSL-1.1-Apache-2.0 — see LICENSE
import { useEffect, useState } from 'react';
import { useGrooveStore } from '../stores/groove';
import { StatusDot } from '../components/ui/status-dot';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Dialog, DialogContent, DialogTrigger } from '../components/ui/dialog';
import { ScrollArea } from '../components/ui/scroll-area';
import { cn } from '../lib/cn';
import { NodeToggle } from '../components/network/node-toggle';
import { ComputeHeader } from '../components/network/compute-header';
import { FleetTable } from '../components/network/fleet-table';
import { ActivityStream } from '../components/network/activity-stream';
import { NetworkHealth } from '../components/network/network-health';
import { HEX } from '../lib/theme-hex';
import { Globe, Download, Check, AlertCircle, Loader2, Trash2, ArrowUpCircle } from 'lucide-react';

const REQUIREMENTS = [
  'Python 3.10 or higher',
  '~2 GB disk space for model shards',
  '8 GB+ RAM recommended',
];

function InstallProgress({ progress }) {
  const percent = Math.max(0, Math.min(100, Number.isFinite(progress.percent) ? progress.percent : 0));
  return (
    <div className="w-full flex flex-col gap-3">
      <div className="h-2 w-full rounded-full bg-surface-3 overflow-hidden">
        <div
          className="h-full rounded-full bg-accent transition-all duration-500 ease-out"
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="flex items-center justify-between text-2xs font-mono text-text-3 tabular-nums">
        <div className="flex items-center gap-2 text-text-2 font-sans">
          <Loader2 size={12} className="animate-spin text-accent" />
          <span className="truncate">{progress.message || 'Installing\u2026'}</span>
        </div>
        <span>{percent}%</span>
      </div>
    </div>
  );
}

function InstallError({ message, onRetry }) {
  return (
    <div className="w-full flex flex-col gap-3">
      <div className="rounded-md border border-danger/40 bg-danger/10 px-4 py-3 flex items-start gap-2.5 text-left">
        <AlertCircle size={14} className="text-danger flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold text-danger font-sans mb-0.5">Install failed</div>
          <div className="text-xs text-text-1 font-sans break-words">{message}</div>
        </div>
      </div>
      <Button variant="primary" size="lg" onClick={onRetry} className="w-full">
        <Download size={14} />
        Retry Install
      </Button>
    </div>
  );
}

function InstallGate() {
  const installNetworkPackage = useGrooveStore((s) => s.installNetworkPackage);
  const progress = useGrooveStore((s) => s.networkInstallProgress);
  const { installing, error } = progress;

  return (
    <div className="flex flex-col items-center justify-center min-h-full px-6 py-12">
      <div className="w-full max-w-md flex flex-col items-center text-center">
        <div className="mb-5 rounded-full bg-surface-2 border border-border-subtle p-5">
          <Globe size={48} className="text-text-3" strokeWidth={1.25} />
        </div>
        <h3 className="text-base font-semibold text-text-0 font-sans mb-2">
          Install Groove Network
        </h3>
        <p className="text-sm text-text-2 font-sans leading-relaxed mb-6">
          The network package enables decentralized LLM inference. Contribute your compute power or run models across the Groove network.
        </p>

        <div className="w-full rounded-md border border-border-subtle bg-surface-1 px-4 py-3 mb-6">
          <div className="text-2xs font-semibold text-text-3 font-sans uppercase tracking-wider mb-2 text-left">
            Requirements
          </div>
          <ul className="flex flex-col gap-1.5">
            {REQUIREMENTS.map((req) => (
              <li key={req} className="flex items-center gap-2 text-xs font-sans text-text-1 text-left">
                <Check size={12} className="text-accent flex-shrink-0" />
                <span>{req}</span>
              </li>
            ))}
          </ul>
        </div>

        {installing ? (
          <InstallProgress progress={progress} />
        ) : error ? (
          <InstallError message={error} onRetry={() => installNetworkPackage()} />
        ) : (
          <>
            <Button
              variant="primary"
              size="lg"
              onClick={() => installNetworkPackage()}
              className="w-full"
            >
              <Download size={14} />
              Install Network Package
            </Button>
            <p className="text-2xs font-sans text-text-3 mt-3">
              This will download and set up the Groove Network runtime (~500 MB)
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function UpdateProgress({ progress }) {
  const percent = Math.max(0, Math.min(100, Number.isFinite(progress.percent) ? progress.percent : 0));
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-border-subtle bg-surface-0">
      <Loader2 size={11} className="animate-spin text-accent flex-shrink-0" />
      <div className="flex flex-col min-w-0">
        <span className="text-2xs font-sans text-text-1 truncate">{progress.message || 'Updating\u2026'}</span>
        <div className="h-1 w-32 rounded-full bg-surface-3 overflow-hidden mt-0.5">
          <div
            className="h-full rounded-full bg-accent transition-all duration-500 ease-out"
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>
      <span className="text-2xs font-mono text-text-3 tabular-nums">{percent}%</span>
    </div>
  );
}

function UpdateButton() {
  const [open, setOpen] = useState(false);
  const version = useGrooveStore((s) => s.networkVersion);
  const progress = useGrooveStore((s) => s.networkUpdateProgress);
  const updateNetworkPackage = useGrooveStore((s) => s.updateNetworkPackage);

  if (progress.updating) {
    return <UpdateProgress progress={progress} />;
  }

  if (!version.updateAvailable) return null;

  const confirm = async () => {
    try {
      await updateNetworkPackage();
      setOpen(false);
    } catch { /* toast handled */ }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1"
          title={`Update to ${version.latest}`}
        >
          <Badge variant="warning" className="cursor-pointer">
            <ArrowUpCircle size={10} />
            Update Available
          </Badge>
        </button>
      </DialogTrigger>
      <DialogContent title="Update Network Package" description="Confirm update">
        <div className="px-5 py-4 flex flex-col gap-3">
          <p className="text-sm text-text-1 font-sans leading-relaxed">
            Update to <span className="font-mono text-accent">{version.latest}</span>?
          </p>
          <p className="text-xs text-text-3 font-sans leading-relaxed">
            You are currently running <span className="font-mono">{version.installed || 'unknown'}</span>. Your node will be stopped during the update and restarted after.
          </p>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border-subtle bg-surface-0">
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="primary" size="sm" onClick={confirm}>
            <ArrowUpCircle size={12} />
            Update
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function UninstallButton() {
  const [open, setOpen] = useState(false);
  const uninstallNetworkPackage = useGrooveStore((s) => s.uninstallNetworkPackage);
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    setBusy(true);
    try {
      await uninstallNetworkPackage();
      setOpen(false);
    } catch { /* toast already shown */ }
    finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 text-2xs font-sans text-text-3 hover:text-danger transition-colors"
        >
          <Trash2 size={11} />
          Uninstall
        </button>
      </DialogTrigger>
      <DialogContent title="Uninstall Network Package" description="Confirm uninstall">
        <div className="px-5 py-4 flex flex-col gap-3">
          <p className="text-sm text-text-1 font-sans leading-relaxed">
            This will stop your node and remove the network package from <span className="font-mono text-text-2">~/.groove/network</span>.
          </p>
          <p className="text-xs text-text-3 font-sans leading-relaxed">
            Your identity (<span className="font-mono">~/.groove/node_key.json</span>) will be preserved — you can reinstall later without losing your wallet.
          </p>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border-subtle bg-surface-0">
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
          <Button variant="danger" size="sm" onClick={confirm} disabled={busy}>
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
            Uninstall
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function InlineToggle({ value, onChange, disabled }) {
  return (
    <button
      onClick={() => !disabled && onChange(!value)}
      disabled={disabled}
      className={cn(
        'relative inline-flex h-5 w-9 rounded-full p-0.5 transition-colors flex-shrink-0',
        disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
        value ? 'bg-accent' : 'bg-surface-5',
      )}
    >
      <span
        className={cn(
          'inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform',
          value ? 'translate-x-4' : 'translate-x-0',
        )}
      />
    </button>
  );
}

function NetworkHeader() {
  const node = useGrooveStore((s) => s.networkNode);
  const installed = useGrooveStore((s) => s.networkInstalled);
  const version = useGrooveStore((s) => s.networkVersion);
  const signalReachable = useGrooveStore((s) => s.networkStatusReachable);
  const startNetworkNode = useGrooveStore((s) => s.startNetworkNode);
  const stopNetworkNode = useGrooveStore((s) => s.stopNetworkNode);
  const [pending, setPending] = useState(false);

  async function handleToggle(next) {
    setPending(true);
    try {
      if (next) await startNetworkNode();
      else await stopNetworkNode();
    } catch { /* toasted in store */ }
    setPending(false);
  }

  return (
    <div className="flex items-center gap-4 px-4 py-2 bg-surface-1 border-b border-border flex-shrink-0">
      <h2 className="text-xs font-semibold text-text-0 font-sans tracking-wide uppercase">Network Command Center</h2>

      {installed && version.installed && (
        <>
          <span className="text-text-4">/</span>
          <span className="text-xs font-mono text-text-2 tabular-nums">v{String(version.installed).replace(/^v/, '')}</span>
        </>
      )}

      {installed && <UpdateButton />}

      <div className="flex-1" />

      {installed && (
        <div className="flex items-center gap-3.5 text-xs font-mono text-text-2">
          <span className="flex items-center gap-1.5">
            <InlineToggle value={!!node.active} onChange={handleToggle} disabled={pending} />
            <span className="text-text-3">{node.active ? 'Contributing' : 'Idle'}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="relative flex-shrink-0 w-[5px] h-[5px]">
              <span className="absolute inset-0 rounded-sm" style={{ background: signalReachable ? HEX.accent : HEX.danger }} />
            </span>
            <span className="text-text-3">Signal</span>
          </span>
        </div>
      )}

      {installed && <UninstallButton />}

      <StatusDot status={installed && node.active ? 'running' : installed ? 'stopped' : 'crashed'} size="sm" />
    </div>
  );
}

export default function NetworkView() {
  const fetchNetworkNodeStatus = useGrooveStore((s) => s.fetchNetworkNodeStatus);
  const fetchNetworkStatus = useGrooveStore((s) => s.fetchNetworkStatus);
  const checkNetworkUpdate = useGrooveStore((s) => s.checkNetworkUpdate);
  const installed = useGrooveStore((s) => s.networkInstalled);
  const nodeActive = useGrooveStore((s) => s.networkNode.active);

  useEffect(() => {
    fetchNetworkNodeStatus();
    if (installed) {
      fetchNetworkStatus();
      checkNetworkUpdate();
      const interval = setInterval(() => { fetchNetworkStatus(); }, 10000);
      return () => clearInterval(interval);
    }
  }, [fetchNetworkNodeStatus, fetchNetworkStatus, checkNetworkUpdate, installed]);

  if (!installed) {
    return (
      <div className="flex flex-col h-full">
        <NetworkHeader />
        <ScrollArea className="flex-1">
          <InstallGate />
        </ScrollArea>
      </div>
    );
  }

  if (!nodeActive) {
    return (
      <div className="flex flex-col h-full">
        <NetworkHeader />
        <ScrollArea className="flex-1">
          <div className="flex items-center justify-center min-h-full px-6 py-12">
            <div className="w-full max-w-md">
              <NodeToggle />
            </div>
          </div>
        </ScrollArea>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <NetworkHeader />

      <ComputeHeader />

      <div className="flex-1 min-h-0 flex flex-col" style={{ background: '#282c34', gap: '1px' }}>
        <div className="min-h-0 flex-1 grid" style={{ gridTemplateColumns: '3fr 1.5fr', gap: '0 1px' }}>
          <div className="min-w-0 min-h-0 overflow-hidden bg-surface-1">
            <FleetTable />
          </div>
          <div className="min-w-0 min-h-0 overflow-hidden bg-surface-1">
            <NetworkHealth />
          </div>
        </div>

        <div className="min-h-0 flex-[0.6] bg-surface-1">
          <ActivityStream />
        </div>
      </div>
    </div>
  );
}
