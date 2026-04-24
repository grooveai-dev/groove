// GROOVE CLI — disconnect command (close SSH tunnel via daemon)
// FSL-1.1-Apache-2.0 — see LICENSE

import chalk from 'chalk';

const API = 'http://localhost:31415/api';

async function daemonRunning() {
  try {
    const res = await fetch(`${API}/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function disconnect(target) {
  console.log('');

  if (!(await daemonRunning())) {
    console.log(chalk.yellow('  No daemon running.'));
    console.log('');
    return;
  }

  let tunnels;
  try {
    const res = await fetch(`${API}/tunnels`);
    tunnels = await res.json();
  } catch (err) {
    console.log(chalk.red('  Failed to query tunnels: ') + err.message);
    console.log('');
    return;
  }

  // Find the tunnel to disconnect
  let tunnel;
  if (target) {
    tunnel = tunnels.find(t => t.active && (t.name === target || t.host === target || t.id === target));
    if (!tunnel) {
      console.log(chalk.yellow(`  No active tunnel matching "${target}".`));
      console.log('');
      return;
    }
  } else {
    tunnel = tunnels.find(t => t.active);
    if (!tunnel) {
      console.log(chalk.yellow('  No active tunnel found.'));
      console.log('');
      return;
    }
  }

  try {
    const res = await fetch(`${API}/tunnels/${tunnel.id}/disconnect`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Disconnect failed');
  } catch (err) {
    console.log(chalk.red('  Disconnect failed: ') + err.message);
    console.log('');
    return;
  }

  console.log(chalk.green('  Tunnel disconnected.'));
  console.log(`  Was connected to: ${chalk.dim(tunnel.name)}`);
  console.log('');
}
