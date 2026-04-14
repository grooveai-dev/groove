// FSL-1.1-Apache-2.0 — see LICENSE
// Creates a standalone daemon bundle with its own node_modules for Electron packaging.
// npm workspaces hoist deps to root, but the packaged app needs them alongside the daemon.
import { execSync } from 'child_process';
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const daemonDir = join(__dirname, '..', 'daemon');
const bundleDir = join(__dirname, '.daemon-bundle');

rmSync(bundleDir, { recursive: true, force: true });
mkdirSync(bundleDir, { recursive: true });

cpSync(join(daemonDir, 'src'), join(bundleDir, 'src'), { recursive: true });
cpSync(join(daemonDir, 'package.json'), join(bundleDir, 'package.json'));
for (const f of ['skills-registry.json', 'integrations-registry.json']) {
  try { cpSync(join(daemonDir, f), join(bundleDir, f)); } catch { /* optional */ }
}
for (const d of ['templates']) {
  try { cpSync(join(daemonDir, d), join(bundleDir, d), { recursive: true }); } catch { /* optional */ }
}

execSync('npm install --omit=dev --ignore-scripts', {
  cwd: bundleDir,
  stdio: 'inherit',
  env: { ...process.env, npm_config_workspaces: 'false' },
});

writeFileSync(join(bundleDir, '.npmignore'), '');

const critical = ['express', 'ws', 'minimatch'];
const missing = critical.filter(dep => !existsSync(join(bundleDir, 'node_modules', dep)));
if (missing.length) {
  throw new Error(
    `[bundle-daemon] Missing dependencies in bundle: ${missing.join(', ')}. ` +
    `Expected at ${join(bundleDir, 'node_modules')}`
  );
}

console.log('[bundle-daemon] Done — standalone daemon ready at .daemon-bundle/');
