// GROOVE GUI — PM Review History (Approvals Tab)
// FSL-1.1-Apache-2.0 — see LICENSE

import React, { useState, useEffect } from 'react';

export default function ApprovalQueue() {
  const [data, setData] = useState(null);

  useEffect(() => {
    fetchHistory();
    const interval = setInterval(fetchHistory, 4000);
    return () => clearInterval(interval);
  }, []);

  async function fetchHistory() {
    try {
      const res = await fetch('/api/pm/history');
      setData(await res.json());
    } catch { /* ignore */ }
  }

  const history = data?.history || [];
  const stats = data?.stats || {};

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div style={styles.title}>PM REVIEW LOG</div>
        <div style={styles.subtitle}>AI Project Manager reviews risky agent operations in Auto mode</div>
      </div>

      {/* Stats bar */}
      <div style={styles.statsBar}>
        <Stat label="REVIEWS" value={stats.totalReviews || 0} />
        <Stat label="APPROVED" value={stats.approved || 0} color="var(--green)" />
        <Stat label="REJECTED" value={stats.rejected || 0} color="var(--red)" />
        <Stat label="AVG TIME" value={stats.avgDurationMs ? `${(stats.avgDurationMs / 1000).toFixed(1)}s` : '-'} />
      </div>

      {/* History */}
      {history.length === 0 ? (
        <div style={styles.empty}>
          <div style={styles.emptyTitle}>No reviews yet</div>
          <div style={styles.emptyDesc}>
            Spawn agents with Auto permission mode. The AI PM will review risky operations
            (new files, deletions, config changes) before they happen.
          </div>
        </div>
      ) : (
        <div style={styles.list}>
          {history.slice().reverse().map((r, i) => (
            <div key={i} style={styles.entry}>
              <div style={styles.entryTop}>
                <span style={{
                  ...styles.verdict,
                  color: r.approved ? 'var(--green)' : 'var(--red)',
                  borderColor: r.approved ? 'rgba(74,225,104,0.3)' : 'rgba(224,108,117,0.3)',
                  background: r.approved ? 'rgba(74,225,104,0.08)' : 'rgba(224,108,117,0.08)',
                }}>
                  {r.approved ? 'APPROVED' : 'REJECTED'}
                </span>
                <span style={styles.entryAgent}>{r.agent}</span>
                <span style={styles.entryAction}>{r.action}</span>
                <span style={styles.entryTime}>{timeAgo(r.timestamp)}</span>
              </div>
              <div style={styles.entryFile}>{r.file}</div>
              {r.description && <div style={styles.entryDesc}>{r.description}</div>}
              <div style={styles.entryReason}>{r.reason}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color }) {
  return (
    <div style={styles.stat}>
      <div style={{ fontSize: 16, fontWeight: 700, color: color || 'var(--text-bright)' }}>{value}</div>
      <div style={{ fontSize: 7, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 1 }}>{label}</div>
    </div>
  );
}

function timeAgo(ts) {
  const m = Math.floor((Date.now() - new Date(ts).getTime()) / 60000);
  if (m >= 60) return `${Math.floor(m / 60)}h ago`;
  if (m > 0) return `${m}m ago`;
  return 'just now';
}

const styles = {
  container: {
    padding: 24, maxWidth: 700, margin: '0 auto',
  },
  header: {
    marginBottom: 16,
  },
  title: {
    fontSize: 11, fontWeight: 700, color: 'var(--text-dim)',
    textTransform: 'uppercase', letterSpacing: 1.5,
  },
  subtitle: {
    fontSize: 10, color: 'var(--text-dim)', marginTop: 4,
  },
  statsBar: {
    display: 'flex', gap: 8, marginBottom: 16,
  },
  stat: {
    flex: 1, background: 'var(--bg-surface)', border: '1px solid var(--border)',
    padding: '8px 10px', textAlign: 'center',
  },
  empty: {
    textAlign: 'center', padding: '40px 20px',
    background: 'var(--bg-surface)', border: '1px solid var(--border)',
  },
  emptyTitle: {
    fontSize: 12, color: 'var(--text-primary)', fontWeight: 600, marginBottom: 8,
  },
  emptyDesc: {
    fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.6, maxWidth: 400, margin: '0 auto',
  },
  list: {
    display: 'flex', flexDirection: 'column', gap: 4,
  },
  entry: {
    background: 'var(--bg-surface)', border: '1px solid var(--border)',
    padding: '8px 10px',
  },
  entryTop: {
    display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4,
  },
  verdict: {
    fontSize: 8, fontWeight: 700, letterSpacing: 0.5,
    padding: '1px 5px', border: '1px solid',
  },
  entryAgent: {
    fontSize: 11, fontWeight: 600, color: 'var(--text-bright)',
  },
  entryAction: {
    fontSize: 10, color: 'var(--text-dim)',
  },
  entryTime: {
    fontSize: 9, color: 'var(--text-dim)', marginLeft: 'auto',
  },
  entryFile: {
    fontSize: 10, color: 'var(--accent)', fontFamily: 'var(--font)',
  },
  entryDesc: {
    fontSize: 10, color: 'var(--text-primary)', marginTop: 2,
  },
  entryReason: {
    fontSize: 10, color: 'var(--text-dim)', marginTop: 3, fontStyle: 'italic',
  },
};
