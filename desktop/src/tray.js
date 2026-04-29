const { Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

let trayInstance = null;
let mbInstance = null;
let currentState = 'idle';
let onPause = null;
let onResume = null;
let onPreferences = null;

const TOOLTIPS = {
  idle: 'Mayday Cloud — All files synced',
  syncing: 'Mayday Cloud — Syncing...',
  error: 'Mayday Cloud — Sync error',
  paused: 'Mayday Cloud — Paused',
};

function setup(tray, mb, { pause, resume, preferences } = {}) {
  trayInstance = tray;
  mbInstance = mb;
  onPause = pause || null;
  onResume = resume || null;
  onPreferences = preferences || null;
  setState('idle');
  updateContextMenu();
}

function setState(state) {
  currentState = state;
  if (!trayInstance) return;

  trayInstance.setToolTip(TOOLTIPS[state] || 'Mayday Cloud');
  updateContextMenu();
}

function updateContextMenu() {
  if (!trayInstance) return;

  const isPaused = currentState === 'paused';

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open Mayday Cloud Folder',
      click: () => {
        const config = require('./sync/config');
        const { shell } = require('electron');
        const cfg = config.load();
        if (cfg && cfg.localFolder) shell.openPath(cfg.localFolder);
      },
    },
    { type: 'separator' },
    {
      label: isPaused ? 'Resume Syncing' : 'Pause Syncing',
      click: () => {
        if (isPaused) {
          if (onResume) onResume();
        } else {
          if (onPause) onPause();
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Preferences...',
      click: () => {
        if (onPreferences) onPreferences();
      },
    },
    { type: 'separator' },
    {
      label: 'Quit Mayday Cloud',
      click: () => {
        const { app } = require('electron');
        app.quit();
      },
    },
  ]);

  trayInstance.setContextMenu(contextMenu);
}

module.exports = { setup, setState };
