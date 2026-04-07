// GROOVE GUI — Skills Marketplace (App Store)
// FSL-1.1-Apache-2.0 — see LICENSE

import React, { useState, useEffect, useCallback } from 'react';

const CATEGORY_LABELS = {
  all: 'All Skills',
  design: 'Design',
  quality: 'Quality',
  devtools: 'Dev Tools',
  workflow: 'Workflow',
  security: 'Security',
  specialized: 'Specialized',
};

const CATEGORY_ICONS = {
  design: '\u2728',
  quality: '\u2714',
  devtools: '\u2699',
  workflow: '\u21BB',
  security: '\u26E8',
  specialized: '\u2606',
};

const SORT_OPTIONS = [
  { id: 'popular', label: 'Popular' },
  { id: 'rating', label: 'Top Rated' },
  { id: 'newest', label: 'Newest' },
  { id: 'name', label: 'A\u2013Z' },
];

// Trust tiers for verification badges
function getVerification(skill) {
  if (skill.source === 'claude-official') return { label: 'Anthropic', color: '#d4a574', bg: 'rgba(212, 165, 116, 0.12)' };
  if (skill.source === 'groove-official') return { label: 'Groove', color: 'var(--accent)', bg: 'rgba(51, 175, 188, 0.12)' };
  if (skill.verified) return { label: 'Verified', color: 'var(--green)', bg: 'rgba(74, 225, 104, 0.10)' };
  return null;
}

function VerifiedBadge({ skill, size = 'small' }) {
  const v = getVerification(skill);
  if (!v) return null;
  const isSmall = size === 'small';
  return (
    <span
      title={`${v.label} — Verified publisher`}
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

function formatDownloads(n) {
  if (!n) return '0';
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(n);
}

function renderStars(rating) {
  if (!rating) return null;
  const full = Math.floor(rating);
  const half = rating - full >= 0.3;
  const stars = [];
  for (let i = 0; i < 5; i++) {
    if (i < full) stars.push('\u2605');
    else if (i === full && half) stars.push('\u2606');
    else stars.push('\u2606');
  }
  return stars.join('');
}

function sortSkills(skills, sortBy) {
  const sorted = [...skills];
  switch (sortBy) {
    case 'popular': return sorted.sort((a, b) => (b.downloads || 0) - (a.downloads || 0));
    case 'rating': return sorted.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    case 'name': return sorted.sort((a, b) => a.name.localeCompare(b.name));
    case 'newest': return sorted.reverse();
    default: return sorted;
  }
}

// ── Skill Detail Modal ──────────────────────────────────────────────
function SkillDetailModal({ skill, content, installing, onInstall, onUninstall, onClose }) {
  if (!skill) return null;

  return (
    <div style={modal.overlay} onClick={onClose}>
      <div style={modal.container} onClick={(e) => e.stopPropagation()}>
        {/* Top bar with close */}
        <div style={modal.topBar}>
          <VerifiedBadge skill={skill} size="large" />
          <button onClick={onClose} style={modal.closeBtn}>&times;</button>
        </div>

        {/* Header */}
        <div style={modal.header}>
          <div style={{
            ...modal.icon,
            background: skill.installed
              ? 'var(--green)'
              : skill.price > 0 ? 'var(--purple)' : 'var(--accent)',
          }}>
            {skill.icon || skill.name.charAt(0)}
          </div>
          <div style={modal.headerInfo}>
            <div style={modal.name}>{skill.name}</div>
            <div style={modal.author}>
              by {skill.author}
            </div>
            <div style={modal.meta}>
              {skill.rating > 0 && (
                <span style={modal.metaItem}>
                  <span style={{ color: 'var(--amber)' }}>{renderStars(skill.rating)}</span>
                  {' '}{skill.rating} ({skill.ratingCount || 0})
                </span>
              )}
              {skill.downloads > 0 && (
                <span style={modal.metaItem}>
                  {'\u2913'} {formatDownloads(skill.downloads)}
                </span>
              )}
              <span style={modal.metaItem}>
                {CATEGORY_ICONS[skill.category] || ''} {CATEGORY_LABELS[skill.category] || skill.category}
              </span>
            </div>
          </div>
        </div>

        {/* Action bar — install/uninstall below header, full width */}
        <div style={modal.actionBar}>
          {skill.installed ? (
            <button
              onClick={() => onUninstall(skill.id)}
              disabled={installing === skill.id}
              style={modal.uninstallBtn}
            >
              {installing === skill.id ? 'Removing...' : 'Uninstall'}
            </button>
          ) : (
            <button
              onClick={() => onInstall(skill.id)}
              disabled={installing === skill.id}
              style={skill.price > 0 ? modal.buyBtn : modal.installBtn}
            >
              {installing === skill.id
                ? 'Installing...'
                : skill.price > 0
                  ? `$${skill.price.toFixed(2)}`
                  : 'Install'}
            </button>
          )}
          {skill.price === 0 && !skill.installed && <span style={modal.freeLabel}>Free</span>}
        </div>

        {/* Description */}
        <div style={modal.section}>
          <div style={modal.sectionTitle}>About</div>
          <div style={modal.description}>{skill.description}</div>
        </div>

        {/* Tags */}
        <div style={modal.section}>
          <div style={modal.sectionTitle}>Tags</div>
          <div style={modal.tagRow}>
            {(skill.tags || []).map((t) => (
              <span key={t} style={modal.tag}>{t}</span>
            ))}
            {(skill.roles || []).map((r) => (
              <span key={r} style={modal.roleTag}>{r}</span>
            ))}
          </div>
        </div>

        {/* Author Profile */}
        {skill.authorProfile && (
          <div style={modal.section}>
            <div style={modal.sectionTitle}>Developer</div>
            <div style={modal.authorCard}>
              <div style={modal.authorAvatar}>
                {skill.authorProfile.avatar
                  ? <img src={skill.authorProfile.avatar} alt="" style={{ width: '100%', height: '100%', borderRadius: 6 }} />
                  : skill.author.charAt(0)
                }
              </div>
              <div style={modal.authorDetails}>
                <div style={modal.authorName}>{skill.author}</div>
                <div style={modal.authorLinks}>
                  {skill.authorProfile.website && (
                    <a href={skill.authorProfile.website} target="_blank" rel="noopener noreferrer" style={modal.authorLink}>
                      Website
                    </a>
                  )}
                  {skill.authorProfile.github && (
                    <a href={`https://github.com/${skill.authorProfile.github}`} target="_blank" rel="noopener noreferrer" style={modal.authorLink}>
                      GitHub
                    </a>
                  )}
                  {skill.authorProfile.twitter && (
                    <a href={`https://x.com/${skill.authorProfile.twitter}`} target="_blank" rel="noopener noreferrer" style={modal.authorLink}>
                      @{skill.authorProfile.twitter}
                    </a>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Content Preview */}
        {content && (
          <div style={modal.section}>
            <div style={modal.sectionTitle}>Skill Instructions</div>
            <pre style={modal.contentPre}>
              {content.replace(/^---[\s\S]*?---\n/, '').trim().slice(0, 2000)}
              {content.length > 2000 ? '\n...' : ''}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Featured Banner ─────────────────────────────────────────────────
function FeaturedBanner({ skills, onSelect }) {
  const featured = skills.filter((s) => s.featured).slice(0, 3);
  if (featured.length === 0) return null;

  return (
    <div style={styles.featuredSection}>
      <div style={styles.featuredLabel}>Featured</div>
      <div style={styles.featuredRow}>
        {featured.map((skill) => (
          <div
            key={skill.id}
            onClick={() => onSelect(skill)}
            style={styles.featuredCard}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.transform = 'none'; }}
          >
            <div style={styles.featuredGradient}>
              <div style={{
                ...styles.featuredIcon,
                background: skill.installed ? 'var(--green)' : 'var(--accent)',
              }}>
                {skill.icon || skill.name.charAt(0)}
              </div>
            </div>
            <div style={styles.featuredInfo}>
              <div style={styles.featuredName}>{skill.name}</div>
              <div style={styles.featuredAuthorRow}>
                <span style={styles.featuredAuthor}>{skill.author}</span>
                <VerifiedBadge skill={skill} />
              </div>
              <div style={styles.featuredDesc}>{skill.description}</div>
              <div style={styles.featuredMeta}>
                {skill.rating > 0 && (
                  <span style={{ color: 'var(--amber)', fontSize: 10 }}>
                    {renderStars(skill.rating)} {skill.rating}
                  </span>
                )}
                <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>
                  {'\u2913'} {formatDownloads(skill.downloads)}
                </span>
              </div>
            </div>
            {skill.installed && (
              <div style={styles.featuredBadge}>installed</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Skill Card ──────────────────────────────────────────────────────
function SkillCard({ skill, onSelect, hovered, onHover }) {
  return (
    <div
      onClick={() => onSelect(skill)}
      onMouseEnter={() => onHover(skill.id)}
      onMouseLeave={() => onHover(null)}
      style={{
        ...styles.card,
        borderColor: skill.installed
          ? 'var(--green)'
          : hovered ? 'var(--accent)' : 'var(--border)',
        background: hovered ? 'var(--bg-hover)' : 'var(--bg-surface)',
        transform: hovered ? 'translateY(-1px)' : 'none',
      }}
    >
      {/* Top row: icon + info + badges */}
      <div style={styles.cardTop}>
        <div style={{
          ...styles.cardIcon,
          background: skill.installed
            ? 'var(--green)'
            : skill.price > 0 ? 'var(--purple)' : 'var(--accent)',
        }}>
          {skill.icon || skill.name.charAt(0)}
        </div>
        <div style={styles.cardInfo}>
          <div style={styles.cardName}>{skill.name}</div>
          <div style={styles.cardAuthorRow}>
            <span style={styles.cardAuthor}>{skill.author}</span>
            <VerifiedBadge skill={skill} />
          </div>
        </div>
        {skill.installed && (
          <div style={styles.installedBadge}>installed</div>
        )}
        {skill.price > 0 && !skill.installed && (
          <div style={styles.priceBadge}>${skill.price.toFixed(2)}</div>
        )}
        {skill.price === 0 && !skill.installed && (
          <div style={styles.freeBadge}>Free</div>
        )}
      </div>

      {/* Description */}
      <div style={styles.cardDesc}>{skill.description}</div>

      {/* Bottom: rating + downloads + category */}
      <div style={styles.cardBottom}>
        <div style={styles.cardStats}>
          {skill.rating > 0 && (
            <span style={styles.cardRating}>
              <span style={{ color: 'var(--amber)' }}>{'\u2605'}</span> {skill.rating}
            </span>
          )}
          {skill.downloads > 0 && (
            <span style={styles.cardDownloads}>
              {'\u2913'} {formatDownloads(skill.downloads)}
            </span>
          )}
        </div>
        <span style={styles.catTag}>
          {CATEGORY_ICONS[skill.category] || ''} {CATEGORY_LABELS[skill.category] || skill.category}
        </span>
      </div>
    </div>
  );
}

// ── Main Marketplace ────────────────────────────────────────────────
export default function SkillsMarketplace() {
  const [skills, setSkills] = useState([]);
  const [categories, setCategories] = useState([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [sortBy, setSortBy] = useState('popular');
  const [tab, setTab] = useState('browse'); // browse | installed
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState(null);
  const [selectedSkill, setSelectedSkill] = useState(null);
  const [skillContent, setSkillContent] = useState(null);
  const [hovered, setHovered] = useState(null);

  const fetchSkills = useCallback(async () => {
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
  }, [search, category]);

  useEffect(() => { fetchSkills(); }, [fetchSkills]);

  async function handleInstall(id) {
    setInstalling(id);
    try {
      await fetch(`/api/skills/${id}/install`, { method: 'POST' });
      await fetchSkills();
      // Update selected skill state
      setSkills((prev) => {
        const updated = prev.find((s) => s.id === id);
        if (updated && selectedSkill?.id === id) {
          setSelectedSkill({ ...updated, installed: true });
        }
        return prev;
      });
    } catch { /* ignore */ }
    setInstalling(null);
  }

  async function handleUninstall(id) {
    setInstalling(id);
    try {
      await fetch(`/api/skills/${id}`, { method: 'DELETE' });
      await fetchSkills();
      if (selectedSkill?.id === id) {
        setSelectedSkill((prev) => prev ? { ...prev, installed: false } : null);
        setSkillContent(null);
      }
    } catch { /* ignore */ }
    setInstalling(null);
  }

  async function handleSelect(skill) {
    setSelectedSkill(skill);
    setSkillContent(null);
    if (skill.installed) {
      try {
        const res = await fetch(`/api/skills/${skill.id}/content`);
        const data = await res.json();
        setSkillContent(data.content);
      } catch { /* ignore */ }
    }
  }

  const installedSkills = skills.filter((s) => s.installed);
  const displaySkills = tab === 'installed'
    ? sortSkills(installedSkills, sortBy)
    : sortSkills(skills, sortBy);

  return (
    <div style={styles.root}>
      {/* Header bar */}
      <div style={styles.headerBar}>
        <div style={styles.headerLeft}>
          <div style={styles.title}>Skills Store</div>
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
              My Skills ({installedSkills.length})
            </button>
          </div>
        </div>
        <div style={styles.headerRight}>
          <span style={styles.headerCount}>
            {skills.length} skills
          </span>
        </div>
      </div>

      {/* Search + Filters */}
      <div style={styles.toolbar}>
        <div style={styles.searchRow}>
          <div style={styles.searchWrap}>
            <span style={styles.searchIcon}>{'\u2315'}</span>
            <input
              style={styles.search}
              placeholder="Search skills..."
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

      {/* Scrollable content */}
      <div style={styles.scrollArea}>
        {/* Featured banner — only on browse tab, no search, all category */}
        {tab === 'browse' && !search && category === 'all' && (
          <FeaturedBanner skills={skills} onSelect={handleSelect} />
        )}

        {/* Grid */}
        {loading && skills.length === 0 && (
          <div style={styles.empty}>Loading skills...</div>
        )}

        {!loading && displaySkills.length === 0 && (
          <div style={styles.empty}>
            {tab === 'installed'
              ? 'No skills installed yet. Browse the store to find skills.'
              : 'No skills match your search.'}
          </div>
        )}

        <div style={styles.grid}>
          {displaySkills.map((skill) => (
            <SkillCard
              key={skill.id}
              skill={skill}
              onSelect={handleSelect}
              hovered={hovered === skill.id}
              onHover={setHovered}
            />
          ))}
        </div>
      </div>

      {/* Detail Modal */}
      <SkillDetailModal
        skill={selectedSkill}
        content={skillContent}
        installing={installing}
        onInstall={handleInstall}
        onUninstall={handleUninstall}
        onClose={() => { setSelectedSkill(null); setSkillContent(null); }}
      />
    </div>
  );
}

// ── Styles ──────────────────────────────────────────────────────────

const styles = {
  root: {
    height: '100%', display: 'flex', flexDirection: 'column',
    overflow: 'hidden',
  },

  // Header bar
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

  // Toolbar
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

  // Scroll area
  scrollArea: {
    flex: 1, overflowY: 'auto', padding: '4px 20px 20px',
  },

  // Featured
  featuredSection: {
    marginBottom: 16,
  },
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
  featuredInfo: {
    flex: 1,
  },
  featuredName: {
    fontSize: 13, fontWeight: 700, color: 'var(--text-bright)',
  },
  featuredAuthorRow: {
    display: 'flex', alignItems: 'center', gap: 6, marginTop: 2,
  },
  featuredAuthor: {
    fontSize: 10, color: 'var(--text-muted)',
  },
  featuredDesc: {
    fontSize: 10, color: 'var(--text-dim)', marginTop: 6,
    lineHeight: 1.45, display: '-webkit-box',
    WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
  },
  featuredMeta: {
    display: 'flex', gap: 10, marginTop: 8,
  },
  featuredBadge: {
    position: 'absolute', top: 8, right: 8,
    fontSize: 8, fontWeight: 600, color: 'var(--green)',
    border: '1px solid var(--green)', borderRadius: 3,
    padding: '1px 5px', textTransform: 'uppercase', letterSpacing: 0.5,
  },

  // 3-wide grid
  grid: {
    display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8,
  },
  empty: {
    padding: '60px 0', textAlign: 'center',
    color: 'var(--text-dim)', fontSize: 12,
    gridColumn: '1 / -1',
  },

  // Skill Card
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
  cardAuthor: {
    fontSize: 10, color: 'var(--text-muted)',
  },
  installedBadge: {
    fontSize: 8, fontWeight: 600, color: 'var(--green)',
    border: '1px solid var(--green)', borderRadius: 3,
    padding: '1px 6px', textTransform: 'uppercase', letterSpacing: 0.5,
    flexShrink: 0,
  },
  priceBadge: {
    fontSize: 10, fontWeight: 700, color: 'var(--purple)',
    border: '1px solid var(--purple)', borderRadius: 4,
    padding: '2px 8px', flexShrink: 0,
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
  cardRating: {
    fontSize: 10, color: 'var(--text-dim)',
  },
  cardDownloads: {
    fontSize: 10, color: 'var(--text-muted)',
  },
  catTag: {
    fontSize: 9, padding: '2px 8px', borderRadius: 4,
    background: 'var(--bg-active)', color: 'var(--text-dim)',
    fontWeight: 500,
  },
};

// ── Modal styles ────────────────────────────────────────────────────
const modal = {
  overlay: {
    position: 'fixed', inset: 0,
    background: 'rgba(0, 0, 0, 0.6)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1000,
    backdropFilter: 'blur(2px)',
  },
  container: {
    width: '90%', maxWidth: 560, maxHeight: '85vh',
    background: 'var(--bg-chrome)', border: '1px solid var(--border)',
    borderRadius: 10, overflowY: 'auto',
    padding: '0 24px 24px', position: 'relative',
  },
  topBar: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '14px 0 10px',
    position: 'sticky', top: 0, zIndex: 1,
    background: 'var(--bg-chrome)',
  },
  closeBtn: {
    background: 'none', border: '1px solid var(--border)',
    borderRadius: 4,
    color: 'var(--text-dim)', fontSize: 16,
    cursor: 'pointer', fontFamily: 'var(--font)',
    lineHeight: 1, padding: '2px 8px',
    transition: 'border-color 0.1s',
  },
  header: {
    display: 'flex', gap: 14, alignItems: 'flex-start',
    marginBottom: 14,
  },
  actionBar: {
    display: 'flex', alignItems: 'center', gap: 10,
    marginBottom: 18, paddingBottom: 16,
    borderBottom: '1px solid var(--border)',
  },
  icon: {
    width: 52, height: 52, borderRadius: 12,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 20, fontWeight: 700, color: 'var(--bg-base)',
    flexShrink: 0,
  },
  headerInfo: {
    flex: 1, minWidth: 0,
  },
  name: {
    fontSize: 16, fontWeight: 700, color: 'var(--text-bright)',
  },
  author: {
    fontSize: 11, color: 'var(--text-dim)', marginTop: 2,
  },
  meta: {
    display: 'flex', gap: 12, marginTop: 6,
    fontSize: 11, color: 'var(--text-dim)',
  },
  metaItem: {
    display: 'flex', alignItems: 'center', gap: 3,
  },
  installBtn: {
    padding: '8px 28px',
    background: 'var(--accent)', border: 'none',
    borderRadius: 6, color: 'var(--bg-base)', fontSize: 12, fontWeight: 700,
    fontFamily: 'var(--font)', cursor: 'pointer',
    transition: 'opacity 0.1s',
  },
  buyBtn: {
    padding: '8px 28px',
    background: 'var(--purple)', border: 'none',
    borderRadius: 6, color: '#fff', fontSize: 12, fontWeight: 700,
    fontFamily: 'var(--font)', cursor: 'pointer',
    transition: 'opacity 0.1s',
  },
  uninstallBtn: {
    padding: '8px 20px',
    background: 'transparent', border: '1px solid var(--red)',
    borderRadius: 6, color: 'var(--red)', fontSize: 12, fontWeight: 600,
    fontFamily: 'var(--font)', cursor: 'pointer',
  },
  freeLabel: {
    fontSize: 9, color: 'var(--text-muted)', fontWeight: 500,
  },
  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 10, fontWeight: 600, color: 'var(--text-muted)',
    textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8,
  },
  description: {
    fontSize: 12, color: 'var(--text-primary)', lineHeight: 1.6,
  },
  tagRow: {
    display: 'flex', gap: 5, flexWrap: 'wrap',
  },
  tag: {
    fontSize: 10, padding: '2px 8px', borderRadius: 4,
    background: 'var(--bg-active)', color: 'var(--text-dim)',
  },
  roleTag: {
    fontSize: 10, padding: '2px 8px', borderRadius: 4,
    background: 'rgba(51, 175, 188, 0.1)', color: 'var(--accent)',
  },
  authorCard: {
    display: 'flex', gap: 12, alignItems: 'center',
    padding: '10px 12px',
    background: 'var(--bg-surface)', border: '1px solid var(--border)',
    borderRadius: 6,
  },
  authorAvatar: {
    width: 36, height: 36, borderRadius: 6,
    background: 'var(--accent)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 14, fontWeight: 700, color: 'var(--bg-base)',
    flexShrink: 0,
  },
  authorDetails: {
    flex: 1,
  },
  authorName: {
    fontSize: 12, fontWeight: 600, color: 'var(--text-bright)',
  },
  authorLinks: {
    display: 'flex', gap: 10, marginTop: 4,
  },
  authorLink: {
    fontSize: 10, color: 'var(--accent)', textDecoration: 'none',
  },
  contentPre: {
    fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.6,
    fontFamily: 'var(--font)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
    maxHeight: 300, overflowY: 'auto',
    padding: '10px 12px', background: 'var(--bg-surface)',
    border: '1px solid var(--border)', borderRadius: 6,
  },
};
