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

import { spawn as cpSpawn } from 'child_process';
import { resolve, extname } from 'path';
import { existsSync, readFileSync, statSync } from 'fs';
import { createServer } from 'http';
import { lookup as mimeLookup } from './mimetypes.js';

const READY_TIMEOUT_MS = 60_000;  // give dev servers a minute to boot
const MAX_STDOUT_BYTES = 256 * 1024;

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
  stashPlan(teamId, preview, workingDir) {
    if (!teamId || !preview) return;
    this.pendingPlans.set(teamId, { preview, workingDir });
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
    if (!preview || !preview.kind || preview.kind === 'none' || preview.kind === 'cli') {
      return { launched: false, reason: preview?.kind || 'no_preview' };
    }

    // Kill any existing preview for this team
    await this.kill(teamId);

    const baseDir = preview.cwd
      ? resolve(workingDir || this.daemon.projectDir, preview.cwd)
      : resolve(workingDir || this.daemon.projectDir);

    if (!existsSync(baseDir)) {
      return { launched: false, reason: `cwd_missing: ${baseDir}` };
    }

    if (preview.kind === 'static-html') {
      return this._launchStatic(teamId, baseDir, preview);
    }
    if (preview.kind === 'dev-server') {
      return this._launchDevServer(teamId, baseDir, preview);
    }
    return { launched: false, reason: `unknown_kind: ${preview.kind}` };
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

  _launchDevServer(teamId, baseDir, preview) {
    const command = String(preview.command || '').trim();
    if (!command) {
      return Promise.resolve({ launched: false, reason: 'no_command' });
    }
    const urlPattern = preview.urlPattern
      ? new RegExp(preview.urlPattern)
      : /https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0):\d+/;
    const readyText = preview.readyText || '';

    // Run the command via the user's shell so pipelines, && chains, env var
    // expansion, and shell builtins work as the planner wrote them.
    const proc = cpSpawn('bash', ['-lc', command], {
      cwd: baseDir,
      env: { ...process.env, FORCE_COLOR: '0', CI: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });

    const entry = { proc, url: null, kind: 'dev-server', startedAt: Date.now(), command, baseDir };
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
        finish({ launched: false, reason: `timeout waiting for url in stdout; last stderr: ${stderrBuf.slice(-400)}` });
      }, READY_TIMEOUT_MS);

      const tryMatch = () => {
        const combined = stdoutBuf + '\n' + stderrBuf;
        if (readyText && !combined.includes(readyText)) return;
        const m = combined.match(urlPattern);
        if (!m) return;
        let url = m[0];
        const openPath = (preview.openPath || '').replace(/^\/+/, '');
        if (openPath) url = url.replace(/\/$/, '') + '/' + openPath;
        finish({ launched: true, url, kind: 'dev-server' });
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

  _broadcastReady(teamId, url, kind) {
    this.daemon.audit?.log('preview.ready', { teamId, url, kind });
    this.daemon.broadcast({ type: 'preview:ready', teamId, url, kind });
  }

  get(teamId) {
    const entry = this.previews.get(teamId);
    if (!entry) return null;
    return { teamId, url: entry.url, kind: entry.kind, startedAt: entry.startedAt };
  }

  list() {
    return Array.from(this.previews.entries()).map(([teamId, e]) => ({
      teamId, url: e.url, kind: e.kind, startedAt: e.startedAt,
    }));
  }

  async kill(teamId) {
    const entry = this.previews.get(teamId);
    if (!entry) return false;
    this.previews.delete(teamId);
    try {
      if (entry.server) entry.server.close();
      if (entry.proc) entry.proc.kill('SIGTERM');
    } catch { /* best-effort */ }
    this.daemon.broadcast({ type: 'preview:stopped', teamId });
    return true;
  }

  async killAll() {
    const ids = Array.from(this.previews.keys());
    await Promise.all(ids.map((id) => this.kill(id)));
  }
}
