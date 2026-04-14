// FSL-1.1-Apache-2.0 — see LICENSE
process.env.GROOVE_EDITION = 'pro';

const portArg = parseInt(process.argv[2], 10);
const port = Number.isNaN(portArg) ? 31415 : portArg;
const projectDir = process.argv[3] || process.cwd();

async function main() {
  let Daemon;

  if (process.env.GROOVE_DAEMON_PATH) {
    const mod = await import(process.env.GROOVE_DAEMON_PATH);
    Daemon = mod.Daemon;
  } else {
    const mod = await import('@groove-dev/daemon');
    Daemon = mod.Daemon;
  }

  const daemon = new Daemon({ port, projectDir });
  await daemon.start();

  process.send({ type: 'ready', port: daemon.port });

  process.on('message', (msg) => {
    if (msg.type === 'auth-token') {
      try { daemon.setAuthToken(msg.token); } catch (err) {
        process.stderr.write(`[daemon-bridge] setAuthToken failed: ${err.message}\n`);
      }
    }
  });

  process.on('SIGTERM', async () => {
    await daemon.stop();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    await daemon.stop();
    process.exit(0);
  });
}

main().catch((err) => {
  if (process.send) {
    process.send({ type: 'error', message: err.message });
  }
  process.exit(1);
});
