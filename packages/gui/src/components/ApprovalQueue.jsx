// GROOVE GUI — Approval Queue
// FSL-1.1-Apache-2.0 — see LICENSE

import React, { useState, useEffect } from 'react';
import { useGrooveStore } from '../stores/groove';

export default function ApprovalQueue() {
  const [data, setData] = useState(null);
  const showStatus = useGrooveStore((s) => s.showStatus);

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
    showStatus('approved');
    fetchApprovals();
  }

  async function handleReject(id) {
    await fetch(`/api/approvals/${id}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Rejected from GUI' }),
    });
    showStatus('rejected');
    fetchApprovals();
  }

  const pending = data?.pending || [];
  const resolved = data?.resolved || [];

  return (
    <div style={styles.container}>
      <div style={styles.title}>PENDING APPROVALS</div>

      {/* QC Status */}
      {data?.status && (
        <div style={styles.statusRow}>
          <span>QC: {data.status.qcActive ? 'active' : 'standby'}</span>
          <span>Conflicts: {data.status.conflicts}</span>
        </div>
      )}

      {/* Pending */}
      <div style={styles.sectionLabel}>PENDING ({pending.length})</div>
      {pending.length === 0 ? (
        <div style={styles.empty}>No pending approvals</div>
      ) : (
        pending.map((a) => (
          <div key={a.id} style={styles.card}>
            <div style={styles.cardHeader}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-bright)' }}>
                {a.agentName}
              </span>
              <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>
                {new Date(a.requestedAt).toLocaleTimeString()}
              </span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-primary)', lineHeight: 1.5, marginBottom: 8 }}>
              {a.action?.description || a.action?.type || 'Unknown action'}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => handleApprove(a.id)} style={styles.approveBtn}>
                APPROVE
              </button>
              <button onClick={() => handleReject(a.id)} style={styles.rejectBtn}>
                REJECT
              </button>
            </div>
          </div>
        ))
      )}

      {/* Recent resolved */}
      {resolved.length > 0 && (
        <>
          <div style={{ ...styles.sectionLabel, marginTop: 20 }}>RECENT</div>
          {resolved.slice(-5).reverse().map((a) => (
            <div key={a.id} style={styles.resolvedRow}>
              <span style={{ color: a.status === 'approved' ? 'var(--green)' : 'var(--red)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase' }}>
                {a.status}
              </span>
              <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>
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
  container: {
    padding: 24, maxWidth: 600, margin: '0 auto',
  },
  title: {
    fontSize: 11, fontWeight: 600, color: 'var(--text-dim)',
    textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 16,
  },
  statusRow: {
    display: 'flex', gap: 16, fontSize: 11, color: 'var(--text-dim)',
    padding: '8px 0', borderBottom: '1px solid var(--border)', marginBottom: 12,
  },
  sectionLabel: {
    fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase',
    letterSpacing: 1.5, marginBottom: 8, fontWeight: 600,
  },
  empty: { color: 'var(--text-dim)', fontSize: 12, padding: 12, textAlign: 'center' },
  card: {
    background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 2,
    padding: 12, marginBottom: 6,
  },
  cardHeader: {
    display: 'flex', justifyContent: 'space-between', marginBottom: 4,
  },
  approveBtn: {
    flex: 1, padding: '4px 10px',
    background: 'rgba(152, 195, 121, 0.12)',
    border: '1px solid rgba(152, 195, 121, 0.2)',
    borderRadius: 2,
    color: 'var(--green)', fontSize: 11, fontWeight: 600,
    fontFamily: 'var(--font)', cursor: 'pointer',
  },
  rejectBtn: {
    flex: 1, padding: '4px 10px',
    background: 'rgba(224, 108, 117, 0.12)',
    border: '1px solid rgba(224, 108, 117, 0.2)',
    borderRadius: 2,
    color: 'var(--red)', fontSize: 11, fontWeight: 600,
    fontFamily: 'var(--font)', cursor: 'pointer',
  },
  resolvedRow: {
    display: 'flex', gap: 10, padding: '4px 0',
    fontSize: 12, borderBottom: '1px solid var(--border)',
  },
};
