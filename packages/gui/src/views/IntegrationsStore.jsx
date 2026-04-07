// GROOVE GUI — Integrations Store (MCP Marketplace)
// FSL-1.1-Apache-2.0 — see LICENSE

import React, { useState, useEffect, useCallback } from 'react';

const CATEGORY_LABELS = {
  all: 'All',
  communication: 'Communication',
  productivity: 'Productivity',
  finance: 'Finance',
  developer: 'Developer',
  database: 'Database',
  'smart-home': 'Smart Home',
  analytics: 'Analytics',
};

const CATEGORY_ICONS = {
  communication: '\u2709',
  productivity: '\u2699',
  finance: '\u2696',
  developer: '\u2318',
  database: '\u2261',
  'smart-home': '\u2302',
  analytics: '\u2315',
};

const ICON_MAP = {
  slack: 'S', github: 'G', stripe: '$', calendar: 'C', email: '@',
  gmail: '@', database: 'D', search: '?', drive: 'D', linear: 'L',
  notion: 'N', discord: 'D', home: 'H', folder: 'F', map: 'M',
};

const SORT_OPTIONS = [
  { id: 'popular', label: 'Popular' },
  { id: 'name', label: 'A\u2013Z' },
  { id: 'category', label: 'Category' },
];

// Verification badges
function getVerification(item) {
  if (item.verified === 'mcp-official') return { label: 'Official', color: 'var(--accent)', bg: 'rgba(51, 175, 188, 0.12)' };
  if (item.verified === 'verified') return { label: 'Verified', color: 'var(--green)', bg: 'rgba(74, 225, 104, 0.10)' };
  return null;
}

function VerifiedBadge({ item, size = 'small' }) {
  const v = getVerification(item);
  if (!v) return null;
  const isSmall = size === 'small';
  return (
    <span
      title={`${v.label} MCP server`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 3,
        fontSize: isSmall ? 9 : 10, fontWeight: 600,
        color: v.color, background: v.bg,
        padding: isSmall ? '1px 6px' : '2px 8px',
        borderRadius: 3, letterSpacing: 0.3,
        flexShrink: 0, cursor: 'default',
      }}
    >
      <span style={{ fontSize: isSmall ? 8 : 10, lineHeight: 1 }}>{'\u2713'}</span>
      {v.label}
    </span>
  );
}

function sortIntegrations(items, sortBy) {
  const sorted = [...items];
  switch (sortBy) {
    case 'popular': return sorted.sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0) || a.name.localeCompare(b.name));
    case 'name': return sorted.sort((a, b) => a.name.localeCompare(b.name));
    case 'category': return sorted.sort((a, b) => (a.category || '').localeCompare(b.category || '') || a.name.localeCompare(b.name));
    default: return sorted;
  }
}

// -- Credential Setup Modal (Guided Wizard) --
function CredentialModal({ integration, onClose }) {
  const [values, setValues] = useState({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState({});
  const [oauthStatus, setOauthStatus] = useState(null); // null, 'checking', 'not-configured', 'ready', 'connecting'
  const [googleClientId, setGoogleClientId] = useState('');
  const [googleClientSecret, setGoogleClientSecret] = useState('');
  const [showGoogleSetup, setShowGoogleSetup] = useState(false);

  useEffect(() => {
    if (integration?.authType === 'oauth-google') {
      setOauthStatus('checking');
      fetch('/api/integrations/google-oauth/status')
        .then((r) => r.json())
        .then((data) => setOauthStatus(data.configured ? 'ready' : 'not-configured'))
        .catch(() => setOauthStatus('not-configured'));
    }
  }, [integration]);

  if (!integration) return null;

  const isOAuth = integration.authType === 'oauth-google';
  const envKeys = (integration.envKeys || []).filter((ek) => !ek.hidden);
  const setupSteps = integration.setupSteps || [];

  async function handleSave(key) {
    if (!values[key]) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/integrations/${integration.id}/credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value: values[key] }),
      });
      if (res.ok) {
        setSaved((prev) => ({ ...prev, [key]: true }));
        setValues((prev) => ({ ...prev, [key]: '' }));
      }
    } catch { /* ignore */ }
    setSaving(false);
  }

  async function handleGoogleSetup() {
    if (!googleClientId || !googleClientSecret) return;
    setSaving(true);
    try {
      await fetch('/api/integrations/google-oauth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: googleClientId, clientSecret: googleClientSecret }),
      });
      setOauthStatus('ready');
      setShowGoogleSetup(false);
    } catch { /* ignore */ }
    setSaving(false);
  }

  async function handleOAuthConnect() {
    setOauthStatus('connecting');
    try {
      const res = await fetch(`/api/integrations/${integration.id}/oauth/start`, { method: 'POST' });
      const data = await res.json();
      if (data.url) {
        window.open(data.url, '_blank', 'width=600,height=700');
        // Poll for completion
        const poll = setInterval(async () => {
          try {
            const statusRes = await fetch(`/api/integrations/${integration.id}/status`);
            const status = await statusRes.json();
            if (status.configured) {
              clearInterval(poll);
              setOauthStatus('ready');
              onClose();
            }
          } catch { /* ignore */ }
        }, 2000);
        // Stop polling after 5 minutes
        setTimeout(() => clearInterval(poll), 300000);
      }
    } catch {
      setOauthStatus('ready');
    }
  }

  return (
    <div style={modal.overlay} onClick={onClose}>
      <div style={modal.container} onClick={(e) => e.stopPropagation()}>
        <div style={modal.topBar}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-bright)' }}>
            Connect {integration.name}
          </span>
          <button onClick={onClose} style={modal.closeBtn}>&times;</button>
        </div>

        <div style={{ padding: '16px 0' }}>
          {/* Setup guide steps */}
          {setupSteps.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div style={{
                fontSize: 10, fontWeight: 700, color: 'var(--text-muted)',
                textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10,
              }}>
                Setup Guide
              </div>
              {setupSteps.map((step, i) => (
                <div key={i} style={{
                  display: 'flex', gap: 10, marginBottom: 8,
                  fontSize: 11, color: 'var(--text-primary)', lineHeight: 1.5,
                }}>
                  <span style={{
                    width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                    background: 'var(--bg-active)', color: 'var(--accent)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10, fontWeight: 700,
                  }}>
                    {i + 1}
                  </span>
                  <span>{step}</span>
                </div>
              ))}
            </div>
          )}

          {/* Open setup page button for API key integrations */}
          {integration.setupUrl && !isOAuth && (
            <a
              href={integration.setupUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                padding: '10px 16px', marginBottom: 16,
                background: 'var(--bg-active)', color: 'var(--accent)',
                border: '1px solid var(--accent)', borderRadius: 6,
                fontSize: 12, fontWeight: 600, textDecoration: 'none',
                cursor: 'pointer',
              }}
            >
              Open {integration.name} Settings {'\u2197'}
            </a>
          )}

          {/* OAuth flow for Google integrations */}
          {isOAuth && (
            <div style={{ marginBottom: 16 }}>
              {/* Always show the primary Connect button */}
              <button
                onClick={oauthStatus === 'ready' ? handleOAuthConnect : () => setShowGoogleSetup(true)}
                disabled={oauthStatus === 'checking' || oauthStatus === 'connecting'}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  width: '100%', padding: '12px 16px', marginBottom: 12,
                  background: oauthStatus === 'connecting' ? 'var(--bg-active)' : '#4285f4',
                  color: '#fff', border: 'none', borderRadius: 6,
                  fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  fontFamily: 'var(--font)',
                  opacity: oauthStatus === 'checking' ? 0.5 : 1,
                }}
              >
                {oauthStatus === 'checking' ? 'Checking...'
                  : oauthStatus === 'connecting' ? 'Waiting for authorization...'
                  : `Connect with Google`}
              </button>

              {/* First-time setup: show inline when Connect is clicked and OAuth not configured */}
              {showGoogleSetup && oauthStatus === 'not-configured' && (
                <div style={{
                  padding: 14, borderRadius: 8,
                  background: 'var(--bg-surface)', border: '1px solid var(--border)',
                }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-bright)', marginBottom: 8 }}>
                    First-time setup (one time for all Google services)
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.6, marginBottom: 10 }}>
                    Create a free Google Cloud OAuth app to let Groove connect on your behalf:
                  </div>

                  <a
                    href="https://console.cloud.google.com/apis/credentials/oauthclient"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      padding: '8px 14px', marginBottom: 10,
                      background: 'var(--bg-active)', color: 'var(--accent)',
                      border: '1px solid var(--accent)', borderRadius: 6,
                      fontSize: 11, fontWeight: 600, textDecoration: 'none',
                    }}
                  >
                    Open Google Cloud Console {'\u2197'}
                  </a>

                  <div style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.7, marginBottom: 12 }}>
                    1. Create a project if you don't have one{'\n'}
                    2. Set up OAuth consent screen (External, add your email as test user){'\n'}
                    3. Create credentials {'\u2192'} OAuth client ID {'\u2192'} Desktop app{'\n'}
                    4. Paste the Client ID and Secret below:
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <input
                      value={googleClientId}
                      onChange={(e) => setGoogleClientId(e.target.value)}
                      placeholder="Client ID (e.g. 123456.apps.googleusercontent.com)"
                      style={modal.input}
                    />
                    <input
                      type="password"
                      value={googleClientSecret}
                      onChange={(e) => setGoogleClientSecret(e.target.value)}
                      placeholder="Client Secret (e.g. GOCSPX-...)"
                      style={modal.input}
                    />
                    <button
                      onClick={async () => {
                        await handleGoogleSetup();
                        // After saving, immediately trigger the OAuth connect flow
                        if (googleClientId && googleClientSecret) {
                          setTimeout(() => handleOAuthConnect(), 500);
                        }
                      }}
                      disabled={saving || !googleClientId || !googleClientSecret}
                      style={{
                        ...modal.saveBtn, width: '100%',
                        opacity: saving || !googleClientId || !googleClientSecret ? 0.4 : 1,
                      }}
                    >
                      {saving ? 'Saving...' : 'Save & Connect'}
                    </button>
                  </div>

                  <div style={{ fontSize: 9, color: 'var(--text-muted)', textAlign: 'center', marginTop: 6 }}>
                    One-time setup. Works for Gmail, Calendar, and Drive. Encrypted on this machine only.
                  </div>
                </div>
              )}
            </div>
          )}

          {/* API key inputs (only show non-hidden keys) */}
          {envKeys.length > 0 && (
            <div>
              <div style={{
                fontSize: 11, color: 'var(--text-dim)', marginBottom: 12, lineHeight: 1.5,
              }}>
                Paste your credentials below. Values are encrypted and stored locally on this machine only.
              </div>

              {envKeys.map((ek) => (
                <div key={ek.key} style={{ marginBottom: 14 }}>
                  <label style={modal.label}>
                    {ek.label || ek.key}
                    {ek.required && <span style={{ color: 'var(--red)', marginLeft: 4 }}>*</span>}
                    {saved[ek.key] && (
                      <span style={{ color: 'var(--green)', marginLeft: 8, fontSize: 10, fontWeight: 500 }}>
                        {'\u2713'} saved
                      </span>
                    )}
                  </label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      type="password"
                      value={values[ek.key] || ''}
                      placeholder={ek.placeholder || ek.key}
                      onChange={(e) => setValues((prev) => ({ ...prev, [ek.key]: e.target.value }))}
                      onKeyDown={(e) => e.key === 'Enter' && handleSave(ek.key)}
                      style={modal.input}
                    />
                    <button
                      onClick={() => handleSave(ek.key)}
                      disabled={saving || !values[ek.key]}
                      style={{
                        ...modal.saveBtn,
                        opacity: saving || !values[ek.key] ? 0.4 : 1,
                      }}
                    >
                      Save
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// -- Integration Detail Modal --
function IntegrationDetailModal({ integration, installing, onInstall, onUninstall, onConfigure, onAuthenticate, onClose }) {
  if (!integration) return null;

  const isAutoAuth = integration.authType === 'none' && (integration.envKeys || []).length === 0;
  const hasCredentials = (integration.envKeys || []).filter((ek) => !ek.hidden).length > 0
    || integration.authType === 'oauth-google';

  return (
    <div style={modal.overlay} onClick={onClose}>
      <div style={modal.container} onClick={(e) => e.stopPropagation()}>
        <div style={modal.topBar}>
          <VerifiedBadge item={integration} size="large" />
          <button onClick={onClose} style={modal.closeBtn}>&times;</button>
        </div>

        {/* Header */}
        <div style={modal.header}>
          <div style={{
            ...modal.icon,
            background: integration.installed && integration.configured
              ? 'var(--green)'
              : integration.installed ? 'var(--amber)' : 'var(--accent)',
          }}>
            {ICON_MAP[integration.icon] || integration.name.charAt(0)}
          </div>
          <div style={modal.headerInfo}>
            <div style={modal.name}>{integration.name}</div>
            <div style={modal.meta}>
              <span style={modal.metaItem}>
                {CATEGORY_ICONS[integration.category] || ''} {CATEGORY_LABELS[integration.category] || integration.category}
              </span>
              <span style={modal.metaItem}>MCP Server</span>
            </div>
          </div>
        </div>

        {/* Action bar */}
        <div style={modal.actionBar}>
          {integration.installed ? (
            <div style={{ display: 'flex', gap: 8, flex: 1 }}>
              {isAutoAuth && (
                <button
                  onClick={() => onAuthenticate(integration)}
                  style={modal.installBtn}
                >
                  Sign in with {integration.name.includes('Google') || integration.id.includes('google') || integration.id === 'gmail' ? 'Google' : integration.name}
                </button>
              )}
              {hasCredentials && (
                <button
                  onClick={() => onConfigure(integration)}
                  style={modal.configureBtn}
                >
                  {integration.configured ? 'Reconfigure' : 'Configure'}
                </button>
              )}
              <button
                onClick={() => onUninstall(integration.id)}
                disabled={installing === integration.id}
                style={modal.uninstallBtn}
              >
                {installing === integration.id ? 'Removing...' : 'Uninstall'}
              </button>
            </div>
          ) : (
            <button
              onClick={() => onInstall(integration.id)}
              disabled={installing === integration.id}
              style={modal.installBtn}
            >
              {installing === integration.id ? 'Installing...' : 'Install'}
            </button>
          )}
        </div>

        {/* Status */}
        {integration.installed && (
          <div style={modal.section}>
            <div style={modal.sectionTitle}>Status</div>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 12px', borderRadius: 6,
              background: isAutoAuth
                ? 'rgba(97, 175, 239, 0.06)'
                : integration.configured ? 'rgba(74, 225, 104, 0.06)' : 'rgba(229, 192, 123, 0.06)',
              border: `1px solid ${isAutoAuth ? 'var(--blue)' : integration.configured ? 'var(--green)' : 'var(--amber)'}`,
            }}>
              <span style={{
                width: 8, height: 8, borderRadius: '50%',
                background: isAutoAuth ? 'var(--blue)' : integration.configured ? 'var(--green)' : 'var(--amber)',
              }} />
              <span style={{
                fontSize: 11,
                color: isAutoAuth ? 'var(--blue)' : integration.configured ? 'var(--green)' : 'var(--amber)',
              }}>
                {isAutoAuth
                  ? 'Installed — will sign in automatically on first use'
                  : integration.configured ? 'Connected and ready' : 'Credentials needed'}
              </span>
            </div>
          </div>
        )}

        {/* Description */}
        <div style={modal.section}>
          <div style={modal.sectionTitle}>About</div>
          <div style={modal.description}>{integration.description}</div>
        </div>

        {/* Required Credentials */}
        {(integration.envKeys || []).length > 0 && (
          <div style={modal.section}>
            <div style={modal.sectionTitle}>Required Credentials</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {integration.envKeys.map((ek) => (
                <div key={ek.key} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  fontSize: 11, color: 'var(--text-dim)',
                }}>
                  <code style={{
                    fontSize: 10, padding: '1px 6px', borderRadius: 3,
                    background: 'var(--bg-active)', color: 'var(--text-primary)',
                    fontFamily: 'var(--font)',
                  }}>
                    {ek.key}
                  </code>
                  <span>{ek.label}</span>
                  {ek.required && <span style={{ color: 'var(--amber)', fontSize: 9 }}>required</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tags */}
        <div style={modal.section}>
          <div style={modal.sectionTitle}>Tags</div>
          <div style={modal.tagRow}>
            {(integration.tags || []).map((t) => (
              <span key={t} style={modal.tag}>{t}</span>
            ))}
            {(integration.roles || []).map((r) => (
              <span key={r} style={modal.roleTag}>{r}</span>
            ))}
          </div>
        </div>

        {/* Package Info */}
        {integration.npmPackage && (
          <div style={modal.section}>
            <div style={modal.sectionTitle}>Package</div>
            <code style={{
              fontSize: 11, padding: '6px 10px', borderRadius: 4,
              background: 'var(--bg-active)', color: 'var(--text-primary)',
              display: 'block', fontFamily: 'var(--font)',
            }}>
              {integration.npmPackage}
            </code>
          </div>
        )}
      </div>
    </div>
  );
}

// -- Featured Banner --
function FeaturedBanner({ integrations, onSelect }) {
  const featured = integrations.filter((s) => s.featured).slice(0, 3);
  if (featured.length === 0) return null;

  return (
    <div style={styles.featuredSection}>
      <div style={styles.featuredLabel}>Featured Integrations</div>
      <div style={styles.featuredRow}>
        {featured.map((item) => (
          <div
            key={item.id}
            onClick={() => onSelect(item)}
            style={styles.featuredCard}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.transform = 'none'; }}
          >
            <div style={styles.featuredGradient}>
              <div style={{
                ...styles.featuredIcon,
                background: item.installed && item.configured ? 'var(--green)'
                  : item.installed ? 'var(--amber)' : 'var(--accent)',
              }}>
                {ICON_MAP[item.icon] || item.name.charAt(0)}
              </div>
            </div>
            <div style={styles.featuredInfo}>
              <div style={styles.featuredName}>{item.name}</div>
              <div style={styles.featuredAuthorRow}>
                <VerifiedBadge item={item} />
              </div>
              <div style={styles.featuredDesc}>{item.description}</div>
            </div>
            {item.installed && item.authType !== 'none' && item.configured && (
              <div style={styles.connectedBadge}>connected</div>
            )}
            {item.installed && item.authType === 'none' && (
              <div style={styles.installedBadge}>installed</div>
            )}
            {item.installed && !item.configured && item.authType !== 'none' && (
              <div style={styles.setupBadge}>needs setup</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// -- Integration Card --
function IntegrationCard({ item, onSelect, hovered, onHover }) {
  return (
    <div
      onClick={() => onSelect(item)}
      onMouseEnter={() => onHover(item.id)}
      onMouseLeave={() => onHover(null)}
      style={{
        ...styles.card,
        borderColor: item.installed && item.authType === 'none'
          ? 'var(--blue)'
          : item.installed && item.configured ? 'var(--green)'
          : item.installed ? 'var(--amber)'
            : hovered ? 'var(--accent)' : 'var(--border)',
        background: hovered ? 'var(--bg-hover)' : 'var(--bg-surface)',
        transform: hovered ? 'translateY(-1px)' : 'none',
      }}
    >
      {/* Top row */}
      <div style={styles.cardTop}>
        <div style={{
          ...styles.cardIcon,
          background: item.installed && item.authType === 'none'
            ? 'var(--blue)'
            : item.installed && item.configured ? 'var(--green)'
            : item.installed ? 'var(--amber)' : 'var(--accent)',
        }}>
          {ICON_MAP[item.icon] || item.name.charAt(0)}
        </div>
        <div style={styles.cardInfo}>
          <div style={styles.cardName}>{item.name}</div>
          <div style={styles.cardAuthorRow}>
            <VerifiedBadge item={item} />
          </div>
        </div>
        {item.installed && item.configured && item.authType !== 'none' && (
          <div style={styles.connectedBadgeSm}>connected</div>
        )}
        {item.installed && item.authType === 'none' && (
          <div style={styles.installedBadgeSm}>installed</div>
        )}
        {item.installed && !item.configured && item.authType !== 'none' && (
          <div style={styles.setupBadgeSm}>setup</div>
        )}
        {!item.installed && (
          <div style={styles.freeBadge}>MCP</div>
        )}
      </div>

      {/* Description */}
      <div style={styles.cardDesc}>{item.description}</div>

      {/* Bottom */}
      <div style={styles.cardBottom}>
        <div style={styles.cardStats}>
          {(item.envKeys || []).length > 0 && (
            <span style={styles.cardCredCount}>
              {item.envKeys.length} credential{item.envKeys.length > 1 ? 's' : ''}
            </span>
          )}
        </div>
        <span style={styles.catTag}>
          {CATEGORY_ICONS[item.category] || ''} {CATEGORY_LABELS[item.category] || item.category}
        </span>
      </div>
    </div>
  );
}

// -- Main Store --
export default function IntegrationsStore() {
  const [integrations, setIntegrations] = useState([]);
  const [categories, setCategories] = useState([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [sortBy, setSortBy] = useState('popular');
  const [tab, setTab] = useState('browse');
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState(null);
  const [selectedItem, setSelectedItem] = useState(null);
  const [configuring, setConfiguring] = useState(null);
  const [hovered, setHovered] = useState(null);
  const [statusMsg, setStatusMsg] = useState('');

  const fetchIntegrations = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (category !== 'all') params.set('category', category);
      const res = await fetch(`/api/integrations/registry?${params}`);
      const data = await res.json();
      setIntegrations(data.integrations || []);
      setCategories(data.categories || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, [search, category]);

  useEffect(() => { fetchIntegrations(); }, [fetchIntegrations]);

  async function handleInstall(id) {
    setInstalling(id);
    try {
      await fetch(`/api/integrations/${id}/install`, { method: 'POST' });
      await fetchIntegrations();
      // After install, refresh selected item
      if (selectedItem?.id === id) {
        const updated = integrations.find((s) => s.id === id);
        if (updated) setSelectedItem({ ...updated, installed: true });
      }
    } catch { /* ignore */ }
    setInstalling(null);
  }

  async function handleUninstall(id) {
    setInstalling(id);
    try {
      await fetch(`/api/integrations/${id}`, { method: 'DELETE' });
      await fetchIntegrations();
      if (selectedItem?.id === id) {
        setSelectedItem((prev) => prev ? { ...prev, installed: false, configured: false } : null);
      }
    } catch { /* ignore */ }
    setInstalling(null);
  }

  function handleSelect(item) {
    setSelectedItem(item);
  }

  function handleConfigure(item) {
    setSelectedItem(null);
    setConfiguring(item);
  }

  async function handleAuthenticate(item) {
    setSelectedItem(null);
    try {
      const res = await fetch(`/api/integrations/${item.id}/authenticate`, { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        flash('Sign-in window opened — check your browser');
      } else {
        flash(data.error || 'Authentication failed');
      }
    } catch {
      flash('Authentication failed');
    }
  }

  function flash(msg) {
    setStatusMsg(msg);
    setTimeout(() => setStatusMsg(''), 4000);
  }

  function handleConfigureClose() {
    setConfiguring(null);
    fetchIntegrations();
  }

  const installedItems = integrations.filter((s) => s.installed);
  const displayItems = tab === 'installed'
    ? sortIntegrations(installedItems, sortBy)
    : sortIntegrations(integrations, sortBy);

  return (
    <div style={styles.root}>
      {/* Header */}
      <div style={styles.headerBar}>
        <div style={styles.headerLeft}>
          <div style={styles.title}>Integrations</div>
          <div style={styles.headerTabs}>
            <button
              onClick={() => setTab('browse')}
              style={{
                ...styles.headerTab,
                color: tab === 'browse' ? 'var(--text-bright)' : 'var(--text-dim)',
                borderBottom: tab === 'browse' ? '2px solid var(--accent)' : '2px solid transparent',
              }}
            >
              Browse
            </button>
            <button
              onClick={() => setTab('installed')}
              style={{
                ...styles.headerTab,
                color: tab === 'installed' ? 'var(--text-bright)' : 'var(--text-dim)',
                borderBottom: tab === 'installed' ? '2px solid var(--green)' : '2px solid transparent',
              }}
            >
              Installed ({installedItems.length})
            </button>
          </div>
        </div>
        <div style={styles.headerRight}>
          <span style={styles.headerCount}>
            {integrations.length} integrations
          </span>
        </div>
      </div>

      {/* Status message */}
      {statusMsg && (
        <div style={{ padding: '4px 20px', fontSize: 10, color: 'var(--accent)', flexShrink: 0 }}>
          {statusMsg}
        </div>
      )}

      {/* Toolbar */}
      <div style={styles.toolbar}>
        <div style={styles.searchRow}>
          <div style={styles.searchWrap}>
            <span style={styles.searchIcon}>{'\u2315'}</span>
            <input
              style={styles.search}
              placeholder="Search integrations..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div style={styles.sortWrap}>
            {SORT_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                onClick={() => setSortBy(opt.id)}
                style={{
                  ...styles.sortBtn,
                  color: sortBy === opt.id ? 'var(--text-bright)' : 'var(--text-muted)',
                  background: sortBy === opt.id ? 'var(--bg-active)' : 'transparent',
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        {tab === 'browse' && (
          <div style={styles.catRow}>
            <button
              onClick={() => setCategory('all')}
              style={{
                ...styles.catBtn,
                ...(category === 'all' ? styles.catBtnActive : {}),
              }}
            >
              All
            </button>
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setCategory(cat.id)}
                style={{
                  ...styles.catBtn,
                  ...(category === cat.id ? styles.catBtnActive : {}),
                }}
              >
                {CATEGORY_ICONS[cat.id] || ''} {CATEGORY_LABELS[cat.id] || cat.id} ({cat.count})
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Content */}
      <div style={styles.scrollArea}>
        {tab === 'browse' && !search && category === 'all' && (
          <FeaturedBanner integrations={integrations} onSelect={handleSelect} />
        )}

        {loading && integrations.length === 0 && (
          <div style={styles.empty}>Loading integrations...</div>
        )}

        {!loading && displayItems.length === 0 && (
          <div style={styles.empty}>
            {tab === 'installed'
              ? 'No integrations installed yet. Browse to connect your tools.'
              : 'No integrations match your search.'}
          </div>
        )}

        <div style={styles.grid}>
          {displayItems.map((item) => (
            <IntegrationCard
              key={item.id}
              item={item}
              onSelect={handleSelect}
              hovered={hovered === item.id}
              onHover={setHovered}
            />
          ))}
        </div>
      </div>

      {/* Detail Modal */}
      <IntegrationDetailModal
        integration={selectedItem}
        installing={installing}
        onInstall={handleInstall}
        onUninstall={handleUninstall}
        onConfigure={handleConfigure}
        onAuthenticate={handleAuthenticate}
        onClose={() => setSelectedItem(null)}
      />

      {/* Credential Setup Modal */}
      <CredentialModal
        integration={configuring}
        onClose={handleConfigureClose}
      />
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
    padding: '12px 20px 0',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    flexShrink: 0,
  },
  headerLeft: {
    display: 'flex', alignItems: 'center', gap: 20,
  },
  title: {
    fontSize: 15, fontWeight: 700, color: 'var(--text-bright)',
    letterSpacing: 0.3,
  },
  headerTabs: {
    display: 'flex', gap: 0,
  },
  headerTab: {
    padding: '6px 14px',
    background: 'none', border: 'none',
    fontSize: 12, fontWeight: 500,
    fontFamily: 'var(--font)', cursor: 'pointer',
    transition: 'color 0.1s',
  },
  headerRight: {
    display: 'flex', alignItems: 'center', gap: 10,
  },
  headerCount: {
    fontSize: 11, color: 'var(--text-muted)',
  },
  toolbar: {
    padding: '10px 20px',
    flexShrink: 0,
  },
  searchRow: {
    display: 'flex', gap: 10, alignItems: 'center',
  },
  searchWrap: {
    flex: 1, position: 'relative',
  },
  searchIcon: {
    position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
    color: 'var(--text-muted)', fontSize: 13, pointerEvents: 'none',
  },
  search: {
    width: '100%', padding: '7px 12px 7px 30px',
    background: 'var(--bg-surface)', border: '1px solid var(--border)',
    borderRadius: 6, color: 'var(--text-primary)', fontSize: 12,
    fontFamily: 'var(--font)', outline: 'none',
  },
  sortWrap: {
    display: 'flex', gap: 2,
  },
  sortBtn: {
    padding: '5px 10px',
    background: 'transparent', border: '1px solid transparent',
    borderRadius: 4, fontSize: 10, fontWeight: 500,
    fontFamily: 'var(--font)', cursor: 'pointer',
    transition: 'all 0.1s',
  },
  catRow: {
    display: 'flex', gap: 4, marginTop: 8, flexWrap: 'wrap',
  },
  catBtn: {
    padding: '4px 12px',
    background: 'transparent', border: '1px solid var(--border)',
    borderRadius: 14, color: 'var(--text-dim)', fontSize: 10,
    fontFamily: 'var(--font)', cursor: 'pointer',
    transition: 'all 0.1s',
  },
  catBtnActive: {
    borderColor: 'var(--accent)', color: 'var(--accent)',
    background: 'rgba(51, 175, 188, 0.08)',
  },
  scrollArea: {
    flex: 1, overflowY: 'auto', padding: '4px 20px 20px',
  },

  // Featured
  featuredSection: { marginBottom: 16 },
  featuredLabel: {
    fontSize: 11, fontWeight: 700, color: 'var(--text-dim)',
    textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8,
  },
  featuredRow: {
    display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8,
  },
  featuredCard: {
    padding: '14px',
    background: 'var(--bg-surface)', border: '1px solid var(--border)',
    borderRadius: 8, cursor: 'pointer',
    transition: 'border-color 0.15s, transform 0.15s',
    position: 'relative', overflow: 'hidden',
  },
  featuredGradient: {
    display: 'flex', alignItems: 'center', marginBottom: 10,
  },
  featuredIcon: {
    width: 40, height: 40, borderRadius: 10,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 16, fontWeight: 700, color: 'var(--bg-base)',
  },
  featuredInfo: { flex: 1 },
  featuredName: {
    fontSize: 13, fontWeight: 700, color: 'var(--text-bright)',
  },
  featuredAuthorRow: {
    display: 'flex', alignItems: 'center', gap: 6, marginTop: 2,
  },
  featuredDesc: {
    fontSize: 10, color: 'var(--text-dim)', marginTop: 6,
    lineHeight: 1.45, display: '-webkit-box',
    WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
  },
  connectedBadge: {
    position: 'absolute', top: 8, right: 8,
    fontSize: 8, fontWeight: 600, color: 'var(--green)',
    border: '1px solid var(--green)', borderRadius: 3,
    padding: '1px 5px', textTransform: 'uppercase', letterSpacing: 0.5,
  },
  installedBadge: {
    position: 'absolute', top: 8, right: 8,
    fontSize: 8, fontWeight: 600, color: 'var(--blue)',
    border: '1px solid var(--blue)', borderRadius: 3,
    padding: '1px 5px', textTransform: 'uppercase', letterSpacing: 0.5,
  },
  setupBadge: {
    position: 'absolute', top: 8, right: 8,
    fontSize: 8, fontWeight: 600, color: 'var(--amber)',
    border: '1px solid var(--amber)', borderRadius: 3,
    padding: '1px 5px', textTransform: 'uppercase', letterSpacing: 0.5,
  },

  // Grid
  grid: {
    display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8,
  },
  empty: {
    padding: '60px 0', textAlign: 'center',
    color: 'var(--text-dim)', fontSize: 12,
    gridColumn: '1 / -1',
  },

  // Card
  card: {
    padding: '14px',
    background: 'var(--bg-surface)', border: '1px solid var(--border)',
    borderRadius: 8, cursor: 'pointer',
    transition: 'border-color 0.12s, background 0.12s, transform 0.12s',
    display: 'flex', flexDirection: 'column',
  },
  cardTop: {
    display: 'flex', alignItems: 'center', gap: 10,
  },
  cardIcon: {
    width: 36, height: 36, borderRadius: 8,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 14, fontWeight: 700, color: 'var(--bg-base)',
    flexShrink: 0,
  },
  cardInfo: {
    flex: 1, minWidth: 0,
  },
  cardName: {
    fontSize: 12, fontWeight: 600, color: 'var(--text-bright)',
  },
  cardAuthorRow: {
    display: 'flex', alignItems: 'center', gap: 6, marginTop: 2,
  },
  connectedBadgeSm: {
    fontSize: 8, fontWeight: 600, color: 'var(--green)',
    border: '1px solid var(--green)', borderRadius: 3,
    padding: '1px 6px', textTransform: 'uppercase', letterSpacing: 0.5,
    flexShrink: 0,
  },
  installedBadgeSm: {
    fontSize: 8, fontWeight: 600, color: 'var(--blue)',
    border: '1px solid var(--blue)', borderRadius: 3,
    padding: '1px 6px', textTransform: 'uppercase', letterSpacing: 0.5,
    flexShrink: 0,
  },
  setupBadgeSm: {
    fontSize: 8, fontWeight: 600, color: 'var(--amber)',
    border: '1px solid var(--amber)', borderRadius: 3,
    padding: '1px 6px', textTransform: 'uppercase', letterSpacing: 0.5,
    flexShrink: 0,
  },
  freeBadge: {
    fontSize: 9, fontWeight: 500, color: 'var(--text-muted)',
    flexShrink: 0,
  },
  cardDesc: {
    fontSize: 11, color: 'var(--text-dim)', marginTop: 10,
    lineHeight: 1.5, flex: 1,
    display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
  },
  cardBottom: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 10, paddingTop: 8,
    borderTop: '1px solid var(--border)',
  },
  cardStats: {
    display: 'flex', gap: 10,
  },
  cardCredCount: {
    fontSize: 10, color: 'var(--text-muted)',
  },
  catTag: {
    fontSize: 9, padding: '2px 8px', borderRadius: 4,
    background: 'var(--bg-active)', color: 'var(--text-dim)',
    fontWeight: 500,
  },
};

// -- Modal Styles --
const modal = {
  overlay: {
    position: 'fixed', inset: 0,
    background: 'rgba(0, 0, 0, 0.6)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1000,
    backdropFilter: 'blur(2px)',
  },
  container: {
    width: '90%', maxWidth: 520, maxHeight: '85vh',
    background: 'var(--bg-chrome)', border: '1px solid var(--border)',
    borderRadius: 10, overflowY: 'auto',
    padding: '0 24px 24px', position: 'relative',
  },
  topBar: {
    position: 'sticky', top: 0,
    background: 'var(--bg-chrome)',
    padding: '16px 0 8px',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    zIndex: 1,
  },
  closeBtn: {
    background: 'none', border: 'none',
    color: 'var(--text-muted)', fontSize: 20,
    cursor: 'pointer', padding: '2px 6px',
    fontFamily: 'var(--font)',
  },
  header: {
    display: 'flex', gap: 14, alignItems: 'flex-start',
    marginBottom: 16,
  },
  icon: {
    width: 52, height: 52, borderRadius: 12,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 20, fontWeight: 700, color: 'var(--bg-base)',
    flexShrink: 0,
  },
  headerInfo: { flex: 1 },
  name: {
    fontSize: 17, fontWeight: 700, color: 'var(--text-bright)',
  },
  meta: {
    display: 'flex', gap: 10, marginTop: 6, flexWrap: 'wrap',
  },
  metaItem: {
    fontSize: 11, color: 'var(--text-dim)',
  },
  actionBar: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '12px 0', borderTop: '1px solid var(--border)',
    borderBottom: '1px solid var(--border)',
    marginBottom: 16,
  },
  installBtn: {
    flex: 1, padding: '8px 16px',
    background: 'var(--accent)', color: 'var(--bg-base)',
    border: 'none', borderRadius: 6,
    fontSize: 12, fontWeight: 600, cursor: 'pointer',
    fontFamily: 'var(--font)',
  },
  configureBtn: {
    flex: 1, padding: '8px 16px',
    background: 'var(--bg-active)', color: 'var(--text-bright)',
    border: '1px solid var(--border)', borderRadius: 6,
    fontSize: 12, fontWeight: 600, cursor: 'pointer',
    fontFamily: 'var(--font)',
  },
  uninstallBtn: {
    padding: '8px 16px',
    background: 'transparent', color: 'var(--red)',
    border: '1px solid var(--red)', borderRadius: 6,
    fontSize: 12, fontWeight: 500, cursor: 'pointer',
    fontFamily: 'var(--font)',
  },
  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 11, fontWeight: 700, color: 'var(--text-dim)',
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8,
  },
  description: {
    fontSize: 12, color: 'var(--text-primary)', lineHeight: 1.6,
  },
  tagRow: {
    display: 'flex', gap: 4, flexWrap: 'wrap',
  },
  tag: {
    fontSize: 10, padding: '2px 8px', borderRadius: 4,
    background: 'var(--bg-active)', color: 'var(--text-dim)',
  },
  roleTag: {
    fontSize: 10, padding: '2px 8px', borderRadius: 4,
    background: 'rgba(51, 175, 188, 0.08)', color: 'var(--accent)',
    border: '1px solid rgba(51, 175, 188, 0.2)',
  },
  label: {
    display: 'block', fontSize: 11, fontWeight: 600,
    color: 'var(--text-primary)', marginBottom: 4,
  },
  input: {
    flex: 1, padding: '7px 10px',
    background: 'var(--bg-surface)', border: '1px solid var(--border)',
    borderRadius: 5, color: 'var(--text-primary)', fontSize: 12,
    fontFamily: 'var(--font)', outline: 'none',
  },
  saveBtn: {
    padding: '7px 14px',
    background: 'var(--accent)', color: 'var(--bg-base)',
    border: 'none', borderRadius: 5,
    fontSize: 11, fontWeight: 600, cursor: 'pointer',
    fontFamily: 'var(--font)',
  },
};
