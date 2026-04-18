const fs = require('fs');
const path = require('path');
const api = require('./api');
const db = require('./db');
const scanner = require('./scanner');
const differ = require('./differ');
const { UploadQueue } = require('./uploader');
const watcher = require('./watcher');
const logger = require('./logger');

class SyncEngine {
  constructor(config) {
    this.config = config;
    this.localFolder = config.localFolder;
    this.remoteFolder = config.remoteFolder || '/';
    this.queue = new UploadQueue(config, this.remoteFolder);
    this.createdDirs = new Set();
    this.watcher = null;
    this.running = false;
  }

  async start() {
    this.running = true;

    // Health check with retry
    await this._healthCheck();

    // Startup diff sync completes before the watcher starts, so the watcher
    // can't race with the startup scan writing to the same DB rows.
    await this._startupSync();

    // Start live watcher only after startup sync is fully done
    if (this.running) {
      this._startWatcher();
      logger.info('Sync engine running. Watching for changes...');
    }
  }

  async stop() {
    logger.info('Stopping sync engine...');
    this.running = false;

    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }

    // Wait for active uploads to finish (up to 30s)
    logger.info('Waiting for active uploads to complete...');
    await this.queue.drain(30000);

    logger.info('Sync engine stopped.');
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

  _startWatcher() {
    this.watcher = watcher.create(this.localFolder, {
      onAdd: (relPath, fullPath) => this._handleAddChange(relPath, fullPath),
      onChange: (relPath, fullPath) => this._handleAddChange(relPath, fullPath),
      onUnlink: (relPath) => this._handleUnlink(relPath),
    });
  }

  async _handleAddChange(relPath, fullPath) {
    if (!this.running) return;

    let stat;
    try {
      stat = fs.statSync(fullPath);
    } catch (err) {
      // File was deleted between the watcher event and now — skip it
      if (err.code === 'ENOENT') return;
      logger.error(`Error stating file ${relPath}: ${err.message}`);
      return;
    }

    // Skip if file is already synced and unchanged (avoids re-enqueuing
    // files the watcher fires for right after startup sync processed them)
    const existing = db.getFile(relPath);
    if (existing && existing.status === 'synced' &&
        existing.size === stat.size && existing.mtime_ms === stat.mtimeMs) {
      return;
    }

    try {
      // Ensure remote directory exists
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

    const dbFile = db.getFile(relPath);
    if (dbFile) {
      this.queue.enqueueDelete(relPath);
    }
  }
}

module.exports = { SyncEngine };
