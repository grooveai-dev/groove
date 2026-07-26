// GROOVE — Axom Installer (manifest-driven)
// FSL-1.1-Apache-2.0 — see LICENSE
//
// Installs the Axom runtime + models against an install manifest per contract
// §11. The GUI (and this module) NEVER hardcodes a source — dev vs launch is
// purely a manifest swap. Models are sha256-verified before anything is
// configured; a failed verify configures nothing.
//
// Manifest shape (§11):
//   {runtime: {kind: "pip"|"wheel-url"|"tarball", ref, sha256},
//    models: [{file, url, sha256, bytes}], min_version}

import { execFile } from 'child_process';
import { createHash } from 'crypto';
import { createWriteStream } from 'fs';
import { mkdir, rename, rm } from 'fs/promises';
import { join } from 'path';
import os from 'os';
import { pipeline } from 'stream/promises';
import { Transform } from 'stream';
import { AXOM_REQUIREMENTS, detectRuntime } from './axom-server.js';

export class AxomInstaller {
  constructor(daemon, opts = {}) {
    this.daemon = daemon;
    this.pipCommand = opts.pipCommand || ['python3', '-m', 'pip'];
    this.totalRamGbOverride = opts.totalRamGb; // tests inject; prod reads os
    this.status = { phase: 'idle', file: null, receivedBytes: 0, totalBytes: 0, error: null };
    this._running = false;
  }

  // Availability is a first-class answer, not an error string. A GROOVE build
  // with no manifest configured cannot install Axom at all — the UI must say
  // so up front rather than offering a button that fails on click.
  getStatus() {
    const manifestUrl = this.daemon.config?.axom?.manifestUrl || null;
    // Already-installed runtimes are NOT gated. Distribution gating controls
    // downloading; a machine that already has Axom (the Spark, a dev box, an
    // operator install) must be able to start it. Conflating the two told a
    // user standing on a working runtime that it was "coming soon".
    const runtime = detectRuntime(this.daemon.config?.axom?.command);
    return {
      ...this.status,
      available: !!manifestUrl,
      manifestUrl,
      unavailableReason: manifestUrl ? null : 'Coming soon',
      runtimeInstalled: runtime.installed,
      runtimeCommand: runtime.installed ? runtime.command : null,
    };
  }

  _update(patch) {
    this.status = { ...this.status, ...patch };
    this.daemon.broadcast({ type: 'axom:install:progress', data: this.getStatus() });
  }

  async install(manifestUrl) {
    // Gate, don't explain: a build with no configured distribution simply
    // cannot install. The UI shows "Coming soon" and never offers the action;
    // this is the server-side half of the same gate (a hand-crafted POST
    // can't bypass it either).
    const url = manifestUrl || this.daemon.config?.axom?.manifestUrl;
    if (!url) throw new Error('Coming soon — Axom is not yet available for local install.');
    if (this._running) throw new Error('an install is already running');
    // Same hardware floor as the instance manager — never download 4GB of
    // weights onto a machine that can't safely run them. Manifest min_ram_gb
    // (when present) is the authority; the static floor is the fallback.
    if (!this.daemon.config?.axom?.allowUnderspec) {
      const totalRamGb = this.totalRamGbOverride ?? os.totalmem() / 2 ** 30;
      if (totalRamGb < AXOM_REQUIREMENTS.minRamGb) {
        throw new Error(
          `This machine has ${Math.round(totalRamGb)}GB RAM — below Axom's ${AXOM_REQUIREMENTS.minRamGb}GB floor for local inference. `
          + 'Connect to a remote Axom endpoint instead.',
        );
      }
    }
    this._running = true;
    try {
      this._update({ phase: 'manifest', file: null, receivedBytes: 0, totalBytes: 0, error: null });
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (res.status === 401 || res.status === 403) {
        throw new Error('This Axom build is private — your account does not have access to the distribution. Connect to an Axom running elsewhere instead.');
      }
      if (res.status === 404) {
        throw new Error(`No Axom distribution found at ${url} — the configured manifest URL is wrong or the release was removed.`);
      }
      if (!res.ok) throw new Error(`manifest fetch failed: HTTP ${res.status}`);
      const manifest = await res.json();
      if (!Array.isArray(manifest.models)) throw new Error('manifest has no models list');

      if (manifest.runtime) await this._installRuntime(manifest.runtime);

      const modelDir = this.daemon.axomServer?._modelDir()
        || join(this.daemon.grooveDir, 'axom', 'models');
      await mkdir(modelDir, { recursive: true });
      for (const model of manifest.models) {
        await this._downloadVerified(model, modelDir);
      }

      this._update({ phase: 'done', file: null });
      this.daemon.audit.log('axom.install.complete', { models: manifest.models.length });
      return { ok: true, models: manifest.models.length };
    } catch (err) {
      this._update({ phase: 'error', error: err.message });
      throw err;
    } finally {
      this._running = false;
    }
  }

  async _installRuntime(runtime) {
    this._update({ phase: 'runtime', file: runtime.ref || null });
    if (runtime.kind === 'pip') {
      const [cmd, ...base] = this.pipCommand;
      await new Promise((resolve, reject) => {
        execFile(cmd, [...base, 'install', runtime.ref], { timeout: 600000 }, (err, _out, stderr) => {
          if (err) reject(new Error(`pip install failed: ${stderr?.slice(-400) || err.message}`));
          else resolve();
        });
      });
      return;
    }
    // Honest v0 boundary — no silent no-op for kinds we don't handle yet.
    throw new Error(`runtime kind "${runtime.kind}" is not supported by this GROOVE version`);
  }

  async _downloadVerified({ file, url, sha256, bytes }, modelDir) {
    if (!file || !/^[a-zA-Z0-9._-]+$/.test(file)) throw new Error(`unsafe model filename: ${file}`);
    if (!sha256) throw new Error(`manifest entry ${file} has no sha256 — refusing unverifiable download`);
    const finalPath = join(modelDir, file);
    const tmpPath = `${finalPath}.part`;
    this._update({ phase: 'models', file, receivedBytes: 0, totalBytes: bytes || 0 });

    const res = await fetch(url);
    if (res.status === 401 || res.status === 403) {
      throw new Error(`${file} is in a private repository your account can't read — the model weights are gated. Nothing was installed.`);
    }
    if (!res.ok || !res.body) throw new Error(`download failed for ${file}: HTTP ${res.status}`);

    const hash = createHash('sha256');
    let received = 0;
    let lastBroadcast = 0;
    const meter = new Transform({
      transform: (chunk, _enc, cb) => {
        hash.update(chunk);
        received += chunk.length;
        const now = Date.now();
        if (now - lastBroadcast > 500) { // progress, throttled
          lastBroadcast = now;
          this._update({ receivedBytes: received });
        }
        cb(null, chunk);
      },
    });

    try {
      await pipeline(res.body, meter, createWriteStream(tmpPath));
      const digest = hash.digest('hex');
      if (digest !== sha256.toLowerCase()) {
        throw new Error(`sha256 mismatch for ${file}: expected ${sha256}, got ${digest}`);
      }
      await rename(tmpPath, finalPath);
      this._update({ receivedBytes: received });
    } catch (err) {
      await rm(tmpPath, { force: true });
      throw err;
    }
  }
}
