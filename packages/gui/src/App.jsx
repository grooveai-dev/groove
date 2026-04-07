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
import CommandCenter from './views/CommandCenter';
import ApprovalQueue from './components/ApprovalQueue';
import SkillsMarketplace from './views/SkillsMarketplace';
import IntegrationsStore from './views/IntegrationsStore';
import ScheduleManager from './views/ScheduleManager';
import FileEditor from './views/FileEditor';

const TABS = [
  { id: 'agents', label: 'Agents' },
  { id: 'editor', label: 'Editor' },
  { id: 'integrations', label: 'Integrations' },
  { id: 'skills', label: 'Skills' },
  { id: 'stats', label: 'Stats' },
  { id: 'schedules', label: 'Schedules' },
  { id: 'teams', label: 'Teams' },
  { id: 'approvals', label: 'Approvals' },
];

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) {
      return React.createElement('div', {
        style: { padding: 40, color: '#e06c75', fontFamily: 'monospace', fontSize: 13, background: '#1e2127', height: '100vh' }
      },
        React.createElement('h2', { style: { color: '#e6e6e6' } }, 'GROOVE — Render Error'),
        React.createElement('pre', { style: { whiteSpace: 'pre-wrap', marginTop: 16, color: '#e06c75' } }, this.state.error.message),
        React.createElement('pre', { style: { whiteSpace: 'pre-wrap', marginTop: 8, color: '#7a8394', fontSize: 11 } }, this.state.error.stack),
      );
    }
    return this.props.children;
  }
}

function AppInner() {
  const agents = useGrooveStore((s) => s.agents);
  const connected = useGrooveStore((s) => s.connected);
  const activeTab = useGrooveStore((s) => s.activeTab);
  const detailPanel = useGrooveStore((s) => s.detailPanel);
  const statusMessage = useGrooveStore((s) => s.statusMessage);
  const daemonHost = useGrooveStore((s) => s.daemonHost);
  const tunneled = useGrooveStore((s) => s.tunneled);
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
          <img src="/groove-logo-short.png" alt="GROOVE" style={{ height: 18, marginTop: 3, opacity: 0.85 }} />
          {daemonHost && (
            <span style={styles.hostBadge}>{daemonHost}</span>
          )}
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

      {/* Status pill — bottom left */}
      <div style={{
        position: 'fixed', bottom: 10, left: 12, zIndex: 50,
        display: 'flex', alignItems: 'center', gap: 5,
      }}>
        <div style={{
          width: 5, height: 5, borderRadius: '50%',
          background: connected ? 'var(--green)' : 'var(--red)',
          animation: 'pulse 2s infinite',
        }} />
        <span style={{
          fontSize: 9, fontWeight: 600, letterSpacing: 0.8,
          color: connected ? 'var(--green)' : 'var(--red)',
          textTransform: 'uppercase',
          fontFamily: 'var(--font)',
          animation: 'pulse 3s infinite',
        }}>
          {connected ? (tunneled ? 'tunneled' : daemonHost ? 'remote' : 'connected') : 'offline'}
        </span>
        {connected && tunneled && (
          <span
            title="Connected via SSH tunnel. Run 'groove disconnect' in your terminal to close."
            style={{
              fontSize: 9, color: 'var(--text-dim)', fontFamily: 'var(--font)',
              cursor: 'help', marginLeft: 2,
            }}
          >
            (via ssh)
          </span>
        )}
      </div>

      {/* Main row */}
      <div style={styles.mainRow}>
        <main style={styles.content}>
          {activeTab === 'agents' && (
            !hasAgents ? <EmptyState /> : <AgentTree />
          )}
          {activeTab === 'editor' && <FileEditor />}
          {activeTab === 'integrations' && <IntegrationsStore />}
          {activeTab === 'skills' && <SkillsMarketplace />}
          {activeTab === 'stats' && <CommandCenter />}
          {activeTab === 'schedules' && <ScheduleManager />}
          {activeTab === 'teams' && <TeamSelector />}
          {activeTab === 'approvals' && <ApprovalQueue />}
        </main>

        {/* Detail panel — sidebar for agent/journalist */}
        {detailPanel && detailPanel.type !== 'spawn' && (
          <aside style={{
            ...styles.detailPanel,
            width: detailPanel.type === 'agent' ? '45%' : 320,
          }}>
            <button onClick={closeDetail} style={styles.closeBtn}>x</button>
            {detailPanel.type === 'agent' && <AgentPanel />}
            {detailPanel.type === 'journalist' && <JournalistFeed />}
          </aside>
        )}

        {/* Spawn panel — full-screen overlay */}
        {detailPanel?.type === 'spawn' && <SpawnPanel />}
      </div>
    </div>
  );
}

export default function App() {
  return React.createElement(ErrorBoundary, null, React.createElement(AppInner));
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
    position: 'relative',
  },
  headerLeft: {
    display: 'flex', alignItems: 'center', gap: 8,
  },
  hostBadge: {
    fontSize: 9, fontWeight: 600, letterSpacing: 0.5,
    color: 'var(--text-dim)', background: 'var(--bg-active)',
    padding: '2px 6px', borderRadius: 3,
    border: '1px solid var(--border)',
    fontFamily: 'var(--font)',
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
