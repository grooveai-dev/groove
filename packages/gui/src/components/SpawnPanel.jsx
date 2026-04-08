// GROOVE GUI — Spawn Panel (full-screen agent configurator)
// FSL-1.1-Apache-2.0 — see LICENSE

import React, { useState, useEffect, useRef } from 'react';
import { useGrooveStore } from '../stores/groove';
import DirPicker from './DirPicker';
import { FormattedText } from './AgentChat';

const ROLE_PRESETS = [
  { id: 'backend',   label: 'Backend',   desc: 'APIs, server logic, database', scope: ['src/api/**', 'src/server/**', 'src/lib/**', 'src/db/**'], category: 'coding' },
  { id: 'frontend',  label: 'Frontend',  desc: 'UI components, views, styles', scope: ['src/components/**', 'src/views/**', 'src/pages/**', 'src/styles/**'], category: 'coding' },
  { id: 'fullstack', label: 'Fullstack', desc: 'Full codebase access', scope: [], category: 'coding' },
  { id: 'planner',   label: 'Planner',   desc: 'Architecture, research, planning', scope: [], category: 'coding' },
  { id: 'testing',   label: 'Testing',   desc: 'Tests, specs, coverage', scope: ['tests/**', 'test/**', '**/*.test.*', '**/*.spec.*'], category: 'coding' },
  { id: 'devops',    label: 'DevOps',    desc: 'Docker, CI/CD, infra', scope: ['Dockerfile*', 'docker-compose*', '.github/**', 'infra/**'], category: 'coding' },
  { id: 'docs',      label: 'Docs',      desc: 'Documentation, READMEs', scope: ['docs/**', '*.md'], category: 'coding' },
  { id: 'cmo',       label: 'CMO',       desc: 'Marketing, social media, content', scope: [], category: 'business', integrations: ['slack', 'brave-search'] },
  { id: 'cfo',       label: 'CFO',       desc: 'Finance, billing, revenue', scope: [], category: 'business', integrations: ['stripe', 'google-drive'] },
  { id: 'ea',        label: 'EA',        desc: 'Scheduling, email, comms', scope: [], category: 'business', integrations: ['gmail', 'google-calendar', 'slack'] },
  { id: 'support',   label: 'Support',   desc: 'Customer support, triage', scope: [], category: 'business', integrations: ['slack', 'discord'] },
  { id: 'analyst',   label: 'Analyst',   desc: 'Data analysis, reporting', scope: [], category: 'business', integrations: ['postgres', 'google-drive'] },
  { id: 'home',      label: 'Home',      desc: 'Smart home automation', scope: [], category: 'business', integrations: ['home-assistant'] },
];

const PERMISSION_LEVELS = [
  { id: 'auto', label: 'Auto', desc: 'AI PM reviews risky operations', icon: '~' },
  { id: 'full', label: 'Full Send', desc: 'No reviews, max speed', icon: '>' },
];

const CRON_PRESETS = [
  { value: '*/30 * * * *', label: 'Every 30 min' },
  { value: '0 * * * *', label: 'Every hour' },
  { value: '0 */6 * * *', label: 'Every 6 hours' },
  { value: '0 9 * * *', label: 'Daily 9 AM' },
  { value: '0 9 * * 1-5', label: 'Weekdays 9 AM' },
  { value: '0 0 * * 1', label: 'Weekly Mon' },
  { value: '0 0 1 * *', label: 'Monthly' },
];

export default function SpawnPanel() {
  const spawnAgent = useGrooveStore((s) => s.spawnAgent);
  const closeDetail = useGrooveStore((s) => s.closeDetail);

  // Config state
  const [role, setRole] = useState('');
  const [customRole, setCustomRole] = useState('');
  const [scope, setScope] = useState('');
  const [prompt, setPrompt] = useState('');
  const [permission, setPermission] = useState('auto');
  const [provider, setProvider] = useState('claude-code');
  const [model, setModel] = useState('auto');
  const [effort, setEffort] = useState('high');
  const [providerList, setProviderList] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [workingDir, setWorkingDir] = useState('');
  const [workspaces, setWorkspaces] = useState([]);
  const [connectingProvider, setConnectingProvider] = useState(null);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [keySaving, setKeySaving] = useState(false);
  const [showDirPicker, setShowDirPicker] = useState(false);
  const [installedSkills, setInstalledSkills] = useState([]);
  const [selectedSkills, setSelectedSkills] = useState([]);
  const [installedIntegrations, setInstalledIntegrations] = useState([]);
  const [selectedIntegrations, setSelectedIntegrations] = useState([]);

  // API key state
  const [hasApiKey, setHasApiKey] = useState(false);
  const [showApiKeyInput, setShowApiKeyInput] = useState(false);
  const [apiKeyValue, setApiKeyValue] = useState('');
  const [apiKeySaving, setApiKeySaving] = useState(false);

  // Schedule state
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduleCron, setScheduleCron] = useState('0 9 * * *');
  const [scheduleName, setScheduleName] = useState('');

  // Plan chat state
  const [planMode, setPlanMode] = useState(false);
  const [planMessages, setPlanMessages] = useState([]);
  const [planInput, setPlanInput] = useState('');
  const [planLoading, setPlanLoading] = useState(false);
  const [planResearching, setPlanResearching] = useState(false);
  const chatEndRef = useRef(null);

  useEffect(() => {
    fetchProviders();
    fetchWorkspaces();
    fetchInstalledSkills();
    fetchInstalledIntegrations();
    fetch('/api/anthropic-key/status').then((r) => r.json()).then((d) => setHasApiKey(d.configured)).catch(() => {});
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [planMessages, planLoading]);

  async function fetchProviders() {
    try { const res = await fetch('/api/providers'); setProviderList(await res.json()); } catch { /* */ }
  }
  async function fetchWorkspaces() {
    try { const res = await fetch('/api/indexer/workspaces'); const d = await res.json(); setWorkspaces(d.workspaces || []); } catch { /* */ }
  }
  async function fetchInstalledSkills() {
    try { const res = await fetch('/api/skills/installed'); setInstalledSkills(await res.json()); } catch { /* */ }
  }
  async function fetchInstalledIntegrations() {
    try { const res = await fetch('/api/integrations/installed'); setInstalledIntegrations(await res.json()); } catch { /* */ }
  }

  function toggleSkill(id) { setSelectedSkills((p) => p.includes(id) ? p.filter((s) => s !== id) : [...p, id]); }
  function toggleIntegration(id) { setSelectedIntegrations((p) => p.includes(id) ? p.filter((s) => s !== id) : [...p, id]); }

  useEffect(() => {
    const preset = ROLE_PRESETS.find((p) => p.id === role);
    if (preset?.integrations && installedIntegrations.length > 0) {
      const autoSelect = preset.integrations.filter((id) =>
        installedIntegrations.some((i) => i.id === id && i.configured)
      );
      setSelectedIntegrations(autoSelect);
    }
  }, [role, installedIntegrations]);

  const selectedPreset = ROLE_PRESETS.find((p) => p.id === role);
  const effectiveScope = role === 'custom' ? scope : selectedPreset?.scope.join(', ') || '';
  const isPlanner = role === 'planner';

  function handleProviderClick(p) {
    if (p.installed && (p.authType === 'subscription' || p.authType === 'local' || p.hasKey)) {
      setProvider(p.id); setModel('auto'); setConnectingProvider(null); return;
    }
    setConnectingProvider(p.id); setApiKeyInput('');
  }

  async function handleSaveKey() {
    if (!apiKeyInput.trim() || !connectingProvider) return;
    setKeySaving(true);
    try {
      await fetch(`/api/credentials/${connectingProvider}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: apiKeyInput.trim() }),
      });
      setApiKeyInput(''); setConnectingProvider(null); setProvider(connectingProvider); setModel('auto');
      await fetchProviders();
    } catch { /* */ }
    setKeySaving(false);
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

  // --- Plan chat (Haiku triages: fast for chat, deep for research) ---
  async function handlePlanSend() {
    if (!planInput.trim() || planLoading) return;
    const userMsg = planInput.trim();
    setPlanInput('');
    setPlanMessages((prev) => [...prev, { from: 'user', text: userMsg }]);
    setPlanLoading(true);
    setPlanResearching(false);

    try {
      const finalRole = role === 'custom' ? customRole : role;
      const context = [
        finalRole ? `Agent role: ${finalRole}` : null,
        prompt ? `Current task prompt: ${prompt}` : null,
      ].filter(Boolean).join('\n');

      const history = planMessages.map((m) => `${m.from === 'user' ? 'User' : 'AI'}: ${m.text}`).join('\n');
      const res = await fetch('/api/journalist/query', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: `${context}\n\n${history}\nUser: ${userMsg}\n\nRespond helpfully:` }),
      });
      const data = await res.json();

      if (data.mode === 'research') {
        // Research mode took longer but we got the deep response
        setPlanMessages((prev) => [...prev, { from: 'ai', text: data.response || 'No response', mode: 'research' }]);
      } else {
        setPlanMessages((prev) => [...prev, { from: 'ai', text: data.response || data.error || 'No response' }]);
      }
    } catch {
      setPlanMessages((prev) => [...prev, { from: 'ai', text: 'Failed to reach AI. Write your prompt directly.' }]);
    }
    setPlanLoading(false);
    setPlanResearching(false);
  }

  async function applyPlanToPrompt() {
    // Ask AI to synthesize the conversation into a clean, actionable agent prompt
    setPlanLoading(true);
    try {
      const conversation = planMessages.map((m) => `${m.from === 'user' ? 'User' : 'AI'}: ${m.text}`).join('\n\n');
      const finalRole = role === 'custom' ? customRole : role;
      const res = await fetch('/api/journalist/query', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: `Synthesize the following planning conversation into a clean, structured prompt for a ${finalRole || 'coding'} agent. Output ONLY the prompt — no preamble, no explanation, just the actual content the agent should receive.

CRITICAL: The prompt MUST include the SPECIFIC TASK or feature to work on — extracted from the conversation. Don't just define the agent's role. Tell it exactly what to build/plan/do. Structure it as:
1. Brief role context (2-3 sentences max)
2. The specific task/feature (this is the main content)
3. Requirements, constraints, acceptance criteria
4. Any relevant details discussed

Conversation:\n${conversation}`,
        }),
      });
      const data = await res.json();
      if (data.response) {
        setPrompt(data.response);
        setPlanMode(false);
      }
    } catch {
      // Fallback: use last AI message
      const lastAi = [...planMessages].reverse().find((m) => m.from === 'ai');
      if (lastAi) setPrompt(lastAi.text);
      setPlanMode(false);
    }
    setPlanLoading(false);
  }

  // --- Submit ---
  async function handleSubmit(e) {
    e.preventDefault();
    const finalRole = role === 'custom' ? customRole : role;
    if (!finalRole) { setError('Select a role'); return; }
    setSubmitting(true); setError('');

    try {
      const scopeArr = effectiveScope ? effectiveScope.split(',').map((s) => s.trim()).filter(Boolean) : [];
      const agentConfig = {
        role: finalRole, scope: scopeArr, prompt: prompt || null,
        model: model || 'auto', provider, permission, effort,
        ...(workingDir.trim() ? { workingDir: workingDir.trim() } : {}),
        ...(selectedSkills.length > 0 ? { skills: selectedSkills } : {}),
        ...(selectedIntegrations.length > 0 ? { integrations: selectedIntegrations } : {}),
      };

      if (scheduleEnabled) {
        await fetch('/api/schedules', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: scheduleName.trim() || `${finalRole}-schedule`,
            cron: scheduleCron,
            agentConfig: { role: finalRole, prompt: prompt || null },
          }),
        });
      }
      await spawnAgent(agentConfig);
      closeDetail();
    } catch (err) { setError(err.message); }
    finally { setSubmitting(false); }
  }

  // ========== RENDER ==========

  return (
    <div style={S.overlay}>
      <div style={S.container}>
        {/* Header bar */}
        <div style={S.header}>
          <div style={S.headerTitle}>Spawn Agent</div>
          <div style={S.headerRight}>
            {error && <span style={S.headerError}>{error}</span>}
            <button
              onClick={handleSubmit}
              disabled={submitting || !role}
              style={{ ...S.spawnBtn, opacity: submitting || !role ? 0.4 : 1 }}
            >
              {submitting ? 'Spawning...'
                : scheduleEnabled ? 'Spawn + Schedule'
                : isPlanner ? 'Start Planning' : 'Spawn Agent'}
            </button>
            <button onClick={closeDetail} style={S.closeBtn}>&times;</button>
          </div>
        </div>

        {/* Two-panel body */}
        <div style={S.body}>
          {/* LEFT — Config */}
          <div style={S.left}>
            <div style={S.leftScroll}>
              {/* Roles */}
              <Section label="Role">
                <div style={S.roleGrid}>
                  {ROLE_PRESETS.filter((p) => p.category === 'coding').map((p) => (
                    <RoleBtn key={p.id} preset={p} active={role === p.id} onClick={() => setRole(p.id)} />
                  ))}
                </div>
                <div style={{ ...S.sectionSub, marginTop: 8 }}>Business</div>
                <div style={S.roleGrid}>
                  {ROLE_PRESETS.filter((p) => p.category === 'business').map((p) => (
                    <RoleBtn key={p.id} preset={p} active={role === p.id} onClick={() => setRole(p.id)} />
                  ))}
                  <button type="button" onClick={() => setRole('custom')}
                    style={{ ...S.roleBtn, ...(role === 'custom' ? S.roleBtnActive : {}) }}>
                    Custom
                  </button>
                </div>
                {role === 'custom' && (
                  <input style={{ ...S.input, marginTop: 6 }} placeholder="Custom role name..."
                    value={customRole} onChange={(e) => setCustomRole(e.target.value)} autoFocus />
                )}
                {selectedPreset && <div style={S.hint}>{selectedPreset.desc}</div>}
              </Section>

              {/* Directory */}
              <Section label="Directory">
                <div style={S.chipRow}>
                  <Chip label="project root" active={!workingDir} onClick={() => setWorkingDir('')} />
                  {workspaces.map((ws) => (
                    <Chip key={ws.path} label={ws.path} active={workingDir === ws.path}
                      onClick={() => setWorkingDir(ws.path)} />
                  ))}
                  <button type="button" onClick={() => setShowDirPicker(true)} style={S.browseBtn}>Browse...</button>
                </div>
                {showDirPicker && (
                  <DirPicker initial={workingDir} onSelect={(p) => setWorkingDir(p)} onClose={() => setShowDirPicker(false)} />
                )}
              </Section>

              {/* Permissions */}
              <Section label="Permissions">
                <div style={{ display: 'flex', gap: 6 }}>
                  {PERMISSION_LEVELS.map((perm) => (
                    <button key={perm.id} type="button" onClick={() => setPermission(perm.id)}
                      style={{ ...S.permBtn, ...(permission === perm.id ? S.permBtnActive : {}) }}>
                      <span style={S.permIcon}>{perm.icon}</span>
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 600, color: permission === perm.id ? 'var(--text-bright)' : 'var(--text-primary)' }}>{perm.label}</div>
                        <div style={{ fontSize: 9, color: 'var(--text-dim)' }}>{perm.desc}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </Section>

              {/* Effort */}
              <Section label="Effort">
                <div style={S.chipRow}>
                  {[
                    { id: 'low', label: 'Low', desc: 'Quick tasks' },
                    { id: 'medium', label: 'Medium', desc: 'Standard' },
                    { id: 'high', label: 'High', desc: 'Comprehensive' },
                    { id: 'max', label: 'Max', desc: 'Deep reasoning' },
                  ].map((e) => (
                    <button key={e.id} type="button" onClick={() => setEffort(e.id)}
                      title={e.desc}
                      style={{
                        ...S.chip, flex: 1, textAlign: 'center', padding: '5px 4px',
                        ...(effort === e.id ? { borderColor: 'var(--accent)', color: 'var(--text-bright)', background: 'rgba(51, 175, 188, 0.08)' } : {}),
                      }}>
                      {e.label}
                    </button>
                  ))}
                </div>
              </Section>

              {/* Integrations */}
              {installedIntegrations.length > 0 && (
                <Section label={`Integrations (${selectedIntegrations.length})`}>
                  <div style={S.itemList}>
                    {installedIntegrations.map((item) => {
                      const active = selectedIntegrations.includes(item.id);
                      const ready = item.configured;
                      return (
                        <ItemBtn key={item.id} name={item.name} active={active}
                          sub={ready ? 'connected' : 'needs setup'} subColor={ready ? 'var(--green)' : 'var(--amber)'}
                          disabled={!ready} onClick={() => ready && toggleIntegration(item.id)} />
                      );
                    })}
                  </div>
                </Section>
              )}

              {/* Skills */}
              {installedSkills.length > 0 && (
                <Section label={`Skills (${selectedSkills.length})`}>
                  <div style={S.itemList}>
                    {installedSkills.map((skill) => {
                      const active = selectedSkills.includes(skill.id);
                      return (
                        <ItemBtn key={skill.id} name={skill.name} active={active}
                          sub={skill.author || 'local'} onClick={() => toggleSkill(skill.id)} />
                      );
                    })}
                  </div>
                </Section>
              )}

              {/* Schedule */}
              <Section label="Schedule">
                <button type="button" onClick={() => setScheduleEnabled(!scheduleEnabled)}
                  style={{ ...S.toggleBtn, borderColor: scheduleEnabled ? 'var(--accent)' : 'var(--border)' }}>
                  <span style={{ ...S.checkbox, background: scheduleEnabled ? 'var(--accent)' : 'transparent',
                    borderColor: scheduleEnabled ? 'var(--accent)' : 'var(--border)' }}>
                    {scheduleEnabled ? '\u2713' : ''}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-primary)' }}>Recurring schedule</span>
                </button>
                {scheduleEnabled && (
                  <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <input style={S.input} placeholder={`${role || 'agent'}-daily`}
                      value={scheduleName} onChange={(e) => setScheduleName(e.target.value)} />
                    <div style={S.chipRow}>
                      {CRON_PRESETS.map((c) => (
                        <Chip key={c.value} label={c.label} active={scheduleCron === c.value}
                          onClick={() => setScheduleCron(c.value)} />
                      ))}
                    </div>
                  </div>
                )}
              </Section>

              {/* API Key — enables fast plan chat */}
              <Section label="Anthropic API Key">
                {hasApiKey ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 11, color: 'var(--green)' }}>Connected — fast plan chat enabled</span>
                    <button type="button" onClick={async () => {
                      await fetch('/api/credentials/anthropic-api', { method: 'DELETE' });
                      setHasApiKey(false);
                    }} style={{ ...S.cancelBtn, fontSize: 9 }}>remove</button>
                  </div>
                ) : showApiKeyInput ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.5 }}>
                      Enables instant plan chat responses. Get a key from console.anthropic.com
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <input type="text" autoComplete="off" data-lpignore="true" data-1p-ignore style={{ ...S.input, flex: 1, WebkitTextSecurity: 'disc' }} placeholder="sk-ant-..."
                        value={apiKeyValue} onChange={(e) => setApiKeyValue(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && apiKeyValue && (async () => {
                          setApiKeySaving(true);
                          await fetch('/api/credentials/anthropic-api', {
                            method: 'POST', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ key: apiKeyValue }),
                          });
                          setHasApiKey(true); setShowApiKeyInput(false); setApiKeyValue('');
                          setApiKeySaving(false);
                        })()} />
                      <button type="button" disabled={!apiKeyValue || apiKeySaving} onClick={async () => {
                        setApiKeySaving(true);
                        await fetch('/api/credentials/anthropic-api', {
                          method: 'POST', headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ key: apiKeyValue }),
                        });
                        setHasApiKey(true); setShowApiKeyInput(false); setApiKeyValue('');
                        setApiKeySaving(false);
                      }} style={{ ...S.saveKeyBtn, opacity: !apiKeyValue ? 0.4 : 1 }}>
                        {apiKeySaving ? '...' : 'Save'}
                      </button>
                    </div>
                    <button type="button" onClick={() => setShowApiKeyInput(false)} style={S.cancelBtn}>cancel</button>
                  </div>
                ) : (
                  <button type="button" onClick={() => setShowApiKeyInput(true)} style={{
                    ...S.chip, width: '100%', textAlign: 'center', padding: '6px',
                    color: 'var(--accent)', borderColor: 'var(--accent)',
                  }}>
                    Add API key for instant responses
                  </button>
                )}
              </Section>

              {/* Advanced */}
              <button type="button" onClick={() => setShowAdvanced(!showAdvanced)} style={S.advToggle}>
                {showAdvanced ? '- hide advanced' : '+ advanced'}
              </button>
              {showAdvanced && (
                <>
                  <Section label="Provider">
                    {providerList.map((p) => {
                      const ready = isProviderReady(p);
                      const status = getProviderStatus(p);
                      const isSelected = provider === p.id;
                      const isConnecting = connectingProvider === p.id;
                      return (
                        <div key={p.id} style={{ marginBottom: 3 }}>
                          <button type="button" onClick={() => handleProviderClick(p)}
                            style={{ ...S.providerBtn, borderColor: isSelected ? 'var(--accent)' : 'var(--border)', opacity: ready || isConnecting ? 1 : 0.5 }}>
                            <span style={{ fontSize: 11, fontWeight: 600, color: isSelected ? 'var(--text-bright)' : 'var(--text-primary)' }}>{p.name}</span>
                            <span style={{ fontSize: 10, color: ready ? 'var(--green)' : 'var(--text-dim)', marginLeft: 'auto' }}>{ready ? (isSelected ? 'active' : 'ready') : status}</span>
                          </button>
                          {isConnecting && (
                            <div style={S.connectBox}>
                              {!p.installed && <div><code style={S.code}>{p.installCommand}</code></div>}
                              {p.installed && p.authType === 'api-key' && !p.hasKey && (
                                <div style={{ display: 'flex', gap: 4 }}>
                                  <input type="password" style={{ ...S.input, flex: 1 }} placeholder={`${p.envKey || 'API key'}...`}
                                    value={apiKeyInput} onChange={(e) => setApiKeyInput(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && handleSaveKey()} />
                                  <button type="button" onClick={handleSaveKey} style={S.saveKeyBtn}>{keySaving ? '...' : 'Save'}</button>
                                </div>
                              )}
                              <button type="button" onClick={() => setConnectingProvider(null)} style={S.cancelBtn}>cancel</button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </Section>
                  <Section label="Model">
                    {(() => {
                      const models = providerList.find((p) => p.id === provider)?.models || [];
                      if (!models.length) return <div style={S.hint}>Select a provider first</div>;
                      return (
                        <select style={S.input} value={model} onChange={(e) => setModel(e.target.value)}>
                          <option value="auto">Auto (recommended)</option>
                          {models.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.tier})</option>)}
                        </select>
                      );
                    })()}
                  </Section>
                  <Section label="File Scope">
                    <input style={S.input} placeholder="e.g. src/api/**, src/lib/**"
                      value={role === 'custom' ? scope : effectiveScope}
                      onChange={(e) => { if (role === 'custom') setScope(e.target.value); }}
                      readOnly={role !== 'custom'} />
                    <div style={S.hint}>{role === 'custom' ? 'Comma-separated glob patterns' : 'Auto-set by role'}</div>
                  </Section>
                </>
              )}
            </div>
          </div>

          {/* RIGHT — Prompt + Plan chat */}
          <div style={S.right}>
            {!planMode ? (
              /* Prompt-only mode */
              <div style={S.promptPanel}>
                <div style={S.promptHeader}>
                  <span style={S.promptLabel}>{isPlanner ? 'WHAT TO PLAN' : 'TASK PROMPT'}</span>
                  <button type="button" onClick={() => setPlanMode(true)} style={S.planBtn}>
                    Plan with AI
                  </button>
                </div>
                <textarea
                  style={S.promptArea}
                  placeholder={isPlanner
                    ? 'What should this agent research or plan?\n\nBe specific about scope, constraints, and expected output...'
                    : 'Describe the task in detail.\n\nThe more context you provide here, the fewer iterations the agent will need. Include:\n- What to build or change\n- Key requirements and constraints\n- Expected behavior or output\n- Any files or areas to focus on'}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                />
              </div>
            ) : (
              /* Plan chat mode */
              <div style={S.chatPanel}>
                <div style={S.chatHeader}>
                  <span style={S.chatTitle}>Plan with AI</span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {planMessages.length > 0 && !planLoading && (
                      <button type="button" onClick={applyPlanToPrompt} style={S.usePlanBtn}>
                        Generate Prompt
                      </button>
                    )}
                    <button type="button" onClick={() => setPlanMode(false)} style={S.closePlanBtn}>
                      Back to Prompt
                    </button>
                  </div>
                </div>
                <div style={S.chatMessages}>
                  {planMessages.length === 0 && (
                    <div style={S.chatEmpty}>
                      <div style={{ fontSize: 14, marginBottom: 8 }}>Discuss your idea before spawning</div>
                      <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.6 }}>
                        Describe what you want this agent to accomplish. AI will help you
                        refine the plan, identify edge cases, and craft a solid prompt.
                        {role && <><br />Role: <strong>{role === 'custom' ? customRole : role}</strong></>}
                      </div>
                    </div>
                  )}
                  {planMessages.map((msg, i) => (
                    <div key={i} style={{
                      ...S.chatBubble,
                      ...(msg.from === 'user' ? S.chatUser : S.chatAI),
                    }}>
                      <div style={S.chatFrom}>{msg.from === 'user' ? 'You' : 'AI'}</div>
                      <div style={S.chatText}>
                        {msg.from === 'ai' ? <FormattedText text={msg.text} /> : msg.text}
                      </div>
                    </div>
                  ))}
                  {planLoading && (hasApiKey
                    ? <div style={{ alignSelf: 'flex-start', padding: '10px 16px', borderRadius: 10, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderBottomLeftRadius: 2, fontSize: 11, color: 'var(--text-dim)' }}>Responding...</div>
                    : <PlanningIndicator />
                  )}
                  <div ref={chatEndRef} />
                </div>
                <div style={S.chatInputBar}>
                  <input
                    style={S.chatInput}
                    placeholder="Describe your idea, ask questions, refine the plan..."
                    value={planInput}
                    onChange={(e) => setPlanInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handlePlanSend(); } }}
                    autoFocus
                  />
                  <button type="button" onClick={handlePlanSend}
                    disabled={planLoading || !planInput.trim()}
                    style={{ ...S.sendBtn, opacity: planLoading || !planInput.trim() ? 0.3 : 1 }}>
                    Send
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Small reusable components ---

// Auto-escalating indicator: shows simple "Responding" for 3s, then switches to planning phases
function AutoEscalateIndicator() {
  const [escalated, setEscalated] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setEscalated(true), 3000);
    return () => clearTimeout(timer);
  }, []);
  if (!escalated) {
    return (
      <div style={{
        alignSelf: 'flex-start', padding: '10px 16px', borderRadius: 10,
        background: 'var(--bg-surface)', border: '1px solid var(--border)',
        borderBottomLeftRadius: 2, fontSize: 11, color: 'var(--text-dim)',
      }}>
        Responding...
      </div>
    );
  }
  return <PlanningIndicator />;
}

const PLAN_PHASES = [
  'Analyzing request',
  'Evaluating approach',
  'Considering scope',
  'Identifying constraints',
  'Crafting plan',
];

function PlanningIndicator() {
  const [phase, setPhase] = useState(0);
  const [dots, setDots] = useState(1);

  useEffect(() => {
    const phaseTimer = setInterval(() => setPhase((p) => (p + 1) % PLAN_PHASES.length), 3000);
    const dotTimer = setInterval(() => setDots((d) => (d % 3) + 1), 500);
    return () => { clearInterval(phaseTimer); clearInterval(dotTimer); };
  }, []);

  return (
    <div style={{
      alignSelf: 'flex-start', padding: '14px 20px', borderRadius: 10,
      background: 'var(--bg-surface)', border: '1px solid var(--border)',
      borderBottomLeftRadius: 2, maxWidth: '80%',
    }}>
      <div style={{
        fontSize: 9, fontWeight: 700, textTransform: 'uppercase',
        letterSpacing: 1.2, color: 'var(--accent)', marginBottom: 10,
      }}>
        Planning
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {PLAN_PHASES.map((label, i) => {
          const active = i === phase;
          const done = i < phase;
          return (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              fontSize: 11, color: active ? 'var(--text-bright)' : done ? 'var(--text-dim)' : 'var(--text-muted)',
              transition: 'color 0.3s',
            }}>
              <span style={{
                width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                background: active ? 'var(--accent)' : done ? 'var(--text-dim)' : 'var(--border)',
                transition: 'background 0.3s',
                ...(active ? { boxShadow: '0 0 6px var(--accent)' } : {}),
              }} />
              {label}{active ? '.'.repeat(dots) : ''}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Section({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={S.sectionLabel}>{label}</div>
      {children}
    </div>
  );
}

function RoleBtn({ preset, active, onClick }) {
  return (
    <button type="button" onClick={onClick} title={preset.desc}
      style={{ ...S.roleBtn, ...(active ? S.roleBtnActive : {}) }}>
      {preset.label}
    </button>
  );
}

function Chip({ label, active, onClick }) {
  return (
    <button type="button" onClick={onClick}
      style={{ ...S.chip, ...(active ? { borderColor: 'var(--accent)', color: 'var(--text-bright)' } : {}) }}>
      {label}
    </button>
  );
}

function ItemBtn({ name, active, sub, subColor, disabled, onClick }) {
  return (
    <button type="button" onClick={onClick}
      style={{
        ...S.itemBtn, borderColor: active ? 'var(--accent)' : 'var(--border)',
        background: active ? 'rgba(51, 175, 188, 0.08)' : 'var(--bg-surface)',
        opacity: disabled ? 0.5 : 1, cursor: disabled ? 'not-allowed' : 'pointer',
      }}>
      <span style={{ ...S.itemIcon, background: active ? 'var(--accent)' : 'var(--bg-active)', color: active ? 'var(--bg-base)' : 'var(--text-dim)' }}>
        {name.charAt(0)}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: active ? 'var(--text-bright)' : 'var(--text-primary)' }}>{name}</div>
        {sub && <div style={{ fontSize: 9, color: subColor || 'var(--text-dim)' }}>{sub}</div>}
      </div>
      {active && <span style={{ fontSize: 10, color: 'var(--accent)' }}>{'\u2713'}</span>}
    </button>
  );
}

// --- Styles ---

const S = {
  // Overlay
  overlay: {
    position: 'fixed', inset: 0, zIndex: 900,
    background: 'rgba(0, 0, 0, 0.7)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    backdropFilter: 'blur(4px)',
  },
  container: {
    width: '92vw', height: '88vh', maxWidth: 1200,
    background: 'var(--bg-base)', border: '1px solid var(--border)',
    borderRadius: 10, display: 'flex', flexDirection: 'column',
    overflow: 'hidden',
  },

  // Header
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '12px 20px', borderBottom: '1px solid var(--border)',
    background: 'var(--bg-chrome)', flexShrink: 0,
  },
  headerTitle: {
    fontSize: 15, fontWeight: 700, color: 'var(--text-bright)', letterSpacing: 0.3,
  },
  headerRight: {
    display: 'flex', alignItems: 'center', gap: 12,
  },
  headerError: {
    fontSize: 11, color: 'var(--red)', maxWidth: 300, overflow: 'hidden',
    textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  spawnBtn: {
    padding: '8px 24px', background: 'var(--accent)', color: 'var(--bg-base)',
    border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 700,
    cursor: 'pointer', fontFamily: 'var(--font)', letterSpacing: 0.3,
  },
  closeBtn: {
    background: 'none', border: 'none', color: 'var(--text-muted)',
    fontSize: 22, cursor: 'pointer', padding: '0 4px', fontFamily: 'var(--font)',
  },

  // Body
  body: {
    flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0,
  },

  // Left panel
  left: {
    width: 340, flexShrink: 0, borderRight: '1px solid var(--border)',
    background: 'var(--bg-chrome)', display: 'flex', flexDirection: 'column',
  },
  leftScroll: {
    flex: 1, overflowY: 'auto', padding: '16px 18px',
  },

  // Right panel
  right: {
    flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0,
  },

  // Prompt mode
  promptPanel: {
    flex: 1, display: 'flex', flexDirection: 'column', padding: 20,
  },
  promptHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 12,
  },
  promptLabel: {
    fontSize: 11, fontWeight: 700, color: 'var(--text-dim)',
    textTransform: 'uppercase', letterSpacing: 1.5,
  },
  planBtn: {
    padding: '6px 16px', background: 'transparent',
    border: '1px solid var(--accent)', borderRadius: 4,
    color: 'var(--accent)', fontSize: 12, fontWeight: 600,
    cursor: 'pointer', fontFamily: 'var(--font)',
  },
  promptArea: {
    flex: 1, width: '100%', background: 'var(--bg-surface)',
    border: '1px solid var(--border)', borderRadius: 6,
    padding: '14px 16px', color: 'var(--text-primary)',
    fontSize: 13, lineHeight: 1.7, outline: 'none',
    fontFamily: 'var(--font)', resize: 'none',
  },

  // Chat mode
  chatPanel: {
    flex: 1, display: 'flex', flexDirection: 'column',
    overflow: 'hidden', minHeight: 0,
  },
  chatHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '10px 20px', borderBottom: '1px solid var(--border)',
    background: 'var(--bg-chrome)', flexShrink: 0,
  },
  chatTitle: {
    fontSize: 12, fontWeight: 700, color: 'var(--accent)',
    textTransform: 'uppercase', letterSpacing: 1,
  },
  usePlanBtn: {
    padding: '4px 12px', background: 'var(--accent)', color: 'var(--bg-base)',
    border: 'none', borderRadius: 4, fontSize: 11, fontWeight: 600,
    cursor: 'pointer', fontFamily: 'var(--font)',
  },
  closePlanBtn: {
    padding: '4px 12px', background: 'transparent', color: 'var(--text-muted)',
    border: '1px solid var(--border)', borderRadius: 4,
    fontSize: 11, cursor: 'pointer', fontFamily: 'var(--font)',
  },
  chatMessages: {
    flex: 1, overflowY: 'auto', padding: '20px 24px',
    display: 'flex', flexDirection: 'column', gap: 16,
  },
  chatEmpty: {
    textAlign: 'center', padding: '60px 40px',
    color: 'var(--text-muted)', fontFamily: 'var(--font)',
  },
  chatBubble: {
    maxWidth: '80%', padding: '10px 16px', borderRadius: 10,
    fontSize: 13, lineHeight: 1.6,
  },
  chatUser: {
    alignSelf: 'flex-end', background: 'var(--accent)', color: 'var(--bg-base)',
    borderBottomRightRadius: 2,
  },
  chatAI: {
    alignSelf: 'flex-start', background: 'var(--bg-surface)',
    border: '1px solid var(--border)', color: 'var(--text-primary)',
    borderBottomLeftRadius: 2,
  },
  chatFrom: {
    fontSize: 9, fontWeight: 700, textTransform: 'uppercase',
    letterSpacing: 0.8, marginBottom: 4, opacity: 0.6,
  },
  chatText: {
    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
  },
  chatInputBar: {
    display: 'flex', gap: 8, padding: '12px 20px',
    borderTop: '1px solid var(--border)', background: 'var(--bg-chrome)',
    flexShrink: 0,
  },
  chatInput: {
    flex: 1, background: 'var(--bg-surface)', border: '1px solid var(--border)',
    borderRadius: 6, padding: '10px 14px', color: 'var(--text-primary)',
    fontSize: 13, outline: 'none', fontFamily: 'var(--font)',
  },
  sendBtn: {
    padding: '10px 20px', background: 'var(--accent)', color: 'var(--bg-base)',
    border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600,
    cursor: 'pointer', fontFamily: 'var(--font)',
  },

  // Shared form styles
  sectionLabel: {
    fontSize: 10, fontWeight: 700, color: 'var(--text-dim)',
    textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 6,
  },
  sectionSub: {
    fontSize: 9, fontWeight: 600, color: 'var(--text-muted)',
    textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4,
  },
  roleGrid: {
    display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4,
  },
  roleBtn: {
    background: 'var(--bg-surface)', border: '1px solid var(--border)',
    borderRadius: 4, padding: '6px 4px',
    color: 'var(--text-primary)', fontSize: 11, cursor: 'pointer',
    fontFamily: 'var(--font)', transition: 'all 0.1s',
  },
  roleBtnActive: {
    borderColor: 'var(--accent)', color: 'var(--text-bright)',
    background: 'rgba(51, 175, 188, 0.08)',
  },
  chipRow: {
    display: 'flex', flexWrap: 'wrap', gap: 4,
  },
  chip: {
    background: 'var(--bg-surface)', border: '1px solid var(--border)',
    borderRadius: 3, padding: '3px 8px',
    color: 'var(--text-dim)', fontSize: 10, cursor: 'pointer',
    fontFamily: 'var(--font)',
  },
  browseBtn: {
    background: 'var(--bg-surface)', border: '1px solid var(--accent)',
    borderRadius: 3, padding: '3px 10px',
    color: 'var(--accent)', fontSize: 10, fontWeight: 600,
    cursor: 'pointer', fontFamily: 'var(--font)',
  },
  permBtn: {
    flex: 1, display: 'flex', alignItems: 'center', gap: 8,
    padding: '8px 10px', background: 'var(--bg-surface)',
    border: '1px solid var(--border)', borderRadius: 4,
    cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font)',
  },
  permBtnActive: { borderColor: 'var(--accent)' },
  permIcon: {
    fontSize: 14, fontWeight: 700, color: 'var(--accent)',
    width: 18, textAlign: 'center', flexShrink: 0,
  },
  itemList: { display: 'flex', flexDirection: 'column', gap: 3 },
  itemBtn: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '5px 8px', width: '100%',
    border: '1px solid var(--border)', borderRadius: 3,
    cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font)',
    transition: 'border-color 0.1s',
  },
  itemIcon: {
    width: 20, height: 20, borderRadius: 4,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 9, fontWeight: 700, flexShrink: 0,
  },
  toggleBtn: {
    display: 'flex', alignItems: 'center', gap: 8, width: '100%',
    padding: '6px 8px', background: 'var(--bg-surface)',
    border: '1px solid var(--border)', borderRadius: 3,
    cursor: 'pointer', fontFamily: 'var(--font)',
  },
  checkbox: {
    width: 14, height: 14, borderRadius: 3, flexShrink: 0,
    border: '2px solid var(--border)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: 'var(--bg-base)', fontSize: 9, fontWeight: 700,
  },
  advToggle: {
    background: 'none', border: 'none', color: 'var(--text-dim)',
    fontSize: 10, cursor: 'pointer', fontFamily: 'var(--font)',
    padding: '6px 0', marginBottom: 4,
  },
  providerBtn: {
    width: '100%', display: 'flex', alignItems: 'center', gap: 8,
    padding: '6px 10px', background: 'var(--bg-surface)',
    border: '1px solid var(--border)', borderRadius: 3,
    cursor: 'pointer', fontFamily: 'var(--font)',
  },
  connectBox: {
    padding: '6px 10px', margin: '2px 0 4px',
    background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 3,
  },
  code: {
    display: 'block', padding: '4px 8px',
    background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 2,
    fontSize: 11, color: 'var(--accent)', wordBreak: 'break-all',
  },
  saveKeyBtn: {
    padding: '6px 12px', background: 'transparent',
    border: '1px solid var(--accent)', borderRadius: 3,
    color: 'var(--accent)', fontSize: 11, fontWeight: 600,
    cursor: 'pointer', fontFamily: 'var(--font)',
  },
  cancelBtn: {
    background: 'none', border: 'none', color: 'var(--text-dim)',
    fontSize: 10, cursor: 'pointer', fontFamily: 'var(--font)',
    padding: '4px 0', marginTop: 4,
  },
  input: {
    width: '100%', background: 'var(--bg-surface)', border: '1px solid var(--border)',
    borderRadius: 3, padding: '6px 8px',
    color: 'var(--text-primary)', fontSize: 12, outline: 'none',
    fontFamily: 'var(--font)',
  },
  hint: {
    fontSize: 10, color: 'var(--text-dim)', marginTop: 3,
  },
};
