// GROOVE GUI — Skills Marketplace
// FSL-1.1-Apache-2.0 — see LICENSE

import React, { useState, useEffect } from 'react';

const CATEGORY_LABELS = {
  all: 'All Skills',
  design: 'Design',
  quality: 'Quality',
  devtools: 'Dev Tools',
  workflow: 'Workflow',
  security: 'Security',
  specialized: 'Specialized',
};

export default function SkillsMarketplace() {
  const [skills, setSkills] = useState([]);
  const [categories, setCategories] = useState([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState(null);
  const [expandedSkill, setExpandedSkill] = useState(null);
  const [skillContent, setSkillContent] = useState(null);
  const [hovered, setHovered] = useState(null);

  useEffect(() => {
    fetchSkills();
  }, [search, category]);

  async function fetchSkills() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (category !== 'all') params.set('category', category);
      const res = await fetch(`/api/skills/registry?${params}`);
      const data = await res.json();
      setSkills(data.skills || []);
      setCategories(data.categories || []);
    } catch { /* ignore */ }
    setLoading(false);
  }

  async function handleInstall(id) {
    setInstalling(id);
    try {
      await fetch(`/api/skills/${id}/install`, { method: 'POST' });
      await fetchSkills();
    } catch { /* ignore */ }
    setInstalling(null);
  }

  async function handleUninstall(id) {
    setInstalling(id);
    try {
      await fetch(`/api/skills/${id}`, { method: 'DELETE' });
      setExpandedSkill(null);
      setSkillContent(null);
      await fetchSkills();
    } catch { /* ignore */ }
    setInstalling(null);
  }

  async function handleExpand(skill) {
    if (expandedSkill === skill.id) {
      setExpandedSkill(null);
      setSkillContent(null);
      return;
    }
    setExpandedSkill(skill.id);
    setSkillContent(null);
    if (skill.installed) {
      try {
        const res = await fetch(`/api/skills/${skill.id}/content`);
        const data = await res.json();
        setSkillContent(data.content);
      } catch { /* ignore */ }
    }
  }

  const installedCount = skills.filter((s) => s.installed).length;

  return (
    <div style={styles.root}>
      {/* Header */}
      <div style={styles.header}>
        <div>
          <div style={styles.title}>Skills Marketplace</div>
          <div style={styles.subtitle}>
            {skills.length} skills available, {installedCount} installed
          </div>
        </div>
      </div>

      {/* Search + Categories */}
      <div style={styles.toolbar}>
        <input
          style={styles.search}
          placeholder="Search skills..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
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
              {CATEGORY_LABELS[cat.id] || cat.id} ({cat.count})
            </button>
          ))}
        </div>
      </div>

      {/* Skills Grid */}
      <div style={styles.grid}>
        {loading && skills.length === 0 && (
          <div style={styles.empty}>Loading skills...</div>
        )}

        {!loading && skills.length === 0 && (
          <div style={styles.empty}>No skills match your search.</div>
        )}

        {skills.map((skill) => (
          <div key={skill.id}>
            <div
              onClick={() => handleExpand(skill)}
              onMouseEnter={() => setHovered(skill.id)}
              onMouseLeave={() => setHovered(null)}
              style={{
                ...styles.card,
                borderColor: skill.installed ? 'var(--green)' : (hovered === skill.id ? 'var(--accent)' : 'var(--border)'),
                background: hovered === skill.id ? 'var(--bg-hover)' : 'var(--bg-surface)',
              }}
            >
              {/* Card header */}
              <div style={styles.cardTop}>
                <div style={{
                  ...styles.cardIcon,
                  background: skill.installed ? 'var(--green)' : 'var(--accent)',
                }}>
                  {skill.icon || skill.name.charAt(0)}
                </div>
                <div style={styles.cardInfo}>
                  <div style={styles.cardName}>{skill.name}</div>
                  <div style={styles.cardAuthor}>{skill.author}</div>
                </div>
                {skill.installed && (
                  <div style={styles.installedBadge}>installed</div>
                )}
              </div>

              {/* Description */}
              <div style={styles.cardDesc}>{skill.description}</div>

              {/* Tags */}
              <div style={styles.tagRow}>
                <span style={styles.catTag}>{CATEGORY_LABELS[skill.category] || skill.category}</span>
                {skill.roles.slice(0, 3).map((r) => (
                  <span key={r} style={styles.roleTag}>{r}</span>
                ))}
              </div>
            </div>

            {/* Expanded detail */}
            {expandedSkill === skill.id && (
              <div style={styles.detail}>
                {skillContent && (
                  <div style={styles.contentPreview}>
                    <div style={styles.contentLabel}>SKILL INSTRUCTIONS</div>
                    <pre style={styles.contentPre}>
                      {skillContent.replace(/^---[\s\S]*?---\n/, '').trim().slice(0, 800)}
                      {skillContent.length > 800 ? '\n...' : ''}
                    </pre>
                  </div>
                )}
                <div style={styles.detailActions}>
                  {skill.installed ? (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleUninstall(skill.id); }}
                      disabled={installing === skill.id}
                      style={styles.uninstallBtn}
                    >
                      {installing === skill.id ? 'Removing...' : 'Uninstall'}
                    </button>
                  ) : (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleInstall(skill.id); }}
                      disabled={installing === skill.id}
                      style={styles.installBtn}
                    >
                      {installing === skill.id ? 'Installing...' : 'Install'}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

const styles = {
  root: {
    height: '100%', display: 'flex', flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    padding: '16px 20px 0',
    flexShrink: 0,
  },
  title: {
    fontSize: 14, fontWeight: 700, color: 'var(--text-bright)',
  },
  subtitle: {
    fontSize: 11, color: 'var(--text-dim)', marginTop: 2,
  },
  toolbar: {
    padding: '12px 20px',
    flexShrink: 0,
  },
  search: {
    width: '100%', padding: '8px 12px',
    background: 'var(--bg-surface)', border: '1px solid var(--border)',
    borderRadius: 4, color: 'var(--text-primary)', fontSize: 12,
    fontFamily: 'var(--font)', outline: 'none',
  },
  catRow: {
    display: 'flex', gap: 4, marginTop: 8, flexWrap: 'wrap',
  },
  catBtn: {
    padding: '3px 10px',
    background: 'transparent', border: '1px solid var(--border)',
    borderRadius: 12, color: 'var(--text-dim)', fontSize: 10,
    fontFamily: 'var(--font)', cursor: 'pointer',
    transition: 'all 0.1s',
  },
  catBtnActive: {
    borderColor: 'var(--accent)', color: 'var(--accent)',
    background: 'rgba(51, 175, 188, 0.08)',
  },
  grid: {
    flex: 1, overflowY: 'auto', padding: '0 20px 20px',
    display: 'flex', flexDirection: 'column', gap: 6,
  },
  empty: {
    padding: '40px 0', textAlign: 'center',
    color: 'var(--text-dim)', fontSize: 12,
  },
  card: {
    padding: '12px 14px',
    background: 'var(--bg-surface)', border: '1px solid var(--border)',
    borderRadius: 6, cursor: 'pointer',
    transition: 'border-color 0.1s, background 0.1s',
  },
  cardTop: {
    display: 'flex', alignItems: 'center', gap: 10,
  },
  cardIcon: {
    width: 32, height: 32, borderRadius: 6,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 13, fontWeight: 700, color: 'var(--bg-base)',
    flexShrink: 0,
  },
  cardInfo: {
    flex: 1, minWidth: 0,
  },
  cardName: {
    fontSize: 12, fontWeight: 600, color: 'var(--text-bright)',
  },
  cardAuthor: {
    fontSize: 10, color: 'var(--text-muted)',
  },
  installedBadge: {
    fontSize: 9, fontWeight: 600, color: 'var(--green)',
    border: '1px solid var(--green)', borderRadius: 3,
    padding: '1px 6px', textTransform: 'uppercase', letterSpacing: 0.5,
    flexShrink: 0,
  },
  cardDesc: {
    fontSize: 11, color: 'var(--text-dim)', marginTop: 8,
    lineHeight: 1.45,
    display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
  },
  tagRow: {
    display: 'flex', gap: 4, marginTop: 8, flexWrap: 'wrap',
  },
  catTag: {
    fontSize: 9, padding: '1px 6px', borderRadius: 3,
    background: 'var(--bg-active)', color: 'var(--text-dim)',
    fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5,
  },
  roleTag: {
    fontSize: 9, padding: '1px 6px', borderRadius: 3,
    background: 'rgba(51, 175, 188, 0.1)', color: 'var(--accent)',
  },
  detail: {
    margin: '0 0 4px',
    padding: '10px 14px',
    background: 'var(--bg-base)', border: '1px solid var(--border)',
    borderTop: 'none', borderRadius: '0 0 6px 6px',
  },
  contentPreview: {
    marginBottom: 10,
  },
  contentLabel: {
    fontSize: 9, fontWeight: 600, color: 'var(--text-muted)',
    textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6,
  },
  contentPre: {
    fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.5,
    fontFamily: 'var(--font)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
    maxHeight: 200, overflowY: 'auto',
    padding: '8px 10px', background: 'var(--bg-surface)',
    border: '1px solid var(--border)', borderRadius: 4,
  },
  detailActions: {
    display: 'flex', justifyContent: 'flex-end', gap: 8,
  },
  installBtn: {
    padding: '6px 20px',
    background: 'var(--accent)', border: '1px solid var(--accent)',
    borderRadius: 4, color: 'var(--bg-base)', fontSize: 11, fontWeight: 700,
    fontFamily: 'var(--font)', cursor: 'pointer',
  },
  uninstallBtn: {
    padding: '6px 16px',
    background: 'transparent', border: '1px solid var(--red)',
    borderRadius: 4, color: 'var(--red)', fontSize: 11, fontWeight: 600,
    fontFamily: 'var(--font)', cursor: 'pointer',
  },
};
