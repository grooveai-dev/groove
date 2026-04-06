// GROOVE GUI — Agent Tree View (React Flow)
// FSL-1.1-Apache-2.0 — see LICENSE

import React, { useMemo, useCallback, useEffect, useRef } from 'react';
import { ReactFlow, Background, useReactFlow, ReactFlowProvider } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useGrooveStore } from '../stores/groove';
import AgentNode from '../components/AgentNode';

const nodeTypes = { agent: AgentNode };

const MAX_PER_ROW = 4;
const NODE_X_SPACING = 220;
const NODE_Y_SPACING = 130;

function AgentTreeInner() {
  const agents = useGrooveStore((s) => s.agents);
  const detailPanel = useGrooveStore((s) => s.detailPanel);
  const selectAgent = useGrooveStore((s) => s.selectAgent);
  const clearSelection = useGrooveStore((s) => s.clearSelection);
  const { fitView } = useReactFlow();

  const selectedAgentId = detailPanel?.type === 'agent' ? detailPanel.agentId : null;
  const prevCountRef = useRef(0);

  const { nodes, edges } = useMemo(() => {
    const running = agents.filter((a) => a.status === 'running' || a.status === 'starting');
    const done = agents.filter((a) => a.status !== 'running' && a.status !== 'starting');

    const runningNodes = running.map((agent, i) => ({
      id: agent.id,
      type: 'agent',
      position: {
        x: (i % MAX_PER_ROW) * NODE_X_SPACING,
        y: 80 + Math.floor(i / MAX_PER_ROW) * NODE_Y_SPACING,
      },
      data: { ...agent, selected: agent.id === selectedAgentId },
      draggable: true,
    }));

    const runningRows = Math.ceil(running.length / MAX_PER_ROW) || 1;
    const doneStartY = 80 + runningRows * NODE_Y_SPACING + 40;

    const doneNodes = done.map((agent, i) => ({
      id: agent.id,
      type: 'agent',
      position: {
        x: (i % MAX_PER_ROW) * NODE_X_SPACING,
        y: doneStartY + Math.floor(i / MAX_PER_ROW) * NODE_Y_SPACING,
      },
      data: { ...agent, selected: agent.id === selectedAgentId },
      draggable: true,
    }));

    const allAgentNodes = [...runningNodes, ...doneNodes];

    const maxPerRow = Math.min(Math.max(running.length, done.length, 1), MAX_PER_ROW);
    const totalWidth = maxPerRow * NODE_X_SPACING;

    // GROOVE root node — the command hub
    const grooveNode = {
      id: 'groove-root',
      type: 'default',
      position: { x: (totalWidth - NODE_X_SPACING) / 2 + 10, y: 0 },
      data: { label: 'GROOVE' },
      selectable: false,
      draggable: false,
      style: {
        background: '#282c34',
        color: '#33afbc',
        border: 'none',
        borderTop: '1px solid #33afbc',
        borderRadius: 0,
        fontWeight: 800,
        fontSize: 10,
        letterSpacing: 4,
        padding: '6px 20px 5px',
        fontFamily: "'JetBrains Mono', 'SF Mono', Consolas, monospace",
        boxShadow: '0 0 16px rgba(51, 175, 188, 0.12), 0 1px 3px rgba(0,0,0,0.3)',
      },
    };

    const edges = allAgentNodes.map((node) => {
      const agent = agents.find((a) => a.id === node.id);
      const isRunning = agent?.status === 'running';
      return {
        id: `groove-${node.id}`,
        source: 'groove-root',
        target: node.id,
        type: 'smoothstep',
        style: {
          stroke: isRunning ? '#8b929e' : '#2c313a',
          strokeWidth: 1,
        },
        animated: isRunning,
      };
    });

    return { nodes: [grooveNode, ...allAgentNodes], edges };
  }, [agents, selectedAgentId]);

  // Fit + center on first load and when agent count changes
  useEffect(() => {
    const currentCount = agents.length;
    if (currentCount !== prevCountRef.current) {
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
