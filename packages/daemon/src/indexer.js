// GROOVE — Codebase Indexer
// FSL-1.1-Apache-2.0 — see LICENSE
//
// Scans the project structure on daemon start to detect monorepo workspaces,
// key files, and directory layout. Agents read this instead of spending
// thousands of tokens exploring the file tree.

import { readdirSync, statSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, relative, basename, join, extname } from 'path';
import { execSync } from 'child_process';

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

  /**
   * Generate a comprehensive init map from the scan results.
   * Writes GROOVE_PROJECT_MAP.md as the baseline that the Journalist
   * maintains from this point forward. Only runs if no map exists yet.
   * Returns true if a new map was generated.
   */
  generateInitMap() {
    const rootDir = this.daemon.projectDir;
    const mapPath = resolve(rootDir, 'GROOVE_PROJECT_MAP.md');

    // Don't overwrite an existing journalist-maintained map
    if (existsSync(mapPath)) return false;
    if (!this.index) return false;

    const { workspaces, keyFiles, stats, projectName, tree } = this.index;
    const lines = [];

    lines.push(`# GROOVE Project Map`);
    lines.push('');
    lines.push(`*Auto-generated by GROOVE init scan. The Journalist maintains this map going forward.*`);
    lines.push('');

    // ── Project overview
    lines.push(`## Project: ${projectName}`);
    lines.push('');
    lines.push(`- **Files:** ${stats.totalFiles}`);
    lines.push(`- **Directories:** ${stats.totalDirs}`);
    lines.push(`- **Scanned:** ${new Date().toISOString()}`);

    // ── Tech stack detection
    const techStack = this._detectTechStack(rootDir);
    if (techStack.length > 0) {
      lines.push('');
      lines.push(`## Tech Stack`);
      lines.push('');
      for (const tech of techStack) {
        lines.push(`- ${tech}`);
      }
    }

    // ── Workspaces
    if (workspaces.length > 0) {
      lines.push('');
      lines.push(`## Workspaces (${workspaces.length})`);
      lines.push('');
      for (const ws of workspaces) {
        lines.push(`- \`${ws.path}/\` — ${ws.name} (${ws.files} files, ${ws.dirs} subdirs)`);
      }
    }

    // ── Directory structure (depth 0-2)
    lines.push('');
    lines.push(`## Structure`);
    lines.push('');
    const shallow = tree.filter((n) => n.depth <= 2 && n.children.length > 0);
    for (const node of shallow) {
      const indent = '  '.repeat(node.depth);
      const name = node.path === '.' ? projectName : node.path.split('/').pop();
      lines.push(`${indent}- \`${name}/\` (${node.files} files)`);
    }

    // ── Key files
    if (keyFiles.length > 0) {
      lines.push('');
      lines.push(`## Key Files`);
      lines.push('');
      for (const f of keyFiles.slice(0, 40)) {
        lines.push(`- ${f}`);
      }
      if (keyFiles.length > 40) {
        lines.push(`- *(+${keyFiles.length - 40} more)*`);
      }
    }

    // ── Entry points
    const entryPoints = this._detectEntryPoints(rootDir);
    if (entryPoints.length > 0) {
      lines.push('');
      lines.push(`## Entry Points`);
      lines.push('');
      for (const ep of entryPoints) {
        lines.push(`- \`${ep}\``);
      }
    }

    // ── Git info
    const gitInfo = this._getGitInfo(rootDir);
    if (gitInfo) {
      lines.push('');
      lines.push(`## Git`);
      lines.push('');
      lines.push(`- **Branch:** ${gitInfo.branch}`);
      if (gitInfo.recentCommits.length > 0) {
        lines.push(`- **Recent commits:**`);
        for (const c of gitInfo.recentCommits) {
          lines.push(`  - ${c}`);
        }
      }
    }

    // ── File type breakdown
    const breakdown = this._fileTypeBreakdown(rootDir);
    if (breakdown.length > 0) {
      lines.push('');
      lines.push(`## File Types`);
      lines.push('');
      for (const { ext, count } of breakdown.slice(0, 15)) {
        lines.push(`- \`${ext}\` — ${count} files`);
      }
    }

    const content = lines.join('\n') + '\n';
    try {
      writeFileSync(mapPath, content);
      return true;
    } catch {
      return false;
    }
  }

  /** Detect tech stack from config files */
  _detectTechStack(rootDir) {
    const stack = [];
    const pkg = this.readJson(resolve(rootDir, 'package.json'));
    if (pkg) {
      if (pkg.dependencies?.react || pkg.devDependencies?.react) stack.push('React');
      if (pkg.dependencies?.next || pkg.devDependencies?.next) stack.push('Next.js');
      if (pkg.dependencies?.vue || pkg.devDependencies?.vue) stack.push('Vue');
      if (pkg.dependencies?.svelte || pkg.devDependencies?.svelte) stack.push('Svelte');
      if (pkg.dependencies?.express || pkg.devDependencies?.express) stack.push('Express');
      if (pkg.dependencies?.fastify || pkg.devDependencies?.fastify) stack.push('Fastify');
      if (pkg.dependencies?.tailwindcss || pkg.devDependencies?.tailwindcss) stack.push('Tailwind CSS');
      if (pkg.dependencies?.typescript || pkg.devDependencies?.typescript) stack.push('TypeScript');
      if (pkg.dependencies?.vite || pkg.devDependencies?.vite) stack.push('Vite');
      if (pkg.dependencies?.prisma || pkg.devDependencies?.prisma) stack.push('Prisma');
      if (pkg.type === 'module') stack.push('ESM');
    }
    if (existsSync(resolve(rootDir, 'Cargo.toml'))) stack.push('Rust');
    if (existsSync(resolve(rootDir, 'go.mod'))) stack.push('Go');
    if (existsSync(resolve(rootDir, 'pyproject.toml'))) stack.push('Python');
    if (existsSync(resolve(rootDir, 'Dockerfile'))) stack.push('Docker');
    return stack;
  }

  /** Detect common entry point files */
  _detectEntryPoints(rootDir) {
    const candidates = [
      'src/index.ts', 'src/index.js', 'src/index.tsx', 'src/index.jsx',
      'src/main.ts', 'src/main.js', 'src/main.tsx', 'src/main.jsx',
      'src/app.ts', 'src/app.js', 'src/app.tsx', 'src/app.jsx',
      'src/App.tsx', 'src/App.jsx',
      'app/layout.tsx', 'app/page.tsx', 'pages/index.tsx', 'pages/index.js',
      'index.ts', 'index.js', 'index.html',
      'server.ts', 'server.js', 'main.go', 'main.rs', 'main.py',
    ];
    return candidates.filter((f) => existsSync(resolve(rootDir, f)));
  }

  /** Get git branch and recent commits */
  _getGitInfo(rootDir) {
    try {
      const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: rootDir, encoding: 'utf8', timeout: 5000 }).trim();
      const log = execSync('git log --oneline -5 2>/dev/null', { cwd: rootDir, encoding: 'utf8', timeout: 5000 }).trim();
      return {
        branch,
        recentCommits: log ? log.split('\n') : [],
      };
    } catch {
      return null;
    }
  }

  /** Count files by extension */
  _fileTypeBreakdown(rootDir) {
    const counts = {};
    const walk = (dir, depth) => {
      if (depth > 3) return;
      try {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const e of entries) {
          if (e.name.startsWith('.')) continue;
          if (e.isDirectory()) {
            if (!IGNORE_DIRS.has(e.name)) walk(resolve(dir, e.name), depth + 1);
          } else if (e.isFile()) {
            const ext = extname(e.name) || '(no ext)';
            counts[ext] = (counts[ext] || 0) + 1;
          }
        }
      } catch { /* */ }
    };
    walk(rootDir, 0);
    return Object.entries(counts)
      .map(([ext, count]) => ({ ext, count }))
      .sort((a, b) => b.count - a.count);
  }
}
