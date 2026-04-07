// GROOVE GUI — Schedule Manager
// FSL-1.1-Apache-2.0 — see LICENSE

import React, { useState, useEffect, useCallback } from 'react';

const CRON_PRESETS = [
  { label: 'Every 5 min', cron: '*/5 * * * *' },
  { label: 'Every 15 min', cron: '*/15 * * * *' },
  { label: 'Every hour', cron: '0 * * * *' },
  { label: 'Every 6 hours', cron: '0 */6 * * *' },
  { label: 'Daily 9 AM', cron: '0 9 * * *' },
  { label: 'Weekdays 9 AM', cron: '0 9 * * 1-5' },
  { label: 'Weekly (Mon)', cron: '0 0 * * 1' },
  { label: 'Monthly', cron: '0 0 1 * *' },
];

const ROLE_PRESETS = [
  { id: 'backend',   label: 'Backend' },
  { id: 'frontend',  label: 'Frontend' },
  { id: 'fullstack', label: 'Fullstack' },
  { id: 'testing',   label: 'Testing' },
  { id: 'devops',    label: 'DevOps' },
  { id: 'docs',      label: 'Docs' },
  { id: 'cmo',       label: 'CMO' },
  { id: 'cfo',       label: 'CFO' },
  { id: 'ea',        label: 'EA' },
  { id: 'support',   label: 'Support' },
  { id: 'analyst',   label: 'Analyst' },
];

function timeAgo(iso) {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60000) return 'just now';
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ago`;
  if (ms < 86400000) return `${Math.floor(ms / 3600000)}h ago`;
  return `${Math.floor(ms / 86400000)}d ago`;
}

function StatusDot({ status }) {
  const colors = {
    spawned: 'var(--green)',
    skipped: 'var(--amber)',
    error: 'var(--red)',
  };
  return (
    <span style={{
      width: 6, height: 6, borderRadius: '50%',
      background: colors[status] || 'var(--text-muted)',
      display: 'inline-block', marginRight: 6,
    }} />
  );
}

// -- Create Schedule Form --
function CreateForm({ onSubmit, onCancel }) {
  const [name, setName] = useState('');
  const [cron, setCron] = useState('0 9 * * *');
  const [role, setRole] = useState('fullstack');
  const [prompt, setPrompt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) { setError('Name is required'); return; }
    if (!prompt.trim()) { setError('Task prompt is required'); return; }

    setSubmitting(true);
    setError('');
    try {
      await onSubmit({
        name: name.trim(),
        cron,
        agentConfig: { role, prompt: prompt.trim() },
      });
    } catch (err) {
      setError(err.message);
    }
    setSubmitting(false);
  }

  return (
    <form onSubmit={handleSubmit} style={styles.form}>
      <div style={styles.formTitle}>New Schedule</div>

      <label style={styles.label}>NAME</label>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g., Daily standup summary"
        style={styles.input}
      />

      <label style={styles.label}>FREQUENCY</label>
      <div style={styles.presetRow}>
        {CRON_PRESETS.map((p) => (
          <button
            key={p.cron}
            type="button"
            onClick={() => setCron(p.cron)}
            style={{
              ...styles.presetBtn,
              borderColor: cron === p.cron ? 'var(--accent)' : 'var(--border)',
              color: cron === p.cron ? 'var(--accent)' : 'var(--text-dim)',
              background: cron === p.cron ? 'rgba(51, 175, 188, 0.08)' : 'transparent',
            }}
          >
            {p.label}
          </button>
        ))}
      </div>
      <input
        value={cron}
        onChange={(e) => setCron(e.target.value)}
        placeholder="* * * * * (min hr day mon wkday)"
        style={{ ...styles.input, fontFamily: 'var(--font)', fontSize: 11 }}
      />

      <label style={styles.label}>AGENT ROLE</label>
      <div style={styles.presetRow}>
        {ROLE_PRESETS.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => setRole(r.id)}
            style={{
              ...styles.presetBtn,
              borderColor: role === r.id ? 'var(--accent)' : 'var(--border)',
              color: role === r.id ? 'var(--accent)' : 'var(--text-dim)',
              background: role === r.id ? 'rgba(51, 175, 188, 0.08)' : 'transparent',
            }}
          >
            {r.label}
          </button>
        ))}
      </div>

      <label style={styles.label}>TASK</label>
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="What should this agent do each time it runs?"
        rows={3}
        style={styles.textarea}
      />

      {error && <div style={styles.error}>{error}</div>}

      <div style={styles.formActions}>
        <button type="button" onClick={onCancel} style={styles.cancelBtn}>Cancel</button>
        <button type="submit" disabled={submitting} style={styles.submitBtn}>
          {submitting ? 'Creating...' : 'Create Schedule'}
        </button>
      </div>
    </form>
  );
}

// -- Schedule Row --
function ScheduleRow({ schedule, onToggle, onRun, onDelete, onSelect }) {
  const [confirming, setConfirming] = useState(false);

  return (
    <div
      style={styles.scheduleRow}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-surface)'; }}
    >
      <div style={styles.scheduleMain} onClick={() => onSelect(schedule)}>
        {/* Status indicator */}
        <span style={{
          width: 8, height: 8, borderRadius: '50%',
          background: schedule.enabled
            ? schedule.isRunning ? 'var(--green)' : 'var(--accent)'
            : 'var(--text-muted)',
          flexShrink: 0,
          animation: schedule.isRunning ? 'pulse 2s infinite' : 'none',
        }} />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={styles.scheduleName}>{schedule.name}</div>
          <div style={styles.scheduleMeta}>
            <span>{schedule.cronDescription || schedule.cron}</span>
            <span style={{ color: 'var(--text-muted)' }}>
              {schedule.agentConfig?.role}
            </span>
            {schedule.lastRun && (
              <span style={{ color: 'var(--text-muted)' }}>
                <StatusDot status={schedule.lastRun.status} />
                {timeAgo(schedule.lastRun.timestamp)}
              </span>
            )}
          </div>
        </div>
      </div>

      <div style={styles.scheduleActions}>
        {/* Toggle */}
        <button
          onClick={() => onToggle(schedule.id, !schedule.enabled)}
          title={schedule.enabled ? 'Disable' : 'Enable'}
          style={{
            ...styles.actionBtn,
            color: schedule.enabled ? 'var(--green)' : 'var(--text-muted)',
          }}
        >
          {schedule.enabled ? 'ON' : 'OFF'}
        </button>

        {/* Run now */}
        <button
          onClick={() => onRun(schedule.id)}
          title="Run now"
          style={{ ...styles.actionBtn, color: 'var(--accent)' }}
        >
          {'\u25B6'}
        </button>

        {/* Delete */}
        {confirming ? (
          <button
            onClick={() => { onDelete(schedule.id); setConfirming(false); }}
            style={{ ...styles.actionBtn, color: 'var(--red)' }}
          >
            confirm
          </button>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            style={{ ...styles.actionBtn, color: 'var(--text-muted)' }}
          >
            {'\u2715'}
          </button>
        )}
      </div>
    </div>
  );
}

// -- Schedule Detail --
function ScheduleDetail({ schedule, onClose }) {
  if (!schedule) return null;

  return (
    <div style={styles.detailPanel}>
      <div style={styles.detailHeader}>
        <div style={styles.detailTitle}>{schedule.name}</div>
        <button onClick={onClose} style={styles.detailClose}>&times;</button>
      </div>

      <div style={styles.detailGrid}>
        <div style={styles.detailLabel}>Cron</div>
        <div style={styles.detailValue}>{schedule.cron}</div>
        <div style={styles.detailLabel}>Description</div>
        <div style={styles.detailValue}>{schedule.cronDescription}</div>
        <div style={styles.detailLabel}>Role</div>
        <div style={styles.detailValue}>{schedule.agentConfig?.role}</div>
        <div style={styles.detailLabel}>Status</div>
        <div style={styles.detailValue}>
          <span style={{ color: schedule.enabled ? 'var(--green)' : 'var(--text-muted)' }}>
            {schedule.enabled ? 'Enabled' : 'Disabled'}
          </span>
        </div>
        <div style={styles.detailLabel}>Created</div>
        <div style={styles.detailValue}>{new Date(schedule.createdAt).toLocaleString()}</div>
      </div>

      {schedule.agentConfig?.prompt && (
        <div style={{ marginTop: 16 }}>
          <div style={styles.detailLabel}>Task Prompt</div>
          <pre style={styles.promptPre}>{schedule.agentConfig.prompt}</pre>
        </div>
      )}

      {(schedule.history || []).length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ ...styles.detailLabel, marginBottom: 8 }}>Execution History</div>
          <div style={styles.historyList}>
            {schedule.history.slice(0, 20).map((entry, i) => (
              <div key={i} style={styles.historyEntry}>
                <StatusDot status={entry.status} />
                <span style={{ fontSize: 10, color: 'var(--text-dim)', flex: 1 }}>
                  {entry.status}
                  {entry.agentId && <span style={{ color: 'var(--text-muted)' }}> ({entry.agentId})</span>}
                </span>
                <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>
                  {timeAgo(entry.timestamp)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// -- Main --
export default function ScheduleManager() {
  const [schedules, setSchedules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState(null);
  const [statusMsg, setStatusMsg] = useState('');

  const fetchSchedules = useCallback(async () => {
    try {
      const res = await fetch('/api/schedules');
      setSchedules(await res.json());
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchSchedules();
    const interval = setInterval(fetchSchedules, 10000);
    return () => clearInterval(interval);
  }, [fetchSchedules]);

  async function handleCreate(config) {
    const res = await fetch('/api/schedules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to create schedule');
    }
    setCreating(false);
    await fetchSchedules();
    flash('Schedule created');
  }

  async function handleToggle(id, enabled) {
    await fetch(`/api/schedules/${id}/${enabled ? 'enable' : 'disable'}`, { method: 'POST' });
    await fetchSchedules();
  }

  async function handleRun(id) {
    try {
      await fetch(`/api/schedules/${id}/run`, { method: 'POST' });
      flash('Agent spawned');
      await fetchSchedules();
    } catch { flash('Failed to run'); }
  }

  async function handleDelete(id) {
    await fetch(`/api/schedules/${id}`, { method: 'DELETE' });
    if (selected?.id === id) setSelected(null);
    await fetchSchedules();
    flash('Schedule deleted');
  }

  async function handleSelect(schedule) {
    try {
      const res = await fetch(`/api/schedules/${schedule.id}`);
      setSelected(await res.json());
    } catch { setSelected(schedule); }
  }

  function flash(msg) {
    setStatusMsg(msg);
    setTimeout(() => setStatusMsg(''), 3000);
  }

  return (
    <div style={styles.root}>
      {/* Header */}
      <div style={styles.headerBar}>
        <div style={styles.headerLeft}>
          <div style={styles.title}>Schedules</div>
          <span style={styles.headerCount}>
            {schedules.length} schedule{schedules.length !== 1 ? 's' : ''}
            {' \u2022 '}
            {schedules.filter((s) => s.enabled).length} active
          </span>
        </div>
        <button
          onClick={() => { setCreating(true); setSelected(null); }}
          style={styles.createBtn}
        >
          + New Schedule
        </button>
      </div>

      {statusMsg && (
        <div style={styles.statusMsg}>{statusMsg}</div>
      )}

      <div style={styles.mainRow}>
        {/* Schedule list */}
        <div style={styles.listArea}>
          {creating && (
            <CreateForm
              onSubmit={handleCreate}
              onCancel={() => setCreating(false)}
            />
          )}

          {loading && schedules.length === 0 && (
            <div style={styles.empty}>Loading schedules...</div>
          )}

          {!loading && schedules.length === 0 && !creating && (
            <div style={styles.empty}>
              <div style={{ fontSize: 13, marginBottom: 8 }}>No schedules yet</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                Create a schedule to run agents on a recurring basis — daily standups, weekly reports, monitoring checks.
              </div>
            </div>
          )}

          {schedules.map((schedule) => (
            <ScheduleRow
              key={schedule.id}
              schedule={schedule}
              onToggle={handleToggle}
              onRun={handleRun}
              onDelete={handleDelete}
              onSelect={handleSelect}
            />
          ))}
        </div>

        {/* Detail panel */}
        {selected && (
          <ScheduleDetail
            schedule={selected}
            onClose={() => setSelected(null)}
          />
        )}
      </div>
    </div>
  );
}

// -- Styles --
const styles = {
  root: {
    height: '100%', display: 'flex', flexDirection: 'column',
    overflow: 'hidden',
  },
  headerBar: {
    padding: '12px 20px',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    flexShrink: 0,
  },
  headerLeft: {
    display: 'flex', alignItems: 'center', gap: 12,
  },
  title: {
    fontSize: 15, fontWeight: 700, color: 'var(--text-bright)',
    letterSpacing: 0.3,
  },
  headerCount: {
    fontSize: 11, color: 'var(--text-muted)',
  },
  createBtn: {
    padding: '6px 14px',
    background: 'var(--accent)', color: 'var(--bg-base)',
    border: 'none', borderRadius: 6,
    fontSize: 11, fontWeight: 600, cursor: 'pointer',
    fontFamily: 'var(--font)',
  },
  statusMsg: {
    padding: '4px 20px', fontSize: 10, color: 'var(--green)',
    flexShrink: 0,
  },
  mainRow: {
    flex: 1, display: 'flex', overflow: 'hidden',
  },
  listArea: {
    flex: 1, overflowY: 'auto', padding: '0 20px 20px',
  },
  empty: {
    padding: '60px 20px', textAlign: 'center',
    color: 'var(--text-dim)', fontSize: 12,
  },

  // Schedule row
  scheduleRow: {
    display: 'flex', alignItems: 'center',
    padding: '10px 12px',
    background: 'var(--bg-surface)', border: '1px solid var(--border)',
    borderRadius: 6, marginBottom: 4, cursor: 'pointer',
    transition: 'background 0.1s',
  },
  scheduleMain: {
    display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0,
  },
  scheduleName: {
    fontSize: 12, fontWeight: 600, color: 'var(--text-bright)',
  },
  scheduleMeta: {
    display: 'flex', gap: 10, fontSize: 10, color: 'var(--text-dim)',
    marginTop: 2,
  },
  scheduleActions: {
    display: 'flex', gap: 4, flexShrink: 0,
  },
  actionBtn: {
    padding: '3px 8px',
    background: 'transparent', border: '1px solid var(--border)',
    borderRadius: 4, fontSize: 9, fontWeight: 600,
    fontFamily: 'var(--font)', cursor: 'pointer',
  },

  // Create form
  form: {
    padding: '16px',
    background: 'var(--bg-surface)', border: '1px solid var(--border)',
    borderRadius: 8, marginBottom: 12,
  },
  formTitle: {
    fontSize: 13, fontWeight: 700, color: 'var(--text-bright)',
    marginBottom: 12,
  },
  label: {
    display: 'block', fontSize: 9, fontWeight: 700,
    color: 'var(--text-muted)', letterSpacing: 0.5,
    textTransform: 'uppercase', marginTop: 10, marginBottom: 4,
  },
  input: {
    width: '100%', padding: '7px 10px',
    background: 'var(--bg-base)', border: '1px solid var(--border)',
    borderRadius: 5, color: 'var(--text-primary)', fontSize: 12,
    fontFamily: 'var(--font)', outline: 'none',
    boxSizing: 'border-box',
  },
  textarea: {
    width: '100%', padding: '7px 10px',
    background: 'var(--bg-base)', border: '1px solid var(--border)',
    borderRadius: 5, color: 'var(--text-primary)', fontSize: 12,
    fontFamily: 'var(--font)', outline: 'none', resize: 'vertical',
    boxSizing: 'border-box',
  },
  presetRow: {
    display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6,
  },
  presetBtn: {
    padding: '3px 10px',
    background: 'transparent', border: '1px solid var(--border)',
    borderRadius: 10, fontSize: 10, fontWeight: 500,
    fontFamily: 'var(--font)', cursor: 'pointer',
    transition: 'all 0.1s',
  },
  error: {
    fontSize: 11, color: 'var(--red)', marginTop: 8,
  },
  formActions: {
    display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14,
  },
  cancelBtn: {
    padding: '6px 14px',
    background: 'transparent', color: 'var(--text-dim)',
    border: '1px solid var(--border)', borderRadius: 5,
    fontSize: 11, fontWeight: 500, cursor: 'pointer',
    fontFamily: 'var(--font)',
  },
  submitBtn: {
    padding: '6px 14px',
    background: 'var(--accent)', color: 'var(--bg-base)',
    border: 'none', borderRadius: 5,
    fontSize: 11, fontWeight: 600, cursor: 'pointer',
    fontFamily: 'var(--font)',
  },

  // Detail panel
  detailPanel: {
    width: 320, flexShrink: 0,
    borderLeft: '1px solid var(--border)',
    padding: '16px', overflowY: 'auto',
  },
  detailHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 16,
  },
  detailTitle: {
    fontSize: 14, fontWeight: 700, color: 'var(--text-bright)',
  },
  detailClose: {
    background: 'none', border: 'none',
    color: 'var(--text-muted)', fontSize: 18,
    cursor: 'pointer', fontFamily: 'var(--font)',
  },
  detailGrid: {
    display: 'grid', gridTemplateColumns: '80px 1fr', gap: '6px 10px',
  },
  detailLabel: {
    fontSize: 10, fontWeight: 600, color: 'var(--text-muted)',
    textTransform: 'uppercase',
  },
  detailValue: {
    fontSize: 11, color: 'var(--text-primary)',
  },
  promptPre: {
    fontSize: 11, color: 'var(--text-primary)', lineHeight: 1.5,
    padding: '8px 10px', background: 'var(--bg-base)',
    border: '1px solid var(--border)', borderRadius: 4,
    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
    fontFamily: 'var(--font)',
    maxHeight: 200, overflowY: 'auto', marginTop: 4,
  },
  historyList: {
    display: 'flex', flexDirection: 'column', gap: 4,
  },
  historyEntry: {
    display: 'flex', alignItems: 'center', gap: 4,
    padding: '4px 8px', borderRadius: 4,
    background: 'var(--bg-base)',
  },
};
