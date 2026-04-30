// FSL-1.1-Apache-2.0 — see LICENSE
import { useMemo, useCallback, useEffect, useState, useRef } from 'react';
import {
  ReactFlow, Background, useNodesState, useEdgesState,
  useReactFlow, ReactFlowProvider,
} from '@xyflow/react';
import { useGrooveStore } from '../stores/groove';
import { AgentNode } from '../components/agents/agent-node';
import { RootNode } from '../components/agents/root-node';
import { cn } from '../lib/cn';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Plus, Users, UserPlus, Zap, X, Check, Rocket, Server, Monitor, Code2, TestTube, Shield, Pencil, Copy, Trash2, ChevronDown, ChevronLeft, ChevronRight, FolderOpen, Eye, Settings2, Search, GripVertical, Cloud, FileText, Database, Megaphone, Calculator, UserCheck, Headphones, BarChart3, Pen, Presentation, Globe, MessageCircle, Save, Layers, Archive, Box, HardDrive, LayoutGrid } from 'lucide-react';
import { PreviewWorkspace } from '../components/preview/preview-workspace';
import { WorkspaceMode } from '../components/agents/workspace-mode';
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator } from '../components/ui/context-menu';
import { Dialog, DialogContent } from '../components/ui/dialog';
import { TeamRemovalDialog } from '../components/teams/team-removal-dialog';
import { Select, SelectTrigger, SelectContent, SelectItem } from '../components/ui/select';
import { ScrollArea } from '../components/ui/scroll-area';
import { Tooltip } from '../components/ui/tooltip';
import { TuningSlider } from '../components/ui/slider';

const NODE_TYPES = { agentNode: AgentNode, rootNode: RootNode };
const NODE_W = 220;
const NODE_H = 82;
const NODE_X_GAP = 260;
const NODE_Y_GAP = 130;
const MAX_PER_ROW = 4;
const ROOT_ID = '__groove_root__';

function loadPositions(teamId) {
  if (!teamId) return {};
  try { return JSON.parse(localStorage.getItem(`groove:nodePositions:${teamId}`) || '{}'); } catch { return {}; }
}

// Drop high-volume caches (chatHistory, activityLog) to free quota.
// Used as a fallback when setItem fails on savePositions.
function freeLocalStorage() {
  let freed = false;
  for (const key of ['groove:chatHistory', 'groove:activityLog']) {
    if (localStorage.getItem(key) !== null) { localStorage.removeItem(key); freed = true; }
  }
  return freed;
}

function savePositions(teamId, positions) {
  if (!teamId) return;
  const key = `groove:nodePositions:${teamId}`;
  const s = JSON.stringify(positions);
  try { localStorage.setItem(key, s); return; } catch { /* quota */ }
  if (!freeLocalStorage()) return;
  try { localStorage.setItem(key, s); } catch { /* still over — give up silently */ }
}

function loadRoleLayout(teamId) {
  if (!teamId) return {};
  try { return JSON.parse(localStorage.getItem(`groove:roleLayout:${teamId}`) || '{}'); } catch { return {}; }
}

function saveRoleLayout(teamId, layout) {
  if (!teamId) return;
  const key = `groove:roleLayout:${teamId}`;
  const s = JSON.stringify(layout);
  try { localStorage.setItem(key, s); return; } catch { /* quota */ }
  if (!freeLocalStorage()) return;
  try { localStorage.setItem(key, s); } catch { /* still over — give up silently */ }
}

function loadTeamViewports() {
  try { return JSON.parse(localStorage.getItem('groove:teamViewports') || '{}'); } catch { return {}; }
}

function saveTeamViewport(teamId, viewport) {
  try {
    const all = loadTeamViewports();
    all[teamId] = viewport;
    localStorage.setItem('groove:teamViewports', JSON.stringify(all));
  } catch {}
}

/* ── Team Tab Bar (IDE-style) ──────────────────────────────── */

function teamStatus(agents, teamId) {
  const ta = agents.filter((a) => a.teamId === teamId);
  if (ta.length === 0) return 'idle';
  const running = ta.some((a) => a.status === 'running' || a.status === 'starting');
  if (running) return 'working';
  const allDone = ta.every((a) => a.status === 'completed');
  if (allDone) return 'completed';
  const anyCrashed = ta.some((a) => a.status === 'crashed');
  if (anyCrashed) return 'crashed';
  return 'idle';
}

export function TeamTabBar() {
  const teams = useGrooveStore((s) => s.teams);
  const activeTeamId = useGrooveStore((s) => s.activeTeamId);
  const agents = useGrooveStore((s) => s.agents);
  const switchTeam = useGrooveStore((s) => s.switchTeam);
  const createTeam = useGrooveStore((s) => s.createTeam);
  const archiveTeam = useGrooveStore((s) => s.archiveTeam);
  const deleteTeamPermanently = useGrooveStore((s) => s.deleteTeamPermanently);
  const renameTeam = useGrooveStore((s) => s.renameTeam);
  const cloneTeam = useGrooveStore((s) => s.cloneTeam);
  const reorderTeams = useGrooveStore((s) => s.reorderTeams);
  const addToast = useGrooveStore((s) => s.addToast);

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [archiveConfirm, setArchiveConfirm] = useState(null);
  const submitting = useRef(false);
  const [dragId, setDragId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);
  const scrollRef = useRef(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 0);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    checkScroll();
    el.addEventListener('scroll', checkScroll);
    const ro = new ResizeObserver(checkScroll);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', checkScroll);
      ro.disconnect();
    };
  }, [checkScroll, teams.length]);

  function handleCreate() {
    const name = newName.trim();
    if (!name || submitting.current) return;
    submitting.current = true;
    setNewName('');
    setCreating(false);
    createTeam(name).finally(() => {
      submitting.current = false;
      setTimeout(() => { if (scrollRef.current) scrollRef.current.scrollTo({ left: scrollRef.current.scrollWidth, behavior: 'smooth' }); }, 100);
    });
  }

  function startRename(team) {
    setRenamingId(team.id);
    setRenameValue(team.name);
  }

  function handleRename() {
    const name = renameValue.trim();
    if (!name || !renamingId) { setRenamingId(null); return; }
    renameTeam(renamingId, name);
    setRenamingId(null);
  }

  return (
    <div className="flex items-end px-0 pt-0 pb-0 bg-surface-1 border-b border-border gap-0 flex-shrink-0 overflow-hidden">
      {canScrollLeft && (
        <button
          onClick={() => scrollRef.current?.scrollBy({ left: -300, behavior: 'smooth' })}
          className="w-6 h-9 flex items-center justify-center bg-accent/15 text-accent hover:bg-accent/25 transition-colors flex-shrink-0 cursor-pointer"
        >
          <ChevronLeft size={14} />
        </button>
      )}
      <div
        ref={scrollRef}
        className="flex items-end flex-1 min-w-0 overflow-x-auto gap-0"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none', WebkitOverflowScrolling: 'touch' }}
      >
      {teams.map((team) => {
        const count = agents.filter((a) => a.teamId === team.id).length;
        const isActive = team.id === activeTeamId;
        const isRenaming = renamingId === team.id;
        const running = agents.filter((a) => a.teamId === team.id && (a.status === 'running' || a.status === 'starting')).length;

        return (
          <ContextMenu key={team.id}>
            <ContextMenuTrigger asChild>
              <div
                draggable={!isRenaming}
                onDragStart={(e) => { setDragId(team.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', ''); }}
                onDragEnd={() => { setDragId(null); setDragOverId(null); }}
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (dragId && dragId !== team.id) setDragOverId(team.id); }}
                onDragLeave={() => { if (dragOverId === team.id) setDragOverId(null); }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (!dragId || dragId === team.id) return;
                  const from = teams.findIndex((t) => t.id === dragId);
                  const to = teams.findIndex((t) => t.id === team.id);
                  if (from !== -1 && to !== -1) reorderTeams(from, to);
                  setDragId(null);
                  setDragOverId(null);
                }}
                onClick={() => !isRenaming && switchTeam(team.id)}
                onDoubleClick={() => startRename(team)}
                className={cn(
                  'relative flex items-center gap-2 px-3 h-9 text-xs font-sans cursor-pointer select-none transition-colors flex-shrink-0',
                  isActive
                    ? 'text-text-0 font-semibold border-x border-x-[#242830] bg-[#242830]'
                    : 'text-text-3 hover:text-text-1 hover:bg-surface-3/50',
                  dragId === team.id && 'opacity-40',
                  dragOverId === team.id && dragId !== team.id && 'border-l-2 !border-l-accent',
                )}
              >
                {isActive && <div className="absolute top-0 left-0 right-0 h-px bg-accent" style={{ height: '0.5px' }} />}
                {(() => {
                  const status = teamStatus(agents, team.id);
                  const iconColor = status === 'working' ? 'text-green-400'
                    : status === 'completed' ? 'text-green-400'
                    : status === 'crashed' ? 'text-red-400'
                    : isActive ? 'text-accent' : 'text-text-4';
                  return (
                    <span className="relative flex-shrink-0">
                      <Users size={13} className={cn(iconColor, status === 'working' && 'animate-pulse')} />
                      {status === 'working' && (
                        <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                      )}
                    </span>
                  );
                })()}

                {isRenaming ? (
                  <input
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleRename(); if (e.key === 'Escape') setRenamingId(null); }}
                    onBlur={handleRename}
                    className="h-5 w-24 px-1.5 text-xs bg-surface-0 border border-accent rounded text-text-0 font-sans focus:outline-none"
                    autoFocus
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span className="truncate max-w-[120px]">{team.name}</span>
                )}

                {count > 0 && !isRenaming && (
                  <span className={cn(
                    'flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-2xs font-mono font-semibold',
                    running > 0 ? 'bg-accent/15 text-accent' : 'bg-surface-4 text-text-3',
                  )}>
                    {count}
                  </span>
                )}

                {isActive && (
                  <div className="absolute bottom-[-1px] left-0 right-0 h-px bg-[#242830]" />
                )}
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem onSelect={() => startRename(team)}>
                <Pencil size={12} /> Rename
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => cloneTeam(team.id)}>
                <Copy size={12} /> Clone
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem danger onSelect={() => {
                const teamAgents = agents.filter((a) => a.teamId === team.id);
                if (teamAgents.some((a) => a.status === 'running' || a.status === 'starting')) {
                  addToast('error', 'Stop running agents first');
                  return;
                }
                setArchiveConfirm(team);
              }}>
                <Trash2 size={12} /> {team.isDefault ? 'Wipe' : 'Archive'}
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        );
      })}

      {creating ? (
        <div className="flex items-center gap-1.5 px-3 h-9 flex-shrink-0">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') { setCreating(false); setNewName(''); } }}
            placeholder="Team name..."
            className="h-5 w-28 px-1.5 text-xs bg-surface-0 border border-border-subtle rounded text-text-0 font-sans placeholder:text-text-4 focus:outline-none focus:ring-1 focus:ring-accent"
            autoFocus
          />
          <button
            onClick={handleCreate}
            disabled={!newName.trim()}
            className="p-1 rounded text-accent hover:bg-accent/10 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Check size={12} />
          </button>
          <button onClick={() => { setCreating(false); setNewName(''); }} className="p-1 rounded text-text-4 hover:text-text-1 cursor-pointer">
            <X size={12} />
          </button>
        </div>
      ) : (
        <button
          onClick={() => setCreating(true)}
          className="flex items-center justify-center w-6 h-6 my-auto mx-2 rounded-full bg-accent/15 text-accent hover:bg-accent/25 cursor-pointer transition-colors flex-shrink-0"
          title="New team"
        >
          <Plus size={12} />
        </button>
      )}

      </div>
      {canScrollRight && (
        <button
          onClick={() => scrollRef.current?.scrollBy({ left: 300, behavior: 'smooth' })}
          className="w-6 h-9 flex items-center justify-center bg-accent/15 text-accent hover:bg-accent/25 transition-colors flex-shrink-0 cursor-pointer"
        >
          <ChevronRight size={14} />
        </button>
      )}

      <TeamRemovalDialog
        team={archiveConfirm}
        open={!!archiveConfirm}
        onOpenChange={(open) => !open && setArchiveConfirm(null)}
        onArchive={archiveTeam}
        onDeletePermanently={deleteTeamPermanently}
        mode={archiveConfirm?.mode || 'sandbox'}
      />
    </div>
  );
}

/* ── Agent Tree ────────────────────────────────────────────── */

function AgentTreeInner() {
  const allAgents = useGrooveStore((s) => s.agents);
  const activeTeamId = useGrooveStore((s) => s.activeTeamId);
  const tokenTimeline = useGrooveStore((s) => s.tokenTimeline);
  const selectAgent = useGrooveStore((s) => s.selectAgent);
  const closeDetail = useGrooveStore((s) => s.closeDetail);

  const prevAgentsRef = useRef([]);
  const agents = useMemo(() => {
    const next = allAgents
      .filter((a) => a.teamId === activeTeamId)
      .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
    const prev = prevAgentsRef.current;
    if (prev.length === next.length && prev.every((p, i) => p.id === next[i].id && p.status === next[i].status && p.name === next[i].name && p.model === next[i].model && p.tokensUsed === next[i].tokensUsed && p.contextUsage === next[i].contextUsage)) return prev;
    prevAgentsRef.current = next;
    return next;
  }, [allAgents, activeTeamId]);

  const positionsRef = useRef(loadPositions(activeTeamId));
  const positionsTeamRef = useRef(activeTeamId);
  if (positionsTeamRef.current !== activeTeamId) {
    positionsTeamRef.current = activeTeamId;
    positionsRef.current = loadPositions(activeTeamId);
  }

  const { fitView, setViewport } = useReactFlow();
  const [prevCount, setPrevCount] = useState(0);
  const prevTeamIdRef = useRef(activeTeamId);

  // Build nodes — positions are stable, data updates flow to node components
  const targetNodes = useMemo(() => {
    const saved = positionsRef.current;
    const roleLayout = loadRoleLayout(activeTeamId);
    const runningCount = agents.filter((a) => a.status === 'running').length;

    const rootPosition = saved[ROOT_ID] || roleLayout[ROOT_ID] || { x: 0, y: 0 };
    const nodes = [
      {
        id: ROOT_ID,
        type: 'rootNode',
        position: rootPosition,
        data: { agentCount: agents.length, runningCount },
        draggable: true,
        selectable: false,
      },
    ];

    const occupied = new Set();
    const posKey = (x, y) => `${Math.round(x / 100)},${Math.round(y / 100)}`;

    occupied.add(posKey(rootPosition.x, rootPosition.y));

    const pending = [];
    agents.forEach((agent) => {
      const key = agent.name || agent.id;
      if (saved[key]) {
        const pos = saved[key];
        occupied.add(posKey(pos.x, pos.y));
        nodes.push({
          id: agent.id, type: 'agentNode', position: pos,
          data: { agent, timeline: tokenTimeline[agent.id] || [] },
          draggable: true, selectable: true,
        });
      } else {
        pending.push(agent);
      }
    });

    const roleCounts = new Map();
    pending.forEach((agent, idx) => {
      const role = agent.role || 'agent';
      const count = roleCounts.get(role) || 0;
      roleCounts.set(role, count + 1);
      const roleKey = count === 0 ? role : `${role}-${count}`;

      let pos;
      if (roleLayout[roleKey]) {
        pos = { ...roleLayout[roleKey] };
      } else {
        const row = Math.floor(idx / MAX_PER_ROW);
        const col = idx % MAX_PER_ROW;
        const totalInRow = Math.min(pending.length - row * MAX_PER_ROW, MAX_PER_ROW);
        const offsetX = -((totalInRow - 1) * NODE_X_GAP) / 2;
        pos = { x: offsetX + col * NODE_X_GAP, y: NODE_Y_GAP + row * NODE_Y_GAP };
      }

      while (occupied.has(posKey(pos.x, pos.y))) {
        pos = { x: pos.x, y: pos.y + NODE_Y_GAP };
      }
      occupied.add(posKey(pos.x, pos.y));

      const key = agent.name || agent.id;
      nodes.push({
        id: agent.id, type: 'agentNode', position: pos,
        data: { agent, timeline: tokenTimeline[agent.id] || [] },
        draggable: true, selectable: true,
      });
    });

    return nodes;
  }, [agents, tokenTimeline, activeTeamId]);

  // Auto-save positions for newly placed nodes to positionsRef + localStorage
  useEffect(() => {
    const newPositions = {};
    targetNodes.forEach((n) => {
      const key = n.id === ROOT_ID ? ROOT_ID : (n.data?.agent?.name || n.id);
      if (!positionsRef.current[key]) {
        newPositions[key] = n.position;
      }
    });
    if (Object.keys(newPositions).length > 0) {
      Object.assign(positionsRef.current, newPositions);
      savePositions(activeTeamId, positionsRef.current);
    }
  }, [targetNodes, activeTeamId]);

  // Build edges — compute closest handle based on saved node positions
  const targetEdges = useMemo(() => {
    const saved = loadPositions(activeTeamId);
    const rootPos = saved[ROOT_ID] || { x: 0, y: 0 };

    return agents.map((agent, i) => {
      const key = agent.name || agent.id;
      const row = Math.floor(i / MAX_PER_ROW);
      const col = i % MAX_PER_ROW;
      const totalInRow = Math.min(agents.length - row * MAX_PER_ROW, MAX_PER_ROW);
      const offsetX = -((totalInRow - 1) * NODE_X_GAP) / 2;
      const agentPos = saved[key] || { x: offsetX + col * NODE_X_GAP, y: 140 + row * NODE_Y_GAP };

      const dx = agentPos.x + NODE_W / 2 - rootPos.x;
      const dy = agentPos.y + NODE_H / 2 - rootPos.y;
      let sourceHandle, targetHandle;
      if (Math.abs(dy) > Math.abs(dx)) {
        sourceHandle = dy > 0 ? 'bottom' : 'top';
        targetHandle = dy > 0 ? 'top' : 'bottom';
      } else {
        sourceHandle = dx > 0 ? 'right' : 'left';
        targetHandle = dx > 0 ? 'left' : 'right';
      }

      return {
        id: `e-${ROOT_ID}-${agent.id}`,
        source: ROOT_ID,
        target: agent.id,
        sourceHandle,
        targetHandle,
        type: 'default',
        animated: agent.status === 'running',
      };
    });
  }, [agents, activeTeamId]);

  const [nodes, setNodes, onNodesChange] = useNodesState(targetNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(targetEdges);
  const prevAgentIds = useRef(new Set());

  // Update node DATA without replacing positions (prevents fly-in)
  useEffect(() => {
    setNodes((current) => {
      const currentMap = new Map(current.map((n) => [n.id, n]));

      return targetNodes.map((tn) => {
        const existing = currentMap.get(tn.id);
        if (existing) {
          return { ...existing, data: tn.data };
        }
        return tn;
      });
    });
  }, [targetNodes, setNodes]);

  // Recalculate edge handles from actual node positions (not saved positions)
  // Runs after nodes settle — handles always match where nodes actually are
  useEffect(() => {
    setEdges(() => {
      const rootNode = nodes.find((n) => n.id === ROOT_ID);
      if (!rootNode) return targetEdges;
      const rootPos = rootNode.position;

      return targetEdges.map((edge) => {
        const agentNode = nodes.find((n) => n.id === edge.target);
        if (!agentNode) return edge;

        const dx = agentNode.position.x + NODE_W / 2 - rootPos.x;
        const dy = agentNode.position.y + NODE_H / 2 - rootPos.y;
        let sourceHandle, targetHandle;
        if (Math.abs(dy) > Math.abs(dx)) {
          sourceHandle = dy > 0 ? 'bottom' : 'top';
          targetHandle = dy > 0 ? 'top' : 'bottom';
        } else {
          sourceHandle = dx > 0 ? 'right' : 'left';
          targetHandle = dx > 0 ? 'left' : 'right';
        }
        return { ...edge, sourceHandle, targetHandle };
      });
    });
  }, [targetEdges, nodes, setEdges]);

  const agentIdStr = agents.map((a) => a.id).join(',');
  const fitTimer = useRef(null);
  useEffect(() => {
    // Team switch — restore saved viewport instead of fitting
    if (prevTeamIdRef.current !== activeTeamId) {
      prevTeamIdRef.current = activeTeamId;
      prevAgentIds.current = new Set(agents.map((a) => a.id));
      setPrevCount(agents.length);
      const saved = loadTeamViewports()[activeTeamId];
      if (saved) {
        setViewport(saved, { duration: 200 });
      } else if (agents.length > 0) {
        fitView({ padding: 0.3, maxZoom: 1.2, duration: 200 });
      }
      return;
    }

    const currentIds = new Set(agents.map((a) => a.id));
    const isNewAgent = agents.length > 0 && [...currentIds].some((id) => !prevAgentIds.current.has(id));
    prevAgentIds.current = currentIds;

    if (prevCount === 0 && agents.length > 0) {
      fitView({ padding: 0.3, maxZoom: 1.2, duration: 0 });
    } else if (isNewAgent) {
      clearTimeout(fitTimer.current);
      fitTimer.current = setTimeout(() => fitView({ padding: 0.3, maxZoom: 1.2, duration: 300 }), 500);
    }
    setPrevCount(agents.length);
  }, [agentIdStr, prevCount, fitView, activeTeamId, setViewport]); // eslint-disable-line react-hooks/exhaustive-deps

  const onMoveEnd = useCallback((_e, viewport) => {
    saveTeamViewport(activeTeamId, viewport);
  }, [activeTeamId]);

  const onNodeClick = useCallback((_e, node) => {
    if (node.id === ROOT_ID) return;
    selectAgent(node.id);
  }, [selectAgent]);

  const onPaneClick = useCallback(() => {
    closeDetail();
  }, [closeDetail]);

  const onNodeDrag = useCallback((_e, node) => {
    const rootNode = nodes.find((n) => n.id === ROOT_ID);
    if (!rootNode) return;
    const rootPos = rootNode.position;

    setEdges((eds) => eds.map((edge) => {
      const isSource = edge.source === node.id;
      const isTarget = edge.target === node.id;
      if (!isSource && !isTarget) return edge;

      const agentPos = node.position;
      const dx = agentPos.x + NODE_W / 2 - rootPos.x;
      const dy = agentPos.y + NODE_H / 2 - rootPos.y;
      let sourceHandle, targetHandle;
      if (Math.abs(dy) > Math.abs(dx)) {
        sourceHandle = dy > 0 ? 'bottom' : 'top';
        targetHandle = dy > 0 ? 'top' : 'bottom';
      } else {
        sourceHandle = dx > 0 ? 'right' : 'left';
        targetHandle = dx > 0 ? 'left' : 'right';
      }
      return { ...edge, sourceHandle, targetHandle };
    }));
  }, [nodes, setEdges]);

  const onNodeDragStop = useCallback((_e, node) => {
    const key = node.id === ROOT_ID ? ROOT_ID : (node.data?.agent?.name || node.id);
    positionsRef.current[key] = node.position;
    const saved = loadPositions(activeTeamId);
    saved[key] = node.position;
    savePositions(activeTeamId, saved);
  }, [activeTeamId]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={NODE_TYPES}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={onNodeClick}
      onPaneClick={onPaneClick}
      onNodeDrag={onNodeDrag}
      onNodeDragStop={onNodeDragStop}
      onMoveEnd={onMoveEnd}
      defaultViewport={{ x: 0, y: 0, zoom: 1.2 }}
      proOptions={{ hideAttribution: true }}
      minZoom={0.2}
      maxZoom={1.5}
      className="bg-surface-2"
    >
      <Background color="rgba(97,175,239,0.03)" gap={24} size={1} />
    </ReactFlow>
  );
}

/* ── Provider Config Helpers ──────────────────────────────── */

const PROVIDER_TEMP_SUPPORT = new Set(['codex', 'grok', 'local']);
const PROVIDER_VERBOSITY_SUPPORT = new Set(['codex']);

/* ── Planner Config Dialog ───────────────────────────────── */

function PlannerConfigDialog({ open, onOpenChange, onLaunch }) {
  const fetchProviders = useGrooveStore((s) => s.fetchProviders);
  const [providers, setProviders] = useState([]);
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [reasoningEffort, setReasoningEffort] = useState(50);
  const [temperature, setTemperature] = useState(0.5);
  const [verbosity, setVerbosity] = useState(50);

  useEffect(() => {
    if (!open) return;
    fetchProviders().then((list) => {
      if (!Array.isArray(list)) return;
      const installed = list.filter((p) => p.installed);
      setProviders(installed);
      if (!provider && installed.length > 0) {
        const def = installed.find((p) => p.isDefault) || installed[0];
        setProvider(def.id);
        const models = def.models?.filter((m) => m.type !== 'image') || [];
        if (models.length > 0) setModel(models[0].id);
      }
    }).catch(() => {});
  }, [open]);

  const selectedProvider = providers.find((p) => p.id === provider);
  const models = (selectedProvider?.models || []).filter((m) => m.type !== 'image' && !m.disabled);
  const showTemp = PROVIDER_TEMP_SUPPORT.has(provider);
  const showVerbosity = PROVIDER_VERBOSITY_SUPPORT.has(provider);

  function handleProviderChange(id) {
    setProvider(id);
    const p = providers.find((x) => x.id === id);
    const pModels = (p?.models || []).filter((m) => m.type !== 'image' && !m.disabled);
    setModel(pModels[0]?.id || '');
  }

  function handleLaunch() {
    const config = {
      provider, model, reasoningEffort,
      ...(showTemp && { temperature }),
      ...(showVerbosity && { verbosity }),
    };
    useGrooveStore.setState({ teamLaunchConfig: config });
    onLaunch(config);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Configure Planner" description="Set provider, model, and tuning before launching the planner">
        <div className="px-5 py-4 space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-text-2 font-sans">Provider</label>
            <Select value={provider} onValueChange={handleProviderChange}>
              <SelectTrigger placeholder="Select provider" className="bg-surface-3" />
              <SelectContent>
                {providers.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.displayName || p.name || p.id}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-text-2 font-sans">Model</label>
            <Select value={model} onValueChange={setModel}>
              <SelectTrigger placeholder="Select model" className="bg-surface-3" />
              <SelectContent>
                <SelectItem value="auto">Auto</SelectItem>
                {models.map((m) => (
                  <SelectItem key={m.id} value={m.id}>{m.name || m.id}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1 pt-1">
            <TuningSlider
              label="Reasoning Effort"
              value={reasoningEffort}
              onChange={setReasoningEffort}
              min={0} max={100} step={1}
            />
            {showTemp && (
              <TuningSlider
                label="Temperature"
                value={temperature}
                onChange={setTemperature}
                min={0} max={1} step={0.01}
                formatValue={(v) => v.toFixed(2)}
              />
            )}
            {showVerbosity && (
              <TuningSlider
                label="Verbosity"
                value={verbosity}
                onChange={setVerbosity}
                min={0} max={100} step={1}
              />
            )}
          </div>
        </div>

        <div className="px-5 py-4 border-t border-border-subtle">
          <Button variant="primary" size="md" onClick={handleLaunch} className="w-full gap-2">
            <Zap size={14} />
            Launch Planner
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── Team Builder ────────────────────────────────────────────── */

const TB_ROLE_ICONS = {
  chat: MessageCircle, planner: Rocket, backend: Server, frontend: Monitor,
  fullstack: Code2, testing: TestTube, devops: Cloud, docs: FileText,
  security: Shield, database: Database, cmo: Megaphone, cfo: Calculator,
  ea: UserCheck, support: Headphones, analyst: BarChart3, creative: Pen,
  slides: Presentation, ambassador: Globe,
};

const TB_ROLES = [
  { id: 'planner', label: 'Planner', desc: 'Analyzes tasks and designs team plans' },
  { id: 'frontend', label: 'Frontend', desc: 'React, UI components, views, styling' },
  { id: 'backend', label: 'Backend', desc: 'APIs, server logic, database, services' },
  { id: 'fullstack', label: 'Fullstack', desc: 'Cross-stack work, QC, integration testing' },
  { id: 'testing', label: 'Testing', desc: 'Test suites, coverage, quality assurance' },
  { id: 'devops', label: 'DevOps', desc: 'CI/CD, deployment, infrastructure' },
  { id: 'security', label: 'Security', desc: 'Security audits, vulnerability analysis' },
  { id: 'database', label: 'Database', desc: 'Schema design, queries, migrations' },
  { id: 'docs', label: 'Docs', desc: 'Documentation, guides, API docs' },
  { id: 'cmo', label: 'CMO', desc: 'Marketing strategy, campaigns, content' },
  { id: 'cfo', label: 'CFO', desc: 'Financial analysis, budgeting, forecasting' },
  { id: 'ea', label: 'EA', desc: 'Executive assistance, coordination, briefings' },
  { id: 'support', label: 'Support', desc: 'Customer support, issue triage' },
  { id: 'analyst', label: 'Analyst', desc: 'Data analysis, research, reporting' },
  { id: 'creative', label: 'Writer', desc: 'Design, copywriting, visual assets' },
  { id: 'slides', label: 'Slides', desc: 'Presentations, decks, pitch materials' },
];

const BUILT_IN_TEMPLATES = [
  { name: 'Dev Team', icon: Code2, roles: ['frontend', 'backend', 'testing'], desc: '3 agents' },
  { name: 'Full Stack', icon: Layers, roles: ['frontend', 'backend', 'fullstack', 'testing', 'devops'], desc: '5 agents' },
  { name: 'Marketing', icon: Megaphone, roles: ['cmo', 'creative', 'analyst'], desc: '3 agents' },
  { name: 'Business', icon: BarChart3, roles: ['cfo', 'analyst', 'ea'], desc: '3 agents' },
  { name: 'Security Audit', icon: Shield, roles: ['security', 'testing', 'devops'], desc: '3 agents' },
  { name: 'Docs', icon: FileText, roles: ['docs', 'frontend', 'analyst'], desc: '3 agents' },
];

function TeamBuilder() {
  const open = useGrooveStore((s) => s.teamBuilderOpen);
  const roles = useGrooveStore((s) => s.teamBuilderRoles);
  const settings = useGrooveStore((s) => s.teamBuilderSettings);
  const task = useGrooveStore((s) => s.teamBuilderTask);
  const templates = useGrooveStore((s) => s.teamTemplates);
  const closeTeamBuilder = useGrooveStore((s) => s.closeTeamBuilder);
  const addRole = useGrooveStore((s) => s.addTeamBuilderRole);
  const removeRole = useGrooveStore((s) => s.removeTeamBuilderRole);
  const updateRole = useGrooveStore((s) => s.updateTeamBuilderRole);
  const applyTemplate = useGrooveStore((s) => s.applyTemplate);
  const setSettings = useGrooveStore((s) => s.setTeamBuilderSettings);
  const setTask = useGrooveStore((s) => s.setTeamBuilderTask);
  const launchTeamBuilder = useGrooveStore((s) => s.launchTeamBuilder);
  const saveTeamTemplate = useGrooveStore((s) => s.saveTeamTemplate);
  const fetchTeamTemplates = useGrooveStore((s) => s.fetchTeamTemplates);
  const fetchProviders = useGrooveStore((s) => s.fetchProviders);

  const [providers, setProviders] = useState([]);
  const [search, setSearch] = useState('');
  const [expandedIdx, setExpandedIdx] = useState(null);
  const [launching, setLaunching] = useState(false);
  const [activeTemplate, setActiveTemplate] = useState(null);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [templateName, setTemplateName] = useState('');

  useEffect(() => {
    if (!open) return;
    fetchProviders().then((list) => {
      if (Array.isArray(list)) setProviders(list.filter((p) => p.installed));
    }).catch(() => {});
    fetchTeamTemplates();
  }, [open]);

  if (!open) return null;

  const filteredRoles = search
    ? TB_ROLES.filter((r) => r.label.toLowerCase().includes(search.toLowerCase()) || r.desc.toLowerCase().includes(search.toLowerCase()))
    : TB_ROLES;

  const selectedProvider = providers.find((p) => p.id === settings.provider);
  const settingsModels = (selectedProvider?.models || []).filter((m) => m.type !== 'image' && !m.disabled);
  function handleSettingsProviderChange(id) {
    setSettings({ provider: id });
    const p = providers.find((x) => x.id === id);
    const pModels = (p?.models || []).filter((m) => m.type !== 'image' && !m.disabled);
    setSettings({ provider: id, model: pModels[0]?.id || '' });
  }

  function handleApplyTemplate(tmpl) {
    applyTemplate(tmpl);
    setActiveTemplate(tmpl.name);
  }

  async function handleLaunch() {
    setLaunching(true);
    try {
      await launchTeamBuilder();
    } catch { /* toast handles */ }
    setLaunching(false);
  }

  function handleSaveTemplate() {
    const name = templateName.trim();
    if (!name) return;
    saveTeamTemplate(name);
    setSaveDialogOpen(false);
    setTemplateName('');
  }

  const allTemplates = [...BUILT_IN_TEMPLATES, ...(templates.custom || []).map((t) => ({
    ...t, icon: Layers, desc: `${t.roles?.length || 0} agents`, custom: true,
  }))];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-5xl max-h-[90vh] bg-surface-1 border border-border rounded-xl shadow-2xl flex flex-col overflow-hidden">
        {/* Top Bar */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-info/15 flex items-center justify-center">
              <Users size={16} className="text-info" />
            </div>
            <h2 className="text-lg font-bold text-text-0 font-sans">Team Builder</h2>
          </div>
          <button onClick={closeTeamBuilder} className="p-2 rounded-md text-text-3 hover:text-text-0 hover:bg-surface-3 transition-colors cursor-pointer">
            <X size={18} />
          </button>
        </div>

        {/* Templates Row */}
        <div className="px-6 py-3 border-b border-border-subtle">
          <div className="flex items-center gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
            {allTemplates.map((tmpl) => {
              const TIcon = tmpl.icon || Layers;
              const isActive = activeTemplate === tmpl.name;
              return (
                <button
                  key={tmpl.name}
                  onClick={() => handleApplyTemplate(tmpl)}
                  className={cn(
                    'flex flex-col items-center gap-1.5 px-4 py-2.5 rounded-lg border text-center transition-all cursor-pointer flex-shrink-0 min-w-[100px]',
                    isActive
                      ? 'border-accent bg-accent/5'
                      : 'border-border-subtle bg-surface-3 hover:border-accent/30 hover:bg-surface-4',
                  )}
                >
                  <TIcon size={16} className={isActive ? 'text-accent' : 'text-text-2'} />
                  <span className="text-2xs font-semibold text-text-0 font-sans">{tmpl.name}</span>
                  <span className="text-2xs text-text-4 font-sans">{tmpl.desc}</span>
                </button>
              );
            })}
            <Tooltip content="Save current roster as template">
              <button
                onClick={() => { setSaveDialogOpen(true); setTemplateName(''); }}
                disabled={roles.length === 0}
                className="flex flex-col items-center gap-1.5 px-4 py-2.5 rounded-lg border border-dashed border-border-subtle bg-surface-2 hover:border-accent/30 transition-all cursor-pointer flex-shrink-0 min-w-[100px] disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <Save size={16} className="text-text-3" />
                <span className="text-2xs font-semibold text-text-2 font-sans">Save</span>
                <span className="text-2xs text-text-4 font-sans">Template</span>
              </button>
            </Tooltip>
          </div>
        </div>

        {/* Main Area */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Left: Available Roles */}
          <div className="w-[40%] border-r border-border-subtle flex flex-col">
            <div className="px-4 py-3 border-b border-border-subtle">
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-4" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Filter roles..."
                  className="w-full h-8 pl-8 pr-3 text-xs bg-surface-3 border border-border-subtle rounded-md text-text-0 placeholder:text-text-4 focus:outline-none focus:ring-1 focus:ring-accent font-sans"
                />
              </div>
            </div>
            <ScrollArea className="flex-1">
              <div className="p-3 grid grid-cols-2 gap-2">
                {filteredRoles.map((r) => {
                  const RIcon = TB_ROLE_ICONS[r.id] || Code2;
                  return (
                    <button
                      key={r.id}
                      onClick={() => addRole(r.id)}
                      className="flex items-start gap-2.5 p-2.5 rounded-lg border border-border-subtle bg-surface-2 hover:border-accent/30 hover:bg-surface-3 transition-all cursor-pointer text-left group"
                    >
                      <div className="w-7 h-7 rounded-md bg-surface-4 flex items-center justify-center flex-shrink-0 group-hover:bg-accent/15 transition-colors">
                        <RIcon size={14} className="text-text-2 group-hover:text-accent transition-colors" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-text-0 font-sans">{r.label}</span>
                          <Plus size={12} className="text-text-4 group-hover:text-accent transition-colors flex-shrink-0" />
                        </div>
                        <p className="text-2xs text-text-3 font-sans leading-tight mt-0.5">{r.desc}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </ScrollArea>
          </div>

          {/* Right: Your Team */}
          <div className="flex-1 flex flex-col">
            <div className="px-4 py-3 border-b border-border-subtle flex items-center justify-between">
              <span className="text-xs font-semibold text-text-1 font-sans uppercase tracking-wider">Your Team ({roles.length})</span>
            </div>
            <ScrollArea className="flex-1">
              <div className="p-3 space-y-1.5">
                {roles.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <Users size={32} className="text-text-4 mb-3" />
                    <p className="text-sm text-text-2 font-sans">Add roles from the left or pick a template above</p>
                  </div>
                ) : roles.map((r, i) => {
                  const RIcon = TB_ROLE_ICONS[r.role] || Code2;
                  const expanded = expandedIdx === i;
                  const roleProvider = r.provider ? providers.find((p) => p.id === r.provider) : null;
                  const roleModels = (roleProvider?.models || []).filter((m) => m.type !== 'image' && !m.disabled);
                  return (
                    <div key={i} className="rounded-lg border border-border-subtle bg-surface-2 overflow-hidden">
                      <div className="flex items-center gap-2 px-3 py-2">
                        <GripVertical size={12} className="text-text-4 flex-shrink-0 cursor-grab" />
                        <div className="w-6 h-6 rounded-md bg-surface-4 flex items-center justify-center flex-shrink-0">
                          <RIcon size={12} className="text-text-1" />
                        </div>
                        <span className="text-xs font-semibold text-text-0 font-sans flex-1">{TB_ROLES.find((x) => x.id === r.role)?.label || r.role}</span>
                        <button
                          onClick={() => setExpandedIdx(expanded ? null : i)}
                          className="p-1 rounded text-text-4 hover:text-text-1 cursor-pointer"
                        >
                          <ChevronDown size={12} className={cn('transition-transform duration-200', expanded && 'rotate-180')} />
                        </button>
                        <button
                          onClick={() => { removeRole(i); if (expandedIdx === i) setExpandedIdx(null); else if (expandedIdx > i) setExpandedIdx(expandedIdx - 1); }}
                          className="p-1 rounded text-text-4 hover:text-danger cursor-pointer"
                        >
                          <X size={12} />
                        </button>
                      </div>
                      {expanded && (
                        <div className="px-3 pb-3 pt-1 space-y-3 border-t border-border-subtle bg-surface-1">
                          <div className="space-y-1">
                            <label className="text-2xs text-text-3 font-sans">Name Override</label>
                            <input
                              type="text"
                              value={r.name}
                              onChange={(e) => updateRole(i, { name: sanitizeName(e.target.value) })}
                              placeholder={r.role}
                              className="w-full h-7 px-2.5 text-xs bg-surface-3 border border-border-subtle rounded-md text-text-0 font-mono placeholder:text-text-4 focus:outline-none focus:ring-1 focus:ring-accent"
                              maxLength={64}
                              spellCheck={false}
                            />
                          </div>
                          <div className="flex gap-2">
                            <div className="flex-1 space-y-1">
                              <label className="text-2xs text-text-3 font-sans">Provider</label>
                              <Select value={r.provider || '__default__'} onValueChange={(v) => {
                                const pv = v === '__default__' ? null : v;
                                const p = providers.find((x) => x.id === pv);
                                const pModels = (p?.models || []).filter((m) => m.type !== 'image' && !m.disabled);
                                updateRole(i, { provider: pv, model: pModels[0]?.id || null });
                              }}>
                                <SelectTrigger placeholder="Team Default" className="bg-surface-3 h-7 text-xs" />
                                <SelectContent>
                                  <SelectItem value="__default__">Team Default</SelectItem>
                                  {providers.map((p) => (
                                    <SelectItem key={p.id} value={p.id}>{p.displayName || p.name || p.id}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="flex-1 space-y-1">
                              <label className="text-2xs text-text-3 font-sans">Model</label>
                              <Select value={r.model || '__default__'} onValueChange={(v) => updateRole(i, { model: v === '__default__' ? null : v })}>
                                <SelectTrigger placeholder="Default" className="bg-surface-3 h-7 text-xs" />
                                <SelectContent>
                                  <SelectItem value="__default__">Default</SelectItem>
                                  {roleModels.map((m) => (
                                    <SelectItem key={m.id} value={m.id}>{m.name || m.id}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                          <TuningSlider
                            label="Reasoning"
                            value={r.reasoningEffort ?? settings.reasoningEffort}
                            onChange={(v) => updateRole(i, { reasoningEffort: v })}
                            min={0} max={100} step={1}
                          />
                          {PROVIDER_TEMP_SUPPORT.has(r.provider || settings.provider) && (
                            <TuningSlider
                              label="Temperature"
                              value={r.temperature ?? settings.temperature}
                              onChange={(v) => updateRole(i, { temperature: v })}
                              min={0} max={1} step={0.01}
                              formatValue={(v) => v.toFixed(2)}
                            />
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="border-t border-border-subtle px-6 py-4">
          <div className="flex gap-4">
            {/* Task */}
            <div className="flex-1 space-y-1.5">
              <textarea
                value={task}
                onChange={(e) => setTask(e.target.value)}
                placeholder="Describe what you want to build... (optional)"
                rows={3}
                className="w-full px-3 py-2 text-sm bg-surface-3 border border-border-subtle rounded-md text-text-0 font-sans placeholder:text-text-4 focus:outline-none focus:ring-1 focus:ring-accent resize-none"
              />
              <p className="text-2xs text-text-4 font-sans italic">Leave empty to spawn agents awaiting instructions</p>
            </div>

            {/* Team Settings + Launch */}
            <div className="w-64 flex flex-col gap-2">
              <div className="flex gap-2">
                <div className="flex-1 space-y-0.5">
                  <label className="text-2xs text-text-3 font-sans">Provider</label>
                  <Select value={settings.provider || '__default__'} onValueChange={(v) => handleSettingsProviderChange(v === '__default__' ? '' : v)}>
                    <SelectTrigger placeholder="Default" className="bg-surface-3 h-7 text-xs" />
                    <SelectContent>
                      <SelectItem value="__default__">Default</SelectItem>
                      {providers.map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.displayName || p.name || p.id}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex-1 space-y-0.5">
                  <label className="text-2xs text-text-3 font-sans">Model</label>
                  <Select value={settings.model || '__default__'} onValueChange={(v) => setSettings({ model: v === '__default__' ? '' : v })}>
                    <SelectTrigger placeholder="Auto" className="bg-surface-3 h-7 text-xs" />
                    <SelectContent>
                      <SelectItem value="__default__">Auto</SelectItem>
                      {settingsModels.map((m) => (
                        <SelectItem key={m.id} value={m.id}>{m.name || m.id}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button
                variant="primary"
                size="md"
                onClick={handleLaunch}
                disabled={launching || roles.length === 0}
                className="w-full gap-2 mt-1"
              >
                <Zap size={14} />
                {launching ? 'Launching...' : `Plan & Launch (${roles.length})`}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Save Template Dialog */}
      {saveDialogOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40">
          <div className="w-full max-w-sm bg-surface-2 border border-border rounded-lg shadow-2xl p-5 space-y-4">
            <h3 className="text-sm font-semibold text-text-0 font-sans">Save as Template</h3>
            <input
              type="text"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              placeholder="Template name..."
              className="w-full h-8 px-3 text-sm bg-surface-3 border border-border-subtle rounded-md text-text-0 font-sans placeholder:text-text-4 focus:outline-none focus:ring-1 focus:ring-accent"
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') handleSaveTemplate(); if (e.key === 'Escape') setSaveDialogOpen(false); }}
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setSaveDialogOpen(false)}>Cancel</Button>
              <Button variant="primary" size="sm" onClick={handleSaveTemplate} disabled={!templateName.trim()}>Save</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Empty State ───────────────────────────────────────────── */

function EmptyState({ onPlanner, onSpawn, onTeamBuilder }) {
  return (
    <div className="w-full h-full flex items-center justify-center">
      <div className="max-w-2xl w-full text-center space-y-10 px-8">
        <div className="relative mx-auto w-20 h-20">
          <div className="absolute inset-0 rounded-full bg-accent/8 animate-pulse" />
          <div className="absolute inset-1 rounded-full bg-surface-3 border border-border-subtle flex items-center justify-center shadow-lg shadow-accent/5">
            <img src="/favicon.png" alt="Groove" className="h-10 w-10 rounded-full" />
          </div>
        </div>

        <div className="space-y-3">
          <h1 className="text-3xl font-bold text-text-0 font-sans tracking-tight">Welcome to Groove</h1>
          <p className="text-base text-text-2 font-sans max-w-md mx-auto leading-relaxed">
            Your mission control for AI agents. Spawn, orchestrate, and ship faster than ever.
          </p>
        </div>

        <div className="space-y-3 max-w-xl mx-auto">
          <button
            onClick={onPlanner}
            className="w-full flex items-center gap-4 p-5 rounded-lg border border-accent/25 bg-gradient-to-r from-accent/8 to-accent/3 hover:from-accent/14 hover:to-accent/6 hover:border-accent/40 transition-all cursor-pointer group text-left"
          >
            <div className="w-12 h-12 rounded-lg bg-accent/20 flex items-center justify-center group-hover:scale-110 transition-transform flex-shrink-0">
              <Zap size={24} className="text-accent" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-base font-semibold text-text-0 font-sans">Start with a Planner</div>
              <div className="text-sm text-text-2 font-sans mt-0.5">Describe what you want to build and let AI plan the perfect team</div>
            </div>
            <div className="text-accent text-xs font-semibold font-sans flex-shrink-0 opacity-60 group-hover:opacity-100 transition-opacity">
              Recommended
            </div>
          </button>

          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={onTeamBuilder}
              className="flex items-center gap-3 p-4 rounded-lg border border-info/25 bg-gradient-to-r from-info/6 to-info/2 hover:from-info/12 hover:to-info/5 hover:border-info/35 transition-all cursor-pointer group text-left"
            >
              <div className="w-10 h-10 rounded-lg bg-info/15 flex items-center justify-center group-hover:scale-110 transition-transform flex-shrink-0">
                <UserPlus size={20} className="text-info" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-text-0 font-sans">Build a Team</div>
                <div className="text-xs text-text-3 font-sans mt-0.5">Pick roles and configure</div>
              </div>
            </button>

            <button
              onClick={onSpawn}
              className="flex items-center gap-3 p-4 rounded-lg border border-border bg-surface-1 hover:bg-surface-2 hover:border-border transition-all cursor-pointer group text-left"
            >
              <div className="w-10 h-10 rounded-lg bg-surface-4 flex items-center justify-center group-hover:scale-110 transition-transform flex-shrink-0">
                <Plus size={20} className="text-text-1" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-text-0 font-sans">Spawn Agent</div>
                <div className="text-xs text-text-3 font-sans mt-0.5">Choose a role and configure</div>
              </div>
            </button>
          </div>
        </div>

        {window.groove?.openFolder && (
          <div className="max-w-sm mx-auto">
            <p className="text-xs text-text-3 mb-2">Or open a different project</p>
            <button
              onClick={() => window.groove.openFolder()}
              className="w-full h-10 rounded-lg border border-border-subtle bg-surface-2 hover:bg-surface-3 text-sm text-text-1 font-medium flex items-center justify-center gap-2 cursor-pointer transition-colors"
            >
              <FolderOpen size={16} className="text-accent" />
              Open Folder
            </button>
          </div>
        )}

        <p className="text-xs text-text-4 font-sans">
          <kbd className="font-mono bg-surface-4 px-1.5 py-0.5 rounded text-text-3">Cmd+K</kbd>
          <span className="mx-1.5">command palette</span>
          <span className="text-text-4 mx-1">&middot;</span>
          <kbd className="font-mono bg-surface-4 px-1.5 py-0.5 rounded text-text-3">Cmd+N</kbd>
          <span className="mx-1.5">spawn</span>
          <span className="text-text-4 mx-1">&middot;</span>
          <kbd className="font-mono bg-surface-4 px-1.5 py-0.5 rounded text-text-3">Cmd+J</kbd>
          <span className="mx-1.5">terminal</span>
        </p>
      </div>
    </div>
  );
}

/* ── Recommended Team Launch Card ─────────────────────────── */

const ROLE_ICONS = { backend: Server, frontend: Monitor, fullstack: Code2, testing: TestTube, security: Shield };

const NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;

function sanitizeName(raw) {
  return raw.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
}

function RecommendedTeamCard() {
  const recommendedTeam = useGrooveStore((s) => s.recommendedTeam);
  const launchRecommendedTeam = useGrooveStore((s) => s.launchRecommendedTeam);
  const teamLaunchConfig = useGrooveStore((s) => s.teamLaunchConfig);
  const fetchProviders = useGrooveStore((s) => s.fetchProviders);
  const [launching, setLaunching] = useState(false);
  const [editedAgents, setEditedAgents] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [providers, setProviders] = useState([]);

  // Team settings — pre-populated from planner spawn config or defaults
  const [tsProvider, setTsProvider] = useState(teamLaunchConfig?.provider || '');
  const [tsModel, setTsModel] = useState(teamLaunchConfig?.model || '');
  const [tsReasoning, setTsReasoning] = useState(teamLaunchConfig?.reasoningEffort ?? 50);
  const [tsTemp, setTsTemp] = useState(teamLaunchConfig?.temperature ?? 0.5);
  const [tsMode, setTsMode] = useState(teamLaunchConfig?.mode || 'sandbox');

  useEffect(() => {
    fetchProviders().then((list) => {
      if (Array.isArray(list)) setProviders(list.filter((p) => p.installed));
    }).catch(() => {});
  }, []);

  if (!recommendedTeam?.agents?.length) return null;

  const agents = recommendedTeam.agents;
  const phase1 = agents.filter((a) => !a.phase || a.phase === 1);
  const phase2 = agents.filter((a) => a.phase === 2);

  const agentEdits = editedAgents ?? phase1.map((a) => ({ ...a, name: a.name || '' }));

  const selectedProvider = providers.find((p) => p.id === tsProvider);
  const tsModels = (selectedProvider?.models || []).filter((m) => m.type !== 'image' && !m.disabled);
  const showTemp = PROVIDER_TEMP_SUPPORT.has(tsProvider);

  function handleNameChange(i, raw) {
    const next = agentEdits.map((a, idx) => idx === i ? { ...a, name: sanitizeName(raw) } : a);
    setEditedAgents(next);
  }

  function handleTsProviderChange(id) {
    setTsProvider(id);
    const p = providers.find((x) => x.id === id);
    const pModels = (p?.models || []).filter((m) => m.type !== 'image' && !m.disabled);
    setTsModel(pModels[0]?.id || '');
  }

  async function handleLaunch() {
    setLaunching(true);
    // Save overrides to store so launchRecommendedTeam sends them
    useGrooveStore.setState({
      teamLaunchConfig: {
        ...(tsProvider && { provider: tsProvider, model: tsModel }),
        reasoningEffort: tsReasoning,
        ...(showTemp && { temperature: tsTemp }),
        mode: tsMode,
      },
    });
    try {
      const modified = [...agentEdits, ...phase2];
      await launchRecommendedTeam(modified);
    } catch { /* toast handles */ }
    setLaunching(false);
  }

  function handleDismiss() {
    useGrooveStore.setState({ recommendedTeam: null });
  }

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-50 w-full max-w-lg">
      <div className="mx-4 rounded-lg border border-accent/30 bg-surface-2/95 backdrop-blur-md shadow-xl shadow-accent/5 overflow-hidden">
        <div className="px-4 py-3 border-b border-border-subtle flex items-center gap-2">
          <Rocket size={16} className="text-accent" />
          <span className="text-sm font-semibold text-text-0 font-sans flex-1">Planner Recommends a Team</span>
          <button onClick={handleDismiss} className="text-text-4 hover:text-text-1 cursor-pointer"><X size={14} /></button>
        </div>

        {/* Collapsible Team Settings */}
        <div className="border-b border-border-subtle">
          <button
            onClick={() => setSettingsOpen(!settingsOpen)}
            className="w-full flex items-center gap-2 px-4 py-2 text-left cursor-pointer hover:bg-surface-3/50 transition-colors"
          >
            <ChevronDown size={12} className={cn('text-text-4 transition-transform duration-200', !settingsOpen && '-rotate-90')} />
            <Settings2 size={12} className="text-text-3" />
            <span className="text-2xs font-semibold text-text-2 font-sans uppercase tracking-wider">Team Settings</span>
            {tsProvider && (
              <span className="ml-auto text-2xs text-accent font-mono">{tsProvider}{tsModel ? ` / ${tsModel}` : ''}</span>
            )}
          </button>
          {settingsOpen && (
            <div className="px-4 pb-3 space-y-3">
              <div className="flex gap-3">
                <div className="flex-1 space-y-1">
                  <label className="text-2xs text-text-3 font-sans">Provider</label>
                  <Select value={tsProvider} onValueChange={handleTsProviderChange}>
                    <SelectTrigger placeholder="Default" className="bg-surface-4 h-7 text-xs" />
                    <SelectContent>
                      {providers.map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.displayName || p.name || p.id}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex-1 space-y-1">
                  <label className="text-2xs text-text-3 font-sans">Model</label>
                  <Select value={tsModel} onValueChange={setTsModel}>
                    <SelectTrigger placeholder="Auto" className="bg-surface-4 h-7 text-xs" />
                    <SelectContent>
                      <SelectItem value="auto">Auto</SelectItem>
                      {tsModels.map((m) => (
                        <SelectItem key={m.id} value={m.id}>{m.name || m.id}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <TuningSlider
                label="Reasoning"
                value={tsReasoning}
                onChange={setTsReasoning}
                min={0} max={100} step={1}
              />
              {showTemp && (
                <TuningSlider
                  label="Temperature"
                  value={tsTemp}
                  onChange={setTsTemp}
                  min={0} max={1} step={0.01}
                  formatValue={(v) => v.toFixed(2)}
                />
              )}
              {/* Build Mode */}
              <div className="space-y-1">
                <label className="text-2xs text-text-3 font-sans">Build Mode</label>
                <div className="flex rounded-md bg-surface-4 border border-border-subtle p-0.5">
                  <button
                    onClick={() => setTsMode('sandbox')}
                    className={cn(
                      'flex-1 flex items-center justify-center gap-1.5 rounded px-2 py-1.5 text-xs font-sans transition-all cursor-pointer',
                      tsMode === 'sandbox'
                        ? 'bg-surface-2 text-text-0 font-semibold shadow-sm'
                        : 'text-text-3 hover:text-text-1',
                    )}
                  >
                    <Box size={11} />
                    Sandbox
                  </button>
                  <button
                    onClick={() => setTsMode('production')}
                    className={cn(
                      'flex-1 flex items-center justify-center gap-1.5 rounded px-2 py-1.5 text-xs font-sans transition-all cursor-pointer',
                      tsMode === 'production'
                        ? 'bg-surface-2 text-text-0 font-semibold shadow-sm'
                        : 'text-text-3 hover:text-text-1',
                    )}
                  >
                    <HardDrive size={11} />
                    Production
                  </button>
                </div>
                <p className="text-2xs text-text-4 font-sans">
                  {tsMode === 'sandbox'
                    ? 'Files live in a team directory, removable with the team'
                    : 'Files live in the project directory, persist forever'}
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="px-4 py-3 space-y-1.5">
          {agentEdits.map((a, i) => {
            const Icon = ROLE_ICONS[a.role] || Code2;
            const nameValid = !a.name || NAME_RE.test(a.name);
            return (
              <div key={i} className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-surface-4 border border-border-subtle">
                <Icon size={12} className="text-text-2 shrink-0" />
                <input
                  type="text"
                  value={a.name}
                  onChange={(e) => handleNameChange(i, e.target.value)}
                  placeholder={a.role}
                  className={cn(
                    'flex-1 min-w-0 bg-transparent text-xs font-mono text-text-0 outline-none placeholder:text-text-4',
                    !nameValid && 'text-red-400',
                  )}
                  maxLength={64}
                  spellCheck={false}
                />
                {a.scope?.length > 0 && (
                  <span className="text-2xs text-text-4 font-mono shrink-0 truncate max-w-[120px]">
                    {a.scope[0]}{a.scope.length > 1 ? ` +${a.scope.length - 1}` : ''}
                  </span>
                )}
              </div>
            );
          })}

          {recommendedTeam.projectDir && tsMode === 'sandbox' && (
            <div className="flex items-center gap-1.5 text-2xs text-text-2 font-mono pt-0.5">
              <span className="text-text-4">Project:</span>
              <span className="text-accent">{recommendedTeam.projectDir}/</span>
            </div>
          )}

          {phase2.length > 0 && (
            <div className="flex items-center gap-1.5 text-2xs text-text-3 font-sans">
              <Shield size={10} />
              <span>{phase2.length} QC agent{phase2.length > 1 ? 's' : ''} will auto-spawn after builders complete</span>
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-border-subtle">
          <Button variant="primary" size="md" onClick={handleLaunch} disabled={launching} className="w-full gap-2">
            <Zap size={14} />
            {launching ? 'Launching...' : `Launch ${phase1.length} Agent${phase1.length > 1 ? 's' : ''}`}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ── Agents View ───────────────────────────────────────────── */

export default function AgentsView() {
  const allAgents = useGrooveStore((s) => s.agents);
  const activeTeamId = useGrooveStore((s) => s.activeTeamId);
  const openDetail = useGrooveStore((s) => s.openDetail);
  const spawnAgent = useGrooveStore((s) => s.spawnAgent);
  const selectAgent = useGrooveStore((s) => s.selectAgent);
  const recommendedTeam = useGrooveStore((s) => s.recommendedTeam);
  const checkRecommendedTeam = useGrooveStore((s) => s.checkRecommendedTeam);
  const addToast = useGrooveStore((s) => s.addToast);
  const showPreviewInAgents = useGrooveStore((s) => s.showPreviewInAgents);
  const previewState = useGrooveStore((s) => s.previewState);
  const togglePreviewInAgents = useGrooveStore((s) => s.togglePreviewInAgents);
  const workspaceMode = useGrooveStore((s) => s.workspaceMode);
  const setWorkspaceMode = useGrooveStore((s) => s.setWorkspaceMode);
  const openTeamBuilder = useGrooveStore((s) => s.openTeamBuilder);

  const [plannerConfigOpen, setPlannerConfigOpen] = useState(false);

  // Poll for recommended team while a planner is running
  useEffect(() => {
    const hasPlanner = allAgents.some((a) => a.role === 'planner' && (a.status === 'running' || a.status === 'starting'));
    if (!hasPlanner) return;
    const interval = setInterval(() => checkRecommendedTeam(), 5000);
    return () => clearInterval(interval);
  }, [allAgents, checkRecommendedTeam]);

  function openPlannerConfig() {
    setPlannerConfigOpen(true);
  }

  async function handlePlannerLaunch(config) {
    setPlannerConfigOpen(false);
    try {
      const agent = await spawnAgent({
        role: 'planner',
        provider: config.provider,
        model: config.model,
        reasoningEffort: config.reasoningEffort,
        temperature: config.temperature,
        verbosity: config.verbosity,
      });
      if (agent?.id) {
        selectAgent(agent.id);
      }
    } catch { /* toast handles */ }
  }

  const teamAgents = allAgents.filter((a) => a.teamId === activeTeamId);
  const hydrated = useGrooveStore((s) => s.hydrated);
  const [showLoader, setShowLoader] = useState(true);

  // Show loader for 1.2s on initial mount, then fade out
  useEffect(() => {
    const timer = setTimeout(() => setShowLoader(false), 1200);
    return () => clearTimeout(timer);
  }, []);

  const isLoading = showLoader || !hydrated;

  return (
    <div className="flex flex-col h-full relative">
      <div className="flex-1 min-h-0">
        {isLoading ? (
          <div className={cn(
            'flex flex-col items-center justify-center h-full transition-opacity duration-500',
            !showLoader && hydrated ? 'opacity-0' : 'opacity-100',
          )}>
            <div className="relative w-12 h-12 mb-5">
              <span className="absolute inset-0 rounded-full border-2 border-accent/20 animate-ping" style={{ animationDuration: '2s' }} />
              <span className="absolute inset-0 rounded-full border-2 border-transparent border-t-accent animate-spin" style={{ animationDuration: '1s' }} />
              <span className="absolute inset-[6px] rounded-full bg-accent/8 flex items-center justify-center">
                <Zap size={16} className="text-accent animate-pulse" />
              </span>
            </div>
            <p className="text-sm font-medium text-text-1 font-sans animate-pulse">Connecting to agents</p>
            <p className="text-xs text-text-3 font-sans mt-1">Syncing with daemon...</p>
          </div>
        ) : teamAgents.length === 0 ? (
          <EmptyState onPlanner={openPlannerConfig} onSpawn={() => openDetail({ type: 'spawn' })} onTeamBuilder={openTeamBuilder} />
        ) : workspaceMode ? (
          <WorkspaceMode />
        ) : showPreviewInAgents && previewState.url && previewState.teamId === activeTeamId ? (
          <PreviewWorkspace embedded />
        ) : (
          <ReactFlowProvider key={activeTeamId}>
            <AgentTreeInner />
          </ReactFlowProvider>
        )}
      </div>
      {!workspaceMode && <RecommendedTeamCard />}
      {!isLoading && teamAgents.length > 0 && !workspaceMode && (
        <button
          onClick={() => openDetail({ type: 'spawn' })}
          className="absolute bottom-4 left-4 z-40 flex items-center gap-1.5 h-8 px-4 rounded-md bg-accent/15 text-accent text-xs font-semibold font-sans hover:bg-accent/25 transition-colors cursor-pointer select-none shadow-lg shadow-black/10"
        >
          <Plus size={14} />
          Spawn
        </button>
      )}
      {!isLoading && teamAgents.length > 0 && !workspaceMode && (
        <button
          onClick={() => {
            const positions = loadPositions(activeTeamId);
            const layout = {};
            const roleCounts = new Map();
            teamAgents.forEach((agent) => {
              const key = agent.name || agent.id;
              const pos = positions[key];
              if (!pos) return;
              const role = agent.role || 'agent';
              const count = roleCounts.get(role) || 0;
              roleCounts.set(role, count + 1);
              const roleKey = count === 0 ? role : `${role}-${count}`;
              layout[roleKey] = pos;
            });
            if (positions[ROOT_ID]) layout[ROOT_ID] = positions[ROOT_ID];
            saveRoleLayout(activeTeamId, layout);
            addToast('success', 'Layout saved', 'Future spawns will use these positions');
          }}
          className="absolute bottom-4 left-28 z-40 flex items-center gap-1.5 h-8 px-4 rounded-md bg-accent/15 text-accent text-xs font-semibold font-sans hover:bg-accent/25 transition-colors cursor-pointer select-none shadow-lg shadow-black/10"
        >
          <LayoutGrid size={14} />
          {Object.keys(loadRoleLayout(activeTeamId)).length > 0 ? 'Update Layout' : 'Save Layout'}
        </button>
      )}
      {!isLoading && teamAgents.length > 0 && !workspaceMode && (
        <button
          onClick={() => setWorkspaceMode(true)}
          className={cn(
            'absolute bottom-4 z-40 flex items-center gap-1.5 h-8 px-4 rounded-md text-xs font-semibold font-sans transition-colors cursor-pointer select-none shadow-lg shadow-black/10',
            previewState.url && previewState.teamId === activeTeamId ? 'right-32' : 'right-4',
            'bg-accent/15 text-accent hover:bg-accent/25',
          )}
        >
          <Code2 size={14} /> Workspace
        </button>
      )}
      {!isLoading && teamAgents.length > 0 && !workspaceMode && previewState.url && previewState.teamId === activeTeamId && (
        <button
          onClick={togglePreviewInAgents}
          className="absolute bottom-4 right-4 z-40 flex items-center gap-1.5 h-8 px-4 rounded-md bg-info/15 text-info text-xs font-semibold font-sans hover:bg-info/25 transition-colors cursor-pointer select-none shadow-lg shadow-black/10"
        >
          {showPreviewInAgents ? <><Users size={14} /> Team</> : <><Eye size={14} /> Preview</>}
        </button>
      )}
      <PlannerConfigDialog open={plannerConfigOpen} onOpenChange={setPlannerConfigOpen} onLaunch={handlePlannerLaunch} />
      <TeamBuilder />
    </div>
  );
}
