'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const {execFileSync, spawnSync} = require('node:child_process');
const os = require('node:os');
const {environment,installedCandidates} = require('./runtime.cjs');
const {packager} = require('@electron/packager');
const {downloadArtifact} = require('@electron/get');
async function build() {
  const values = process.argv.slice(2);
  if (values.length && (values.length !== 4 || values[0] !== '--platform' || values[2] !== '--arch')) throw new Error('Use --platform win32 --arch x64 or --platform darwin --arch arm64/x64.');
  const platform = values[1] || process.platform, arch = values[3] || process.arch;
  if (!(platform === 'win32' && arch === 'x64') && !(platform === 'darwin' && ['arm64', 'x64'].includes(arch) && process.platform === 'darwin')) throw new Error('Supported build targets: win32 x64, or darwin arm64/x64 on macOS.');
  const python = installedCandidates().find(candidate => spawnSync(candidate[0], [...candidate.slice(1), '-X', 'utf8', '-E', '-s', '-B', '-c', 'import sys;sys.exit(0 if sys.version_info >= (3,11) else 1)'], {windowsHide:true, timeout:5000,env:environment(process.platform,process.env,os.tmpdir())}).status === 0);
  if (!python) throw new Error('Building requires an explicitly installed Python 3.11+ for portable archive creation.');
  const pythonCall = args => execFileSync(python[0], [...python.slice(1), '-X', 'utf8', '-E', '-s', '-B', ...args], {maxBuffer:16*1024*1024, windowsHide:true,env:environment(process.platform,process.env,os.tmpdir())});
  const cacheRoot = path.join(os.tmpdir(), 'handoff-electron-cache');
  const root = path.resolve(__dirname, '..');
  const stage = path.join(__dirname, '.stage');
  const out = path.resolve(process.env.HANDOFF_DESKTOP_OUTPUT || path.join(root, '..', 'desktop-artifacts'));
  await fs.mkdir(out, {recursive: true});
  // Only this fixed, generated staging directory is replaced.
  await fs.rm(stage, {recursive: true, force: true}); await fs.mkdir(stage);
  for (const file of ['main.cjs', 'preload.cjs', 'contracts.cjs', 'runner.cjs', 'progress.cjs', 'runtime.cjs', 'renderer.js', 'styles.css', 'index.html']) await fs.copyFile(path.join(__dirname, file), path.join(stage, file));
  await fs.mkdir(path.join(stage, 'engine'));
  for (const file of ['handoff.py', 'migration.py', 'handoff_mcp.py', 'windows_io.py']) await fs.copyFile(path.join(root, file), path.join(stage, 'engine', file));
  await fs.copyFile(path.join(root, 'LICENSE'), path.join(stage, 'LICENSE'));
  const pkg = JSON.parse(await fs.readFile(path.join(__dirname, 'package.json'), 'utf8'));
  const electronZip = await downloadArtifact({version: pkg.devDependencies.electron, platform, arch, artifactName: 'electron', cacheRoot});
  await fs.mkdir(path.join(stage, 'third-party-notices'));
  for (const file of ['LICENSE', 'LICENSES.chromium.html']) await fs.writeFile(path.join(stage, 'third-party-notices', file), pythonCall(['-c', 'import sys,zipfile;sys.stdout.buffer.write(zipfile.ZipFile(sys.argv[1]).read(sys.argv[2]))', electronZip, file]));
  await fs.writeFile(path.join(stage, 'package.json'), JSON.stringify({name: pkg.name, productName: 'Cross-Agent Handoff', version: pkg.version, main: 'main.cjs', license: 'MIT', description: pkg.description}, null, 2));
  const apps = await packager({dir: stage, out, platform, arch, name: 'Cross-Agent Handoff', appBundleId: 'io.huzaifa.crossagenthandoff', appVersion: pkg.version, buildVersion: pkg.version, electronVersion: pkg.devDependencies.electron, overwrite: true, prune: true, asar: false, osxSign: false, osxNotarize: false, download: {cacheRoot}});
  const folder = apps[0];
  const appPath = platform === 'darwin' ? path.join(folder, 'Cross-Agent Handoff.app') : folder;
  const packaged = platform === 'darwin' ? path.join(appPath, 'Contents', 'Resources', 'app') : path.join(folder, 'resources', 'app');
  for (const file of ['handoff.py', 'migration.py', 'handoff_mcp.py', 'windows_io.py']) {
    const source = await fs.readFile(path.join(root, file));
    const bundled = await fs.readFile(path.join(packaged, 'engine', file));
    if (!source.equals(bundled)) throw new Error('Engine source changed during packaging; rebuild before distributing.');
  }
  for (const file of ['main.cjs','preload.cjs','contracts.cjs','runner.cjs','progress.cjs','runtime.cjs','renderer.js','styles.css','index.html']) {
    if (!(await fs.readFile(path.join(__dirname,file))).equals(await fs.readFile(path.join(packaged,file)))) throw new Error('Desktop source changed during packaging; rebuild before distributing.');
  }
  const archive = path.join(out, `cross-agent-handoff-${pkg.version}-${platform === 'win32' ? 'windows' : 'macos'}-${arch}-unsigned.zip`);
  if (platform === 'darwin') execFileSync('/usr/bin/ditto', ['-c', '-k', '--keepParent', appPath, archive]);
  else pythonCall(['-c', 'import pathlib,sys,zipfile;root=pathlib.Path(sys.argv[1]);z=zipfile.ZipFile(sys.argv[2],"w",zipfile.ZIP_DEFLATED);[z.write(p,p.relative_to(root.parent)) for p in sorted(root.rglob("*")) if p.is_file()];z.close()', folder, archive]);
  console.log(JSON.stringify({app: platform === 'darwin' ? appPath : path.join(folder, 'Cross-Agent Handoff.exe'), archive, platform, arch, signing: platform === 'darwin' ? 'Unsigned and not notarized' : 'Unsigned portable ZIP; not an installer; native Windows execution unverified', runtime: 'Installed Python 3.11+ required; not bundled or silently downloaded'}, null, 2));
}
build().catch(error => {console.error(error.message); process.exitCode = 1;});
