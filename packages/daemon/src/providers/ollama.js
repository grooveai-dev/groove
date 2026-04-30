// GROOVE — Ollama Provider (Local Models)
// FSL-1.1-Apache-2.0 — see LICENSE

import { execSync, execFile, execFileSync } from 'child_process';
import os from 'os';
import { Provider } from './base.js';

// Comprehensive model catalog with RAM requirements
const MODEL_CATALOG = [
  // ── Code-Focused ──────────────────────────────────────────
  { id: 'qwen2.5-coder:7b', name: 'Qwen 2.5 Coder 7B', category: 'code', tier: 'medium', ramGb: 8, sizeGb: 4.7, description: 'Strong general coding' },
  { id: 'qwen2.5-coder:14b', name: 'Qwen 2.5 Coder 14B', category: 'code', tier: 'medium', ramGb: 16, sizeGb: 9.0, description: 'Advanced code reasoning' },
  { id: 'qwen2.5-coder:32b', name: 'Qwen 2.5 Coder 32B', category: 'code', tier: 'heavy', ramGb: 24, sizeGb: 20, description: 'Gold standard for local coding, rivals GPT-4o' },
  { id: 'qwen3-coder-next', name: 'Qwen3 Coder Next', category: 'code', tier: 'heavy', ramGb: 24, sizeGb: 18, description: 'Agentic coding optimized — tools, terminal, file systems' },
  { id: 'deepseek-r1:14b', name: 'DeepSeek R1 14B', category: 'code', tier: 'medium', ramGb: 12, sizeGb: 8.5, description: 'Chain-of-thought debugging, finds logic errors' },
  { id: 'deepseek-r1:32b', name: 'DeepSeek R1 32B', category: 'code', tier: 'heavy', ramGb: 24, sizeGb: 19, description: 'Deep reasoning powerhouse for complex debugging' },
  { id: 'deepseek-coder-v2:16b', name: 'DeepSeek Coder V2 16B', category: 'code', tier: 'medium', ramGb: 16, sizeGb: 8.9, description: 'MoE architecture, fast multi-language coding' },
  { id: 'codestral', name: 'Codestral 25.01 (25B)', category: 'code', tier: 'heavy', ramGb: 18, sizeGb: 14, description: 'Mistral flagship, best-in-class autocomplete/FIM' },
  { id: 'devstral-small-2', name: 'Devstral Small 2 (24B)', category: 'code', tier: 'heavy', ramGb: 18, sizeGb: 14, description: 'Mistral SE agent — multi-file edits, codebase exploration' },
  { id: 'phind-codellama', name: 'Phind CodeLlama 34B', category: 'code', tier: 'heavy', ramGb: 24, sizeGb: 19, description: 'Instruction-tuned for programming, Llama ecosystem' },
  { id: 'starcoder2:15b', name: 'StarCoder2 15B', category: 'code', tier: 'medium', ramGb: 16, sizeGb: 9.0, description: '600+ languages — COBOL, Fortran, DSLs' },
  { id: 'codegemma', name: 'CodeGemma 7B', category: 'code', tier: 'light', ramGb: 8, sizeGb: 5.0, description: 'Google lightweight — scripts, unit tests, laptop-friendly' },

  // ── General (Strong at Code) ──────────────────────────────
  { id: 'gemma4:26b', name: 'Gemma 4 26B', category: 'general', tier: 'heavy', ramGb: 16, sizeGb: 15, description: 'Google latest — top-tier Python/C++ reasoning' },
  { id: 'gemma4:12b', name: 'Gemma 4 12B', category: 'general', tier: 'medium', ramGb: 10, sizeGb: 7.5, description: 'Google mid-range, strong reasoning per watt' },
  { id: 'llama3.1:8b', name: 'Llama 3.1 8B', category: 'general', tier: 'medium', ramGb: 8, sizeGb: 4.7, description: 'Meta flagship, great all-rounder' },
  { id: 'llama3.1:70b', name: 'Llama 3.1 70B', category: 'general', tier: 'heavy', ramGb: 48, sizeGb: 40, description: 'Frontier-class open model' },
  { id: 'deepseek-r1:7b', name: 'DeepSeek R1 7B', category: 'general', tier: 'medium', ramGb: 8, sizeGb: 4.7, description: 'Compact reasoning model, think-before-respond' },
  { id: 'mistral:7b', name: 'Mistral 7B', category: 'general', tier: 'medium', ramGb: 8, sizeGb: 4.1, description: 'Fast and efficient' },
  { id: 'mixtral:8x7b', name: 'Mixtral 8x7B', category: 'general', tier: 'heavy', ramGb: 32, sizeGb: 26, description: 'MoE architecture, expert routing' },
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
      const cmd = process.platform === 'win32' ? 'where ollama' : 'which ollama';
      execSync(cmd, { stdio: 'ignore' });
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
    if (platform === 'win32') {
      return { command: 'winget install Ollama.Ollama', alt: 'Or download from https://ollama.ai/download', platform: 'Windows' };
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
    if (platform === 'win32') {
      try {
        let cmd = 'ollama';
        try {
          execSync('where ollama', { stdio: 'ignore' });
        } catch {
          const localAppData = process.env.LOCALAPPDATA || '';
          const fallback = localAppData + '\\Programs\\Ollama\\ollama.exe';
          cmd = fallback;
        }
        execFile(cmd, ['serve'], { stdio: 'ignore', detached: true, shell: true }).unref();
        return { started: true, method: 'ollama serve' };
      } catch {
        return { started: false, command: 'ollama serve' };
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

  static stopServer() {
    const platform = process.platform;
    if (platform === 'win32') {
      try {
        execSync('taskkill /IM ollama.exe /F', { stdio: 'ignore', timeout: 5000 });
        return { stopped: true, method: 'taskkill' };
      } catch {
        return { stopped: false };
      }
    }
    if (platform === 'darwin') {
      try {
        execSync('brew services stop ollama', { stdio: 'ignore', timeout: 10000 });
        return { stopped: true, method: 'brew services' };
      } catch { /* fall through */ }
    }
    // Kill ollama serve process
    try {
      execSync('pkill -f "ollama serve"', { stdio: 'ignore', timeout: 5000 });
      return { stopped: true, method: 'pkill' };
    } catch {
      // Also try killing by port
      try {
        execSync("lsof -ti:11434 | xargs kill", { stdio: 'ignore', timeout: 5000 });
        return { stopped: true, method: 'port-kill' };
      } catch {
        return { stopped: false };
      }
    }
  }

  static hardwareRequirements() {
    return {
      minRAM: 4,
      recommendedRAM: 16,
      gpuRecommended: true,
      note: process.platform === 'win32'
        ? 'NVIDIA or AMD GPUs recommended. Ensure GPU drivers are up to date.'
        : process.platform === 'darwin'
          ? 'Apple Silicon Macs use unified memory — all RAM is GPU RAM.'
          : 'NVIDIA GPUs recommended on Linux.',
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
    } else if (platform === 'linux' || platform === 'win32') {
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
      const output = execSync('ollama list', { encoding: 'utf8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] });
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

  static getRunningModels() {
    try {
      const output = execSync('ollama ps', { encoding: 'utf8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] });
      const lines = output.split('\n').slice(1).filter(Boolean);
      return lines.map((line) => {
        const parts = line.split(/\s+/);
        return {
          id: parts[0] || '',
          name: parts[0] || '',
          size: parts[1] || '',
          vram: parts[2] || '',
          processor: parts[3] || '',
          until: parts.slice(4).join(' ') || '',
        };
      });
    } catch {
      return [];
    }
  }

  static async loadModel(modelId) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    try {
      const res = await fetch('http://localhost:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelId, prompt: '', keep_alive: '10m' }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Ollama API ${res.status}: ${text.slice(0, 200)}`);
      }
      return { loaded: true, model: modelId };
    } catch (err) {
      clearTimeout(timeout);
      throw err;
    }
  }

  static async unloadModel(modelId) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const res = await fetch('http://localhost:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelId, prompt: '', keep_alive: 0 }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Ollama API ${res.status}: ${text.slice(0, 200)}`);
      }
      return { unloaded: true, model: modelId };
    } catch (err) {
      clearTimeout(timeout);
      throw err;
    }
  }

  static deleteModel(modelId) {
    try {
      execFileSync('ollama', ['rm', modelId], { encoding: 'utf8', timeout: 30000 });
      return true;
    } catch {
      return false;
    }
  }

  buildSpawnCommand(agent) {
    const model = agent.model || 'qwen2.5-coder:7b';
    const args = ['run', model];
    // Pass prompt via stdin to avoid OS arg length limits on long prompts
    return {
      command: 'ollama', args,
      env: { OLLAMA_API_BASE: 'http://localhost:11434' },
      stdin: agent.prompt || undefined,
    };
  }

  buildHeadlessCommand(prompt, model) {
    const m = model || 'qwen2.5-coder:7b';
    return { command: 'ollama', args: ['run', m], env: {}, stdin: prompt };
  }

  switchModel(agent, newModel) {
    return false; // Needs rotation for model switch
  }

  streamChat(messages, model, apiKey, onChunk, onDone, onError) {
    const controller = new AbortController();
    let finished = false;
    const finish = () => { if (!finished) { finished = true; onDone(); } };
    fetch('http://localhost:11434/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model || 'llama3.1:8b',
        messages,
        stream: true,
      }),
      signal: controller.signal,
    }).then(async (res) => {
      if (!res.ok) {
        const t = await res.text();
        throw new Error(`Ollama API ${res.status}: ${t.slice(0, 200)}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const json = JSON.parse(line);
            if (json.done) { finish(); return; }
            if (json.message?.content) onChunk(json.message.content);
          } catch { /* skip malformed */ }
        }
      }
      finish();
    }).catch((err) => {
      if (err.name === 'AbortError') return;
      onError(err);
    });
    return controller;
  }

  parseOutput(line) {
    const trimmed = line.trim();
    if (!trimmed) return null;
    return { type: 'activity', data: trimmed };
  }
}
