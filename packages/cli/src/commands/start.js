// GROOVE CLI — start command
// FSL-1.1-Apache-2.0 — see LICENSE

import { existsSync } from 'fs';
import { resolve } from 'path';
import { Daemon } from '@groove-dev/daemon';
import chalk from 'chalk';
import { runSetupWizard, saveKeysViaDaemon } from '../setup.js';

export async function start(options) {
  const grooveDir = process.env.GROOVE_DIR || resolve(process.cwd(), '.groove');
  const isFirstRun = !existsSync(resolve(grooveDir, 'config.json'));

  // ── First-run interactive wizard ────────────────────────────
  let setupKeys = {};
  if (isFirstRun) {
    try {
      const result = await runSetupWizard();
      setupKeys = result.keys || {};
    } catch (err) {
      // If stdin is not interactive (piped), skip wizard
      if (err.code === 'ERR_USE_AFTER_CLOSE') {
        console.log(chalk.dim('  Non-interactive mode — skipping setup wizard.'));
      } else {
        throw err;
      }
    }
  }

  // ── Start daemon ────────────────────────────────────────────
  console.log(chalk.bold('GROOVE') + ' starting daemon...');

  try {
    const daemon = new Daemon({
      port: parseInt(options.port, 10),
      host: options.host,
      grooveDir: process.env.GROOVE_DIR || undefined,
    });

    const shutdown = async () => {
      console.log('\nShutting down...');
      const forceTimer = setTimeout(() => process.exit(1), 3000);
      forceTimer.unref();
      try { await daemon.stop(); } catch { /* ignore */ }
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    await daemon.start();

    // Save API keys from wizard (after daemon is running)
    if (Object.keys(setupKeys).length > 0) {
      await saveKeysViaDaemon(setupKeys, daemon.port);
    }

    console.log(chalk.green('Ready.'));
  } catch (err) {
    console.error(chalk.red('Failed to start:'), err.message);
    process.exit(1);
  }
}
