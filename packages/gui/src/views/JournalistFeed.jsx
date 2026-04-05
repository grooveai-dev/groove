// GROOVE GUI — Journalist Feed (detail panel)
// FSL-1.1-Apache-2.0 — see LICENSE

import React, { useState, useEffect } from 'react';

export default function JournalistFeed() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchJournalist();
    const interval = setInterval(fetchJournalist, 10_000);
    return () => clearInterval(interval);
  }, []);

  async function fetchJournalist() {
    try {
      const res = await fetch('/api/journalist');
      setData(await res.json());
    } catch { /* ignore */ }
    setLoading(false);
  }

  async function triggerCycle() {
    setLoading(true);
    try {
      await fetch('/api/journalist/cycle', { method: 'POST' });
      await fetchJournalist();
    } catch { /* ignore */ }
    setLoading(false);
  }

  return (
    <div style={{ paddingTop: 4 }}>
      <div style={styles.header}>
        <span style={styles.title}>THE JOURNALIST</span>
        <button onClick={triggerCycle} disabled={loading} style={styles.btn}>
          {loading ? 'synthesizing...' : 'Run Cycle'}
        </button>
      </div>

      {/* Status */}
      <div style={styles.statusRow}>
        <span>Status: {data?.running ? 'active' : 'stopped'}</span>
        <span>Cycles: {data?.cycleCount || 0}</span>
        {data?.lastCycleAt && (
          <span>Last: {new Date(data.lastCycleAt).toLocaleTimeString()}</span>
        )}
      </div>

      {/* Latest synthesis */}
      {data?.lastSynthesis ? (
        <div>
          <div style={styles.sectionLabel}>SUMMARY</div>
          <div style={styles.textBox}>{data.lastSynthesis.summary}</div>

          {data.lastSynthesis.projectMap && (
            <>
              <div style={styles.sectionLabel}>PROJECT MAP</div>
              <pre style={styles.codeBox}>{data.lastSynthesis.projectMap}</pre>
            </>
          )}

          {data.lastSynthesis.decisions && (
            <>
              <div style={styles.sectionLabel}>DECISIONS</div>
              <pre style={styles.codeBox}>{data.lastSynthesis.decisions}</pre>
            </>
          )}
        </div>
      ) : (
        <div style={styles.empty}>
          No synthesis yet. The Journalist runs every 2 minutes when agents are active.
        </div>
      )}

      {/* History */}
      {data?.history?.length > 0 && (
        <>
          <div style={styles.sectionLabel}>HISTORY</div>
          <div style={styles.historyList}>
            {data.history.slice().reverse().map((h, i) => (
              <div key={i} style={styles.historyEntry}>
                <span style={styles.historyTime}>
                  {new Date(h.timestamp).toLocaleTimeString()}
                </span>
                <span style={styles.historyText}>
                  Cycle {h.cycle}: {h.agentCount} agent{h.agentCount !== 1 ? 's' : ''} — {h.summary?.slice(0, 80)}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const styles = {
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 10,
  },
  title: {
    fontSize: 11, fontWeight: 600, color: 'var(--text-dim)',
    textTransform: 'uppercase', letterSpacing: 1.5,
  },
  btn: {
    padding: '3px 10px',
    background: 'transparent', border: '1px solid var(--purple)',
    borderRadius: 2,
    color: 'var(--purple)', fontSize: 11, cursor: 'pointer',
    fontFamily: 'var(--font)',
  },
  statusRow: {
    display: 'flex', gap: 12, fontSize: 11, color: 'var(--text-dim)',
    marginBottom: 12, padding: '6px 0',
    borderBottom: '1px solid var(--border)',
    flexWrap: 'wrap',
  },
  sectionLabel: {
    fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase',
    letterSpacing: 1.5, marginBottom: 4, marginTop: 12, fontWeight: 600,
  },
  textBox: {
    background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 2,
    padding: 8, fontSize: 12, color: 'var(--text-primary)', lineHeight: 1.5,
  },
  codeBox: {
    background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 2,
    padding: 8, fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.5,
    whiteSpace: 'pre-wrap',
    maxHeight: 200, overflowY: 'auto', margin: 0,
  },
  empty: {
    color: 'var(--text-dim)', fontSize: 12, padding: 16, textAlign: 'center',
  },
  historyList: {
    maxHeight: 160, overflowY: 'auto',
    background: 'var(--bg-base)', borderRadius: 2,
    border: '1px solid var(--border)',
  },
  historyEntry: {
    padding: '4px 8px', borderBottom: '1px solid var(--bg-surface)',
    fontSize: 10, display: 'flex', gap: 6,
  },
  historyTime: { color: 'var(--text-dim)', whiteSpace: 'nowrap' },
  historyText: { color: 'var(--text-primary)' },
};
