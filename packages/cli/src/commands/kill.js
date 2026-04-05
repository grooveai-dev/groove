// GROOVE CLI — kill command
// FSL-1.1-Apache-2.0 — see LICENSE

import chalk from 'chalk';
import { apiCall } from '../client.js';

export async function kill(id) {
  try {
    await apiCall('DELETE', `/api/agents/${id}`);
    console.log(chalk.green('Killed agent:'), id);
  } catch (err) {
    console.error(chalk.red('Failed to kill:'), err.message);
    process.exit(1);
  }
}
