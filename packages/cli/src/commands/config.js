// GROOVE CLI — config command
// FSL-1.1-Apache-2.0 — see LICENSE

import chalk from 'chalk';
import { apiCall } from '../client.js';

export async function configShow() {
  try {
    const status = await apiCall('GET', '/api/config');
    console.log(chalk.bold('\n  GROOVE Configuration\n'));
    for (const [key, value] of Object.entries(status)) {
      console.log(`  ${chalk.dim(key.padEnd(24))} ${chalk.white(JSON.stringify(value))}`);
    }
    console.log('');
  } catch {
    console.error(chalk.red('  Cannot connect to daemon.'));
    process.exit(1);
  }
}

export async function configSet(key, value) {
  try {
    // Auto-parse numbers and booleans
    let parsed = value;
    if (value === 'true') parsed = true;
    else if (value === 'false') parsed = false;
    else if (!isNaN(value) && value !== '') parsed = Number(value);

    await apiCall('PATCH', '/api/config', { [key]: parsed });
    console.log(chalk.green(`  Set ${key} = ${JSON.stringify(parsed)}`));
  } catch (err) {
    console.error(chalk.red('  Failed:'), err.message);
    process.exit(1);
  }
}
