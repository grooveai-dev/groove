// FSL-1.1-Apache-2.0 — see LICENSE
import { existsSync, readdirSync } from 'fs';
import { createRequire } from 'module';
import { dirname, join } from 'path';

process.env.GROOVE_EDITION = 'pro';

const port = 31415;
const projectDir = process.argv[2] || process.cwd();

function preflightCheck(daemonPath) {
  if (!existsSync(daemonPath)) {
    throw new Error(
      `Daemon entry point not found at ${daemonPath}. ` +
      'The app may not have been packaged correctly — try reinstalling Groove.'
    );
  }

  const daemonDir = dirname(daemonPath);
  const require = createRequire(daemonPath);
  const critical = ['express', 'ws'];
  const missing = critical.filter(dep => {
    try { require.resolve(dep); return false; } catch { return true; }
  });

  if (missing.length) {
    const diag = [`Missing deps: ${missing.join(', ')}`, `GROOVE_DAEMON_PATH: ${daemonPath}`];
    let walkDir = daemonDir;
    for (let i = 0; i < 5 && walkDir !== dirname(walkDir); i++) {
      try {
        const entries = readdirSync(walkDir);
        diag.push(`${walkDir}/: [${entries.join(', ')}]`);
      } catch { diag.push(`${walkDir}/: (unreadable)`); }
      walkDir = dirname(walkDir);
    }
    throw new Error(
      `Daemon is missing dependencies. ` +
      `Diagnostics:\n${diag.join('\n')}\n` +
      'The app bundle may be incomplete — try reinstalling Groove.'
    );
  }
}

async function main() {
  let Daemon;
  const daemonPath = process.env.GROOVE_DAEMON_PATH;

  if (daemonPath) {
    preflightCheck(daemonPath);
    const mod = await import(daemonPath);
    Daemon = mod.Daemon;
  } else {
    const mod = await import('@groove-dev/daemon');
    Daemon = mod.Daemon;
  }

  const daemon = new Daemon({ port, projectDir });
  await daemon.start();

  process.send({ type: 'ready', port: daemon.port });

  process.on('message', (msg) => {
    if (msg.type === 'auth-token') {
      try { daemon.setAuthToken(msg.token); } catch (err) {
        process.stderr.write(`[daemon-bridge] setAuthToken failed: ${err.message}\n`);
      }
    }
  });

  process.on('SIGTERM', async () => {
    await daemon.stop();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    await daemon.stop();
    process.exit(0);
  });
}

main().catch((err) => {
  if (process.send) {
    process.send({ type: 'error', message: err.message });
  }
  process.exit(1);
});
