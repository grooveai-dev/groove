// GROOVE CLI — agents command
// FSL-1.1-Apache-2.0 — see LICENSE

import chalk from 'chalk';
import { apiCall } from '../client.js';

const STATUS_COLORS = {
  running: 'green',
  starting: 'yellow',
  stopped: 'gray',
  crashed: 'red',
  completed: 'cyan',
};

export async function agents() {
  try {
    const list = await apiCall('GET', '/api/agents');

    if (list.length === 0) {
      console.log(chalk.dim('No agents running. Use `groove spawn` to start one.'));
      return;
    }

    console.log(chalk.bold(`\n  GROOVE Agents (${list.length})\n`));

    for (const a of list) {
      const color = STATUS_COLORS[a.status] || 'white';
      const statusBadge = chalk[color](`[${a.status}]`);
      console.log(`  ${chalk.bold(a.name)} ${statusBadge}  ${chalk.dim(a.id)}`);
      console.log(`    Role: ${a.role}  Provider: ${a.provider}  Scope: ${a.scope.join(', ') || '-'}`);
      console.log(`    Tokens: ${a.tokensUsed}  Context: ${Math.round(a.contextUsage * 100)}%`);
      console.log();
    }
  } catch {
    console.error(chalk.red('Cannot connect to daemon. Is it running? Try: groove start'));
    process.exit(1);
  }
}
