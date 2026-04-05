// GROOVE — Aider Provider
// FSL-1.1-Apache-2.0 — see LICENSE

import { execSync } from 'child_process';
import { Provider } from './base.js';

export class AiderProvider extends Provider {
  static name = 'aider';
  static displayName = 'Aider';
  static command = 'aider';
  static authType = 'api-key';
  static envKey = 'OPENAI_API_KEY'; // Default, but Aider supports many providers
  static models = [
    { id: 'gpt-4o', name: 'GPT-4o', tier: 'heavy' },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini', tier: 'medium' },
    { id: 'claude-3-5-sonnet-20241022', name: 'Claude Sonnet', tier: 'medium' },
  ];

  static isInstalled() {
    try {
      execSync('which aider', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  static installCommand() {
    return 'pip install aider-chat';
  }

  buildSpawnCommand(agent) {
    const args = ['--yes-always']; // Auto-accept for autonomous operation

    if (agent.model) args.push('--model', agent.model);

    // Auto-commit off — let GROOVE manage commits
    args.push('--no-auto-commits');

    if (agent.prompt) {
      args.push('--message', agent.prompt);
    }

    return {
      command: 'aider',
      args,
      env: agent.apiKey ? { OPENAI_API_KEY: agent.apiKey } : {},
    };
  }

  buildHeadlessCommand(prompt, model) {
    const args = ['--message', prompt, '--yes-always', '--no-auto-commits'];
    if (model) args.push('--model', model);
    return { command: 'aider', args, env: {} };
  }

  switchModel() {
    return true; // Aider supports /model command
  }

  parseOutput(line) {
    const trimmed = line.trim();
    if (!trimmed) return null;

    // Aider shows file edits with specific markers
    if (trimmed.startsWith('───') || trimmed.startsWith('│')) {
      return { type: 'activity', subtype: 'edit', data: trimmed };
    }

    return { type: 'activity', data: trimmed };
  }
}
