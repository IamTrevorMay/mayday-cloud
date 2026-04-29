const fs = require('fs');
const path = require('path');
const { Writable } = require('stream');
const api = require('./api');
const db = require('./db');
const logger = require('./logger');

const MAX_CONCURRENCY = 3;
const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 5000, 15000];
const TMP_SUFFIX = '.mck-tmp';

class DownloadQueue {
  constructor(config, localFolder, remoteFolder, downloadingPaths) {
    this.config = config;
    this.localFolder = localFolder;
    this.remoteFolder = remoteFolder;
    this.downloadingPaths = downloadingPaths; // shared Set from SyncEngine
    this.queue = [];
    this.active = 0;
    this._drainResolve = null;
  }

  enqueue(relPath, size, remoteMtimeMs) {
    this.queue.push({ relPath, size, remoteMtimeMs, attempt: 0 });
    this._tick();
  }

  enqueueDeleteLocal(relPath) {
    this.queue.push({ relPath, isDelete: true, attempt: 0 });
    this._tick();
  }

  _tick() {
    while (this.active < MAX_CONCURRENCY && this.queue.length > 0) {
      const job = this.queue.shift();
      this.active++;
      this._process(job).finally(() => {
        this.active--;
        this._emitStatus();
        if (this.active === 0 && this.queue.length === 0 && this._drainResolve) {
          this._drainResolve();
        }
        this._tick();
      });
    }
  }

  _emitStatus() {
    logger.emit('statusUpdate', {
      downloadActive: this.active,
      downloadQueued: this.queue.length,
    });
  }

  async _process(job) {
    if (job.isDelete) {
      await this._processDeleteLocal(job);
    } else {
      await this._processDownload(job);
    }
  }

  async _processDownload(job) {
    const { relPath, size, remoteMtimeMs } = job;
    const localPath = path.join(this.localFolder, relPath);
    const tmpPath = localPath + TMP_SUFFIX;
    const remotePath = path.posix.join(this.remoteFolder, relPath);

    // Register in downloadingPaths so watcher skips this file
    this.downloadingPaths.add(relPath);

    try {
      // Ensure parent directory exists
      fs.mkdirSync(path.dirname(localPath), { recursive: true });

      logger.info(`Downloading: ${relPath} (${(size / 1024).toFixed(1)}KB)`);

      const body = await api.downloadFile(this.config, remotePath);

      // Stream to tmp file
      await _streamToFile(body, tmpPath);

      // Atomic rename
      fs.renameSync(tmpPath, localPath);

      // Preserve remote file's mtime so the differ sees local == remote == base
      if (remoteMtimeMs) {
        const mtime = new Date(remoteMtimeMs);
        fs.utimesSync(localPath, mtime, mtime);
      }

      // Use the remote mtime as the base so all three snapshots agree
      const stat = fs.statSync(localPath);
      db.markBaseSynced(relPath, stat.size, stat.mtimeMs);
      db.logAction(relPath, 'download', `${stat.size} bytes`);
      logger.info(`Downloaded: ${relPath}`);
    } catch (err) {
      // Clean up tmp file
      try { fs.unlinkSync(tmpPath); } catch {}

      if (job.attempt < MAX_RETRIES - 1) {
        const delay = RETRY_DELAYS[job.attempt];
        logger.warn(`Download failed for ${relPath}, retrying in ${delay / 1000}s (attempt ${job.attempt + 1}/${MAX_RETRIES}): ${err.message}`);
        job.attempt++;
        await new Promise(r => setTimeout(r, delay));
        this.queue.push(job);
      } else {
        logger.error(`Download failed permanently for ${relPath}: ${err.message}`);
        db.markError(relPath);
        db.logAction(relPath, 'error', `download failed: ${err.message}`);
      }
    } finally {
      // Clear from downloadingPaths after a delay so the watcher doesn't pick up the rename
      setTimeout(() => {
        this.downloadingPaths.delete(relPath);
      }, 5000);
    }
  }

  async _processDeleteLocal(job) {
    const { relPath } = job;
    const localPath = path.join(this.localFolder, relPath);

    // Register so watcher skips the unlink event
    this.downloadingPaths.add(relPath);

    try {
      if (fs.existsSync(localPath)) {
        logger.info(`Deleting local: ${relPath}`);
        fs.unlinkSync(localPath);
      }
      db.removeFile(relPath);
      db.logAction(relPath, 'delete-local', 'deleted to match remote');
    } catch (err) {
      if (job.attempt < MAX_RETRIES - 1) {
        const delay = RETRY_DELAYS[job.attempt];
        logger.warn(`Local delete failed for ${relPath}, retrying: ${err.message}`);
        job.attempt++;
        await new Promise(r => setTimeout(r, delay));
        this.queue.push(job);
      } else {
        logger.error(`Local delete failed permanently for ${relPath}: ${err.message}`);
      }
    } finally {
      setTimeout(() => {
        this.downloadingPaths.delete(relPath);
      }, 5000);
    }
  }

  drain(timeoutMs = 30000) {
    if (this.active === 0 && this.queue.length === 0) return Promise.resolve();
    return new Promise((resolve) => {
      this._drainResolve = resolve;
      setTimeout(() => {
        this._drainResolve = null;
        resolve();
      }, timeoutMs);
    });
  }

  get busy() {
    return this.active > 0 || this.queue.length > 0;
  }
}

async function _streamToFile(readableStream, filePath) {
  const fileStream = fs.createWriteStream(filePath);

  // Node 18+ fetch returns a web ReadableStream; pipe via async iteration
  const reader = readableStream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const canContinue = fileStream.write(value);
      if (!canContinue) {
        await new Promise(r => fileStream.once('drain', r));
      }
    }
  } finally {
    reader.releaseLock();
  }

  await new Promise((resolve, reject) => {
    fileStream.end();
    fileStream.on('finish', resolve);
    fileStream.on('error', reject);
  });
}

module.exports = { DownloadQueue };
