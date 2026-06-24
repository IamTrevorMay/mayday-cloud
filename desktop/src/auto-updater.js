const { app, Notification } = require('electron');
const { autoUpdater } = require('electron-updater');

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const FIRST_CHECK_DELAY_MS = 8 * 1000;

let state = 'idle';
let progress = 0;
let availableVersion = null;
let statusListener = null;

function getStatus() {
  return {
    state,
    progress,
    availableVersion,
    currentVersion: app.getVersion(),
  };
}

function setState(newState, extra) {
  state = newState;
  if (extra?.progress !== undefined) progress = extra.progress;
  if (extra?.version !== undefined) availableVersion = extra.version;
  if (statusListener) statusListener(getStatus());
}

function onStatus(fn) {
  statusListener = fn;
}

function checkNow() {
  if (!app.isPackaged) return Promise.resolve();
  setState('checking');
  return autoUpdater.checkForUpdates().catch((err) => {
    console.error('[auto-updater] check failed:', err?.message || err);
    setState('error');
  });
}

function installNow() {
  autoUpdater.quitAndInstall(false, true);
}

function init() {
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    setState('checking');
  });

  autoUpdater.on('error', (err) => {
    console.error('[auto-updater] error:', err?.message || err);
    setState('error');
  });

  autoUpdater.on('update-available', (info) => {
    console.log('[auto-updater] update available:', info?.version);
    setState('available', { version: info?.version });
  });

  autoUpdater.on('update-not-available', () => {
    console.log('[auto-updater] up to date');
    setState('idle');
  });

  autoUpdater.on('download-progress', (prog) => {
    setState('downloading', { progress: Math.round(prog.percent) });
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[auto-updater] downloaded:', info?.version);
    setState('ready', { version: info?.version });
    if (Notification.isSupported()) {
      new Notification({
        title: 'Mayday Cloud update ready',
        body: `Version ${info?.version} will install the next time you quit.`,
      }).show();
    }
  });

  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.error('[auto-updater] initial check failed:', err?.message || err);
      setState('error');
    });
  }, FIRST_CHECK_DELAY_MS);

  setInterval(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.error('[auto-updater] periodic check failed:', err?.message || err);
      setState('error');
    });
  }, CHECK_INTERVAL_MS);
}

module.exports = { init, getStatus, onStatus, checkNow, installNow };
