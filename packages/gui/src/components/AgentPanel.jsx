// GROOVE GUI — Agent Control Panel (tabbed: Chat / Stats / Actions)
// FSL-1.1-Apache-2.0 — see LICENSE

import React, { useState } from 'react';
import { useGrooveStore } from '../stores/groove';
import AgentChat from './AgentChat';
import AgentStats from './AgentStats';
import AgentActions from './AgentActions';

const TABS = [
  { id: 'chat', label: 'Chat' },
  { id: 'stats', label: 'Stats' },
  { id: 'actions', label: 'Actions' },
];

const STATUS_COLORS = {
  running: 'var(--green)',
  starting: 'var(--amber)',
  stopped: 'var(--text-dim)',
  crashed: 'var(--red)',
  completed: 'var(--accent)',
  killed: 'var(--text-dim)',
};

export default function AgentPanel() {
  const [activeTab, setActiveTab] = useState('chat');
  const detailPanel = useGrooveStore((s) => s.detailPanel);
  const agents = useGrooveStore((s) => s.agents);

  const agent = agents.find((a) => a.id === detailPanel?.agentId);
  if (!agent) return <div style={styles.empty}>Agent not found</div>;

  const color = STATUS_COLORS[agent.status] || 'var(--text-dim)';
  const isAlive = agent.status === 'running' || agent.status === 'starting';

  return (
    <div style={styles.container}>
      {/* Agent header */}
      <div style={styles.agentHeader}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 6, height: 6, borderRadius: '50%', background: color,
            animation: isAlive ? 'pulse 2s infinite' : 'none',
          }} />
          <span style={styles.agentName}>{agent.name}</span>
          <span style={{
            fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
            letterSpacing: 0.5, color,
            padding: '1px 6px', borderRadius: 2,
            background: `color-mix(in srgb, ${color} 12%, transparent)`,
          }}>
            {agent.status}
          </span>
        </div>
        <span style={styles.agentMeta}>
          {agent.role} / {agent.provider}
        </span>
      </div>

      {/* Tab bar */}
      <div style={styles.tabBar}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              ...styles.tab,
              color: activeTab === tab.id ? 'var(--text-bright)' : 'var(--text-dim)',
              borderBottom: activeTab === tab.id ? '2px solid var(--accent)' : '2px solid transparent',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={styles.tabContent}>
        {activeTab === 'chat' && <AgentChat agent={agent} />}
        {activeTab === 'stats' && <AgentStats agent={agent} />}
        {activeTab === 'actions' && <AgentActions agent={agent} />}
      </div>
    </div>
  );
}

const styles = {
  container: {
    display: 'flex', flexDirection: 'column', height: '100%',
  },
  agentHeader: {
    padding: '12px 0 8px',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    borderBottom: '1px solid var(--border)',
  },
  agentName: { fontSize: 14, fontWeight: 600, color: 'var(--text-bright)' },
  agentMeta: { fontSize: 11, color: 'var(--text-dim)' },
  tabBar: {
    display: 'flex', gap: 0,
    borderBottom: '1px solid var(--border)',
  },
  tab: {
    padding: '8px 16px',
    background: 'transparent', border: 'none',
    borderBottom: '2px solid transparent',
    fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
    letterSpacing: 1,
    fontFamily: 'var(--font)', cursor: 'pointer',
  },
  tabContent: {
    flex: 1, overflow: 'hidden',
    display: 'flex', flexDirection: 'column',
  },
  empty: { color: 'var(--text-dim)', fontSize: 12, padding: 16 },
};
