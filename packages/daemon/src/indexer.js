// GROOVE — Codebase Indexer
// FSL-1.1-Apache-2.0 — see LICENSE
//
// Scans the project structure on daemon start to detect monorepo workspaces,
// key files, and directory layout. Agents read this instead of spending
// thousands of tokens exploring the file tree.

import { readdirSync, statSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, relative, basename, join } from 'path';

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.groove', 'dist', 'build', '.next', '.nuxt',
  '.output', '.cache', '.turbo', '.vercel', '.svelte-kit', 'coverage',
  '__pycache__', '.venv', 'venv', 'vendor', 'target', '.gradle',
]);

const KEY_FILES = [
  'package.json', 'tsconfig.json', 'README.md', 'CLAUDE.md',
  'ARCHITECTURE.md', 'Cargo.toml', 'go.mod', 'pyproject.toml',
  'Makefile', 'Dockerfile', 'docker-compose.yml', 'docker-compose.yaml',
];

const MAX_DEPTH = 4;

export class CodebaseIndexer {
  constructor(daemon) {
    this.daemon = daemon;
    this.index = null;       // { tree, workspaces, keyFiles, stats }
    this.lastIndexTime = null;
    this.indexPath = resolve(daemon.grooveDir, 'codebase-index.json');
  }

  /**
   * Scan the project directory and build the codebase index.
   * Called on daemon start. Fast — only reads directory entries, not file contents.
   */
  scan() {
    const rootDir = this.daemon.projectDir;
    const tree = [];
    const workspaces = [];
    const keyFiles = [];
    let totalFiles = 0;
    let totalDirs = 0;

    // Recursive directory walker (depth-limited)
    const walk = (dir, depth, relPath) => {
      if (depth > MAX_DEPTH) return;

      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }

      const dirs = [];
      const files = [];

      for (const entry of entries) {
        if (entry.name.startsWith('.') && entry.name !== '.github') continue;

        if (entry.isDirectory()) {
          if (IGNORE_DIRS.has(entry.name)) continue;
          dirs.push(entry.name);
          totalDirs++;
        } else if (entry.isFile()) {
          files.push(entry.name);
          totalFiles++;

          // Track key files
          if (KEY_FILES.includes(entry.name)) {
            const filePath = relPath ? `${relPath}/${entry.name}` : entry.name;
            keyFiles.push(filePath);
          }
        }
      }

      // Add to tree
      const nodePath = relPath || '.';
      tree.push({
        path: nodePath,
        depth,
        dirs: dirs.length,
        files: files.length,
        children: dirs,
      });

      // Recurse into subdirectories
      for (const d of dirs) {
        walk(resolve(dir, d), depth + 1, relPath ? `${relPath}/${d}` : d);
      }
    };

    walk(rootDir, 0, '');

    // Detect workspaces
    this.detectWorkspaces(rootDir, workspaces, tree);

    this.index = {
      projectName: basename(rootDir),
      scannedAt: new Date().toISOString(),
      stats: { totalFiles, totalDirs, treeDepth: MAX_DEPTH },
      workspaces,
      keyFiles,
      tree,
    };
    this.lastIndexTime = Date.now();

    // Persist to .groove/codebase-index.json
    try {
      writeFileSync(this.indexPath, JSON.stringify(this.index, null, 2));
    } catch {
      // Non-fatal — index is in memory either way
    }

    // Broadcast to GUI
    this.daemon.broadcast({
      type: 'indexer:complete',
      data: {
        workspaceCount: workspaces.length,
        workspaces,
        stats: this.index.stats,
      },
    });

    return this.index;
  }

  /**
   * Detect monorepo workspaces from common patterns.
   */
  detectWorkspaces(rootDir, workspaces, tree) {
    // 1. npm/yarn workspaces (package.json → workspaces field)
    const rootPkg = this.readJson(resolve(rootDir, 'package.json'));
    if (rootPkg?.workspaces) {
      const patterns = Array.isArray(rootPkg.workspaces)
        ? rootPkg.workspaces
        : rootPkg.workspaces.packages || [];
      this.resolveWorkspacePatterns(rootDir, patterns, workspaces, 'npm-workspaces');
    }

    // 2. pnpm workspaces
    const pnpmPath = resolve(rootDir, 'pnpm-workspace.yaml');
    if (existsSync(pnpmPath)) {
      try {
        const content = readFileSync(pnpmPath, 'utf8');
        // Simple YAML parse — extract lines like "  - packages/*"
        const patterns = [];
        for (const line of content.split('\n')) {
          const match = line.match(/^\s*-\s+['"]?([^'"]+)['"]?\s*$/);
          if (match) patterns.push(match[1]);
        }
        if (patterns.length > 0) {
          this.resolveWorkspacePatterns(rootDir, patterns, workspaces, 'pnpm-workspaces');
        }
      } catch { /* ignore */ }
    }

    // 3. lerna.json
    const lernaPath = resolve(rootDir, 'lerna.json');
    if (existsSync(lernaPath)) {
      const lerna = this.readJson(lernaPath);
      if (lerna?.packages) {
        this.resolveWorkspacePatterns(rootDir, lerna.packages, workspaces, 'lerna');
      }
    }

    // 4. Fallback: multiple package.json at depth 1-2 (non-declared monorepo)
    if (workspaces.length === 0) {
      const subPkgs = tree.filter((node) =>
        node.depth >= 1 && node.depth <= 2 &&
        this.hasKeyFile(rootDir, node.path, 'package.json')
      );
      if (subPkgs.length >= 2) {
        for (const node of subPkgs) {
          const pkgJson = this.readJson(resolve(rootDir, node.path, 'package.json'));
          workspaces.push({
            path: node.path,
            name: pkgJson?.name || basename(node.path),
            type: 'detected',
            files: node.files,
            dirs: node.dirs,
          });
        }
      }
    }
  }

  /**
   * Resolve workspace glob patterns (e.g. "packages/*") into actual directories.
   */
  resolveWorkspacePatterns(rootDir, patterns, workspaces, type) {
    const seen = new Set(workspaces.map((w) => w.path));

    for (const pattern of patterns) {
      // Handle simple glob: "packages/*", "apps/*"
      const clean = pattern.replace(/\/?\*+$/, '');
      const parentDir = resolve(rootDir, clean);

      if (!existsSync(parentDir)) continue;

      try {
        const stat = statSync(parentDir);

        if (pattern.includes('*')) {
          // It's a glob — list children of the parent directory
          const entries = readdirSync(parentDir, { withFileTypes: true });
          for (const entry of entries) {
            if (!entry.isDirectory() || IGNORE_DIRS.has(entry.name)) continue;
            const wsPath = clean ? `${clean}/${entry.name}` : entry.name;
            if (seen.has(wsPath)) continue;
            seen.add(wsPath);

            const fullPath = resolve(rootDir, wsPath);
            const pkgJson = this.readJson(resolve(fullPath, 'package.json'));
            const info = this.dirInfo(fullPath);
            workspaces.push({
              path: wsPath,
              name: pkgJson?.name || entry.name,
              type,
              files: info.files,
              dirs: info.dirs,
            });
          }
        } else if (stat.isDirectory()) {
          // Direct path (e.g. "shared")
          if (seen.has(clean)) continue;
          seen.add(clean);

          const pkgJson = this.readJson(resolve(parentDir, 'package.json'));
          const info = this.dirInfo(parentDir);
          workspaces.push({
            path: clean,
            name: pkgJson?.name || basename(clean),
            type,
            files: info.files,
            dirs: info.dirs,
          });
        }
      } catch { /* skip inaccessible dirs */ }
    }
  }

  // ── Helpers ──

  readJson(filePath) {
    try {
      return JSON.parse(readFileSync(filePath, 'utf8'));
    } catch {
      return null;
    }
  }

  hasKeyFile(rootDir, relPath, filename) {
    return existsSync(resolve(rootDir, relPath, filename));
  }

  dirInfo(dirPath) {
    try {
      const entries = readdirSync(dirPath, { withFileTypes: true });
      let files = 0, dirs = 0;
      for (const e of entries) {
        if (e.name.startsWith('.')) continue;
        if (e.isFile()) files++;
        else if (e.isDirectory() && !IGNORE_DIRS.has(e.name)) dirs++;
      }
      return { files, dirs };
    } catch {
      return { files: 0, dirs: 0 };
    }
  }

  // ── Public API ──

  getWorkspaces() {
    return this.index?.workspaces || [];
  }

  getIndex() {
    return this.index;
  }

  /**
   * Get a compact structural summary for agent context injection.
   * Returns a markdown string with workspace layout and key files.
   */
  getStructureSummary() {
    if (!this.index) return null;
    const { workspaces, keyFiles, stats, projectName } = this.index;

    const lines = [];
    lines.push(`Project: **${projectName}** (${stats.totalFiles} files, ${stats.totalDirs} directories)`);

    if (workspaces.length > 0) {
      lines.push('');
      lines.push(`Workspaces (${workspaces.length}):`);
      for (const ws of workspaces) {
        lines.push(`- \`${ws.path}/\` — ${ws.name} (${ws.files} files, ${ws.dirs} subdirs)`);
      }
    }

    if (keyFiles.length > 0) {
      lines.push('');
      lines.push('Key files:');
      for (const f of keyFiles.slice(0, 30)) {
        lines.push(`- ${f}`);
      }
      if (keyFiles.length > 30) {
        lines.push(`- *(+${keyFiles.length - 30} more)*`);
      }
    }

    return lines.join('\n');
  }

  getStatus() {
    return {
      indexed: !!this.index,
      lastIndexTime: this.lastIndexTime,
      workspaceCount: this.index?.workspaces?.length || 0,
      stats: this.index?.stats || null,
    };
  }
}
