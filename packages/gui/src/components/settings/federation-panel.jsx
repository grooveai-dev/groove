// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useEffect, useMemo } from 'react';
import { useGrooveStore } from '../../stores/groove';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Input } from '../ui/input';
import { StatusDot } from '../ui/status-dot';
import { cn } from '../../lib/cn';
import { FederationPeers } from './federation-peers';
import { FederationActivity } from './federation-activity';
import { FederationWizard } from './federation-wizard';
import {
  Shield, Plus, Trash2, Loader2, Globe, Users, Search, ChevronUp,
} from 'lucide-react';

function statusBadge(status) {
  switch (status) {
    case 'mutual': return <Badge variant="success" className="text-2xs gap-1"><StatusDot status="running" size="sm" /> Mutual</Badge>;
    case 'connected': return <Badge variant="info" className="text-2xs">Connected</Badge>;
    default: return <Badge variant="default" className="text-2xs">Waiting</Badge>;
  }
}

export function WhitelistTab() {
  const whitelist = useGrooveStore((s) => s.federation.whitelist);
  const addToWhitelist = useGrooveStore((s) => s.addToWhitelist);
  const removeFromWhitelist = useGrooveStore((s) => s.removeFromWhitelist);

  const [showForm, setShowForm] = useState(false);
  const [ip, setIp] = useState('');
  const [port, setPort] = useState('31415');
  const [serverName, setServerName] = useState('');
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState('');

  async function handleAdd(e) {
    e.preventDefault();
    if (!ip.trim()) return;
    setAdding(true);
    try {
      await addToWhitelist(ip.trim(), parseInt(port, 10) || 31415, serverName.trim() || undefined);
      setIp('');
      setPort('31415');
      setServerName('');
      setShowForm(false);
    } catch {}
    setAdding(false);
  }

  const filtered = useMemo(() => {
    if (!search.trim()) return whitelist;
    const q = search.toLowerCase();
    return whitelist.filter((entry) => {
      const key = typeof entry === 'string' ? entry : entry.ip;
      const name = typeof entry === 'object' ? entry.name : '';
      return key?.toLowerCase().includes(q) || name?.toLowerCase().includes(q);
    });
  }, [whitelist, search]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield size={12} className="text-accent" />
          <span className="text-xs font-semibold text-text-1 font-sans">Whitelist</span>
          {whitelist.length > 0 && (
            <Badge variant="default" className="text-2xs">{whitelist.length}</Badge>
          )}
        </div>
        <Button
          size="sm"
          variant={showForm ? 'ghost' : 'primary'}
          onClick={() => setShowForm(!showForm)}
          className="h-7 text-2xs gap-1.5"
        >
          {showForm ? (
            <><ChevronUp size={11} /> Hide</>
          ) : (
            <><Plus size={11} /> Add Server</>
          )}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {/* Add form card */}
        {showForm && (
          <form onSubmit={handleAdd} className="rounded-lg border border-border-subtle bg-surface-1 px-4 py-3.5">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-6 h-6 rounded bg-accent/8 flex items-center justify-center flex-shrink-0">
                <Plus size={12} className="text-accent" />
              </div>
              <span className="text-[13px] font-medium text-text-0 font-sans">New Server</span>
            </div>
            <div className="space-y-2.5">
              <div>
                <label className="text-2xs font-semibold text-text-2 font-sans mb-1 block">Name</label>
                <Input
                  placeholder="Server name"
                  value={serverName}
                  onChange={(e) => setServerName(e.target.value)}
                  className="h-7 text-xs"
                />
              </div>
              <div>
                <label className="text-2xs font-semibold text-text-2 font-sans mb-1 block">IP Address</label>
                <Input
                  placeholder="100.64.0.2"
                  value={ip}
                  onChange={(e) => setIp(e.target.value)}
                  mono
                  className="h-7 text-xs"
                />
              </div>
              <div>
                <label className="text-2xs font-semibold text-text-2 font-sans mb-1 block">Port</label>
                <Input
                  placeholder="31415"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  mono
                  className="h-7 text-xs w-28"
                />
              </div>
              <div className="pt-1">
                <Button type="submit" variant="primary" size="sm" disabled={adding || !ip.trim()} className="h-7 text-2xs gap-1">
                  {adding ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
                  Add to Whitelist
                </Button>
              </div>
            </div>
          </form>
        )}

        {/* Server list card */}
        <div className={cn(
          'rounded-lg border border-border-subtle bg-surface-1 px-4 py-3.5',
          !showForm && 'col-span-2',
        )}>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-6 h-6 rounded bg-accent/8 flex items-center justify-center flex-shrink-0">
              <Globe size={12} className="text-accent" />
            </div>
            <span className="text-[13px] font-medium text-text-0 font-sans">Servers</span>
            {whitelist.length >= 5 && (
              <div className="relative ml-auto">
                <Search size={10} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-4" />
                <input
                  type="text"
                  placeholder="Filter…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-6 pl-6 pr-2 w-32 text-2xs font-sans bg-surface-0 border border-border-subtle rounded-md text-text-0 placeholder:text-text-4 focus:outline-none focus:border-accent"
                />
              </div>
            )}
          </div>

          {filtered.length === 0 && whitelist.length === 0 ? (
            <div className="px-2 py-4 text-center">
              <Globe size={16} className="text-text-4 mx-auto mb-1.5" />
              <p className="text-2xs text-text-4 font-sans">No peers whitelisted yet.</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-2xs text-text-4 font-sans py-3 text-center">No servers match your filter.</div>
          ) : (
            <div className="space-y-1.5">
              {filtered.map((entry) => {
                const key = typeof entry === 'string' ? entry : entry.ip;
                const entryName = typeof entry === 'object' ? entry.name : null;
                const status = typeof entry === 'object' ? entry.status : 'waiting';
                const entryPort = typeof entry === 'object' ? entry.port : null;

                return (
                  <div key={key} className="flex items-center gap-2.5 px-2.5 py-2 rounded-md bg-surface-0 border border-border-subtle">
                    <div className="flex-1 min-w-0">
                      {entryName && <span className="text-xs font-sans font-medium text-text-0 block truncate">{entryName}</span>}
                      <span className={cn('font-mono truncate block', entryName ? 'text-2xs text-text-3' : 'text-xs text-text-1')}>
                        {key}{entryPort ? `:${entryPort}` : ''}
                      </span>
                    </div>
                    {statusBadge(status)}
                    <button
                      onClick={() => removeFromWhitelist(key)}
                      className="p-1 rounded text-text-4 hover:text-danger hover:bg-danger/10 cursor-pointer transition-colors flex-shrink-0"
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
      </div>
    </div>
  );
}

export function AmbassadorsTab() {
  const ambassadors = useGrooveStore((s) => s.federation.ambassadors);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Users size={12} className="text-accent" />
        <span className="text-xs font-semibold text-text-1 font-sans">Ambassadors</span>
        {ambassadors.length > 0 && (
          <Badge variant="info" className="text-2xs">{ambassadors.length}</Badge>
        )}
      </div>

      {ambassadors.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border-subtle bg-surface-1/50 px-4 py-6 text-center">
          <Users size={18} className="text-text-4 mx-auto mb-1.5" />
          <p className="text-2xs text-text-4 font-sans">No active ambassadors. Ambassadors appear when agents are shared across federated peers.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {ambassadors.map((amb) => (
            <div key={amb.id || amb.agentId} className="rounded-lg border border-border-subtle bg-surface-1 px-3.5 py-3">
              <div className="flex items-center gap-2 mb-1.5">
                <StatusDot status={amb.status === 'active' ? 'running' : 'stopped'} size="sm" />
                <span className="text-xs font-sans font-medium text-text-0 truncate flex-1">
                  {amb.name || amb.agentId || amb.id}
                </span>
                {amb.role && (
                  <Badge variant="purple" className="text-2xs">{amb.role}</Badge>
                )}
              </div>
              <div className="flex items-center justify-between text-2xs">
                {amb.peerId ? (
                  <span className="text-text-3 font-mono truncate max-w-28">{amb.peerId}</span>
                ) : (
                  <span className="text-text-4 font-sans">Local</span>
                )}
                <Badge variant={amb.status === 'active' ? 'success' : 'default'} className="text-2xs">
                  {amb.status || 'idle'}
                </Badge>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function FederationPanel() {
  const fetchFederationStatus = useGrooveStore((s) => s.fetchFederationStatus);
  const fetchPouchLog = useGrooveStore((s) => s.fetchPouchLog);
  const [wizardOpen, setWizardOpen] = useState(false);

  useEffect(() => {
    fetchFederationStatus();
    fetchPouchLog();
  }, []);

  return (
    <div>
      <Tabs defaultValue="whitelist">
        <TabsList className="mb-4">
          <TabsTrigger value="whitelist" className="text-xs px-3 py-1.5">Whitelist</TabsTrigger>
          <TabsTrigger value="peers" className="text-xs px-3 py-1.5">Peers</TabsTrigger>
          <TabsTrigger value="ambassadors" className="text-xs px-3 py-1.5">Ambassadors</TabsTrigger>
          <TabsTrigger value="activity" className="text-xs px-3 py-1.5">Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="whitelist">
          <WhitelistTab />
        </TabsContent>

        <TabsContent value="peers">
          <FederationPeers onOpenWizard={() => setWizardOpen(true)} />
        </TabsContent>

        <TabsContent value="ambassadors">
          <AmbassadorsTab />
        </TabsContent>

        <TabsContent value="activity">
          <FederationActivity />
        </TabsContent>
      </Tabs>

      <FederationWizard open={wizardOpen} onOpenChange={setWizardOpen} />
    </div>
  );
}
