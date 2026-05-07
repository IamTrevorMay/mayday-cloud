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
const { MountManager } = require('./mount/mount-manager');
const rclone = require('./mount/rclone');
const fuseCheck = require('./mount/fuse-check');
const { validateMountPoint } = require('./mount/validate');
const { MountHealthMonitor } = require('./mount/health');

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
const mountManager = new MountManager();
const healthMonitor = new MountHealthMonitor();

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
      // Auto-start mount if enabled
      if (cfg.mountEnabled && cfg.mountAutoStart) {
        autoStartMount(cfg);
      }
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

// ─── Mount management ───

async function autoStartMount(cfg) {
  try {
    // Validate mount point before attempting
    const validation = validateMountPoint(cfg.mountPoint);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    // Check rclone mount support
    const mountSupport = rclone.checkMountSupport();
    if (!mountSupport.supported) {
      throw new Error(mountSupport.error || 'rclone mount not supported');
    }

    const webdavUrl = cfg.apiUrl.replace(/\/$/, '') + '/api/webdav';
    await mountManager.start({
      apiUrl: webdavUrl,
      apiKey: cfg.apiKey,
      mountPoint: cfg.mountPoint,
      cacheSize: cfg.mountCacheSize || '50G',
      remotePath: cfg.mountRemotePath || '/',
    });
    logger.info(`Mount started at ${cfg.mountPoint}`);
  } catch (err) {
    logger.error('Mount auto-start failed:', err.message);
    // Bug 3: Notify renderer of auto-start failure
    if (mb && mb.window && !mb.window.isDestroyed()) {
      mb.window.webContents.send('mount:autoStartFailed', err.message);
    }
  }
}

mountManager.on('stateChange', (state) => {
  // Forward mount state changes to renderer
  if (mb && mb.window && !mb.window.isDestroyed()) {
    mb.window.webContents.send('mount:stateChange', state);
  }

  // Start/stop health monitor based on mount state
  if (state === 'mounted') {
    const cfg = config.load();
    if (cfg && cfg.mountPoint) {
      healthMonitor.start(cfg.mountPoint);
    }
  } else {
    healthMonitor.stop();
  }
});

mountManager.on('log', (line) => {
  logger.info(`[mount] ${line}`);
});

mountManager.on('fuseError', () => {
  if (mb && mb.window && !mb.window.isDestroyed()) {
    mb.window.webContents.send('mount:fuseError');
  }
});

healthMonitor.on('healthCheckFailed', (error) => {
  logger.error(`[mount] Health check failed: ${error}`);
  if (mb && mb.window && !mb.window.isDestroyed()) {
    mb.window.webContents.send('mount:healthCheckFailed', error);
  }
});

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

// ─── Mount IPC Handlers ───

ipcMain.handle('mount:checkDeps', () => {
  const rcloneVersion = rclone.getVersion();
  const rclonePath = rclone.findRclone();
  const fuse = fuseCheck.checkFuse();
  return {
    rclone: {
      installed: !!rclonePath,
      version: rcloneVersion,
      path: rclonePath,
      installInstructions: rclone.getInstallInstructions(),
    },
    fuse,
  };
});

ipcMain.handle('mount:start', async () => {
  const cfg = config.load();
  if (!cfg || !cfg.apiKey) {
    return { success: false, error: 'Not configured — set up sync first' };
  }

  // Bug 1: Validate mount point before starting
  const validation = validateMountPoint(cfg.mountPoint);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  // Bug 5: Check rclone mount support
  const mountSupport = rclone.checkMountSupport();
  if (!mountSupport.supported) {
    return { success: false, error: mountSupport.error || 'rclone mount not supported' };
  }

  try {
    const webdavUrl = cfg.apiUrl.replace(/\/$/, '') + '/api/webdav';
    await mountManager.start({
      apiUrl: webdavUrl,
      apiKey: cfg.apiKey,
      mountPoint: cfg.mountPoint,
      cacheSize: cfg.mountCacheSize || '50G',
      remotePath: cfg.mountRemotePath || '/',
    });
    // Persist mount enabled state
    cfg.mountEnabled = true;
    config.save(cfg);
    return { success: true, mountPoint: cfg.mountPoint };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('mount:stop', async () => {
  try {
    await mountManager.stop();
    const cfg = config.load();
    if (cfg) {
      cfg.mountEnabled = false;
      config.save(cfg);
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('mount:status', () => {
  const cfg = config.load();
  return {
    state: mountManager.state,
    mounted: mountManager.mounted,
    mountPoint: cfg?.mountPoint || null,
    mountEnabled: cfg?.mountEnabled || false,
    mountAutoStart: cfg?.mountAutoStart || false,
  };
});

ipcMain.handle('mount:pickMountPoint', async () => {
  if (process.platform === 'win32') {
    // On Windows, let user type a drive letter
    return null;
  }
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory'],
    title: 'Choose Mount Point',
    defaultPath: '/Volumes',
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

ipcMain.handle('mount:updateConfig', async (_event, updates) => {
  const cfg = config.load();
  if (!cfg) return { success: false, error: 'Not configured' };

  // Bug 8: Validate mount point before saving
  if (updates.mountPoint !== undefined) {
    const validation = validateMountPoint(updates.mountPoint);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }
    cfg.mountPoint = updates.mountPoint;
  }
  if (updates.mountCacheSize !== undefined) cfg.mountCacheSize = updates.mountCacheSize;
  if (updates.mountAutoStart !== undefined) cfg.mountAutoStart = updates.mountAutoStart;
  if (updates.mountRemotePath !== undefined) cfg.mountRemotePath = updates.mountRemotePath;

  config.save(cfg);

  // If mount is currently active and mount point changed, restart it
  if (mountManager.mounted && updates.mountPoint !== undefined) {
    await mountManager.stop();
    await autoStartMount(cfg);
  }

  return { success: true };
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
  healthMonitor.stop();
  await mountManager.stop();
  await stopSync();
});

app.on('second-instance', () => {
  if (mb) mb.showWindow();
});
