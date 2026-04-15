// FSL-1.1-Apache-2.0 — see LICENSE
// Creates a standalone daemon bundle with its own node_modules for Electron packaging.
// npm workspaces hoist deps to root, but the packaged app needs them alongside the daemon.
import { execSync } from 'child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'fs';
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

// afterPack.cjs copies node_modules back into the packaged app after electron-builder
// strips them. These ignore files are belt-and-suspenders in case a future electron-builder
// version respects them.
writeFileSync(join(bundleDir, '.npmignore'), '');

// Strip symlinks (.bin/, scoped-package links) — they break macOS codesign
// when afterPack copies node_modules into the signed app bundle.
execSync(`find "${join(bundleDir, 'node_modules')}" -type l -delete 2>/dev/null || true`, { stdio: 'pipe' });
execSync(`find "${join(bundleDir, 'node_modules')}" -name ".bin" -type d -exec rm -rf {} + 2>/dev/null || true`, { stdio: 'pipe' });

const critical = ['express', 'ws', 'minimatch'];
const nmDir = join(bundleDir, 'node_modules');
const missing = critical.filter(dep => !existsSync(join(nmDir, dep)));
if (missing.length) {
  throw new Error(
    `[bundle-daemon] Missing dependencies in bundle: ${missing.join(', ')}. ` +
    `Expected at ${nmDir}`
  );
}

const topLevel = readdirSync(bundleDir);
const nmPackages = existsSync(nmDir) ? readdirSync(nmDir).filter(f => !f.startsWith('.')) : [];
console.log(`[bundle-daemon] Bundle at: ${bundleDir}`);
console.log(`[bundle-daemon] Bundle contents: ${topLevel.join(', ')}`);
console.log(`[bundle-daemon] node_modules: ${nmPackages.length} packages`);
console.log(`[bundle-daemon] Critical: ${critical.map(d => `${d}=${existsSync(join(nmDir, d)) ? 'OK' : 'MISSING'}`).join(', ')}`);
console.log('[bundle-daemon] Done — standalone daemon ready at .daemon-bundle/');
