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

  // Status updates (push from main)
  onStatusUpdate: (callback) => {
    ipcRenderer.on('sync:statusUpdate', (_event, status) => callback(status));
  },
});
