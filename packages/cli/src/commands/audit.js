// GROOVE CLI — audit command
// FSL-1.1-Apache-2.0 — see LICENSE

import chalk from 'chalk';
import { apiCall } from '../client.js';

const ACTION_COLORS = {
  'agent.spawn': 'green',
  'agent.kill': 'red',
  'agent.kill_all': 'red',
  'agent.rotate': 'yellow',
  'agent.instruct': 'cyan',
  'team.save': 'blue',
  'team.load': 'blue',
  'team.delete': 'red',
  'team.import': 'blue',
  'team.launch': 'green',
  'config.set': 'yellow',
  'credential.set': 'yellow',
  'credential.delete': 'red',
  'approval.approve': 'green',
  'approval.reject': 'red',
};

function formatEntry(entry) {
  const time = entry.t ? new Date(entry.t).toLocaleTimeString() : '??:??:??';
  const color = ACTION_COLORS[entry.action] || 'white';
  const action = chalk[color](entry.action.padEnd(20));

  // Build detail string from remaining fields
  const { t, action: _, ...detail } = entry;
  const detailStr = Object.entries(detail)
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(' ');

  return `  ${chalk.dim(time)}  ${action} ${chalk.dim(detailStr)}`;
}

export async function audit(options) {
  try {
    const limit = parseInt(options.limit, 10) || 25;
    const entries = await apiCall('GET', `/api/audit?limit=${limit}`);

    console.log('');
    if (entries.length === 0) {
      console.log(chalk.dim('  No audit entries yet.'));
    } else {
      console.log(chalk.bold(`  Audit Log`) + chalk.dim(` (${entries.length} entries, newest first)`));
      console.log('');
      for (const entry of entries) {
        console.log(formatEntry(entry));
      }
    }
    console.log('');
  } catch {
    console.log('');
    console.log(chalk.yellow('  Daemon not running.'));
    console.log('');
  }
}
