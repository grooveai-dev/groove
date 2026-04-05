// GROOVE CLI — rotate command
// FSL-1.1-Apache-2.0 — see LICENSE

import chalk from 'chalk';
import { apiCall } from '../client.js';

export async function rotate(id) {
  try {
    console.log(chalk.yellow(`  Rotating agent ${id}...`));
    const newAgent = await apiCall('POST', `/api/agents/${id}/rotate`);
    console.log(chalk.green(`  Rotated.`), `New session: ${chalk.bold(newAgent.name)} (${newAgent.id})`);
  } catch (err) {
    console.error(chalk.red('  Rotation failed:'), err.message);
    process.exit(1);
  }
}
