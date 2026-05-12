// GROOVE — MLX Server Manager
// FSL-1.1-Apache-2.0 — see LICENSE
//
// Manages mlx_lm.server inference server instances on Apple Silicon.
// Scans ~/.cache/huggingface/hub/ for cached MLX models.
// Mirrors LlamaServerManager API: ensureServer, stopServer, getStatus.

import { spawn, execSync } from 'child_process';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';

const BASE_PORT = 8080;
const MAX_SERVERS = 3;
const HEALTH_TIMEOUT = 60000; // 60s — MLX may need to load model into memory
const HEALTH_POLL_INTERVAL = 1000;
const IDLE_TIMEOUT = 300000; // 5 minutes

const HF_CACHE_DIR = resolve(homedir(), '.cache', 'huggingface', 'hub');
const HF_MODEL_DIR_PREFIX = 'models--';

export class MLXServerManager {
  constructor(daemon) {
    this.daemon = daemon;
    this.servers = new Map(); // modelId -> { proc, port, users, startedAt, lastUsed, ready }
  }

  static isInstalled() {
    try {
      execSync('python3 -c "import mlx_lm; print(mlx_lm.__version__)"', {
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 10000,
      });
      return true;
    } catch {
      return false;
    }
  }

  static getVersion() {
    try {
      const out = execSync('python3 -c "import mlx_lm; print(mlx_lm.__version__)"', {
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 10000,
      });
      return out.toString().trim();
    } catch {
      return null;
    }
  }

  static getPythonPath() {
    // Check venv first, then system python
    const venvPython = resolve(homedir(), '.mlx-env', 'bin', 'python3');
    if (existsSync(venvPython)) {
      try {
        execSync(`${venvPython} -c "import mlx_lm"`, { stdio: 'ignore', timeout: 10000 });
        return venvPython;
      } catch { /* fall through */ }
    }
    try {
      execSync('python3 -c "import mlx_lm"', { stdio: 'ignore', timeout: 10000 });
      return 'python3';
    } catch {
      return null;
    }
  }

  // --- Model Scanning ---

  static scanModels() {
    const models = [];
    if (!existsSync(HF_CACHE_DIR)) return models;

    try {
      const entries = readdirSync(HF_CACHE_DIR);
      for (const entry of entries) {
        if (!entry.startsWith(HF_MODEL_DIR_PREFIX)) continue;

        const modelName = entry.slice(HF_MODEL_DIR_PREFIX.length).replace(/--/g, '/');
        const snapshotsDir = resolve(HF_CACHE_DIR, entry, 'snapshots');
        if (!existsSync(snapshotsDir)) continue;

        let snapshotDir = null;
        try {
          const snapshots = readdirSync(snapshotsDir);
          if (snapshots.length === 0) continue;
          snapshotDir = resolve(snapshotsDir, snapshots[snapshots.length - 1]);
        } catch { continue; }

        let hasWeights = false;
        let hasNpz = false;
        let configData = null;
        try {
          const files = readdirSync(snapshotDir);
          hasWeights = files.some((f) =>
            f.endsWith('.safetensors') || f.endsWith('.npz') || f === 'weights.npz'
          );
          if (!hasWeights) continue;
          hasNpz = files.some((f) => f.endsWith('.npz'));

          const configPath = resolve(snapshotDir, 'config.json');
          if (existsSync(configPath)) {
            configData = JSON.parse(readFileSync(configPath, 'utf8'));
          }
        } catch { continue; }

        const isMLX = isMLXModel(modelName, hasNpz, configData);
        const type = isMLX ? 'mlx' : 'hf';
        const prefix = isMLX ? 'mlx:' : 'hf:';
        const shortName = modelName.split('/').pop() || modelName;
        const params = parseMLXParams(shortName, configData);
        const quant = parseMLXQuantization(shortName);

        models.push({
          id: `${prefix}${modelName}`,
          modelId: modelName,
          filename: shortName,
          type,
          compatibleBackends: isMLX ? ['mlx'] : ['vllm', 'tgi'],
          parameters: params,
          quantization: quant,
          snapshotPath: snapshotDir,
          cachedAt: entry,
        });
      }
    } catch { /* best effort */ }

    return models;
  }

  // --- Server Lifecycle ---

  async ensureServer(modelId, options = {}) {
    if (this.servers.has(modelId)) {
      const server = this.servers.get(modelId);
      server.users++;
      server.lastUsed = Date.now();
      return `http://127.0.0.1:${server.port}`;
    }

    if (this.servers.size >= MAX_SERVERS) {
      await this._evictLRU();
    }

    const pythonPath = MLXServerManager.getPythonPath();
    if (!pythonPath) {
      throw new Error('mlx_lm not installed — run: pip3 install "mlx-lm[server]"');
    }

    const port = this._allocatePort();

    const args = [
      '-m', 'mlx_lm.server',
      '--model', modelId,
      '--port', String(port),
    ];

    const proc = spawn(pythonPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });

    if (!proc.pid) {
      throw new Error('Failed to start mlx_lm.server — check installation');
    }

    const server = {
      proc,
      port,
      modelId,
      users: 1,
      startedAt: Date.now(),
      lastUsed: Date.now(),
      ready: false,
    };

    this.servers.set(modelId, server);

    const stderrBuf = [];
    proc.stderr.on('data', (chunk) => {
      stderrBuf.push(chunk.toString());
      if (stderrBuf.join('').length > 4096) stderrBuf.shift();
    });

    proc.on('exit', (code, signal) => {
      this.servers.delete(modelId);
      this.daemon?.broadcast({
        type: 'mlx:server:stopped',
        data: { modelId, port, code, signal },
      });
    });

    try {
      await this._waitForHealth(port);
      server.ready = true;

      this.daemon?.broadcast({
        type: 'mlx:server:ready',
        data: { modelId, port },
      });

      return `http://127.0.0.1:${port}`;
    } catch (err) {
      await this.stopServer(modelId);
      const stderr = stderrBuf.join('').slice(-500);
      throw new Error(`mlx_lm.server failed to start: ${stderr || err.message}`);
    }
  }

  releaseServer(modelId) {
    const server = this.servers.get(modelId);
    if (!server) return;

    server.users = Math.max(0, server.users - 1);
    server.lastUsed = Date.now();

    if (server.users === 0) {
      setTimeout(() => {
        const s = this.servers.get(modelId);
        if (s && s.users === 0 && Date.now() - s.lastUsed >= IDLE_TIMEOUT) {
          this.stopServer(modelId);
        }
      }, IDLE_TIMEOUT + 1000);
    }
  }

  async stopServer(modelId) {
    const server = this.servers.get(modelId);
    if (!server) return false;

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        try { server.proc.kill('SIGKILL'); } catch {}
      }, 5000);

      server.proc.on('exit', () => {
        clearTimeout(timeout);
        this.servers.delete(modelId);
        resolve(true);
      });

      try {
        server.proc.kill('SIGTERM');
      } catch {
        clearTimeout(timeout);
        this.servers.delete(modelId);
        resolve(true);
      }
    });
  }

  async stopAll() {
    const ids = Array.from(this.servers.keys());
    await Promise.all(ids.map((id) => this.stopServer(id)));
  }

  // --- Health Check ---

  async _waitForHealth(port) {
    const start = Date.now();
    while (Date.now() - start < HEALTH_TIMEOUT) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/v1/models`, {
          signal: AbortSignal.timeout(2000),
        });
        if (res.ok) return true;
      } catch { /* server still loading */ }
      await new Promise((r) => setTimeout(r, HEALTH_POLL_INTERVAL));
    }
    throw new Error(`mlx_lm.server health check timed out after ${HEALTH_TIMEOUT / 1000}s`);
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
    let lru = null;
    for (const [id, server] of this.servers) {
      if (!lru || server.users < lru.users ||
          (server.users === lru.users && server.lastUsed < lru.lastUsed)) {
        lru = { id, ...server };
      }
    }
    if (lru) {
      await this.stopServer(lru.id);
    }
  }

  // --- Status ---

  getRunningServers() {
    return Array.from(this.servers.entries()).map(([modelId, s]) => ({
      modelId,
      port: s.port,
      users: s.users,
      ready: s.ready,
      uptime: Date.now() - s.startedAt,
      lastUsed: s.lastUsed,
    }));
  }

  getStatus() {
    return {
      installed: MLXServerManager.isInstalled(),
      version: MLXServerManager.getVersion(),
      running: this.servers.size,
      maxServers: MAX_SERVERS,
      servers: this.getRunningServers(),
      cachedModels: MLXServerManager.scanModels().length,
    };
  }
}

// --- Format Detection ---

function isMLXModel(modelName, hasNpz, configData) {
  if (modelName.startsWith('mlx-community/')) return true;
  if (hasNpz) return true;
  if (/[-_]mlx[-_]/i.test(modelName) || modelName.toLowerCase().endsWith('-mlx')) return true;
  if (configData?.quantization_config?.quant_method === 'mlx') return true;
  return false;
}

// --- Parsing Utilities ---

function parseMLXParams(name, config) {
  // Try config.json first
  if (config) {
    const hidden = config.hidden_size;
    const layers = config.num_hidden_layers;
    const vocab = config.vocab_size;
    if (hidden && layers) {
      const approx = (hidden * layers * vocab * 4) / 1e9;
      if (approx > 0.1) {
        if (approx < 1.5) return '0.5-1B';
        if (approx < 5) return `${Math.round(approx)}B`;
        if (approx < 10) return `${Math.round(approx)}B`;
        return `${Math.round(approx)}B`;
      }
    }
  }

  // Fallback: parse from name
  const match = name.match(/(\d+\.?\d*)[bB]/);
  if (match) return `${match[1]}B`;
  return null;
}

function parseMLXQuantization(name) {
  const lower = name.toLowerCase();
  if (lower.includes('8bit') || lower.includes('8-bit')) return 'W8';
  if (lower.includes('4bit') || lower.includes('4-bit')) return 'W4';
  if (lower.includes('3bit') || lower.includes('3-bit')) return 'W3';
  if (lower.includes('bf16') || lower.includes('fp16')) return 'FP16';
  return null;
}
