const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mayday', {
  // Auth
  login: (email, password) => ipcRenderer.invoke('auth:login', { email, password }),
  studioLogin: (email, password) => ipcRenderer.invoke('auth:studioLogin', { email, password }),

  // Setup
  pickFolder: () => ipcRenderer.invoke('setup:pickFolder'),
  completeSetup: (opts) => ipcRenderer.invoke('setup:complete', opts),

  // Remote browsing (tempConfig optional — used during setup before config is saved)
  listRemote: (remotePath, tempConfig) => ipcRenderer.invoke('remote:list', remotePath, tempConfig),

  // Sync
  getStatus: () => ipcRenderer.invoke('sync:status'),
  pause: () => ipcRenderer.invoke('sync:pause'),
  resume: () => ipcRenderer.invoke('sync:resume'),

  // Preferences
  updateSyncFolders: (folders) => ipcRenderer.invoke('sync:updateFolders', folders),

  // Navigation
  openSyncFolder: () => ipcRenderer.invoke('open:syncFolder'),
  openSetup: () => ipcRenderer.invoke('open:setup'),
  openPreferences: () => ipcRenderer.invoke('open:preferences'),

  // Mount
  mountCheckDeps: () => ipcRenderer.invoke('mount:checkDeps'),
  mountStart: () => ipcRenderer.invoke('mount:start'),
  mountStop: () => ipcRenderer.invoke('mount:stop'),
  mountStatus: () => ipcRenderer.invoke('mount:status'),
  mountPickMountPoint: () => ipcRenderer.invoke('mount:pickMountPoint'),
  mountUpdateConfig: (updates) => ipcRenderer.invoke('mount:updateConfig', updates),

  // Status updates (push from main)
  onStatusUpdate: (callback) => {
    ipcRenderer.on('sync:statusUpdate', (_event, status) => callback(status));
  },
  onMountStateChange: (callback) => {
    ipcRenderer.on('mount:stateChange', (_event, state) => callback(state));
  },
  onMountFuseError: (callback) => {
    ipcRenderer.on('mount:fuseError', () => callback());
  },
  onMountAutoStartFailed: (callback) => {
    ipcRenderer.on('mount:autoStartFailed', (_event, error) => callback(error));
  },
  onMountHealthCheckFailed: (callback) => {
    ipcRenderer.on('mount:healthCheckFailed', (_event, error) => callback(error));
  },
});
