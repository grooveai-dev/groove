// FSL-1.1-Apache-2.0 — see LICENSE
import { useEffect } from 'react';
import { useGrooveStore } from '../stores/groove';
import { ScrollArea } from '../components/ui/scroll-area';
import { StatusDot } from '../components/ui/status-dot';
import { Badge } from '../components/ui/badge';
import { NodeToggle } from '../components/network/node-toggle';
import { NodeDetails } from '../components/network/node-details';
import { NetworkStatus } from '../components/network/network-status';
import { Globe } from 'lucide-react';

export default function NetworkView() {
  const fetchNetworkNodeStatus = useGrooveStore((s) => s.fetchNetworkNodeStatus);
  const fetchNetworkStatus = useGrooveStore((s) => s.fetchNetworkStatus);
  const node = useGrooveStore((s) => s.networkNode);

  useEffect(() => {
    fetchNetworkNodeStatus();
    fetchNetworkStatus();
    const interval = setInterval(() => { fetchNetworkStatus(); }, 10000);
    return () => clearInterval(interval);
  }, [fetchNetworkNodeStatus, fetchNetworkStatus]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2.5 bg-surface-1 border-b border-border flex-shrink-0">
        <Globe size={14} className="text-accent" />
        <h2 className="text-sm font-semibold text-text-0 font-sans">Groove Network</h2>
        <Badge variant="purple">Early Access</Badge>
        <div className="flex-1" />
        <div className="flex items-center gap-1.5 text-2xs font-sans text-text-3">
          <StatusDot status={node.active ? 'running' : 'crashed'} size="sm" />
          {node.active ? 'Contributing' : 'Idle'}
        </div>
      </div>

      {/* Body */}
      <ScrollArea className="flex-1">
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
      </ScrollArea>
    </div>
  );
}
