// FSL-1.1-Apache-2.0 — see LICENSE
// Keeper — lightweight tagged memory system.
// Flat file-backed storage: one tag = one markdown file.
// Hierarchical namespacing via "/" in tag names (groove/memory-system → groove/memory-system.md).

import { resolve, dirname } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs';

export const KEEPER_COMMANDS = {
  save:     { syntax: '[save] #tag',             description: 'Save the current message as a tagged memory' },
  append:   { syntax: '[append] #tag',           description: 'Add content to an existing memory without overwriting' },
  update:   { syntax: '[update] #tag',           description: 'Open the memory editor to edit in place' },
  delete:   { syntax: '[delete] #tag',           description: 'Delete a tagged memory' },
  read:     { syntax: '[read] #tag1 #tag2 ...',  description: 'Send memory content to the agent — agent reads it, chat stays clean' },
  view:     { syntax: '[view] #tag',             description: 'Open a memory in the viewer' },
  doc:      { syntax: '[doc] #tag',              description: 'AI reads the full conversation and generates a robust document' },
  link:     { syntax: '[link] #tag path/to/doc', description: 'Link a memory tag to a NORTHSTAR or external document' },
  instruct: { syntax: '[instruct]',              description: 'Show all Keeper commands and usage instructions' },
};

export class Keeper {
  constructor(grooveDir) {
    this.dir = resolve(grooveDir, 'keeper');
    this.indexPath = resolve(this.dir, 'index.json');
    mkdirSync(this.dir, { recursive: true });
    this._index = this._loadIndex();
  }

  _loadIndex() {
    try {
      if (existsSync(this.indexPath)) {
        return JSON.parse(readFileSync(this.indexPath, 'utf8'));
      }
    } catch { /* corrupted — rebuild */ }
    return {};
  }

  _saveIndex() {
    writeFileSync(this.indexPath, JSON.stringify(this._index, null, 2));
  }

  _tagToPath(tag) {
    const safe = tag.replace(/[^a-zA-Z0-9/_-]/g, '');
    if (!safe) throw new Error('Invalid tag name');
    return resolve(this.dir, `${safe}.md`);
  }

  _ensureParentDir(filePath) {
    const dir = dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  _normalize(tag) {
    return tag.replace(/^#/, '').trim().toLowerCase();
  }

  // ── CRUD ──────────────────────────────────────────────────

  save(tag, content) {
    if (!tag || typeof tag !== 'string') throw new Error('Tag is required');
    if (content === undefined || content === null || !String(content).trim()) throw new Error('Content is required');
    const normalized = this._normalize(tag);
    if (!normalized) throw new Error('Tag is required');
    const filePath = this._tagToPath(normalized);
    this._ensureParentDir(filePath);
    writeFileSync(filePath, String(content));
    this._index[normalized] = {
      tag: normalized,
      type: this._index[normalized]?.type || 'manual',
      links: this._index[normalized]?.links || [],
      createdAt: this._index[normalized]?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      size: String(content).length,
    };
    this._saveIndex();
    return { tag: normalized, ...this._index[normalized] };
  }

  append(tag, content) {
    if (!tag || typeof tag !== 'string') throw new Error('Tag is required');
    if (!content) throw new Error('Content is required');
    const normalized = this._normalize(tag);
    if (!normalized) throw new Error('Tag is required');
    const filePath = this._tagToPath(normalized);
    if (!existsSync(filePath)) {
      return this.save(normalized, content);
    }
    const existing = readFileSync(filePath, 'utf8');
    const updated = existing + '\n\n---\n\n' + String(content);
    writeFileSync(filePath, updated);
    this._index[normalized] = {
      ...this._index[normalized],
      updatedAt: new Date().toISOString(),
      size: updated.length,
    };
    this._saveIndex();
    return { tag: normalized, ...this._index[normalized] };
  }

  get(tag) {
    const normalized = this._normalize(tag);
    if (!normalized) throw new Error('Tag is required');
    const filePath = this._tagToPath(normalized);
    if (!existsSync(filePath)) return null;
    const content = readFileSync(filePath, 'utf8');
    const meta = this._index[normalized] || {};
    return { tag: normalized, content, ...meta };
  }

  pull(tags) {
    const items = [];
    for (const tag of tags) {
      const normalized = this._normalize(tag);
      if (!normalized) continue;
      const item = this.get(normalized);
      if (item) items.push(item);
      const children = this.children(normalized);
      for (const child of children) {
        const childItem = this.get(child.tag);
        if (childItem && !items.some(i => i.tag === childItem.tag)) {
          items.push(childItem);
        }
      }
    }
    if (items.length === 0) return null;
    return items.map(i => `## #${i.tag}\n\n${i.content}`).join('\n\n---\n\n');
  }

  update(tag, content) {
    const normalized = this._normalize(tag);
    if (!normalized) throw new Error('Tag is required');
    if (content === undefined || content === null || !String(content).trim()) throw new Error('Content is required');
    const filePath = this._tagToPath(normalized);
    if (!existsSync(filePath)) throw new Error(`Memory #${normalized} does not exist`);
    writeFileSync(filePath, String(content));
    this._index[normalized] = {
      ...this._index[normalized],
      updatedAt: new Date().toISOString(),
      size: String(content).length,
    };
    this._saveIndex();
    return { tag: normalized, ...this._index[normalized] };
  }

  delete(tag) {
    const normalized = this._normalize(tag);
    if (!normalized) throw new Error('Tag is required');
    const filePath = this._tagToPath(normalized);
    if (!existsSync(filePath)) return false;
    unlinkSync(filePath);
    delete this._index[normalized];
    this._saveIndex();
    return true;
  }

  move(oldTag, newTag) {
    const oldNorm = this._normalize(oldTag);
    const newNorm = this._normalize(newTag);
    if (!oldNorm || !newNorm) throw new Error('Both old and new tags are required');
    if (oldNorm === newNorm) return this._index[oldNorm];
    const oldPath = this._tagToPath(oldNorm);
    if (!existsSync(oldPath)) throw new Error(`Memory #${oldNorm} does not exist`);
    if (this._index[newNorm]) throw new Error(`Memory #${newNorm} already exists`);
    const content = readFileSync(oldPath, 'utf8');
    const newPath = this._tagToPath(newNorm);
    this._ensureParentDir(newPath);
    writeFileSync(newPath, content);
    unlinkSync(oldPath);
    this._index[newNorm] = { ...this._index[oldNorm], tag: newNorm, updatedAt: new Date().toISOString() };
    delete this._index[oldNorm];
    // Move children too (e.g. moving "a" to "b/a" also moves "a/child" to "b/a/child")
    const prefix = oldNorm + '/';
    for (const tag of Object.keys(this._index)) {
      if (tag.startsWith(prefix)) {
        const childSuffix = tag.slice(prefix.length);
        const childNewTag = newNorm + '/' + childSuffix;
        const childOldPath = this._tagToPath(tag);
        const childNewPath = this._tagToPath(childNewTag);
        const childContent = readFileSync(childOldPath, 'utf8');
        this._ensureParentDir(childNewPath);
        writeFileSync(childNewPath, childContent);
        unlinkSync(childOldPath);
        this._index[childNewTag] = { ...this._index[tag], tag: childNewTag, updatedAt: new Date().toISOString() };
        delete this._index[tag];
      }
    }
    this._saveIndex();
    return { tag: newNorm, ...this._index[newNorm] };
  }

  // ── Doc (AI-generated) ───────────────────────────────────

  saveDoc(tag, content) {
    const normalized = this._normalize(tag);
    if (!normalized) throw new Error('Tag is required');
    const result = this.save(normalized, content);
    this._index[normalized].type = 'doc';
    this._saveIndex();
    return { tag: normalized, ...this._index[normalized] };
  }

  // ── Links ─────────────────────────────────────────────────

  link(tag, docPath) {
    const normalized = this._normalize(tag);
    if (!normalized) throw new Error('Tag is required');
    if (!docPath) throw new Error('Document path is required');
    if (!this._index[normalized]) {
      this.save(normalized, `Linked to: ${docPath}`);
    }
    const links = this._index[normalized].links || [];
    if (!links.includes(docPath)) {
      links.push(docPath);
    }
    this._index[normalized].links = links;
    this._saveIndex();
    return { tag: normalized, ...this._index[normalized] };
  }

  unlink(tag, docPath) {
    const normalized = this._normalize(tag);
    if (!normalized) throw new Error('Tag is required');
    if (!this._index[normalized]) return false;
    this._index[normalized].links = (this._index[normalized].links || []).filter(l => l !== docPath);
    this._saveIndex();
    return true;
  }

  // ── Query ─────────────────────────────────────────────────

  list() {
    return Object.values(this._index).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  }

  children(parentTag) {
    const normalized = this._normalize(parentTag);
    const prefix = normalized + '/';
    return Object.values(this._index)
      .filter(entry => entry.tag.startsWith(prefix))
      .sort((a, b) => a.tag.localeCompare(b.tag));
  }

  tree() {
    const entries = this.list();
    const roots = [];
    const childMap = {};

    for (const entry of entries) {
      const parts = entry.tag.split('/');
      if (parts.length === 1) {
        roots.push({ ...entry, children: [] });
      } else {
        const parent = parts.slice(0, -1).join('/');
        if (!childMap[parent]) childMap[parent] = [];
        childMap[parent].push(entry);
      }
    }

    for (const root of roots) {
      root.children = childMap[root.tag] || [];
    }

    for (const [parent, children] of Object.entries(childMap)) {
      if (!roots.some(r => r.tag === parent) && !parent.includes('/')) {
        roots.push({ tag: parent, virtual: true, children });
      }
    }

    return roots.sort((a, b) => a.tag.localeCompare(b.tag));
  }

  search(query) {
    if (!query) return this.list();
    const q = query.toLowerCase();
    const results = [];
    for (const entry of Object.values(this._index)) {
      if (entry.tag.includes(q)) {
        results.push({ ...entry, matchType: 'tag' });
        continue;
      }
      const item = this.get(entry.tag);
      if (item && item.content.toLowerCase().includes(q)) {
        results.push({ ...entry, matchType: 'content' });
      }
    }
    return results.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  }

  // ── Command parser ────────────────────────────────────────

  static parseCommand(text) {
    const cmdMatch = text.match(/\[(save|append|update|delete|view|doc|link|read|instruct)\]/i);
    if (!cmdMatch) return null;
    const command = cmdMatch[1].toLowerCase();
    const rest = text.slice(cmdMatch.index + cmdMatch[0].length).trim();

    if (command === 'instruct') {
      return { command, tags: [], extra: null };
    }

    if (command === 'link') {
      const linkMatch = rest.match(/^((?:#[\w/.-]+\s*)+)\s+(.+)$/);
      if (!linkMatch) return null;
      const tags = linkMatch[1].match(/#[\w/.-]+/g).map(t => t.replace(/^#/, ''));
      return { command, tags, extra: linkMatch[2].trim() };
    }

    const tags = (rest.match(/#[\w/.-]+/g) || []).map(t => t.replace(/^#/, ''));
    if (tags.length === 0 && command !== 'instruct') return null;
    return { command, tags, extra: null };
  }
}
