'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {spawn} = require('node:child_process');
const directory = path.join(__dirname, 'node_modules', 'electron');
const pathFile = path.join(directory, 'path.txt');
if (!fs.existsSync(pathFile)) {
  console.error('Development Electron runtime is not installed. Run npm run setup:electron explicitly. No runtime was downloaded.');
  process.exitCode = 2;
} else {
  const executable = path.resolve(directory, 'dist', fs.readFileSync(pathFile, 'utf8').trim());
  if (!executable.startsWith(path.join(directory, 'dist') + path.sep) || !fs.existsSync(executable)) {
    console.error('Development Electron runtime is missing or invalid. Run npm run setup:electron explicitly.'); process.exitCode = 2;
  } else {
    const child = spawn(executable, [__dirname], {shell: false, stdio: 'inherit'});
    child.on('error', error => {console.error(error.message); process.exitCode = 2;});
    child.on('exit', code => {process.exitCode = code || 0;});
  }
}
