// GROOVE CLI — providers command
// FSL-1.1-Apache-2.0 — see LICENSE

import chalk from 'chalk';
import { apiCall } from '../client.js';

export async function providers() {
  try {
    const list = await apiCall('GET', '/api/providers');

    console.log(chalk.bold('\n  Available Providers\n'));

    for (const p of list) {
      const installed = p.installed ? chalk.green('installed') : chalk.red('not installed');
      const authed = p.authType === 'local' || p.authType === 'subscription'
        ? ''
        : p.hasKey ? chalk.green(' (key set)') : chalk.yellow(' (no key)');

      console.log(`  ${chalk.bold(p.name.padEnd(18))} ${installed}${authed}`);
      console.log(`    Auth: ${p.authType}  Models: ${p.models.map(m => m.name).join(', ')}`);
      if (!p.installed) {
        console.log(`    Install: ${chalk.dim(p.installCommand)}`);
      }
      console.log('');
    }
  } catch {
    console.error(chalk.red('  Cannot connect to daemon.'));
    process.exit(1);
  }
}

export async function setKey(provider, key) {
  try {
    const result = await apiCall('POST', `/api/credentials/${provider}`, { key });
    console.log(chalk.green(`  Key set for ${provider}:`), result.masked);
  } catch (err) {
    console.error(chalk.red('  Failed:'), err.message);
    process.exit(1);
  }
}
