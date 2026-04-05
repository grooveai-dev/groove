// GROOVE GUI — Token Dashboard
// FSL-1.1-Apache-2.0 — see LICENSE

import React, { useState, useEffect } from 'react';

export default function TokenDashboard() {
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

  if (!data) return <div style={styles.empty}>loading...</div>;

  const uptime = formatDuration(data.sessionDurationMs);

  return (
    <div style={styles.container}>
      <div style={styles.title}>TOKEN USAGE</div>

      {/* Stats */}
      <div style={styles.statGrid}>
        <StatCard label="Total Tokens" value={data.totalTokens.toLocaleString()} />
        <StatCard label="Agents" value={data.agentCount} />
        <StatCard label="Session" value={uptime} />
        <StatCard
          label="Savings"
          value={`${data.savings.percentage}%`}
          color={data.savings.percentage > 0 ? 'var(--green)' : 'var(--text-dim)'}
        />
      </div>

      {/* Savings breakdown */}
      {data.savings.total > 0 && (
        <div style={{ marginTop: 20 }}>
          <div style={styles.sectionLabel}>SAVINGS BREAKDOWN</div>
          <div style={styles.breakdownList}>
            <BreakdownRow label="Context rotation" value={data.savings.fromRotation} />
            <BreakdownRow label="Conflict prevention" value={data.savings.fromConflictPrevention} />
            <BreakdownRow label="Cold-start skip" value={data.savings.fromColdStartSkip} />
            <div style={styles.breakdownTotal}>
              <span>Without GROOVE (est.)</span>
              <span style={{ color: 'var(--red)' }}>
                {data.savings.estimatedWithoutGroove.toLocaleString()}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Per-agent breakdown */}
      {data.perAgent.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <div style={styles.sectionLabel}>AGENT BREAKDOWN</div>
          {data.perAgent.map((a) => {
            const pct = data.totalTokens > 0 ? (a.tokens / data.totalTokens * 100).toFixed(1) : 0;
            return (
              <div key={a.agentId} style={styles.agentRow}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                  <span style={{ color: 'var(--text-primary)', fontSize: 12 }}>{a.agentId.slice(0, 8)}</span>
                  <span style={{ color: 'var(--text-primary)', fontSize: 12 }}>
                    {a.tokens.toLocaleString()}  {pct}%
                  </span>
                </div>
                <div style={styles.barTrack}>
                  <div style={{ height: '100%', width: `${pct}%`, background: 'var(--accent)', borderRadius: 1 }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, color }) {
  return (
    <div style={styles.stat}>
      <div style={{ fontSize: 14, fontWeight: 700, color: color || 'var(--text-bright)' }}>
        {value}
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 1 }}>
        {label}
      </div>
    </div>
  );
}

function BreakdownRow({ label, value }) {
  return (
    <div style={styles.breakdownRow}>
      <span>{label}</span>
      <span>{value.toLocaleString()}</span>
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
  container: {
    padding: 24, maxWidth: 600, margin: '0 auto',
  },
  title: {
    fontSize: 11, fontWeight: 600, color: 'var(--text-dim)',
    textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 16,
  },
  statGrid: {
    display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8,
  },
  stat: {
    background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 2,
    padding: 12, textAlign: 'center',
  },
  sectionLabel: {
    fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase',
    letterSpacing: 1.5, marginBottom: 8, fontWeight: 600,
  },
  breakdownList: {
    background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 2,
    padding: 10,
  },
  breakdownRow: {
    display: 'flex', justifyContent: 'space-between',
    padding: '3px 0', fontSize: 12, color: 'var(--text-primary)',
  },
  breakdownTotal: {
    display: 'flex', justifyContent: 'space-between',
    padding: '6px 0', fontSize: 12, color: 'var(--text-bright)',
    borderTop: '1px solid var(--border)', marginTop: 6,
  },
  agentRow: {
    marginBottom: 10,
  },
  barTrack: {
    height: 3, background: 'var(--text-muted)', borderRadius: 1, overflow: 'hidden',
  },
  empty: {
    padding: 40, textAlign: 'center', color: 'var(--text-dim)', fontSize: 12,
  },
};
