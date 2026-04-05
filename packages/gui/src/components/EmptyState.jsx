// GROOVE GUI — Empty State
// FSL-1.1-Apache-2.0 — see LICENSE

import React from 'react';
import { useGrooveStore } from '../stores/groove';

export default function EmptyState() {
  const openDetail = useGrooveStore((s) => s.openDetail);
  const connected = useGrooveStore((s) => s.connected);

  return (
    <div style={styles.container}>
      {!connected ? (
        <>
          <div style={styles.label}>connecting to daemon...</div>
          <div style={styles.hint}>
            Make sure the GROOVE daemon is running:
          </div>
          <code style={styles.code}>groove start</code>
        </>
      ) : (
        <>
          <div style={styles.label}>no agents running</div>
          <div style={styles.hint}>
            Spawn your first agent to get started.
          </div>
          <button onClick={() => openDetail({ type: 'spawn' })} style={styles.spawnBtn}>
            + Spawn Agent
          </button>
          <div style={styles.divider}>or from the terminal</div>
          <code style={styles.code}>
            groove spawn --role backend --prompt "Build the auth API"
          </code>
        </>
      )}
    </div>
  );
}

const styles = {
  container: {
    display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    height: '100%', color: 'var(--text-dim)', gap: 10,
    padding: 40,
  },
  label: {
    fontSize: 13, color: 'var(--text-dim)', fontWeight: 600,
    textTransform: 'uppercase', letterSpacing: 1.5,
  },
  hint: {
    fontSize: 12, maxWidth: 400, textAlign: 'center',
    lineHeight: 1.6, color: 'var(--text-dim)',
  },
  spawnBtn: {
    padding: '6px 16px',
    background: 'transparent', border: '1px solid var(--accent)',
    borderRadius: 2,
    color: 'var(--accent)', fontSize: 12, fontWeight: 600,
    fontFamily: 'var(--font)',
    cursor: 'pointer', marginTop: 4,
  },
  divider: {
    fontSize: 11, color: 'var(--text-muted)', margin: '4px 0',
  },
  code: {
    background: 'var(--bg-surface)', padding: '8px 16px',
    borderRadius: 2, fontSize: 12, color: 'var(--accent)',
    border: '1px solid var(--border)',
  },
};
