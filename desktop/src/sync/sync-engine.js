const fs = require('fs');
const path = require('path');
const api = require('./api');
const db = require('./db');
const scanner = require('./scanner');
const differ = require('./differ');
const remoteScanner = require('./remote-scanner');
const { UploadQueue } = require('./uploader');
const { DownloadQueue } = require('./downloader');
const watcher = require('./watcher');
const logger = require('./logger');

const POLL_INTERVAL_MS = 60000; // 60 seconds

class SyncEngine {
  constructor(config) {
    this.config = config;
    this.localFolder = config.localFolder;
    // API expects relative paths — '/' must become '' to avoid path.posix.join producing absolute paths
    const rf = config.remoteFolder || '/';
    this.remoteFolder = (rf === '/') ? '' : rf;
    this.syncMode = config.syncMode || 'upload-only';
    this.syncFolders = config.syncFolders || [];

    this.queue = new UploadQueue(config, this.remoteFolder);
    this.downloadingPaths = new Set();
    this.downloadQueue = new DownloadQueue(config, this.localFolder, this.remoteFolder, this.downloadingPaths);

    this.createdDirs = new Set();
    this.watcher = null;
    this.poller = null;
    this.running = false;
    this.paused = false;
    this._syncing = false; // guards against overlapping bidirectional syncs
  }

  async start() {
    this.running = true;
    this.paused = false;

    // Health check with retry
    await this._healthCheck();

    if (this.syncMode === 'bidirectional') {
      await this._runBidirectionalSync();
      this._startWatcher();
      this._startPoller();
    } else {
      await this._startupSync();
      this._startWatcher();
    }

    logger.info(`Sync engine running (${this.syncMode}). Watching for changes...`);
    logger.emit('statusUpdate', { state: 'running' });
  }

  async stop() {
    logger.info('Stopping sync engine...');
    this.running = false;

    if (this.poller) {
      clearInterval(this.poller);
      this.poller = null;
    }

    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }

    logger.info('Waiting for active transfers to complete...');
    await Promise.all([
      this.queue.drain(30000),
      this.downloadQueue.drain(30000),
    ]);

    logger.info('Sync engine stopped.');
    logger.emit('statusUpdate', { state: 'stopped' });
  }

  async _healthCheck() {
    const maxRetries = 6;
    const retryInterval = 10000;

    for (let i = 0; i < maxRetries; i++) {
      try {
        const health = await api.checkHealth(this.config);
        if (health.connected) {
          logger.info('Connected to Mayday Cloud');
          return;
        }
      } catch (err) {
        if (i < maxRetries - 1) {
          logger.warn(`Health check failed (attempt ${i + 1}/${maxRetries}): ${err.message}. Retrying in ${retryInterval / 1000}s...`);
          await new Promise(r => setTimeout(r, retryInterval));
        }
      }
    }
    throw new Error('Could not connect to Mayday Cloud after multiple retries');
  }

  // ─── Upload-only startup sync (original behavior) ───

  async _startupSync() {
    logger.info(`Scanning local folder: ${this.localFolder}`);
    const scanned = scanner.scan(this.localFolder);
    logger.info(`Found ${scanned.length} local files`);

    const dbFiles = db.getAllFiles();
    const { toUpload, toDelete, toMkdir } = differ.diff(scanned, dbFiles);

    logger.info(`Diff: ${toUpload.length} to upload, ${toDelete.length} to delete, ${toMkdir.length} dirs to create`);

    // Create remote directories (sequential, parent-first)
    for (const dir of toMkdir) {
      const remoteDir = path.posix.join(this.remoteFolder, dir);
      if (!this.createdDirs.has(remoteDir)) {
        try {
          await api.mkdirRemote(this.config, remoteDir);
          this.createdDirs.add(remoteDir);
        } catch (err) {
          logger.warn(`mkdir failed for ${remoteDir}: ${err.message}`);
        }
      }
    }

    // Update DB and enqueue uploads
    for (const file of toUpload) {
      db.upsertFile(file.relPath, file.size, file.mtimeMs, 'pending');
      this.queue.enqueue(this.localFolder, file.relPath, file.size);
    }

    // Enqueue deletes
    for (const relPath of toDelete) {
      this.queue.enqueueDelete(relPath);
    }
  }

  // ─── Bidirectional sync ───

  async _runBidirectionalSync() {
    if (this._syncing) {
      logger.debug('Bidirectional sync already in progress, skipping');
      return;
    }
    this._syncing = true;

    try {
      // 1. Scan local (filtered to selected folders if any)
      logger.info(`Scanning local folder: ${this.localFolder}`);
      let localFiles = scanner.scan(this.localFolder);

      if (this.syncFolders.length > 0) {
        localFiles = localFiles.filter(f =>
          this.syncFolders.some(sf => f.relPath === sf || f.relPath.startsWith(sf + '/'))
        );
      }
      logger.info(`Found ${localFiles.length} local files`);

      // 2. Scan remote
      logger.info('Scanning remote...');
      const remoteFiles = await remoteScanner.scanRemote(
        this.config, this.syncFolders, this.remoteFolder
      );

      // 3. Load base state from DB
      const baseFiles = db.getAllBaseFiles();

      // 4. Three-way diff
      const result = differ.diffBidirectional(localFiles, remoteFiles, baseFiles);

      logger.info(
        `Bidirectional diff: ${result.toUpload.length} upload, ` +
        `${result.toDownload.length} download, ` +
        `${result.toDeleteLocal.length} delete local, ` +
        `${result.toDeleteRemote.length} delete remote`
      );

      // 5. Create directories on both sides
      for (const dir of result.toMkdirRemote) {
        const remoteDir = path.posix.join(this.remoteFolder, dir);
        if (!this.createdDirs.has(remoteDir)) {
          try {
            await api.mkdirRemote(this.config, remoteDir);
            this.createdDirs.add(remoteDir);
          } catch (err) {
            logger.warn(`Remote mkdir failed for ${remoteDir}: ${err.message}`);
          }
        }
      }

      for (const dir of result.toMkdirLocal) {
        const localDir = path.join(this.localFolder, dir);
        fs.mkdirSync(localDir, { recursive: true });
      }

      // 6. Enqueue uploads
      for (const file of result.toUpload) {
        db.upsertFile(file.relPath, file.size, file.mtimeMs, 'pending');
        this.queue.enqueue(this.localFolder, file.relPath, file.size);
      }

      // 7. Enqueue downloads
      for (const file of result.toDownload) {
        this.downloadQueue.enqueue(file.relPath, file.size, file.mtimeMs);
      }

      // 8. Enqueue local deletes
      for (const relPath of result.toDeleteLocal) {
        this.downloadQueue.enqueueDeleteLocal(relPath);
      }

      // 9. Enqueue remote deletes
      for (const relPath of result.toDeleteRemote) {
        this.queue.enqueueDelete(relPath);
      }

      // 10. Update local/remote state in DB for all scanned files
      for (const f of localFiles) {
        db.updateLocalState(f.relPath, f.size, f.mtimeMs);
      }
      for (const f of remoteFiles) {
        db.updateRemoteState(f.relPath, f.size, f.mtimeMs);
      }
    } catch (err) {
      logger.error(`Bidirectional sync error: ${err.message}`);
    } finally {
      this._syncing = false;
    }
  }

  // ─── Poller for remote changes ───

  _startPoller() {
    this.poller = setInterval(async () => {
      if (!this.running) return;

      // Skip if uploads or downloads are in progress
      if (this.queue.active > 0 || this.downloadQueue.busy) {
        logger.debug('Skipping remote poll — transfers in progress');
        return;
      }

      await this._runBidirectionalSync();
    }, POLL_INTERVAL_MS);
  }

  // ─── File watcher ───

  _startWatcher() {
    this.watcher = watcher.create(this.localFolder, {
      onAdd: (relPath, fullPath) => this._handleAddChange(relPath, fullPath),
      onChange: (relPath, fullPath) => this._handleAddChange(relPath, fullPath),
      onUnlink: (relPath) => this._handleUnlink(relPath),
    });
  }

  async _handleAddChange(relPath, fullPath) {
    if (!this.running) return;

    // Skip files currently being downloaded
    if (this.downloadingPaths.has(relPath)) return;

    // In bidirectional mode, skip files outside selected sync folders
    if (this.syncMode === 'bidirectional' && this.syncFolders.length > 0) {
      const inScope = this.syncFolders.some(sf =>
        relPath === sf || relPath.startsWith(sf + '/')
      );
      if (!inScope) return;
    }

    try {
      const stat = fs.statSync(fullPath);

      const dir = path.dirname(relPath);
      if (dir && dir !== '.') {
        const remoteDir = path.posix.join(this.remoteFolder, dir);
        if (!this.createdDirs.has(remoteDir)) {
          try {
            await api.mkdirRemote(this.config, remoteDir);
            this.createdDirs.add(remoteDir);
          } catch {}
        }
      }

      db.upsertFile(relPath, stat.size, stat.mtimeMs, 'pending');
      this.queue.enqueue(this.localFolder, relPath, stat.size);
    } catch (err) {
      logger.error(`Error handling file ${relPath}: ${err.message}`);
    }
  }

  _handleUnlink(relPath) {
    if (!this.running) return;

    // Skip files currently being downloaded/deleted
    if (this.downloadingPaths.has(relPath)) return;

    const dbFile = db.getFile(relPath);
    if (dbFile) {
      this.queue.enqueueDelete(relPath);
    }
  }
}

module.exports = { SyncEngine };
