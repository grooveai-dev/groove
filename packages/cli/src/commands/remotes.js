// GROOVE CLI — remotes command (list saved SSH tunnels)
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

export async function remotes() {
  console.log('');

  if (!(await daemonRunning())) {
    console.log(chalk.yellow('  Daemon is not running.'));
    console.log(`  Run ${chalk.bold('groove start')} first.`);
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

  if (!tunnels.length) {
    console.log(chalk.dim('  No saved remotes.'));
    console.log(`  Use ${chalk.bold('groove connect user@host')} to add one.`);
    console.log('');
    return;
  }

  // Column headers
  const nameW = Math.max(6, ...tunnels.map(t => t.name.length)) + 2;
  const hostW = Math.max(6, ...tunnels.map(t => t.host.length)) + 2;
  const userW = Math.max(6, ...tunnels.map(t => t.user.length)) + 2;

  const header =
    chalk.dim('  ' +
      'NAME'.padEnd(nameW) +
      'HOST'.padEnd(hostW) +
      'USER'.padEnd(userW) +
      'STATUS'.padEnd(12) +
      'PORT');
  console.log(header);
  console.log(chalk.dim('  ' + '─'.repeat(nameW + hostW + userW + 12 + 6)));

  for (const t of tunnels) {
    const statusRaw = t.active ? 'active' : 'inactive';
    const statusCol = t.active ? chalk.green(statusRaw) : chalk.dim(statusRaw);
    const portRaw = t.active && t.localPort ? String(t.localPort) : '—';
    const portCol = t.active && t.localPort ? chalk.cyan(portRaw) : chalk.dim(portRaw);
    console.log(
      '  ' +
      t.name.padEnd(nameW) +
      t.host.padEnd(hostW) +
      t.user.padEnd(userW) +
      statusCol + ' '.repeat(Math.max(1, 12 - statusRaw.length)) +
      portCol
    );
  }

  console.log('');
}
