// GROOVE GUI — Journalist Feed View
// FSL-1.1-Apache-2.0 — see LICENSE

import React, { useState, useEffect } from 'react';

export default function JournalistFeed({ onClose }) {
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
      const d = await res.json();
      setData(d);
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
    <div style={styles.panel}>
      <div style={styles.header}>
        <h3 style={styles.title}>The Journalist</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={triggerCycle} disabled={loading} style={styles.btn}>
            {loading ? 'Synthesizing...' : 'Run Cycle'}
          </button>
          <button onClick={onClose} style={styles.closeBtn}>x</button>
        </div>
      </div>

      {/* Status */}
      <div style={styles.statusRow}>
        <span>Status: {data?.running ? 'Active' : 'Stopped'}</span>
        <span>Cycles: {data?.cycleCount || 0}</span>
        {data?.lastCycleAt && (
          <span>Last: {new Date(data.lastCycleAt).toLocaleTimeString()}</span>
        )}
      </div>

      {/* Latest synthesis */}
      {data?.lastSynthesis ? (
        <div style={styles.synthesis}>
          <div style={styles.sectionLabel}>Summary</div>
          <div style={styles.summaryBox}>{data.lastSynthesis.summary}</div>

          {data.lastSynthesis.projectMap && (
            <>
              <div style={styles.sectionLabel}>Project Map</div>
              <pre style={styles.mapBox}>{data.lastSynthesis.projectMap}</pre>
            </>
          )}

          {data.lastSynthesis.decisions && (
            <>
              <div style={styles.sectionLabel}>Decisions</div>
              <pre style={styles.mapBox}>{data.lastSynthesis.decisions}</pre>
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
          <div style={styles.sectionLabel}>History</div>
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
  panel: {
    position: 'absolute', top: 0, right: 0, bottom: 0,
    width: 420, background: '#111118',
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
    fontSize: 16, cursor: 'pointer', padding: '2px 6px',
  },
  btn: {
    padding: '5px 12px', background: '#1e3a5f',
    border: '1px solid #3b82f640', borderRadius: 6,
    color: '#3b82f6', fontSize: 11, cursor: 'pointer',
  },
  statusRow: {
    display: 'flex', gap: 16, fontSize: 11, color: '#666',
    marginBottom: 16, padding: '8px 0',
    borderBottom: '1px solid #1e1e2e',
  },
  sectionLabel: {
    fontSize: 11, color: '#666', textTransform: 'uppercase',
    letterSpacing: 1, marginBottom: 6, marginTop: 14,
  },
  summaryBox: {
    background: '#0d0d18', border: '1px solid #1e1e2e', borderRadius: 8,
    padding: 12, fontSize: 13, color: '#bbb', lineHeight: 1.5,
  },
  mapBox: {
    background: '#0a0a12', border: '1px solid #1e1e2e', borderRadius: 8,
    padding: 12, fontSize: 11, color: '#888', lineHeight: 1.5,
    whiteSpace: 'pre-wrap', fontFamily: 'monospace',
    maxHeight: 300, overflowY: 'auto',
  },
  empty: {
    color: '#555', fontSize: 13, padding: 20, textAlign: 'center',
  },
  historyList: {
    maxHeight: 200, overflowY: 'auto',
    background: '#0a0a12', borderRadius: 8,
    border: '1px solid #1e1e2e',
  },
  historyEntry: {
    padding: '6px 10px', borderBottom: '1px solid #141420',
    fontSize: 11, display: 'flex', gap: 8,
  },
  historyTime: { color: '#555', whiteSpace: 'nowrap', fontFamily: 'monospace' },
  historyText: { color: '#888' },
};
