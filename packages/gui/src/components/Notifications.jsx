// GROOVE GUI — Notification Toasts
// FSL-1.1-Apache-2.0 — see LICENSE

import React from 'react';
import { useGrooveStore } from '../stores/groove';

const TYPE_STYLES = {
  success: { background: '#0a2a15', borderColor: '#22c55e40', color: '#22c55e' },
  error:   { background: '#2a0a10', borderColor: '#ef444440', color: '#ef4444' },
  info:    { background: '#0a1a2a', borderColor: '#3b82f640', color: '#3b82f6' },
};

export default function Notifications() {
  const notifications = useGrooveStore((s) => s.notifications);
  const dismiss = useGrooveStore((s) => s.dismissNotification);

  if (notifications.length === 0) return null;

  return (
    <div style={styles.container}>
      {notifications.map((n) => {
        const typeStyle = TYPE_STYLES[n.type] || TYPE_STYLES.info;
        return (
          <div key={n.id} style={{ ...styles.toast, ...typeStyle }} onClick={() => dismiss(n.id)}>
            {n.text}
          </div>
        );
      })}
    </div>
  );
}

const styles = {
  container: {
    position: 'fixed', bottom: 20, right: 20,
    display: 'flex', flexDirection: 'column', gap: 8,
    zIndex: 2000,
  },
  toast: {
    padding: '10px 16px', borderRadius: 8,
    border: '1px solid', fontSize: 13,
    cursor: 'pointer', maxWidth: 320,
    animation: 'slideIn 0.2s ease',
  },
};
