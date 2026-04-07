// GROOVE CLI — disconnect command (kill SSH tunnel)
// FSL-1.1-Apache-2.0 — see LICENSE

import { execFileSync } from 'child_process';
import { existsSync, readFileSync, unlinkSync } from 'fs';
import { resolve } from 'path';
import chalk from 'chalk';

function pidFile() {
  return resolve(process.cwd(), '.groove', 'tunnel.pid');
}

function tunnelInfoFile() {
  return resolve(process.cwd(), '.groove', 'tunnel.json');
}

function cleanup() {
  try { if (existsSync(pidFile())) unlinkSync(pidFile()); } catch { /* ignore */ }
  try { if (existsSync(tunnelInfoFile())) unlinkSync(tunnelInfoFile()); } catch { /* ignore */ }
}

export async function disconnect() {
  console.log('');

  const pf = pidFile();
  if (!existsSync(pf)) {
    console.log(chalk.yellow('  No active tunnel found.'));
    console.log('');
    return;
  }

  const pid = parseInt(readFileSync(pf, 'utf8').trim(), 10);
  if (isNaN(pid)) {
    console.log(chalk.yellow('  Invalid tunnel PID file. Cleaning up.'));
    cleanup();
    console.log('');
    return;
  }

  // Read tunnel info for display
  let info = {};
  try {
    const infoPath = tunnelInfoFile();
    if (existsSync(infoPath)) {
      info = JSON.parse(readFileSync(infoPath, 'utf8'));
    }
  } catch { /* ignore */ }

  // Check if process is alive
  try {
    process.kill(pid, 0);
  } catch {
    console.log(chalk.yellow('  Tunnel process already dead. Cleaning up.'));
    cleanup();
    console.log('');
    return;
  }

  // Verify the PID belongs to an SSH process (not a random reused PID after reboot)
  try {
    const cmd = execFileSync('ps', ['-p', String(pid), '-o', 'command='], {
      encoding: 'utf8', timeout: 3000,
    }).trim();
    if (!cmd.includes('ssh')) {
      console.log(chalk.yellow('  PID no longer belongs to an SSH tunnel. Cleaning up stale files.'));
      cleanup();
      console.log('');
      return;
    }
  } catch {
    // ps failed — proceed cautiously, don't kill
    console.log(chalk.yellow('  Cannot verify tunnel process. Cleaning up stale files.'));
    cleanup();
    console.log('');
    return;
  }

  // Kill the tunnel
  try {
    process.kill(pid, 'SIGTERM');
    console.log(chalk.green('  Tunnel disconnected.'));
    if (info.target) {
      console.log(`  Was connected to: ${chalk.dim(info.target)}`);
    }
  } catch (err) {
    console.log(chalk.red('  Failed to kill tunnel: ') + err.message);
  }

  cleanup();
  console.log('');
}
