// GROOVE — First-Run Detection & Setup
// FSL-1.1-Apache-2.0 — see LICENSE

import { existsSync, writeFileSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { networkInterfaces } from 'os';
import { listProviders } from './providers/index.js';

const DEFAULT_CONFIG = {
  version: '0.1.0',
  port: 31415,
  journalistInterval: 120,
  rotationThreshold: 0.75,
  autoRotation: true,
  qcThreshold: 4,
  maxAgents: 10,
  defaultProvider: 'claude-code',
};

export function isFirstRun(grooveDir) {
  return !existsSync(resolve(grooveDir, 'config.json'));
}

// Show welcome banner on every startup
export function printWelcome(port, host = '127.0.0.1', firstRun = false) {
  const providers = listProviders();
  const installed = providers.filter((p) => p.installed);
  const notInstalled = providers.filter((p) => !p.installed);

  console.log('');
  console.log('  ┌─────────────────────────────────────┐');
  console.log('  │        Welcome to GROOVE            │');
  console.log('  │  Agent orchestration for AI coding  │');
  console.log('  └─────────────────────────────────────┘');
  console.log('');

  if (installed.length > 0) {
    console.log(`  Providers (${installed.length} ready):`);
    for (const p of installed) {
      console.log(`    ✓ ${p.name}`);
    }
  } else {
    console.log('  No AI providers detected.');
    console.log('  Install at least one:  npm i -g @anthropic-ai/claude-code');
  }

  if (notInstalled.length > 0) {
    console.log('');
    console.log('  Available to install:');
    for (const p of notInstalled) {
      console.log(`    · ${p.name.padEnd(18)} ${p.installCommand}`);
    }
  }

  console.log('');

  const isRemote = host !== '127.0.0.1';

  // Detect environment
  const isVSCode = !!(process.env.VSCODE_GIT_IPC_HANDLE || process.env.VSCODE_IPC_HOOK_CLI || process.env.TERM_PROGRAM === 'vscode');
  const isSSH = !!(process.env.SSH_CONNECTION || process.env.SSH_CLIENT || process.env.SSH_TTY);
  const hasDisplay = !!(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
  const isHeadless = !hasDisplay && !process.env.TERM_PROGRAM;
  const isServer = !isVSCode && (isSSH || isHeadless);

  if (isRemote) {
    console.log(`  Open:  http://${host}:${port}`);
  } else if (isVSCode) {
    console.log(`  Open:  http://localhost:${port}`);
    console.log(`         VS Code forwards this port automatically.`);
  } else if (isServer) {
    const sshUser = process.env.SUDO_USER || process.env.USER || 'user';
    let serverIp = '';
    const sshConn = process.env.SSH_CONNECTION || '';
    if (sshConn) {
      serverIp = sshConn.split(' ')[2] || '';
    }
    if (!serverIp) {
      const nets = networkInterfaces();
      for (const addrs of Object.values(nets)) {
        for (const addr of addrs) {
          if (addr.family === 'IPv4' && !addr.internal) {
            serverIp = addr.address;
            break;
          }
        }
        if (serverIp) break;
      }
    }
    serverIp = serverIp || '<your-server-ip>';
    console.log('  Open the GUI from your Mac/PC:');
    console.log(`    npx groove-dev connect ${sshUser}@${serverIp}`);
  } else {
    console.log(`  Open:  http://localhost:${port}`);
  }

  console.log(`  Stop:  groove stop (or Ctrl+C)`);
  console.log(`  Docs:  https://docs.groovedev.ai`);
  console.log('');
}

export function runFirstTimeSetup(grooveDir) {
  // Write default config
  const config = { ...DEFAULT_CONFIG };

  // Auto-detect best default provider
  const providers = listProviders();
  const installed = providers.filter((p) => p.installed);
  if (installed.length > 0) {
    const preferred = ['claude-code', 'codex', 'gemini', 'ollama'];
    const best = preferred.find((id) => installed.some((p) => p.id === id));
    if (best) config.defaultProvider = best;
  }

  writeFileSync(resolve(grooveDir, 'config.json'), JSON.stringify(config, null, 2));

  return config;
}

export function loadConfig(grooveDir) {
  const configPath = resolve(grooveDir, 'config.json');
  if (!existsSync(configPath)) return { ...DEFAULT_CONFIG };

  try {
    const saved = JSON.parse(readFileSync(configPath, 'utf8'));
    return { ...DEFAULT_CONFIG, ...saved };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(grooveDir, config) {
  writeFileSync(resolve(grooveDir, 'config.json'), JSON.stringify(config, null, 2));
}
