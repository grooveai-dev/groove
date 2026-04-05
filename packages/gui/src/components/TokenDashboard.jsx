// GROOVE GUI — Token Dashboard
// FSL-1.1-Apache-2.0 — see LICENSE

import React, { useState, useEffect } from 'react';

export default function TokenDashboard({ onClose }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    fetchSummary();
    const interval = setInterval(fetchSummary, 5000);
    return () => clearInterval(interval);
  }, []);

  async function fetchSummary() {
    try {
      const res = await fetch('/api/tokens/summary');
      setData(await res.json());
    } catch { /* ignore */ }
  }

  if (!data) return null;

  const uptime = formatDuration(data.sessionDurationMs);

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <h3 style={styles.title}>Token Usage</h3>
        <button onClick={onClose} style={styles.closeBtn}>x</button>
      </div>

      {/* Big numbers */}
      <div style={styles.statGrid}>
        <StatCard label="Total Tokens" value={data.totalTokens.toLocaleString()} />
        <StatCard label="Agents" value={data.agentCount} />
        <StatCard label="Session" value={uptime} />
        <StatCard
          label="Savings"
          value={`${data.savings.percentage}%`}
          color={data.savings.percentage > 0 ? '#22c55e' : '#666'}
        />
      </div>

      {/* Savings breakdown */}
      {data.savings.total > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={styles.sectionLabel}>Savings Breakdown</div>
          <div style={styles.breakdownList}>
            <BreakdownRow
              label="Context rotation"
              value={data.savings.fromRotation}
            />
            <BreakdownRow
              label="Conflict prevention"
              value={data.savings.fromConflictPrevention}
            />
            <BreakdownRow
              label="Cold-start skip"
              value={data.savings.fromColdStartSkip}
            />
            <div style={styles.breakdownTotal}>
              <span>Without GROOVE (est.)</span>
              <span style={{ fontFamily: 'monospace', color: '#ef4444' }}>
                {data.savings.estimatedWithoutGroove.toLocaleString()} tokens
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Per-agent usage */}
      {data.perAgent.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={styles.sectionLabel}>Per Agent</div>
          <div style={styles.agentList}>
            {data.perAgent.map((a) => (
              <div key={a.agentId} style={styles.agentRow}>
                <span style={{ color: '#aaa', fontSize: 12 }}>{a.agentId.slice(0, 8)}</span>
                <span style={{ fontFamily: 'monospace', color: '#ccc', fontSize: 12 }}>
                  {a.tokens.toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, color }) {
  return (
    <div style={styles.stat}>
      <div style={{ fontSize: 22, fontWeight: 700, color: color || '#f0f0f0', fontFamily: 'monospace' }}>
        {value}
      </div>
      <div style={{ fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: 1 }}>
        {label}
      </div>
    </div>
  );
}

function BreakdownRow({ label, value }) {
  return (
    <div style={styles.breakdownRow}>
      <span>{label}</span>
      <span style={{ fontFamily: 'monospace' }}>{value.toLocaleString()}</span>
    </div>
  );
}

function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

const styles = {
  panel: {
    position: 'absolute', top: 0, right: 0, bottom: 0,
    width: 360, background: '#111118',
    borderLeft: '1px solid #222',
    padding: 20, overflowY: 'auto',
    zIndex: 100,
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 16,
  },
  title: { fontSize: 16, fontWeight: 700, color: '#f0f0f0', margin: 0 },
  closeBtn: {
    background: 'none', border: 'none', color: '#666',
    fontSize: 16, cursor: 'pointer',
  },
  statGrid: {
    display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10,
  },
  stat: {
    background: '#0d0d18', border: '1px solid #1e1e2e', borderRadius: 10,
    padding: 14, textAlign: 'center',
  },
  sectionLabel: {
    fontSize: 11, color: '#666', textTransform: 'uppercase',
    letterSpacing: 1, marginBottom: 8,
  },
  breakdownList: {
    background: '#0d0d18', border: '1px solid #1e1e2e', borderRadius: 8,
    padding: 10,
  },
  breakdownRow: {
    display: 'flex', justifyContent: 'space-between',
    padding: '4px 0', fontSize: 12, color: '#888',
  },
  breakdownTotal: {
    display: 'flex', justifyContent: 'space-between',
    padding: '6px 0', fontSize: 12, color: '#aaa',
    borderTop: '1px solid #1e1e2e', marginTop: 6,
  },
  agentList: {
    background: '#0d0d18', border: '1px solid #1e1e2e', borderRadius: 8,
  },
  agentRow: {
    display: 'flex', justifyContent: 'space-between',
    padding: '8px 12px', borderBottom: '1px solid #141420',
  },
};
