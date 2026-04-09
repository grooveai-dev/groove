// GROOVE — Ollama Provider (Local Models)
// FSL-1.1-Apache-2.0 — see LICENSE

import { execSync } from 'child_process';
import { Provider } from './base.js';

export class OllamaProvider extends Provider {
  static name = 'ollama';
  static displayName = 'Ollama (Local)';
  static command = 'ollama';
  static authType = 'local';
  static models = [
    { id: 'qwen2.5-coder:32b', name: 'Qwen 2.5 Coder 32B', tier: 'heavy' },
    { id: 'qwen2.5-coder:7b', name: 'Qwen 2.5 Coder 7B', tier: 'medium' },
    { id: 'codellama:13b', name: 'Code Llama 13B', tier: 'medium' },
    { id: 'deepseek-coder-v2:16b', name: 'DeepSeek Coder V2', tier: 'medium' },
  ];

  static isInstalled() {
    try {
      execSync('which ollama', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  static installCommand() {
    return 'curl -fsSL https://ollama.ai/install.sh | sh';
  }

  static hardwareRequirements() {
    return {
      minRAM: 8,
      recommendedRAM: 16,
      gpuRecommended: true,
      note: '7B models need ~8GB RAM, 32B models need ~24GB RAM',
    };
  }

  static getInstalledModels() {
    try {
      const output = execSync('ollama list', { encoding: 'utf8' });
      const lines = output.split('\n').slice(1).filter(Boolean);
      return lines.map((line) => {
        const parts = line.split(/\s+/);
        return { name: parts[0], size: parts[1] };
      });
    } catch {
      return [];
    }
  }

  buildSpawnCommand(agent) {
    const model = agent.model || 'qwen2.5-coder:7b';
    const args = ['run', model];

    if (agent.prompt) {
      args.push(agent.prompt);
    }

    return {
      command: 'ollama',
      args,
      env: { OLLAMA_API_BASE: 'http://localhost:11434' },
    };
  }

  buildHeadlessCommand(prompt, model) {
    const m = model || 'qwen2.5-coder:7b';
    return {
      command: 'ollama',
      args: ['run', m, prompt],
      env: {},
    };
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
