// GROOVE — Skill Store
// FSL-1.1-Apache-2.0 — see LICENSE

import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, unlinkSync, rmSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export class SkillStore {
  constructor(daemon) {
    this.daemon = daemon;
    this.skillsDir = resolve(daemon.grooveDir, 'skills');
    mkdirSync(this.skillsDir, { recursive: true });

    // Load bundled registry
    this.registry = [];
    try {
      const regPath = resolve(__dirname, '../skills-registry.json');
      this.registry = JSON.parse(readFileSync(regPath, 'utf8'));
    } catch { /* no registry file */ }
  }

  /**
   * Get all skills from the registry with installed status.
   */
  getRegistry(query) {
    let skills = this.registry.map((s) => ({
      ...s,
      installed: this._isInstalled(s.id),
    }));

    // Search filter
    if (query?.search) {
      const q = query.search.toLowerCase();
      skills = skills.filter((s) =>
        s.name.toLowerCase().includes(q)
        || s.description.toLowerCase().includes(q)
        || s.tags.some((t) => t.includes(q))
      );
    }

    // Category filter
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
   * Install a skill from the registry.
   * Copies the SKILL.md content from the Claude plugins directory.
   */
  install(skillId) {
    const entry = this.registry.find((s) => s.id === skillId);
    if (!entry) throw new Error(`Skill not found: ${skillId}`);
    if (this._isInstalled(skillId)) throw new Error(`Skill already installed: ${skillId}`);

    // Find the skill content from Claude's plugin directory
    const content = this._findSkillContent(skillId);
    if (!content) {
      throw new Error(`Skill content not found. Make sure Claude Code plugins are installed.`);
    }

    // Save to .groove/skills/<id>/SKILL.md
    const skillDir = resolve(this.skillsDir, skillId);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(resolve(skillDir, 'SKILL.md'), content);

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
