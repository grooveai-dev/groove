// GROOVE — Ollama Provider (Local Models)
// FSL-1.1-Apache-2.0 — see LICENSE

import { execSync } from 'child_process';
import { execFile } from 'child_process';
import os from 'os';
import { Provider } from './base.js';

// Comprehensive model catalog with RAM requirements
const MODEL_CATALOG = [
  // ── Code-Focused ──────────────────────────────────────────
  { id: 'qwen2.5-coder:0.5b', name: 'Qwen 2.5 Coder 0.5B', category: 'code', tier: 'light', ramGb: 1, sizeGb: 0.4, description: 'Ultra-light code completion' },
  { id: 'qwen2.5-coder:1.5b', name: 'Qwen 2.5 Coder 1.5B', category: 'code', tier: 'light', ramGb: 2, sizeGb: 1.0, description: 'Fast code assistant' },
  { id: 'qwen2.5-coder:3b', name: 'Qwen 2.5 Coder 3B', category: 'code', tier: 'light', ramGb: 4, sizeGb: 1.9, description: 'Balanced speed and quality' },
  { id: 'qwen2.5-coder:7b', name: 'Qwen 2.5 Coder 7B', category: 'code', tier: 'medium', ramGb: 8, sizeGb: 4.7, description: 'Strong general coding' },
  { id: 'qwen2.5-coder:14b', name: 'Qwen 2.5 Coder 14B', category: 'code', tier: 'medium', ramGb: 16, sizeGb: 9.0, description: 'Advanced code reasoning' },
  { id: 'qwen2.5-coder:32b', name: 'Qwen 2.5 Coder 32B', category: 'code', tier: 'heavy', ramGb: 24, sizeGb: 20, description: 'Best-in-class code generation' },
  { id: 'codellama:7b', name: 'Code Llama 7B', category: 'code', tier: 'medium', ramGb: 8, sizeGb: 3.8, description: 'Meta code model, solid baseline' },
  { id: 'codellama:13b', name: 'Code Llama 13B', category: 'code', tier: 'medium', ramGb: 16, sizeGb: 7.4, description: 'Stronger code reasoning' },
  { id: 'codellama:34b', name: 'Code Llama 34B', category: 'code', tier: 'heavy', ramGb: 24, sizeGb: 19, description: 'Largest Code Llama' },
  { id: 'deepseek-coder-v2:16b', name: 'DeepSeek Coder V2 16B', category: 'code', tier: 'medium', ramGb: 16, sizeGb: 8.9, description: 'Strong multi-language coding' },
  { id: 'starcoder2:3b', name: 'StarCoder2 3B', category: 'code', tier: 'light', ramGb: 4, sizeGb: 1.7, description: 'Code completion specialist' },
  { id: 'starcoder2:7b', name: 'StarCoder2 7B', category: 'code', tier: 'medium', ramGb: 8, sizeGb: 4.0, description: 'Solid code generation' },
  { id: 'starcoder2:15b', name: 'StarCoder2 15B', category: 'code', tier: 'medium', ramGb: 16, sizeGb: 9.0, description: 'Best StarCoder variant' },

  // ── General (Strong at Code) ──────────────────────────────
  { id: 'llama3.1:8b', name: 'Llama 3.1 8B', category: 'general', tier: 'medium', ramGb: 8, sizeGb: 4.7, description: 'Meta flagship, great all-rounder' },
  { id: 'llama3.1:70b', name: 'Llama 3.1 70B', category: 'general', tier: 'heavy', ramGb: 48, sizeGb: 40, description: 'Frontier-class open model' },
  { id: 'mistral:7b', name: 'Mistral 7B', category: 'general', tier: 'medium', ramGb: 8, sizeGb: 4.1, description: 'Fast and efficient' },
  { id: 'mixtral:8x7b', name: 'Mixtral 8x7B', category: 'general', tier: 'heavy', ramGb: 32, sizeGb: 26, description: 'MoE architecture, expert routing' },
  { id: 'gemma2:2b', name: 'Gemma 2 2B', category: 'general', tier: 'light', ramGb: 2, sizeGb: 1.6, description: 'Google lightweight model' },
  { id: 'gemma2:9b', name: 'Gemma 2 9B', category: 'general', tier: 'medium', ramGb: 8, sizeGb: 5.4, description: 'Google mid-range model' },
  { id: 'gemma2:27b', name: 'Gemma 2 27B', category: 'general', tier: 'heavy', ramGb: 20, sizeGb: 16, description: 'Google large model' },
  { id: 'phi3:mini', name: 'Phi-3 Mini 3.8B', category: 'general', tier: 'light', ramGb: 4, sizeGb: 2.3, description: 'Microsoft small but capable' },
  { id: 'phi3:medium', name: 'Phi-3 Medium 14B', category: 'general', tier: 'medium', ramGb: 16, sizeGb: 7.9, description: 'Microsoft mid-range' },
];

export class OllamaProvider extends Provider {
  static name = 'ollama';
  static displayName = 'Ollama (Local)';
  static command = 'ollama';
  static authType = 'local';

  // Models exposed to the spawn wizard / provider listing
  static get models() {
    return MODEL_CATALOG.map(({ id, name, tier }) => ({ id, name, tier }));
  }

  // Full catalog with RAM/size/description for the setup UI
  static get catalog() {
    return MODEL_CATALOG;
  }

  static isInstalled() {
    try {
      execSync('which ollama', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  static installCommand() {
    const platform = process.platform;
    if (platform === 'darwin') {
      return { command: 'brew install ollama', alt: 'Or download from https://ollama.ai/download', platform: 'macOS' };
    }
    if (platform === 'linux') {
      return { command: 'curl -fsSL https://ollama.ai/install.sh | sh', platform: 'Linux' };
    }
    return { command: 'Download from https://ollama.ai/download', platform: 'other' };
  }

  static async isServerRunning() {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const res = await fetch('http://localhost:11434/', { signal: controller.signal });
      clearTimeout(timeout);
      return res.ok;
    } catch {
      return false;
    }
  }

  static startServer() {
    const platform = process.platform;
    if (platform === 'darwin') {
      // Try brew services first, fall back to ollama serve
      try {
        execSync('brew services start ollama', { stdio: 'ignore', timeout: 10000 });
        return { started: true, method: 'brew services' };
      } catch {
        try {
          execFile('ollama', ['serve'], { stdio: 'ignore', detached: true }).unref();
          return { started: true, method: 'ollama serve' };
        } catch {
          return { started: false, command: 'ollama serve' };
        }
      }
    }
    // Linux / other
    try {
      execFile('ollama', ['serve'], { stdio: 'ignore', detached: true }).unref();
      return { started: true, method: 'ollama serve' };
    } catch {
      return { started: false, command: 'ollama serve' };
    }
  }

  static hardwareRequirements() {
    return {
      minRAM: 4,
      recommendedRAM: 16,
      gpuRecommended: true,
      note: 'Apple Silicon Macs use unified memory — all RAM is GPU RAM. NVIDIA GPUs recommended on Linux.',
    };
  }

  static getSystemHardware() {
    const totalRamGb = Math.round(os.totalmem() / (1024 ** 3));
    const cpus = os.cpus();
    const cpuModel = cpus[0]?.model || 'Unknown';
    const cores = cpus.length;
    const platform = process.platform;
    const arch = os.arch();
    const isAppleSilicon = platform === 'darwin' && arch === 'arm64';

    let gpu = null;
    if (isAppleSilicon) {
      gpu = { type: 'apple-silicon', name: cpuModel.replace(/Apple /g, ''), vram: totalRamGb, note: 'Unified memory — all RAM available to GPU' };
    } else if (platform === 'linux') {
      try {
        const out = execSync('nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits', { encoding: 'utf8', timeout: 5000 });
        const [name, vram] = out.trim().split(', ');
        gpu = { type: 'nvidia', name, vram: Math.round(parseInt(vram, 10) / 1024) };
      } catch {
        gpu = null;
      }
    }

    // Recommend models based on available RAM
    const recommended = MODEL_CATALOG
      .filter((m) => m.ramGb <= totalRamGb)
      .sort((a, b) => b.ramGb - a.ramGb);

    const bestCodeModel = recommended.find((m) => m.category === 'code');
    const bestGeneralModel = recommended.find((m) => m.category === 'general');

    return {
      totalRamGb,
      cpuModel,
      cores,
      platform,
      arch,
      isAppleSilicon,
      gpu,
      recommended: { code: bestCodeModel?.id || null, general: bestGeneralModel?.id || null },
      maxModelRam: totalRamGb,
    };
  }

  static getInstalledModels() {
    try {
      const output = execSync('ollama list', { encoding: 'utf8', timeout: 10000 });
      const lines = output.split('\n').slice(1).filter(Boolean);
      return lines.map((line) => {
        const parts = line.split(/\s+/);
        const name = parts[0];
        const size = parts[2] || parts[1] || '';
        // Match against catalog for metadata
        const catalogEntry = MODEL_CATALOG.find((m) => name.startsWith(m.id.split(':')[0]));
        return { id: name, name, size, category: catalogEntry?.category || 'other', tier: catalogEntry?.tier || 'medium' };
      });
    } catch {
      return [];
    }
  }

  static pullModel(modelId, onProgress) {
    return new Promise((resolve, reject) => {
      const child = execFile('ollama', ['pull', modelId], { timeout: 600000 }, (err) => {
        if (err) reject(err);
        else resolve({ success: true, model: modelId });
      });
      if (child.stderr && onProgress) {
        child.stderr.on('data', (data) => onProgress(data.toString()));
      }
      if (child.stdout && onProgress) {
        child.stdout.on('data', (data) => onProgress(data.toString()));
      }
    });
  }

  static deleteModel(modelId) {
    try {
      execSync(`ollama rm ${modelId}`, { encoding: 'utf8', timeout: 30000 });
      return true;
    } catch {
      return false;
    }
  }

  buildSpawnCommand(agent) {
    const model = agent.model || 'qwen2.5-coder:7b';
    const args = ['run', model];
    if (agent.prompt) args.push(agent.prompt);
    return { command: 'ollama', args, env: { OLLAMA_API_BASE: 'http://localhost:11434' } };
  }

  buildHeadlessCommand(prompt, model) {
    const m = model || 'qwen2.5-coder:7b';
    return { command: 'ollama', args: ['run', m, prompt], env: {} };
  }

  switchModel(agent, newModel) {
    return false; // Needs rotation for model switch
  }

  parseOutput(line) {
    const trimmed = line.trim();
    if (!trimmed) return null;
    return { type: 'activity', data: trimmed };
  }
}
