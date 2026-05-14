// GROOVE — llama-server Process Manager
// FSL-1.1-Apache-2.0 — see LICENSE
//
// Manages llama-server (llama.cpp) inference server instances.
// Each model gets its own server on a unique port.
// Auto-starts when an agent needs a GGUF model, auto-stops when idle.

import { spawn, execSync, execFileSync } from 'child_process';
import { existsSync, mkdirSync, chmodSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';

const BASE_PORT = 8081;
const MAX_SERVERS = 5;
const HEALTH_TIMEOUT = 30000; // 30s for model loading
const HEALTH_POLL_INTERVAL = 500; // Check every 500ms
const IDLE_TIMEOUT = 300000; // 5 minutes before auto-stop

export class LlamaServerManager {
  constructor(daemon) {
    this.daemon = daemon;
    this.servers = new Map(); // modelPath -> { proc, port, users, startedAt, lastUsed }
    this.nextPort = BASE_PORT;
  }

  static isInstalled() {
    try {
      execSync('which llama-server', { stdio: 'ignore' });
      return true;
    } catch {
      // Check common manual install locations
      const paths = [
        resolve(homedir(), '.local', 'bin', 'llama-server'),
        resolve(homedir(), '.groove', 'bin', 'llama-server'),
        '/usr/local/bin/llama-server',
      ];
      return paths.some(p => existsSync(p));
    }
  }

  static getLlamaServerPath() {
    try {
      return execSync('which llama-server', { stdio: 'pipe', encoding: 'utf8' }).trim();
    } catch {
      const paths = [
        resolve(homedir(), '.local', 'bin', 'llama-server'),
        resolve(homedir(), '.groove', 'bin', 'llama-server'),
        '/usr/local/bin/llama-server',
      ];
      return paths.find(p => existsSync(p)) || 'llama-server';
    }
  }

  static async install() {
    const platform = process.platform;

    if (platform === 'darwin') {
      try {
        execSync('which brew', { stdio: 'ignore' });
      } catch {
        throw new Error('Homebrew not found. Install it from https://brew.sh then retry.');
      }
      execSync('brew install llama.cpp', { stdio: 'pipe', timeout: 600000 });
      return { method: 'brew', path: execSync('which llama-server', { encoding: 'utf8', stdio: 'pipe' }).trim() };
    }

    if (platform === 'linux') {
      const installDir = resolve(homedir(), '.local', 'bin');
      mkdirSync(installDir, { recursive: true });

      const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
      const hasCuda = (() => { try { execSync('which nvidia-smi', { stdio: 'ignore' }); return true; } catch { return false; } })();

      const resp = await fetch('https://api.github.com/repos/ggml-org/llama.cpp/releases/latest', {
        headers: { 'User-Agent': 'groove-dev' },
      });
      if (!resp.ok) throw new Error(`GitHub API error: ${resp.status}`);
      const release = await resp.json();

      const suffix = hasCuda ? `ubuntu-${arch}-cuda` : `ubuntu-${arch}`;
      let asset = release.assets.find(a => a.name.includes(suffix) && a.name.endsWith('.zip'));
      if (!asset && hasCuda) {
        asset = release.assets.find(a => a.name.includes(`ubuntu-${arch}`) && a.name.endsWith('.zip'));
      }
      if (!asset) {
        asset = release.assets.find(a => a.name.includes('ubuntu') && a.name.includes(arch) && a.name.endsWith('.zip'));
      }
      if (!asset) throw new Error(`No pre-built binary found for linux-${arch}. Build from source: https://github.com/ggml-org/llama.cpp#build`);

      const tmpZip = `/tmp/groove-llama-${Date.now()}.zip`;
      const tmpDir = `/tmp/groove-llama-extract-${Date.now()}`;

      execSync(`curl -fSL "${asset.browser_download_url}" -o "${tmpZip}"`, { stdio: 'pipe', timeout: 600000 });
      execSync(`unzip -o "${tmpZip}" -d "${tmpDir}"`, { stdio: 'pipe', timeout: 60000 });

      const findResult = execSync(`find "${tmpDir}" -name llama-server -type f`, { encoding: 'utf8', stdio: 'pipe' }).trim();
      const binPath = findResult.split('\n')[0];
      if (!binPath) throw new Error('llama-server binary not found in release archive');

      const destPath = resolve(installDir, 'llama-server');
      execSync(`cp "${binPath}" "${destPath}"`, { stdio: 'pipe' });
      chmodSync(destPath, 0o755);

      // Copy shared libraries if present
      try {
        const libDir = resolve(binPath, '..', '..', 'lib');
        if (existsSync(libDir)) {
          const userLibDir = resolve(homedir(), '.local', 'lib');
          mkdirSync(userLibDir, { recursive: true });
          execSync(`cp -r "${libDir}/"* "${userLibDir}/"`, { stdio: 'pipe' });
        }
      } catch { /* libs are optional */ }

      // Cleanup
      try { execSync(`rm -rf "${tmpZip}" "${tmpDir}"`, { stdio: 'ignore' }); } catch { /* best-effort */ }

      return { method: 'github-release', path: destPath, cuda: hasCuda, release: release.tag_name };
    }

    throw new Error(`Automatic install not supported on ${platform}. Install llama-server manually: https://github.com/ggml-org/llama.cpp#build`);
  }

  // --- Server Lifecycle ---

  /**
   * Ensure a llama-server is running for the given model.
   * Returns the OpenAI-compatible API base URL.
   * Starts the server if not already running.
   */
  async ensureServer(modelPath, options = {}) {
    // Reuse existing server
    if (this.servers.has(modelPath)) {
      const server = this.servers.get(modelPath);
      server.users++;
      server.lastUsed = Date.now();
      return `http://localhost:${server.port}`;
    }

    // Check capacity
    if (this.servers.size >= MAX_SERVERS) {
      // Stop least recently used server
      await this._evictLRU();
    }

    // Allocate port
    const port = this._allocatePort();

    // Start llama-server
    const ctxSize = options.contextWindow || 32768;
    const nGpuLayers = options.gpuLayers ?? -1; // -1 = auto (offload all to GPU)
    const parallel = options.parallel || 2;

    const args = [
      '--model', modelPath,
      '--port', String(port),
      '--host', '127.0.0.1',
      '--ctx-size', String(ctxSize),
      '--n-gpu-layers', String(nGpuLayers),
      '--parallel', String(parallel),
      '--log-disable', // Reduce noise
    ];

    // Flash attention for better memory efficiency (if supported)
    if (options.flashAttention !== false) {
      args.push('--flash-attn', 'auto');
    }

    const serverBin = LlamaServerManager.getLlamaServerPath();
    const proc = spawn(serverBin, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
      env: { ...process.env, LD_LIBRARY_PATH: [resolve(homedir(), '.local', 'lib'), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') },
    });

    if (!proc.pid) {
      throw new Error('Failed to start llama-server — check installation');
    }

    const server = {
      proc,
      port,
      modelPath,
      users: 1,
      startedAt: Date.now(),
      lastUsed: Date.now(),
      ready: false,
    };

    this.servers.set(modelPath, server);

    // Capture stderr for debugging
    const stderrBuf = [];
    proc.stderr.on('data', (chunk) => {
      stderrBuf.push(chunk.toString());
      if (stderrBuf.join('').length > 4096) stderrBuf.shift();
    });

    proc.on('exit', (code, signal) => {
      this.servers.delete(modelPath);
      this.daemon?.broadcast({
        type: 'llama:server:stopped',
        data: { modelPath, port, code, signal },
      });
    });

    // Wait for server to be ready
    try {
      await this._waitForHealth(port);
      server.ready = true;

      this.daemon?.broadcast({
        type: 'llama:server:ready',
        data: { modelPath, port },
      });

      return `http://localhost:${port}`;
    } catch (err) {
      // Server failed to start
      await this.stopServer(modelPath);
      const stderr = stderrBuf.join('').slice(-500);
      throw new Error(`llama-server failed to start: ${stderr || err.message}`);
    }
  }

  /**
   * Release a server (decrement user count).
   * Server auto-stops after IDLE_TIMEOUT if no users.
   */
  releaseServer(modelPath) {
    const server = this.servers.get(modelPath);
    if (!server) return;

    server.users = Math.max(0, server.users - 1);
    server.lastUsed = Date.now();

    // Schedule auto-stop check
    if (server.users === 0) {
      setTimeout(() => {
        const s = this.servers.get(modelPath);
        if (s && s.users === 0 && Date.now() - s.lastUsed >= IDLE_TIMEOUT) {
          this.stopServer(modelPath);
        }
      }, IDLE_TIMEOUT + 1000);
    }
  }

  async stopServer(modelPath) {
    const server = this.servers.get(modelPath);
    if (!server) return false;

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        try { server.proc.kill('SIGKILL'); } catch {}
      }, 5000);

      server.proc.on('exit', () => {
        clearTimeout(timeout);
        this.servers.delete(modelPath);
        resolve(true);
      });

      try {
        server.proc.kill('SIGTERM');
      } catch {
        clearTimeout(timeout);
        this.servers.delete(modelPath);
        resolve(true);
      }
    });
  }

  async stopAll() {
    const paths = Array.from(this.servers.keys());
    await Promise.all(paths.map((p) => this.stopServer(p)));
  }

  // --- Health Check ---

  async _waitForHealth(port) {
    const start = Date.now();
    while (Date.now() - start < HEALTH_TIMEOUT) {
      try {
        const res = await fetch(`http://localhost:${port}/health`, {
          signal: AbortSignal.timeout(2000),
        });
        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          if (data.status === 'ok' || data.status === 'no slot available') {
            return true;
          }
        }
      } catch {
        // Server still loading
      }
      await new Promise((r) => setTimeout(r, HEALTH_POLL_INTERVAL));
    }
    throw new Error(`llama-server health check timed out after ${HEALTH_TIMEOUT / 1000}s`);
  }

  async healthCheck(modelPath) {
    const server = this.servers.get(modelPath);
    if (!server) return { running: false };

    try {
      const res = await fetch(`http://localhost:${server.port}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      const data = await res.json().catch(() => ({}));
      return { running: true, ready: server.ready, port: server.port, status: data.status };
    } catch {
      return { running: true, ready: false, port: server.port, status: 'unreachable' };
    }
  }

  // --- Port Management ---

  _allocatePort() {
    const usedPorts = new Set(Array.from(this.servers.values()).map((s) => s.port));
    let port = BASE_PORT;
    while (usedPorts.has(port) && port < BASE_PORT + 100) {
      port++;
    }
    return port;
  }

  async _evictLRU() {
    // Find the server with fewest users, then oldest lastUsed
    let lru = null;
    for (const [path, server] of this.servers) {
      if (!lru || server.users < lru.users ||
          (server.users === lru.users && server.lastUsed < lru.lastUsed)) {
        lru = { path, ...server };
      }
    }
    if (lru) {
      await this.stopServer(lru.path);
    }
  }

  // --- Status ---

  getRunningServers() {
    return Array.from(this.servers.entries()).map(([modelPath, s]) => ({
      modelPath,
      port: s.port,
      users: s.users,
      ready: s.ready,
      uptime: Date.now() - s.startedAt,
      lastUsed: s.lastUsed,
    }));
  }

  getStatus() {
    return {
      installed: LlamaServerManager.isInstalled(),
      running: this.servers.size,
      maxServers: MAX_SERVERS,
      servers: this.getRunningServers(),
    };
  }
}
