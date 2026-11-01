'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {packager} = require('@electron/packager');
const {downloadArtifact} = require('@electron/get');
async function build() {
  if (process.platform !== 'darwin') throw new Error('This release build script currently supports macOS only. Other native platforms are unverified.');
  const root = path.resolve(__dirname, '..');
  const stage = path.join(__dirname, '.stage');
  const out = path.resolve(process.env.HANDOFF_DESKTOP_OUTPUT || path.join(root, '..', 'desktop-artifacts'));
  await fs.mkdir(out, {recursive: true});
  // Only this fixed, generated staging directory is replaced.
  await fs.rm(stage, {recursive: true, force: true}); await fs.mkdir(stage);
  for (const file of ['main.cjs', 'preload.cjs', 'contracts.cjs', 'runner.cjs', 'progress.cjs', 'renderer.js', 'styles.css', 'index.html']) await fs.copyFile(path.join(__dirname, file), path.join(stage, file));
  await fs.mkdir(path.join(stage, 'engine'));
  for (const file of ['handoff.py', 'migration.py', 'handoff_mcp.py']) await fs.copyFile(path.join(root, file), path.join(stage, 'engine', file));
  await fs.copyFile(path.join(root, 'LICENSE'), path.join(stage, 'LICENSE'));
  const pkg = JSON.parse(await fs.readFile(path.join(__dirname, 'package.json'), 'utf8'));
  const electronZip = await downloadArtifact({version: pkg.devDependencies.electron, platform: 'darwin', arch: process.arch, artifactName: 'electron', cacheRoot: '/tmp/handoff-electron-cache'});
  await fs.mkdir(path.join(stage, 'third-party-notices'));
  for (const file of ['LICENSE', 'LICENSES.chromium.html']) await fs.writeFile(path.join(stage, 'third-party-notices', file), execFileSync('/usr/bin/unzip', ['-p', electronZip, file], {maxBuffer: 16 * 1024 * 1024}));
  await fs.writeFile(path.join(stage, 'package.json'), JSON.stringify({name: pkg.name, productName: 'Cross-Agent Handoff', version: pkg.version, main: 'main.cjs', license: 'MIT', description: pkg.description}, null, 2));
  const apps = await packager({dir: stage, out, platform: 'darwin', arch: process.arch, name: 'Cross-Agent Handoff', appBundleId: 'io.huzaifa.crossagenthandoff', appVersion: pkg.version, buildVersion: pkg.version, electronVersion: pkg.devDependencies.electron, overwrite: true, prune: true, asar: false, osxSign: false, osxNotarize: false, download: {cacheRoot: '/tmp/handoff-electron-cache'}});
  const folder = apps[0];
  const packaged = path.join(folder, 'Cross-Agent Handoff.app', 'Contents', 'Resources', 'app');
  for (const file of ['handoff.py', 'migration.py', 'handoff_mcp.py']) {
    const source = await fs.readFile(path.join(root, file));
    const bundled = await fs.readFile(path.join(packaged, 'engine', file));
    if (!source.equals(bundled)) throw new Error('Engine source changed during packaging; rebuild before distributing.');
  }
  const archive = path.join(out, `cross-agent-handoff-${pkg.version}-macos-${process.arch}-unsigned.zip`);
  execFileSync('/usr/bin/ditto', ['-c', '-k', '--keepParent', path.join(folder, 'Cross-Agent Handoff.app'), archive]);
  console.log(JSON.stringify({app: path.join(folder, 'Cross-Agent Handoff.app'), archive, signing: 'Unsigned and not notarized', runtime: 'Installed Python 3.11+ required; not bundled or silently downloaded'}, null, 2));
}
build().catch(error => {console.error(error.message); process.exitCode = 1;});
