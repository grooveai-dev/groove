// GROOVE CLI — nuke command
// FSL-1.1-Apache-2.0 — see LICENSE

import chalk from 'chalk';
import { apiCall } from '../client.js';

export async function nuke() {
  try {
    console.log(chalk.yellow('Nuking all agents...'));
    await apiCall('DELETE', '/api/agents');

    const status = await apiCall('GET', '/api/status');
    process.kill(status.pid, 'SIGTERM');

    console.log(chalk.green('All agents killed. Daemon stopped.'));
  } catch {
    console.log(chalk.yellow('No running daemon found.'));
  }
}
