// GROOVE — Gemini CLI Provider (Google)
// FSL-1.1-Apache-2.0 — see LICENSE

import { execSync } from 'child_process';
import { Provider } from './base.js';

export class GeminiProvider extends Provider {
  static name = 'gemini';
  static displayName = 'Gemini CLI';
  static command = 'gemini';
  static authType = 'api-key';
  static envKey = 'GEMINI_API_KEY';
  static models = [
    { id: 'gemini-3.0-pro', name: 'Gemini 3.0 Pro', tier: 'heavy' },
    { id: 'gemini-3.0-flash', name: 'Gemini 3.0 Flash', tier: 'medium' },
    { id: 'gemini-3.0-flash-lite', name: 'Gemini 3.0 Flash Lite', tier: 'light' },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', tier: 'heavy' },
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', tier: 'medium' },
  ];

  static isInstalled() {
    try {
      execSync('which gemini', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  static installCommand() {
    return 'npm i -g @google/gemini-cli';
  }

  buildSpawnCommand(agent) {
    const args = [];

    if (agent.model) args.push('--model', agent.model);
    if (agent.prompt) args.push(agent.prompt);

    // Sandbox mode off for full filesystem access
    args.push('--sandbox', 'false');

    return {
      command: 'gemini',
      args,
      env: agent.apiKey ? { GEMINI_API_KEY: agent.apiKey } : {},
    };
  }

  buildHeadlessCommand(prompt, model) {
    const args = ['-p', prompt];
    if (model) args.push('--model', model);
    return { command: 'gemini', args, env: {} };
  }

  switchModel() {
    return false; // Gemini CLI doesn't support mid-session switch
  }

  parseOutput(line) {
    const trimmed = line.trim();
    if (!trimmed) return null;
    return { type: 'activity', data: trimmed };
  }
}
