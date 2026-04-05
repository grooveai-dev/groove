// GROOVE CLI — approve/reject commands
// FSL-1.1-Apache-2.0 — see LICENSE

import chalk from 'chalk';
import { apiCall } from '../client.js';

export async function approvals() {
  try {
    const { pending, status } = await apiCall('GET', '/api/approvals');

    if (pending.length === 0) {
      console.log(chalk.dim('  No pending approvals.'));
      return;
    }

    console.log(chalk.bold(`\n  Pending Approvals (${pending.length})\n`));
    for (const a of pending) {
      console.log(`  ${chalk.yellow(a.id)}`);
      console.log(`    Agent: ${a.agentName}`);
      console.log(`    Action: ${a.action?.description || a.action?.type || 'unknown'}`);
      console.log(`    Time: ${new Date(a.requestedAt).toLocaleTimeString()}`);
      console.log('');
    }
  } catch {
    console.error(chalk.red('  Cannot connect to daemon.'));
    process.exit(1);
  }
}

export async function approve(id) {
  try {
    const result = await apiCall('POST', `/api/approvals/${id}/approve`);
    console.log(chalk.green('  Approved:'), result.id);
  } catch (err) {
    console.error(chalk.red('  Failed:'), err.message);
    process.exit(1);
  }
}

export async function reject(id, options) {
  try {
    const result = await apiCall('POST', `/api/approvals/${id}/reject`, {
      reason: options.reason || '',
    });
    console.log(chalk.green('  Rejected:'), result.id);
  } catch (err) {
    console.error(chalk.red('  Failed:'), err.message);
    process.exit(1);
  }
}
