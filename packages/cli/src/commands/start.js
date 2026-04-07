// GROOVE CLI — start command
// FSL-1.1-Apache-2.0 — see LICENSE

import { Daemon } from '@groove-dev/daemon';
import chalk from 'chalk';

export async function start(options) {
  console.log(chalk.bold('GROOVE') + ' starting daemon...');

  try {
    const daemon = new Daemon({
      port: parseInt(options.port, 10),
      host: options.host,
    });

    const shutdown = async () => {
      console.log('\nShutting down...');
      // Force exit after 3s if stop hangs
      const forceTimer = setTimeout(() => process.exit(1), 3000);
      forceTimer.unref();
      try { await daemon.stop(); } catch { /* ignore */ }
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    await daemon.start();
    const isRemote = daemon.host !== '127.0.0.1';
    const guiUrl = `http://${isRemote ? daemon.host : 'localhost'}:${daemon.port}`;
    console.log(chalk.green('Ready.') + ` Open ${guiUrl} for the GUI.`);
  } catch (err) {
    console.error(chalk.red('Failed to start:'), err.message);
    process.exit(1);
  }
}
