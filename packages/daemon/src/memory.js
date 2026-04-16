// GROOVE — Persistent Agent Memory (Layer 7)
// FSL-1.1-Apache-2.0 — see LICENSE
//
// Four file types, all in .groove/memory/:
//   - project-constraints.md    Discovered project rules, do-not-touch, required patterns
//   - handoff-chain/<role>.md   Cumulative rotation briefs (newest first, last 10 kept)
//   - agent-discoveries.jsonl   Error→fix pairs (only successes stored)
//   - agent-specializations.json Per-agent and per-project-role quality profiles
//
// Read by the introducer on every spawn so agent #50 knows what agent #1 learned.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, appendFileSync, statSync } from 'fs';
import { resolve, relative } from 'path';
import { createHash } from 'crypto';
import { minimatch } from 'minimatch';

const MAX_CONSTRAINTS = 50;
const MAX_HANDOFF_ROTATIONS = 25;
const MAX_DISCOVERIES = 1000;
const HANDOFF_BRIEF_MAX_CHARS = 4000;

function hashText(text) {
  return createHash('sha1').update(text.trim().toLowerCase()).digest('hex').slice(0, 12);
}

function safeName(role) {
  return (role || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
}

function truncate(text, max) {
  if (!text || text.length <= max) return text || '';
  return text.slice(0, max - 3) + '...';
}

export class MemoryStore {
  constructor(grooveDir) {
    this.memDir = resolve(grooveDir, 'memory');
    this.projectDir = resolve(grooveDir, '..');
    this.constraintsPath = resolve(this.memDir, 'project-constraints.md');
    this.handoffDir = resolve(this.memDir, 'handoff-chain');
    this.discoveriesPath = resolve(this.memDir, 'agent-discoveries.jsonl');
    this.specializationsPath = resolve(this.memDir, 'agent-specializations.json');
    this._ensureDirs();
  }

  _ensureDirs() {
    try {
      mkdirSync(this.memDir, { recursive: true });
      mkdirSync(this.handoffDir, { recursive: true });
    } catch { /* best-effort */ }
  }

  // --- Project Constraints ---

  listConstraints() {
    if (!existsSync(this.constraintsPath)) return [];
    try {
      const content = readFileSync(this.constraintsPath, 'utf8');
      const constraints = [];
      const blocks = content.split(/\n(?=- )/); // each constraint starts with "- "
      for (const block of blocks) {
        const m = block.match(/^- \[([a-f0-9]+)\] \*([^*]+)\* (.+)$/s);
        if (m) {
          constraints.push({
            hash: m[1],
            category: m[2].trim(),
            text: m[3].trim(),
          });
        }
      }
      return constraints;
    } catch {
      return [];
    }
  }

  addConstraint({ text, category = 'general' }) {
    if (!text || typeof text !== 'string') return { added: false, error: 'text required' };
    const trimmed = text.trim();
    if (trimmed.length < 3) return { added: false, error: 'text too short' };
    if (trimmed.length > 500) return { added: false, error: 'text too long (max 500 chars)' };

    const hash = hashText(trimmed);
    const existing = this.listConstraints();
    if (existing.some((c) => c.hash === hash)) {
      return { added: false, hash, reason: 'duplicate' };
    }

    existing.push({ hash, category, text: trimmed });
    // Keep most recent MAX_CONSTRAINTS
    const pruned = existing.slice(-MAX_CONSTRAINTS);
    this._writeConstraints(pruned);
    return { added: true, hash };
  }

  removeConstraint(hash) {
    const existing = this.listConstraints();
    const filtered = existing.filter((c) => c.hash !== hash);
    if (filtered.length === existing.length) return false;
    this._writeConstraints(filtered);
    return true;
  }

  _writeConstraints(constraints) {
    const lines = [
      '# Project Constraints',
      `*Auto-managed by GROOVE memory (Layer 7). Last updated: ${new Date().toISOString()}*`,
      '',
    ];
    for (const c of constraints) {
      lines.push(`- [${c.hash}] *${c.category}* ${c.text}`);
    }
    lines.push('');
    try {
      writeFileSync(this.constraintsPath, lines.join('\n'));
    } catch { /* best-effort */ }
  }

  getConstraintsMarkdown(maxChars = 4000) {
    const constraints = this.listConstraints();
    if (constraints.length === 0) return '';
    const byCategory = {};
    for (const c of constraints) {
      byCategory[c.category] = byCategory[c.category] || [];
      byCategory[c.category].push(c.text);
    }
    const lines = [];
    for (const [cat, items] of Object.entries(byCategory)) {
      lines.push(`**${cat}:**`);
      for (const item of items) lines.push(`- ${item}`);
      lines.push('');
    }
    return truncate(lines.join('\n').trim(), maxChars);
  }

  // --- Handoff Chain ---

  _workspaceSlug(workingDir) {
    if (!workingDir) return '';
    const rel = relative(this.projectDir, workingDir);
    if (!rel || rel === '.' || rel.startsWith('..')) return '';
    return safeName(rel);
  }

  _chainPath(role, workingDir, teamId) {
    if (teamId) {
      const dir = resolve(this.handoffDir, safeName(teamId));
      mkdirSync(dir, { recursive: true });
      return resolve(dir, `${safeName(role)}.md`);
    }
    const slug = this._workspaceSlug(workingDir);
    if (slug) {
      const dir = resolve(this.handoffDir, slug);
      mkdirSync(dir, { recursive: true });
      return resolve(dir, `${safeName(role)}.md`);
    }
    return resolve(this.handoffDir, `${safeName(role)}.md`);
  }

  getHandoffChain(role, workingDir, teamId) {
    const path = this._chainPath(role, workingDir, teamId);
    if (!existsSync(path)) return [];
    try {
      const content = readFileSync(path, 'utf8');
      const entries = [];
      const blocks = content.split(/\n(?=## Rotation )/);
      for (const block of blocks) {
        const headerMatch = block.match(/^## Rotation (\d+) —/);
        if (!headerMatch) continue;
        const body = block.replace(/\n---\s*$/, '').trim();
        entries.push({
          rotationN: parseInt(headerMatch[1], 10),
          body,
        });
      }
      return entries;
    } catch {
      return [];
    }
  }

  appendHandoffBrief(role, entry, workingDir, teamId) {
    if (!role || !entry) return false;
    const chain = this.getHandoffChain(role, workingDir, teamId);
    const nextN = (chain[0]?.rotationN || 0) + 1;

    const block = [
      `## Rotation ${nextN} — ${entry.timestamp || new Date().toISOString()} (${entry.agentId || '?'} → ${entry.newAgentId || '?'})`,
      `**Reason:** ${entry.reason || 'unknown'}`,
      entry.oldTokens != null ? `**Tokens carried:** ${entry.oldTokens.toLocaleString()}` : '',
      entry.contextUsage != null ? `**Context at rotation:** ${Math.round(entry.contextUsage * 100)}%` : '',
      '',
      '**Brief summary:**',
      truncate(entry.brief || '(no brief)', HANDOFF_BRIEF_MAX_CHARS),
      '',
    ].filter(Boolean).join('\n');

    const newChain = [{ rotationN: nextN, body: block }, ...chain].slice(0, MAX_HANDOFF_ROTATIONS);

    const lines = [
      `# ${role[0].toUpperCase() + role.slice(1)} Handoff Chain`,
      `*Cumulative rotation briefs. Newest first. Last ${MAX_HANDOFF_ROTATIONS} kept.*`,
      '',
    ];
    for (const e of newChain) {
      lines.push(e.body || '');
      lines.push('---');
      lines.push('');
    }

    try {
      writeFileSync(this._chainPath(role, workingDir, teamId), lines.join('\n'));
      return true;
    } catch {
      return false;
    }
  }

  getRecentHandoffMarkdown(role, count = 3, maxChars = 4000, workingDir, teamId) {
    const chain = this.getHandoffChain(role, workingDir, teamId);
    if (chain.length === 0) return '';
    const recent = chain.slice(0, count);
    const out = recent.map((e) => e.body || '').join('\n\n---\n\n');
    return truncate(out, maxChars);
  }

  listHandoffRoles(workingDir) {
    const slug = this._workspaceSlug(workingDir);
    const dir = slug ? resolve(this.handoffDir, slug) : this.handoffDir;
    if (!existsSync(dir)) return [];
    try {
      return readdirSync(dir)
        .filter((f) => f.endsWith('.md'))
        .map((f) => f.replace(/\.md$/, ''));
    } catch {
      return [];
    }
  }

  // --- Discoveries (error → fix pairs) ---

  addDiscovery({ agentId, role, trigger, fix, outcome = 'success' }) {
    if (!trigger || !fix) return { added: false, error: 'trigger and fix required' };
    if (outcome !== 'success') return { added: false, reason: 'only successes stored' };

    const fileExtPattern = /[\w./-]+\.(?:js|ts|json|md|jsx|tsx|css|mjs|cjs)\b/g;
    const triggerTokens = new Set((String(trigger).match(fileExtPattern) || []).map(t => t.toLowerCase()));
    const fixTokens = new Set((String(fix).match(fileExtPattern) || []).map(t => t.toLowerCase()));
    const hasOverlap = [...triggerTokens].some(t => fixTokens.has(t));
    if (triggerTokens.size > 0 && fixTokens.size > 0 && !hasOverlap) {
      return { added: false, reason: 'trigger and fix are unrelated' };
    }

    const entry = {
      ts: new Date().toISOString(),
      agentId: agentId || null,
      role: role || 'unknown',
      trigger: truncate(String(trigger).trim(), 300),
      fix: truncate(String(fix).trim(), 500),
      outcome,
    };

    // Dedup: same trigger+fix = skip
    const existing = this.listDiscoveries({ limit: 200 });
    const key = hashText(entry.trigger + '||' + entry.fix);
    if (existing.some((d) => hashText(d.trigger + '||' + d.fix) === key)) {
      return { added: false, reason: 'duplicate' };
    }

    try {
      appendFileSync(this.discoveriesPath, JSON.stringify(entry) + '\n');
      this._pruneDiscoveries();
      return { added: true };
    } catch (err) {
      return { added: false, error: err.message };
    }
  }

  listDiscoveries({ role, limit = 100 } = {}) {
    if (!existsSync(this.discoveriesPath)) return [];
    try {
      const lines = readFileSync(this.discoveriesPath, 'utf8').split('\n').filter(Boolean);
      const entries = [];
      for (const line of lines) {
        try {
          const e = JSON.parse(line);
          if (!role || e.role === role) entries.push(e);
        } catch { /* skip malformed */ }
      }
      return entries.slice(-limit).reverse(); // newest first
    } catch {
      return [];
    }
  }

  _pruneDiscoveries() {
    if (!existsSync(this.discoveriesPath)) return;
    try {
      const stat = statSync(this.discoveriesPath);
      // Only prune on larger files to avoid thrashing
      if (stat.size < 50_000) return;
      const lines = readFileSync(this.discoveriesPath, 'utf8').split('\n').filter(Boolean);
      if (lines.length <= MAX_DISCOVERIES) return;
      const kept = lines.slice(-MAX_DISCOVERIES);
      writeFileSync(this.discoveriesPath, kept.join('\n') + '\n');
    } catch { /* best-effort */ }
  }

  getDiscoveriesMarkdown(role, limit = 20, maxChars = 4000, scope) {
    let entries = this.listDiscoveries({ role, limit: limit * 3 });
    if (entries.length === 0) return '';

    if (scope && Array.isArray(scope) && scope.length > 0) {
      const filtered = entries.filter((d) => {
        const file = d.fix || '';
        const rel = file.startsWith(this.projectDir + '/') ? file.slice(this.projectDir.length + 1) : file;
        return scope.some((pattern) => minimatch(rel, pattern, { dot: true }));
      });
      if (filtered.length >= 3) {
        entries = filtered;
      }
    }

    entries = entries.slice(0, limit);
    const lines = entries.map((d) => `- When \`${d.trigger}\` → fix: ${d.fix}`);
    return truncate(lines.join('\n'), maxChars);
  }

  // --- Specializations ---

  _loadSpecializations() {
    if (!existsSync(this.specializationsPath)) {
      return { perAgent: {}, perProjectRole: {} };
    }
    try {
      const data = JSON.parse(readFileSync(this.specializationsPath, 'utf8'));
      return {
        perAgent: data.perAgent || {},
        perProjectRole: data.perProjectRole || {},
      };
    } catch {
      return { perAgent: {}, perProjectRole: {} };
    }
  }

  _saveSpecializations(data) {
    try {
      writeFileSync(this.specializationsPath, JSON.stringify(data, null, 2));
    } catch { /* best-effort */ }
  }

  updateSpecialization(agentId, { role, qualityScore, filesTouched, signals, threshold }) {
    if (!agentId) return false;
    const data = this._loadSpecializations();

    const agentEntry = data.perAgent[agentId] || {
      role: role || 'unknown',
      sessionCount: 0,
      avgQualityScore: 0,
      qualityTotal: 0,
      fileTouches: {},
      signatureErrors: [],
    };
    agentEntry.sessionCount += 1;
    if (typeof qualityScore === 'number') {
      agentEntry.qualityTotal += qualityScore;
      agentEntry.avgQualityScore = Math.round(agentEntry.qualityTotal / agentEntry.sessionCount);
    }
    if (Array.isArray(filesTouched)) {
      for (const f of filesTouched) {
        agentEntry.fileTouches[f] = (agentEntry.fileTouches[f] || 0) + 1;
      }
    }
    if (role) agentEntry.role = role;
    if (threshold != null) agentEntry.preferredThreshold = threshold;
    data.perAgent[agentId] = agentEntry;

    if (role) {
      const roleEntry = data.perProjectRole[role] || {
        sessionCount: 0,
        avgQualityScore: 0,
        qualityTotal: 0,
        topFileChurn: {},
      };
      roleEntry.sessionCount += 1;
      if (typeof qualityScore === 'number') {
        roleEntry.qualityTotal += qualityScore;
        roleEntry.avgQualityScore = Math.round(roleEntry.qualityTotal / roleEntry.sessionCount);
      }
      if (Array.isArray(filesTouched)) {
        for (const f of filesTouched) {
          roleEntry.topFileChurn[f] = (roleEntry.topFileChurn[f] || 0) + 1;
        }
      }
      data.perProjectRole[role] = roleEntry;
    }

    this._saveSpecializations(data);
    return true;
  }

  getSpecialization(agentId) {
    return this._loadSpecializations().perAgent[agentId] || null;
  }

  getAllSpecializations() {
    return this._loadSpecializations();
  }
}
