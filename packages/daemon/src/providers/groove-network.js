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

// Parse a version tag like 'v0.1.0' or '0.2.0-rc1' into [major, minor, patch].
// Non-numeric suffixes are stripped. Returns null if unparseable.
export function parseSemver(v) {
  if (!v || typeof v !== 'string') return null;
  const m = v.trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
}

// Returns negative / 0 / positive, like String.prototype.localeCompare.
// Unparseable versions compare as "lower" than parseable ones.
export function compareSemver(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

// v0.2.0+ renamed the `--relay` flag to `--signal`. Older installs still need
// `--relay` until the user updates. Unparseable / missing versions are treated
// as pre-0.2.0 to stay compatible with existing v0.1.0 installs.
export function supportsSignalFlag(version) {
  return compareSemver(version, '0.2.0') >= 0;
}

function signalFlagName() {
  const cfg = getConfig() || {};
  return supportsSignalFlag(cfg.version) ? '--signal' : '--relay';
}

// The Python client prepends the scheme itself — daemon passes a bare host
// and adds `--tls` to request wss://. Strip any ws:// or wss:// a user may
// have left in the stored signalUrl (e.g. from an older daemon default).
function stripScheme(url) {
  if (!url) return 'signal.groovedev.ai';
  return url.replace(/^wss?:\/\//i, '').replace(/\/.*$/, '');
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
    const signal = stripScheme(cfg.signalUrl);
    const model = agent.model || GrooveNetworkProvider.models[0].id;
    const maxTokens = agent.maxTokens || 500;
    const prompt = agent.prompt || '';

    const deployPath = expandHome(cfg.deployPath) || resolve(homedir(), 'Desktop/groove-deploy');

    const args = [
      '-m', 'src.consumer.client',
      signalFlagName(), signal,
      '--tls',
      '--model', model,
      '--prompt', prompt,
      '--max-tokens', String(maxTokens),
      '--json',
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
    const signal = stripScheme(cfg.signalUrl);
    const m = model || GrooveNetworkProvider.models[0].id;
    const deployPath = expandHome(cfg.deployPath) || resolve(homedir(), 'Desktop/groove-deploy');
    return {
      command: join(deployPath, 'venv', 'bin', 'python3.12'),
      args: [
        '-m', 'src.consumer.client',
        signalFlagName(), signal,
        '--tls',
        '--model', m,
        '--prompt', prompt,
        '--max-tokens', '500',
        '--json',
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
          signal: msg.signal,
          nodesAvailable: msg.nodes_available,
          nodes: msg.nodes,
          raw: msg,
        };
      }
    } catch { /* not JSON, fall through */ }
    return { type: 'activity', data: trimmed };
  }
}
