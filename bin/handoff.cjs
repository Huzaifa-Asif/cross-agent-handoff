#!/usr/bin/env node
'use strict';
// Thin local launcher: no install scripts, dependencies, downloads or shell expansion.
const {spawn, spawnSync} = require('node:child_process');
const path = require('node:path');
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--version') {
  console.log('Cross-Agent Handoff 1.0.0');
  process.exit(0);
}
const candidates = process.env.HANDOFF_PYTHON ? [process.env.HANDOFF_PYTHON] :
  ['python3', ...(process.platform === 'darwin' ? ['/opt/homebrew/bin/python3', '/usr/local/bin/python3'] : [])];
const python = candidates.find(candidate => {
  const checked = spawnSync(candidate, ['-I', '-c', 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 3)'], {
    shell: false, encoding: 'utf8', timeout: 10000, maxBuffer: 65536
  });
  return !checked.error && checked.status === 0;
});
if (!python) {
  console.error('Python 3.11+ is required. Install it yourself from python.org or your trusted package manager. Set HANDOFF_PYTHON to its executable path if needed. No runtime was downloaded.');
  process.exit(2);
}
if (process.platform === 'win32') {
  console.error('This release requires macOS or Linux for safe local filesystem operations. Windows is not supported.');
  process.exit(2);
}
if (args.length === 1 && args[0] === '--doctor') {
  console.log('Node and Python prerequisites available. Local processing only; no provider connection.');
  process.exit(0);
}
const environment = Object.fromEntries(['PATH', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TMPDIR']
  .filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
const engine = spawn(python, ['-E', '-s', '-B', path.join(__dirname, '..', 'handoff.py'), ...args], {
  shell: false, stdio: 'inherit', env: environment
});
let interrupted = false;
let fallback;
function pause(signal) {
  interrupted = true;
  engine.kill(signal);
  if (!fallback) {
    fallback = setTimeout(() => engine.kill('SIGKILL'), 5000);
    fallback.unref();
  }
}
const interrupt = () => pause('SIGINT');
const terminate = () => pause('SIGTERM');
process.on('SIGINT', interrupt);
process.on('SIGTERM', terminate);
engine.on('error', () => {
  console.error('Could not launch the local Python engine.');
  process.exitCode = 2;
});
engine.on('close', code => {
  clearTimeout(fallback);
  process.removeListener('SIGINT', interrupt);
  process.removeListener('SIGTERM', terminate);
  process.exit(code === null ? (interrupted ? 130 : 2) : code);
});
