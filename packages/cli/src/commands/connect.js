// GROOVE CLI — connect command (SSH tunnel to remote daemon)
// FSL-1.1-Apache-2.0 — see LICENSE

import { execFileSync, spawn } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { createConnection } from 'net';
import chalk from 'chalk';

const REMOTE_PORT = 31415;
const DEFAULT_LOCAL_PORT = 31416;
const MAX_PORT_ATTEMPTS = 10;

// Allow user@host OR plain hostname (SSH config aliases like "groove-ai")
const SSH_TARGET_PATTERN = /^([a-zA-Z0-9._-]+@)?[a-zA-Z0-9._-]+$/;

function validateTarget(target) {
  if (!target || typeof target !== 'string') {
    throw new Error('SSH target is required (e.g., user@host or ssh-config-alias)');
  }
  // Block injection characters
  if (/[;|&`$(){}[\]<>!#\n\r\\]/.test(target)) {
    throw new Error('Invalid characters in SSH target');
  }
  if (!SSH_TARGET_PATTERN.test(target)) {
    throw new Error('Invalid SSH target format. Expected: user@hostname or ssh-config-alias');
  }
  if (target.length > 253) {
    throw new Error('SSH target too long');
  }
}

function grooveDir() {
  const dir = resolve(process.cwd(), '.groove');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function pidFile() {
  return resolve(grooveDir(), 'tunnel.pid');
}

function tunnelInfoFile() {
  return resolve(grooveDir(), 'tunnel.json');
}

function isPortInUse(port) {
  return new Promise((resolve) => {
    const conn = createConnection({ host: '127.0.0.1', port });
    conn.setTimeout(3000);
    conn.on('connect', () => { conn.destroy(); resolve(true); });
    conn.on('error', () => resolve(false));
    conn.on('timeout', () => { conn.destroy(); resolve(false); });
  });
}

async function findAvailablePort() {
  for (let port = DEFAULT_LOCAL_PORT; port < DEFAULT_LOCAL_PORT + MAX_PORT_ATTEMPTS; port++) {
    if (!(await isPortInUse(port))) return port;
  }
  throw new Error(`No available local port found (tried ${DEFAULT_LOCAL_PORT}-${DEFAULT_LOCAL_PORT + MAX_PORT_ATTEMPTS - 1})`);
}

function preflight(target, keyFile) {
  // SSH in and check if daemon is listening on remote
  // Use curl to health endpoint — works on both Linux and macOS
  const args = [
    ...(keyFile ? ['-i', keyFile] : []),
    '-o', 'ConnectTimeout=10',
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'BatchMode=yes',
    target,
    `curl -sf http://localhost:${REMOTE_PORT}/api/health >/dev/null 2>&1 || echo __GROOVE_NOT_RUNNING__`,
  ];

  try {
    const result = execFileSync('ssh', args, {
      encoding: 'utf8',
      timeout: 15000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    if (result.includes('__GROOVE_NOT_RUNNING__')) {
      return { running: false };
    }
    return { running: true };
  } catch (err) {
    const stderr = err.stderr?.toString() || '';
    if (stderr.includes('Permission denied')) {
      throw new Error('SSH authentication failed. Check your key or credentials.');
    }
    if (stderr.includes('Connection refused') || stderr.includes('Connection timed out') || stderr.includes('No route to host')) {
      throw new Error(`Cannot reach ${target}. Check the hostname and that SSH is running.`);
    }
    throw new Error(`SSH preflight failed: ${stderr.trim() || err.message}`);
  }
}

function isSshProcess(pid) {
  // Verify the PID belongs to an SSH process (not a random reused PID)
  try {
    const cmd = execFileSync('ps', ['-p', String(pid), '-o', 'command='], {
      encoding: 'utf8',
      timeout: 3000,
    }).trim();
    return cmd.includes('ssh');
  } catch {
    return false;
  }
}

function existingTunnel() {
  const pf = pidFile();
  if (!existsSync(pf)) return null;
  const pid = parseInt(readFileSync(pf, 'utf8').trim(), 10);
  if (isNaN(pid)) return null;
  // Check if process is still alive AND is an SSH process
  try {
    process.kill(pid, 0);
    if (!isSshProcess(pid)) {
      // PID was reused by a different process — stale tunnel files
      return null;
    }
    // Read tunnel info if available
    const infoPath = tunnelInfoFile();
    if (existsSync(infoPath)) {
      const info = JSON.parse(readFileSync(infoPath, 'utf8'));
      return { pid, ...info };
    }
    return { pid };
  } catch {
    return null;
  }
}

function openBrowser(url) {
  const platform = process.platform;
  try {
    if (platform === 'darwin') {
      execFileSync('open', [url], { stdio: 'ignore' });
    } else if (platform === 'win32') {
      execFileSync('cmd', ['/c', 'start', '', url], { stdio: 'ignore' });
    } else {
      execFileSync('xdg-open', [url], { stdio: 'ignore' });
    }
  } catch {
    // Browser open is best-effort
  }
}

export async function connect(target, options) {
  console.log('');

  // Validate SSH target
  try {
    validateTarget(target);
  } catch (err) {
    console.log(chalk.red('  Error: ') + err.message);
    console.log('');
    return;
  }

  // Check for existing tunnel
  const existing = existingTunnel();
  if (existing) {
    console.log(chalk.yellow('  Tunnel already active') + ` (PID ${existing.pid})`);
    if (existing.target) {
      console.log(`  Target:  ${existing.target}`);
    }
    if (existing.localPort) {
      console.log(`  GUI:     ${chalk.cyan(`http://localhost:${existing.localPort}`)}`);
    }
    console.log('');
    console.log(`  Run ${chalk.bold('groove disconnect')} first to close it.`);
    console.log('');
    return;
  }

  // Preflight — check daemon is running on remote
  console.log(chalk.dim('  Checking remote daemon...'));
  try {
    const check = preflight(target, options.identity);
    if (!check.running) {
      console.log(chalk.red('  Daemon not running on remote.'));
      console.log(`  SSH into ${chalk.bold(target)} and run ${chalk.bold('groove start')} first.`);
      console.log('');
      return;
    }
  } catch (err) {
    console.log(chalk.red('  ' + err.message));
    console.log('');
    return;
  }

  console.log(chalk.dim('  Remote daemon is running.'));

  // Find available local port
  let localPort;
  try {
    localPort = await findAvailablePort();
  } catch (err) {
    console.log(chalk.red('  ' + err.message));
    console.log('');
    return;
  }

  if (localPort !== DEFAULT_LOCAL_PORT) {
    console.log(chalk.yellow(`  Port ${DEFAULT_LOCAL_PORT} in use, using ${localPort} instead.`));
  }

  // Spawn SSH tunnel
  const sshArgs = [
    '-N',                                            // No remote command
    '-L', `127.0.0.1:${localPort}:localhost:${REMOTE_PORT}`,  // Local bind to 127.0.0.1 only
    '-o', 'ServerAliveInterval=30',                  // Keepalive every 30s
    '-o', 'ServerAliveCountMax=3',                   // Die after 3 missed keepalives
    '-o', 'ExitOnForwardFailure=yes',                // Fail if port forward fails
    '-o', 'StrictHostKeyChecking=accept-new',
    ...(options.identity ? ['-i', options.identity] : []),
    target,
  ];

  const tunnel = spawn('ssh', sshArgs, {
    stdio: ['ignore', 'ignore', 'pipe'],
    detached: true,
  });

  // Capture stderr for early errors
  let stderrBuf = '';
  tunnel.stderr.on('data', (chunk) => { stderrBuf += chunk.toString(); });

  // Wait a moment to catch immediate failures (bad key, connection refused)
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // Check if tunnel is still alive
  if (tunnel.exitCode !== null) {
    console.log(chalk.red('  Tunnel failed to start.'));
    if (stderrBuf.trim()) {
      console.log(chalk.dim('  ' + stderrBuf.trim()));
    }
    console.log('');
    return;
  }

  // Verify the tunnel is actually forwarding
  const tunnelUp = await isPortInUse(localPort);
  if (!tunnelUp) {
    console.log(chalk.red('  Tunnel started but port forward not active.'));
    try { process.kill(tunnel.pid); } catch { /* ignore */ }
    console.log('');
    return;
  }

  // Detach and save PID
  tunnel.unref();
  writeFileSync(pidFile(), String(tunnel.pid), { mode: 0o600 });
  writeFileSync(tunnelInfoFile(), JSON.stringify({
    target,
    localPort,
    remotePort: REMOTE_PORT,
    startedAt: new Date().toISOString(),
  }), { mode: 0o600 });

  const url = `http://localhost:${localPort}`;

  console.log('');
  console.log(chalk.green('  Connected!'));
  console.log('');
  console.log(`  Target:  ${chalk.bold(target)}`);
  console.log(`  Tunnel:  localhost:${localPort} → ${target}:${REMOTE_PORT}`);
  console.log(`  GUI:     ${chalk.cyan(url)}`);
  console.log(`  PID:     ${tunnel.pid}`);
  console.log('');

  // Open browser (Commander: --no-browser sets options.browser = false)
  if (options.browser !== false) {
    openBrowser(url);
  }
}
