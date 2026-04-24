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
const moeSourceDir = join(__dirname, '..', '..', 'moe-training');
const moeBundleDir = join(__dirname, '.moe-training-bundle');

function nukeDir(path) {
  if (!existsSync(path)) return;
  if (process.platform === 'win32') {
    rmSync(path, { recursive: true, force: true });
  } else {
    execSync(`rm -rf ${JSON.stringify(path)}`, { stdio: 'ignore' });
  }
}

nukeDir(bundleDir);
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
// Uses Node.js fs instead of Unix find for Windows CI compatibility.
function stripSymlinksAndBinDirs(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      rmSync(full, { force: true });
    } else if (entry.isDirectory()) {
      if (entry.name === '.bin') {
        rmSync(full, { recursive: true, force: true });
      } else {
        stripSymlinksAndBinDirs(full);
      }
    }
  }
}
stripSymlinksAndBinDirs(join(bundleDir, 'node_modules'));

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

// moe-training lives at groove/moe-training (outside packages/) and is imported by
// the daemon via ../../../moe-training/client/index.js. Ship it alongside the daemon
// so the same relative path resolves inside the packaged app (Contents/moe-training/).
nukeDir(moeBundleDir);
mkdirSync(moeBundleDir, { recursive: true });
for (const d of ['client', 'shared']) {
  cpSync(join(moeSourceDir, d), join(moeBundleDir, d), { recursive: true });
}
cpSync(join(moeSourceDir, 'package.json'), join(moeBundleDir, 'package.json'));

execSync('npm install --omit=dev --ignore-scripts', {
  cwd: moeBundleDir,
  stdio: 'inherit',
  env: { ...process.env, npm_config_workspaces: 'false' },
});

writeFileSync(join(moeBundleDir, '.npmignore'), '');
stripSymlinksAndBinDirs(join(moeBundleDir, 'node_modules'));

const moeCritical = ['better-sqlite3'];
const moeNmDir = join(moeBundleDir, 'node_modules');
const moeMissing = moeCritical.filter(dep => !existsSync(join(moeNmDir, dep)));
if (moeMissing.length) {
  throw new Error(
    `[bundle-daemon] Missing moe-training dependencies: ${moeMissing.join(', ')}. ` +
    `Expected at ${moeNmDir}`
  );
}
const moeTopLevel = readdirSync(moeBundleDir);
const moeNmPackages = existsSync(moeNmDir) ? readdirSync(moeNmDir).filter(f => !f.startsWith('.')) : [];
console.log(`[bundle-daemon] moe-training bundle at: ${moeBundleDir}`);
console.log(`[bundle-daemon] moe-training contents: ${moeTopLevel.join(', ')}`);
console.log(`[bundle-daemon] moe-training node_modules: ${moeNmPackages.length} packages`);

console.log('[bundle-daemon] Done — standalone daemon ready at .daemon-bundle/ (+ .moe-training-bundle/)');
