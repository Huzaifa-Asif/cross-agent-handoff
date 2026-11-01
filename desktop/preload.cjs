'use strict';
const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('handoff', Object.freeze({
  status: () => ipcRenderer.invoke('status'),
  choose: kind => ipcRenderer.invoke('choose', kind),
  run: (action, input) => ipcRenderer.invoke('run-engine', action, input),
  cancel: () => ipcRenderer.invoke('cancel-engine'),
  onProgress: callback => {
    if (typeof callback !== 'function') throw new Error('Progress listener must be a function.');
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('migration-progress', listener);
    return () => ipcRenderer.removeListener('migration-progress', listener);
  }
}));
