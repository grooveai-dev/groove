// GROOVE — Repo Import (GitHub Clone + Sandbox Isolation)
// FSL-1.1-Apache-2.0 — see LICENSE

import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync, copyFileSync } from 'fs';
import { resolve, basename, dirname, isAbsolute } from 'path';
import { execFileSync } from 'child_process';
import { randomUUID } from 'crypto';
import { homedir } from 'os';

const GITHUB_URL_RE = /^https?:\/\/github\.com\/([^/]+)\/([^/.]+?)(?:\.git)?(?:\/.*)?$/;

function parseGitHubUrl(url) {
  const m = url.match(GITHUB_URL_RE);
  if (!m) throw new Error('Invalid GitHub URL. Expected: https://github.com/owner/repo');
  return { owner: m[1], repo: m[2] };
}

export class RepoImporter {
  constructor(daemon) {
    this.daemon = daemon;
    this.imports = new Map();
    this.importsDir = resolve(daemon.grooveDir, 'imports');
    mkdirSync(this.importsDir, { recursive: true });
    this._loadExisting();
  }

  _loadExisting() {
    try {
      const files = readdirSync(this.importsDir).filter(f => f.endsWith('.json'));
      for (const f of files) {
        try {
          const data = JSON.parse(readFileSync(resolve(this.importsDir, f), 'utf8'));
          if (data.id) this.imports.set(data.id, data);
        } catch { /* skip corrupt manifests */ }
      }
    } catch { /* dir may not exist yet */ }
  }

  _saveManifest(manifest) {
    writeFileSync(
      resolve(this.importsDir, `${manifest.id}.json`),
      JSON.stringify(manifest, null, 2)
    );
    this.imports.set(manifest.id, manifest);
  }

  // --- Preview (no clone, no disk writes) ---

  async preview(repoUrl) {
    const { owner, repo } = parseGitHubUrl(repoUrl);

    let repoData;
    let treeData;

    // Try GitHub MCP integration first, fall back to fetch
    const mcp = this.daemon.mcpManager;
    const hasMcp = mcp && typeof mcp.execTool === 'function';

    if (hasMcp) {
      try {
        repoData = await mcp.execTool('github', 'get_repository', { owner, repo });
      } catch { /* fall through to fetch */ }
    }

    if (!repoData) {
      const headers = { 'User-Agent': 'groove-dev', Accept: 'application/vnd.github+json' };
      const pat = this._getPat();
      if (pat) headers.Authorization = `Bearer ${pat}`;

      const resp = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers });
      if (!resp.ok) throw new Error(`GitHub API error: ${resp.status} ${resp.statusText}`);
      repoData = await resp.json();
    }

    // Fetch top-level tree for file detection
    const detectedFiles = [];
    try {
      const headers = { 'User-Agent': 'groove-dev', Accept: 'application/vnd.github+json' };
      const pat = this._getPat();
      if (pat) headers.Authorization = `Bearer ${pat}`;

      const branch = repoData.default_branch || 'main';
      const treeResp = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=0`,
        { headers }
      );
      if (treeResp.ok) {
        treeData = await treeResp.json();
        if (treeData.tree) {
          for (const entry of treeData.tree) {
            detectedFiles.push(entry.path);
          }
        }
      }
    } catch { /* tree fetch is optional */ }

    // Fetch README preview
    let readmePreview = '';
    try {
      const headers = { 'User-Agent': 'groove-dev', Accept: 'application/vnd.github.raw' };
      const pat = this._getPat();
      if (pat) headers.Authorization = `Bearer ${pat}`;

      const readmeResp = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/readme`,
        { headers: { ...headers, Accept: 'application/vnd.github+json' } }
      );
      if (readmeResp.ok) {
        const readmeJson = await readmeResp.json();
        if (readmeJson.content) {
          const decoded = Buffer.from(readmeJson.content, 'base64').toString('utf8');
          readmePreview = decoded.slice(0, 800);
        }
      }
    } catch { /* readme is optional */ }

    const stackHints = this._stackHintsFromFiles(detectedFiles);

    return {
      owner,
      repo,
      name: repoData.name || repo,
      description: repoData.description || '',
      language: repoData.language || null,
      stars: repoData.stargazers_count ?? 0,
      license: repoData.license?.spdx_id || repoData.license?.name || null,
      defaultBranch: repoData.default_branch || 'main',
      detectedFiles,
      readmePreview,
      stackHints,
    };
  }

  _stackHintsFromFiles(files) {
    const has = (f) => files.includes(f);
    const hints = {};
    if (has('bun.lockb')) { hints.runtime = 'bun'; hints.packageManager = 'bun'; }
    else if (has('pnpm-lock.yaml')) { hints.runtime = 'node'; hints.packageManager = 'pnpm'; }
    else if (has('yarn.lock')) { hints.runtime = 'node'; hints.packageManager = 'yarn'; }
    else if (has('package-lock.json')) { hints.runtime = 'node'; hints.packageManager = 'npm'; }
    else if (has('package.json')) { hints.runtime = 'node'; hints.packageManager = 'npm'; }
    if (has('requirements.txt') || has('pyproject.toml')) hints.runtime = hints.runtime || 'python';
    if (has('go.mod')) hints.runtime = hints.runtime || 'go';
    if (has('Cargo.toml')) hints.runtime = hints.runtime || 'rust';
    if (has('Gemfile')) hints.runtime = hints.runtime || 'ruby';
    if (has('composer.json')) hints.runtime = hints.runtime || 'php';
    if (has('tsconfig.json')) hints.language = 'typescript';
    if (has('docker-compose.yml')) hints.hasDocker = true;
    if (has('.env.example')) hints.hasEnvExample = true;
    return hints;
  }

  // --- Stack Detection (on cloned repo) ---

  detectStack(repoPath) {
    const has = (f) => existsSync(resolve(repoPath, f));
    const read = (f) => {
      try { return readFileSync(resolve(repoPath, f), 'utf8'); } catch { return null; }
    };

    let runtime = null;
    let language = null;
    let packageManager = null;
    let installCommand = null;
    let buildCommand = null;
    let testCommand = null;

    if (has('bun.lockb')) {
      runtime = 'bun'; packageManager = 'bun';
      installCommand = 'bun install'; buildCommand = 'bun run build'; testCommand = 'bun test';
    } else if (has('pnpm-lock.yaml')) {
      runtime = 'node'; packageManager = 'pnpm';
      installCommand = 'pnpm install'; buildCommand = 'pnpm build'; testCommand = 'pnpm test';
    } else if (has('yarn.lock')) {
      runtime = 'node'; packageManager = 'yarn';
      installCommand = 'yarn install'; buildCommand = 'yarn build'; testCommand = 'yarn test';
    } else if (has('package-lock.json') || has('package.json')) {
      runtime = 'node'; packageManager = 'npm';
      installCommand = 'npm install'; buildCommand = 'npm run build'; testCommand = 'npm test';
    } else if (has('requirements.txt')) {
      runtime = 'python'; language = 'python';
      installCommand = 'pip install -r requirements.txt';
    } else if (has('pyproject.toml')) {
      runtime = 'python'; language = 'python';
      const content = read('pyproject.toml') || '';
      if (content.includes('[tool.poetry]')) {
        packageManager = 'poetry'; installCommand = 'poetry install';
      } else {
        packageManager = 'uv'; installCommand = 'uv sync';
      }
    } else if (has('go.mod')) {
      runtime = 'go'; language = 'go';
      installCommand = 'go mod download'; buildCommand = 'go build ./...'; testCommand = 'go test ./...';
    } else if (has('Cargo.toml')) {
      runtime = 'rust'; language = 'rust';
      installCommand = 'cargo build'; buildCommand = 'cargo build --release'; testCommand = 'cargo test';
    } else if (has('Gemfile')) {
      runtime = 'ruby'; language = 'ruby';
      installCommand = 'bundle install';
    } else if (has('composer.json')) {
      runtime = 'php'; language = 'php';
      installCommand = 'composer install';
    }

    if (has('tsconfig.json')) language = 'typescript';
    if (!language && has('package.json')) {
      const pkg = read('package.json');
      if (pkg) {
        try {
          const parsed = JSON.parse(pkg);
          if (parsed.dependencies?.typescript || parsed.devDependencies?.typescript) language = 'typescript';
        } catch { /* skip */ }
      }
    }
    if (!language && runtime === 'node') language = 'javascript';

    const hasDocker = has('docker-compose.yml');
    const hasEnvExample = has('.env.example');

    let envVars = [];
    if (hasEnvExample) {
      envVars = this._parseEnvExample(read('.env.example') || '');
    }

    return {
      runtime,
      language,
      packageManager,
      hasDocker,
      hasEnvExample,
      envVars,
      installCommand,
      buildCommand,
      testCommand,
    };
  }

  _parseEnvExample(content) {
    const vars = [];
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx < 1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const rest = trimmed.slice(eqIdx + 1).trim();
      let hint = '';
      const commentIdx = rest.indexOf('#');
      if (commentIdx !== -1) hint = rest.slice(commentIdx + 1).trim();
      vars.push({ key, hint });
    }
    return vars;
  }

  // --- Import (clone + sandbox) ---

  async import(repoUrl, targetPath, options = {}) {
    // Resolve ~ and relative paths
    if (targetPath.startsWith('~/') || targetPath === '~') {
      targetPath = resolve(homedir(), targetPath.slice(2));
    } else if (!isAbsolute(targetPath)) {
      targetPath = resolve(this.daemon.projectDir, targetPath);
    }
    if (targetPath.includes('..')) throw new Error('Path traversal not allowed');
    const parentDir = dirname(targetPath);
    if (!existsSync(parentDir)) throw new Error(`Parent directory does not exist: ${parentDir}`);
    if (existsSync(targetPath)) throw new Error(`Target path already exists: ${targetPath}`);

    // Check for duplicate import
    for (const manifest of this.imports.values()) {
      if (manifest.repoUrl === repoUrl && manifest.status === 'active') {
        throw new Error(`Already imported from ${repoUrl} at ${manifest.clonedTo}`);
      }
    }

    const { owner, repo } = parseGitHubUrl(repoUrl);
    const importId = randomUUID().slice(0, 12);

    // Clone
    const cloneArgs = ['clone', '--depth', '1', repoUrl, targetPath];
    const pat = this._getPat();
    let cloneUrl = repoUrl;
    if (pat && repoUrl.startsWith('https://github.com/')) {
      cloneUrl = repoUrl.replace('https://github.com/', `https://${pat}@github.com/`);
      cloneArgs[3] = cloneUrl;
    }
    execFileSync('git', cloneArgs, { stdio: 'pipe', timeout: 120_000 });

    // Create sandbox
    this.createSandbox(importId, repoUrl, targetPath);

    // Take snapshot
    this.takeSnapshot(targetPath);

    // Detect stack
    const stackInfo = this.detectStack(targetPath);

    // Save manifest
    const manifest = this.imports.get(importId);
    manifest.owner = owner;
    manifest.repo = repo;
    manifest.name = repo;
    manifest.stackInfo = stackInfo;
    this._saveManifest(manifest);

    this.daemon.audit?.log('repo.import', { importId, repoUrl, targetPath });

    return { importId, path: targetPath, stackInfo };
  }

  createSandbox(importId, repoUrl, targetPath) {
    const grooveDir = resolve(targetPath, '.groove');
    mkdirSync(grooveDir, { recursive: true });

    const manifest = {
      id: importId,
      repoUrl,
      clonedTo: targetPath,
      clonedAt: new Date().toISOString(),
      status: 'active',
      teamId: null,
      agents: [],
      processes: [],
      configsModified: [],
      globalInstalls: [],
      dockerContainers: [],
      credentialKeys: [],
    };

    writeFileSync(resolve(grooveDir, 'sandbox.json'), JSON.stringify(manifest, null, 2));
    this._saveManifest(manifest);
  }

  takeSnapshot(targetPath) {
    const snapshotDir = resolve(targetPath, '.groove', 'snapshot');
    mkdirSync(snapshotDir, { recursive: true });

    const projectDir = this.daemon.projectDir;
    const filesToSnapshot = ['package.json', '.mcp.json', 'CLAUDE.md'];
    for (const f of filesToSnapshot) {
      const src = resolve(projectDir, f);
      if (existsSync(src)) {
        copyFileSync(src, resolve(snapshotDir, f));
      }
    }
  }

  recordProcess(importId, pid, command) {
    const manifest = this.imports.get(importId);
    if (!manifest) throw new Error(`Import not found: ${importId}`);
    manifest.processes.push({ pid, command, startedAt: new Date().toISOString() });
    this._saveManifest(manifest);
  }

  recordConfigChange(importId, filePath, originalContent) {
    const manifest = this.imports.get(importId);
    if (!manifest) throw new Error(`Import not found: ${importId}`);

    const snapshotDir = resolve(manifest.clonedTo, '.groove', 'snapshot');
    mkdirSync(snapshotDir, { recursive: true });
    const safeName = basename(filePath).replace(/[^a-zA-Z0-9._-]/g, '_');
    writeFileSync(resolve(snapshotDir, `config-${safeName}`), originalContent);

    manifest.configsModified.push(filePath);
    this._saveManifest(manifest);
  }

  // --- Removal ---

  async softRemove(importId) {
    const manifest = this.imports.get(importId);
    if (!manifest) throw new Error(`Import not found: ${importId}`);

    // Kill agents listed in manifest
    for (const agentId of manifest.agents) {
      try { await this.daemon.processes.kill(agentId); } catch { /* already dead */ }
    }

    // Kill tracked processes
    for (const proc of manifest.processes) {
      try { process.kill(proc.pid, 'SIGTERM'); } catch { /* already dead */ }
    }

    // Remove credential keys
    if (this.daemon.credentials) {
      for (const key of manifest.credentialKeys) {
        try { this.daemon.credentials.deleteKey(key); } catch { /* ignore */ }
      }
    }

    // Delete team
    if (manifest.teamId) {
      try { this.daemon.teams.delete(manifest.teamId); } catch { /* ignore */ }
    }

    // Remove .groove dir inside repo (if repo still exists)
    const repoGrooveDir = resolve(manifest.clonedTo, '.groove');
    if (existsSync(repoGrooveDir)) {
      rmSync(repoGrooveDir, { recursive: true, force: true });
    }

    manifest.status = 'removed';
    this._saveManifest(manifest);

    this.daemon.audit?.log('repo.softRemove', { importId, clonedTo: manifest.clonedTo });
  }

  async hardNuke(importId, { deleteFiles = true } = {}) {
    const manifest = this.imports.get(importId);
    if (!manifest) throw new Error(`Import not found: ${importId}`);

    // Revert config modifications from snapshot BEFORE softRemove deletes .groove/
    const snapshotDir = resolve(manifest.clonedTo, '.groove', 'snapshot');
    for (const filePath of manifest.configsModified) {
      const safeName = basename(filePath).replace(/[^a-zA-Z0-9._-]/g, '_');
      const snapshotPath = resolve(snapshotDir, `config-${safeName}`);
      if (existsSync(snapshotPath)) {
        try {
          const original = readFileSync(snapshotPath, 'utf8');
          writeFileSync(filePath, original);
        } catch { /* best effort */ }
      }
    }

    // Soft remove (kills agents, processes, credentials, team, removes .groove/)
    if (manifest.status !== 'removed') {
      await this.softRemove(importId);
    }

    if (!deleteFiles) {
      this.daemon.audit?.log('repo.hardNuke', { importId, clonedTo: manifest.clonedTo, deleteFiles: false });
      return;
    }

    // Rogue process scan
    if (existsSync(manifest.clonedTo)) {
      try {
        const lsofOutput = execFileSync('lsof', ['+D', manifest.clonedTo], {
          stdio: 'pipe', timeout: 10_000,
        }).toString();
        const pids = new Set();
        for (const line of lsofOutput.split('\n').slice(1)) {
          const parts = line.trim().split(/\s+/);
          if (parts[1]) pids.add(parseInt(parts[1], 10));
        }
        for (const pid of pids) {
          if (pid && !isNaN(pid)) {
            try { process.kill(pid, 'SIGTERM'); } catch { /* ignore */ }
          }
        }
      } catch { /* lsof may not find anything — that's fine */ }
    }

    // Delete repo directory
    if (existsSync(manifest.clonedTo)) {
      rmSync(manifest.clonedTo, { recursive: true, force: true });
    }

    // Remove import record
    const recordPath = resolve(this.importsDir, `${importId}.json`);
    if (existsSync(recordPath)) {
      rmSync(recordPath);
    }
    this.imports.delete(importId);

    this.daemon.audit?.log('repo.hardNuke', { importId, clonedTo: manifest.clonedTo });
  }

  // --- Queries ---

  getImported() {
    return Array.from(this.imports.values());
  }

  getImport(importId) {
    return this.imports.get(importId) || null;
  }

  // --- Setup Agent Prompt ---

  generateSetupPrompt(repoPath, stackInfo, readmeContent) {
    const lines = [
      `You are setting up an imported repository at: ${repoPath}`,
      '',
      `## Detected Stack`,
      `- Runtime: ${stackInfo.runtime || 'unknown'}`,
      `- Language: ${stackInfo.language || 'unknown'}`,
      `- Package Manager: ${stackInfo.packageManager || 'unknown'}`,
      `- Docker: ${stackInfo.hasDocker ? 'yes' : 'no'}`,
      `- .env.example: ${stackInfo.hasEnvExample ? 'yes' : 'no'}`,
    ];

    if (stackInfo.installCommand) lines.push(`- Install: ${stackInfo.installCommand}`);
    if (stackInfo.buildCommand) lines.push(`- Build: ${stackInfo.buildCommand}`);
    if (stackInfo.testCommand) lines.push(`- Test: ${stackInfo.testCommand}`);

    if (stackInfo.envVars && stackInfo.envVars.length > 0) {
      lines.push('', '## Environment Variables (from .env.example)');
      for (const v of stackInfo.envVars) {
        lines.push(`- ${v.key}${v.hint ? ` — ${v.hint}` : ''}`);
      }
    }

    if (readmeContent) {
      const truncated = readmeContent.slice(0, 4000);
      lines.push('', '## README Content', '', truncated);
    }

    lines.push(
      '',
      '## Playbook',
      '1. Read the README and any setup docs — understand what this project does',
      `2. Install dependencies: ${stackInfo.installCommand || '(detect and run)'}`,
      '3. Check for .env.example — list what the user needs to provide',
      '4. Run setup/init commands if documented',
      '5. Run a build or type-check to verify setup is healthy',
      '6. Summarize: what it is, what it does, how to use it, what is missing',
      '7. Offer to create a team if the user wants ongoing work',
      '',
      '## Safety Rules (MUST FOLLOW)',
      `- Do NOT install anything globally (no npm install -g, pip install --user, brew install)`,
      `- Do NOT modify files outside ${repoPath}/`,
      `- Do NOT run docker commands without asking the user first`,
      `- Do NOT run destructive commands (rm -rf, drop database, etc.)`,
      `- Track every process you spawn via: curl -s -X POST http://localhost:31415/api/repos/<importId>/process -H 'Content-Type: application/json' -d '{"pid":"<PID>","command":"<CMD>"}'`,
      `- If something fails, report the error — do NOT retry destructively`,
    );

    return lines.join('\n');
  }

  // --- Helpers ---

  _getPat() {
    try {
      const creds = this.daemon.credentials;
      if (!creds) return null;
      return creds.getKey?.('github') || creds.getKey?.('github-pat') || null;
    } catch { return null; }
  }
}
