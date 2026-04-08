// GROOVE GUI — Agent Tree View (React Flow)
// FSL-1.1-Apache-2.0 — see LICENSE

import React, { useMemo, useCallback, useEffect, useRef } from 'react';
import { ReactFlow, Background, useReactFlow, ReactFlowProvider } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useGrooveStore } from '../stores/groove';
import AgentNode from '../components/AgentNode';

const nodeTypes = { agent: AgentNode };

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
  const positionMapRef = useRef({});
  const nextSlotRef = useRef(0);

  const { nodes, edges } = useMemo(() => {
    // Clean up agents that no longer exist
    const agentIds = new Set(agents.map((a) => a.id));
    for (const id of Object.keys(positionMapRef.current)) {
      if (!agentIds.has(id)) {
        delete positionMapRef.current[id];
      }
    }

    const allAgentNodes = agents.map((agent) => {
      if (!positionMapRef.current[agent.id]) {
        const slot = nextSlotRef.current;
        positionMapRef.current[agent.id] = {
          x: (slot % MAX_PER_ROW) * NODE_X_SPACING,
          y: 160 + Math.floor(slot / MAX_PER_ROW) * NODE_Y_SPACING,
        };
        nextSlotRef.current += 1;
      }
      return {
        id: agent.id,
        type: 'agent',
        position: positionMapRef.current[agent.id],
        data: { ...agent, selected: agent.id === selectedAgentId },
        draggable: true,
      };
    });

    const maxPerRow = Math.min(Math.max(agents.length, 1), MAX_PER_ROW);
    const totalWidth = maxPerRow * NODE_X_SPACING;

    // GROOVE root node — clean, rounded, matching
    const grooveNode = {
      id: 'groove-root',
      type: 'default',
      position: { x: (totalWidth - NODE_X_SPACING) / 2 + 25, y: 0 },
      data: { label: 'GROOVE' },
      selectable: false,
      draggable: false,
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
      },
    };

    // Bezier spline edges — the brand
    const edges = allAgentNodes.map((node) => {
      const agent = agents.find((a) => a.id === node.id);
      const isRunning = agent?.status === 'running';
      return {
        id: `groove-${node.id}`,
        source: 'groove-root',
        target: node.id,
        type: 'default', // Bezier curve (spline)
        style: {
          stroke: isRunning ? '#5c6370' : '#2c313a',
          strokeWidth: 1,
        },
        animated: isRunning,
      };
    });

    return { nodes: [grooveNode, ...allAgentNodes], edges };
  }, [agents, selectedAgentId]);

  const onNodesChange = useCallback((changes) => {
    for (const change of changes) {
      if (change.type === 'position' && change.position) {
        positionMapRef.current[change.id] = change.position;
      }
    }
  }, []);

  useEffect(() => {
    const currentCount = agents.length;
    const prevCount = prevCountRef.current;
    if (prevCount === 0 && currentCount === 1) {
      setTimeout(() => fitView({ padding: 0.3, maxZoom: 1.4, duration: 200 }), 50);
    }
    prevCountRef.current = currentCount;
  }, [agents.length, fitView]);

  useEffect(() => {
    setTimeout(() => fitView({ padding: 0.3, maxZoom: 1.4, duration: 0 }), 100);
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
      nodes={nodes}
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
      fitViewOptions={{ padding: 0.3, maxZoom: 1.4 }}
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
