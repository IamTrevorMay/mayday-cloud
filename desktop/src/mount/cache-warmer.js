const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const CONCURRENCY = 2;

class CacheWarmer extends EventEmitter {
  constructor(mountPoint) {
    super();
    this.mountPoint = mountPoint;
    this._running = false;
    this._streams = new Set();
    this._queue = [];
    this._active = 0;
    this._current = 0;
    this._total = 0;
    this._bytesWarmed = 0;
    this._bytesTotal = 0;
  }

  get running() {
    return this._running;
  }

  async start(folderPath) {
    if (this._running) return;
    this._running = true;
    this._queue = [];
    this._active = 0;
    this._current = 0;
    this._bytesWarmed = 0;
    this._bytesTotal = 0;

    try {
      const files = await this._walk(folderPath);
      this._total = files.length;
      this._bytesTotal = files.reduce((sum, f) => sum + f.size, 0);

      if (this._total === 0) {
        this._running = false;
        this.emit('done');
        return;
      }

      this._queue = files.slice();
      this._tick();
    } catch (err) {
      this._running = false;
      this.emit('error', err);
    }
  }

  stop() {
    this._running = false;
    this._queue = [];
    for (const stream of this._streams) {
      stream.destroy();
    }
    this._streams.clear();
  }

  _tick() {
    while (this._running && this._active < CONCURRENCY && this._queue.length > 0) {
      const file = this._queue.shift();
      this._active++;
      this._warm(file).finally(() => {
        this._active--;
        if (!this._running) return;
        if (this._active === 0 && this._queue.length === 0) {
          this._running = false;
          this.emit('done');
        } else {
          this._tick();
        }
      });
    }
  }

  async _warm(file) {
    return new Promise((resolve) => {
      if (!this._running) return resolve();

      const rs = fs.createReadStream(file.fullPath, { highWaterMark: 256 * 1024 });
      this._streams.add(rs);

      rs.on('data', (chunk) => {
        this._bytesWarmed += chunk.length;
      });

      rs.on('end', () => {
        this._streams.delete(rs);
        this._current++;
        this._emitProgress(file.relativePath);
        resolve();
      });

      rs.on('error', (err) => {
        this._streams.delete(rs);
        this._current++;
        this.emit('error', err);
        this._emitProgress(file.relativePath);
        resolve();
      });
    });
  }

  _emitProgress(currentFile) {
    this.emit('progress', {
      current: this._current,
      total: this._total,
      currentFile,
      bytesWarmed: this._bytesWarmed,
      bytesTotal: this._bytesTotal,
    });
  }

  async _walk(dirPath) {
    const files = [];
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        const nested = await this._walk(fullPath);
        files.push(...nested);
      } else if (entry.isFile()) {
        try {
          const stat = await fs.promises.stat(fullPath);
          files.push({
            fullPath,
            relativePath: path.relative(this.mountPoint, fullPath),
            size: stat.size,
          });
        } catch {
          // Skip files we can't stat
        }
      }
    }

    return files;
  }
}

module.exports = { CacheWarmer };
