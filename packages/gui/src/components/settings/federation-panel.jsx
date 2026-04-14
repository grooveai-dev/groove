// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useEffect } from 'react';
import { useGrooveStore } from '../../stores/groove';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { StatusDot } from '../ui/status-dot';
import { ScrollArea } from '../ui/scroll-area';
import { cn } from '../../lib/cn';
import { timeAgo } from '../../lib/format';
import {
  Globe, Shield, Server, MessageSquare, Plus, Trash2, Loader2,
  ArrowUpRight, ArrowDownLeft, Users,
} from 'lucide-react';

function statusBadge(status) {
  switch (status) {
    case 'mutual': return <Badge variant="success" className="text-2xs gap-1"><StatusDot status="running" size="sm" /> Mutual</Badge>;
    case 'connected': return <Badge variant="info" className="text-2xs">Connected</Badge>;
    default: return <Badge variant="default" className="text-2xs">Waiting</Badge>;
  }
}

export function FederationPanel() {
  const federation = useGrooveStore((s) => s.federation);
  const fetchFederationStatus = useGrooveStore((s) => s.fetchFederationStatus);
  const addToWhitelist = useGrooveStore((s) => s.addToWhitelist);
  const removeFromWhitelist = useGrooveStore((s) => s.removeFromWhitelist);
  const fetchPouchLog = useGrooveStore((s) => s.fetchPouchLog);

  const [ip, setIp] = useState('');
  const [port, setPort] = useState('31415');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    fetchFederationStatus();
    fetchPouchLog();
  }, []);

  async function handleAdd(e) {
    e.preventDefault();
    if (!ip.trim()) return;
    setAdding(true);
    try {
      await addToWhitelist(ip.trim(), parseInt(port, 10) || 31415);
      setIp('');
      setPort('31415');
    } catch {}
    setAdding(false);
  }

  return (
    <div className="space-y-5">

      {/* ── Whitelist ── */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Shield size={12} className="text-accent" />
          <span className="text-xs font-semibold text-text-1 font-sans">Whitelist</span>
          {federation.whitelist.length > 0 && (
            <Badge variant="default" className="text-2xs ml-auto">{federation.whitelist.length}</Badge>
          )}
        </div>

        <form onSubmit={handleAdd} className="flex items-center gap-2 mb-2.5">
          <input
            type="text"
            placeholder="IP address"
            value={ip}
            onChange={(e) => setIp(e.target.value)}
            className="flex-1 h-7 px-2.5 text-xs font-mono bg-surface-1 border border-border-subtle rounded-md text-text-0 placeholder:text-text-4 focus:outline-none focus:border-accent"
          />
          <input
            type="text"
            placeholder="Port"
            value={port}
            onChange={(e) => setPort(e.target.value)}
            className="w-20 h-7 px-2.5 text-xs font-mono bg-surface-1 border border-border-subtle rounded-md text-text-0 placeholder:text-text-4 focus:outline-none focus:border-accent"
          />
          <Button type="submit" variant="primary" size="sm" disabled={adding || !ip.trim()} className="h-7 text-2xs gap-1">
            {adding ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
            Add
          </Button>
        </form>

        {federation.whitelist.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border-subtle bg-surface-1/50 px-4 py-4 text-center">
            <Globe size={18} className="text-text-4 mx-auto mb-1.5" />
            <p className="text-2xs text-text-4 font-sans">No peers whitelisted yet. Add a remote daemon IP to begin federation.</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {federation.whitelist.map((entry) => {
              const key = typeof entry === 'string' ? entry : entry.ip;
              const status = typeof entry === 'object' ? entry.status : 'waiting';
              return (
                <div key={key} className="flex items-center gap-2 rounded-md border border-border-subtle bg-surface-1 px-3 py-2">
                  <span className="text-xs font-mono text-text-1 flex-1 truncate">{key}{typeof entry === 'object' && entry.port ? `:${entry.port}` : ''}</span>
                  {statusBadge(status)}
                  <button
                    onClick={() => removeFromWhitelist(key)}
                    className="p-1 text-text-4 hover:text-danger cursor-pointer transition-colors"
                    title="Remove"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Connections ── */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Server size={12} className="text-accent" />
          <span className="text-xs font-semibold text-text-1 font-sans">Connections</span>
          {federation.connections.length > 0 && (
            <Badge variant="success" className="text-2xs ml-auto">{federation.connections.length}</Badge>
          )}
        </div>

        {federation.connections.length === 0 ? (
          <div className="text-2xs text-text-4 font-sans px-1">No active connections.</div>
        ) : (
          <div className="space-y-1.5">
            {federation.connections.map((conn) => (
              <div key={conn.ip || conn.peerId} className="flex items-center gap-2 rounded-md border border-border-subtle bg-surface-1 px-3 py-2">
                <StatusDot status={conn.state === 'established' ? 'running' : 'stopped'} size="sm" />
                <span className="text-xs font-mono text-text-1 flex-1 truncate">{conn.peerId || conn.ip}</span>
                <Badge variant={conn.state === 'established' ? 'success' : 'default'} className="text-2xs">
                  {conn.state || 'unknown'}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Ambassadors ── */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Users size={12} className="text-accent" />
          <span className="text-xs font-semibold text-text-1 font-sans">Ambassadors</span>
          {federation.ambassadors.length > 0 && (
            <Badge variant="info" className="text-2xs ml-auto">{federation.ambassadors.length}</Badge>
          )}
        </div>

        {federation.ambassadors.length === 0 ? (
          <div className="text-2xs text-text-4 font-sans px-1">No active ambassadors.</div>
        ) : (
          <div className="space-y-1.5">
            {federation.ambassadors.map((amb) => (
              <div key={amb.id || amb.agentId} className="flex items-center gap-2 rounded-md border border-border-subtle bg-surface-1 px-3 py-2">
                <StatusDot status={amb.status === 'active' ? 'running' : 'stopped'} size="sm" />
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-sans text-text-1 truncate block">{amb.name || amb.agentId || amb.id}</span>
                  {amb.peerId && <span className="text-2xs text-text-4 font-mono truncate block">{amb.peerId}</span>}
                </div>
                <Badge variant={amb.status === 'active' ? 'success' : 'default'} className="text-2xs">
                  {amb.status || 'idle'}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Pouch Log ── */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <MessageSquare size={12} className="text-accent" />
          <span className="text-xs font-semibold text-text-1 font-sans">Pouch Log</span>
          {federation.pouchLog.length > 0 && (
            <Badge variant="default" className="text-2xs ml-auto">{federation.pouchLog.length}</Badge>
          )}
        </div>

        {federation.pouchLog.length === 0 ? (
          <div className="text-2xs text-text-4 font-sans px-1">No diplomatic pouches exchanged yet.</div>
        ) : (
          <ScrollArea className="max-h-52">
            <div className="space-y-1">
              {[...federation.pouchLog].reverse().map((entry, i) => (
                <div key={entry.id || i} className="flex items-center gap-2 rounded px-2.5 py-1.5 bg-surface-1 text-2xs font-sans">
                  {entry.direction === 'sent' ? (
                    <ArrowUpRight size={10} className="text-accent flex-shrink-0" />
                  ) : (
                    <ArrowDownLeft size={10} className="text-success flex-shrink-0" />
                  )}
                  <span className="text-text-3 flex-shrink-0">{timeAgo(entry.timestamp || entry.ts)}</span>
                  <span className="text-text-1 truncate flex-1">{entry.contractType || entry.type || 'message'}</span>
                  <span className="text-text-4 font-mono truncate max-w-24">{entry.peerId || ''}</span>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </div>
    </div>
  );
}
