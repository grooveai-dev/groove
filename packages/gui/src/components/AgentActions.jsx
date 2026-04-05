// GROOVE GUI — Agent Actions Tab
// FSL-1.1-Apache-2.0 — see LICENSE

import React, { useState, useEffect } from 'react';
import { useGrooveStore } from '../stores/groove';

export default function AgentActions({ agent }) {
  const killAgent = useGrooveStore((s) => s.killAgent);
  const rotateAgent = useGrooveStore((s) => s.rotateAgent);
  const spawnAgent = useGrooveStore((s) => s.spawnAgent);
  const instructAgent = useGrooveStore((s) => s.instructAgent);
  const showStatus = useGrooveStore((s) => s.showStatus);
  const closeDetail = useGrooveStore((s) => s.closeDetail);

  const [confirmKill, setConfirmKill] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editPrompt, setEditPrompt] = useState('');
  const [editingPrompt, setEditingPrompt] = useState(false);
  const [selectedModel, setSelectedModel] = useState(agent.model || '');
  const [providerList, setProviderList] = useState([]);

  const isAlive = agent.status === 'running' || agent.status === 'starting';

  useEffect(() => {
    fetch('/api/providers').then(r => r.json()).then(setProviderList).catch(() => {});
  }, []);

  const currentProvider = providerList.find((p) => p.id === agent.provider);
  const models = currentProvider?.models || [];

  async function handleRotate() {
    try {
      await rotateAgent(agent.id);
    } catch (err) {
      showStatus(`rotate failed: ${err.message}`);
    }
  }

  async function handleKill() {
    if (!confirmKill) {
      setConfirmKill(true);
      setTimeout(() => setConfirmKill(false), 3000);
      return;
    }
    try {
      await killAgent(agent.id);
      showStatus(`${agent.name} killed`);
    } catch (err) {
      showStatus(`kill failed: ${err.message}`);
    }
    setConfirmKill(false);
  }

  async function handleDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 3000);
      return;
    }
    try {
      await killAgent(agent.id, true);
      closeDetail();
      showStatus(`${agent.name} deleted`);
    } catch (err) {
      showStatus(`delete failed: ${err.message}`);
    }
    setConfirmDelete(false);
  }

  async function handleClone() {
    try {
      const newAgent = await spawnAgent({
        role: agent.role,
        scope: agent.scope,
        prompt: agent.prompt,
        provider: agent.provider,
        model: agent.model,
      });
      showStatus(`cloned as ${newAgent.name}`);
    } catch (err) {
      showStatus(`clone failed: ${err.message}`);
    }
  }

  async function handleModelChange(newModel) {
    setSelectedModel(newModel);
    try {
      // Model change requires rotation to take effect
      await fetch(`/api/agents/${agent.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: newModel || null }),
      });
      showStatus(`model set to ${newModel || 'default'} (takes effect on next rotation)`);
    } catch (err) {
      showStatus(`model change failed: ${err.message}`);
    }
  }

  async function handlePromptSave() {
    if (!editPrompt.trim()) return;
    try {
      // Send as an instruction — rotates agent with new prompt
      await instructAgent(agent.id, editPrompt.trim());
      setEditingPrompt(false);
      setEditPrompt('');
    } catch (err) {
      showStatus(`prompt update failed: ${err.message}`);
    }
  }

  async function handleRestart() {
    try {
      // Purge old dead entry first so name can be reused
      await killAgent(agent.id, true);
      const newAgent = await spawnAgent({
        role: agent.role,
        scope: agent.scope,
        prompt: agent.prompt,
        provider: agent.provider,
        model: agent.model,
      });
      showStatus(`restarted as ${newAgent.name}`);
    } catch (err) {
      showStatus(`restart failed: ${err.message}`);
    }
  }

  return (
    <div style={styles.container}>
      {/* Lifecycle controls */}
      <div style={styles.sectionLabel}>LIFECYCLE</div>

      <div style={styles.btnGrid}>
        {isAlive && (
          <>
            <ActionButton
              icon="~"
              label="Rotate"
              desc="Fresh context + handoff brief"
              onClick={handleRotate}
              color="var(--accent)"
            />
            <ActionButton
              icon="||"
              label={confirmKill ? 'Confirm Kill' : 'Stop'}
              desc="Stop the agent process"
              onClick={handleKill}
              color={confirmKill ? 'var(--red)' : 'var(--amber)'}
            />
          </>
        )}
        {!isAlive && (
          <ActionButton
            icon=">"
            label="Restart"
            desc="Spawn fresh with same config"
            onClick={handleRestart}
            color="var(--green)"
          />
        )}
        <ActionButton
          icon="+"
          label="Clone"
          desc="Spawn duplicate agent"
          onClick={handleClone}
          color="var(--accent)"
        />
        <ActionButton
          icon="x"
          label={confirmDelete ? 'Confirm Delete' : 'Delete'}
          desc="Kill and remove permanently"
          onClick={handleDelete}
          color={confirmDelete ? 'var(--red)' : 'var(--text-dim)'}
        />
      </div>

      {/* Model selector */}
      <div style={{ ...styles.sectionLabel, marginTop: 20 }}>MODEL</div>
      <select
        style={styles.select}
        value={selectedModel}
        onChange={(e) => handleModelChange(e.target.value)}
      >
        <option value="">Default</option>
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name} ({m.tier})
          </option>
        ))}
      </select>
      <div style={styles.fieldHint}>Changes take effect on next rotation</div>

      {/* Prompt modification */}
      <div style={{ ...styles.sectionLabel, marginTop: 20 }}>PROMPT</div>
      {agent.prompt && !editingPrompt && (
        <div style={styles.currentPrompt}>
          <div style={styles.promptText}>{agent.prompt}</div>
          {isAlive && (
            <button
              onClick={() => { setEditingPrompt(true); setEditPrompt(''); }}
              style={styles.editBtn}
            >
              Send New Instruction
            </button>
          )}
        </div>
      )}
      {!agent.prompt && !editingPrompt && (
        <div style={styles.noPrompt}>No prompt set</div>
      )}
      {editingPrompt && (
        <div>
          <textarea
            style={styles.textarea}
            value={editPrompt}
            onChange={(e) => setEditPrompt(e.target.value)}
            placeholder="New instruction for this agent..."
            rows={4}
            autoFocus
          />
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <button onClick={handlePromptSave} style={styles.saveBtn} disabled={!editPrompt.trim()}>
              Send (rotates agent)
            </button>
            <button onClick={() => setEditingPrompt(false)} style={styles.cancelBtn}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Current config */}
      <div style={{ ...styles.sectionLabel, marginTop: 20 }}>CONFIGURATION</div>
      <ConfigRow label="ID" value={agent.id} />
      <ConfigRow label="Role" value={agent.role} />
      <ConfigRow label="Provider" value={agent.provider} />
      <ConfigRow label="Model" value={agent.model || 'default'} />
      <ConfigRow label="Scope" value={(agent.scope || []).join(', ') || 'unrestricted'} />
      <ConfigRow label="Status" value={agent.status} />
    </div>
  );
}

function ActionButton({ icon, label, desc, onClick, color }) {
  return (
    <button onClick={onClick} style={{ ...styles.actionBtn, borderColor: color }}>
      <span style={{ ...styles.actionIcon, color }}>{icon}</span>
      <div>
        <div style={styles.actionTitle}>{label}</div>
        <div style={styles.actionDesc}>{desc}</div>
      </div>
    </button>
  );
}

function ConfigRow({ label, value }) {
  return (
    <div style={styles.configRow}>
      <span style={{ color: 'var(--text-dim)', fontSize: 11, minWidth: 60 }}>{label}</span>
      <span style={{
        color: 'var(--text-primary)', fontSize: 11,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {value}
      </span>
    </div>
  );
}

const styles = {
  container: {
    flex: 1, overflowY: 'auto', padding: '10px 0',
  },
  sectionLabel: {
    fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase',
    letterSpacing: 1.5, marginBottom: 8, fontWeight: 600,
  },
  btnGrid: {
    display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4,
  },
  actionBtn: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '8px 10px',
    background: 'var(--bg-surface)', border: '1px solid var(--border)',
    borderRadius: 2,
    cursor: 'pointer', textAlign: 'left',
    fontFamily: 'var(--font)',
  },
  actionIcon: {
    fontSize: 14, fontWeight: 700,
    width: 18, textAlign: 'center', flexShrink: 0,
  },
  actionTitle: {
    fontSize: 11, color: 'var(--text-primary)', fontWeight: 600,
  },
  actionDesc: {
    fontSize: 9, color: 'var(--text-dim)', marginTop: 1,
  },
  select: {
    width: '100%', background: 'var(--bg-surface)', border: '1px solid var(--border)',
    borderRadius: 2, padding: '6px 8px',
    color: 'var(--text-primary)', fontSize: 12,
    fontFamily: 'var(--font)', outline: 'none',
  },
  fieldHint: {
    fontSize: 10, color: 'var(--text-muted)', marginTop: 4,
  },
  currentPrompt: {},
  promptText: {
    background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 2,
    padding: 8, fontSize: 12, color: 'var(--text-primary)', lineHeight: 1.5,
    whiteSpace: 'pre-wrap', maxHeight: 100, overflowY: 'auto',
  },
  noPrompt: {
    fontSize: 12, color: 'var(--text-dim)', fontStyle: 'italic',
  },
  editBtn: {
    marginTop: 6, padding: '4px 10px',
    background: 'transparent', border: '1px solid var(--accent)',
    borderRadius: 2,
    color: 'var(--accent)', fontSize: 11, fontWeight: 600,
    fontFamily: 'var(--font)', cursor: 'pointer',
  },
  textarea: {
    width: '100%', background: 'var(--bg-surface)', border: '1px solid var(--border)',
    borderRadius: 2, padding: '6px 8px',
    color: 'var(--text-primary)', fontSize: 12,
    fontFamily: 'var(--font)', outline: 'none', resize: 'vertical',
  },
  saveBtn: {
    flex: 1, padding: '6px',
    background: 'transparent', border: '1px solid var(--accent)',
    borderRadius: 2, color: 'var(--accent)', fontSize: 11, fontWeight: 600,
    fontFamily: 'var(--font)', cursor: 'pointer',
  },
  cancelBtn: {
    padding: '6px 12px',
    background: 'transparent', border: '1px solid var(--border)',
    borderRadius: 2, color: 'var(--text-dim)', fontSize: 11,
    fontFamily: 'var(--font)', cursor: 'pointer',
  },
  configRow: {
    display: 'flex', gap: 8, padding: '3px 0',
    borderBottom: '1px solid var(--bg-surface)',
  },
};
