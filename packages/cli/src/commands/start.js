// GROOVE CLI — start command
// FSL-1.1-Apache-2.0 — see LICENSE

import { Daemon } from '@groove-ai/daemon';
import chalk from 'chalk';

export async function start(options) {
  console.log(chalk.bold('GROOVE') + ' starting daemon...');

  try {
    const daemon = new Daemon({ port: parseInt(options.port, 10) });

    process.on('SIGINT', async () => {
      await daemon.stop();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      await daemon.stop();
      process.exit(0);
    });

    await daemon.start();
    console.log(chalk.green('Ready.') + ` Open http://localhost:${options.port} for the GUI.`);
  } catch (err) {
    console.error(chalk.red('Failed to start:'), err.message);
    process.exit(1);
  }
}
