// GROOVE — Model Manager (HuggingFace + Local GGUF Storage)
// FSL-1.1-Apache-2.0 — see LICENSE
//
// Manages local model storage, HuggingFace integration for searching/downloading
// GGUF models, and metadata indexing. Models live in ~/.groove/models/.

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, statSync, createWriteStream } from 'fs';
import { resolve, basename } from 'path';
import { homedir } from 'os';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';

const MODELS_DIR = resolve(homedir(), '.groove', 'models');
const INDEX_PATH = resolve(MODELS_DIR, 'models.json');

// Known context windows for popular model families
const CONTEXT_WINDOWS = {
  'qwen2.5-coder': 32768,
  'qwen3': 32768,
  'deepseek': 65536,
  'llama': 131072,
  'mistral': 32768,
  'codestral': 32768,
  'gemma': 32768,
  'phi': 128000,
  'starcoder': 8192,
};

// Approximate RAM requirements per billion parameters at different quantization levels
const RAM_PER_BILLION = {
  Q2_K: 0.5, Q3_K_S: 0.55, Q3_K_M: 0.6, Q3_K_L: 0.65,
  Q4_0: 0.7, Q4_K_S: 0.75, Q4_K_M: 0.8,
  Q5_0: 0.85, Q5_K_S: 0.9, Q5_K_M: 0.95,
  Q6_K: 1.05, Q8_0: 1.2,
  F16: 2.0, F32: 4.0,
};

export class ModelManager {
  constructor(daemon) {
    this.daemon = daemon;
    this.modelsDir = MODELS_DIR;
    this.indexPath = INDEX_PATH;
    this.downloads = new Map(); // filename -> { progress, controller, ... }
    this.index = { models: [] };

    mkdirSync(this.modelsDir, { recursive: true });
    this.load();
  }

  // --- Index Persistence ---

  load() {
    if (existsSync(this.indexPath)) {
      try {
        this.index = JSON.parse(readFileSync(this.indexPath, 'utf8'));
        if (!Array.isArray(this.index.models)) this.index.models = [];
      } catch {
        this.index = { models: [] };
      }
    }
  }

  save() {
    writeFileSync(this.indexPath, JSON.stringify(this.index, null, 2));
  }

  // --- HuggingFace API ---

  async search(query, { limit = 20, sort = 'downloads' } = {}) {
    const params = new URLSearchParams({
      search: query,
      sort,
      direction: '-1',
      limit: String(limit),
    });

    const res = await fetch(`https://huggingface.co/api/models?${params}`, {
      headers: { 'User-Agent': 'GROOVE-ModelManager/1.0' },
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) throw new Error(`HuggingFace API error: ${res.status}`);
    const models = await res.json();

    return models.map((m) => {
      const id = m.modelId || m.id;
      const tags = m.tags || [];
      return {
        id,
        name: id.split('/').pop() || id,
        author: id.split('/')[0] || '',
        downloads: m.downloads || 0,
        likes: m.likes || 0,
        tags,
        lastModified: m.lastModified,
        recommendedRuntimes: inferRuntimes(id, tags),
      };
    });
  }

  async getModelFiles(repoId) {
    const res = await fetch(`https://huggingface.co/api/models/${repoId}`, {
      headers: { 'User-Agent': 'GROOVE-ModelManager/1.0' },
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) throw new Error(`Model not found: ${repoId}`);
    const data = await res.json();

    const files = (data.siblings || [])
      .filter((f) => f.rfilename.endsWith('.gguf'))
      .map((f) => {
        const filename = f.rfilename;
        const quant = parseQuantization(filename);
        const params = parseParameters(filename);
        return {
          filename,
          size: f.size || 0,
          quantization: quant,
          parameters: params,
          estimatedRamGb: estimateRam(params, quant),
        };
      })
      .sort((a, b) => a.size - b.size);

    return {
      repoId,
      name: data.modelId?.split('/').pop() || repoId,
      author: data.modelId?.split('/')[0] || '',
      files,
    };
  }

  // --- Download Management ---

  async download(repoId, filename, onProgress) {
    if (this.downloads.has(filename)) {
      throw new Error(`Already downloading: ${filename}`);
    }

    const url = `https://huggingface.co/${repoId}/resolve/main/${filename}`;
    const destPath = resolve(this.modelsDir, filename);
    const tempPath = destPath + '.part';
    const controller = new AbortController();

    // Check for partial download (resume support)
    let startByte = 0;
    if (existsSync(tempPath)) {
      try { startByte = statSync(tempPath).size; } catch { startByte = 0; }
    }

    const headers = { 'User-Agent': 'GROOVE-ModelManager/1.0' };
    if (startByte > 0) {
      headers.Range = `bytes=${startByte}-`;
    }

    const downloadState = {
      filename,
      repoId,
      downloaded: startByte,
      totalBytes: 0,
      percent: 0,
      speed: 0,
      startedAt: Date.now(),
      controller,
    };
    this.downloads.set(filename, downloadState);

    try {
      const res = await fetch(url, { headers, signal: controller.signal });

      if (!res.ok && res.status !== 206) {
        throw new Error(`Download failed: HTTP ${res.status}`);
      }

      const contentLength = Number(res.headers.get('content-length') || 0);
      const totalBytes = startByte + contentLength;
      downloadState.totalBytes = totalBytes;

      const fileStream = createWriteStream(tempPath, {
        flags: startByte > 0 ? 'a' : 'w',
      });

      let lastProgressTime = Date.now();
      let lastProgressBytes = startByte;

      // Stream the download with progress tracking
      const reader = res.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        fileStream.write(Buffer.from(value));
        downloadState.downloaded += value.length;
        downloadState.percent = totalBytes > 0 ? downloadState.downloaded / totalBytes : 0;

        // Calculate speed every 500ms
        const now = Date.now();
        if (now - lastProgressTime > 500) {
          const elapsed = (now - lastProgressTime) / 1000;
          downloadState.speed = (downloadState.downloaded - lastProgressBytes) / elapsed;
          lastProgressTime = now;
          lastProgressBytes = downloadState.downloaded;

          if (onProgress) onProgress({ ...downloadState });

          // Broadcast progress to GUI
          this.daemon?.broadcast({
            type: 'model:download:progress',
            data: {
              filename, repoId,
              downloaded: downloadState.downloaded,
              totalBytes, percent: downloadState.percent,
              speed: downloadState.speed,
            },
          });
        }
      }

      await new Promise((res, rej) => {
        fileStream.end(() => res());
        fileStream.on('error', rej);
      });

      // Rename .part to final filename
      const { renameSync } = await import('fs');
      renameSync(tempPath, destPath);

      // Index the model
      const quant = parseQuantization(filename);
      const params = parseParameters(filename);
      const contextWindow = guessContextWindow(filename);

      const modelEntry = {
        id: filename.replace('.gguf', ''),
        filename,
        repoId,
        parameters: params,
        quantization: quant,
        contextWindow,
        sizeBytes: totalBytes,
        category: filename.toLowerCase().includes('code') ? 'code' : 'general',
        tier: classifyTier(params, quant),
        downloadedAt: new Date().toISOString(),
      };

      // Remove existing entry if re-downloading
      this.index.models = this.index.models.filter((m) => m.filename !== filename);
      this.index.models.push(modelEntry);
      this.save();

      this.downloads.delete(filename);

      this.daemon?.broadcast({
        type: 'model:download:complete',
        data: { filename, repoId, model: modelEntry },
      });

      return modelEntry;
    } catch (err) {
      this.downloads.delete(filename);
      if (err.name === 'AbortError') {
        this.daemon?.broadcast({ type: 'model:download:cancelled', data: { filename } });
        return null;
      }
      this.daemon?.broadcast({ type: 'model:download:error', data: { filename, error: err.message } });
      throw err;
    }
  }

  cancelDownload(filename) {
    const download = this.downloads.get(filename);
    if (download) {
      download.controller.abort();
      this.downloads.delete(filename);
      return true;
    }
    return false;
  }

  getActiveDownloads() {
    return Array.from(this.downloads.values()).map((d) => ({
      filename: d.filename,
      repoId: d.repoId,
      downloaded: d.downloaded,
      totalBytes: d.totalBytes,
      percent: d.percent,
      speed: d.speed,
    }));
  }

  // --- Installed Model Management ---

  getInstalled() {
    return this.index.models.map((m) => ({
      ...m,
      exists: existsSync(resolve(this.modelsDir, m.filename)),
    }));
  }

  getModel(id) {
    return this.index.models.find((m) => m.id === id || m.filename === id) || null;
  }

  getModelPath(id) {
    const model = this.getModel(id);
    if (!model) return null;
    const p = resolve(this.modelsDir, model.filename);
    return existsSync(p) ? p : null;
  }

  deleteModel(id) {
    const model = this.getModel(id);
    if (!model) return false;

    const p = resolve(this.modelsDir, model.filename);
    if (existsSync(p)) {
      try { unlinkSync(p); } catch { /* ignore */ }
    }

    // Also remove .part files
    const partPath = p + '.part';
    if (existsSync(partPath)) {
      try { unlinkSync(partPath); } catch { /* ignore */ }
    }

    this.index.models = this.index.models.filter((m) => m.id !== model.id);
    this.save();
    return true;
  }

  // --- Hardware Recommendations ---

  recommendQuantization(modelParams, availableRamGb) {
    // Try quantizations from best quality to most compressed
    const preferences = ['Q8_0', 'Q6_K', 'Q5_K_M', 'Q5_K_S', 'Q4_K_M', 'Q4_K_S', 'Q3_K_M', 'Q2_K'];
    const params = parseParamsBillions(modelParams);
    if (!params) return 'Q4_K_M'; // Safe default

    for (const quant of preferences) {
      const ramNeeded = params * (RAM_PER_BILLION[quant] || 1) + 1; // +1GB overhead
      if (ramNeeded <= availableRamGb * 0.85) { // Leave 15% headroom
        return quant;
      }
    }
    return 'Q2_K'; // Smallest if nothing else fits
  }

  getStatus() {
    return {
      modelsDir: this.modelsDir,
      installedCount: this.index.models.length,
      activeDownloads: this.downloads.size,
    };
  }
}

// --- Parsing Utilities ---

function parseQuantization(filename) {
  const lower = filename.toLowerCase();
  const patterns = [
    /[_-](q[2-8]_k_[sml])/i,
    /[_-](q[2-8]_k)/i,
    /[_-](q[2-8]_0)/i,
    /[_-](f16)/i,
    /[_-](f32)/i,
    /[_-](iq[1-4]_[a-z]+)/i,
  ];
  for (const p of patterns) {
    const match = lower.match(p);
    if (match) return match[1].toUpperCase();
  }
  return null;
}

function parseParameters(filename) {
  const match = filename.match(/(\d+\.?\d*)[bB]/);
  if (match) return `${match[1]}B`;
  // Try word forms
  if (/7b/i.test(filename)) return '7B';
  if (/14b/i.test(filename)) return '14B';
  if (/32b/i.test(filename)) return '32B';
  if (/70b/i.test(filename)) return '70B';
  return null;
}

function parseParamsBillions(paramStr) {
  if (!paramStr) return null;
  const match = paramStr.match(/([\d.]+)/);
  return match ? parseFloat(match[1]) : null;
}

function estimateRam(params, quant) {
  const billions = parseParamsBillions(params);
  if (!billions || !quant) return null;
  const perB = RAM_PER_BILLION[quant] || RAM_PER_BILLION.Q4_K_M;
  return Math.round((billions * perB + 1) * 10) / 10; // +1GB overhead, round to 1 decimal
}

function guessContextWindow(filename) {
  const lower = filename.toLowerCase();
  for (const [prefix, ctx] of Object.entries(CONTEXT_WINDOWS)) {
    if (lower.includes(prefix)) return ctx;
  }
  return 32768; // Safe default
}

function classifyTier(params, quant) {
  const billions = parseParamsBillions(params);
  if (!billions) return 'medium';
  if (billions >= 25) return 'heavy';
  if (billions >= 10) return 'medium';
  return 'light';
}

function inferRuntimes(repoId, tags) {
  const lower = repoId.toLowerCase();
  const tagSet = new Set(tags.map((t) => t.toLowerCase()));
  const runtimes = new Set();

  // GGUF → llama.cpp and (implicitly) Ollama
  if (tagSet.has('gguf') || lower.includes('-gguf') || lower.includes('_gguf')) {
    runtimes.add('llama.cpp');
  }

  // MLX-optimized models
  if (tagSet.has('mlx') || lower.includes('-mlx') || lower.includes('_mlx')) {
    runtimes.add('MLX');
  }

  // GPTQ / AWQ quantized → vLLM handles these well
  if (tagSet.has('gptq') || tagSet.has('awq') || lower.includes('-gptq') || lower.includes('-awq')) {
    runtimes.add('vLLM');
  }

  // SafeTensors / standard transformer weights → vLLM, TGI, MLX
  if (tagSet.has('safetensors') || tagSet.has('transformers')) {
    runtimes.add('vLLM');
    runtimes.add('TGI');
    if (!runtimes.has('MLX')) runtimes.add('MLX');
  }

  // If nothing matched, infer from general model traits
  if (runtimes.size === 0) {
    if (tagSet.has('pytorch') || tagSet.has('tf') || tagSet.has('jax')) {
      runtimes.add('vLLM');
      runtimes.add('TGI');
    }
  }

  return [...runtimes];
}
