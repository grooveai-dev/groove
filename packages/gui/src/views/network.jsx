// FSL-1.1-Apache-2.0 — see LICENSE
import { useEffect } from 'react';
import { useGrooveStore } from '../stores/groove';
import { ScrollArea } from '../components/ui/scroll-area';
import { StatusDot } from '../components/ui/status-dot';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { NodeToggle } from '../components/network/node-toggle';
import { NodeDetails } from '../components/network/node-details';
import { NetworkStatus } from '../components/network/network-status';
import { Globe, Download, Check } from 'lucide-react';

const REQUIREMENTS = [
  'Python 3.10 or higher',
  '~2 GB disk space for model shards',
  '8 GB+ RAM recommended',
];

function InstallGate() {
  const installNetworkPackage = useGrooveStore((s) => s.installNetworkPackage);
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
      </div>
    </div>
  );
}

export default function NetworkView() {
  const fetchNetworkNodeStatus = useGrooveStore((s) => s.fetchNetworkNodeStatus);
  const fetchNetworkStatus = useGrooveStore((s) => s.fetchNetworkStatus);
  const node = useGrooveStore((s) => s.networkNode);
  const installed = useGrooveStore((s) => s.networkInstalled);

  useEffect(() => {
    fetchNetworkNodeStatus();
    if (installed) {
      fetchNetworkStatus();
      const interval = setInterval(() => { fetchNetworkStatus(); }, 10000);
      return () => clearInterval(interval);
    }
  }, [fetchNetworkNodeStatus, fetchNetworkStatus, installed]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2.5 bg-surface-1 border-b border-border flex-shrink-0">
        <Globe size={14} className="text-accent" />
        <h2 className="text-sm font-semibold text-text-0 font-sans">Groove Network</h2>
        <Badge variant="purple">Early Access</Badge>
        <div className="flex-1" />
        {installed && (
          <div className="flex items-center gap-1.5 text-2xs font-sans text-text-3">
            <StatusDot status={node.active ? 'running' : 'crashed'} size="sm" />
            {node.active ? 'Contributing' : 'Idle'}
          </div>
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
