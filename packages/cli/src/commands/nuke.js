// GROOVE CLI — nuke command
// FSL-1.1-Apache-2.0 — see LICENSE

import chalk from 'chalk';
import { apiCall } from '../client.js';

export async function nuke(options = {}) {
  let status;
  try {
    status = await apiCall('GET', '/api/status');
  } catch {
    console.log(chalk.yellow('No running daemon found.'));
    return;
  }

  if (status.running > 0 && !options.force) {
    console.error(chalk.red(`Refusing to nuke: ${status.running} agent(s) still running.`));
    console.error(chalk.dim('  Nuke will kill every agent in every team and stop the daemon.'));
    console.error(chalk.dim('  Re-run with "groove nuke --force" to confirm.'));
    process.exit(1);
  }

  try {
    console.log(chalk.yellow('Nuking all agents...'));
    await apiCall('DELETE', '/api/agents');
    process.kill(status.pid, 'SIGTERM');
    console.log(chalk.green('All agents killed. Daemon stopped.'));
  } catch {
    console.log(chalk.yellow('No running daemon found.'));
  }
}
