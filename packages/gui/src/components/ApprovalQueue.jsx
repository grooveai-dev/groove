// GROOVE GUI — Approval Queue
// FSL-1.1-Apache-2.0 — see LICENSE

import React, { useState, useEffect } from 'react';
import { useGrooveStore } from '../stores/groove';

export default function ApprovalQueue({ onClose }) {
  const [data, setData] = useState(null);
  const addNotification = useGrooveStore((s) => s.addNotification);

  useEffect(() => {
    fetchApprovals();
    const interval = setInterval(fetchApprovals, 3000);
    return () => clearInterval(interval);
  }, []);

  async function fetchApprovals() {
    try {
      const res = await fetch('/api/approvals');
      setData(await res.json());
    } catch { /* ignore */ }
  }

  async function handleApprove(id) {
    await fetch(`/api/approvals/${id}/approve`, { method: 'POST' });
    addNotification('Approved', 'success');
    fetchApprovals();
  }

  async function handleReject(id) {
    await fetch(`/api/approvals/${id}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Rejected from GUI' }),
    });
    addNotification('Rejected', 'info');
    fetchApprovals();
  }

  const pending = data?.pending || [];
  const resolved = data?.resolved || [];

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <h3 style={styles.title}>Approvals</h3>
        <button onClick={onClose} style={styles.closeBtn}>x</button>
      </div>

      {/* QC Status */}
      {data?.status && (
        <div style={styles.statusRow}>
          <span>QC: {data.status.qcActive ? 'Active' : 'Standby'}</span>
          <span>Conflicts: {data.status.conflicts}</span>
        </div>
      )}

      {/* Pending */}
      <div style={styles.sectionLabel}>Pending ({pending.length})</div>
      {pending.length === 0 ? (
        <div style={styles.empty}>No pending approvals</div>
      ) : (
        pending.map((a) => (
          <div key={a.id} style={styles.card}>
            <div style={styles.cardHeader}>
              <span style={styles.agentName}>{a.agentName}</span>
              <span style={styles.cardTime}>
                {new Date(a.requestedAt).toLocaleTimeString()}
              </span>
            </div>
            <div style={styles.cardDesc}>
              {a.action?.description || a.action?.type || 'Unknown action'}
            </div>
            <div style={styles.cardActions}>
              <button onClick={() => handleApprove(a.id)} style={styles.approveBtn}>
                Approve
              </button>
              <button onClick={() => handleReject(a.id)} style={styles.rejectBtn}>
                Reject
              </button>
            </div>
          </div>
        ))
      )}

      {/* Recent resolved */}
      {resolved.length > 0 && (
        <>
          <div style={{ ...styles.sectionLabel, marginTop: 16 }}>Recent</div>
          {resolved.slice(-5).reverse().map((a) => (
            <div key={a.id} style={styles.resolvedRow}>
              <span style={{ color: a.status === 'approved' ? '#22c55e' : '#ef4444' }}>
                {a.status}
              </span>
              <span style={{ color: '#666', fontSize: 11 }}>
                {a.agentName} — {a.action?.type}
              </span>
            </div>
          ))}
        </>
      )}
    </div>
  );
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
    marginBottom: 12,
  },
  title: { fontSize: 16, fontWeight: 700, color: '#f0f0f0', margin: 0 },
  closeBtn: {
    background: 'none', border: 'none', color: '#666',
    fontSize: 16, cursor: 'pointer',
  },
  statusRow: {
    display: 'flex', gap: 16, fontSize: 11, color: '#666',
    padding: '8px 0', borderBottom: '1px solid #1e1e2e', marginBottom: 12,
  },
  sectionLabel: {
    fontSize: 11, color: '#666', textTransform: 'uppercase',
    letterSpacing: 1, marginBottom: 8,
  },
  empty: { color: '#555', fontSize: 12, padding: 12, textAlign: 'center' },
  card: {
    background: '#0d0d18', border: '1px solid #1e1e2e', borderRadius: 10,
    padding: 14, marginBottom: 8,
  },
  cardHeader: {
    display: 'flex', justifyContent: 'space-between', marginBottom: 6,
  },
  agentName: { fontSize: 13, fontWeight: 600, color: '#ddd' },
  cardTime: { fontSize: 11, color: '#555', fontFamily: 'monospace' },
  cardDesc: { fontSize: 12, color: '#999', lineHeight: 1.5, marginBottom: 10 },
  cardActions: { display: 'flex', gap: 8 },
  approveBtn: {
    flex: 1, padding: '8px', background: '#0a2a15',
    border: '1px solid #22c55e40', borderRadius: 6,
    color: '#22c55e', fontSize: 12, fontWeight: 600, cursor: 'pointer',
  },
  rejectBtn: {
    flex: 1, padding: '8px', background: '#2a0a10',
    border: '1px solid #ef444440', borderRadius: 6,
    color: '#ef4444', fontSize: 12, fontWeight: 600, cursor: 'pointer',
  },
  resolvedRow: {
    display: 'flex', gap: 10, padding: '6px 0',
    fontSize: 12, borderBottom: '1px solid #141420',
  },
};
