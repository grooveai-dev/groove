// GROOVE — Preview Service
// FSL-1.1-Apache-2.0 — see LICENSE
//
// Launches the one-click preview for a completed team. The planner writes a
// "preview" block in recommended-team.json describing how to run the project
// (dev-server command, static-html entry, or none). When the last phase
// agent completes, we spawn the command, parse the URL from stdout, and
// broadcast a preview:ready event so the GUI can show a View Site toast.
//
// One preview process per team. Starting a new preview for the same team
// kills the previous one. Previews are also killed on team delete and on
// daemon shutdown.

import { spawn as cpSpawn, execSync } from 'child_process';
import { resolve, extname } from 'path';
import { existsSync, readFileSync, statSync } from 'fs';
import { createServer, request as httpRequest } from 'http';
import { request as httpsRequest } from 'https';
import { lookup as mimeLookup } from './mimetypes.js';

const READY_TIMEOUT_MS = 120_000;  // give dev servers 2 minutes (large projects need npm install)
const MAX_STDOUT_BYTES = 256 * 1024;
// Strip CSI/OSC/other ANSI escape sequences — Vite prints URLs with inline
// bold/color codes (e.g. "http://localhost:\x1b[1m5175\x1b[22m/") which would
// otherwise break port-number regexes.
const ANSI_REGEX = /[\u001B\u009B][[\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*|[a-zA-Z\d]+(?:;[-a-zA-Z\d/#&.:=?%@~_]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;
function stripAnsi(s) { return s.replace(ANSI_REGEX, ''); }

export class PreviewService {
  constructor(daemon) {
    this.daemon = daemon;
    this.previews = new Map(); // teamId -> { proc?, server?, url, kind, startedAt }
    this.pendingPlans = new Map(); // teamId -> { preview, workingDir }
  }

  /**
   * Capture a preview plan at team launch time — api cleanup deletes the
   * source file immediately after read, so the daemon is the only place the
   * preview block survives.
   */
  stashPlan(teamId, preview, workingDir, maxPhase = 1, agents = []) {
    if (!teamId || !preview) return;
    this.pendingPlans.set(teamId, { preview, workingDir, maxPhase, agents });
  }

  getPlan(teamId) {
    return this.pendingPlans.get(teamId) || null;
  }

  clearPlan(teamId) {
    this.pendingPlans.delete(teamId);
  }

  /**
   * Read recommended-team.json for a given working directory and return the
   * preview block (or null if none). We read from both the team working dir
   * and the daemon .groove dir to cover the cases the api cleanup hits.
   */
  getPlanPreview(workingDir) {
    const candidates = [
      workingDir ? resolve(workingDir, '.groove', 'recommended-team.json') : null,
      resolve(this.daemon.grooveDir, 'recommended-team.json'),
    ].filter(Boolean);
    for (const p of candidates) {
      if (!existsSync(p)) continue;
      try {
        const data = JSON.parse(readFileSync(p, 'utf8'));
        if (data && typeof data.preview === 'object') return data.preview;
      } catch { /* malformed, keep looking */ }
    }
    return null;
  }

  /**
   * Preview blocks are embedded in the plan artifact, which /api/cleanup
   * deletes as soon as the user clicks Launch Team. Callers should grab the
   * preview upfront at launch time and hand it back when the team completes.
   */
  async launch(teamId, workingDir, preview) {
    this.daemon.audit?.log('preview.attempt', { teamId, workingDir, preview });

    if (!preview || !preview.kind || preview.kind === 'none' || preview.kind === 'cli') {
      const result = { launched: false, reason: preview?.kind || 'no_preview' };
      this.daemon.audit?.log('preview.skipped', { teamId, reason: result.reason });
      return result;
    }

    await this.kill(teamId);

    // Resolve cwd with a sensible fallback. The planner sometimes names the
    // cwd after projectDir which is applied by api/launch → the actual project
    // root. If that specific subdir doesn't exist, try workingDir itself.
    const root = resolve(workingDir || this.daemon.projectDir);
    const candidates = [];
    if (preview.cwd) {
      const cwdSegment = String(preview.cwd).replace(/[\\/]+$/, '').split(/[\\/]+/).pop();
      const rootSegment = root.split(/[\\/]+/).pop();
      if (cwdSegment && cwdSegment === rootSegment) {
        candidates.push(root);
      } else {
        candidates.push(resolve(root, preview.cwd));
      }
    }
    candidates.push(root);
    const baseDir = candidates.find((p) => existsSync(p));

    if (!baseDir) {
      const result = { launched: false, reason: `cwd_missing: tried ${candidates.join(' and ')}` };
      this.daemon.audit?.log('preview.failed', { teamId, reason: result.reason });
      return result;
    }

    const installResult = this._ensureDependencies(teamId, baseDir);
    if (installResult?.failed) {
      this.daemon.audit?.log('preview.failed', { teamId, reason: installResult.reason });
      return { launched: false, reason: installResult.reason };
    }

    // Static-first strategy: always try build+static before dev-server.
    // Static serving is near-100% reliable — no port conflicts, no proxy
    // issues, no HMR quirks, no URL rewriting. Dev servers fail constantly
    // in AI-generated projects (wrong ports, missing scripts, relative path
    // breakage through the proxy). Only fall back to dev-server when there
    // is no build output at all.

    const openFile = (preview.openPath || 'index.html').replace(/^\/+/, '');
    const pkgPath = resolve(baseDir, 'package.json');
    let hasBuildScript = false;
    let isFrontendProject = false;
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      hasBuildScript = !!pkg.scripts?.build;
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      isFrontendProject = !!(allDeps?.react || allDeps?.vue || allDeps?.svelte || allDeps?.vite
        || allDeps?.['@angular/core'] || allDeps?.next || allDeps?.nuxt || allDeps?.astro);
    } catch { /* no package.json or malformed */ }

    // Also detect frontend by config files
    if (!isFrontendProject) {
      const frontendConfigs = ['vite.config', 'next.config', 'webpack.config', 'svelte.config', 'astro.config', 'nuxt.config', 'angular.json'];
      for (const cfg of frontendConfigs) {
        if (['.js', '.ts', '.mjs', '.cjs', ''].some((ext) => existsSync(resolve(baseDir, cfg + ext)))) {
          isFrontendProject = true;
          break;
        }
      }
    }

    // Common build output directories
    const OUTPUT_DIRS = ['dist', 'build', 'out', '.next/standalone', 'public'];

    let result;

    // Strategy 1: Build and serve static (only for frontend projects — skip for backends)
    if (hasBuildScript && (isFrontendProject || preview.kind === 'static-html')) {
      const buildResult = this._runBuild(teamId, baseDir);
      if (!buildResult?.failed) {
        result = this._findAndServeStatic(teamId, baseDir, OUTPUT_DIRS, openFile, preview);
        if (result && (await result).launched) {
          result = await result;
          this.daemon.audit?.log('preview.launched', { teamId, url: result.url, kind: result.kind, baseDir, strategy: 'build-static' });
          return result;
        }
      }
    }

    // Strategy 2: Serve existing static files (pre-built, plain HTML, no-build projects)
    result = this._findAndServeStatic(teamId, baseDir, OUTPUT_DIRS, openFile, preview);
    if (result && (await result).launched) {
      result = await result;
      this.daemon.audit?.log('preview.launched', { teamId, url: result.url, kind: result.kind, baseDir, strategy: 'serve-existing' });
      return result;
    }

    // Strategy 3: Dev server (backends, SSR frameworks, projects with no static output)
    if (preview.kind === 'dev-server') {
      result = await this._launchDevServer(teamId, baseDir, preview);
      if (result?.launched) {
        this.daemon.audit?.log('preview.launched', { teamId, url: result.url, kind: result.kind, baseDir, strategy: 'dev-server' });
        return result;
      }
    }

    result = result || { launched: false, reason: 'all_strategies_failed' };
    this.daemon.audit?.log('preview.failed', { teamId, reason: result.reason, baseDir });
    return result;
  }

  _findAndServeStatic(teamId, baseDir, outputDirs, openFile, preview) {
    // Check output directories first, then baseDir itself
    for (const dir of outputDirs) {
      const fullDir = resolve(baseDir, dir);
      if (existsSync(resolve(fullDir, openFile))) {
        return this._launchStatic(teamId, fullDir, { ...preview, openPath: openFile });
      }
      if (openFile !== 'index.html' && existsSync(resolve(fullDir, 'index.html'))) {
        return this._launchStatic(teamId, fullDir, { ...preview, openPath: 'index.html' });
      }
    }
    // Finally check baseDir itself (plain HTML projects)
    if (existsSync(resolve(baseDir, openFile))) {
      return this._launchStatic(teamId, baseDir, { ...preview, openPath: openFile });
    }
    return Promise.resolve({ launched: false, reason: 'no_static_entry' });
  }

  _ensureDependencies(teamId, baseDir) {
    const pkgPath = resolve(baseDir, 'package.json');
    const nodeModules = resolve(baseDir, 'node_modules');
    if (!existsSync(pkgPath) || existsSync(nodeModules)) return null;
    try {
      console.log(`[Groove:Preview] Running npm install in ${baseDir}`);
      this.daemon.audit?.log('preview.npm-install', { teamId, baseDir });
      execSync('npm install', { cwd: baseDir, timeout: 120_000, stdio: 'pipe' });
      return null;
    } catch (err) {
      return { failed: true, reason: `npm install failed: ${err.message?.slice(0, 300)}` };
    }
  }

  _needsBuild(baseDir, preview) {
    const pkgPath = resolve(baseDir, 'package.json');
    let hasBuildScript = false;
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      hasBuildScript = !!pkg.scripts?.build;
    } catch { /* no package.json or malformed */ }

    const distDir = resolve(baseDir, 'dist');
    const distExists = existsSync(distDir);

    // Primary: build script exists and dist/ doesn't
    if (hasBuildScript && !distExists) return true;

    // Stale check: dist/ exists but package.json is newer than dist/index.html
    if (hasBuildScript && distExists) {
      const distIndex = resolve(distDir, 'index.html');
      if (existsSync(distIndex) && existsSync(pkgPath)) {
        try {
          const distMtime = statSync(distIndex).mtimeMs;
          const pkgMtime = statSync(pkgPath).mtimeMs;
          if (pkgMtime > distMtime) return true;
        } catch { /* ignore stat errors */ }
      }
    }

    // Secondary: entry file references .tsx/.jsx sources (needs transpilation)
    const openPath = (preview.openPath || 'index.html').replace(/^\/+/, '');
    const entryFile = resolve(baseDir, openPath);
    if (existsSync(entryFile)) {
      try {
        const html = readFileSync(entryFile, 'utf8');
        if (/src=["'][^"']*\.(tsx?|jsx)["']/i.test(html)) return true;
      } catch { /* ignore */ }
    }

    // Entry file missing — check if a build might create it
    if (!existsSync(entryFile) && hasBuildScript) {
      const frameworkConfigs = ['vite.config', 'next.config', 'webpack.config'];
      for (const cfg of frameworkConfigs) {
        for (const ext of ['.js', '.ts', '.mjs', '.cjs']) {
          if (existsSync(resolve(baseDir, cfg + ext))) return true;
        }
      }
    }

    return false;
  }

  _needsPreBuild(baseDir) {
    const pkgPath = resolve(baseDir, 'package.json');
    if (!existsSync(pkgPath)) return false;
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      const startScript = pkg.scripts?.start || '';
      if (/\bnext\s+start\b/.test(startScript)) return true;
      if (/\bserve\b/.test(startScript) && !pkg.scripts?.dev) return true;
      if (/\bhttp-server\b/.test(startScript)) return true;
    } catch { /* ignore */ }
    return false;
  }

  _runBuild(teamId, baseDir) {
    const pkgPath = resolve(baseDir, 'package.json');
    if (!existsSync(pkgPath)) return { failed: true, reason: 'no package.json for build' };
    let pkg;
    try {
      pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      if (!pkg.scripts?.build) return { failed: true, reason: 'no build script' };
    } catch { return { failed: true, reason: 'malformed package.json' }; }

    const isVite = ['vite.config.js', 'vite.config.ts', 'vite.config.mjs', 'vite.config.cjs']
      .some((f) => existsSync(resolve(baseDir, f)));

    let command = 'npm run build';
    const env = { ...process.env };

    // Force relative base paths for Vite — absolute paths break in iframe
    if (isVite) {
      const buildScript = (pkg.scripts.build || '').trim();
      if (/\bvite\s+build\b/.test(buildScript)) {
        command = `npm run build -- --base=./`;
      }
      env.VITE_BASE = './';
    }

    try {
      console.log(`[Groove:Preview] Running ${command} in ${baseDir}`);
      this.daemon.audit?.log('preview.build', { teamId, baseDir, command });
      execSync(command, { cwd: baseDir, timeout: 120_000, stdio: 'pipe', env });
      return null;
    } catch (err) {
      return { failed: true, reason: `build failed: ${err.message?.slice(0, 300)}` };
    }
  }

  _launchStatic(teamId, baseDir, preview) {
    const openPath = (preview.openPath || 'index.html').replace(/^\/+/, '');
    const entryFile = resolve(baseDir, openPath);
    if (!existsSync(entryFile)) {
      return Promise.resolve({ launched: false, reason: `entry_missing: ${entryFile}` });
    }
    const server = createServer((req, res) => {
      const url = decodeURIComponent((req.url || '/').split('?')[0]);
      const rel = url === '/' ? openPath : url.replace(/^\/+/, '');
      const filePath = resolve(baseDir, rel);
      if (!filePath.startsWith(baseDir)) { res.statusCode = 403; return res.end(); }
      if (!existsSync(filePath) || !statSync(filePath).isFile()) {
        // SPA fallback: serve index.html for HTML requests (client-side routing)
        const acceptsHtml = (req.headers.accept || '').includes('text/html');
        if (acceptsHtml) {
          const fallback = resolve(baseDir, openPath);
          if (existsSync(fallback) && statSync(fallback).isFile()) {
            res.setHeader('Content-Type', 'text/html');
            return res.end(readFileSync(fallback));
          }
        }
        res.statusCode = 404; return res.end('Not found');
      }
      res.setHeader('Content-Type', mimeLookup(extname(filePath)) || 'application/octet-stream');
      res.end(readFileSync(filePath));
    });
    return new Promise((done) => {
      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        const url = `http://127.0.0.1:${port}/`;
        this.previews.set(teamId, { server, url, kind: 'static-html', startedAt: Date.now() });
        this._broadcastReady(teamId, url, 'static-html');
        done({ launched: true, url, kind: 'static-html' });
      });
      server.on('error', (err) => done({ launched: false, reason: err.message }));
    });
  }

  _autoDetectDevCommand(baseDir) {
    const pkgPath = resolve(baseDir, 'package.json');
    if (!existsSync(pkgPath)) return null;
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      const scripts = pkg.scripts || {};
      for (const name of ['dev', 'start', 'serve']) {
        if (scripts[name]) return `npm run ${name}`;
      }
    } catch { /* malformed package.json */ }
    return null;
  }

  _launchDevServer(teamId, baseDir, preview) {
    let command = String(preview.command || '').trim();
    if (!command) {
      command = this._autoDetectDevCommand(baseDir) || '';
    }
    if (!command) {
      return Promise.resolve({ launched: false, reason: 'no_command' });
    }
    // If command references an npm script, verify it exists in package.json
    const npmRunMatch = command.match(/npm\s+run\s+(\S+)/);
    if (npmRunMatch) {
      const scriptName = npmRunMatch[1];
      const pkgPath = resolve(baseDir, 'package.json');
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
        if (!pkg.scripts || !pkg.scripts[scriptName]) {
          return Promise.resolve({ launched: false, reason: 'no_dev_script' });
        }
      } catch {
        return Promise.resolve({ launched: false, reason: 'no_dev_script' });
      }
    }
    const urlPattern = preview.urlPattern
      ? new RegExp(preview.urlPattern)
      : /https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0):\d+/;
    const readyText = preview.readyText || '';

    // Run the command via the user's shell so pipelines, && chains, env var
    // expansion, and shell builtins work as the planner wrote them.
    const proc = cpSpawn('bash', ['-lc', command], {
      cwd: baseDir,
      env: { ...process.env, FORCE_COLOR: '0', CI: '', BROWSER: 'none' },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });

    const entry = { proc, url: null, devUrl: null, proxyServer: null, kind: 'dev-server', startedAt: Date.now(), command, baseDir };
    this.previews.set(teamId, entry);

    let stdoutBuf = '';
    let stderrBuf = '';
    let resolved = false;

    return new Promise((done) => {
      const finish = (result) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        if (result.launched) {
          entry.url = result.url;
          this._broadcastReady(teamId, result.url, 'dev-server');
        } else {
          // Failed to detect URL — keep the process? Probably kill it; the user
          // will just see broken output otherwise.
          try { proc.kill('SIGTERM'); } catch {}
          this.previews.delete(teamId);
        }
        done(result);
      };

      const timer = setTimeout(() => {
        const tail = stripAnsi(stderrBuf).slice(-400) || stripAnsi(stdoutBuf).slice(-400) || '(no output)';
        finish({ launched: false, reason: `timeout waiting for url in stdout; last output: ${tail}` });
      }, READY_TIMEOUT_MS);

      let proxyStarting = false;
      const tryMatch = () => {
        const combined = stripAnsi(stdoutBuf + '\n' + stderrBuf);
        if (readyText && !combined.includes(readyText)) return;
        const m = combined.match(urlPattern);
        if (!m || proxyStarting) return;
        proxyStarting = true;
        let url = m[0];
        const openPath = (preview.openPath || '').replace(/^\/+/, '');
        if (openPath) url = url.replace(/\/$/, '') + '/' + openPath;
        this._createDevProxy(url).then(({ server, url: proxyUrl }) => {
          entry.devUrl = url;
          entry.proxyServer = server;
          finish({ launched: true, url: proxyUrl, devUrl: url, kind: 'dev-server' });
        }).catch((err) => {
          finish({ launched: false, reason: `proxy error: ${err.message}` });
        });
      };

      proc.stdout.on('data', (c) => {
        stdoutBuf += c.toString();
        if (stdoutBuf.length > MAX_STDOUT_BYTES) stdoutBuf = stdoutBuf.slice(-MAX_STDOUT_BYTES);
        tryMatch();
      });
      proc.stderr.on('data', (c) => {
        stderrBuf += c.toString();
        if (stderrBuf.length > MAX_STDOUT_BYTES) stderrBuf = stderrBuf.slice(-MAX_STDOUT_BYTES);
        tryMatch();
      });

      proc.on('exit', (code, signal) => {
        if (entry.proxyServer) {
          try { entry.proxyServer.close(); } catch { /* best-effort */ }
        }
        this.previews.delete(teamId);
        if (!resolved) {
          finish({ launched: false, reason: `process exited before url detected (code=${code} signal=${signal}); stderr tail: ${stderrBuf.slice(-400)}` });
        } else {
          this.daemon.broadcast({ type: 'preview:stopped', teamId, code, signal });
        }
      });
      proc.on('error', (err) => {
        if (!resolved) finish({ launched: false, reason: `spawn error: ${err.message}` });
      });
    });
  }

  _createDevProxy(devUrl) {
    let target;
    try {
      target = new URL(devUrl);
    } catch (err) {
      return Promise.reject(new Error(`invalid dev server URL: ${err.message}`));
    }

    const requester = target.protocol === 'https:' ? httpsRequest : httpRequest;
    const targetPort = target.port || (target.protocol === 'https:' ? 443 : 80);
    const targetRootPath = `${target.pathname || '/'}${target.search || ''}`;

    const toTargetPath = (incomingUrl = '/') => {
      const path = incomingUrl || '/';
      return path === '/' ? targetRootPath : path;
    };

    const server = createServer((req, res) => {
      const headers = { ...req.headers, host: target.host };
      const proxyReq = requester({
        hostname: target.hostname,
        port: targetPort,
        path: toTargetPath(req.url),
        method: req.method,
        headers,
      }, (proxyRes) => {
        const fwdHeaders = { ...proxyRes.headers };
        delete fwdHeaders['content-security-policy'];
        delete fwdHeaders['x-frame-options'];
        res.writeHead(proxyRes.statusCode || 502, fwdHeaders);
        proxyRes.pipe(res);
      });

      proxyReq.on('error', (err) => {
        if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
        res.end(`Proxy error: ${err.message}`);
      });
      req.pipe(proxyReq);
    });

    server.on('upgrade', (req, socket, head) => {
      const headers = { ...req.headers, host: target.host };
      const proxyReq = requester({
        hostname: target.hostname,
        port: targetPort,
        path: toTargetPath(req.url),
        method: 'GET',
        headers,
      });

      proxyReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
        const skipHeaders = new Set(['upgrade', 'connection', 'sec-websocket-accept']);
        const extra = Object.entries(proxyRes.headers)
          .filter(([key]) => !skipHeaders.has(key))
          .map(([key, value]) => `${key}: ${value}\r\n`).join('');
        socket.write(
          'HTTP/1.1 101 Switching Protocols\r\n' +
          `Upgrade: ${proxyRes.headers.upgrade || 'websocket'}\r\n` +
          'Connection: Upgrade\r\n' +
          `Sec-WebSocket-Accept: ${proxyRes.headers['sec-websocket-accept'] || ''}\r\n` +
          extra +
          '\r\n'
        );
        if (proxyHead.length) socket.write(proxyHead);
        if (head.length) proxySocket.write(head);
        socket.pipe(proxySocket);
        proxySocket.pipe(socket);
        proxySocket.on('error', () => socket.destroy());
        socket.on('error', () => proxySocket.destroy());
      });
      proxyReq.on('error', () => socket.destroy());
      proxyReq.end();
    });

    return new Promise((resolveProxy, rejectProxy) => {
      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        resolveProxy({ server, url: `http://127.0.0.1:${port}/` });
      });
      server.on('error', rejectProxy);
    });
  }

  _broadcastReady(teamId, url, kind) {
    this.daemon.audit?.log('preview.ready', { teamId, url, kind });
    this.daemon.broadcast({ type: 'preview:ready', teamId, url, kind });
  }

  get(teamId) {
    const entry = this.previews.get(teamId);
    if (!entry) return null;
    return { teamId, url: entry.url, devUrl: entry.devUrl, kind: entry.kind, startedAt: entry.startedAt };
  }

  list() {
    return Array.from(this.previews.entries()).map(([teamId, e]) => ({
      teamId, url: e.url, devUrl: e.devUrl, kind: e.kind, startedAt: e.startedAt,
    }));
  }

  async kill(teamId) {
    const entry = this.previews.get(teamId);
    if (!entry) return false;
    this.previews.delete(teamId);
    try {
      if (entry.server) entry.server.close();
      if (entry.proxyServer) entry.proxyServer.close();
      if (entry.proc) entry.proc.kill('SIGTERM');
    } catch { /* best-effort */ }
    this.daemon.audit?.log('preview.stopped', { teamId });
    this.daemon.broadcast({ type: 'preview:stopped', teamId });
    return true;
  }

  async killAll() {
    const ids = Array.from(this.previews.keys());
    await Promise.all(ids.map((id) => this.kill(id)));
  }
}
