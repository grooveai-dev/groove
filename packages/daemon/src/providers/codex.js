// GROOVE — Codex Provider (OpenAI)
// FSL-1.1-Apache-2.0 — see LICENSE

import { execSync } from 'child_process';
import { Provider } from './base.js';

export class CodexProvider extends Provider {
  static name = 'codex';
  static displayName = 'Codex';
  static command = 'codex';
  static authType = 'api-key';
  static envKey = 'OPENAI_API_KEY';
  static models = [
    { id: 'o3', name: 'o3', tier: 'heavy' },
    { id: 'o4-mini', name: 'o4-mini', tier: 'medium' },
  ];

  static isInstalled() {
    try {
      execSync('which codex', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  static installCommand() {
    return 'npm i -g @openai/codex';
  }

  buildSpawnCommand(agent) {
    const args = [];

    if (agent.model) args.push('--model', agent.model);

    // Codex uses full-auto approval mode for autonomous operation
    args.push('--approval-mode', 'full-auto');

    if (agent.prompt) args.push(agent.prompt);

    return {
      command: 'codex',
      args,
      env: agent.apiKey ? { OPENAI_API_KEY: agent.apiKey } : {},
    };
  }

  buildHeadlessCommand(prompt, model) {
    const args = ['exec', prompt];
    if (model) args.push('--model', model);
    return { command: 'codex', args, env: {} };
  }

  switchModel() {
    return false; // Codex doesn't support mid-session model switch
  }

  parseOutput(line) {
    // Codex outputs plain text by default
    const trimmed = line.trim();
    if (!trimmed) return null;

    return {
      type: 'activity',
      data: trimmed,
    };
  }
}
