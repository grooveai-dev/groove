// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useRef, useEffect } from 'react';
import { useGrooveStore } from '../../stores/groove';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { timeAgo, fmtDollar } from '../../lib/format';
import { cn } from '../../lib/cn';
import {
  Play, Pause, RotateCcw, MoreHorizontal, Trash2, Pencil, Zap,
  Clock, Activity, DollarSign, Hash,
} from 'lucide-react';

function statusBadge(agent) {
  if (agent.paused) return { variant: 'warning', label: 'Paused', dot: false };
  if (agent.lastRunStatus === 'running') return { variant: 'info', label: 'Running', dot: true };
  if (agent.activeAgent) return { variant: 'info', label: 'Running', dot: true };
  if (!agent.enabled) return { variant: 'default', label: 'Disabled', dot: false };
  if (agent.consecutiveFailures >= 5) return { variant: 'danger', label: 'Auto-Paused', dot: false };
  return { variant: 'success', label: 'Active', dot: false };
}

export function AutoAgentCard({ agent }) {
  const selectAutoAgent = useGrooveStore((s) => s.selectAutoAgent);
  const pauseAutoAgent = useGrooveStore((s) => s.pauseAutoAgent);
  const resumeAutoAgent = useGrooveStore((s) => s.resumeAutoAgent);
  const triggerAutoAgent = useGrooveStore((s) => s.triggerAutoAgent);
  const deleteAutoAgent = useGrooveStore((s) => s.deleteAutoAgent);
  const selectedId = useGrooveStore((s) => s.selectedAutoAgentId);

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return;
    function handleClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menuOpen]);

  const a = agent;
  const badge = statusBadge(a);
  const isSelected = selectedId === a.id;
  const phase = a.state?.phase || 'idle';

  return (
    <div
      onClick={() => selectAutoAgent(a.id)}
      className={cn(
        'rounded-md border bg-surface-1 overflow-hidden transition-colors cursor-pointer',
        isSelected ? 'border-accent ring-1 ring-accent/30' : 'border-border-subtle hover:border-border',
      )}
    >
      {/* Header */}
      <div className="px-4 py-3 flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-text-0 font-sans truncate">{a.name}</span>
            <Badge variant={badge.variant} dot={badge.dot ? 'pulse' : undefined} className="text-2xs flex-shrink-0">
              {badge.label}
            </Badge>
          </div>
          {a.description && (
            <p className="text-2xs text-text-3 font-sans mt-0.5 line-clamp-2">{a.description}</p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {a.paused ? (
            <Button variant="ghost" size="icon-sm" onClick={(e) => { e.stopPropagation(); resumeAutoAgent(a.id); }}>
              <Play size={12} />
            </Button>
          ) : (
            <Button variant="ghost" size="icon-sm" onClick={(e) => { e.stopPropagation(); pauseAutoAgent(a.id); }}>
              <Pause size={12} />
            </Button>
          )}
          <Button variant="ghost" size="icon-sm" onClick={(e) => { e.stopPropagation(); triggerAutoAgent(a.id); }}>
            <Zap size={12} />
          </Button>
          <div className="relative" ref={menuRef}>
            <Button variant="ghost" size="icon-sm" onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}>
              <MoreHorizontal size={12} />
            </Button>
            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 z-50 bg-surface-2 border border-border rounded-md shadow-lg py-1 min-w-[140px]">
                <button
                  onClick={(e) => { e.stopPropagation(); setMenuOpen(false); deleteAutoAgent(a.id); }}
                  className="w-full px-3 py-1.5 text-xs font-sans text-danger hover:bg-surface-3 text-left flex items-center gap-2"
                >
                  <Trash2 size={11} /> Delete
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="px-4 pb-3 flex items-center gap-4 text-2xs text-text-3 font-mono">
        <span className="flex items-center gap-1">
          <Activity size={10} className="text-text-4" />
          {phase}
        </span>
        <span className="flex items-center gap-1">
          <Hash size={10} className="text-text-4" />
          {a.totalCycles || 0} cycles
        </span>
        <span className="flex items-center gap-1">
          <DollarSign size={10} className="text-text-4" />
          {fmtDollar(a.totalCost || 0)}
        </span>
        <span className="flex items-center gap-1">
          <Clock size={10} className="text-text-4" />
          {a.cadenceDescription || a.cadence}
        </span>
      </div>

      {/* Active agent indicator */}
      {a.activeAgent && (
        <div className="px-4 pb-2">
          <div className="flex items-center gap-2 text-2xs font-sans text-accent">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
            Agent {a.activeAgent.id} running
          </div>
        </div>
      )}

      {/* Last run */}
      {a.lastRunAt && !a.activeAgent && (
        <div className="px-4 pb-2 text-2xs text-text-4 font-sans">
          Last run {timeAgo(a.lastRunAt)} · {a.lastRunStatus || 'unknown'}
        </div>
      )}
    </div>
  );
}
