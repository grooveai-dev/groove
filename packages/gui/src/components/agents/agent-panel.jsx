// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useRef, useEffect, useMemo } from 'react';
import { useGrooveStore } from '../../stores/groove';
import { Badge } from '../ui/badge';
import { AgentFeed } from './agent-feed';
import { AgentConfig } from './agent-config';
import { AgentTelemetry } from './agent-telemetry';
import { AgentMdFiles } from './agent-mdfiles';
import { MessageSquare, Settings, Activity, FileText, Pencil, Check, X, ChevronDown, Search } from 'lucide-react';
import { fmtNum, fmtUptime } from '../../lib/format';
import { cn } from '../../lib/cn';
import { roleColor } from '../../lib/status';
import { api } from '../../lib/api';

const SWITCH_STATUS_DOT = {
  running: 'bg-accent', starting: 'bg-warning', completed: 'bg-info',
  crashed: 'bg-danger', stopped: 'bg-text-4', killed: 'bg-text-4', rotating: 'bg-accent',
};

const STATUS_VARIANT = {
  running: 'success', starting: 'warning', stopped: 'default',
  crashed: 'danger', completed: 'accent', killed: 'default', rotating: 'purple',
};
const STATUS_LABEL = {
  running: 'Running', starting: 'Starting', stopped: 'Stopped',
  crashed: 'Crashed', completed: 'Done', killed: 'Killed', rotating: 'Rotating',
};

const TABS = [
  { id: 'command',   label: 'Chat',      icon: MessageSquare },
  { id: 'config',    label: 'Config',    icon: Settings },
  { id: 'telemetry', label: 'Monitor',   icon: Activity },
  { id: 'mdfiles',   label: 'Files',     icon: FileText },
];

// The agent name doubles as a switcher — click it to jump the panel to any
// other agent without closing the terminal or hunting through the tree. The
// hover pencil still renames in place.
function AgentSwitcher({ agent }) {
  const addToast = useGrooveStore((s) => s.addToast);
  const agents = useGrooveStore((s) => s.agents);
  const teams = useGrooveStore((s) => s.teams);
  const switchAgentPanel = useGrooveStore((s) => s.switchAgentPanel);

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(agent.name);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapRef = useRef(null);

  // Close the dropdown on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const byTeam = new Map();
    for (const a of agents) {
      if (q && !a.name.toLowerCase().includes(q) && !a.role.toLowerCase().includes(q)) continue;
      const key = a.teamId || '_none';
      if (!byTeam.has(key)) byTeam.set(key, []);
      byTeam.get(key).push(a);
    }
    return Array.from(byTeam.entries()).map(([teamId, list]) => ({
      teamId,
      name: teams.find((t) => t.id === teamId)?.name || 'No team',
      agents: list.sort((a, b) => a.name.localeCompare(b.name)),
    })).sort((a, b) => a.name.localeCompare(b.name));
  }, [agents, teams, query]);

  async function save() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === agent.name) { setEditing(false); return; }
    try {
      await api.patch(`/agents/${agent.id}`, { name: trimmed.replace(/\s+/g, '-') });
      addToast('success', `Renamed → ${trimmed}`);
    } catch (err) {
      addToast('error', 'Rename failed', err.message);
      setName(agent.name);
    }
    setEditing(false);
  }

  function pick(id) {
    setOpen(false);
    setQuery('');
    if (id !== agent.id) switchAgentPanel(id);
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1 flex-1 min-w-0">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { setName(agent.name); setEditing(false); } }}
          className="flex-1 min-w-0 h-6 px-1.5 text-sm font-bold bg-surface-0 border border-accent/30 rounded text-text-0 font-sans focus:outline-none focus:ring-1 focus:ring-accent/40"
          autoFocus
        />
        <button onClick={save} className="p-0.5 text-accent hover:text-accent/80 cursor-pointer"><Check size={12} /></button>
        <button onClick={() => { setName(agent.name); setEditing(false); }} className="p-0.5 text-text-4 hover:text-text-1 cursor-pointer"><X size={12} /></button>
      </div>
    );
  }

  return (
    <div ref={wrapRef} className="relative flex items-center gap-1.5 flex-1 min-w-0 group">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 min-w-0 cursor-pointer rounded px-1 -mx-1 py-0.5 hover:bg-surface-3 transition-colors"
        title="Switch agent"
      >
        <h2 className="text-sm font-bold text-text-0 font-sans truncate">{agent.name}</h2>
        <ChevronDown size={13} className={cn('text-text-4 flex-shrink-0 transition-transform', open && 'rotate-180')} />
      </button>
      <button
        onClick={() => { setName(agent.name); setEditing(true); }}
        className="p-0.5 text-text-4 opacity-0 group-hover:opacity-100 hover:text-text-1 cursor-pointer transition-opacity flex-shrink-0"
        title="Rename agent"
      >
        <Pencil size={10} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1.5 w-72 max-h-[70vh] flex flex-col bg-surface-1 border border-border rounded-lg shadow-xl z-50 overflow-hidden">
          <div className="flex items-center gap-1.5 px-2.5 py-2 border-b border-border-subtle">
            <Search size={12} className="text-text-4 flex-shrink-0" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Switch to agent…"
              autoFocus
              className="flex-1 min-w-0 bg-transparent text-xs text-text-0 font-sans placeholder:text-text-4 focus:outline-none"
            />
          </div>
          <div className="overflow-y-auto py-1">
            {grouped.length === 0 && (
              <div className="px-3 py-3 text-xs text-text-4 font-sans text-center">No agents match</div>
            )}
            {grouped.map((g) => (
              <div key={g.teamId}>
                <div className="px-2.5 pt-1.5 pb-0.5 text-2xs font-semibold text-text-4 font-sans uppercase tracking-wide">{g.name}</div>
                {g.agents.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => pick(a.id)}
                    className={cn(
                      'w-full flex items-center gap-2 px-2.5 py-1.5 text-left cursor-pointer transition-colors',
                      a.id === agent.id ? 'bg-accent/10' : 'hover:bg-surface-3',
                    )}
                  >
                    <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', SWITCH_STATUS_DOT[a.status] || 'bg-text-4')} />
                    <span className={cn('text-xs font-sans truncate', a.id === agent.id ? 'text-accent font-medium' : 'text-text-1')}>{a.name}</span>
                    <span className="text-2xs text-text-4 font-sans ml-auto flex-shrink-0 capitalize">{a.role}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function AgentPanel() {
  const detailPanel = useGrooveStore((s) => s.detailPanel);
  const agents = useGrooveStore((s) => s.agents);
  const activeTeamId = useGrooveStore((s) => s.activeTeamId);
  const activeView = useGrooveStore((s) => s.activeView);
  const addToast = useGrooveStore((s) => s.addToast);
  const [activeTab, setActiveTab] = useState('command');
  const cachedAgentRef = useRef(null);

  const agentId = detailPanel?.type === 'agent' ? detailPanel.agentId : null;
  const liveAgent = agentId ? agents.find((a) => a.id === agentId) : null;
  if (liveAgent) cachedAgentRef.current = liveAgent;
  else if (cachedAgentRef.current && agentId && cachedAgentRef.current.id !== agentId) cachedAgentRef.current = null;
  const agent = liveAgent || cachedAgentRef.current;
  const isAlive = liveAgent?.status === 'running' || liveAgent?.status === 'starting';

  if (!agent) return null;
  // The team guard hides a stale panel when switching teams in the Agents view.
  // Fleet is cross-team by design — an agent selected there legitimately belongs
  // to another team, so applying the guard would blank a valid panel.
  if (activeView !== 'fleet' && activeTeamId && agent.teamId && agent.teamId !== activeTeamId) return null;

  const ctxPct = Math.round((agent.contextUsage || 0) * 100);
  const spawned = agent.spawnedAt || agent.createdAt;
  const uptime = spawned ? Math.floor((Date.now() - new Date(spawned).getTime()) / 1000) : 0;
  const colors = roleColor(agent.role);

  return (
    <div className="flex flex-col h-full">
      {/* ── Header ─────────────────────────────────────────── */}
      <div className="flex-shrink-0">
        {/* Role color accent — subtle, no border */}

        <div className="pl-4 pr-10 pt-3 pb-2">
          {/* Name + status row — pr-10 gives room for the detail panel X button */}
          <div className="flex items-center gap-2">
            <AgentSwitcher agent={agent} />
            <Badge variant={STATUS_VARIANT[agent.status] || 'default'} dot={isAlive ? 'pulse' : undefined} className="text-2xs flex-shrink-0">
              {STATUS_LABEL[agent.status] || agent.status}
            </Badge>
          </div>

          {/* Metadata row */}
          <div className="flex items-center gap-2 mt-1 text-2xs text-text-3 font-mono">
            <span className="capitalize">{agent.role}</span>
            <span className="text-text-4">·</span>
            <span>{agent.provider}:{agent.model || 'auto'}</span>
            <span className="text-text-4">·</span>
            <span>{fmtNum(agent.tokensUsed || 0)} tok</span>
            {ctxPct > 0 && (
              <>
                <span className="text-text-4">·</span>
                <span className={cn(
                  ctxPct > 80 ? 'text-danger' : ctxPct > 60 ? 'text-warning' : 'text-text-3',
                )}>{ctxPct}% ctx</span>
              </>
            )}
            <span className="text-text-4">·</span>
            <span>{fmtUptime(uptime)}</span>
          </div>
        </div>

        {/* Tab nav — underline style */}
        <div className="flex items-center px-4 border-b border-border-subtle">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-2 text-2xs font-semibold font-sans transition-all cursor-pointer select-none border-b-2 -mb-px',
                  active
                    ? 'border-accent text-text-0'
                    : 'border-transparent text-text-3 hover:text-text-1',
                )}
              >
                <Icon size={11} />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Tab Content ────────────────────────────────────── */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {activeTab === 'command' && <AgentFeed agent={agent} />}
        {activeTab === 'config' && <AgentConfig agent={agent} />}
        {activeTab === 'telemetry' && <AgentTelemetry agent={agent} />}
        {activeTab === 'mdfiles' && <AgentMdFiles agent={agent} />}
      </div>
    </div>
  );
}
