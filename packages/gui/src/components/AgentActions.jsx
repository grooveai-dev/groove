// GROOVE GUI — Agent Actions Tab
// FSL-1.1-Apache-2.0 — see LICENSE

import React, { useState, useEffect } from 'react';
import { useGrooveStore } from '../stores/groove';
// System directory browser — browses absolute paths, not limited to project dir
function SystemDirPicker({ initial, onSelect, onClose }) {
  const [currentPath, setCurrentPath] = useState(initial || '');
  const [dirs, setDirs] = useState([]);
  const [parentPath, setParentPath] = useState(null);

  useEffect(() => {
    fetch(`/api/browse-system?path=${encodeURIComponent(currentPath || '')}`)
      .then((r) => r.json())
      .then((data) => {
        setDirs(data.dirs || []);
        setParentPath(data.parent);
        if (data.current) setCurrentPath(data.current);
      })
      .catch(() => {});
  }, [currentPath]);

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 4, background: 'var(--bg-base)', marginTop: 6, maxHeight: 200, display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '4px 8px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <span style={{ fontSize: 10, color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{currentPath}</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 12, fontFamily: 'var(--font)' }}>&times;</button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {parentPath !== null && (
          <button onClick={() => setCurrentPath(parentPath)} style={{ width: '100%', padding: '4px 8px', background: 'none', border: 'none', borderBottom: '1px solid var(--border)', textAlign: 'left', cursor: 'pointer', fontFamily: 'var(--font)', fontSize: 11, color: 'var(--text-muted)' }}>
            ..
          </button>
        )}
        {dirs.map((d) => (
          <button key={d.path} onClick={() => setCurrentPath(d.path)} style={{ width: '100%', padding: '4px 8px', background: 'none', border: 'none', borderBottom: '1px solid var(--border)', textAlign: 'left', cursor: 'pointer', fontFamily: 'var(--font)', fontSize: 11, color: 'var(--text-primary)' }}>
            {d.name}{d.hasChildren ? '/' : ''}
          </button>
        ))}
      </div>
      <div style={{ padding: '4px 8px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
        <button onClick={() => { onSelect(currentPath); onClose(); }} style={{ width: '100%', padding: '4px 8px', background: 'var(--accent)', color: 'var(--bg-base)', border: 'none', borderRadius: 3, fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font)' }}>
          Select This Directory
        </button>
      </div>
    </div>
  );
}

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
  const [editingDir, setEditingDir] = useState(false);
  const [dirInput, setDirInput] = useState(agent.workingDir || '');
  const [showDirPicker, setShowDirPicker] = useState(false);
  const [providerList, setProviderList] = useState([]);
  const [installedSkills, setInstalledSkills] = useState([]);
  const [showSkillPicker, setShowSkillPicker] = useState(false);

  const isAlive = agent.status === 'running' || agent.status === 'starting';

  useEffect(() => {
    fetch('/api/providers').then(r => r.json()).then(setProviderList).catch(() => {});
    fetch('/api/skills/installed').then(r => r.json()).then(setInstalledSkills).catch(() => {});
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

  async function handleAttachSkill(skillId) {
    try {
      await fetch(`/api/agents/${agent.id}/skills/${skillId}`, { method: 'POST' });
      showStatus(`skill attached to ${agent.name}`);
    } catch (err) {
      showStatus(`attach failed: ${err.message}`);
    }
  }

  async function handleDetachSkill(skillId) {
    try {
      await fetch(`/api/agents/${agent.id}/skills/${skillId}`, { method: 'DELETE' });
      showStatus(`skill detached from ${agent.name}`);
    } catch (err) {
      showStatus(`detach failed: ${err.message}`);
    }
  }

  async function handleClone() {
    try {
      const newAgent = await spawnAgent({
        role: agent.role,
        scope: agent.scope,
        prompt: agent.prompt,
        provider: agent.provider,
        model: agent.model,
        skills: agent.skills,
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
        skills: agent.skills,
      });
      showStatus(`restarted as ${newAgent.name}`);
    } catch (err) {
      showStatus(`restart failed: ${err.message}`);
    }
  }

  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(agent.name || '');

  return (
    <div style={styles.container}>
      {/* Agent Name */}
      <div style={styles.sectionLabel}>NAME</div>
      {!editingName ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--text-bright)' }}>{agent.name}</span>
          <button onClick={() => { setEditingName(true); setNameInput(agent.name || ''); }} style={styles.editBtn}>Rename</button>
        </div>
      ) : (
        <div>
          <input style={styles.textarea} value={nameInput} onChange={(e) => setNameInput(e.target.value)}
            placeholder="Agent name..." autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && nameInput.trim()) {
                fetch(`/api/agents/${agent.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: nameInput.trim() }) });
                showStatus('renamed'); setEditingName(false);
              }
            }} />
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <button onClick={() => {
              fetch(`/api/agents/${agent.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: nameInput.trim() }) });
              showStatus('renamed'); setEditingName(false);
            }} style={styles.saveBtn} disabled={!nameInput.trim()}>Save</button>
            <button onClick={() => setEditingName(false)} style={styles.cancelBtn}>Cancel</button>
          </div>
        </div>
      )}

      {/* Lifecycle controls */}
      <div style={{ ...styles.sectionLabel, marginTop: 20 }}>LIFECYCLE</div>

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
      <div style={{ ...styles.sectionLabel, marginTop: 20 }}>
        MODEL {agent.routingMode === 'auto' && <span style={{ color: 'var(--accent)', fontWeight: 400, textTransform: 'none' }}> — auto-routed</span>}
      </div>
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

      {/* Working directory */}
      <div style={{ ...styles.sectionLabel, marginTop: 20 }}>DIRECTORY</div>
      {!editingDir ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ flex: 1, fontSize: 11, color: agent.workingDir ? 'var(--text-primary)' : 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {agent.workingDir || 'project root'}
          </div>
          <button onClick={() => { setEditingDir(true); setDirInput(agent.workingDir || ''); }} style={styles.editBtn}>
            Change
          </button>
        </div>
      ) : (
        <div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              style={{ ...styles.textarea, flex: 1 }}
              value={dirInput}
              onChange={(e) => setDirInput(e.target.value)}
              placeholder="/absolute/path/to/project"
              autoFocus
            />
            <button onClick={() => setShowDirPicker(true)} style={{ ...styles.editBtn, flexShrink: 0, marginTop: 0 }}>
              Browse
            </button>
          </div>
          {showDirPicker && (
            <SystemDirPicker
              initial={dirInput}
              onSelect={(path) => { setDirInput(path); setShowDirPicker(false); }}
              onClose={() => setShowDirPicker(false)}
            />
          )}
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <button onClick={async () => {
              try {
                await fetch(`/api/agents/${agent.id}`, {
                  method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ workingDir: dirInput.trim() || null }),
                });
                showStatus(`directory set — takes effect on next rotation/restart`);
                setEditingDir(false);
              } catch (err) { showStatus(`failed: ${err.message}`); }
            }} style={styles.saveBtn}>
              Save
            </button>
            <button onClick={() => { setEditingDir(false); setShowDirPicker(false); }} style={styles.cancelBtn}>
              Cancel
            </button>
          </div>
          <div style={styles.fieldHint}>Takes effect on next rotation or restart</div>
        </div>
      )}

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

      {/* Skills */}
      <div style={{ ...styles.sectionLabel, marginTop: 20 }}>
        SKILLS ({(agent.skills || []).length})
      </div>
      {(agent.skills || []).length > 0 ? (
        <div style={styles.skillsList}>
          {(agent.skills || []).map((skillId) => {
            const skill = installedSkills.find((s) => s.id === skillId);
            return (
              <div key={skillId} style={styles.skillRow}>
                <span style={styles.skillRowIcon}>
                  {skill?.icon || skillId.charAt(0).toUpperCase()}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: 'var(--text-primary)', fontWeight: 500 }}>
                    {skill?.name || skillId}
                  </div>
                  <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>
                    {skill?.author || 'unknown'}
                  </div>
                </div>
                <button
                  onClick={() => handleDetachSkill(skillId)}
                  style={styles.detachBtn}
                  title="Detach skill"
                >
                  {'\u2715'}
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <div style={styles.noPrompt}>No skills attached</div>
      )}
      {!showSkillPicker && installedSkills.length > 0 && (
        <button
          onClick={() => setShowSkillPicker(true)}
          style={{ ...styles.editBtn, marginTop: 6 }}
        >
          + Attach Skill
        </button>
      )}
      {showSkillPicker && (
        <div style={styles.skillPicker}>
          {installedSkills
            .filter((s) => !(agent.skills || []).includes(s.id))
            .map((skill) => (
              <button
                key={skill.id}
                onClick={() => { handleAttachSkill(skill.id); setShowSkillPicker(false); }}
                style={styles.skillPickerItem}
              >
                <span style={styles.skillRowIcon}>
                  {skill.icon || skill.name.charAt(0)}
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: 'var(--text-primary)' }}>{skill.name}</div>
                  <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>{skill.author}</div>
                </div>
              </button>
            ))}
          {installedSkills.filter((s) => !(agent.skills || []).includes(s.id)).length === 0 && (
            <div style={{ fontSize: 10, color: 'var(--text-dim)', padding: 8 }}>All installed skills are already attached</div>
          )}
          <button onClick={() => setShowSkillPicker(false)} style={styles.cancelBtn}>cancel</button>
        </div>
      )}

      {/* Current config */}
      <div style={{ ...styles.sectionLabel, marginTop: 20 }}>CONFIGURATION</div>
      <ConfigRow label="ID" value={agent.id} />
      <ConfigRow label="Role" value={agent.role} />
      <ConfigRow label="Provider" value={agent.provider} />
      <ConfigRow label="Model" value={agent.routingMode === 'auto' ? `auto (${agent.model || 'pending'})` : agent.model || 'default'} />
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
  skillsList: {
    display: 'flex', flexDirection: 'column', gap: 3,
  },
  skillRow: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '5px 8px',
    background: 'var(--bg-surface)', border: '1px solid var(--border)',
    borderRadius: 2,
  },
  skillRowIcon: {
    width: 20, height: 20, borderRadius: 4,
    background: 'var(--accent)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 9, fontWeight: 700, color: 'var(--bg-base)',
    flexShrink: 0,
  },
  detachBtn: {
    background: 'none', border: 'none',
    color: 'var(--text-muted)', fontSize: 11,
    cursor: 'pointer', fontFamily: 'var(--font)',
    padding: '2px 4px', flexShrink: 0,
  },
  skillPicker: {
    marginTop: 6, padding: 6,
    background: 'var(--bg-base)', border: '1px solid var(--border)',
    borderRadius: 2,
    display: 'flex', flexDirection: 'column', gap: 2,
    maxHeight: 180, overflowY: 'auto',
  },
  skillPickerItem: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '5px 8px', width: '100%',
    background: 'var(--bg-surface)', border: '1px solid var(--border)',
    borderRadius: 2, cursor: 'pointer', textAlign: 'left',
    fontFamily: 'var(--font)',
    transition: 'border-color 0.1s',
  },
};
