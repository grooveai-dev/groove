// FSL-1.1-Apache-2.0 — see LICENSE
import { useEffect, useState } from 'react';
import { useGrooveStore } from '../stores/groove';
import { ScrollArea } from '../components/ui/scroll-area';
import { StatusDot } from '../components/ui/status-dot';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Dialog, DialogContent, DialogTrigger } from '../components/ui/dialog';
import { NodeToggle } from '../components/network/node-toggle';
import { NodeDetails } from '../components/network/node-details';
import { NetworkStatus } from '../components/network/network-status';
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
          <span className="truncate">{progress.message || 'Installing…'}</span>
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
        <span className="text-2xs font-sans text-text-1 truncate">{progress.message || 'Updating…'}</span>
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
          Uninstall Network Package
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

export default function NetworkView() {
  const fetchNetworkNodeStatus = useGrooveStore((s) => s.fetchNetworkNodeStatus);
  const fetchNetworkStatus = useGrooveStore((s) => s.fetchNetworkStatus);
  const checkNetworkUpdate = useGrooveStore((s) => s.checkNetworkUpdate);
  const node = useGrooveStore((s) => s.networkNode);
  const installed = useGrooveStore((s) => s.networkInstalled);
  const version = useGrooveStore((s) => s.networkVersion);

  useEffect(() => {
    fetchNetworkNodeStatus();
    if (installed) {
      fetchNetworkStatus();
      checkNetworkUpdate();
      const interval = setInterval(() => { fetchNetworkStatus(); }, 10000);
      return () => clearInterval(interval);
    }
  }, [fetchNetworkNodeStatus, fetchNetworkStatus, checkNetworkUpdate, installed]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2.5 bg-surface-1 border-b border-border flex-shrink-0">
        <Globe size={14} className="text-accent" />
        <h2 className="text-sm font-semibold text-text-0 font-sans">Groove Network</h2>
        <Badge variant="purple">Early Access</Badge>
        {installed && version.installed && (
          <span className="text-2xs font-mono text-text-3 tabular-nums">v{String(version.installed).replace(/^v/, '')}</span>
        )}
        {installed && <UpdateButton />}
        <div className="flex-1" />
        {installed && (
          <>
            <UninstallButton />
            <div className="flex items-center gap-1.5 text-2xs font-sans text-text-3">
              <StatusDot status={node.active ? 'running' : 'crashed'} size="sm" />
              {node.active ? 'Contributing' : 'Idle'}
            </div>
          </>
        )}
      </div>

      {/* Body */}
      <ScrollArea className="flex-1">
        {!installed ? (
          <InstallGate />
        ) : (
          <div className="p-4 grid grid-cols-1 xl:grid-cols-2 gap-4">
            {/* Left column — node operator */}
            <div className="flex flex-col gap-3 min-w-0">
              <div>
                <div className="flex items-center gap-2 mb-2 px-0.5">
                  <span className="text-2xs font-semibold text-text-3 font-sans uppercase tracking-wider">Node Operator</span>
                  <div className="flex-1 h-px bg-border-subtle" />
                </div>
                <NodeToggle />
              </div>
              <NodeDetails />
            </div>

            {/* Right column — network status */}
            <div className="flex flex-col gap-3 min-w-0">
              <div className="flex items-center gap-2 px-0.5">
                <span className="text-2xs font-semibold text-text-3 font-sans uppercase tracking-wider">Network Status</span>
                <div className="flex-1 h-px bg-border-subtle" />
              </div>
              <NetworkStatus />
            </div>
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
