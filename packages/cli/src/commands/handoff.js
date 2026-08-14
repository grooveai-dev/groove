// GROOVE CLI — handoff command (succession to a fresh agent)
// FSL-1.1-Apache-2.0 — see LICENSE

import chalk from 'chalk';
import { apiCall } from '../client.js';

export async function handoff(id, options = {}) {
  try {
    console.log(chalk.yellow(`  Preparing succession dossier for ${id}...`));
    const record = await apiCall('POST', `/api/agents/${id}/handoff`, {
      name: options.name,
      inheritName: options.keepName !== false,
    });
    console.log(chalk.green(`  Succession started.`));
    console.log(`  ${chalk.bold(record.successorName)} is interviewing ${chalk.bold(record.predecessorName)} over InnerChat.`);
    console.log(`  When done it will retire the predecessor${record.inheritName ? ` and take over the name "${record.predecessorName}"` : ''}.`);
    console.log(chalk.dim(`  Handoff id: ${record.id}`));
  } catch (err) {
    console.error(chalk.red('  Handoff failed:'), err.message);
    process.exit(1);
  }
}
