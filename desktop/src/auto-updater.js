const { app, Notification } = require('electron');
const { autoUpdater } = require('electron-updater');

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const FIRST_CHECK_DELAY_MS = 8 * 1000;

function init() {
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('error', (err) => {
    console.error('[auto-updater] error:', err?.message || err);
  });

  autoUpdater.on('update-available', (info) => {
    console.log('[auto-updater] update available:', info?.version);
  });

  autoUpdater.on('update-not-available', () => {
    console.log('[auto-updater] up to date');
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[auto-updater] downloaded:', info?.version);
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
    });
  }, FIRST_CHECK_DELAY_MS);

  setInterval(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.error('[auto-updater] periodic check failed:', err?.message || err);
    });
  }, CHECK_INTERVAL_MS);
}

module.exports = { init };
