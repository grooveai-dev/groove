// GROOVE GUI — Empty State
// FSL-1.1-Apache-2.0 — see LICENSE

import React from 'react';
import { useGrooveStore } from '../stores/groove';

export default function EmptyState() {
  const openDetail = useGrooveStore((s) => s.openDetail);
  const connected = useGrooveStore((s) => s.connected);

  return (
    <div style={styles.container}>
      <div style={styles.inner}>
        {!connected ? (
          <>
            <div style={styles.pulseRing}>
              <div style={styles.pulseCore} />
            </div>
            <div style={styles.title}>Connecting to daemon...</div>
            <div style={styles.hint}>
              Make sure the GROOVE daemon is running
            </div>
            <code style={styles.code}>groove start</code>
          </>
        ) : (
          <>
            <div style={styles.readyIcon}>
              <svg width="40" height="40" viewBox="0 0 40 40">
                <circle cx="20" cy="20" r="18" fill="none" stroke="#2c313a" strokeWidth="1" />
                <circle cx="20" cy="20" r="18" fill="none" stroke="#33afbc" strokeWidth="1" strokeDasharray="113" strokeDashoffset="28" strokeLinecap="round">
                  <animateTransform attributeName="transform" type="rotate" from="0 20 20" to="360 20 20" dur="3s" repeatCount="indefinite" />
                </circle>
                <text x="20" y="24" textAnchor="middle" fill="#33afbc" fontSize="14" fontWeight="700" fontFamily="JetBrains Mono, monospace">+</text>
              </svg>
            </div>
            <div style={styles.title}>Ready to orchestrate</div>
            <div style={styles.hint}>
              Spawn your first agent to start building
            </div>
            <button onClick={() => openDetail({ type: 'spawn' })} style={styles.spawnBtn}>
              Spawn Agent
            </button>
          </>
        )}
      </div>
    </div>
  );
}

const styles = {
  container: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    height: '100%', background: '#1a1e25',
  },
  inner: {
    display: 'flex', flexDirection: 'column',
    alignItems: 'center', gap: 12,
    padding: 40,
  },
  pulseRing: {
    width: 40, height: 40,
    borderRadius: '50%',
    border: '1px solid #33afbc',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    animation: 'pulse 2s infinite',
  },
  pulseCore: {
    width: 8, height: 8, borderRadius: '50%',
    background: '#33afbc',
    boxShadow: '0 0 12px rgba(51, 175, 188, 0.5)',
  },
  readyIcon: {
    marginBottom: 4,
  },
  title: {
    fontSize: 14, color: '#e6e6e6', fontWeight: 600,
    letterSpacing: 0.5,
  },
  hint: {
    fontSize: 12, color: '#6b7280', textAlign: 'center',
    lineHeight: 1.6, maxWidth: 360,
  },
  spawnBtn: {
    padding: '8px 24px',
    background: 'rgba(51, 175, 188, 0.1)',
    border: '1px solid #33afbc',
    color: '#33afbc', fontSize: 12, fontWeight: 600,
    fontFamily: "'JetBrains Mono', monospace",
    cursor: 'pointer', marginTop: 4,
    transition: 'background 0.2s',
  },
  divider: {
    fontSize: 11, color: '#3e4451', margin: '4px 0',
  },
  code: {
    background: '#252a33', padding: '8px 16px',
    fontSize: 11, color: '#33afbc',
    border: '1px solid #2c313a',
  },
};
