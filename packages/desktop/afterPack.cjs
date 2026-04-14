// FSL-1.1-Apache-2.0 — see LICENSE
const { execSync } = require('child_process');

exports.default = async function (context) {
  const appPath = context.appOutDir;
  console.log(`  • afterPack: stripping FinderInfo from ${appPath}`);
  execSync(`/usr/bin/xattr -rc "${appPath}"`, { stdio: 'inherit' });
  console.log(`  • afterPack: done`);
};
