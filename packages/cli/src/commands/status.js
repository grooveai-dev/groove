// GROOVE CLI — status command
// FSL-1.1-Apache-2.0 — see LICENSE

import chalk from 'chalk';
import { apiCall } from '../client.js';

export async function status() {
  try {
    const s = await apiCall('GET', '/api/status');
    console.log('');
    console.log(chalk.bold('  GROOVE Daemon'));
    console.log('');
    console.log(`  Status:   ${chalk.green('running')}`);
    console.log(`  PID:      ${s.pid}`);
    console.log(`  Port:     ${s.port}`);
    console.log(`  Uptime:   ${formatUptime(s.uptime)}`);
    console.log(`  Agents:   ${s.agents} total, ${s.running} running`);
    console.log(`  Project:  ${s.projectDir}`);
    console.log(`  GUI:      ${chalk.cyan(`http://localhost:${s.port}`)}`);
    console.log('');
  } catch {
    console.log('');
    console.log(chalk.bold('  GROOVE Daemon'));
    console.log('');
    console.log(`  Status:   ${chalk.red('not running')}`);
    console.log(`  Start:    ${chalk.dim('groove start')}`);
    console.log('');
  }
}

function formatUptime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
