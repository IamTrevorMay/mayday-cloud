const { app, BrowserWindow, ipcMain, shell, dialog, nativeImage } = require('electron');
const { menubar } = require('menubar');
const path = require('path');
const fs = require('fs');
const { SyncEngine } = require('./sync/sync-engine');
const config = require('./sync/config');
const db = require('./sync/db');
const logger = require('./sync/logger');
const tray = require('./tray');
const auth = require('./auth');

// Single instance lock
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

// Hide dock icon on macOS
if (process.platform === 'darwin') {
  app.dock.hide();
}

let mb = null;
let syncEngine = null;
let setupWindow = null;
let prefsWindow = null;

function getIcon() {
  const assetsDir = path.join(__dirname, '..', 'assets');
  const templatePath = path.join(assetsDir, 'iconTemplate.png');
  const iconPath = path.join(assetsDir, 'icon.png');

  if (process.platform === 'darwin' && fs.existsSync(templatePath)) {
    return nativeImage.createFromPath(templatePath);
  }
  if (fs.existsSync(iconPath)) {
    return nativeImage.createFromPath(iconPath);
  }

  // Fallback: generate a simple 16x16 icon programmatically
  // This is a 16x16 PNG with an upload arrow shape (base64)
  return nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAhElEQVQ4T2NkoBAwUqifAa8BjAwM/xkYGH4zMDD8+c/A8JuBgeE/AwPDfwYGhv8MDIz/GRj+MTIw/Pn/n+EvIyPjH0ZGxj+MjEx/GJmY/jCysPxhZGX9w8jG9oeRnf0PIwfHH0ZOzj+MPDx/GPn4/jAKCPxhFBL6wygs/IdRRISBYusBACT4JhHzQzVaAAAAAElFTkSuQmCC'
  );
}

function createMenubar() {
  const icon = getIcon();

  mb = menubar({
    index: `file://${path.join(__dirname, 'ui', 'index.html')}`,
    icon,
    preloadWindow: true,
    showDockIcon: false,
    browserWindow: {
      width: 320,
      height: 400,
      resizable: false,
      skipTaskbar: true,
      backgroundColor: '#0f1117',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    },
  });

  mb.on('ready', () => {
    logger.info('Menubar ready');
    tray.setup(mb.tray, mb, {
      pause: async () => {
        if (syncEngine) {
          await syncEngine.stop();
          syncEngine.paused = true;
          tray.setState('paused');
        }
      },
      resume: async () => {
        const cfg = config.load();
        if (cfg && config.isValid(cfg)) {
          await startSync(cfg);
        }
      },
      preferences: () => showPreferences(),
    });

    // Check if configured
    const cfg = config.load();
    if (!cfg || !config.isValid(cfg)) {
      showSetup();
    } else {
      startSync(cfg);
    }
  });

  mb.on('after-create-window', () => {
    // Forward sync status updates to renderer
    logger.on('statusUpdate', (status) => {
      if (mb.window && !mb.window.isDestroyed()) {
        mb.window.webContents.send('sync:statusUpdate', status);
      }
    });
  });
}

function showSetup() {
  if (setupWindow && !setupWindow.isDestroyed()) {
    setupWindow.focus();
    return;
  }

  setupWindow = new BrowserWindow({
    width: 440,
    height: 620,
    resizable: false,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0f1117',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  setupWindow.loadFile(path.join(__dirname, 'ui', 'setup.html'));

  // Show dock icon while setup is open (macOS)
  if (process.platform === 'darwin') {
    app.dock.show();
  }

  setupWindow.on('closed', () => {
    setupWindow = null;
    if (process.platform === 'darwin') {
      app.dock.hide();
    }
  });
}

async function startSync(cfg) {
  try {
    await db.init(config.CONFIG_DIR);
    syncEngine = new SyncEngine(cfg);
    tray.setState('syncing');
    await syncEngine.start();
    tray.setState('idle');
  } catch (err) {
    logger.error('Sync engine failed to start:', err.message);
    tray.setState('error');
  }
}

async function stopSync() {
  if (syncEngine) {
    await syncEngine.stop();
    syncEngine = null;
  }
  db.close();
}

// ─── IPC Handlers ───

ipcMain.handle('auth:login', async (_event, { email, password }) => {
  try {
    const result = await auth.login(email, password);
    return { success: true, ...result };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('auth:studioLogin', async (_event, { email, password }) => {
  try {
    const result = await auth.studioLogin(email, password);
    return { success: true, ...result };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('setup:pickFolder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory'],
    title: 'Choose Mayday Cloud Folder',
    defaultPath: path.join(require('os').homedir(), 'Mayday Cloud'),
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

ipcMain.handle('setup:complete', async (_event, { apiUrl, apiKey, localFolder, email, syncMode, syncFolders }) => {
  try {
    // Expand ~ to home directory
    if (localFolder.startsWith('~/')) {
      localFolder = path.join(require('os').homedir(), localFolder.slice(2));
    }

    // Create the sync folder if it doesn't exist
    fs.mkdirSync(localFolder, { recursive: true });

    const cfg = {
      apiUrl, apiKey, localFolder, remoteFolder: '/',
      email,
      syncMode: syncMode || 'bidirectional',
      syncFolders: syncFolders || [],
    };
    config.save(cfg);

    // Start syncing
    if (setupWindow && !setupWindow.isDestroyed()) {
      setupWindow.close();
    }
    await startSync(cfg);

    // Enable launch on login
    app.setLoginItemSettings({ openAtLogin: true });

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('sync:status', () => {
  const cfg = config.load();
  if (!cfg || !config.isValid(cfg)) {
    return { state: 'not_configured' };
  }

  try {
    const counts = db.getCounts();
    const logs = db.getRecentLogs(5);
    const countsObj = {};
    for (const row of counts) {
      countsObj[row.status] = row.count;
    }
    return {
      state: syncEngine ? (syncEngine.running ? 'running' : 'stopped') : 'stopped',
      paused: syncEngine ? syncEngine.paused : false,
      folder: cfg.localFolder,
      counts: countsObj,
      recentLogs: logs,
    };
  } catch {
    return { state: 'stopped', counts: {}, recentLogs: [] };
  }
});

ipcMain.handle('sync:pause', async () => {
  if (syncEngine) {
    await syncEngine.stop();
    syncEngine.paused = true;
    tray.setState('paused');
  }
});

ipcMain.handle('sync:resume', async () => {
  const cfg = config.load();
  if (cfg && config.isValid(cfg)) {
    await startSync(cfg);
  }
});

ipcMain.handle('open:syncFolder', () => {
  const cfg = config.load();
  if (cfg && cfg.localFolder) {
    shell.openPath(cfg.localFolder);
  }
});

ipcMain.handle('open:setup', () => {
  showSetup();
});

ipcMain.handle('remote:list', async (_event, remotePath, tempConfig) => {
  const api = require('./sync/api');
  // Use provided temp config (from setup flow) or fall back to saved config
  const cfg = tempConfig || config.load();
  if (!cfg || (!cfg.apiUrl && !cfg.apiKey)) {
    throw new Error('Not configured');
  }
  return api.listRemote(cfg, remotePath);
});

ipcMain.handle('sync:updateFolders', async (_event, folders) => {
  const cfg = config.load();
  if (!cfg) return { success: false, error: 'Not configured' };

  cfg.syncFolders = folders;
  cfg.syncMode = 'bidirectional';
  config.save(cfg);

  // Restart sync engine with new config
  await stopSync();
  await startSync(cfg);

  return { success: true };
});

ipcMain.handle('open:preferences', () => {
  showPreferences();
});

function showPreferences() {
  if (prefsWindow && !prefsWindow.isDestroyed()) {
    prefsWindow.focus();
    return;
  }

  prefsWindow = new BrowserWindow({
    width: 440,
    height: 520,
    resizable: false,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0f1117',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  prefsWindow.loadFile(path.join(__dirname, 'ui', 'preferences.html'));

  if (process.platform === 'darwin') {
    app.dock.show();
  }

  prefsWindow.on('closed', () => {
    prefsWindow = null;
    if (process.platform === 'darwin') {
      app.dock.hide();
    }
  });
}

// ─── App lifecycle ───

app.on('ready', () => {
  createMenubar();
  require('./auto-updater').init();
});

app.on('window-all-closed', (e) => {
  // Keep running — tray app
  e.preventDefault?.();
});

app.on('before-quit', async () => {
  await stopSync();
});

app.on('second-instance', () => {
  if (mb) mb.showWindow();
});
