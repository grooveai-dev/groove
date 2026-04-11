// GROOVE — Tool Executor for Local Agent Loop
// FSL-1.1-Apache-2.0 — see LICENSE

import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { resolve, relative, dirname, sep } from 'path';
import { minimatch } from 'minimatch';

// Tool definitions in OpenAI function-calling format
// These mirror what Claude Code provides — same agentic experience regardless of model
export const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the contents of a file. Returns file content with line numbers. Use offset/limit for large files.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to working directory' },
          offset: { type: 'integer', description: 'Start line (1-based, optional)' },
          limit: { type: 'integer', description: 'Max lines to read (optional)' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write content to a file, creating it and parent directories if they do not exist. Overwrites existing content.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path to write to' },
          content: { type: 'string', description: 'Full file content to write' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description: 'Replace a specific string in a file with a new string. The old_string must appear exactly once in the file.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path to edit' },
          old_string: { type: 'string', description: 'Exact string to find (must be unique in file)' },
          new_string: { type: 'string', description: 'Replacement string' },
        },
        required: ['path', 'old_string', 'new_string'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: 'Execute a shell command and return stdout/stderr. Use for running tests, builds, git, npm, etc.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to execute' },
          cwd: { type: 'string', description: 'Working directory (optional, defaults to agent working dir)' },
          timeout: { type: 'integer', description: 'Timeout in milliseconds (optional, default 30000, max 120000)' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_files',
      description: 'Search for files matching a glob pattern (e.g. "src/**/*.ts", "*.json"). Returns matching file paths.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Glob pattern to match files against' },
          cwd: { type: 'string', description: 'Directory to search in (optional)' },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_content',
      description: 'Search file contents for a regex pattern (like grep). Returns matching lines with file path and line number.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Regex pattern to search for' },
          path: { type: 'string', description: 'Directory or file to search in (optional)' },
          glob: { type: 'string', description: 'File glob filter, e.g. "*.js" (optional)' },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_directory',
      description: 'List files and directories at a given path. Shows type (file/dir) and file sizes.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path to list (optional, defaults to working directory)' },
        },
        required: [],
      },
    },
  },
];

export class ToolExecutor {
  constructor(workingDir, daemon, agentId) {
    this.workingDir = resolve(workingDir);
    this.daemon = daemon;
    this.agentId = agentId;
  }

  async execute(name, args) {
    try {
      switch (name) {
        case 'read_file': return this.readFile(args);
        case 'write_file': return this.writeFile(args);
        case 'edit_file': return this.editFile(args);
        case 'run_command': return this.runCommand(args);
        case 'search_files': return this.searchFiles(args);
        case 'search_content': return this.searchContent(args);
        case 'list_directory': return this.listDirectory(args);
        default: return { success: false, error: `Unknown tool: ${name}` };
      }
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // --- Path Security ---

  _resolvePath(filePath) {
    if (!filePath) throw new Error('Path is required');
    const resolved = resolve(this.workingDir, filePath);
    // Block path traversal — resolved path must be within working directory
    if (!resolved.startsWith(this.workingDir + sep) && resolved !== this.workingDir) {
      throw new Error(`Access denied: path outside working directory`);
    }
    return resolved;
  }

  _checkWriteScope(resolvedPath) {
    if (!this.daemon?.locks) return;
    const rel = relative(this.workingDir, resolvedPath);
    const result = this.daemon.locks.check(this.agentId, rel);
    if (result.conflict) {
      // Record conflict for supervisor + token savings
      if (this.daemon.supervisor) {
        this.daemon.supervisor.recordConflict(this.agentId, rel, result.owner);
      }
      throw new Error(`Scope conflict: ${rel} is owned by agent ${result.owner} (pattern: ${result.pattern})`);
    }
  }

  // --- Tool Implementations ---

  readFile({ path: filePath, offset, limit }) {
    const resolved = this._resolvePath(filePath);
    if (!existsSync(resolved)) {
      return { success: false, error: `File not found: ${filePath}` };
    }

    const stat = statSync(resolved);
    if (stat.isDirectory()) {
      return { success: false, error: `Path is a directory, not a file: ${filePath}` };
    }
    // Guard against huge files
    if (stat.size > 5 * 1024 * 1024) {
      return { success: false, error: `File too large (${formatBytes(stat.size)}). Use offset/limit to read a section.` };
    }

    const content = readFileSync(resolved, 'utf8');
    let lines = content.split('\n');
    const totalLines = lines.length;

    const startLine = (offset && offset > 0) ? offset : 1;
    if (offset && offset > 0) {
      lines = lines.slice(offset - 1);
    }
    if (limit && limit > 0) {
      lines = lines.slice(0, limit);
    }

    const numbered = lines.map((line, i) => `${startLine + i}\t${line}`).join('\n');
    return { success: true, result: numbered, meta: { totalLines } };
  }

  writeFile({ path: filePath, content }) {
    const resolved = this._resolvePath(filePath);
    this._checkWriteScope(resolved);

    mkdirSync(dirname(resolved), { recursive: true });
    writeFileSync(resolved, content);

    const lineCount = content.split('\n').length;
    return { success: true, result: `Wrote ${lineCount} lines to ${filePath}` };
  }

  editFile({ path: filePath, old_string, new_string }) {
    const resolved = this._resolvePath(filePath);
    this._checkWriteScope(resolved);

    if (!existsSync(resolved)) {
      return { success: false, error: `File not found: ${filePath}` };
    }

    const content = readFileSync(resolved, 'utf8');
    const occurrences = content.split(old_string).length - 1;

    if (occurrences === 0) {
      return { success: false, error: `String not found in ${filePath}. Check for exact whitespace and formatting.` };
    }
    if (occurrences > 1) {
      return { success: false, error: `Found ${occurrences} matches in ${filePath} — old_string must be unique. Include more surrounding context.` };
    }

    const newContent = content.replace(old_string, new_string);
    writeFileSync(resolved, newContent);
    return { success: true, result: `Edited ${filePath}` };
  }

  runCommand({ command, cwd, timeout }) {
    if (!command) return { success: false, error: 'Command is required' };

    const execCwd = cwd ? this._resolvePath(cwd) : this.workingDir;
    const timeoutMs = Math.min(timeout || 30000, 120000);

    try {
      const output = execSync(command, {
        cwd: execCwd,
        encoding: 'utf8',
        timeout: timeoutMs,
        maxBuffer: 2 * 1024 * 1024, // 2MB
        shell: true,
        env: { ...process.env, GROOVE_AGENT_ID: this.agentId },
      });
      // Cap output to prevent context window blowup
      const result = output.length > 50000 ? output.slice(0, 50000) + '\n... (output truncated)' : output;
      return { success: true, result };
    } catch (err) {
      const stderr = (err.stderr || '').toString().slice(0, 5000);
      const stdout = (err.stdout || '').toString().slice(0, 5000);
      const output = stderr || stdout || err.message;
      return { success: false, error: `Exit code ${err.status || 1}: ${output}` };
    }
  }

  searchFiles({ pattern, cwd }) {
    const searchDir = cwd ? this._resolvePath(cwd) : this.workingDir;
    const results = [];

    const walk = (dir, depth) => {
      if (depth > 12 || results.length >= 500) return;
      let entries;
      try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }

      for (const entry of entries) {
        // Skip hidden dirs, node_modules, .git, build artifacts
        if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === '__pycache__') {
          if (entry.isDirectory()) continue;
        }
        const fullPath = resolve(dir, entry.name);
        const rel = relative(searchDir, fullPath);

        if (entry.isDirectory()) {
          walk(fullPath, depth + 1);
        } else if (minimatch(rel, pattern, { dot: false })) {
          results.push(rel);
        }
      }
    };

    walk(searchDir, 0);
    results.sort();
    return { success: true, result: results.length > 0 ? results.join('\n') : 'No files matched the pattern.' };
  }

  searchContent({ pattern, path: searchPath, glob: globFilter }) {
    const searchDir = searchPath ? this._resolvePath(searchPath) : this.workingDir;

    // Prefer ripgrep (faster, respects .gitignore), fall back to grep
    const escapedPattern = pattern.replace(/'/g, "'\\''");
    const commands = [];

    // Try rg first
    let rgCmd = `rg -n --max-count=200 --max-filesize=1M '${escapedPattern}'`;
    if (globFilter) rgCmd += ` -g '${globFilter}'`;
    rgCmd += ` '${searchDir}'`;
    commands.push(rgCmd);

    // Fallback: grep
    let grepCmd = `grep -rn --include='${globFilter || '*'}' -E '${escapedPattern}' '${searchDir}' | head -200`;
    commands.push(grepCmd);

    for (const cmd of commands) {
      try {
        const output = execSync(cmd, { encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 });
        if (output.trim()) {
          // Make paths relative to searchDir
          const lines = output.split('\n').map((line) => {
            if (line.startsWith(searchDir)) {
              return line.slice(searchDir.length + 1);
            }
            return line;
          }).join('\n');
          const result = lines.length > 30000 ? lines.slice(0, 30000) + '\n... (truncated)' : lines;
          return { success: true, result };
        }
      } catch (err) {
        // grep returns exit code 1 for no matches — that's fine
        if (err.status === 1) {
          return { success: true, result: 'No matches found.' };
        }
        // Try next command
        continue;
      }
    }

    return { success: true, result: 'No matches found.' };
  }

  listDirectory({ path: dirPath } = {}) {
    const resolved = dirPath ? this._resolvePath(dirPath) : this.workingDir;

    if (!existsSync(resolved)) {
      return { success: false, error: `Directory not found: ${dirPath || '.'}` };
    }

    let entries;
    try { entries = readdirSync(resolved, { withFileTypes: true }); } catch (err) {
      return { success: false, error: `Cannot read directory: ${err.message}` };
    }

    const lines = entries.map((entry) => {
      const type = entry.isDirectory() ? 'dir ' : entry.isSymbolicLink() ? 'link' : 'file';
      let size = '';
      if (!entry.isDirectory()) {
        try { size = `  ${formatBytes(statSync(resolve(resolved, entry.name)).size)}`; } catch { /* */ }
      }
      return `[${type}] ${entry.name}${size}`;
    });

    return { success: true, result: lines.length > 0 ? lines.join('\n') : '(empty directory)' };
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
