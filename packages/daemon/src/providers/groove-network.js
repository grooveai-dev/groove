// GROOVE — Groove Network Provider (Decentralized Inference)
// FSL-1.1-Apache-2.0 — see LICENSE

import { homedir } from 'os';
import { resolve, join } from 'path';
import { existsSync } from 'fs';
import { Provider } from './base.js';

// Resolve ~/... paths to absolute paths
function expandHome(p) {
  if (!p) return p;
  if (p.startsWith('~/')) return resolve(homedir(), p.slice(2));
  if (p === '~') return homedir();
  return p;
}

// The daemon sets this reference so the provider can read live config.
// Avoids a circular import with index.js.
let _daemonRef = null;
export function bindDaemon(daemon) { _daemonRef = daemon; }

function getConfig() {
  return _daemonRef?.config?.networkBeta || null;
}

export class GrooveNetworkProvider extends Provider {
  static name = 'groove-network';
  static displayName = 'Groove Network';
  static command = 'python3.12';
  static authType = 'none';

  static models = [
    { id: 'Qwen/Qwen2.5-0.5B', name: 'Qwen 2.5 0.5B (Network)', context: 4096 },
  ];

  static isInstalled() {
    const cfg = getConfig();
    return !!(cfg && cfg.unlocked);
  }

  static installCommand() {
    return { command: 'Activate via beta code', platform: 'any' };
  }

  buildSpawnCommand(agent) {
    const cfg = getConfig() || {};
    const relay = cfg.relayUrl || 'localhost:8770';
    const model = agent.model || GrooveNetworkProvider.models[0].id;
    const maxTokens = agent.maxTokens || 500;
    const prompt = agent.prompt || '';

    const deployPath = expandHome(cfg.deployPath) || resolve(homedir(), 'Desktop/groove-deploy');

    const args = [
      '-m', 'src.consumer.client',
      '--relay', relay,
      '--model', model,
      '--prompt', prompt,
      '--max-tokens', String(maxTokens),
    ];

    return {
      command: join(deployPath, 'venv', 'bin', 'python3.12'),
      args,
      env: { PYTHONUNBUFFERED: '1' },
      cwd: deployPath,
    };
  }

  buildHeadlessCommand(prompt, model) {
    const cfg = getConfig() || {};
    const relay = cfg.relayUrl || 'localhost:8770';
    const m = model || GrooveNetworkProvider.models[0].id;
    const deployPath = expandHome(cfg.deployPath) || resolve(homedir(), 'Desktop/groove-deploy');
    return {
      command: join(deployPath, 'venv', 'bin', 'python3.12'),
      args: [
        '-m', 'src.consumer.client',
        '--relay', relay,
        '--model', m,
        '--prompt', prompt,
        '--max-tokens', '500',
      ],
      env: { PYTHONUNBUFFERED: '1' },
      cwd: deployPath,
    };
  }

  switchModel(agent, newModel) {
    return false;
  }

  parseOutput(line) {
    const trimmed = (line || '').trim();
    if (!trimmed) return null;
    if (trimmed[0] !== '{') {
      return { type: 'activity', data: trimmed };
    }
    try {
      const msg = JSON.parse(trimmed);
      if (msg && typeof msg === 'object' && typeof msg.type === 'string') {
        return {
          type: msg.type,
          text: msg.text,
          sessionId: msg.session_id,
          tokensGenerated: msg.tokens_generated,
          error: msg.error,
          raw: msg,
        };
      }
    } catch { /* not JSON, fall through */ }
    return { type: 'activity', data: trimmed };
  }
}
