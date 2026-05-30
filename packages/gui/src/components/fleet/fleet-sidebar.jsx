// FSL-1.1-Apache-2.0 — see LICENSE
import { useRef, useCallback, useMemo, useState } from 'react';
import { Search, X, ChevronRight, Plus, Trash2, Pencil, Users, Check } from 'lucide-react';
import { useGrooveStore } from '../../stores/groove';
import { cn } from '../../lib/cn';
import { FleetAgentRow } from './fleet-agent-row';

function teamStatusDot(agents) {
  if (agents.some((a) => a.status === 'crashed')) return 'bg-danger';
  if (agents.some((a) => a.status === 'running' || a.status === 'starting')) return 'bg-accent';
  if (agents.some((a) => a.status === 'completed')) return 'bg-info';
  return 'bg-text-4';
}

export function FleetSidebar({ width }) {
  const teams = useGrooveStore((s) => s.teams);
  const agents = useGrooveStore((s) => s.agents);
  const search = useGrooveStore((s) => s.fleetSearch);
  const setSearch = useGrooveStore((s) => s.fleetSetSearch);
  const collapsed = useGrooveStore((s) => s.fleetSidebarCollapsed);
  const toggleCollapsed = useGrooveStore((s) => s.fleetToggleTeamCollapsed);
  const setSidebarWidth = useGrooveStore((s) => s.fleetSetSidebarWidth);
  const deleteTeam = useGrooveStore((s) => s.deleteTeam);
  const createTeam = useGrooveStore((s) => s.createTeam);
  const renameTeam = useGrooveStore((s) => s.renameTeam);
  const openDetail = useGrooveStore((s) => s.openDetail);
  const addToast = useGrooveStore((s) => s.addToast);

  const [confirmDeleteTeam, setConfirmDeleteTeam] = useState(null);
  const [renamingTeamId, setRenamingTeamId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [creatingTeam, setCreatingTeam] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');

  const dragging = useRef(false);
  const startX = useRef(0);
  const startW = useRef(0);

  const onMouseDown = useCallback((e) => {
    e.preventDefault();
    dragging.current = true;
    startX.current = e.clientX;
    startW.current = width;

    function onMouseMove(ev) {
      if (!dragging.current) return;
      const delta = ev.clientX - startX.current;
      setSidebarWidth(startW.current + delta);
    }

    function onMouseUp() {
      dragging.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [width, setSidebarWidth]);

  const agentsByTeam = useMemo(() => {
    const map = {};
    for (const a of agents) {
      if (!a.teamId) continue;
      if (!map[a.teamId]) map[a.teamId] = [];
      map[a.teamId].push(a);
    }
    return map;
  }, [agents]);

  const lowerSearch = search.toLowerCase();
  const filteredTeams = useMemo(() => {
    if (!lowerSearch) return teams;
    return teams.filter((t) => {
      if (t.name?.toLowerCase().includes(lowerSearch)) return true;
      const ta = agentsByTeam[t.id] || [];
      return ta.some((a) =>
        a.name?.toLowerCase().includes(lowerSearch) ||
        a.role?.toLowerCase().includes(lowerSearch)
      );
    });
  }, [teams, agentsByTeam, lowerSearch]);

  const filteredAgentsForTeam = useCallback((teamId) => {
    const ta = agentsByTeam[teamId] || [];
    if (!lowerSearch) return ta;
    return ta.filter((a) =>
      a.name?.toLowerCase().includes(lowerSearch) ||
      a.role?.toLowerCase().includes(lowerSearch)
    );
  }, [agentsByTeam, lowerSearch]);

  function handleDeleteTeam(e, teamId) {
    e.stopPropagation();
    if (confirmDeleteTeam === teamId) {
      deleteTeam(teamId);
      setConfirmDeleteTeam(null);
    } else {
      setConfirmDeleteTeam(teamId);
      setTimeout(() => setConfirmDeleteTeam(null), 3000);
    }
  }

  function handleSpawnToTeam(e, teamId) {
    e.stopPropagation();
    openDetail({ type: 'spawn', presetTeamId: teamId });
  }

  async function handleCreateTeam() {
    const name = newTeamName.trim();
    if (!name) return;
    try {
      await createTeam(name);
      setNewTeamName('');
      setCreatingTeam(false);
    } catch { /* toast handles */ }
  }

  async function handleRename(teamId) {
    const name = renameValue.trim();
    if (!name) { setRenamingTeamId(null); return; }
    try {
      await renameTeam(teamId, name);
    } catch { /* toast handles */ }
    setRenamingTeamId(null);
  }

  function startRename(e, team) {
    e.stopPropagation();
    setRenamingTeamId(team.id);
    setRenameValue(team.name);
  }

  return (
    <div
      className="flex-shrink-0 flex flex-col bg-surface-1 border-r border-border relative h-full"
      style={{ width }}
    >
      {/* Search */}
      <div className="px-2.5 pt-2.5 pb-2 flex-shrink-0">
        <div className="relative">
          <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-4" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search agents..."
            className="w-full h-7 pl-7 pr-7 text-xs bg-surface-3 rounded border border-border-subtle text-text-0 placeholder:text-text-4 focus:outline-none focus:border-text-4/40 font-sans"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-text-4 hover:text-text-1 cursor-pointer"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Team list */}
      <div className="flex-1 overflow-y-auto min-h-0 px-1">
        {filteredTeams.map((team) => {
          const teamAgents = filteredAgentsForTeam(team.id);
          const allTeamAgents = agentsByTeam[team.id] || [];
          const isCollapsed = collapsed[team.id];
          const isConfirming = confirmDeleteTeam === team.id;

          return (
            <div key={team.id} className="mb-0.5">
              {/* Team header */}
              <div className={cn(
                'w-full flex items-center gap-1 px-2 py-1.5 rounded-md hover:bg-surface-2 transition-colors group',
                isConfirming && 'bg-danger/10 hover:bg-danger/20',
              )}>
                {renamingTeamId === team.id ? (
                  <div className="flex items-center gap-1.5 flex-1 min-w-0 pl-1">
                    <input
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleRename(team.id); if (e.key === 'Escape') setRenamingTeamId(null); }}
                      autoFocus
                      className="flex-1 min-w-0 h-6 px-1.5 text-xs bg-surface-3 border border-accent/40 rounded text-text-0 font-sans focus:outline-none"
                    />
                    <button onClick={() => handleRename(team.id)} className="p-0.5 text-accent cursor-pointer"><Check size={12} /></button>
                    <button onClick={() => setRenamingTeamId(null)} className="p-0.5 text-text-4 hover:text-text-1 cursor-pointer"><X size={12} /></button>
                  </div>
                ) : (
                  <>
                    <button
                      onClick={() => toggleCollapsed(team.id)}
                      onDoubleClick={(e) => startRename(e, team)}
                      className="flex items-center gap-1.5 flex-1 min-w-0 cursor-pointer"
                    >
                      <ChevronRight
                        size={14}
                        className={cn(
                          'text-text-4 transition-transform flex-shrink-0',
                          !isCollapsed && 'rotate-90',
                        )}
                      />
                      <span className={cn(
                        'text-xs font-medium font-sans truncate text-left',
                        isConfirming ? 'text-danger' : 'text-text-1',
                      )}>
                        {isConfirming ? 'Click again to delete' : team.name}
                      </span>
                    </button>

                    {/* Hover actions + meta — stacked in same space */}
                    <div className="flex items-center gap-0.5 flex-shrink-0">
                      <button
                        onClick={(e) => startRename(e, team)}
                        className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-text-4 hover:text-accent transition-opacity cursor-pointer"
                        title="Rename team"
                      >
                        <Pencil size={11} />
                      </button>
                      <button
                        onClick={(e) => handleSpawnToTeam(e, team.id)}
                        className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-text-4 hover:text-accent transition-opacity cursor-pointer"
                        title="Spawn agent to team"
                      >
                        <Plus size={14} />
                      </button>
                      <button
                        onClick={(e) => handleDeleteTeam(e, team.id)}
                        className={cn(
                          'opacity-0 group-hover:opacity-100 p-0.5 rounded transition-opacity cursor-pointer',
                          isConfirming ? 'text-danger' : 'text-text-4 hover:text-danger',
                        )}
                        title="Delete team"
                      >
                        <Trash2 size={12} />
                      </button>
                      <span className="group-hover:opacity-0 text-2xs text-text-4 font-mono transition-opacity">
                        {allTeamAgents.length}
                      </span>
                      <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', teamStatusDot(allTeamAgents))} />
                    </div>
                  </>
                )}
              </div>

              {/* Agent rows */}
              {!isCollapsed && teamAgents.length > 0 && (
                <div className="ml-3 pl-1">
                  {teamAgents.map((agent) => (
                    <FleetAgentRow key={agent.id} agent={agent} />
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {filteredTeams.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-center px-4">
            <Search size={16} className="text-text-4 mb-2" />
            <p className="text-xs text-text-3 font-sans">No matching agents</p>
          </div>
        )}
      </div>

      {/* Create team */}
      <div className="px-2.5 py-2 border-t border-border-subtle flex-shrink-0">
        {creatingTeam ? (
          <div className="flex items-center gap-1.5">
            <input
              value={newTeamName}
              onChange={(e) => setNewTeamName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreateTeam(); if (e.key === 'Escape') { setCreatingTeam(false); setNewTeamName(''); } }}
              placeholder="Team name..."
              autoFocus
              className="flex-1 min-w-0 h-7 px-2 text-xs bg-surface-3 border border-accent/40 rounded text-text-0 font-sans placeholder:text-text-4 focus:outline-none"
            />
            <button onClick={handleCreateTeam} disabled={!newTeamName.trim()} className="p-1 text-accent cursor-pointer disabled:opacity-30"><Check size={13} /></button>
            <button onClick={() => { setCreatingTeam(false); setNewTeamName(''); }} className="p-1 text-text-4 hover:text-text-1 cursor-pointer"><X size={13} /></button>
          </div>
        ) : (
          <button
            onClick={() => setCreatingTeam(true)}
            className="flex items-center gap-1.5 text-xs text-text-3 hover:text-accent font-sans font-medium cursor-pointer transition-colors"
          >
            <Users size={12} /> New Team
          </button>
        )}
      </div>

      {/* Resize handle */}
      <div
        className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-accent/30 transition-colors z-10"
        onMouseDown={onMouseDown}
      />
    </div>
  );
}
