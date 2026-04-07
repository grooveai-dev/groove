// GROOVE — Skill Store
// FSL-1.1-Apache-2.0 — see LICENSE

import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, unlinkSync, rmSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SKILLS_API = 'https://docs.groovedev.ai/api/v1';

// Normalize snake_case API fields to camelCase used by GUI
function normalize(skill) {
  return {
    ...skill,
    ratingCount: skill.ratingCount ?? skill.rating_count ?? 0,
    contentUrl: skill.contentUrl ?? skill.content_url ?? null,
    authorId: skill.authorId ?? skill.author_id ?? null,
    createdAt: skill.createdAt ?? skill.created_at ?? null,
    updatedAt: skill.updatedAt ?? skill.updated_at ?? null,
  };
}

export class SkillStore {
  constructor(daemon) {
    this.daemon = daemon;
    this.skillsDir = resolve(daemon.grooveDir, 'skills');
    mkdirSync(this.skillsDir, { recursive: true });

    // Load bundled registry as fallback
    this.registry = [];
    try {
      const regPath = resolve(__dirname, '../skills-registry.json');
      this.registry = JSON.parse(readFileSync(regPath, 'utf8'));
    } catch { /* no registry file */ }

    // Fetch full registry from live API in background
    this._refreshRegistry();
  }

  async _refreshRegistry() {
    try {
      const res = await fetch(`${SKILLS_API}/skills?limit=200`, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const data = await res.json();
        this.registry = (data.skills || data).map(normalize);
      }
    } catch { /* offline — use bundled */ }
  }

  /**
   * Get skills from the live API, with local fallback.
   * Server handles search + category filtering when online.
   */
  async getRegistry(query) {
    // Try live API first — server handles search/filter/sort
    try {
      const params = new URLSearchParams();
      if (query?.search) params.set('search', query.search);
      if (query?.category && query.category !== 'all') params.set('category', query.category);
      params.set('limit', '200');

      const res = await fetch(`${SKILLS_API}/skills?${params}`, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const data = await res.json();
        const skills = (data.skills || data).map((s) => ({
          ...normalize(s),
          installed: this._isInstalled(s.id),
        }));
        return skills;
      }
    } catch { /* fall through to local */ }

    // Offline fallback — filter locally from cached registry
    let skills = this.registry.map((s) => ({
      ...s,
      installed: this._isInstalled(s.id),
    }));

    if (query?.search) {
      const q = query.search.toLowerCase();
      skills = skills.filter((s) =>
        s.name.toLowerCase().includes(q)
        || s.description.toLowerCase().includes(q)
        || (s.tags || []).some((t) => t.includes(q))
      );
    }

    if (query?.category && query.category !== 'all') {
      skills = skills.filter((s) => s.category === query.category);
    }

    return skills;
  }

  /**
   * Get installed skills only.
   */
  getInstalled() {
    const installed = [];
    if (!existsSync(this.skillsDir)) return installed;

    for (const dir of readdirSync(this.skillsDir, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      const skillPath = resolve(this.skillsDir, dir.name, 'SKILL.md');
      if (!existsSync(skillPath)) continue;

      const content = readFileSync(skillPath, 'utf8');
      const meta = this._parseFrontmatter(content);

      // Merge with registry info if available
      const regEntry = this.registry.find((r) => r.id === dir.name);

      installed.push({
        ...(regEntry || {}),
        id: dir.name,
        name: meta.name || regEntry?.name || dir.name,
        description: meta.description || regEntry?.description || '',
        category: regEntry?.category || 'custom',
        tags: regEntry?.tags || [],
        roles: regEntry?.roles || [],
        author: regEntry?.author || 'local',
        installed: true,
      });
    }

    return installed;
  }

  /**
   * Install a skill.
   * Downloads content from live API, falls back to contentUrl, then local plugins.
   */
  async install(skillId) {
    const entry = this.registry.find((s) => s.id === skillId);
    if (!entry) throw new Error(`Skill not found: ${skillId}`);
    if (this._isInstalled(skillId)) throw new Error(`Skill already installed: ${skillId}`);

    let content = null;

    // Try live API content endpoint first
    try {
      const res = await fetch(`${SKILLS_API}/skills/${skillId}/content`, { signal: AbortSignal.timeout(10000) });
      if (res.ok) {
        const data = await res.json();
        content = data.content;
      }
    } catch { /* fall through */ }

    // Fall back to contentUrl from registry entry
    if (!content && entry.contentUrl) {
      try {
        const res = await fetch(entry.contentUrl, { signal: AbortSignal.timeout(10000) });
        if (res.ok) content = await res.text();
      } catch { /* fall through */ }
    }

    // Fall back to local Claude plugins
    if (!content) {
      content = this._findSkillContent(skillId);
    }

    if (!content) {
      throw new Error(`Could not download skill. Check your internet connection.`);
    }

    // Save to .groove/skills/<id>/SKILL.md
    const skillDir = resolve(this.skillsDir, skillId);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(resolve(skillDir, 'SKILL.md'), content);

    // Track install on server (fire-and-forget, no auth needed)
    fetch(`${SKILLS_API}/skills/${skillId}/install`, {
      method: 'POST',
      signal: AbortSignal.timeout(5000),
    }).catch(() => {});

    this.daemon.audit.log('skill.install', { id: skillId, name: entry.name });

    return { id: skillId, name: entry.name, installed: true };
  }

  /**
   * Uninstall a skill.
   */
  uninstall(skillId) {
    const skillDir = resolve(this.skillsDir, skillId);
    if (!existsSync(skillDir)) throw new Error(`Skill not installed: ${skillId}`);

    rmSync(skillDir, { recursive: true });
    this.daemon.audit.log('skill.uninstall', { id: skillId });

    return { id: skillId, installed: false };
  }

  /**
   * Rate a skill. Proxies to the skills server.
   */
  async rate(skillId, rating) {
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new Error('Rating must be an integer from 1 to 5');
    }
    const res = await fetch(`${SKILLS_API}/skills/${skillId}/rate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Rating failed');
    }
    return res.json();
  }

  /**
   * Get the full content of an installed skill.
   */
  getContent(skillId) {
    const skillPath = resolve(this.skillsDir, skillId, 'SKILL.md');
    if (!existsSync(skillPath)) return null;
    return readFileSync(skillPath, 'utf8');
  }

  /**
   * Get available categories from the registry.
   */
  getCategories() {
    const cats = new Map();
    for (const skill of this.registry) {
      const count = cats.get(skill.category) || 0;
      cats.set(skill.category, count + 1);
    }
    return Array.from(cats.entries())
      .map(([id, count]) => ({ id, count }))
      .sort((a, b) => b.count - a.count);
  }

  // --- Internal ---

  _isInstalled(skillId) {
    return existsSync(resolve(this.skillsDir, skillId, 'SKILL.md'));
  }

  _findSkillContent(skillId) {
    // Search Claude's plugins directory for the skill
    const pluginsBase = resolve(process.env.HOME || '~', '.claude', 'plugins', 'marketplaces', 'claude-plugins-official', 'plugins');

    if (!existsSync(pluginsBase)) return null;

    // Skills can be nested: plugins/<plugin>/skills/<skill>/SKILL.md
    for (const pluginDir of readdirSync(pluginsBase)) {
      const skillsPath = resolve(pluginsBase, pluginDir, 'skills');
      if (!existsSync(skillsPath)) continue;

      for (const skillDir of readdirSync(skillsPath)) {
        if (skillDir === skillId || pluginDir === skillId) {
          const skillFile = resolve(skillsPath, skillDir, 'SKILL.md');
          if (existsSync(skillFile)) {
            return readFileSync(skillFile, 'utf8');
          }
        }
      }

      // Also check commands/<id>.md
      const cmdsPath = resolve(pluginsBase, pluginDir, 'commands');
      if (!existsSync(cmdsPath)) continue;

      const cmdFile = resolve(cmdsPath, `${skillId}.md`);
      if (existsSync(cmdFile)) {
        return readFileSync(cmdFile, 'utf8');
      }
    }

    return null;
  }

  _parseFrontmatter(content) {
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return {};

    const meta = {};
    for (const line of match[1].split('\n')) {
      const sep = line.indexOf(':');
      if (sep === -1) continue;
      const key = line.slice(0, sep).trim();
      const val = line.slice(sep + 1).trim();
      meta[key] = val;
    }
    return meta;
  }
}
