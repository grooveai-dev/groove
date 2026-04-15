// FSL-1.1-Apache-2.0 — see LICENSE
const { cpSync, existsSync, readdirSync, rmSync } = require('fs');
const { execSync } = require('child_process');
const { join } = require('path');

exports.default = async function (context) {
  const appPath = context.appOutDir;
  const platform = context.electronPlatformName;

  // electron-builder strips node_modules from extraResources copies.
  // Copy them back from the source bundle before code signing.
  const sourceNM = join(__dirname, '.daemon-bundle', 'node_modules');
  let resourcesDir;
  if (platform === 'darwin') {
    resourcesDir = join(appPath, 'Groove.app', 'Contents', 'Resources');
  } else {
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
    // npm symlinks (.bin/, scoped-package links) break macOS codesign.
    // Remove all symlinks — not needed at runtime (require() resolves without them).
    const symlinkResult = execSync(`find "${targetNM}" -type l -delete 2>&1; echo "exit:$?"`, { encoding: 'utf8' });
    // Also remove .bin dirs explicitly in case find missed anything
    const binDirs = execSync(`find "${targetNM}" -name ".bin" -type d 2>/dev/null`, { encoding: 'utf8' }).trim();
    for (const binDir of binDirs.split('\n').filter(Boolean)) {
      rmSync(binDir, { recursive: true, force: true });
    }
    console.log(`  • afterPack: removed symlinks from daemon node_modules (codesign compat)`);
    console.log(`  • afterPack: restored ${count} packages (${critical.join(', ')} verified)`);
  } else {
    throw new Error(`afterPack: .daemon-bundle/node_modules not found at ${sourceNM}`);
  }

  if (platform === 'darwin') {
    console.log(`  • afterPack: stripping FinderInfo from ${appPath}`);
    execSync(`/usr/bin/xattr -rc "${appPath}"`, { stdio: 'inherit' });
  }
  console.log(`  • afterPack: done`);
};
