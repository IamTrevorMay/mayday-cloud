const { app, Notification } = require('electron');
const { autoUpdater } = require('electron-updater');

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const FIRST_CHECK_DELAY_MS = 8 * 1000;
const RETRY_DELAY_MS = 60 * 1000; // retry after 1 min on failure
const MAX_RETRIES = 3;

let state = 'idle';
let progress = 0;
let availableVersion = null;
let statusListener = null;
let retryCount = 0;
let retryTimer = null;

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

function scheduleRetry() {
  if (retryCount >= MAX_RETRIES) {
    console.log(`[auto-updater] giving up after ${MAX_RETRIES} retries`);
    return;
  }
  retryCount++;
  console.log(`[auto-updater] retrying in ${RETRY_DELAY_MS / 1000}s (attempt ${retryCount}/${MAX_RETRIES})`);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    autoUpdater.checkForUpdates().catch((err) => {
      console.error('[auto-updater] retry failed:', err?.message || err);
      setState('error');
      scheduleRetry();
    });
  }, RETRY_DELAY_MS);
}

function checkNow() {
  if (!app.isPackaged) return Promise.resolve();
  retryCount = 0;
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  setState('checking');
  return autoUpdater.checkForUpdates().catch((err) => {
    console.error('[auto-updater] check failed:', err?.message || err);
    setState('error');
    scheduleRetry();
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
    scheduleRetry();
  });

  autoUpdater.on('update-available', (info) => {
    console.log('[auto-updater] update available:', info?.version);
    retryCount = 0; // reset on success
    setState('available', { version: info?.version });
  });

  autoUpdater.on('update-not-available', () => {
    console.log('[auto-updater] up to date');
    retryCount = 0;
    setState('idle');
  });

  autoUpdater.on('download-progress', (prog) => {
    setState('downloading', { progress: Math.round(prog.percent) });
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[auto-updater] downloaded:', info?.version);
    retryCount = 0;
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
      scheduleRetry();
    });
  }, FIRST_CHECK_DELAY_MS);

  setInterval(() => {
    retryCount = 0; // reset retries for periodic checks
    autoUpdater.checkForUpdates().catch((err) => {
      console.error('[auto-updater] periodic check failed:', err?.message || err);
      setState('error');
      scheduleRetry();
    });
  }, CHECK_INTERVAL_MS);
}

module.exports = { init, getStatus, onStatus, checkNow, installNow };
