'use strict';
const {app, BrowserWindow, dialog, ipcMain, protocol, net, session, Menu} = require('electron');
const {randomUUID} = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {command} = require('./contracts.cjs');
const {startProcess} = require('./runner.cjs');
const {environment:runtimeEnvironment, discoverPython} = require('./runtime.cjs');
const RENDERER_URL = 'handoff://app/index.html';
protocol.registerSchemesAsPrivileged([{scheme: 'handoff', privileges: {standard: true, secure: true, supportFetchAPI: false, corsEnabled: false}}]);
let window, child = null, python = null, runtimeVersion = null, closingAllowed = false;
const handles = new Map();
const allowedAssets = new Set(['index.html', 'renderer.js', 'styles.css']);
function assertSender(event) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== RENDERER_URL) throw new Error('Untrusted app request.');
}
function resolveHandle(id, kind) {
  const selected = handles.get(id);
  if (!selected || selected.kind !== kind) throw new Error('Choose this file or folder again using the app.');
  return selected.path;
}
function enginePath() {
  return app.isPackaged ? path.join(app.getAppPath(), 'engine', 'handoff.py') : path.join(__dirname, '..', 'handoff.py');
}
function environment() {return runtimeEnvironment(process.platform,process.env,app.getPath('temp'));}
function capture(executable, args, options = {}) {
  const job = startProcess(executable, args, {...options, env:environment(), cwd:app.getPath('temp')});
  child = job;
  return job.promise.finally(() => {if (child === job) child = null;});
}
async function findPython() {
  const runtime = await discoverPython(enginePath(),capture);
  if(runtime){python=runtime.executable;runtimeVersion=runtime.version;}
}
async function choose(kind) {
  if (child) throw new Error('Wait for the current operation or cancel it first.');
  const titles = {source: 'Select an export you downloaded', task: 'Select a task handoff JSON', workspace: 'Resume a local migration library', 'task-output': 'Save a new task handoff', 'reference-output': 'Save a reference document', 'new-workspace': 'Choose a new migration library location', 'export-output': 'Choose a new portable reference folder'};
  if (!titles[kind]) throw new Error('Unsupported file selection.');
  let selected;
  if (['source', 'task', 'workspace'].includes(kind)) {
    const result = await dialog.showOpenDialog(window, {title: titles[kind], properties: kind === 'workspace' ? ['openDirectory'] : ['openFile']});
    if (result.canceled) return null;
    selected = result.filePaths[0];
  } else {
    const defaults = {'task-output': 'task-handoff.json', 'reference-output': 'handoff-reference.md', 'new-workspace': 'migration-library', 'export-output': 'portable-reference-library'};
    const result = await dialog.showSaveDialog(window, {title: titles[kind], defaultPath: path.join(app.getPath('documents'), defaults[kind]), buttonLabel: 'Choose location', properties: ['createDirectory', 'showOverwriteConfirmation']});
    if (result.canceled || !result.filePath) return null;
    selected = result.filePath;
    if (fs.existsSync(selected)) throw new Error('Choose a new destination. Existing files and folders are never overwritten.');
  }
  // Resolve POSIX system aliases for explicit selections. Preserve Windows path components
  // so the engine can reject ancestor junctions/reparse points rather than following them here.
  if (['source', 'task', 'workspace'].includes(kind)) {
    const info = fs.lstatSync(selected);
    if (info.isSymbolicLink()) throw new Error('Select a real file or directory, not a symbolic link.');
    selected = process.platform === 'win32' ? path.resolve(selected) : fs.realpathSync.native(selected);
  } else selected = process.platform === 'win32' ? path.resolve(selected) : path.join(fs.realpathSync.native(path.dirname(selected)), path.basename(selected));
  const id = randomUUID();
  handles.set(id, {path: selected, kind: kind === 'new-workspace' ? 'workspace' : kind});
  return {handle: id, label: selected};
}
app.whenReady().then(async () => {
  // An ephemeral session prevents imported content and selected paths being stored in browser caches.
  const privateSession = session.fromPartition('handoff-local');
  privateSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  privateSession.setPermissionCheckHandler(() => false);
  privateSession.webRequest.onBeforeRequest((details, callback) => callback({cancel: !details.url.startsWith('handoff://app/') && !details.url.startsWith('devtools://')}));
  privateSession.protocol.handle('handoff', request => {
    const url = new URL(request.url);
    const asset = url.pathname.slice(1);
    if (url.hostname !== 'app' || !allowedAssets.has(asset) || url.search || url.hash) return new Response('Not found', {status: 404});
    return net.fetch(pathToFileURL(path.join(__dirname, asset)).toString());
  });
  window = new BrowserWindow({width: 1180, height: 850, minWidth: 900, minHeight: 680, title: 'Cross-Agent Handoff', backgroundColor: '#f5f4ee', show: false,
    webPreferences: {preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, webviewTag: false, session: privateSession, spellcheck: false}});
  window.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  Menu.setApplicationMenu(Menu.buildFromTemplate([...(process.platform === 'darwin' ? [{role: 'appMenu'}] : [{label: 'File', submenu: [{role: 'quit'}]}]), {role: 'editMenu'}, {role: 'viewMenu', submenu: [{role: 'resetZoom'}, {role: 'zoomIn'}, {role: 'zoomOut'}]}, {role: 'windowMenu'}]));
  ipcMain.handle('status', event => {assertSender(event); return {ready: Boolean(python), python: runtimeVersion, version: app.getVersion(), platform: process.platform};});
  ipcMain.handle('choose', async (event, kind) => {assertSender(event); return choose(kind);});
  ipcMain.handle('run-engine', async (event, action, input) => {
    assertSender(event);
    if (child) throw new Error('An operation is already running.');
    if (!python) throw new Error('Install Python 3.11 or newer from python.org, then reopen this app. No runtime is downloaded automatically.');
    const args = command(action, input, resolveHandle);
    const output = await capture(python, ['-X', 'utf8', '-E', '-s', '-B', enginePath(), ...args], {
      allowPause:action === 'migration-run' || action === 'migration-plan',
      onProgress:progress => {if (window && !window.isDestroyed()) window.webContents.send('migration-progress', {...progress, operation:action});}
    });
    if (action === 'task-new') {
      const file = resolveHandle(input.output, 'task-output');
      const id = randomUUID(); handles.set(id, {path: file, kind: 'task'});
      return {saved: true, task: {handle: id, label: file}};
    }
    if (action === 'task-export') return {saved: true};
    return JSON.parse(output);
  });
  ipcMain.handle('cancel-engine', event => {assertSender(event); if (child?.cancel) child.cancel(); return true;});
  await findPython();
  await window.loadURL(RENDERER_URL);
  window.show();
  window.on('close', event => {
    if (child && !closingAllowed) {
      event.preventDefault(); const job = child; job.cancel();
      job.promise.catch(() => {}).finally(() => {closingAllowed = true; if (window) window.close();});
    }
  });
  window.on('closed', () => {window = null;});
});
app.on('window-all-closed', () => app.quit());
