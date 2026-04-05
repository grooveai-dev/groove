// GROOVE GUI — Team Selector
// FSL-1.1-Apache-2.0 — see LICENSE

import React, { useState, useEffect, useRef } from 'react';
import { useGrooveStore } from '../stores/groove';

export default function TeamSelector() {
  const [teams, setTeams] = useState([]);
  const [activeTeam, setActiveTeam] = useState(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveName, setSaveName] = useState('');
  const addNotification = useGrooveStore((s) => s.addNotification);
  const ref = useRef();

  useEffect(() => {
    fetchTeams();
    const interval = setInterval(fetchTeams, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
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
      addNotification(`Loaded team "${name}"`, 'success');
      setOpen(false);
      fetchTeams();
    } catch {
      addNotification('Failed to load team', 'error');
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
      addNotification(`Saved team "${saveName}"`, 'success');
      setSaveName('');
      setSaving(false);
      fetchTeams();
    } catch {
      addNotification('Failed to save team', 'error');
    }
  }

  async function handleDelete(name, e) {
    e.stopPropagation();
    await fetch(`/api/teams/${encodeURIComponent(name)}`, { method: 'DELETE' });
    addNotification(`Deleted "${name}"`, 'info');
    fetchTeams();
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(!open)} style={styles.trigger}>
        {activeTeam ? `Team: ${activeTeam}` : 'Teams'}
      </button>

      {open && (
        <div style={styles.dropdown}>
          {teams.length > 0 ? (
            teams.map((t) => (
              <div
                key={t.name}
                onClick={() => handleLoad(t.name)}
                style={{
                  ...styles.item,
                  background: t.name === activeTeam ? '#1e3a5f20' : 'transparent',
                }}
              >
                <div>
                  <div style={styles.teamName}>{t.name}</div>
                  <div style={styles.teamMeta}>{t.agents} agents</div>
                </div>
                <button onClick={(e) => handleDelete(t.name, e)} style={styles.deleteBtn}>x</button>
              </div>
            ))
          ) : (
            <div style={styles.empty}>No saved teams</div>
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
            </div>
          ) : (
            <button onClick={() => setSaving(true)} style={styles.saveTeamBtn}>
              Save Current as Team
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const styles = {
  trigger: {
    padding: '6px 14px', background: '#1a1a2e',
    border: '1px solid #2a2a3e', borderRadius: 6,
    color: '#888', fontSize: 12, cursor: 'pointer',
  },
  dropdown: {
    position: 'absolute', top: '100%', right: 0, marginTop: 6,
    background: '#141420', border: '1px solid #2a2a3e',
    borderRadius: 10, width: 240, zIndex: 500,
    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
  },
  item: {
    padding: '10px 14px', cursor: 'pointer',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    borderBottom: '1px solid #1e1e2e',
  },
  teamName: { fontSize: 13, color: '#ddd', fontWeight: 600 },
  teamMeta: { fontSize: 11, color: '#666' },
  deleteBtn: {
    background: 'none', border: 'none', color: '#555',
    fontSize: 14, cursor: 'pointer', padding: '2px 6px',
  },
  empty: { padding: 14, color: '#555', fontSize: 12, textAlign: 'center' },
  divider: { borderTop: '1px solid #1e1e2e' },
  saveTeamBtn: {
    width: '100%', padding: '10px 14px', background: 'none',
    border: 'none', color: '#3b82f6', fontSize: 12, cursor: 'pointer',
    textAlign: 'left',
  },
  saveRow: {
    display: 'flex', padding: '8px', gap: 6,
  },
  saveInput: {
    flex: 1, background: '#0d0d18', border: '1px solid #2a2a3e',
    borderRadius: 6, padding: '6px 8px', color: '#ddd', fontSize: 12,
    outline: 'none',
  },
  saveBtn: {
    padding: '6px 12px', background: '#3b82f6', border: 'none',
    borderRadius: 6, color: '#fff', fontSize: 12, cursor: 'pointer',
  },
};
