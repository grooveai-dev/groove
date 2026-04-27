// FSL-1.1-Apache-2.0 — see LICENSE
import { useState } from 'react';
import { useGrooveStore } from '../../stores/groove';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { StatusDot } from '../ui/status-dot';
import { cn } from '../../lib/cn';
import {
  Server, Link2, Send, Unplug, Eye, Plus, Wifi,
} from 'lucide-react';

function connectionBadge(state) {
  switch (state) {
    case 'established': return <Badge variant="success" className="text-2xs gap-1"><StatusDot status="running" size="sm" /> Connected</Badge>;
    case 'connecting': return <Badge variant="warning" className="text-2xs" dot="pulse">Connecting</Badge>;
    case 'error': return <Badge variant="danger" className="text-2xs">Error</Badge>;
    default: return <Badge variant="default" className="text-2xs">Unknown</Badge>;
  }
}

export function FederationPeers({ onOpenWizard }) {
  const connections = useGrooveStore((s) => s.federation.connections);
  const peers = useGrooveStore((s) => s.federation.peers);
  const sendPouch = useGrooveStore((s) => s.sendPouch);
  const disconnectPeer = useGrooveStore((s) => s.disconnectPeer);
  const addToast = useGrooveStore((s) => s.addToast);
  const [sendingTo, setSendingTo] = useState(null);

  const allPeers = peers.length > 0 ? peers : connections;

  async function handleSendPouch(peerId) {
    setSendingTo(peerId);
    try {
      await sendPouch(peerId, { type: 'ping' });
    } catch {}
    setSendingTo(null);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Server size={12} className="text-accent" />
          <span className="text-xs font-semibold text-text-1 font-sans">Connected Peers</span>
          {allPeers.length > 0 && (
            <Badge variant="success" className="text-2xs">{allPeers.length}</Badge>
          )}
        </div>
        <Button size="sm" variant="primary" onClick={onOpenWizard} className="h-7 text-2xs gap-1.5">
          <Plus size={11} />
          Pair New Peer
        </Button>
      </div>

      {allPeers.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border-subtle bg-surface-1/50 px-4 py-8 text-center">
          <Link2 size={20} className="text-text-4 mx-auto mb-2" />
          <p className="text-xs text-text-3 font-sans mb-1">No peers connected</p>
          <p className="text-2xs text-text-4 font-sans mb-3">Pair with a remote Groove daemon to share agents and coordinate work.</p>
          <Button size="sm" variant="outline" onClick={onOpenWizard} className="h-7 text-2xs gap-1.5">
            <Plus size={11} />
            Pair Your First Peer
          </Button>
        </div>
      ) : (
        <div className="grid gap-2">
          {allPeers.map((peer) => {
            const id = peer.peerId || peer.ip || peer.id;
            const name = peer.name || peer.peerId || 'Unknown Peer';
            const state = peer.state || peer.status || 'unknown';
            const ip = peer.ip || peer.address || '';
            const latency = peer.latency;

            return (
              <div key={id} className="rounded-md border border-border-subtle bg-surface-1 p-3">
                <div className="flex items-start gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-md bg-accent/10 flex-shrink-0 mt-0.5">
                    <Server size={14} className="text-accent" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs font-semibold text-text-0 font-sans truncate">{name}</span>
                      {connectionBadge(state)}
                    </div>
                    <div className="flex items-center gap-3 text-2xs text-text-3">
                      {ip && (
                        <span className="font-mono truncate">{ip}{peer.port ? `:${peer.port}` : ''}</span>
                      )}
                      {latency != null && (
                        <span className="flex items-center gap-1 font-sans">
                          <Wifi size={9} className={cn(
                            latency < 100 ? 'text-success' : latency < 300 ? 'text-warning' : 'text-danger'
                          )} />
                          {latency}ms
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 mt-3 pt-2.5 border-t border-border-subtle">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 text-2xs gap-1 text-text-2"
                    onClick={() => addToast('info', name, `ID: ${id}\nIP: ${ip}${peer.port ? `:${peer.port}` : ''}\nLatency: ${latency != null ? `${latency}ms` : 'N/A'}\nState: ${state}`)}
                  >
                    <Eye size={10} />
                    Details
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 text-2xs gap-1 text-text-2"
                    disabled={sendingTo === id}
                    onClick={() => handleSendPouch(id)}
                  >
                    <Send size={10} />
                    Send Pouch
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 text-2xs gap-1 text-danger/70 hover:text-danger ml-auto"
                    onClick={() => disconnectPeer(id)}
                  >
                    <Unplug size={10} />
                    Disconnect
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
