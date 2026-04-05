// GROOVE GUI — Agent Detail Sidebar
// FSL-1.1-Apache-2.0 — see LICENSE

import React from 'react';
import { useGrooveStore } from '../stores/groove';

const STATUS_COLORS = {
  running: '#22c55e',
  starting: '#eab308',
  stopped: '#6b7280',
  crashed: '#ef4444',
  completed: '#06b6d4',
  killed: '#6b7280',
};

export default function AgentDetail() {
  const selectedAgentId = useGrooveStore((s) => s.selectedAgentId);
  const agents = useGrooveStore((s) => s.agents);
  const killAgent = useGrooveStore((s) => s.killAgent);
  const rotateAgent = useGrooveStore((s) => s.rotateAgent);
  const clearSelection = useGrooveStore((s) => s.clearSelection);
  const activityLog = useGrooveStore((s) => s.activityLog);

  const agent = agents.find((a) => a.id === selectedAgentId);
  if (!agent) return null;

  const color = STATUS_COLORS[agent.status] || '#6b7280';
  const contextPct = Math.round((agent.contextUsage || 0) * 100);
  const activity = activityLog[agent.id] || [];
  const isAlive = agent.status === 'running' || agent.status === 'starting';

  function handleKill() {
    killAgent(agent.id);
  }

  function formatTime(ts) {
    if (!ts) return '-';
    const d = new Date(ts);
    return d.toLocaleTimeString();
  }

  return (
    <div style={styles.sidebar}>
      {/* Header */}
      <div style={styles.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 10, height: 10, borderRadius: '50%', background: color,
            boxShadow: isAlive ? `0 0 8px ${color}` : 'none',
          }} />
          <h3 style={styles.name}>{agent.name}</h3>
        </div>
        <button onClick={clearSelection} style={styles.closeBtn}>x</button>
      </div>

      <div style={styles.statusBadge(color)}>
        {agent.status}
      </div>

      {/* Info grid */}
      <div style={styles.infoGrid}>
        <InfoRow label="ID" value={agent.id} mono />
        <InfoRow label="Role" value={agent.role} />
        <InfoRow label="Provider" value={agent.provider} />
        <InfoRow label="Scope" value={agent.scope?.join(', ') || 'unrestricted'} mono />
        <InfoRow label="Spawned" value={formatTime(agent.spawnedAt)} />
        <InfoRow label="Last Activity" value={formatTime(agent.lastActivity)} />
        <InfoRow label="Tokens" value={agent.tokensUsed?.toLocaleString() || '0'} />
      </div>

      {/* Context bar */}
      <div style={{ marginTop: 16 }}>
        <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>
          Context Usage: {contextPct}%
        </div>
        <div style={styles.barTrack}>
          <div style={{
            ...styles.barFill,
            width: `${contextPct}%`,
            background: contextPct > 80 ? '#ef4444' : contextPct > 60 ? '#eab308' : '#22c55e',
          }} />
        </div>
      </div>

      {/* Prompt */}
      {agent.prompt && (
        <div style={{ marginTop: 16 }}>
          <div style={styles.sectionLabel}>Prompt</div>
          <div style={styles.promptBox}>{agent.prompt}</div>
        </div>
      )}

      {/* Actions */}
      {isAlive && (
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button onClick={() => rotateAgent(agent.id)} style={styles.rotateBtn}>
            Rotate
          </button>
          <button onClick={handleKill} style={styles.killBtn}>
            Kill
          </button>
        </div>
      )}

      {/* Activity log */}
      <div style={{ marginTop: 20 }}>
        <div style={styles.sectionLabel}>Activity ({activity.length})</div>
        <div style={styles.activityScroll}>
          {activity.length === 0 && (
            <div style={{ color: '#555', fontSize: 12, padding: 8 }}>
              No activity yet...
            </div>
          )}
          {activity.slice(-50).reverse().map((entry, i) => (
            <div key={i} style={styles.activityEntry}>
              <span style={styles.activityTime}>
                {new Date(entry.timestamp).toLocaleTimeString()}
              </span>
              <span style={styles.activityText}>
                {entry.text?.slice(0, 200)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value, mono }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
      <span style={{ color: '#666', fontSize: 12 }}>{label}</span>
      <span style={{
        color: '#ccc', fontSize: 12,
        fontFamily: mono ? 'monospace' : 'inherit',
        maxWidth: '60%', textAlign: 'right',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {value}
      </span>
    </div>
  );
}

const styles = {
  sidebar: {
    position: 'absolute', top: 0, right: 0, bottom: 0,
    width: 340, background: '#111118',
    borderLeft: '1px solid #222',
    padding: 20, overflowY: 'auto',
    zIndex: 100,
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  },
  name: { fontSize: 16, fontWeight: 700, color: '#f0f0f0', margin: 0 },
  closeBtn: {
    background: 'none', border: 'none', color: '#666',
    fontSize: 16, cursor: 'pointer', padding: '2px 6px',
  },
  statusBadge: (color) => ({
    display: 'inline-block', marginTop: 8,
    padding: '3px 10px', borderRadius: 12,
    fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
    background: `${color}20`, color, letterSpacing: 0.5,
  }),
  infoGrid: {
    marginTop: 20, borderTop: '1px solid #1e1e2e', paddingTop: 12,
  },
  barTrack: {
    height: 6, background: '#1a1a2e', borderRadius: 3, overflow: 'hidden',
  },
  barFill: {
    height: '100%', borderRadius: 3, transition: 'width 0.3s ease',
  },
  sectionLabel: {
    fontSize: 11, color: '#666', textTransform: 'uppercase',
    letterSpacing: 1, marginBottom: 6,
  },
  promptBox: {
    background: '#0d0d18', border: '1px solid #1e1e2e', borderRadius: 8,
    padding: 10, fontSize: 12, color: '#aaa', lineHeight: 1.5,
    fontFamily: 'monospace', whiteSpace: 'pre-wrap',
  },
  rotateBtn: {
    flex: 1, padding: '10px',
    background: '#1a1a2e', border: '1px solid #3b82f640',
    borderRadius: 8, color: '#3b82f6', fontSize: 13,
    fontWeight: 600, cursor: 'pointer',
  },
  killBtn: {
    flex: 1, padding: '10px',
    background: '#2a1015', border: '1px solid #ef444440',
    borderRadius: 8, color: '#ef4444', fontSize: 13,
    fontWeight: 600, cursor: 'pointer',
  },
  activityScroll: {
    maxHeight: 300, overflowY: 'auto',
    background: '#0a0a12', borderRadius: 8,
    border: '1px solid #1e1e2e',
  },
  activityEntry: {
    padding: '6px 10px', borderBottom: '1px solid #141420',
    fontSize: 11, display: 'flex', gap: 8,
  },
  activityTime: { color: '#555', whiteSpace: 'nowrap', fontFamily: 'monospace' },
  activityText: { color: '#999', wordBreak: 'break-word' },
};
