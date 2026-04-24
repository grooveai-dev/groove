// GROOVE CLI — connect command (SSH tunnel via daemon TunnelManager)
// FSL-1.1-Apache-2.0 — see LICENSE

import { execFileSync } from 'child_process';
import chalk from 'chalk';

const API = 'http://localhost:31415/api';

function parseTarget(target) {
  if (!target || typeof target !== 'string') {
    throw new Error('SSH target is required (e.g., user@host)');
  }
  if (/[;|&`$(){}[\]<>!#\n\r\\]/.test(target)) {
    throw new Error('Invalid characters in SSH target');
  }
  if (target.length > 253) {
    throw new Error('SSH target too long');
  }
  const atIdx = target.indexOf('@');
  if (atIdx === -1) {
    return { user: null, host: target };
  }
  return { user: target.slice(0, atIdx), host: target.slice(atIdx + 1) };
}

async function daemonRunning() {
  try {
    const res = await fetch(`${API}/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

function openBrowser(url) {
  try {
    if (process.platform === 'darwin') {
      execFileSync('open', [url], { stdio: 'ignore' });
    } else if (process.platform === 'win32') {
      execFileSync('cmd', ['/c', 'start', '', url], { stdio: 'ignore' });
    } else {
      execFileSync('xdg-open', [url], { stdio: 'ignore' });
    }
  } catch {
    // best-effort
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

export async function connect(target, options) {
  console.log('');

  let user, host;
  try {
    ({ user, host } = parseTarget(target));
  } catch (err) {
    console.log(chalk.red('  Error: ') + err.message);
    console.log('');
    return;
  }

  if (!(await daemonRunning())) {
    console.log(chalk.red('  Local daemon is not running.'));
    console.log(`  Run ${chalk.bold('groove start')} first.`);
    console.log('');
    return;
  }

  // Check for existing saved remote matching this host+user
  let tunnelId;
  let tunnels;
  try {
    const res = await fetch(`${API}/tunnels`);
    tunnels = await res.json();
  } catch (err) {
    console.log(chalk.red('  Failed to query tunnels: ') + err.message);
    console.log('');
    return;
  }

  const match = tunnels.find(t =>
    t.host === host && (user ? t.user === user : true)
  );

  if (match) {
    if (match.active) {
      console.log(chalk.yellow('  Tunnel already active') + ` to ${match.name}`);
      if (match.localPort) {
        console.log(`  GUI:     ${chalk.cyan(`http://localhost:${match.localPort}`)}`);
      }
      console.log('');
      console.log(`  Run ${chalk.bold('groove disconnect')} first to close it.`);
      console.log('');
      return;
    }
    tunnelId = match.id;
    console.log(chalk.dim(`  Using saved remote: ${match.name}`));
  }

  // Save new tunnel config if none found
  if (!tunnelId) {
    try {
      const body = {
        name: target,
        host,
        user: user || process.env.USER || 'root',
        port: options.port ? parseInt(options.port, 10) : 22,
        sshKeyPath: options.identity || null,
        autoConnect: options.autoConnect || false,
        projectDir: options.projectDir || null,
      };
      const res = await fetch(`${API}/tunnels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save tunnel');
      tunnelId = data.id;
      console.log(chalk.dim(`  Saved remote: ${data.name} (${data.id})`));
    } catch (err) {
      console.log(chalk.red('  ' + err.message));
      console.log('');
      return;
    }
  }

  // Fire connect — the daemon handles test, install, upgrade, start, port-forward
  console.log(chalk.dim('  Connecting...'));

  let connectDone = false;
  let connectResult = null;
  let connectError = null;

  const connectPromise = fetch(`${API}/tunnels/${tunnelId}/connect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  }).then(async r => {
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Connection failed');
    return data;
  }).then(data => { connectResult = data; })
    .catch(err => { connectError = err; })
    .finally(() => { connectDone = true; });

  // Poll status every 2s while connect is in progress
  let dots = 0;
  while (!connectDone) {
    await sleep(2000);
    if (connectDone) break;
    try {
      const res = await fetch(`${API}/tunnels/${tunnelId}/status`, {
        signal: AbortSignal.timeout(2000),
      });
      const status = await res.json();
      if (status.active) break;
    } catch {
      // status poll failure is non-fatal
    }
    dots++;
    process.stdout.write(`\r  ${chalk.dim('Connecting' + '.'.repeat((dots % 3) + 1).padEnd(3))}   `);
  }

  // Ensure connect promise resolves
  await connectPromise;
  process.stdout.write('\r' + ' '.repeat(40) + '\r');

  if (connectError) {
    console.log(chalk.red('  Connection failed: ') + connectError.message);
    console.log('');
    return;
  }

  const url = connectResult.url || `http://localhost:${connectResult.localPort}`;

  console.log(chalk.green('  Connected!'));
  console.log('');
  console.log(`  Target:  ${chalk.bold(target)}`);
  console.log(`  Tunnel:  localhost:${connectResult.localPort} → ${target}:31415`);
  console.log(`  GUI:     ${chalk.cyan(url)}`);
  console.log('');

  if (options.browser !== false) {
    openBrowser(url);
  }
}
