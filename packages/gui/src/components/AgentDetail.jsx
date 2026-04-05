// GROOVE GUI — Agent Detail Panel
// FSL-1.1-Apache-2.0 — see LICENSE

import React from 'react';
import { useGrooveStore } from '../stores/groove';

const STATUS_COLORS = {
  running: 'var(--green)',
  starting: 'var(--amber)',
  stopped: 'var(--text-dim)',
  crashed: 'var(--red)',
  completed: 'var(--accent)',
  killed: 'var(--text-dim)',
};

export default function AgentDetail() {
  const detailPanel = useGrooveStore((s) => s.detailPanel);
  const agents = useGrooveStore((s) => s.agents);
  const killAgent = useGrooveStore((s) => s.killAgent);
  const rotateAgent = useGrooveStore((s) => s.rotateAgent);
  const activityLog = useGrooveStore((s) => s.activityLog);

  const agent = agents.find((a) => a.id === detailPanel?.agentId);
  if (!agent) return <div style={styles.empty}>Agent not found</div>;

  const color = STATUS_COLORS[agent.status] || 'var(--text-dim)';
  const contextPct = Math.round((agent.contextUsage || 0) * 100);
  const activity = activityLog[agent.id] || [];
  const isAlive = agent.status === 'running' || agent.status === 'starting';

  function formatTime(ts) {
    if (!ts) return '-';
    return new Date(ts).toLocaleTimeString();
  }

  return (
    <div>
      {/* Header */}
      <div style={styles.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 6, height: 6, borderRadius: '50%', background: color,
            animation: agent.status === 'running' ? 'pulse 2s infinite' : 'none',
          }} />
          <span style={styles.name}>{agent.name}</span>
        </div>
      </div>

      <div style={{
        display: 'inline-block', marginTop: 6,
        padding: '2px 6px', borderRadius: 2,
        fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
        letterSpacing: 0.5,
        background: `color-mix(in srgb, ${color} 12%, transparent)`,
        color: color,
      }}>
        {agent.status}
      </div>

      {/* Info grid */}
      <div style={styles.infoGrid}>
        <InfoRow label="ID" value={agent.id} />
        <InfoRow label="Role" value={agent.role} />
        <InfoRow label="Provider" value={agent.provider} />
        <InfoRow label="Scope" value={agent.scope?.join(', ') || 'unrestricted'} />
        <InfoRow label="Spawned" value={formatTime(agent.spawnedAt)} />
        <InfoRow label="Last Activity" value={formatTime(agent.lastActivity)} />
        <InfoRow label="Tokens" value={agent.tokensUsed?.toLocaleString() || '0'} />
      </div>

      {/* Context bar */}
      <div style={{ marginTop: 14 }}>
        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 3 }}>
          Context: {contextPct}%
        </div>
        <div style={styles.barTrack}>
          <div style={{
            height: '100%', width: `${contextPct}%`, borderRadius: 1,
            background: contextPct > 80 ? 'var(--red)' : contextPct > 60 ? 'var(--amber)' : 'var(--green)',
            transition: 'width 0.3s',
          }} />
        </div>
      </div>

      {/* Prompt */}
      {agent.prompt && (
        <div style={{ marginTop: 14 }}>
          <div style={styles.sectionLabel}>PROMPT</div>
          <div style={styles.promptBox}>{agent.prompt}</div>
        </div>
      )}

      {/* Actions */}
      {isAlive && (
        <div style={{ display: 'flex', gap: 6, marginTop: 14 }}>
          <button onClick={() => rotateAgent(agent.id)} style={styles.rotateBtn}>
            Rotate
          </button>
          <button onClick={() => killAgent(agent.id)} style={styles.killBtn}>
            Kill
          </button>
        </div>
      )}

      {/* Activity log */}
      <div style={{ marginTop: 16 }}>
        <div style={styles.sectionLabel}>ACTIVITY ({activity.length})</div>
        <div style={styles.activityScroll}>
          {activity.length === 0 && (
            <div style={{ color: 'var(--text-dim)', fontSize: 11, padding: 8 }}>
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

function InfoRow({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
      <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>{label}</span>
      <span style={{
        color: 'var(--text-primary)', fontSize: 11,
        maxWidth: '60%', textAlign: 'right',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {value}
      </span>
    </div>
  );
}

const styles = {
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    paddingTop: 4,
  },
  name: { fontSize: 14, fontWeight: 600, color: 'var(--text-bright)' },
  infoGrid: {
    marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 10,
  },
  barTrack: {
    height: 2, background: 'var(--text-muted)', borderRadius: 1, overflow: 'hidden',
  },
  sectionLabel: {
    fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase',
    letterSpacing: 1.5, marginBottom: 6, fontWeight: 600,
  },
  promptBox: {
    background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 2,
    padding: 8, fontSize: 12, color: 'var(--text-primary)', lineHeight: 1.5,
    whiteSpace: 'pre-wrap',
  },
  rotateBtn: {
    flex: 1, padding: '6px',
    background: 'transparent', border: '1px solid var(--accent)',
    borderRadius: 2, color: 'var(--accent)', fontSize: 11,
    fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font)',
  },
  killBtn: {
    flex: 1, padding: '6px',
    background: 'transparent', border: '1px solid var(--red)',
    borderRadius: 2, color: 'var(--red)', fontSize: 11,
    fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font)',
  },
  activityScroll: {
    maxHeight: 200, overflowY: 'auto',
    background: 'var(--bg-base)', borderRadius: 2,
    border: '1px solid var(--border)',
  },
  activityEntry: {
    padding: '4px 8px', borderBottom: '1px solid var(--bg-surface)',
    fontSize: 10, display: 'flex', gap: 6,
  },
  activityTime: { color: 'var(--text-dim)', whiteSpace: 'nowrap' },
  activityText: { color: 'var(--text-primary)', wordBreak: 'break-word' },
  empty: { color: 'var(--text-dim)', fontSize: 12, padding: 16 },
};
