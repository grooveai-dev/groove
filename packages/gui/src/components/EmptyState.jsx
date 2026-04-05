// GROOVE GUI — Empty State
// FSL-1.1-Apache-2.0 — see LICENSE

import React from 'react';
import { useGrooveStore } from '../stores/groove';

export default function EmptyState() {
  const openSpawnModal = useGrooveStore((s) => s.openSpawnModal);
  const connected = useGrooveStore((s) => s.connected);

  return (
    <div style={styles.container}>
      {!connected ? (
        <>
          <div style={styles.icon}>~</div>
          <h2 style={styles.heading}>Connecting to daemon...</h2>
          <p style={styles.sub}>
            Make sure the GROOVE daemon is running:
          </p>
          <code style={styles.code}>groove start</code>
        </>
      ) : (
        <>
          <div style={styles.icon}>+</div>
          <h2 style={styles.heading}>No agents running</h2>
          <p style={styles.sub}>
            Spawn your first agent to get started.
          </p>
          <button onClick={openSpawnModal} style={styles.spawnBtn}>
            Spawn Agent
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
    height: '100%', color: '#666', gap: 12,
    padding: 40,
  },
  icon: {
    width: 48, height: 48, borderRadius: '50%',
    background: '#1a1a2e', border: '1px solid #2a2a3e',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 24, color: '#555', marginBottom: 8,
  },
  heading: { fontSize: 20, color: '#888', fontWeight: 600, margin: 0 },
  sub: {
    fontSize: 14, maxWidth: 400, textAlign: 'center',
    lineHeight: 1.6, color: '#666',
  },
  spawnBtn: {
    padding: '12px 32px', background: '#3b82f6', border: 'none',
    borderRadius: 8, color: '#fff', fontSize: 14, fontWeight: 600,
    cursor: 'pointer', marginTop: 4,
  },
  divider: {
    fontSize: 12, color: '#444', margin: '8px 0',
  },
  code: {
    background: '#12121a', padding: '10px 20px',
    borderRadius: 8, fontSize: 13, color: '#8888cc',
    border: '1px solid #1e1e2e', fontFamily: 'monospace',
  },
};
