// GROOVE GUI — Agent Tree View (React Flow)
// FSL-1.1-Apache-2.0 — see LICENSE

import React, { useMemo, useCallback } from 'react';
import { ReactFlow, Background, useReactFlow } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useGrooveStore } from '../stores/groove';
import AgentNode from '../components/AgentNode';

const nodeTypes = { agent: AgentNode };

export default function AgentTree() {
  const agents = useGrooveStore((s) => s.agents);
  const selectedAgentId = useGrooveStore((s) => s.selectedAgentId);
  const selectAgent = useGrooveStore((s) => s.selectAgent);
  const clearSelection = useGrooveStore((s) => s.clearSelection);

  const { nodes, edges } = useMemo(() => {
    const running = agents.filter((a) => a.status === 'running' || a.status === 'starting');
    const done = agents.filter((a) => a.status !== 'running' && a.status !== 'starting');

    // Layout: running agents in a row, done agents in a second row below
    const runningNodes = running.map((agent, i) => ({
      id: agent.id,
      type: 'agent',
      position: { x: i * 280, y: 120 },
      data: { ...agent, selected: agent.id === selectedAgentId },
    }));

    const doneNodes = done.map((agent, i) => ({
      id: agent.id,
      type: 'agent',
      position: { x: i * 280, y: 320 },
      data: { ...agent, selected: agent.id === selectedAgentId },
    }));

    const allAgentNodes = [...runningNodes, ...doneNodes];

    // Central GROOVE root node
    const totalWidth = Math.max(running.length, done.length, 1) * 280;
    const grooveNode = {
      id: 'groove-root',
      type: 'default',
      position: { x: (totalWidth - 280) / 2, y: 0 },
      data: { label: 'GROOVE' },
      selectable: false,
      style: {
        background: '#12121a',
        color: '#e0e0e0',
        border: '1px solid #333',
        borderRadius: 8,
        fontWeight: 700,
        fontSize: 13,
        letterSpacing: 3,
        padding: '8px 24px',
      },
    };

    const edges = allAgentNodes.map((node) => ({
      id: `groove-${node.id}`,
      source: 'groove-root',
      target: node.id,
      style: { stroke: '#2a2a3e', strokeWidth: 1.5 },
      animated: agents.find((a) => a.id === node.id)?.status === 'running',
    }));

    return { nodes: [grooveNode, ...allAgentNodes], edges };
  }, [agents, selectedAgentId]);

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
      fitView
      fitViewOptions={{ padding: 0.3 }}
      proOptions={{ hideAttribution: true }}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      minZoom={0.4}
      maxZoom={1.5}
    >
      <Background color="#1a1a1a" gap={24} size={1} />
    </ReactFlow>
  );
}
