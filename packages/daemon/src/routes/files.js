// FSL-1.1-Apache-2.0 — see LICENSE
import { resolve, sep, isAbsolute, basename } from 'path';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync, unlinkSync, renameSync, rmSync, createReadStream, realpathSync } from 'fs';
import { execFile, execFileSync, spawn } from 'child_process';
import { homedir } from 'os';
import { lookup as mimeLookup } from '../mimetypes.js';

// Editor root directory — always tracks daemon.projectDir unless explicitly
// overridden via POST /api/files/root. Reset on project-dir change.
let editorRootOverride = null;

export function resetEditorRoot() { editorRootOverride = null; }

const LANG_MAP = {
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript',
  css: 'css', scss: 'css', html: 'html', json: 'json',
  md: 'markdown', py: 'python', rs: 'rust', go: 'go',
  sh: 'shell', bash: 'shell', zsh: 'shell',
  yaml: 'yaml', yml: 'yaml', toml: 'toml',
  sql: 'sql', xml: 'xml', java: 'java', c: 'cpp', cpp: 'cpp', h: 'cpp',
  rb: 'ruby', php: 'php', swift: 'swift', kt: 'kotlin',
  dockerfile: 'dockerfile', makefile: 'makefile',
};
function detectLanguage(filename) {
  const ext = filename.split('.').pop()?.toLowerCase();
  return LANG_MAP[ext] || 'text';
}

const IGNORED_NAMES = new Set(['.DS_Store', '__pycache__']);

function getEditorRoot(daemon) { return editorRootOverride || daemon.projectDir; }

function validateFilePath(relPath, projectDir) {
  if (!relPath || typeof relPath !== 'string') return { error: 'path is required' };
  if (relPath.includes('\0')) return { error: 'Invalid path' };

  let fullPath;
  if (relPath.startsWith('/')) {
    if (relPath.includes('..')) return { error: 'Invalid path' };
    if (!relPath.startsWith(projectDir + '/') && relPath !== projectDir) {
      return { error: 'Path outside project' };
    }
    fullPath = relPath;
  } else {
    if (relPath.includes('..')) return { error: 'Invalid path' };
    fullPath = resolve(projectDir, relPath);
    if (!fullPath.startsWith(projectDir)) return { error: 'Path outside project' };
  }

  // Symlink resolution — ensure real path is also within project
  try {
    const realPath = realpathSync(fullPath);
    const realBase = realpathSync(projectDir);
    if (!realPath.startsWith(realBase)) {
      return { error: 'Path outside project (symlink)' };
    }
  } catch {
    // File may not exist yet (for writes) — path prefix check is sufficient
  }
  return { fullPath };
}

function parseDiffOutput(raw) {
  if (!raw) return [];
  const fileDiffs = raw.split(/^diff --git /m).filter(Boolean);
  return fileDiffs.map(chunk => {
    const lines = chunk.split('\n');
    const headerMatch = lines[0]?.match(/a\/(.+?) b\/(.+)/);
    const filePath = headerMatch ? headerMatch[2] : 'unknown';
    let status = 'modified';
    if (lines.some(l => l.startsWith('new file'))) status = 'added';
    else if (lines.some(l => l.startsWith('deleted file'))) status = 'deleted';
    let additions = 0, deletions = 0;
    const hunks = [];
    let currentHunk = null;
    for (const line of lines) {
      if (line.startsWith('@@')) {
        if (currentHunk) hunks.push(currentHunk);
        currentHunk = { header: line, lines: [] };
      } else if (currentHunk) {
        currentHunk.lines.push(line);
        if (line.startsWith('+') && !line.startsWith('+++')) additions++;
        else if (line.startsWith('-') && !line.startsWith('---')) deletions++;
      }
    }
    if (currentHunk) hunks.push(currentHunk);
    return { path: filePath, status, hunks, additions, deletions, content: 'diff --git ' + chunk };
  });
}

export function registerFileRoutes(app, daemon) {

  app.get('/api/browse', (req, res) => {
    const relPath = req.query.path || '';

    // Security: no absolute paths, no traversal
    if (relPath.startsWith('/') || relPath.includes('..') || relPath.includes('\0')) {
      return res.status(400).json({ error: 'Invalid path' });
    }

    const fullPath = relPath ? resolve(daemon.projectDir, relPath) : daemon.projectDir;

    // Must stay within project directory
    if (!fullPath.startsWith(daemon.projectDir)) {
      return res.status(400).json({ error: 'Path outside project' });
    }

    if (!existsSync(fullPath)) {
      return res.status(404).json({ error: 'Directory not found' });
    }

    try {
      const entries = readdirSync(fullPath, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((e) => {
          const childPath = relPath ? `${relPath}/${e.name}` : e.name;
          const childFull = resolve(fullPath, e.name);
          let hasChildren = false;
          let childCount = 0;
          let fileCount = 0;
          try {
            const children = readdirSync(childFull, { withFileTypes: true });
            for (const c of children) {
              if (c.name.startsWith('.') || c.name === 'node_modules') continue;
              if (c.isDirectory()) { childCount++; hasChildren = true; }
              else fileCount++;
            }
          } catch { /* unreadable */ }
          return { name: e.name, path: childPath, hasChildren, childCount, fileCount };
        });

      // Count files in current dir
      let currentFiles = 0;
      try {
        currentFiles = readdirSync(fullPath, { withFileTypes: true })
          .filter((e) => e.isFile() && !e.name.startsWith('.')).length;
      } catch { /* ignore */ }

      res.json({
        current: relPath || '.',
        parent: relPath ? relPath.split('/').slice(0, -1).join('/') : null,
        dirs: entries,
        fileCount: currentFiles,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Browse absolute paths (for directory picker in agent config)
  // Dirs only, localhost-only, no file content exposed
  app.get('/api/browse-system', (req, res) => {
    const absPath = req.query.path || homedir();
    if (absPath.includes('\0')) return res.status(400).json({ error: 'Invalid path' });
    if (!existsSync(absPath)) return res.status(404).json({ error: 'Not found' });

    try {
      const entries = readdirSync(absPath, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((e) => {
          const full = resolve(absPath, e.name);
          let hasChildren = false;
          try {
            hasChildren = readdirSync(full, { withFileTypes: true })
              .some((c) => c.isDirectory() && !c.name.startsWith('.') && c.name !== 'node_modules');
          } catch { /* unreadable */ }
          return { name: e.name, path: full, hasChildren };
        });

      const parent = absPath === '/' ? null : resolve(absPath, '..');
      res.json({ current: absPath, parent, dirs: entries });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- File Editor API ---

  // Get/set the editor working directory
  app.get('/api/files/root', (req, res) => {
    res.json({ root: getEditorRoot(daemon) });
  });

  app.post('/api/files/root', (req, res) => {
    const { root } = req.body || {};
    if (!root || typeof root !== 'string') return res.status(400).json({ error: 'root path is required' });
    if (!root.startsWith('/')) return res.status(400).json({ error: 'root must be an absolute path' });
    if (root.includes('\0') || root.includes('..')) return res.status(400).json({ error: 'Invalid path' });
    if (!existsSync(root)) return res.status(404).json({ error: 'Directory not found' });
    try {
      const stat = statSync(root);
      if (!stat.isDirectory()) return res.status(400).json({ error: 'Path is not a directory' });
    } catch { return res.status(400).json({ error: 'Cannot access directory' }); }
    editorRootOverride = root;
    daemon.audit.log('editor.root.set', { root });
    res.json({ ok: true, root: getEditorRoot(daemon) });
  });

  // File tree — returns dirs + files for a given path
  app.get('/api/files/tree', (req, res) => {
    const relPath = req.query.path || '';

    // Security: reuse browse validation
    if (relPath && (relPath.startsWith('/') || relPath.includes('..') || relPath.includes('\0'))) {
      return res.status(400).json({ error: 'Invalid path' });
    }

    const rootDir = getEditorRoot(daemon);
    const fullPath = relPath ? resolve(rootDir, relPath) : rootDir;
    if (!fullPath.startsWith(rootDir)) {
      return res.status(400).json({ error: 'Path outside project' });
    }
    if (!existsSync(fullPath)) {
      return res.status(404).json({ error: 'Directory not found' });
    }

    try {
      const raw = readdirSync(fullPath, { withFileTypes: true });
      const entries = [];

      const HIDDEN_DIRS = new Set(['.git', 'node_modules', '.groove', '.next', '.nuxt', '__pycache__', '.venv', 'dist', '.cache']);
      const HIDDEN_FILES = new Set(['.DS_Store']);

      const dirs = raw.filter((e) => {
        if (HIDDEN_FILES.has(e.name) || HIDDEN_DIRS.has(e.name)) return false;
        if (e.isDirectory()) return true;
        if (e.isSymbolicLink()) {
          try { return statSync(resolve(fullPath, e.name)).isDirectory(); }
          catch { return true; }
        }
        return false;
      }).sort((a, b) => a.name.localeCompare(b.name));
      const files = raw.filter((e) => {
        if (HIDDEN_FILES.has(e.name)) return false;
        if (e.isFile()) return true;
        if (e.isSymbolicLink()) {
          try { return statSync(resolve(fullPath, e.name)).isFile(); }
          catch { return false; }
        }
        return false;
      }).sort((a, b) => a.name.localeCompare(b.name));

      for (const d of dirs) {
        const childPath = relPath ? `${relPath}/${d.name}` : d.name;
        const childFull = resolve(fullPath, d.name);
        let hasChildren = false;
        try {
          const children = readdirSync(childFull, { withFileTypes: true });
          hasChildren = children.some((c) => c.name !== '.DS_Store');
        } catch { /* unreadable */ }
        entries.push({ name: d.name, type: 'dir', path: childPath, hasChildren });
      }

      for (const f of files) {
        const childPath = relPath ? `${relPath}/${f.name}` : f.name;
        let size = 0;
        try { size = statSync(resolve(fullPath, f.name)).size; } catch { /* ignore */ }
        entries.push({
          name: f.name, type: 'file', path: childPath, size,
          language: detectLanguage(f.name),
        });
      }

      res.json({
        current: relPath || '.',
        parent: relPath ? relPath.split('/').slice(0, -1).join('/') : null,
        entries,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Read file contents
  app.get('/api/files/read', (req, res) => {
    const result = validateFilePath(req.query.path, getEditorRoot(daemon));
    if (result.error) return res.status(400).json({ error: result.error });

    if (!existsSync(result.fullPath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    try {
      const stat = statSync(result.fullPath);
      if (stat.size > 50 * 1024 * 1024) {
        return res.status(400).json({ error: 'File too large (>50MB)' });
      }

      // Binary detection: check first 8KB for null bytes
      const buf = readFileSync(result.fullPath);
      const sample = buf.subarray(0, 8192);
      if (sample.includes(0)) {
        return res.json({ path: req.query.path, binary: true, size: stat.size });
      }

      const content = buf.toString('utf8');
      const filename = req.query.path.split('/').pop();
      res.json({
        path: req.query.path,
        content,
        size: stat.size,
        language: detectLanguage(filename),
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Write file contents
  app.post('/api/files/write', (req, res) => {
    const { path: relPath, content } = req.body;
    const result = validateFilePath(relPath, getEditorRoot(daemon));
    if (result.error) return res.status(400).json({ error: result.error });

    if (typeof content !== 'string') {
      return res.status(400).json({ error: 'content must be a string' });
    }
    if (content.length > 50 * 1024 * 1024) {
      return res.status(400).json({ error: 'Content too large (>50MB)' });
    }

    try {
      writeFileSync(result.fullPath, content, 'utf8');
      daemon.audit.log('file.write', { path: relPath });
      res.json({ ok: true, size: Buffer.byteLength(content, 'utf8') });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Download a file or folder (folders are streamed as zip)
  app.get('/api/files/download', (req, res) => {
    const relPath = req.query.path;
    const result = validateFilePath(relPath, getEditorRoot(daemon));
    if (result.error) return res.status(400).json({ error: result.error });
    if (!existsSync(result.fullPath)) return res.status(404).json({ error: 'Not found' });

    const stat = statSync(result.fullPath);

    if (stat.isDirectory()) {
      const folderName = basename(result.fullPath);
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(folderName)}.zip"`);
      res.setHeader('Content-Type', 'application/zip');

      const zipProc = spawn('zip', [
        '-r', '-q', '-',
        relPath,
        '-x', `${relPath}/.git/*`,
        '-x', `${relPath}/node_modules/*`,
      ], {
        cwd: getEditorRoot(daemon),
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      zipProc.stdout.pipe(res);
      zipProc.stderr.on('data', () => {});
      zipProc.on('error', () => {
        if (!res.headersSent) res.status(500).json({ error: 'Failed to create zip' });
      });
      return;
    }

    const name = basename(result.fullPath);
    const mime = mimeLookup(name) || 'application/octet-stream';
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(name)}"`);
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Length', stat.size);
    createReadStream(result.fullPath).pipe(res);
  });

  // Upload files (base64-encoded) to a target directory
  app.post('/api/files/upload', (req, res) => {
    const { dir = '', files } = req.body;
    const rootDir = getEditorRoot(daemon);
    if (!rootDir) return res.status(400).json({ error: 'Editor root not set' });
    if (!Array.isArray(files) || files.length === 0) return res.status(400).json({ error: 'files[] required' });
    if (files.length > 50) return res.status(400).json({ error: 'Max 50 files per upload' });

    const uploaded = [];
    for (const file of files) {
      if (!file.name || !file.content) continue;
      const safeName = String(file.name).replace(/\.\./g, '').replace(/\//g, '_');
      if (!safeName) continue;
      const relPath = dir ? `${dir}/${safeName}` : safeName;
      const result = validateFilePath(relPath, rootDir);
      if (result.error) continue;

      try {
        const parentDir = resolve(result.fullPath, '..');
        mkdirSync(parentDir, { recursive: true });
        const buf = Buffer.from(file.content, 'base64');
        writeFileSync(result.fullPath, buf);
        daemon.audit.log('file.upload', { path: relPath, size: buf.length });
        uploaded.push({ path: relPath, size: buf.length });
      } catch { /* skip failed files */ }
    }
    res.json({ uploaded, total: uploaded.length });
  });

  // Create a new file
  app.post('/api/files/create', (req, res) => {
    const { path: relPath, content = '' } = req.body;
    const result = validateFilePath(relPath, getEditorRoot(daemon));
    if (result.error) return res.status(400).json({ error: result.error });

    if (existsSync(result.fullPath)) {
      return res.status(409).json({ error: 'File already exists' });
    }

    try {
      // Ensure parent directory exists
      const parentDir = resolve(result.fullPath, '..');
      if (!parentDir.startsWith(daemon.projectDir)) {
        return res.status(400).json({ error: 'Path outside project' });
      }
      mkdirSync(parentDir, { recursive: true });
      writeFileSync(result.fullPath, content, 'utf8');
      daemon.audit.log('file.create', { path: relPath });
      res.status(201).json({ ok: true, path: relPath });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Create a new directory
  app.post('/api/files/mkdir', (req, res) => {
    const { path: relPath } = req.body;
    const result = validateFilePath(relPath, getEditorRoot(daemon));
    if (result.error) return res.status(400).json({ error: result.error });

    if (existsSync(result.fullPath)) {
      return res.status(409).json({ error: 'Directory already exists' });
    }

    try {
      mkdirSync(result.fullPath, { recursive: true });
      daemon.audit.log('file.mkdir', { path: relPath });
      res.status(201).json({ ok: true, path: relPath });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Delete a file or directory
  app.delete('/api/files/delete', (req, res) => {
    const relPath = req.query.path || req.body?.path;
    const result = validateFilePath(relPath, getEditorRoot(daemon));
    if (result.error) return res.status(400).json({ error: result.error });

    if (!existsSync(result.fullPath)) {
      return res.status(404).json({ error: 'Not found' });
    }

    try {
      const stat = statSync(result.fullPath);
      if (stat.isDirectory()) {
        rmSync(result.fullPath, { recursive: true });
      } else {
        unlinkSync(result.fullPath);
      }
      daemon.audit.log('file.delete', { path: relPath });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Rename / move a file or directory
  app.post('/api/files/rename', (req, res) => {
    const { oldPath, newPath } = req.body;
    const oldResult = validateFilePath(oldPath, getEditorRoot(daemon));
    if (oldResult.error) return res.status(400).json({ error: oldResult.error });
    const newResult = validateFilePath(newPath, getEditorRoot(daemon));
    if (newResult.error) return res.status(400).json({ error: newResult.error });

    if (!existsSync(oldResult.fullPath)) {
      return res.status(404).json({ error: 'Source not found' });
    }
    if (existsSync(newResult.fullPath)) {
      return res.status(409).json({ error: 'Destination already exists' });
    }

    try {
      // Ensure parent of new path exists
      const parentDir = resolve(newResult.fullPath, '..');
      mkdirSync(parentDir, { recursive: true });
      renameSync(oldResult.fullPath, newResult.fullPath);
      daemon.audit.log('file.rename', { oldPath, newPath });
      res.json({ ok: true, oldPath, newPath });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Serve raw file (images, video, etc.)
  app.get('/api/files/raw', (req, res) => {
    const result = validateFilePath(req.query.path, getEditorRoot(daemon));
    if (result.error) return res.status(400).json({ error: result.error });

    if (!existsSync(result.fullPath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    try {
      const stat = statSync(result.fullPath);
      if (stat.size > 50 * 1024 * 1024) {
        return res.status(400).json({ error: 'File too large (>50MB)' });
      }
      const filename = req.query.path.split('/').pop();
      const contentType = mimeLookup(filename);
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', stat.size);
      res.setHeader('Cache-Control', 'no-cache');
      createReadStream(result.fullPath).pipe(res);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Git status — returns modified/added/deleted/untracked files
  app.get('/api/files/git-status', (req, res) => {
    const rootDir = getEditorRoot(daemon);
    if (!rootDir) return res.status(400).json({ error: 'Editor root not set' });

    execFile('git', ['status', '--porcelain'], { cwd: rootDir, timeout: 10000 }, (err, stdout) => {
      if (err) {
        // Not a git repo or git not installed — return empty
        return res.json({ entries: [] });
      }
      const STATUS_MAP = { 'M': 'M', 'A': 'A', '?': '?', 'D': 'D', 'R': 'R', 'U': 'U' };
      const entries = [];
      for (const line of stdout.split('\n')) {
        if (!line.trim()) continue;
        const code = line[0] === ' ' ? line[1] : line[0];
        const filePath = line.slice(3).trim();
        if (!filePath) continue;
        entries.push({ path: filePath, status: STATUS_MAP[code] || code });
      }
      res.json({ entries });
    });
  });

  // Git branch — returns the current branch name
  app.get('/api/files/git-branch', (req, res) => {
    const rootDir = getEditorRoot(daemon);
    if (!rootDir) return res.status(400).json({ error: 'Editor root not set' });

    execFile('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: rootDir, timeout: 5000 }, (err, stdout) => {
      if (err) {
        return res.json({ branch: null });
      }
      res.json({ branch: stdout.trim() });
    });
  });

  // Git line status — per-line modification status for editor gutter decorations
  app.get('/api/files/git-line-status', (req, res) => {
    const relPath = req.query.path;
    if (!relPath || typeof relPath !== 'string') {
      return res.status(400).json({ error: 'path parameter is required' });
    }
    if (relPath.includes('\0') || relPath.startsWith('/')) {
      return res.status(400).json({ error: 'Invalid path' });
    }
    const segments = relPath.split(/[/\\]/);
    if (segments.some(s => s === '..')) {
      return res.status(400).json({ error: 'Path traversal not allowed' });
    }

    const rootDir = getEditorRoot(daemon);
    if (!rootDir) return res.status(400).json({ error: 'Editor root not set' });

    const fullPath = resolve(rootDir, relPath);
    if (!fullPath.startsWith(rootDir + sep) && fullPath !== rootDir) {
      return res.status(400).json({ error: 'Path outside project' });
    }

    const result = { lines: { added: [], modified: [], deleted: [] } };

    // Check if file is tracked by git
    try {
      execFileSync('git', ['ls-files', '--error-unmatch', '--', relPath], { cwd: rootDir, timeout: 5000, stdio: 'pipe' });
    } catch {
      // File not tracked — check if it exists (untracked = all lines added)
      if (existsSync(fullPath)) {
        try {
          const content = readFileSync(fullPath, 'utf8');
          const lineCount = content.split('\n').length;
          for (let i = 1; i <= lineCount; i++) result.lines.added.push(i);
        } catch { /* binary or unreadable */ }
      }
      return res.json(result);
    }

    try {
      const diffOut = execFileSync('git', ['diff', '--unified=0', '--', relPath], {
        cwd: rootDir, timeout: 10000, maxBuffer: 5 * 1024 * 1024,
      }).toString();

      if (!diffOut.trim()) return res.json(result);

      // Check for binary
      if (diffOut.includes('Binary files')) return res.json(result);

      // Parse unified diff hunks: @@ -oldStart,oldCount +newStart,newCount @@
      const hunkRe = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm;
      let match;
      while ((match = hunkRe.exec(diffOut)) !== null) {
        const oldCount = parseInt(match[2] ?? '1', 10);
        const newStart = parseInt(match[3], 10);
        const newCount = parseInt(match[4] ?? '1', 10);

        if (oldCount === 0 && newCount > 0) {
          // Pure addition
          for (let i = newStart; i < newStart + newCount; i++) result.lines.added.push(i);
        } else if (newCount === 0 && oldCount > 0) {
          // Pure deletion — mark the line where content was removed
          result.lines.deleted.push(newStart);
        } else {
          // Modification
          for (let i = newStart; i < newStart + newCount; i++) result.lines.modified.push(i);
        }
      }

      res.json(result);
    } catch (err) {
      if (err.status !== undefined) return res.json(result);
      res.status(500).json({ error: 'Failed to compute line status' });
    }
  });

  // Git branches — list all local branches with current branch marked
  app.get('/api/files/git-branches', (req, res) => {
    const rootDir = getEditorRoot(daemon);
    if (!rootDir) return res.status(400).json({ error: 'Editor root not set' });

    const fallback = { current: null, branches: [] };

    try {
      let current = null;
      try {
        current = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
          cwd: rootDir, timeout: 5000, stdio: 'pipe',
        }).toString().trim();
      } catch { return res.json(fallback); }

      const branchOut = execFileSync('git', ['branch', '--list', '--format=%(refname:short)'], {
        cwd: rootDir, timeout: 5000, stdio: 'pipe',
      }).toString();

      const branches = branchOut.split('\n').map(b => b.trim()).filter(Boolean);
      res.json({ current, branches });
    } catch {
      res.json(fallback);
    }
  });

  // Files touched by an agent during its session
  app.get('/api/agents/:id/files-touched', (req, res) => {
    const agent = daemon.registry.get(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    const rawFiles = daemon.registry.getFilesTouched(req.params.id);
    const rootDir = agent.workingDir || daemon.projectDir;

    // Build git diff numstat for line-level +/- counts (unstaged + staged + untracked)
    let numstatMap = {};
    const writtenPaths = rawFiles.filter(f => f.writes > 0).map(f => f.path);
    if (writtenPaths.length > 0) {
      const parseNumstat = (out) => {
        for (const line of out.split('\n')) {
          const m = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
          if (m && !numstatMap[m[3]]) {
            numstatMap[m[3]] = {
              additions: m[1] === '-' ? 0 : Number(m[1]),
              deletions: m[2] === '-' ? 0 : Number(m[2]),
            };
          }
        }
      };
      try {
        const unstaged = execFileSync('git', ['diff', '--numstat', '--', ...writtenPaths], {
          cwd: rootDir, timeout: 10000, maxBuffer: 2 * 1024 * 1024,
        }).toString();
        parseNumstat(unstaged);
      } catch { /* git not available or not a repo */ }
      try {
        const staged = execFileSync('git', ['diff', '--cached', '--numstat', '--', ...writtenPaths], {
          cwd: rootDir, timeout: 10000, maxBuffer: 2 * 1024 * 1024,
        }).toString();
        parseNumstat(staged);
      } catch { /* ignore */ }
      // For untracked files not covered by diff, count lines as all additions
      for (const p of writtenPaths) {
        if (numstatMap[p]) continue;
        const full = isAbsolute(p) ? p : resolve(rootDir, p);
        try {
          const stat = statSync(full);
          if (stat.isFile()) {
            const content = readFileSync(full, 'utf8');
            const lineCount = content.split('\n').length;
            numstatMap[p] = { additions: lineCount, deletions: 0 };
          }
        } catch { /* file may not exist */ }
      }
    }

    const files = rawFiles.map(f => {
      const fullPath = isAbsolute(f.path) ? f.path : resolve(rootDir, f.path);
      const stats = numstatMap[f.path] || null;
      return { ...f, exists: existsSync(fullPath), additions: stats?.additions ?? null, deletions: stats?.deletions ?? null };
    });
    res.json({ files, total: files.length });
  });

  // Git diff — structured diff for a file, an agent's touched files, or all uncommitted changes
  app.get('/api/files/git-diff', (req, res) => {
    const rootDir = getEditorRoot(daemon);
    if (!rootDir) return res.status(400).json({ error: 'Editor root not set' });

    let paths = [];

    if (req.query.path) {
      const result = validateFilePath(req.query.path, rootDir);
      if (result.error) return res.status(400).json({ error: result.error });
      paths = [req.query.path];
    } else if (req.query.agentId) {
      const agent = daemon.registry.get(req.query.agentId);
      if (!agent) return res.status(404).json({ error: 'Agent not found' });
      paths = daemon.registry.getFilesTouched(req.query.agentId).map(f => f.path);
      if (paths.length === 0) return res.json({ diffs: [] });
      // Validate each path
      for (const p of paths) {
        if (p.startsWith('/') || p.includes('..') || p.includes('\0')) {
          return res.status(400).json({ error: 'Invalid path in agent files' });
        }
      }
    }

    const args = ['diff'];
    const cachedArgs = ['diff', '--cached'];
    if (paths.length > 0) {
      args.push('--', ...paths);
      cachedArgs.push('--', ...paths);
    }

    try {
      const unstaged = execFileSync('git', args, { cwd: rootDir, timeout: 15000, maxBuffer: 10 * 1024 * 1024 }).toString();
      const staged = execFileSync('git', cachedArgs, { cwd: rootDir, timeout: 15000, maxBuffer: 10 * 1024 * 1024 }).toString();
      const combined = (staged + '\n' + unstaged).trim();
      const diffs = parseDiffOutput(combined);
      res.json({ diffs });
    } catch (err) {
      if (err.status !== undefined) {
        return res.json({ diffs: [] });
      }
      res.status(500).json({ error: 'Failed to compute diff' });
    }
  });

  // Git checkout — revert a file to its HEAD version
  app.post('/api/files/revert', (req, res) => {
    const rootDir = getEditorRoot(daemon);
    if (!rootDir) return res.status(400).json({ error: 'Editor root not set' });
    const filePath = req.body?.path;
    if (!filePath || typeof filePath !== 'string') return res.status(400).json({ error: 'path is required' });
    const result = validateFilePath(filePath, rootDir);
    if (result.error) return res.status(400).json({ error: result.error });

    try {
      execFileSync('git', ['checkout', 'HEAD', '--', filePath], { cwd: rootDir, timeout: 10000 });
      res.json({ ok: true, path: filePath });
    } catch (err) {
      res.status(500).json({ error: 'Failed to revert file', detail: err.message });
    }
  });

  // Git show — retrieve original file content from HEAD
  app.get('/api/files/git-show', (req, res) => {
    const rootDir = getEditorRoot(daemon);
    if (!rootDir) return res.status(400).json({ error: 'Editor root not set' });
    const result = validateFilePath(req.query.path, rootDir);
    if (result.error) return res.status(400).json({ error: result.error });

    try {
      const content = execFileSync('git', ['show', `HEAD:${req.query.path}`], {
        cwd: rootDir, timeout: 10000, maxBuffer: 10 * 1024 * 1024,
      }).toString();
      res.json({ path: req.query.path, content });
    } catch {
      res.json({ path: req.query.path, content: null });
    }
  });

  // File search — fuzzy filename matching for quick-open (Ctrl+P)
  app.get('/api/files/search', (req, res) => {
    const query = req.query.q;
    if (!query || typeof query !== 'string') return res.status(400).json({ error: 'q parameter is required' });
    if (query.length > 200) return res.status(400).json({ error: 'Query too long' });

    const maxResults = Math.min(parseInt(req.query.maxResults, 10) || 50, 200);
    const rootDir = getEditorRoot(daemon);
    if (!rootDir) return res.status(400).json({ error: 'Editor root not set' });

    const lowerQuery = query.toLowerCase();
    const results = [];

    function fuzzyMatch(name) {
      const lower = name.toLowerCase();
      let qi = 0;
      for (let i = 0; i < lower.length && qi < lowerQuery.length; i++) {
        if (lower[i] === lowerQuery[qi]) qi++;
      }
      return qi === lowerQuery.length;
    }

    function walk(dir, rel) {
      if (results.length >= maxResults) return;
      let entries;
      try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (results.length >= maxResults) return;
        if (IGNORED_NAMES.has(entry.name) || entry.name.startsWith('.')) continue;
        const childRel = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          walk(resolve(dir, entry.name), childRel);
        } else if (entry.isFile() && fuzzyMatch(entry.name)) {
          results.push({ path: childRel, name: entry.name });
        }
      }
    }

    try {
      walk(rootDir, '');
      res.json({ files: results });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Codebase Indexer ---

  app.get('/api/indexer', (req, res) => {
    res.json(daemon.indexer.getStatus());
  });

  app.get('/api/indexer/workspaces', (req, res) => {
    res.json({
      workspaces: daemon.indexer.getWorkspaces(),
    });
  });

  app.post('/api/indexer/rescan', (req, res) => {
    try {
      daemon.indexer.scan();
      res.json({ ok: true, ...daemon.indexer.getStatus() });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

}
