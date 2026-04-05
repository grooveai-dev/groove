// GROOVE GUI — Teams View (full-area, rendered in main content)
// FSL-1.1-Apache-2.0 — see LICENSE

import React, { useState, useEffect } from 'react';
import { useGrooveStore } from '../stores/groove';

export default function TeamSelector() {
  const [teams, setTeams] = useState([]);
  const [activeTeam, setActiveTeam] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveName, setSaveName] = useState('');
  const showStatus = useGrooveStore((s) => s.showStatus);

  useEffect(() => {
    fetchTeams();
    const interval = setInterval(fetchTeams, 5000);
    return () => clearInterval(interval);
  }, []);

  async function fetchTeams() {
    try {
      const res = await fetch('/api/teams');
      const data = await res.json();
      setTeams(data.teams);
      setActiveTeam(data.activeTeam);
    } catch { /* ignore */ }
  }

  async function handleLoad(name) {
    try {
      await fetch(`/api/teams/${encodeURIComponent(name)}/load`, { method: 'POST' });
      showStatus(`loaded team "${name}"`);
      fetchTeams();
    } catch {
      showStatus('failed to load team');
    }
  }

  async function handleSave() {
    if (!saveName.trim()) return;
    try {
      await fetch('/api/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: saveName.trim() }),
      });
      showStatus(`saved team "${saveName}"`);
      setSaveName('');
      setSaving(false);
      fetchTeams();
    } catch {
      showStatus('failed to save team');
    }
  }

  async function handleDelete(name) {
    await fetch(`/api/teams/${encodeURIComponent(name)}`, { method: 'DELETE' });
    showStatus(`deleted "${name}"`);
    fetchTeams();
  }

  return (
    <div style={styles.container}>
      <div style={styles.title}>SAVED TEAMS</div>

      {teams.length === 0 ? (
        <div style={styles.empty}>No saved teams</div>
      ) : (
        teams.map((t) => (
          <div
            key={t.name}
            style={{
              ...styles.item,
              background: t.name === activeTeam ? 'var(--bg-hover)' : 'transparent',
            }}
          >
            <div style={{ flex: 1 }}>
              <div style={styles.teamName}>{'>'} {t.name}</div>
              <div style={styles.teamMeta}>{t.agents} agents</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => handleLoad(t.name)} style={styles.loadBtn}>Load</button>
              <button onClick={() => handleDelete(t.name)} style={styles.deleteBtn}>x</button>
            </div>
          </div>
        ))
      )}

      <div style={styles.divider} />

      {saving ? (
        <div style={styles.saveRow}>
          <input
            style={styles.saveInput}
            placeholder="Team name..."
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSave()}
            autoFocus
          />
          <button onClick={handleSave} style={styles.saveBtn}>Save</button>
          <button onClick={() => setSaving(false)} style={styles.cancelBtn}>x</button>
        </div>
      ) : (
        <button onClick={() => setSaving(true)} style={styles.saveTeamBtn}>
          Save Current as Team
        </button>
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
  item: {
    padding: '10px 12px',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    borderBottom: '1px solid var(--border)',
  },
  teamName: { fontSize: 12, color: 'var(--text-bright)', fontWeight: 600 },
  teamMeta: { fontSize: 11, color: 'var(--text-dim)', marginTop: 2 },
  loadBtn: {
    background: 'transparent', border: 'none',
    color: 'var(--accent)', fontSize: 11, cursor: 'pointer',
    fontFamily: 'var(--font)', fontWeight: 600,
  },
  deleteBtn: {
    background: 'none', border: 'none', color: 'var(--text-dim)',
    fontSize: 12, cursor: 'pointer', fontFamily: 'var(--font)',
  },
  empty: { padding: 20, color: 'var(--text-dim)', fontSize: 12, textAlign: 'center' },
  divider: { borderTop: '1px solid var(--border)', margin: '12px 0' },
  saveTeamBtn: {
    background: 'transparent', border: '1px solid var(--accent)',
    borderRadius: 2, padding: '6px 14px',
    color: 'var(--accent)', fontSize: 12, cursor: 'pointer',
    fontFamily: 'var(--font)', fontWeight: 600,
  },
  saveRow: {
    display: 'flex', gap: 6, alignItems: 'center',
  },
  saveInput: {
    flex: 1, background: 'var(--bg-surface)', border: '1px solid var(--border)',
    borderRadius: 2, padding: '6px 8px', color: 'var(--text-primary)', fontSize: 12,
    fontFamily: 'var(--font)', outline: 'none',
  },
  saveBtn: {
    padding: '6px 12px', background: 'transparent', border: '1px solid var(--accent)',
    borderRadius: 2, color: 'var(--accent)', fontSize: 12, cursor: 'pointer',
    fontFamily: 'var(--font)',
  },
  cancelBtn: {
    background: 'none', border: 'none', color: 'var(--text-dim)',
    fontSize: 12, cursor: 'pointer', fontFamily: 'var(--font)',
  },
};
