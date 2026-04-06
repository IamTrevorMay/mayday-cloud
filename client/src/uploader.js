const path = require('path');
const api = require('./api');
const db = require('./db');
const logger = require('./logger');

const MAX_CONCURRENCY = 3;
const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 5000, 15000];

class UploadQueue {
  constructor(config, remoteFolder) {
    this.config = config;
    this.remoteFolder = remoteFolder;
    this.queue = [];
    this.active = 0;
    this.activeUploads = new Map(); // relPath → tus Upload instance
    this.draining = false;
    this._drainResolve = null;
  }

  enqueue(localRoot, relPath, size) {
    this.queue.push({ localRoot, relPath, size, attempt: 0 });
    this._tick();
  }

  enqueueDelete(relPath) {
    this.queue.push({ relPath, isDelete: true, attempt: 0 });
    this._tick();
  }

  _tick() {
    while (this.active < MAX_CONCURRENCY && this.queue.length > 0) {
      const job = this.queue.shift();
      this.active++;
      this._process(job).finally(() => {
        this.active--;
        if (this.active === 0 && this.queue.length === 0 && this._drainResolve) {
          this._drainResolve();
        }
        this._tick();
      });
    }
  }

  async _process(job) {
    if (job.isDelete) {
      await this._processDelete(job);
    } else {
      await this._processUpload(job);
    }
  }

  async _processUpload(job) {
    const { localRoot, relPath, size } = job;
    const localPath = path.join(localRoot, relPath);
    const remoteDirPath = path.posix.join(this.remoteFolder, path.dirname(relPath));

    db.markSyncing(relPath);

    try {
      if (size > api.SMALL_FILE_THRESHOLD) {
        logger.info(`Uploading (tus): ${relPath} (${(size / 1024 / 1024).toFixed(1)}MB)`);
        await api.uploadTus(this.config, localPath, remoteDirPath, {
          onProgress: (uploaded, total, pct) => {
            process.stdout.write(`\r  ${relPath}: ${pct}%`);
          },
          onUploadCreated: (upload) => {
            this.activeUploads.set(relPath, upload);
          },
        });
        this.activeUploads.delete(relPath);
        process.stdout.write('\n');
      } else {
        logger.info(`Uploading: ${relPath} (${(size / 1024).toFixed(1)}KB)`);
        await api.uploadSmall(this.config, localPath, remoteDirPath);
      }

      db.markSynced(relPath);
      db.logAction(relPath, 'upload', `${size} bytes`);
      logger.info(`Synced: ${relPath}`);
    } catch (err) {
      this.activeUploads.delete(relPath);
      if (job.attempt < MAX_RETRIES - 1) {
        const delay = RETRY_DELAYS[job.attempt];
        logger.warn(`Upload failed for ${relPath}, retrying in ${delay / 1000}s (attempt ${job.attempt + 1}/${MAX_RETRIES}): ${err.message}`);
        job.attempt++;
        await new Promise(r => setTimeout(r, delay));
        this.queue.push(job);
      } else {
        logger.error(`Upload failed permanently for ${relPath}: ${err.message}`);
        db.markError(relPath);
        db.logAction(relPath, 'error', err.message);
      }
    }
  }

  async _processDelete(job) {
    const { relPath } = job;
    const remotePath = path.posix.join(this.remoteFolder, relPath);

    try {
      logger.info(`Deleting remote: ${relPath}`);
      await api.deleteRemote(this.config, remotePath);
      db.removeFile(relPath);
      db.logAction(relPath, 'delete', 'remote deleted');
    } catch (err) {
      if (job.attempt < MAX_RETRIES - 1) {
        const delay = RETRY_DELAYS[job.attempt];
        logger.warn(`Delete failed for ${relPath}, retrying in ${delay / 1000}s: ${err.message}`);
        job.attempt++;
        await new Promise(r => setTimeout(r, delay));
        this.queue.push(job);
      } else {
        logger.error(`Delete failed permanently for ${relPath}: ${err.message}`);
        db.logAction(relPath, 'error', `delete failed: ${err.message}`);
      }
    }
  }

  /** Wait for all queued and active jobs to complete */
  drain(timeoutMs = 30000) {
    if (this.active === 0 && this.queue.length === 0) return Promise.resolve();
    return new Promise((resolve) => {
      this._drainResolve = resolve;
      this.draining = true;
      setTimeout(() => {
        this._drainResolve = null;
        resolve();
      }, timeoutMs);
    });
  }

  abort() {
    this.queue = [];
    for (const [relPath, upload] of this.activeUploads) {
      try { upload.abort(); } catch {}
    }
    this.activeUploads.clear();
  }
}

module.exports = { UploadQueue };
