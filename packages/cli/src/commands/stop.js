// GROOVE CLI — stop command
// FSL-1.1-Apache-2.0 — see LICENSE

import chalk from 'chalk';
import { apiCall } from '../client.js';

export async function stop(options = {}) {
  let status;
  try {
    status = await apiCall('GET', '/api/status');
  } catch {
    console.log(chalk.yellow('No running daemon found.'));
    return;
  }

  if (status.running > 0 && !options.force) {
    console.error(chalk.red(`Refusing to stop: ${status.running} agent(s) still running.`));
    console.error(chalk.dim('  Stopping the daemon destroys all running agents in every team.'));
    console.error(chalk.dim('  Kill specific agents first with "groove kill <id>",'));
    console.error(chalk.dim('  or override with "groove stop --force".'));
    process.exit(1);
  }

  try {
    process.kill(status.pid, 'SIGTERM');
    console.log(chalk.green('GROOVE daemon stopped.'));
  } catch {
    console.log(chalk.yellow('No running daemon found.'));
  }
}
