// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useRef } from 'react';
import { useGrooveStore } from '../../stores/groove';
import { Badge } from '../ui/badge';
import { AgentFeed } from './agent-feed';
import { AgentConfig } from './agent-config';
import { AgentTelemetry } from './agent-telemetry';
import { AgentMdFiles } from './agent-mdfiles';
import { MessageSquare, Settings, Activity, FileText, Pencil, Check, X } from 'lucide-react';
import { fmtNum, fmtUptime } from '../../lib/format';
import { cn } from '../../lib/cn';
import { roleColor } from '../../lib/status';
import { api } from '../../lib/api';

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

function InlineName({ agent }) {
  const addToast = useGrooveStore((s) => s.addToast);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(agent.name);
  const inputRef = useRef(null);

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

  if (editing) {
    return (
      <div className="flex items-center gap-1 flex-1 min-w-0">
        <input
          ref={inputRef}
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
    <div className="flex items-center gap-1.5 flex-1 min-w-0 group">
      <h2 className="text-sm font-bold text-text-0 font-sans truncate">{agent.name}</h2>
      <button
        onClick={() => { setName(agent.name); setEditing(true); }}
        className="p-0.5 text-text-4 opacity-0 group-hover:opacity-100 hover:text-text-1 cursor-pointer transition-opacity"
      >
        <Pencil size={10} />
      </button>
    </div>
  );
}

export function AgentPanel() {
  const detailPanel = useGrooveStore((s) => s.detailPanel);
  const agents = useGrooveStore((s) => s.agents);
  const activeTeamId = useGrooveStore((s) => s.activeTeamId);
  const [activeTab, setActiveTab] = useState('command');

  if (detailPanel?.type !== 'agent') return null;
  const agent = agents.find((a) => a.id === detailPanel.agentId);
  if (!agent) return null;
  if (activeTeamId && agent.teamId && agent.teamId !== activeTeamId) return null;

  const isAlive = agent.status === 'running' || agent.status === 'starting';
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
            <InlineName agent={agent} />
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
