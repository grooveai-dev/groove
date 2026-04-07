// GROOVE GUI — Spawn Panel (detail sidebar)
// FSL-1.1-Apache-2.0 — see LICENSE

import React, { useState, useEffect } from 'react';
import { useGrooveStore } from '../stores/groove';

const ROLE_PRESETS = [
  { id: 'backend',   label: 'Backend',   desc: 'APIs, server logic, database', scope: ['src/api/**', 'src/server/**', 'src/lib/**', 'src/db/**'] },
  { id: 'frontend',  label: 'Frontend',  desc: 'UI components, views, styles', scope: ['src/components/**', 'src/views/**', 'src/pages/**', 'src/styles/**'] },
  { id: 'fullstack', label: 'Fullstack', desc: 'Full codebase access', scope: [] },
  { id: 'planner',   label: 'Planner',   desc: 'Architecture, research, planning', scope: [] },
  { id: 'testing',   label: 'Testing',   desc: 'Tests, specs, coverage', scope: ['tests/**', 'test/**', '**/*.test.*', '**/*.spec.*'] },
  { id: 'devops',    label: 'DevOps',    desc: 'Docker, CI/CD, infra', scope: ['Dockerfile*', 'docker-compose*', '.github/**', 'infra/**'] },
  { id: 'docs',      label: 'Docs',      desc: 'Documentation, READMEs', scope: ['docs/**', '*.md'] },
];

const PERMISSION_LEVELS = [
  { id: 'auto', label: 'Auto', desc: 'AI PM reviews risky operations before they happen', icon: '~' },
  { id: 'full', label: 'Full Send', desc: 'No reviews, maximum speed', icon: '>' },
];

export default function SpawnPanel() {
  const spawnAgent = useGrooveStore((s) => s.spawnAgent);
  const closeDetail = useGrooveStore((s) => s.closeDetail);

  const [role, setRole] = useState('');
  const [customRole, setCustomRole] = useState('');
  const [scope, setScope] = useState('');
  const [prompt, setPrompt] = useState('');
  const [permission, setPermission] = useState('auto');
  const [provider, setProvider] = useState('claude-code');
  const [model, setModel] = useState('auto');
  const [providerList, setProviderList] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [workingDir, setWorkingDir] = useState('');
  const [workspaces, setWorkspaces] = useState([]);
  const [connectingProvider, setConnectingProvider] = useState(null);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [keySaving, setKeySaving] = useState(false);

  useEffect(() => {
    fetchProviders();
    fetchWorkspaces();
  }, []);

  async function fetchProviders() {
    try {
      const res = await fetch('/api/providers');
      setProviderList(await res.json());
    } catch { /* ignore */ }
  }

  async function fetchWorkspaces() {
    try {
      const res = await fetch('/api/indexer/workspaces');
      const data = await res.json();
      setWorkspaces(data.workspaces || []);
    } catch { /* ignore */ }
  }

  const selectedPreset = ROLE_PRESETS.find((p) => p.id === role);
  const effectiveScope = role === 'custom'
    ? scope
    : selectedPreset?.scope.join(', ') || '';

  const isPlanner = role === 'planner';

  function handleProviderClick(p) {
    if (p.installed && (p.authType === 'subscription' || p.authType === 'local' || p.hasKey)) {
      // Ready to use
      setProvider(p.id);
      setModel('auto');
      setConnectingProvider(null);
      return;
    }
    // Needs setup — expand connection flow
    setConnectingProvider(p.id);
    setApiKeyInput('');
  }

  async function handleSaveKey() {
    if (!apiKeyInput.trim() || !connectingProvider) return;
    setKeySaving(true);
    try {
      await fetch(`/api/credentials/${connectingProvider}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: apiKeyInput.trim() }),
      });
      setApiKeyInput('');
      setConnectingProvider(null);
      setProvider(connectingProvider);
      setModel('auto');
      await fetchProviders(); // Refresh to show updated hasKey status
    } catch {
      // ignore
    }
    setKeySaving(false);
  }

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

      const finalPrompt = prompt || null;
      // Role-specific prompt prefixes (e.g., planner constraints) are now
      // applied daemon-side in process.js for consistency across all spawn paths

      await spawnAgent({
        role: finalRole,
        scope: scopeArr,
        prompt: finalPrompt,
        model: model || 'auto',
        provider,
        permission,
        ...(workingDir.trim() ? { workingDir: workingDir.trim() } : {}),
      });
      closeDetail();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  function getProviderStatus(p) {
    if (!p.installed) return 'not installed';
    if (p.authType === 'api-key' && !p.hasKey) return 'needs key';
    if (p.authType === 'subscription') return 'subscription';
    if (p.authType === 'local') return 'local';
    return 'ready';
  }

  function isProviderReady(p) {
    if (!p.installed) return false;
    if (p.authType === 'api-key' && !p.hasKey) return false;
    return true;
  }

  return (
    <div style={{ paddingTop: 4 }}>
      <div style={styles.title}>SPAWN AGENT</div>

      <form onSubmit={handleSubmit}>
        {/* Role picker */}
        <div style={styles.label}>ROLE</div>
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
              title={preset.desc}
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

        {selectedPreset && (
          <div style={styles.roleDesc}>{selectedPreset.desc}</div>
        )}

        {role === 'custom' && (
          <input
            style={{ ...styles.input, marginTop: 6 }}
            placeholder="Custom role name..."
            value={customRole}
            onChange={(e) => setCustomRole(e.target.value)}
            autoFocus
          />
        )}

        {/* Prompt */}
        <div style={styles.label}>
          {isPlanner ? 'WHAT TO PLAN' : 'TASK PROMPT'}
        </div>
        <textarea
          style={styles.textarea}
          placeholder={isPlanner
            ? 'What should this agent research or plan?'
            : 'What should this agent work on?'}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
        />

        {/* Workspace picker — visible by default when workspaces detected */}
        {workspaces.length > 0 && (
          <>
            <div style={styles.label}>DIRECTORY</div>
            <div style={styles.wsRow}>
              <button
                type="button"
                onClick={() => setWorkingDir('')}
                style={{
                  ...styles.wsBtn,
                  ...(!workingDir ? { borderColor: 'var(--accent)', color: 'var(--text-bright)' } : {}),
                }}
              >
                project root
              </button>
              {workspaces.map((ws) => (
                <button
                  key={ws.path}
                  type="button"
                  onClick={() => setWorkingDir(ws.path)}
                  style={{
                    ...styles.wsBtn,
                    ...(workingDir === ws.path ? { borderColor: 'var(--accent)', color: 'var(--text-bright)' } : {}),
                  }}
                  title={`${ws.name} (${ws.files} files)`}
                >
                  {ws.path}
                </button>
              ))}
            </div>
            <div style={styles.hint}>
              Agent spawns inside this directory and only sees this subtree
            </div>
          </>
        )}

        {/* Permissions */}
        <div style={styles.label}>PERMISSIONS</div>
        <div style={styles.permGrid}>
          {PERMISSION_LEVELS.map((perm) => (
            <button
              key={perm.id}
              type="button"
              onClick={() => setPermission(perm.id)}
              style={{
                ...styles.permBtn,
                ...(permission === perm.id ? styles.permBtnActive : {}),
              }}
            >
              <span style={styles.permIcon}>{perm.icon}</span>
              <div>
                <div style={styles.permLabel}>{perm.label}</div>
                <div style={styles.permDesc}>{perm.desc}</div>
              </div>
            </button>
          ))}
        </div>

        {/* Advanced toggle */}
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          style={styles.advancedToggle}
        >
          {showAdvanced ? '- hide advanced' : '+ advanced options'}
        </button>

        {showAdvanced && (
          <>
            {/* Working directory — manual input for custom paths */}
            <div style={styles.label}>WORKING DIRECTORY</div>
            <input
              style={styles.input}
              placeholder="e.g. packages/frontend (default: project root)"
              value={workingDir}
              onChange={(e) => setWorkingDir(e.target.value)}
            />
            <div style={styles.hint}>
              Relative path — or use the directory buttons above
            </div>

            {/* Provider selector with connection flow */}
            <div style={styles.label}>PROVIDER</div>
            {providerList.map((p) => {
              const ready = isProviderReady(p);
              const status = getProviderStatus(p);
              const isSelected = provider === p.id;
              const isConnecting = connectingProvider === p.id;

              return (
                <div key={p.id} style={{ marginBottom: 2 }}>
                  <button
                    type="button"
                    onClick={() => handleProviderClick(p)}
                    style={{
                      ...styles.providerBtn,
                      borderColor: isSelected ? 'var(--accent)' : 'var(--border)',
                      opacity: ready || isConnecting ? 1 : 0.6,
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <span style={{
                        fontSize: 12, fontWeight: 600,
                        color: isSelected ? 'var(--text-bright)' : 'var(--text-primary)',
                      }}>
                        {p.name}
                      </span>
                      <span style={styles.providerModels}>
                        {p.models.map((m) => m.name).join(', ')}
                      </span>
                    </div>
                    <span style={{
                      fontSize: 10,
                      color: ready ? 'var(--green)' : status === 'not installed' ? 'var(--text-muted)' : 'var(--amber)',
                    }}>
                      {ready ? (isSelected ? 'active' : 'ready') : status}
                    </span>
                  </button>

                  {/* Connection flow — inline expand */}
                  {isConnecting && (
                    <div style={styles.connectBox}>
                      {!p.installed && (
                        <div>
                          <div style={styles.connectLabel}>Install first:</div>
                          <code style={styles.connectCode}>{p.installCommand}</code>
                          <div style={styles.connectHint}>Run this in your terminal, then click the provider again</div>
                        </div>
                      )}
                      {p.installed && p.authType === 'api-key' && !p.hasKey && (
                        <div>
                          <div style={styles.connectLabel}>
                            API Key {p.envKey ? `(${p.envKey})` : ''}
                          </div>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <input
                              type="password"
                              style={styles.input}
                              placeholder="sk-..."
                              value={apiKeyInput}
                              onChange={(e) => setApiKeyInput(e.target.value)}
                              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleSaveKey())}
                            />
                            <button
                              type="button"
                              onClick={handleSaveKey}
                              disabled={keySaving || !apiKeyInput.trim()}
                              style={styles.connectSaveBtn}
                            >
                              {keySaving ? '...' : 'Save'}
                            </button>
                          </div>
                          <div style={styles.connectHint}>
                            Encrypted locally. Never sent to GROOVE servers.
                          </div>
                        </div>
                      )}
                      {p.installed && p.authType === 'subscription' && (
                        <div>
                          <div style={styles.connectLabel}>Subscription auth</div>
                          <div style={styles.connectHint}>
                            {p.name} uses your existing subscription. Make sure you're logged in via the CLI.
                          </div>
                        </div>
                      )}
                      {p.installed && p.authType === 'local' && (
                        <div>
                          <div style={styles.connectLabel}>Local model</div>
                          <div style={styles.connectHint}>
                            Make sure {p.name} is running locally. No API key needed.
                          </div>
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => setConnectingProvider(null)}
                        style={styles.connectCancel}
                      >
                        cancel
                      </button>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Model selector */}
            {(() => {
              const currentProvider = providerList.find((p) => p.id === provider);
              const models = currentProvider?.models || [];
              if (models.length === 0) return null;
              return (
                <>
                  <div style={styles.label}>MODEL</div>
                  <select
                    style={styles.input}
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                  >
                    <option value="auto">Auto (recommended)</option>
                    {models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} ({m.tier})
                      </option>
                    ))}
                  </select>
                </>
              );
            })()}

            {/* Scope */}
            <div style={styles.label}>FILE SCOPE</div>
            <input
              style={styles.input}
              placeholder="e.g. src/api/**, src/lib/**"
              value={role === 'custom' ? scope : effectiveScope}
              onChange={(e) => { if (role === 'custom') setScope(e.target.value); }}
              readOnly={role !== 'custom'}
            />
            <div style={styles.hint}>
              {role === 'custom'
                ? 'Comma-separated glob patterns'
                : 'Auto-set by role preset'}
            </div>
          </>
        )}

        {error && <div style={styles.error}>{error}</div>}

        <button
          type="submit"
          disabled={submitting}
          style={{
            ...styles.submitBtn,
            opacity: submitting ? 0.5 : 1,
          }}
        >
          {submitting ? 'spawning...' : isPlanner ? 'Start Planning' : 'Spawn Agent'}
        </button>
      </form>
    </div>
  );
}

const styles = {
  title: {
    fontSize: 11, fontWeight: 600, color: 'var(--text-dim)',
    textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 14,
  },
  label: {
    fontSize: 11, color: 'var(--text-dim)',
    marginBottom: 4, marginTop: 12,
    textTransform: 'uppercase', letterSpacing: 1.5, fontWeight: 600,
  },
  roleGrid: {
    display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4,
  },
  roleBtn: {
    background: 'var(--bg-surface)', border: '1px solid var(--border)',
    borderRadius: 2, padding: '6px 4px',
    color: 'var(--text-primary)', fontSize: 11, cursor: 'pointer',
    fontFamily: 'var(--font)',
    transition: 'color 0.1s, border-color 0.1s',
  },
  roleBtnActive: {
    borderColor: 'var(--accent)',
    color: 'var(--text-bright)',
  },
  roleDesc: {
    fontSize: 10, color: 'var(--text-dim)', marginTop: 4, fontStyle: 'italic',
  },
  permGrid: {
    display: 'flex', flexDirection: 'column', gap: 4,
  },
  permBtn: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '8px 10px', width: '100%',
    background: 'var(--bg-surface)', border: '1px solid var(--border)',
    borderRadius: 2, cursor: 'pointer', textAlign: 'left',
    fontFamily: 'var(--font)',
  },
  permBtnActive: {
    borderColor: 'var(--accent)',
  },
  permIcon: {
    fontSize: 14, fontWeight: 700, color: 'var(--accent)',
    width: 18, textAlign: 'center', flexShrink: 0,
  },
  permLabel: {
    fontSize: 11, color: 'var(--text-bright)', fontWeight: 600,
  },
  permDesc: {
    fontSize: 10, color: 'var(--text-dim)',
  },
  advancedToggle: {
    background: 'none', border: 'none', color: 'var(--text-dim)',
    fontSize: 10, cursor: 'pointer', fontFamily: 'var(--font)',
    padding: '8px 0', marginTop: 8,
  },
  providerBtn: {
    width: '100%', display: 'flex', alignItems: 'center', gap: 8,
    padding: '8px 10px',
    background: 'var(--bg-surface)', border: '1px solid var(--border)',
    borderRadius: 2, cursor: 'pointer', textAlign: 'left',
    fontFamily: 'var(--font)',
  },
  providerModels: {
    fontSize: 10, color: 'var(--text-dim)', marginLeft: 6,
  },
  connectBox: {
    padding: '8px 10px', margin: '2px 0 4px',
    background: 'var(--bg-base)', border: '1px solid var(--border)',
    borderRadius: 2,
  },
  connectLabel: {
    fontSize: 11, color: 'var(--text-primary)', fontWeight: 600, marginBottom: 4,
  },
  connectCode: {
    display: 'block', padding: '6px 8px',
    background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 2,
    fontSize: 11, color: 'var(--accent)', wordBreak: 'break-all',
  },
  connectHint: {
    fontSize: 10, color: 'var(--text-dim)', marginTop: 4,
  },
  connectSaveBtn: {
    padding: '6px 12px', flexShrink: 0,
    background: 'transparent', border: '1px solid var(--accent)',
    borderRadius: 2, color: 'var(--accent)', fontSize: 11, fontWeight: 600,
    fontFamily: 'var(--font)', cursor: 'pointer',
  },
  connectCancel: {
    background: 'none', border: 'none', color: 'var(--text-dim)',
    fontSize: 10, cursor: 'pointer', fontFamily: 'var(--font)',
    padding: '4px 0', marginTop: 4,
  },
  input: {
    width: '100%', background: 'var(--bg-surface)', border: '1px solid var(--border)',
    borderRadius: 2, padding: '6px 8px',
    color: 'var(--text-primary)', fontSize: 12, outline: 'none',
    fontFamily: 'var(--font)',
  },
  textarea: {
    width: '100%', background: 'var(--bg-surface)', border: '1px solid var(--border)',
    borderRadius: 2, padding: '6px 8px',
    color: 'var(--text-primary)', fontSize: 12, outline: 'none',
    fontFamily: 'var(--font)', resize: 'vertical',
  },
  hint: {
    fontSize: 10, color: 'var(--text-dim)', marginTop: 3,
  },
  wsRow: {
    display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6,
  },
  wsBtn: {
    background: 'var(--bg-surface)', border: '1px solid var(--border)',
    borderRadius: 2, padding: '3px 8px',
    color: 'var(--text-dim)', fontSize: 10, cursor: 'pointer',
    fontFamily: 'var(--font)',
    transition: 'color 0.1s, border-color 0.1s',
  },
  error: {
    color: 'var(--red)', fontSize: 11, marginTop: 8,
  },
  submitBtn: {
    width: '100%', marginTop: 14, padding: '8px',
    background: 'transparent', border: '1px solid var(--accent)',
    borderRadius: 2,
    color: 'var(--accent)', fontSize: 12, fontWeight: 600,
    fontFamily: 'var(--font)',
    cursor: 'pointer',
  },
};
