// GROOVE GUI — Agent Tree View (React Flow)
// FSL-1.1-Apache-2.0 — see LICENSE

import React, { useMemo, useCallback, useEffect, useRef, useState } from 'react';
import { ReactFlow, Background, useReactFlow, ReactFlowProvider, applyNodeChanges } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useGrooveStore } from '../stores/groove';
import AgentNode from '../components/AgentNode';

import { Handle, Position } from '@xyflow/react';

function GrooveRootNode({ data }) {
  return (
    <div style={data.style}>
      {data.label}
      <Handle id="s-top" type="source" position={Position.Top} style={{ opacity: 0, width: 1, height: 1 }} />
      <Handle id="s-bottom" type="source" position={Position.Bottom} style={{ opacity: 0, width: 1, height: 1 }} />
      <Handle id="s-left" type="source" position={Position.Left} style={{ opacity: 0, width: 1, height: 1 }} />
      <Handle id="s-right" type="source" position={Position.Right} style={{ opacity: 0, width: 1, height: 1 }} />
    </div>
  );
}

const nodeTypes = { agent: AgentNode, grooveRoot: GrooveRootNode };

const MAX_PER_ROW = 4;
const NODE_X_SPACING = 250;
const NODE_Y_SPACING = 140;

function AgentTreeInner() {
  const agents = useGrooveStore((s) => s.agents);
  const detailPanel = useGrooveStore((s) => s.detailPanel);
  const selectAgent = useGrooveStore((s) => s.selectAgent);
  const clearSelection = useGrooveStore((s) => s.clearSelection);
  const { fitView } = useReactFlow();

  const selectedAgentId = detailPanel?.type === 'agent' ? detailPanel.agentId : null;
  const prevCountRef = useRef(0);
  // Position map keyed by agent NAME — persisted to localStorage
  const positionMapRef = useRef(() => {
    try { return JSON.parse(localStorage.getItem('groove:nodePositions') || '{}'); } catch { return {}; }
  });
  // Lazy init the ref
  if (typeof positionMapRef.current === 'function') positionMapRef.current = positionMapRef.current();
  const nextSlotRef = useRef(Object.keys(positionMapRef.current).length);
  const [flowNodes, setFlowNodes] = useState([]);

  // Compute target nodes + edges from agent state
  const { targetNodes } = useMemo(() => {
    const allAgentNodes = agents.map((agent) => {
      const posKey = agent.name || agent.id;
      if (!positionMapRef.current[posKey]) {
        const slot = nextSlotRef.current;
        positionMapRef.current[posKey] = {
          x: (slot % MAX_PER_ROW) * NODE_X_SPACING,
          y: 160 + Math.floor(slot / MAX_PER_ROW) * NODE_Y_SPACING,
        };
        nextSlotRef.current += 1;
      }
      return {
        id: agent.id,
        type: 'agent',
        position: positionMapRef.current[posKey],
        data: { ...agent, selected: agent.id === selectedAgentId },
        draggable: true,
      };
    });

    const maxPerRow = Math.min(Math.max(agents.length, 1), MAX_PER_ROW);
    const totalWidth = maxPerRow * NODE_X_SPACING;

    const grooveNode = {
      id: 'groove-root',
      type: 'grooveRoot',
      position: { x: (totalWidth - NODE_X_SPACING) / 2 + 25, y: 0 },
      data: {
        label: 'GROOVE',
        style: {
          background: '#282c34',
          color: '#e6e6e6',
          border: '1px solid #3e4451',
          borderRadius: 24,
          fontWeight: 600,
          fontSize: 11,
          letterSpacing: 6,
          padding: '10px 36px 9px',
          fontFamily: "'JetBrains Mono', 'SF Mono', Consolas, monospace",
          position: 'relative',
        },
      },
      selectable: false,
      draggable: false,
    };

    return { targetNodes: [grooveNode, ...allAgentNodes] };
  }, [agents, selectedAgentId]);

  // Compute edges from current flowNodes so they update on drag
  const edges = useMemo(() => {
    const root = flowNodes.find((n) => n.id === 'groove-root');
    if (!root) return [];
    const rootW = 140, rootH = 36;
    const rootCx = root.position.x + rootW / 2;
    const rootCy = root.position.y + rootH / 2;

    return flowNodes.filter((n) => n.id !== 'groove-root').map((node) => {
      const nw = 210, nh = 120;
      const ncx = node.position.x + nw / 2;
      const ncy = node.position.y + nh / 2;
      const dx = ncx - rootCx;
      const dy = ncy - rootCy;

      let sourceHandle, targetHandle;
      if (Math.abs(dy) > Math.abs(dx)) {
        if (dy > 0) { sourceHandle = 's-bottom'; targetHandle = 'top'; }
        else { sourceHandle = 's-top'; targetHandle = 'bottom'; }
      } else {
        if (dx > 0) { sourceHandle = 's-right'; targetHandle = 'left'; }
        else { sourceHandle = 's-left'; targetHandle = 'right'; }
      }

      const isRunning = node.data?.status === 'running';
      return {
        id: `groove-${node.id}`,
        source: 'groove-root', target: node.id,
        sourceHandle, targetHandle, type: 'default',
        style: { stroke: isRunning ? '#5c6370' : '#2c313a', strokeWidth: 1 },
        animated: isRunning,
      };
    });
  }, [flowNodes]);

  // Sync target nodes into flow state — preserve user-dragged positions
  useEffect(() => {
    setFlowNodes((prev) => {
      const prevMap = new Map(prev.map((n) => [n.id, n]));
      return targetNodes.map((target) => {
        const existing = prevMap.get(target.id);
        if (existing) {
          // Keep dragged position, only update data
          return { ...existing, data: target.data };
        }
        return target;
      });
    });
  }, [targetNodes]);

  // Handle ALL node changes including drag — this is what makes drag work
  const onNodesChange = useCallback((changes) => {
    setFlowNodes((nds) => {
      const updated = applyNodeChanges(changes, nds);
      // Save final drag positions to the ref (keyed by name for stability)
      for (const change of changes) {
        if (change.type === 'position' && change.position && !change.dragging) {
          const node = updated.find((n) => n.id === change.id);
          const name = node?.data?.name || change.id;
          positionMapRef.current[name] = change.position;
          try { localStorage.setItem('groove:nodePositions', JSON.stringify(positionMapRef.current)); } catch {}
        }
      }
      return updated;
    });
  }, []);

  useEffect(() => {
    const currentCount = agents.length;
    const prevCount = prevCountRef.current;
    if (prevCount === 0 && currentCount === 1) {
      setTimeout(() => fitView({ padding: 0.3, maxZoom: 0.85, duration: 200 }), 50);
    }
    prevCountRef.current = currentCount;
  }, [agents.length, fitView]);

  useEffect(() => {
    setTimeout(() => fitView({ padding: 0.3, maxZoom: 0.85, duration: 0 }), 100);
  }, []);

  const onNodeClick = useCallback((event, node) => {
    if (node.id === 'groove-root') return;
    selectAgent(node.id);
  }, [selectAgent]);

  const onPaneClick = useCallback(() => {
    clearSelection();
  }, [clearSelection]);

  return (
    <ReactFlow
      nodes={flowNodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodeClick={onNodeClick}
      onNodesChange={onNodesChange}
      onPaneClick={onPaneClick}
      proOptions={{ hideAttribution: true }}
      nodesConnectable={false}
      elementsSelectable={true}
      minZoom={0.3}
      maxZoom={2}
      fitView
      fitViewOptions={{ padding: 0.3, maxZoom: 0.85 }}
    >
      <Background color="#3e4451" gap={20} size={1} />
    </ReactFlow>
  );
}

export default function AgentTree() {
  return (
    <ReactFlowProvider>
      <AgentTreeInner />
    </ReactFlowProvider>
  );
}
