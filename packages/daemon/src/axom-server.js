// GROOVE — Axom Server Manager (per-session local instances)
// FSL-1.1-Apache-2.0 — see LICENSE
//
// Manages local `axom serve` processes per contract §11: one instance per
// GROOVE session that wants its own Axom, each with its own port and its own
// SOVEREIGN --data-dir (ledgers never shared — that isolation is the product,
// not an implementation detail). Same lifecycle family as LlamaServerManager.
// The serve binary refuses a locked data-dir; we surface that error verbatim
// rather than retrying around it.

import { spawn, execFileSync } from 'child_process';
import { mkdirSync, statfsSync, existsSync } from 'fs';
import { join } from 'path';
import os from 'os';
import { AXOM_DEFAULT_PORT } from './axom-connector.js';

const START_TIMEOUT_MS = 60000; // model load can be slow on first start

// Local-inference floor, learned 2026-07-25: an 8GB Mac loaded the 4GB Q8
// chassis fine, then llama_decode failed at the Metal working-set ceiling and
// memory pressure took the whole machine down. Refusing is a feature. The
// install manifest's min_ram_gb overrides these when present.
export const AXOM_REQUIREMENTS = {
  minRamGb: 12,
  recommendedRamGb: 16,
  minDiskGb: 6,
  downloadGb: 4.4,
};

// Is a runtime ALREADY on this machine? Distribution gating ("Coming soon")
// controls DOWNLOADING, never running — a machine that already has Axom must
// be able to start it regardless of whether this build can fetch one.
export function detectRuntime(command) {
  const cmd = command || 'axom';
  // A configured command may be a full invocation ("cd /x && python3 -m
  // axom.cli"); probe the first token that looks like a path or binary.
  const probe = cmd.trim().split(/\s+/).find((t) => !t.includes('=') && t !== 'cd') || cmd;
  try {
    if (probe.startsWith('/') || probe.startsWith('~')) {
      return { installed: existsSync(probe.replace(/^~/, os.homedir())), command: cmd, source: 'path' };
    }
    execFileSync(process.platform === 'win32' ? 'where' : 'which', [probe], {
      stdio: 'ignore', timeout: 5000,
    });
    return { installed: true, command: cmd, source: 'PATH' };
  } catch {
    return { installed: false, command: cmd, source: null };
  }
}

export function hardwareReport(dir = os.homedir(), requirements = AXOM_REQUIREMENTS) {
  const totalRamGb = os.totalmem() / 2 ** 30;
  let freeDiskGb = null;
  try {
    const s = statfsSync(dir);
    freeDiskGb = (s.bavail * s.bsize) / 2 ** 30;
  } catch { /* stat unavailable — report null, never guess */ }
  const appleSilicon = process.platform === 'darwin' && process.arch === 'arm64';
  const verdict = totalRamGb < requirements.minRamGb ? 'insufficient'
    : totalRamGb < requirements.recommendedRamGb ? 'marginal' : 'ready';
  return {
    totalRamGb: Math.round(totalRamGb * 10) / 10,
    cpuCores: os.cpus().length,
    arch: process.arch,
    platform: process.platform,
    appleSilicon,
    gpu: appleSilicon ? 'Metal (unified memory)' : null, // CUDA detection: v1
    freeDiskGb: freeDiskGb === null ? null : Math.round(freeDiskGb * 10) / 10,
    diskOk: freeDiskGb === null ? null : freeDiskGb >= requirements.minDiskGb,
    verdict,
    requirements,
  };
}

export class AxomServerManager {
  constructor(daemon, opts = {}) {
    this.daemon = daemon;
    this.command = opts.command || null; // resolved lazily from config
    this.totalRamGbOverride = opts.totalRamGb; // tests inject; prod reads os
    this.portBase = opts.portBase || AXOM_DEFAULT_PORT;
    this.instances = new Map(); // id -> {id, proc, port, dataDir, status, startedAt, error}
  }

  _command() {
    return this.command || this.daemon.config?.axom?.command || 'axom';
  }

  _modelDir() {
    return this.daemon.config?.axom?.modelDir
      || join(this.daemon.grooveDir, 'axom', 'models');
  }

  _allocatePort() {
    const used = new Set([...this.instances.values()].map((i) => i.port));
    for (const ep of this.daemon.axom?.endpoints?.values?.() || []) {
      try { used.add(Number(new URL(ep.url).port)); } catch { /* non-numeric */ }
    }
    let port = this.portBase;
    while (used.has(port)) port += 1;
    return port;
  }

  list() {
    return [...this.instances.values()].map(({ proc, ...rest }) => rest);
  }

  // Start a local instance. `id` doubles as the data-dir name, so the same id
  // across restarts resumes the same sovereign memory.
  // opts.launch: {command, cwd?, env?} — a SPEC, not a binary name (source
  // checkouts launch as `python3 -u -m axom.cli ...` with cwd+env; the
  // installed default is just `axom`). Specs are verbatim: GROOVE never adds
  // or removes flags (--cpu on the Spark is policy, not ours to "improve").
  // opts.dataDir: adopt an existing sovereign ledger instead of minting one
  // under .groove — one central ledger per user; sessions are recency
  // scopes, never memory walls (SPARK_DEV_SETUP.md ruling).
  async start(id = 'default', opts = {}) {
    if (!/^[a-zA-Z0-9_-]{1,40}$/.test(id)) throw new Error('invalid instance id');
    const existing = this.instances.get(id);
    if (existing && existing.status === 'running') return this.list().find((i) => i.id === id);

    // Hardware floor — refuse under-spec local inference instead of letting
    // it take the host down. Mock mode is weightless and exempt.
    if (!this.daemon.config?.axom?.mock && !this.daemon.config?.axom?.allowUnderspec) {
      const totalRamGb = this.totalRamGbOverride ?? os.totalmem() / 2 ** 30;
      if (totalRamGb < AXOM_REQUIREMENTS.minRamGb) {
        throw new Error(
          `This machine has ${Math.round(totalRamGb)}GB RAM — below Axom's ${AXOM_REQUIREMENTS.minRamGb}GB floor for local inference. `
          + 'Connect to a remote Axom endpoint instead (axom.allowUnderspec overrides at your own risk).',
        );
      }
    }

    const port = this._allocatePort();
    const dataDir = opts.dataDir || join(this.daemon.grooveDir, 'axom', 'instances', id);
    mkdirSync(dataDir, { recursive: true });

    const args = [
      'serve',
      '--host', '127.0.0.1',
      '--port', String(port),
      '--data-dir', dataDir,
      '--model-dir', this._modelDir(),
    ];
    // config.axom.mock: run the scripted engine (§11 addendum) — the
    // no-weights bring-up mode. /about reports family "mock" so the GUI can
    // never mistake it for the real thing.
    if (this.daemon.config?.axom?.mock) args.push('--mock');
    const instance = {
      id, port, dataDir, status: 'starting', startedAt: Date.now(), error: null, proc: null,
    };
    this.instances.set(id, instance);
    this._broadcast();

    // A spec may carry env/cwd without naming a command (the caller wanted the
    // configured binary plus the blessed env) — fill the command, keep the rest.
    const launch = { ...opts.launch, command: opts.launch?.command || this._command() };
    let proc;
    try {
      if (launch.cwd || launch.env || /\s/.test(launch.command)) {
        // Compound commands run through bash -lc — `nohup cd x && prog`-class
        // failures taught us a spec is a shell line, not an argv[0].
        const quotedArgs = args.map((a) => `'${String(a).replace(/'/g, `'\\''`)}'`).join(' ');
        proc = spawn('bash', ['-lc', `exec ${launch.command} ${quotedArgs}`], {
          stdio: ['ignore', 'pipe', 'pipe'],
          cwd: launch.cwd || undefined,
          env: launch.env ? { ...process.env, ...launch.env } : process.env,
        });
      } else {
        proc = spawn(launch.command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      }
    } catch (err) {
      instance.status = 'error';
      instance.error = err.message;
      this._broadcast();
      throw err;
    }
    instance.proc = proc;
    let stderrTail = '';
    proc.stderr?.on('data', (d) => { stderrTail = (stderrTail + d.toString()).slice(-2000); });
    proc.on('error', (err) => {
      instance.status = 'error';
      instance.error = err.code === 'ENOENT'
        ? `"${launch.command}" not found — install the Axom runtime first`
        : err.message;
      this._broadcast();
    });
    proc.on('exit', (code, signal) => {
      const wasRunning = instance.status === 'running';
      instance.status = instance.status === 'stopping' ? 'stopped' : 'error';
      if (instance.status === 'error') {
        // The lockfile refusal (§11: two instances on one data-dir) lands
        // here — surface the runtime's own words, don't paraphrase.
        instance.error = instance.error || stderrTail.trim().split('\n').pop() || `exited (code ${code}, signal ${signal})`;
      }
      instance.proc = null;
      if (wasRunning) this._deregisterEndpoint(id);
      this._broadcast();
      this.daemon.audit.log('axom.instance.exit', { id, code, signal });
    });

    await this._waitForAbout(port, instance);
    if (instance.status !== 'error') {
      instance.status = 'running';
      this._registerEndpoint(id, port);
      this.daemon.audit.log('axom.instance.start', { id, port, dataDir });
    }
    this._broadcast();
    if (instance.status === 'error') throw new Error(instance.error || 'instance failed to start');
    return this.list().find((i) => i.id === id);
  }

  async stop(id) {
    const instance = this.instances.get(id);
    if (!instance) throw new Error(`no instance "${id}"`);
    instance.status = 'stopping';
    this._broadcast();
    this._deregisterEndpoint(id);
    if (instance.proc) {
      instance.proc.kill('SIGTERM');
      await new Promise((resolve) => {
        const t = setTimeout(() => { instance.proc?.kill('SIGKILL'); resolve(); }, 5000);
        instance.proc.once('exit', () => { clearTimeout(t); resolve(); });
      });
    } else {
      instance.status = 'stopped';
    }
    this._broadcast();
    this.daemon.audit.log('axom.instance.stop', { id });
  }

  async _waitForAbout(port, instance) {
    const deadline = Date.now() + START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (instance.status === 'error') return;
      try {
        const res = await fetch(`http://127.0.0.1:${port}/about`, { signal: AbortSignal.timeout(2000) });
        if (res.ok) {
          // Verify the answer is OURS. Another process (or an SSH tunnel to a
          // remote runtime) can already own this port; adopting it would let
          // GROOVE claim — and offer to shut down — a runtime it never
          // launched. §11 gives /about an instance block; when it names a
          // different pid or data-dir, this port is not ours.
          const about = await res.json().catch(() => null);
          const claimed = about?.instance;
          const foreign = claimed
            && ((claimed.pid && instance.proc?.pid && claimed.pid !== instance.proc.pid)
              || (claimed.data_dir && claimed.data_dir !== instance.dataDir));
          if (foreign) {
            instance.status = 'error';
            instance.error = `port ${port} is already served by another Axom runtime `
              + `(${claimed.data_dir || `pid ${claimed.pid}`}) — refusing to adopt it`;
            instance.proc?.kill('SIGKILL');
            return;
          }
          return;
        }
      } catch { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 500));
    }
    instance.status = 'error';
    instance.error = instance.error || `no /about on port ${port} within ${START_TIMEOUT_MS / 1000}s`;
    instance.proc?.kill('SIGKILL');
  }

  // Managed instances surface through the same connector as any endpoint —
  // one socket, every tier (contract §5).
  _registerEndpoint(id, port) {
    const name = `local-${id}`;
    const entries = (this.daemon.config.axom?.endpoints || []).filter((e) => e.name !== name);
    entries.push({ name, url: `http://127.0.0.1:${port}`, managed: true });
    this.daemon.config.axom = { ...(this.daemon.config.axom || {}), endpoints: entries };
    this.daemon.axom.configure(entries);
  }

  _deregisterEndpoint(id) {
    const name = `local-${id}`;
    const entries = (this.daemon.config.axom?.endpoints || []).filter((e) => e.name !== name);
    this.daemon.config.axom = { ...(this.daemon.config.axom || {}), endpoints: entries };
    this.daemon.axom.configure(entries);
  }

  _broadcast() {
    this.daemon.broadcast({ type: 'axom:instances', data: this.list() });
  }

  async destroy() {
    for (const id of [...this.instances.keys()]) {
      try { await this.stop(id); } catch { /* shutting down */ }
    }
  }
}
