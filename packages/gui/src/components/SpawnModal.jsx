// GROOVE GUI — Spawn Modal
// FSL-1.1-Apache-2.0 — see LICENSE

import React, { useState, useEffect } from 'react';
import { useGrooveStore } from '../stores/groove';

const ROLE_PRESETS = [
  { id: 'backend',   label: 'Backend',   scope: ['src/api/**', 'src/server/**', 'src/lib/**', 'src/db/**'] },
  { id: 'frontend',  label: 'Frontend',  scope: ['src/components/**', 'src/views/**', 'src/pages/**', 'src/styles/**'] },
  { id: 'fullstack', label: 'Fullstack', scope: [] },
  { id: 'testing',   label: 'Testing',   scope: ['tests/**', 'test/**', '**/*.test.*', '**/*.spec.*'] },
  { id: 'devops',    label: 'DevOps',    scope: ['Dockerfile*', 'docker-compose*', '.github/**', 'infra/**'] },
  { id: 'docs',      label: 'Docs',      scope: ['docs/**', '*.md'] },
];

export default function SpawnModal() {
  const closeSpawnModal = useGrooveStore((s) => s.closeSpawnModal);
  const spawnAgent = useGrooveStore((s) => s.spawnAgent);

  const [role, setRole] = useState('');
  const [customRole, setCustomRole] = useState('');
  const [scope, setScope] = useState('');
  const [prompt, setPrompt] = useState('');
  const [provider, setProvider] = useState('claude-code');
  const [model, setModel] = useState('');
  const [providerList, setProviderList] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/providers').then(r => r.json()).then(setProviderList).catch(() => {});
  }, []);

  const selectedPreset = ROLE_PRESETS.find((p) => p.id === role);
  const effectiveScope = role === 'custom'
    ? scope
    : selectedPreset?.scope.join(', ') || '';

  async function handleSubmit(e) {
    e.preventDefault();
    const finalRole = role === 'custom' ? customRole : role;
    if (!finalRole) { setError('Select a role'); return; }

    setSubmitting(true);
    setError('');

    try {
      const scopeArr = effectiveScope
        ? effectiveScope.split(',').map((s) => s.trim()).filter(Boolean)
        : [];

      await spawnAgent({
        role: finalRole,
        scope: scopeArr,
        prompt: prompt || null,
        model: model || null,
        provider,
      });
      closeSpawnModal();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={styles.overlay} onClick={closeSpawnModal}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <h2 style={styles.title}>Spawn Agent</h2>
          <button onClick={closeSpawnModal} style={styles.closeBtn}>x</button>
        </div>

        <form onSubmit={handleSubmit}>
          {/* Role picker */}
          <label style={styles.label}>Role</label>
          <div style={styles.roleGrid}>
            {ROLE_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => setRole(preset.id)}
                style={{
                  ...styles.roleBtn,
                  ...(role === preset.id ? styles.roleBtnActive : {}),
                }}
              >
                {preset.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setRole('custom')}
              style={{
                ...styles.roleBtn,
                ...(role === 'custom' ? styles.roleBtnActive : {}),
              }}
            >
              Custom
            </button>
          </div>

          {role === 'custom' && (
            <input
              style={styles.input}
              placeholder="Custom role name..."
              value={customRole}
              onChange={(e) => setCustomRole(e.target.value)}
              autoFocus
            />
          )}

          {/* Scope */}
          <label style={styles.label}>File Scope</label>
          <input
            style={styles.input}
            placeholder="e.g. src/api/**, src/lib/**"
            value={role === 'custom' ? scope : effectiveScope}
            onChange={(e) => { if (role === 'custom') setScope(e.target.value); }}
            readOnly={role !== 'custom'}
          />

          {/* Prompt */}
          <label style={styles.label}>Task Prompt</label>
          <textarea
            style={styles.textarea}
            placeholder="What should this agent work on?"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
          />

          {/* Provider */}
          <label style={styles.label}>Provider</label>
          <div style={styles.roleGrid}>
            {providerList.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => { setProvider(p.id); setModel(''); }}
                style={{
                  ...styles.roleBtn,
                  ...(provider === p.id ? styles.roleBtnActive : {}),
                  opacity: p.installed ? 1 : 0.5,
                }}
                title={p.installed ? '' : `Not installed: ${p.installCommand}`}
              >
                {p.name}
                {!p.installed && <span style={{ fontSize: 9, display: 'block', color: '#888' }}>not installed</span>}
              </button>
            ))}
          </div>

          {/* Model */}
          <label style={styles.label}>Model (optional)</label>
          <select
            style={styles.input}
            value={model}
            onChange={(e) => setModel(e.target.value)}
          >
            <option value="">Default</option>
            {(providerList.find((p) => p.id === provider)?.models || []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.tier})
              </option>
            ))}
          </select>

          {error && <div style={styles.error}>{error}</div>}

          <button
            type="submit"
            disabled={submitting}
            style={{
              ...styles.submitBtn,
              opacity: submitting ? 0.6 : 1,
            }}
          >
            {submitting ? 'Spawning...' : 'Spawn Agent'}
          </button>
        </form>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: 'fixed', inset: 0,
    background: 'rgba(0,0,0,0.7)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1000,
    backdropFilter: 'blur(4px)',
  },
  modal: {
    background: '#141420',
    border: '1px solid #2a2a3e',
    borderRadius: 14,
    padding: 28,
    width: '100%', maxWidth: 480,
    maxHeight: '90vh', overflowY: 'auto',
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 20,
  },
  title: { fontSize: 18, fontWeight: 700, color: '#f0f0f0', margin: 0 },
  closeBtn: {
    background: 'none', border: 'none', color: '#666',
    fontSize: 18, cursor: 'pointer', padding: '4px 8px',
  },
  label: {
    display: 'block', fontSize: 12, color: '#888',
    marginBottom: 6, marginTop: 16,
    textTransform: 'uppercase', letterSpacing: 1,
  },
  roleGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8,
  },
  roleBtn: {
    background: '#1a1a2e', border: '1px solid #2a2a3e',
    borderRadius: 8, padding: '8px 4px',
    color: '#aaa', fontSize: 12, cursor: 'pointer',
    transition: 'all 0.15s',
  },
  roleBtnActive: {
    background: '#1e3a5f', borderColor: '#3b82f6',
    color: '#fff',
  },
  input: {
    width: '100%', background: '#0d0d18', border: '1px solid #2a2a3e',
    borderRadius: 8, padding: '10px 12px',
    color: '#e0e0e0', fontSize: 13, outline: 'none',
    fontFamily: 'monospace',
  },
  textarea: {
    width: '100%', background: '#0d0d18', border: '1px solid #2a2a3e',
    borderRadius: 8, padding: '10px 12px',
    color: '#e0e0e0', fontSize: 13, outline: 'none',
    fontFamily: 'inherit', resize: 'vertical',
  },
  error: {
    color: '#ef4444', fontSize: 13, marginTop: 12,
  },
  submitBtn: {
    width: '100%', marginTop: 20, padding: '12px',
    background: '#3b82f6', border: 'none', borderRadius: 8,
    color: '#fff', fontSize: 14, fontWeight: 600,
    cursor: 'pointer', transition: 'opacity 0.15s',
  },
};
