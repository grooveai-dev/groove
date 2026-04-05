// GROOVE GUI — App Root
// FSL-1.1-Apache-2.0 — see LICENSE

import React, { useEffect, useState } from 'react';
import { useGrooveStore } from './stores/groove';
import AgentTree from './views/AgentTree';
import AgentDetail from './components/AgentDetail';
import EmptyState from './components/EmptyState';
import SpawnModal from './components/SpawnModal';
import Notifications from './components/Notifications';
import JournalistFeed from './views/JournalistFeed';
import TeamSelector from './components/TeamSelector';
import TokenDashboard from './components/TokenDashboard';
import ApprovalQueue from './components/ApprovalQueue';

export default function App() {
  const agents = useGrooveStore((s) => s.agents);
  const connected = useGrooveStore((s) => s.connected);
  const selectedAgentId = useGrooveStore((s) => s.selectedAgentId);
  const spawnModalOpen = useGrooveStore((s) => s.spawnModalOpen);
  const journalistOpen = useGrooveStore((s) => s.journalistOpen);
  const connect = useGrooveStore((s) => s.connect);
  const openSpawnModal = useGrooveStore((s) => s.openSpawnModal);
  const toggleJournalist = useGrooveStore((s) => s.toggleJournalist);

  const [rightPanel, setRightPanel] = useState(null); // 'tokens' | 'approvals' | null

  useEffect(() => {
    connect();
  }, [connect]);

  const runningCount = agents.filter((a) => a.status === 'running').length;
  const hasAgents = agents.length > 0;

  // Determine which sidebar is showing
  const showAgentDetail = selectedAgentId && !journalistOpen && !rightPanel;
  const showJournalist = journalistOpen && !rightPanel;

  function togglePanel(name) {
    setRightPanel((prev) => prev === name ? null : name);
  }

  return (
    <div style={styles.root}>
      {/* Header */}
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <h1 style={styles.logo}>GROOVE</h1>
          <div style={{
            ...styles.statusDot,
            background: connected ? '#22c55e' : '#ef4444',
            boxShadow: connected ? '0 0 6px #22c55e60' : 'none',
          }} />
        </div>

        <div style={styles.headerRight}>
          <span style={styles.agentCount}>
            {runningCount > 0
              ? `${runningCount} running`
              : agents.length > 0
                ? `${agents.length} agent${agents.length !== 1 ? 's' : ''}`
                : ''}
          </span>
          {connected && (
            <>
              <TeamSelector />
              <button onClick={() => togglePanel('tokens')} style={styles.navBtn}>
                Tokens
              </button>
              <button onClick={() => togglePanel('approvals')} style={styles.navBtn}>
                Approvals
              </button>
              <button onClick={toggleJournalist} style={styles.navBtn}>
                Journalist
              </button>
              <button onClick={openSpawnModal} style={styles.spawnBtn}>
                + Spawn
              </button>
            </>
          )}
        </div>
      </header>

      {/* Main */}
      <main style={styles.main}>
        {!hasAgents ? <EmptyState /> : <AgentTree />}

        {/* Sidebars */}
        {showAgentDetail && <AgentDetail />}
        {showJournalist && <JournalistFeed onClose={toggleJournalist} />}
        {rightPanel === 'tokens' && <TokenDashboard onClose={() => setRightPanel(null)} />}
        {rightPanel === 'approvals' && <ApprovalQueue onClose={() => setRightPanel(null)} />}
      </main>

      {/* Modals & overlays */}
      {spawnModalOpen && <SpawnModal />}
      <Notifications />

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        @keyframes slideIn {
          from { transform: translateX(20px); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #2a2a3e; border-radius: 3px; }
        ::selection { background: #3b82f640; }
      `}</style>
    </div>
  );
}

const styles = {
  root: {
    width: '100%', height: '100%',
    display: 'flex', flexDirection: 'column',
    background: '#0a0a0a', color: '#e0e0e0',
  },
  header: {
    padding: '10px 16px',
    borderBottom: '1px solid #1e1e2e',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    background: '#0d0d14',
    flexShrink: 0,
  },
  headerLeft: {
    display: 'flex', alignItems: 'center', gap: 10,
  },
  logo: {
    fontSize: 16, fontWeight: 800, letterSpacing: 3,
    margin: 0, color: '#e0e0e0',
  },
  statusDot: {
    width: 7, height: 7, borderRadius: '50%',
    transition: 'background 0.3s',
  },
  headerRight: {
    display: 'flex', alignItems: 'center', gap: 10,
  },
  agentCount: { fontSize: 12, color: '#666' },
  navBtn: {
    padding: '6px 12px', background: '#1a1a2e',
    border: '1px solid #2a2a3e', borderRadius: 6,
    color: '#888', fontSize: 11, fontWeight: 500,
    cursor: 'pointer',
  },
  spawnBtn: {
    padding: '6px 14px', background: '#1e3a5f',
    border: '1px solid #3b82f640', borderRadius: 6,
    color: '#3b82f6', fontSize: 12, fontWeight: 600,
    cursor: 'pointer',
  },
  main: {
    flex: 1, position: 'relative', overflow: 'hidden',
  },
};
