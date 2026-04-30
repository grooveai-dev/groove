// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useEffect } from 'react';
import { useGrooveStore } from '../stores/groove';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { StatusDot } from '../components/ui/status-dot';
import { api } from '../lib/api';
import { useToast } from '../lib/hooks/use-toast';
import { fmtNum, fmtDollar, timeAgo, fmtUptime } from '../lib/format';
import { cn } from '../lib/cn';
import { Dialog, DialogContent } from '../components/ui/dialog';
import {
  Clock, CheckCircle, XCircle, AlertTriangle, ShieldCheck, ShieldX,
  Users, Folder, Cpu, Trash2, Play, Pause, LayoutDashboard, ListChecks, Calendar,
  Archive, RotateCcw, ChevronRight, ArrowUpCircle,
} from 'lucide-react';
import { TeamRemovalDialog, PurgeConfirmDialog } from '../components/teams/team-removal-dialog';

// ── Team Dashboard ────────────────────────────────────────────
function TeamsDashboard() {
  const teams = useGrooveStore((s) => s.teams);
  const agents = useGrooveStore((s) => s.agents);
  const activeTeamId = useGrooveStore((s) => s.activeTeamId);
  const archiveTeam = useGrooveStore((s) => s.archiveTeam);
  const deleteTeamPermanently = useGrooveStore((s) => s.deleteTeamPermanently);
  const addToast = useGrooveStore((s) => s.addToast);
  const archivedTeams = useGrooveStore((s) => s.archivedTeams);
  const fetchArchivedTeams = useGrooveStore((s) => s.fetchArchivedTeams);
  const restoreTeam = useGrooveStore((s) => s.restoreTeam);
  const purgeTeam = useGrooveStore((s) => s.purgeTeam);
  const promoteTeam = useGrooveStore((s) => s.promoteTeam);

  const [archiveConfirm, setArchiveConfirm] = useState(null);
  const [purgeConfirm, setPurgeConfirm] = useState(null);
  const [promoteConfirm, setPromoteConfirm] = useState(null);
  const [archivedOpen, setArchivedOpen] = useState(false);

  useEffect(() => { fetchArchivedTeams(); }, []);

  if (teams.length === 0 && archivedTeams.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-2">
          <Users size={28} className="mx-auto text-text-4" />
          <p className="text-xs font-sans text-text-3">No teams yet</p>
          <p className="text-2xs font-sans text-text-4">Teams are created when you spawn agents or launch a planner</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="p-4 space-y-3">
        {teams.map((team) => {
          const teamAgents = agents.filter((a) => a.teamId === team.id);
          const running = teamAgents.filter((a) => a.status === 'running' || a.status === 'starting');
          const completed = teamAgents.filter((a) => a.status === 'completed');
          const crashed = teamAgents.filter((a) => a.status === 'crashed');
          const totalTokens = teamAgents.reduce((s, a) => s + (a.tokensUsed || 0), 0);
          const totalCost = teamAgents.reduce((s, a) => s + (a.costUsd || 0), 0);
          const isActive = team.id === activeTeamId;

          return (
            <div
              key={team.id}
              className={cn(
                'rounded-md border bg-surface-1 overflow-hidden transition-colors',
                isActive ? 'border-accent/30' : 'border-border-subtle',
              )}
            >
              {/* Header */}
              <div className="px-4 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-text-0 font-sans">{team.name}</span>
                    {isActive && <Badge variant="accent" className="text-2xs">Active</Badge>}
                    <Badge variant={team.mode === 'production' ? 'success' : 'default'} className="text-2xs">
                      {team.mode === 'production' ? 'Production' : 'Sandbox'}
                    </Badge>
                  </div>
                  {team.workingDir && (
                    <div className="flex items-center gap-1 mt-0.5">
                      <Folder size={10} className="text-text-4" />
                      <span className="text-2xs font-mono text-text-3 truncate">{team.workingDir}</span>
                    </div>
                  )}
                </div>
                {team.mode !== 'production' && (
                  <button
                    onClick={() => setPromoteConfirm(team)}
                    className="p-1.5 text-text-4 hover:text-success rounded transition-colors cursor-pointer"
                    title="Promote to production"
                  >
                    <ArrowUpCircle size={13} />
                  </button>
                )}
                <button
                  onClick={() => {
                    if (teamAgents.some((a) => a.status === 'running' || a.status === 'starting')) {
                      addToast('error', 'Stop running agents first');
                      return;
                    }
                    setArchiveConfirm(team);
                  }}
                  className="p-1.5 text-text-4 hover:text-danger rounded transition-colors cursor-pointer"
                  title="Archive team"
                >
                  <Trash2 size={13} />
                </button>
              </div>

              {/* Stats row */}
              <div className="px-4 py-2.5 border-t border-border-subtle bg-surface-0 flex items-center gap-4">
                <Stat label="Agents" value={teamAgents.length} />
                <Stat label="Running" value={running.length} color={running.length > 0 ? 'text-success' : undefined} />
                <Stat label="Done" value={completed.length} />
                <Stat label="Crashed" value={crashed.length} color={crashed.length > 0 ? 'text-danger' : undefined} />
                <div className="flex-1" />
                <Stat label="Tokens" value={fmtNum(totalTokens)} />
                {totalCost > 0 && <Stat label="Cost" value={fmtDollar(totalCost)} />}
              </div>

              {/* Agent list */}
              {teamAgents.length > 0 && (
                <div className="border-t border-border-subtle">
                  {teamAgents.map((a) => (
                    <div key={a.id} className="flex items-center gap-2 px-4 py-1.5 border-b border-border-subtle last:border-b-0">
                      <StatusDot status={a.status} size="sm" />
                      <span className="text-xs font-semibold text-text-0 font-sans truncate">{a.name}</span>
                      <span className="text-2xs font-mono text-text-3 uppercase">{a.role}</span>
                      <div className="flex-1" />
                      <span className="text-2xs font-mono text-text-2 tabular-nums">{fmtNum(a.tokensUsed || 0)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Archived Teams */}
      {archivedTeams.length > 0 && (
        <div className="border-t border-border-subtle">
          <button
            onClick={() => setArchivedOpen(!archivedOpen)}
            className="w-full flex items-center gap-2 px-5 py-3 text-left cursor-pointer hover:bg-surface-5/30 transition-colors"
          >
            <ChevronRight
              size={12}
              className={cn('text-text-4 transition-transform duration-200', archivedOpen && 'rotate-90')}
            />
            <Archive size={13} className="text-text-3" />
            <span className="text-xs font-semibold text-text-2 font-sans uppercase tracking-wider flex-1">
              Archived Teams
            </span>
            <span className="text-2xs font-mono text-text-4 bg-surface-4 px-1.5 py-0.5 rounded">
              {archivedTeams.length}
            </span>
          </button>
          {archivedOpen && (
            <div className="px-4 pb-4 space-y-2">
              {archivedTeams.map((at) => (
                <div key={at.id} className="flex items-center gap-3 px-3 py-2.5 rounded-md bg-surface-0 border border-border-subtle">
                  <Archive size={13} className="text-text-4 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-semibold text-text-1 font-sans">{at.originalName || at.name}</span>
                    {(at.deletedAt || at.archivedAt) && (
                      <div className="text-2xs text-text-4 font-mono mt-0.5">Archived {timeAgo(at.deletedAt || at.archivedAt)}</div>
                    )}
                  </div>
                  <button
                    onClick={() => restoreTeam(at.id)}
                    className="p-1.5 text-text-3 hover:text-accent rounded transition-colors cursor-pointer"
                    title="Restore team"
                  >
                    <RotateCcw size={13} />
                  </button>
                  <button
                    onClick={() => setPurgeConfirm(at)}
                    className="p-1.5 text-text-4 hover:text-danger rounded transition-colors cursor-pointer"
                    title="Permanently delete"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <TeamRemovalDialog
        team={archiveConfirm}
        open={!!archiveConfirm}
        onOpenChange={(open) => !open && setArchiveConfirm(null)}
        onArchive={archiveTeam}
        onDeletePermanently={deleteTeamPermanently}
        onPromote={promoteTeam}
        mode={archiveConfirm?.mode || 'sandbox'}
      />

      <PurgeConfirmDialog
        team={purgeConfirm}
        open={!!purgeConfirm}
        onOpenChange={(open) => !open && setPurgeConfirm(null)}
        onPurge={purgeTeam}
      />

      <PromoteConfirmDialog
        team={promoteConfirm}
        open={!!promoteConfirm}
        onOpenChange={(open) => !open && setPromoteConfirm(null)}
        onPromote={promoteTeam}
      />
    </div>
  );
}

function PromoteConfirmDialog({ team, open, onOpenChange, onPromote }) {
  const [promoting, setPromoting] = useState(false);

  useEffect(() => {
    if (!open) setPromoting(false);
  }, [open]);

  async function handleConfirm() {
    setPromoting(true);
    try {
      await onPromote(team?.id);
      onOpenChange(false);
    } catch {
      setPromoting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Promote to Production" description="Promote this team to production mode">
        <div className="px-5 py-4 space-y-3">
          <p className="text-sm text-text-1 font-sans">
            Promote <span className="font-semibold text-text-0">{team?.name}</span> to production?
          </p>
          <p className="text-xs text-text-3 font-sans">
            This will move files from the team directory into the project directory.
            The team will be removed but your work stays in the project permanently.
          </p>
        </div>
        <div className="px-5 py-3 border-t border-border-subtle flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" size="sm" disabled={promoting} onClick={handleConfirm} className="gap-1.5">
            <ArrowUpCircle size={12} />
            {promoting ? 'Promoting...' : 'Promote'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value, color }) {
  return (
    <div className="text-center">
      <div className={cn('text-xs font-mono tabular-nums', color || 'text-text-1')}>{value}</div>
      <div className="text-2xs font-mono text-text-4 uppercase tracking-wider">{label}</div>
    </div>
  );
}

// ── Approvals ─────────────────────────────────────────────────
function PendingApprovals() {
  const pending = useGrooveStore((s) => s.pendingApprovals);
  const approveRequest = useGrooveStore((s) => s.approveRequest);
  const rejectRequest = useGrooveStore((s) => s.rejectRequest);

  if (pending.length === 0) return null;

  return (
    <div className="px-4 pt-4 space-y-2">
      <div className="flex items-center gap-2 mb-1">
        <AlertTriangle size={12} className="text-warning" />
        <span className="text-2xs font-mono text-warning uppercase tracking-wider">Pending ({pending.length})</span>
      </div>
      {pending.map((item) => (
        <div key={item.id} className="flex items-center gap-3 px-3 py-2 rounded-md bg-warning/5 border border-warning/20">
          <div className="flex-1 min-w-0">
            <div className="text-xs text-text-0 font-sans font-medium truncate">
              {item.agentName}: {item.action?.description || item.action?.type || 'action'}
            </div>
            {item.action?.filePath && <div className="text-2xs font-mono text-text-3 truncate mt-0.5">{item.action.filePath}</div>}
            <div className="text-2xs text-text-4 font-mono mt-0.5">{timeAgo(item.requestedAt)}</div>
          </div>
          <div className="flex gap-1.5 flex-shrink-0">
            <Button variant="primary" size="sm" onClick={() => approveRequest(item.id)} className="h-7 px-2.5 gap-1 text-2xs">
              <ShieldCheck size={10} /> Approve
            </Button>
            <Button variant="danger" size="sm" onClick={() => rejectRequest(item.id)} className="h-7 px-2.5 gap-1 text-2xs">
              <ShieldX size={10} /> Reject
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

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

  const seen = new Set();
  const allHistory = [...resolved, ...pmHistory].filter((item) => {
    const key = item.id || `${item.agentName}-${item.timestamp}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return (
    <div className="flex-1 overflow-y-auto">
      <PendingApprovals />
      <div className="p-4 space-y-1.5">
        {loading && allHistory.length === 0 && (
          <div className="text-center py-12 text-text-4 font-mono text-xs">Loading...</div>
        )}
        {!loading && allHistory.length === 0 && (
          <div className="text-center py-12">
            <CheckCircle size={24} className="mx-auto mb-2 text-text-4" />
            <p className="text-xs font-sans text-text-3">No approval history</p>
            <p className="text-2xs text-text-4 font-sans mt-1">Approvals appear when agents use Auto permission mode</p>
          </div>
        )}
        {allHistory.map((item, i) => {
          const approved = item.status === 'approved' || item.verdict === 'approved';
          return (
            <div key={item.id || i} className="flex items-center gap-2.5 px-3 py-2 rounded-md bg-surface-0 border border-border-subtle">
              {approved ? (
                <CheckCircle size={12} className="text-success flex-shrink-0" />
              ) : (
                <XCircle size={12} className="text-danger flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-xs text-text-1 font-sans truncate">
                  <span className="font-medium text-text-0">{item.agentName}</span>
                  <span className="text-text-3 mx-1">·</span>
                  <span>{item.action?.description || item.action || 'action'}</span>
                </div>
                {item.reason && <div className="text-2xs text-text-3 font-sans truncate mt-0.5">{item.reason}</div>}
              </div>
              <span className="text-2xs font-mono text-text-4 flex-shrink-0">
                {timeAgo(item.resolvedAt || item.timestamp)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Schedules ─────────────────────────────────────────────────
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

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="p-4 space-y-2">
        {loading && schedules.length === 0 && (
          <div className="text-center py-12 text-text-4 font-mono text-xs">Loading...</div>
        )}
        {!loading && schedules.length === 0 && (
          <div className="text-center py-12">
            <Calendar size={24} className="mx-auto mb-2 text-text-4" />
            <p className="text-xs font-sans text-text-3">No schedules configured</p>
            <p className="text-2xs text-text-4 font-sans mt-1">Use the CLI to create agent schedules</p>
          </div>
        )}
        {schedules.map((s) => (
          <div key={s.id} className="rounded-md border border-border-subtle bg-surface-0 overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-text-0 font-sans">{s.name}</span>
                  <Badge variant={s.enabled ? 'success' : 'default'} className="text-2xs">
                    {s.enabled ? 'Active' : 'Paused'}
                  </Badge>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-2xs font-mono text-text-2">{s.cron}</span>
                  <span className="text-2xs text-text-4">·</span>
                  <span className="text-2xs font-mono text-text-3 uppercase">{s.role}</span>
                  {s.teamId && (
                    <>
                      <span className="text-2xs text-text-4">·</span>
                      <span className="text-2xs font-sans text-text-3">{s.teamName || s.teamId}</span>
                    </>
                  )}
                </div>
                {s.prompt && (
                  <div className="text-2xs font-sans text-text-4 mt-1 truncate">{s.prompt}</div>
                )}
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => toggleSchedule(s.id, s.enabled)}
                className="h-7 px-2.5 gap-1 text-2xs"
              >
                {s.enabled ? <><Pause size={10} /> Pause</> : <><Play size={10} /> Enable</>}
              </Button>
            </div>
            {s.lastRunAt && (
              <div className="px-4 py-1.5 border-t border-border-subtle bg-surface-1 text-2xs font-mono text-text-4">
                Last run: {timeAgo(s.lastRunAt)}
                {s.nextRunAt && <span className="ml-3">Next: {timeAgo(s.nextRunAt)}</span>}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main View ─────────────────────────────────────────────────
export default function TeamsView() {
  return (
    <Tabs defaultValue="dashboard" className="flex flex-col h-full">
      <div className="px-4 pt-3 bg-surface-1 border-b border-border">
        <div className="flex items-center gap-4 mb-0">
          <h2 className="text-xs font-semibold text-text-0 font-sans tracking-wide uppercase">Management</h2>
        </div>
        <TabsList className="border-b-0">
          <TabsTrigger value="dashboard" className="inline-flex items-center gap-1.5">
            <LayoutDashboard size={12} />
            Teams
          </TabsTrigger>
          <TabsTrigger value="approvals" className="inline-flex items-center gap-1.5">
            <ListChecks size={12} />
            Approvals
          </TabsTrigger>
          <TabsTrigger value="schedules" className="inline-flex items-center gap-1.5">
            <Calendar size={12} />
            Schedules
          </TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="dashboard" className="flex flex-col min-h-0">
        <TeamsDashboard />
      </TabsContent>
      <TabsContent value="approvals" className="flex flex-col min-h-0">
        <ApprovalsTab />
      </TabsContent>
      <TabsContent value="schedules" className="flex flex-col min-h-0">
        <SchedulesTab />
      </TabsContent>
    </Tabs>
  );
}
