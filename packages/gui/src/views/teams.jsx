// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useEffect } from 'react';
import { useGrooveStore } from '../stores/groove';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { ScrollArea } from '../components/ui/scroll-area';
import { Skeleton } from '../components/ui/skeleton';
import { api } from '../lib/api';
import { useToast } from '../lib/hooks/use-toast';
import { timeAgo } from '../lib/format';
import { Clock, CheckCircle, XCircle, AlertTriangle, ShieldCheck, ShieldX } from 'lucide-react';

// ── Pending Approvals ──────────────────────────────────────
function PendingApprovals() {
  const pending = useGrooveStore((s) => s.pendingApprovals);
  const approveRequest = useGrooveStore((s) => s.approveRequest);
  const rejectRequest = useGrooveStore((s) => s.rejectRequest);

  if (pending.length === 0) return null;

  return (
    <div className="px-4 pt-4 space-y-2">
      <div className="flex items-center gap-2 mb-1">
        <AlertTriangle size={13} className="text-warning" />
        <span className="text-xs font-semibold text-warning font-sans">Pending Approval ({pending.length})</span>
      </div>
      {pending.map((item) => (
        <div key={item.id} className="flex items-center gap-3 px-3 py-2.5 rounded-md bg-warning/5 border border-warning/20">
          <div className="flex-1 min-w-0">
            <div className="text-xs text-text-0 font-sans font-medium truncate">
              {item.agentName}: {item.action?.description || item.action?.type || 'action'}
            </div>
            {item.action?.filePath && <div className="text-2xs text-text-3 font-mono truncate mt-0.5">{item.action.filePath}</div>}
            <div className="text-2xs text-text-4 font-sans mt-0.5">{timeAgo(item.requestedAt)}</div>
          </div>
          <div className="flex gap-1.5 flex-shrink-0">
            <Button variant="primary" size="sm" onClick={() => approveRequest(item.id)} className="h-7 px-2.5 gap-1 text-2xs">
              <ShieldCheck size={11} /> Approve
            </Button>
            <Button variant="danger" size="sm" onClick={() => rejectRequest(item.id)} className="h-7 px-2.5 gap-1 text-2xs">
              <ShieldX size={11} /> Reject
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Resolved Approvals / History ───────────────────────────
function ApprovalsTab() {
  const resolved = useGrooveStore((s) => s.resolvedApprovals);
  const [pmHistory, setPmHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const interval = setInterval(fetchHistory, 4000);
    fetchHistory();
    return () => clearInterval(interval);
  }, []);

  async function fetchHistory() {
    try {
      const data = await api.get('/pm/history');
      setPmHistory(data.history || data || []);
    } catch { /* ignore */ }
    setLoading(false);
  }

  // Merge PM history with real-time resolved approvals, dedup by id
  const seen = new Set();
  const allHistory = [...resolved, ...pmHistory].filter((item) => {
    const key = item.id || `${item.agentName}-${item.timestamp}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (loading && allHistory.length === 0) {
    return <div className="p-4 space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-12 rounded-md" />)}</div>;
  }

  return (
    <ScrollArea className="flex-1">
      <PendingApprovals />
      <div className="p-4 space-y-2">
        {allHistory.length === 0 && (
          <div className="text-center py-12 text-text-4 font-sans">
            <CheckCircle size={32} className="mx-auto mb-2" />
            <p className="text-sm">No approval history</p>
            <p className="text-2xs text-text-4 mt-1">Approvals appear when agents use "Agent Approve" permission mode</p>
          </div>
        )}
        {allHistory.map((item, i) => (
          <div key={item.id || i} className="flex items-center gap-3 px-3 py-2 rounded-md bg-surface-1 border border-border-subtle">
            {(item.status === 'approved' || item.verdict === 'approved') ? (
              <CheckCircle size={14} className="text-success flex-shrink-0" />
            ) : (
              <XCircle size={14} className="text-danger flex-shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <div className="text-xs text-text-0 font-sans truncate">
                {item.agentName}: {item.action?.description || item.action || 'action'}
              </div>
              {item.reason && <div className="text-2xs text-text-3 font-sans truncate">{item.reason}</div>}
            </div>
            <span className="text-2xs text-text-4 font-sans flex-shrink-0">
              {timeAgo(item.resolvedAt || item.timestamp)}
            </span>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}

// ── Schedules Tab ──────────────────────────────────────────
function SchedulesTab() {
  const [schedules, setSchedules] = useState([]);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  useEffect(() => {
    const interval = setInterval(fetchSchedules, 10000);
    fetchSchedules();
    return () => clearInterval(interval);
  }, []);

  async function fetchSchedules() {
    try {
      const data = await api.get('/schedules');
      setSchedules(data.schedules || data || []);
    } catch { /* ignore */ }
    setLoading(false);
  }

  async function toggleSchedule(id, enabled) {
    try {
      await api.post(`/schedules/${id}/${enabled ? 'disable' : 'enable'}`);
      fetchSchedules();
    } catch (err) {
      toast.error('Failed to toggle schedule', err.message);
    }
  }

  if (loading) {
    return <div className="p-4 space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-16 rounded-md" />)}</div>;
  }

  return (
    <ScrollArea className="flex-1">
      <div className="p-4 space-y-2">
        {schedules.length === 0 && (
          <div className="text-center py-12 text-text-4 font-sans">
            <Clock size={32} className="mx-auto mb-2" />
            <p className="text-sm">No schedules configured</p>
          </div>
        )}
        {schedules.map((s) => (
          <Card key={s.id} className="p-3">
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-text-0 font-sans">{s.name}</span>
                  <Badge variant={s.enabled ? 'success' : 'default'}>{s.enabled ? 'Active' : 'Paused'}</Badge>
                </div>
                <div className="text-2xs text-text-3 font-mono mt-0.5">{s.cron} · {s.role}</div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => toggleSchedule(s.id, s.enabled)}
              >
                {s.enabled ? 'Pause' : 'Enable'}
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </ScrollArea>
  );
}

// ── Main View ────────────────────────────────��─────────────
export default function TeamsView() {
  return (
    <Tabs defaultValue="approvals" className="flex flex-col h-full">
      <div className="px-4 pt-3 bg-surface-1 border-b border-border">
        <div className="flex items-center gap-4 mb-0">
          <h2 className="text-base font-semibold text-text-0 font-sans">Management</h2>
        </div>
        <TabsList className="border-b-0">
          <TabsTrigger value="approvals">Approvals</TabsTrigger>
          <TabsTrigger value="schedules">Schedules</TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="approvals" className="flex-1 min-h-0">
        <ApprovalsTab />
      </TabsContent>
      <TabsContent value="schedules" className="flex-1 min-h-0">
        <SchedulesTab />
      </TabsContent>
    </Tabs>
  );
}
