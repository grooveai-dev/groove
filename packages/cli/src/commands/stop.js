// GROOVE CLI — stop command
// FSL-1.1-Apache-2.0 — see LICENSE

import chalk from 'chalk';
import { apiCall } from '../client.js';

export async function stop() {
  try {
    const status = await apiCall('GET', '/api/status');
    process.kill(status.pid, 'SIGTERM');
    console.log(chalk.green('GROOVE daemon stopped.'));
  } catch {
    console.log(chalk.yellow('No running daemon found.'));
  }
}
