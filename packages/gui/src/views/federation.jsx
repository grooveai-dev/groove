// FSL-1.1-Apache-2.0 — see LICENSE
import { useEffect } from 'react';
import { useGrooveStore } from '../stores/groove';
import { FederationPanel } from '../components/settings/federation-panel';
import { ProGate } from '../components/pro/pro-gate';
import { ScrollArea } from '../components/ui/scroll-area';
import { Globe } from 'lucide-react';

export default function FederationView() {
  const fetchFederationStatus = useGrooveStore((s) => s.fetchFederationStatus);

  useEffect(() => {
    fetchFederationStatus();
  }, []);

  return (
    <div className="flex flex-col h-full bg-surface-0">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border">
        <div className="w-8 h-8 rounded-md bg-accent/10 flex items-center justify-center">
          <Globe size={16} className="text-accent" />
        </div>
        <div>
          <h1 className="text-sm font-semibold text-text-0 font-sans">Federation</h1>
          <p className="text-2xs text-text-3 font-sans">Connect to remote Groove daemons</p>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="max-w-2xl mx-auto px-6 py-5">
          <ProGate feature="Federation" featureKey="federation" description="Daemon-to-daemon federation over Tailscale mesh for multi-machine agent coordination">
            <FederationPanel />
          </ProGate>
        </div>
      </ScrollArea>
    </div>
  );
}
