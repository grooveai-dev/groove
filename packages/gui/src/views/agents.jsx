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
import { Plus, Users, Zap, X, Check, Rocket, Server, Monitor, Code2, TestTube, Shield, Pencil } from 'lucide-react';

const NODE_TYPES = { agentNode: AgentNode, rootNode: RootNode };
const NODE_W = 220;
const NODE_H = 82;
const NODE_X_GAP = 260;
const NODE_Y_GAP = 130;
const MAX_PER_ROW = 4;
const ROOT_ID = '__groove_root__';

function loadPositions() {
  try { return JSON.parse(localStorage.getItem('groove:nodePositions') || '{}'); } catch { return {}; }
}

function savePositions(positions) {
  try { localStorage.setItem('groove:nodePositions', JSON.stringify(positions)); } catch {}
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
  const deleteTeam = useGrooveStore((s) => s.deleteTeam);
  const renameTeam = useGrooveStore((s) => s.renameTeam);

  const reorderTeams = useGrooveStore((s) => s.reorderTeams);

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const submitting = useRef(false);
  const [dragId, setDragId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);

  function handleCreate() {
    const name = newName.trim();
    if (!name || submitting.current) return;
    submitting.current = true;
    setNewName('');
    setCreating(false);
    createTeam(name).finally(() => { submitting.current = false; });
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
    <div className="flex items-end px-0 pt-0 pb-0 bg-surface-1 border-b border-border gap-0 flex-shrink-0">
      {teams.map((team) => {
        const count = agents.filter((a) => a.teamId === team.id).length;
        const isActive = team.id === activeTeamId;
        const isRenaming = renamingId === team.id;
        const running = agents.filter((a) => a.teamId === team.id && (a.status === 'running' || a.status === 'starting')).length;

        return (
          <div
            key={team.id}
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
              'group relative flex items-center gap-2 px-4 h-9 text-xs font-sans cursor-pointer select-none transition-colors',
              isActive
                ? 'text-text-0 font-semibold border-x border-x-border bg-[#242830]'
                : 'text-text-3 hover:text-text-1 hover:bg-surface-3/50',
              dragId === team.id && 'opacity-40',
              dragOverId === team.id && dragId !== team.id && 'border-l-2 !border-l-accent',
            )}
          >
            {/* Thin accent line at top */}
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

            {/* Agent count badge */}
            {count > 0 && !isRenaming && (
              <span className={cn(
                'flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-2xs font-mono font-semibold',
                running > 0 ? 'bg-accent/15 text-accent' : 'bg-surface-4 text-text-3',
              )}>
                {count}
              </span>
            )}

            {/* Actions — rename + close */}
            {!isRenaming && (
              <div className="flex items-center gap-0.5 ml-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={(e) => { e.stopPropagation(); startRename(team); }}
                  className="p-0.5 rounded hover:bg-surface-5 text-text-4 hover:text-text-1 cursor-pointer"
                  title="Rename team"
                >
                  <Pencil size={10} />
                </button>
                {!team.isDefault && (
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteTeam(team.id); }}
                    className="p-0.5 rounded hover:bg-surface-5 text-text-4 hover:text-danger cursor-pointer"
                    title="Delete team"
                  >
                    <X size={10} />
                  </button>
                )}
              </div>
            )}

            {/* Bottom edge hides the parent border for active tab */}
            {isActive && (
              <div className="absolute bottom-[-1px] left-0 right-0 h-px bg-[#242830]" />
            )}
          </div>
        );
      })}

      {/* Create new team */}
      {creating ? (
        <div className="flex items-center gap-1.5 px-3 h-9 bg-surface-3/50">
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
          className="flex items-center justify-center w-9 h-9 text-text-4 hover:text-text-1 hover:bg-surface-3/50 cursor-pointer transition-colors"
          title="New team"
        >
          <Plus size={14} />
        </button>
      )}
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

  const agents = useMemo(
    () => allAgents.filter((a) => a.teamId === activeTeamId),
    [allAgents, activeTeamId],
  );

  const { fitView, setViewport } = useReactFlow();
  const [prevCount, setPrevCount] = useState(0);
  const prevTeamIdRef = useRef(activeTeamId);

  // Build nodes — positions are stable, data updates flow to node components
  const targetNodes = useMemo(() => {
    const saved = loadPositions();
    const runningCount = agents.filter((a) => a.status === 'running').length;

    const nodes = [
      {
        id: ROOT_ID,
        type: 'rootNode',
        position: saved[ROOT_ID] || { x: 0, y: 0 },
        data: { agentCount: agents.length, runningCount },
        draggable: true,
        selectable: false,
      },
    ];

    // Track occupied positions so new nodes don't overlap existing ones
    const occupied = new Set();
    const posKey = (x, y) => `${Math.round(x / 100)},${Math.round(y / 100)}`;

    // Mark root node position as occupied
    const rootPos = saved[ROOT_ID] || { x: 0, y: 0 };
    occupied.add(posKey(rootPos.x, rootPos.y));

    // First pass: place agents with saved positions
    const pending = [];
    agents.forEach((agent, i) => {
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
        pending.push({ agent, index: i });
      }
    });

    // Second pass: place new agents in non-overlapping positions
    for (const { agent, index } of pending) {
      const row = Math.floor(index / MAX_PER_ROW);
      const col = index % MAX_PER_ROW;
      const totalInRow = Math.min(agents.length - row * MAX_PER_ROW, MAX_PER_ROW);
      const offsetX = -((totalInRow - 1) * NODE_X_GAP) / 2;
      let pos = { x: offsetX + col * NODE_X_GAP, y: NODE_Y_GAP + row * NODE_Y_GAP };

      // If position is occupied, shift down until we find empty space
      while (occupied.has(posKey(pos.x, pos.y))) {
        pos = { x: pos.x, y: pos.y + NODE_Y_GAP };
      }
      occupied.add(posKey(pos.x, pos.y));

      nodes.push({
        id: agent.id, type: 'agentNode', position: pos,
        data: { agent, timeline: tokenTimeline[agent.id] || [] },
        draggable: true, selectable: true,
      });
    }

    return nodes;
  }, [agents, tokenTimeline]);

  // Build edges — compute closest handle based on saved node positions
  const targetEdges = useMemo(() => {
    const saved = loadPositions();
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
  }, [agents]);

  const [nodes, setNodes, onNodesChange] = useNodesState(targetNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(targetEdges);
  const prevAgentIds = useRef(new Set());

  // Update node DATA without replacing positions (prevents fly-in)
  useEffect(() => {
    setNodes((current) => {
      const currentMap = new Map(current.map((n) => [n.id, n]));
      const newIds = new Set(targetNodes.map((n) => n.id));

      return targetNodes.map((tn) => {
        const existing = currentMap.get(tn.id);
        if (existing) {
          // Preserve existing position, update data only
          return { ...existing, data: tn.data };
        }
        // New node — use calculated position
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
    const agent = agents.find((a) => a.id === node.id);
    // Save by agent name (stable across resumes/rotations) instead of ID (changes each session)
    const key = node.id === ROOT_ID ? ROOT_ID : (agent?.name || node.id);
    const saved = loadPositions();
    saved[key] = node.position;
    savePositions(saved);
  }, [agents]);

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

/* ── Empty State ───────────────────────────────────────────── */

function EmptyState({ onPlanner, onSpawn }) {
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

          <button
            onClick={onSpawn}
            className="w-full flex items-center gap-3 p-4 rounded-lg border border-border bg-surface-1 hover:bg-surface-2 hover:border-border transition-all cursor-pointer group text-left"
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
  const [launching, setLaunching] = useState(false);
  const [editedAgents, setEditedAgents] = useState(null);

  if (!recommendedTeam?.agents?.length) return null;

  const agents = recommendedTeam.agents;
  const phase1 = agents.filter((a) => !a.phase || a.phase === 1);
  const phase2 = agents.filter((a) => a.phase === 2);

  // Initialize edits lazily so we get fresh data if recommendedTeam changes
  const agentEdits = editedAgents ?? phase1.map((a) => ({ ...a, name: a.name || '' }));

  function handleNameChange(i, raw) {
    const next = agentEdits.map((a, idx) => idx === i ? { ...a, name: sanitizeName(raw) } : a);
    setEditedAgents(next);
  }

  async function handleLaunch() {
    setLaunching(true);
    try {
      // Merge edited phase1 names back with phase2 agents
      const modified = [
        ...agentEdits,
        ...phase2,
      ];
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

        <div className="px-4 py-3 space-y-1.5">
          {/* Phase 1 agents — editable rows */}
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

          {/* Project dir indicator */}
          {recommendedTeam.projectDir && (
            <div className="flex items-center gap-1.5 text-2xs text-text-2 font-mono pt-0.5">
              <span className="text-text-4">Project:</span>
              <span className="text-accent">{recommendedTeam.projectDir}/</span>
            </div>
          )}

          {/* Phase 2 indicator */}
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

  // Poll for recommended team while a planner is running
  useEffect(() => {
    const hasPlanner = allAgents.some((a) => a.role === 'planner' && (a.status === 'running' || a.status === 'starting'));
    if (!hasPlanner) return;
    const interval = setInterval(() => checkRecommendedTeam(), 5000);
    return () => clearInterval(interval);
  }, [allAgents, checkRecommendedTeam]);

  async function launchPlanner() {
    try {
      const agent = await spawnAgent({ role: 'planner' });
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
          <EmptyState onPlanner={launchPlanner} onSpawn={() => openDetail({ type: 'spawn' })} />
        ) : (
          <ReactFlowProvider>
            <AgentTreeInner />
          </ReactFlowProvider>
        )}
      </div>
      <RecommendedTeamCard />
    </div>
  );
}
