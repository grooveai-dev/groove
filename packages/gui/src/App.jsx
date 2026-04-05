// GROOVE GUI — App Root
// FSL-1.1-Apache-2.0 — see LICENSE

import React, { useEffect } from 'react';
import { useGrooveStore } from './stores/groove';
import AgentTree from './views/AgentTree';
import AgentPanel from './components/AgentPanel';
import EmptyState from './components/EmptyState';
import SpawnPanel from './components/SpawnPanel';
import JournalistFeed from './views/JournalistFeed';
import TeamSelector from './components/TeamSelector';
import TokenDashboard from './components/TokenDashboard';
import ApprovalQueue from './components/ApprovalQueue';

const TABS = [
  { id: 'agents', label: 'Agents' },
  { id: 'tokens', label: 'Tokens' },
  { id: 'teams', label: 'Teams' },
  { id: 'approvals', label: 'Approvals' },
];

export default function App() {
  const agents = useGrooveStore((s) => s.agents);
  const connected = useGrooveStore((s) => s.connected);
  const activeTab = useGrooveStore((s) => s.activeTab);
  const detailPanel = useGrooveStore((s) => s.detailPanel);
  const statusMessage = useGrooveStore((s) => s.statusMessage);
  const connect = useGrooveStore((s) => s.connect);
  const setActiveTab = useGrooveStore((s) => s.setActiveTab);
  const openDetail = useGrooveStore((s) => s.openDetail);
  const closeDetail = useGrooveStore((s) => s.closeDetail);

  useEffect(() => { connect(); }, [connect]);

  const runningCount = agents.filter((a) => a.status === 'running').length;
  const hasAgents = agents.length > 0;

  return (
    <div style={styles.root}>
      {/* Header */}
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <img src="/groove-logo-short.png" alt="GROOVE" style={{ height: 24, opacity: 0.85 }} />
          <div style={{
            width: 6, height: 6, borderRadius: '50%',
            background: connected ? 'var(--green)' : 'var(--red)',
          }} />
        </div>

        <div style={styles.headerCenter}>
          {connected && TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                ...styles.tabBtn,
                color: activeTab === tab.id ? 'var(--text-bright)' : 'var(--text-primary)',
                borderBottom: activeTab === tab.id ? '2px solid var(--accent)' : '2px solid transparent',
                background: activeTab === tab.id ? 'var(--bg-active)' : 'transparent',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div style={styles.headerRight}>
          {statusMessage && (
            <span style={styles.statusText}>{statusMessage}</span>
          )}
          <span style={styles.agentCount}>
            {runningCount > 0
              ? `${runningCount} running`
              : agents.length > 0
                ? `${agents.length} agent${agents.length !== 1 ? 's' : ''}`
                : ''}
          </span>
          {connected && (
            <>
              <button
                onClick={() => detailPanel?.type === 'journalist' ? closeDetail() : openDetail({ type: 'journalist' })}
                style={{
                  ...styles.tabBtn,
                  color: detailPanel?.type === 'journalist' ? 'var(--text-bright)' : 'var(--text-primary)',
                  borderBottom: detailPanel?.type === 'journalist' ? '2px solid var(--purple)' : '2px solid transparent',
                }}
              >
                Journalist
              </button>
              <button
                onClick={() => openDetail({ type: 'spawn' })}
                style={styles.spawnBtn}
              >
                + Spawn
              </button>
            </>
          )}
        </div>
      </header>

      {/* Main row */}
      <div style={styles.mainRow}>
        <main style={styles.content}>
          {activeTab === 'agents' && (
            !hasAgents ? <EmptyState /> : <AgentTree />
          )}
          {activeTab === 'tokens' && <TokenDashboard />}
          {activeTab === 'teams' && <TeamSelector />}
          {activeTab === 'approvals' && <ApprovalQueue />}
        </main>

        {/* Detail panel — in document flow */}
        {detailPanel && (
          <aside style={{
            ...styles.detailPanel,
            width: detailPanel.type === 'agent' ? '45%' : 320,
          }}>
            <button onClick={closeDetail} style={styles.closeBtn}>x</button>
            {detailPanel.type === 'agent' && <AgentPanel />}
            {detailPanel.type === 'spawn' && <SpawnPanel />}
            {detailPanel.type === 'journalist' && <JournalistFeed />}
          </aside>
        )}
      </div>
    </div>
  );
}

const styles = {
  root: {
    width: '100%', height: '100%',
    display: 'flex', flexDirection: 'column',
    background: 'var(--bg-base)', color: 'var(--text-primary)',
  },
  header: {
    height: 40,
    padding: '0 16px',
    borderBottom: '1px solid var(--border)',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    background: 'var(--bg-chrome)',
    flexShrink: 0,
  },
  headerLeft: {
    display: 'flex', alignItems: 'center', gap: 8,
  },
  logo: {
    fontSize: 13, fontWeight: 600, letterSpacing: 1.5,
    color: 'var(--text-bright)',
  },
  headerCenter: {
    display: 'flex', alignItems: 'center', gap: 0,
  },
  headerRight: {
    display: 'flex', alignItems: 'center', gap: 10,
  },
  tabBtn: {
    padding: '10px 14px',
    background: 'transparent',
    border: 'none',
    borderBottom: '2px solid transparent',
    fontSize: 12, fontWeight: 500,
    fontFamily: 'var(--font)',
    cursor: 'pointer',
    transition: 'color 0.1s',
  },
  spawnBtn: {
    padding: '4px 12px',
    background: 'transparent',
    border: '1px solid var(--accent)',
    borderRadius: 2,
    color: 'var(--accent)', fontSize: 12, fontWeight: 600,
    fontFamily: 'var(--font)',
    cursor: 'pointer',
  },
  agentCount: { fontSize: 11, color: 'var(--text-dim)' },
  statusText: { fontSize: 11, color: 'var(--text-dim)', fontStyle: 'italic' },
  mainRow: {
    flex: 1, display: 'flex', overflow: 'hidden',
  },
  content: {
    flex: 1, overflow: 'hidden', position: 'relative',
  },
  detailPanel: {
    width: 320, flexShrink: 0,
    background: 'var(--bg-chrome)',
    borderLeft: '1px solid var(--border)',
    padding: 16, overflowY: 'auto',
    position: 'relative',
  },
  closeBtn: {
    position: 'absolute', top: 8, right: 10,
    background: 'none', border: 'none', color: 'var(--text-dim)',
    fontSize: 14, cursor: 'pointer', fontFamily: 'var(--font)',
    padding: '2px 6px',
  },
};
