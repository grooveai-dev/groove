// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useCallback, useRef, useEffect } from 'react';
import { X, Pencil } from 'lucide-react';
import { useGrooveStore } from '../../stores/groove';
import { cn } from '../../lib/cn';
import { api } from '../../lib/api';

const STATUS_DOT = {
  running: 'bg-accent',
  starting: 'bg-text-3',
  completed: 'bg-info',
  crashed: 'bg-danger',
  stopped: 'bg-text-4',
  killed: 'bg-text-4',
  rotating: 'bg-accent',
};

function ctxBarColor(pct) {
  if (pct >= 75) return 'bg-danger';
  if (pct >= 50) return 'bg-warning';
  return 'bg-accent';
}

export function FleetAgentRow({ agent }) {
  const selected = useGrooveStore((s) => s.fleetSelectedAgents);
  const fleetSelectAgent = useGrooveStore((s) => s.fleetSelectAgent);
  const fleetMarkRead = useGrooveStore((s) => s.fleetMarkRead);
  const killAgent = useGrooveStore((s) => s.killAgent);
  const addToast = useGrooveStore((s) => s.addToast);
  const unreadTs = useGrooveStore((s) => s.fleetUnreadMap[agent.id]);
  const chatHistory = useGrooveStore((s) => s.chatHistory[agent.id]);

  const [confirmKill, setConfirmKill] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const inputRef = useRef(null);

  const isSelected = selected[0] === agent.id || selected[1] === agent.id;
  const ctxPct = Math.round((agent.contextUsage || 0) * 100);

  const lastMsg = chatHistory?.[chatHistory.length - 1];
  const hasUnread = lastMsg && (!unreadTs || lastMsg.timestamp > unreadTs) && lastMsg.from === 'agent';

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  function handleClick(e) {
    if (editing) return;
    if (e.metaKey || e.ctrlKey) {
      fleetSelectAgent(agent.id, 1);
    } else {
      fleetSelectAgent(agent.id, 0);
    }
    fleetMarkRead(agent.id);
  }

  function handleDoubleClick(e) {
    e.stopPropagation();
    setEditing(true);
    setEditName(agent.name);
  }

  async function commitRename() {
    setEditing(false);
    const trimmed = editName.trim().replace(/\s+/g, '-');
    if (!trimmed || trimmed === agent.name) return;
    try {
      await api.patch(`/agents/${agent.id}`, { name: trimmed });
    } catch (err) {
      // Renames can legitimately fail — duplicate name, illegal characters.
      addToast('error', 'Rename failed', err.message);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitRename();
    } else if (e.key === 'Escape') {
      setEditing(false);
    }
  }

  function handleRemove(e) {
    e.stopPropagation();
    const isAlive = agent.status === 'running' || agent.status === 'starting';
    if (confirmKill) {
      killAgent(agent.id, !isAlive);
      setConfirmKill(false);
    } else {
      setConfirmKill(true);
      setTimeout(() => setConfirmKill(false), 3000);
    }
  }

  const handleDragStart = useCallback((e) => {
    if (editing) { e.preventDefault(); return; }
    e.dataTransfer.setData('application/x-fleet-agent', agent.id);
    e.dataTransfer.effectAllowed = 'link';
  }, [agent.id, editing]);

  return (
    <div
      onClick={handleClick}
      draggable={!editing}
      onDragStart={handleDragStart}
      className={cn(
        'w-full flex items-center gap-2 px-2 py-1.5 transition-colors cursor-pointer group rounded-md',
        isSelected ? 'text-text-0' : 'hover:bg-surface-2',
        confirmKill && 'bg-danger/10',
      )}
    >
      {/* Status dot */}
      <span className={cn('w-2 h-2 rounded-full flex-shrink-0', STATUS_DOT[agent.status] || 'bg-text-4')} />

      {/* Name + role */}
      <div className="flex-1 min-w-0 text-left">
        {editing ? (
          <input
            ref={inputRef}
            type="text"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={commitRename}
            onKeyDown={handleKeyDown}
            className="w-full text-xs font-sans text-text-0 bg-surface-3 border border-border-subtle rounded px-1 py-0 leading-tight outline-none focus:border-accent"
          />
        ) : (
          <>
            <div
              onDoubleClick={handleDoubleClick}
              className={cn(
                'text-xs font-sans truncate leading-tight',
                confirmKill ? 'text-danger' : isSelected ? 'text-accent' : 'text-text-0',
              )}
            >
              {confirmKill ? 'Click again to remove' : agent.name}
            </div>
            {!confirmKill && (
              <div className="text-xs text-text-3 font-sans truncate leading-tight">{agent.role}</div>
            )}
          </>
        )}
      </div>

      {/* Context gauge (hidden on hover to make room for X) */}
      {ctxPct > 0 && !confirmKill && !editing && (
        <div className="group-hover:hidden w-8 h-1 rounded-sm bg-surface-4 overflow-hidden flex-shrink-0">
          <div
            className={cn('h-full rounded-sm transition-all', ctxBarColor(ctxPct))}
            style={{ width: `${ctxPct}%` }}
          />
        </div>
      )}

      {/* Unread dot (hidden on hover) */}
      {hasUnread && !confirmKill && !editing && (
        <span className="group-hover:hidden w-1.5 h-1.5 rounded-full bg-accent flex-shrink-0" />
      )}

      {/* Rename — an explicit affordance, since double-click competes with
          the row's drag handler and click-to-select */}
      {!editing && !confirmKill && (
        <button
          onClick={(e) => { e.stopPropagation(); setEditing(true); setEditName(agent.name); }}
          className="hidden group-hover:flex items-center justify-center p-0.5 rounded text-text-4 hover:text-accent transition-colors cursor-pointer flex-shrink-0"
          title="Rename agent"
        >
          <Pencil size={11} />
        </button>
      )}

      {/* Remove button (visible on hover) */}
      {!editing && (
        <button
          onClick={handleRemove}
          className={cn(
            'hidden group-hover:flex items-center justify-center p-0.5 rounded transition-colors cursor-pointer flex-shrink-0',
            confirmKill ? 'flex text-danger' : 'text-text-4 hover:text-danger',
          )}
          title={agent.status === 'running' || agent.status === 'starting' ? 'Kill agent' : 'Remove agent'}
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
