// FSL-1.1-Apache-2.0 — see LICENSE
import { useEffect, useState } from 'react';
import { useGrooveStore } from '../stores/groove';
import { FederationPeers } from '../components/settings/federation-peers';
import { FederationActivity } from '../components/settings/federation-activity';
import { FederationWizard } from '../components/settings/federation-wizard';
import { WhitelistTab, AmbassadorsTab } from '../components/settings/federation-panel';
import { Button } from '../components/ui/button';
import { ScrollArea } from '../components/ui/scroll-area';
import { Globe, Plus } from 'lucide-react';

export default function FederationView() {
  const fetchFederationStatus = useGrooveStore((s) => s.fetchFederationStatus);
  const fetchPouchLog = useGrooveStore((s) => s.fetchPouchLog);
  const peers = useGrooveStore((s) => s.federation.peers);
  const connections = useGrooveStore((s) => s.federation.connections);
  const whitelist = useGrooveStore((s) => s.federation.whitelist);
  const [wizardOpen, setWizardOpen] = useState(false);

  const peerCount = (peers.length > 0 ? peers : connections).length;

  useEffect(() => {
    fetchFederationStatus();
    fetchPouchLog();
  }, []);

  return (
    <div className="flex flex-col h-full bg-surface-0">
      {/* Hero strip */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-md bg-accent/10 flex items-center justify-center">
            <Globe size={16} className="text-accent" />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-text-0 font-sans">Federation</h1>
            <p className="text-2xs text-text-3 font-sans">
              {peerCount} peer{peerCount !== 1 ? 's' : ''} &middot; {whitelist.length} whitelisted
            </p>
          </div>
        </div>
        <Button size="sm" variant="primary" onClick={() => setWizardOpen(true)} className="h-8 text-xs gap-1.5">
          <Plus size={12} />
          Add Peer
        </Button>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="p-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Left: Peers + Activity (stacked) */}
            <div className="lg:col-span-2 space-y-4">
              <div className="rounded-lg border border-border-subtle bg-surface-1 p-4">
                <FederationPeers onOpenWizard={() => setWizardOpen(true)} />
              </div>
              <div className="rounded-lg border border-border-subtle bg-surface-1 p-4">
                <FederationActivity />
              </div>
            </div>

            {/* Right: Whitelist + Ambassadors (stacked) */}
            <div className="space-y-4">
              <div className="rounded-lg border border-border-subtle bg-surface-1 p-4">
                <WhitelistTab />
              </div>
              <div className="rounded-lg border border-border-subtle bg-surface-1 p-4">
                <AmbassadorsTab />
              </div>
            </div>
          </div>
        </div>
      </ScrollArea>

      <FederationWizard open={wizardOpen} onOpenChange={setWizardOpen} />
    </div>
  );
}
