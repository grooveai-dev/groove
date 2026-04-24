// FSL-1.1-Apache-2.0 — see LICENSE
const { cpSync, existsSync, readdirSync, rmSync } = require('fs');
const { execSync } = require('child_process');
const { join } = require('path');

// npm symlinks (.bin/, scoped-package links) break macOS codesign.
// Remove all symlinks — not needed at runtime (require() resolves without them).
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

exports.default = async function (context) {
  const appPath = context.appOutDir;
  const platform = context.electronPlatformName;

  // electron-builder strips node_modules from extraResources copies.
  // Copy them back from the source bundle before code signing.
  const sourceNM = join(__dirname, '.daemon-bundle', 'node_modules');
  let resourcesDir;
  let contentsDir;
  if (platform === 'darwin') {
    contentsDir = join(appPath, 'Groove.app', 'Contents');
    resourcesDir = join(contentsDir, 'Resources');
  } else {
    contentsDir = appPath;
    resourcesDir = join(appPath, 'resources');
  }
  const targetNM = join(resourcesDir, 'daemon', 'node_modules');

  if (existsSync(sourceNM)) {
    console.log(`  • afterPack: copying daemon node_modules to ${targetNM}`);
    cpSync(sourceNM, targetNM, { recursive: true });
    const count = readdirSync(targetNM).filter(f => !f.startsWith('.')).length;
    const critical = ['express', 'ws', 'minimatch'];
    const missing = critical.filter(d => !existsSync(join(targetNM, d)));
    if (missing.length) {
      throw new Error(`afterPack: critical deps missing after copy: ${missing.join(', ')}`);
    }
    stripSymlinksAndBinDirs(targetNM);
    console.log(`  • afterPack: removed symlinks from daemon node_modules (codesign compat)`);
    console.log(`  • afterPack: restored ${count} packages (${critical.join(', ')} verified)`);
  } else {
    throw new Error(`afterPack: .daemon-bundle/node_modules not found at ${sourceNM}`);
  }

  // Restore moe-training/node_modules (extraFiles strips them the same way).
  const moeSourceNM = join(__dirname, '.moe-training-bundle', 'node_modules');
  const moeTargetNM = join(contentsDir, 'moe-training', 'node_modules');
  if (existsSync(moeSourceNM)) {
    console.log(`  • afterPack: copying moe-training node_modules to ${moeTargetNM}`);
    cpSync(moeSourceNM, moeTargetNM, { recursive: true });
    const moeCritical = ['better-sqlite3'];
    const moeMissing = moeCritical.filter(d => !existsSync(join(moeTargetNM, d)));
    if (moeMissing.length) {
      throw new Error(`afterPack: moe-training deps missing after copy: ${moeMissing.join(', ')}`);
    }
    stripSymlinksAndBinDirs(moeTargetNM);
    const moeCount = readdirSync(moeTargetNM).filter(f => !f.startsWith('.')).length;
    console.log(`  • afterPack: restored ${moeCount} moe-training packages (${moeCritical.join(', ')} verified)`);

    if (platform === 'darwin') {
      const nativeBin = join(moeTargetNM, 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');
      if (existsSync(nativeBin)) {
        try {
          execSync(`/usr/bin/codesign --force --sign - --timestamp "${nativeBin}"`, { stdio: 'pipe' });
          console.log(`  • afterPack: ad-hoc signed ${nativeBin}`);
        } catch (err) {
          console.warn(`  • afterPack: codesign of better_sqlite3.node failed (non-fatal): ${err.message}`);
        }
      }
    }
  } else {
    throw new Error(`afterPack: .moe-training-bundle/node_modules not found at ${moeSourceNM}`);
  }

  if (platform === 'darwin') {
    console.log(`  • afterPack: stripping FinderInfo from ${appPath}`);
    execSync(`/usr/bin/xattr -rc "${appPath}"`, { stdio: 'inherit' });
  }
  console.log(`  • afterPack: done`);
};
