const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const EventEmitter = require('events');
const { findRclone, obscurePassword } = require('./rclone');
const { resolveCacheSize } = require('./cache-size');
const config = require('../sync/config');

const DEFAULT_MOUNT_POINT = process.platform === 'darwin'
  ? path.join(require('os').homedir(), 'Mayday Cloud')
  : process.platform === 'win32'
    ? 'M:'
    : path.join(require('os').homedir(), 'mayday-cloud-mount');

const NFS_PORT = 9049; // High port so no sudo needed
const MAX_RESTART_DELAY = 60000;

// Internal deps — overridable for testing
const _deps = {
  spawn,
  execSync,
  mkdirSync: fs.mkdirSync,
  accessSync: fs.accessSync,
  readdirSync: fs.readdirSync,
  findRclone,
  obscurePassword,
  resolveCacheSize,
  configLoad: config.load.bind(config),
};

class MountManager extends EventEmitter {
  constructor() {
    super();
    this._process = null;      // rclone serve nfs process (macOS) or rclone mount process
    this._state = 'stopped';   // stopped | starting | mounted | error
    this._restartCount = 0;
    this._restartTimer = null;
    this._stopping = false;
    this._mountPoint = null;   // Track mount point for unmount
  }

  get state() { return this._state; }
  get mounted() { return this._state === 'mounted'; }

  /**
   * Start the rclone mount.
   * On macOS, uses rclone serve nfs + mount_nfs (no FUSE/kext required).
   * On other platforms, uses rclone mount with FUSE.
   * @param {object} opts
   * @param {string} opts.apiUrl - WebDAV base URL (e.g. https://cloud-api.maydaystudio.net/api/webdav)
   * @param {string} opts.apiKey - mck_* API key
   * @param {string} opts.mountPoint - Local mount path
   * @param {string} [opts.cacheSize='auto'] - VFS cache max size ('auto' = size from free disk)
   * @param {string} [opts.remotePath='/'] - Remote subpath to mount
   */
  async start(opts) {
    if (this._process) {
      throw new Error('Mount already active');
    }

    const rclonePath = _deps.findRclone();
    if (!rclonePath) {
      throw new Error('rclone not found. Please install rclone first.');
    }

    this._stopping = false;
    this._setState('starting');

    const {
      apiUrl,
      apiKey,
      mountPoint = DEFAULT_MOUNT_POINT,
      cacheSize = 'auto',
      remotePath = '/',
    } = opts;

    // Resolve dynamic cache sizing ('auto' → fraction of free disk).
    const resolvedCacheSize = _deps.resolveCacheSize(cacheSize);
    if (resolvedCacheSize !== cacheSize) {
      this.emit('log', `Cache size auto-sized to ${resolvedCacheSize} (from free disk)`);
    }

    // Ensure mount point directory exists (macOS/Linux)
    if (process.platform !== 'win32') {
      try {
        _deps.mkdirSync(mountPoint, { recursive: true });
      } catch (err) {
        this._setState('error');
        throw new Error(`Cannot create mount point: ${err.message}`);
      }
    }

    // Obscure the API key for the command line
    let obscuredKey;
    try {
      obscuredKey = _deps.obscurePassword(apiKey);
    } catch (err) {
      this._setState('error');
      throw new Error(`Failed to obscure API key: ${err.message}`);
    }

    this._mountPoint = mountPoint;
    const webdavUrl = apiUrl.replace(/\/$/, '');

    if (process.platform === 'darwin') {
      await this._startNfs(rclonePath, { webdavUrl, obscuredKey, mountPoint, cacheSize: resolvedCacheSize, remotePath });
    } else {
      await this._startFuse(rclonePath, { webdavUrl, obscuredKey, mountPoint, cacheSize: resolvedCacheSize, remotePath, opts });
    }
  }

  /**
   * macOS: Start rclone serve nfs, then mount via mount_nfs.
   * No FUSE or kernel extensions required.
   */
  async _startNfs(rclonePath, { webdavUrl, obscuredKey, mountPoint, cacheSize, remotePath }) {
    const args = [
      'serve', 'nfs',
      `:webdav:${remotePath}`,
      `--webdav-url=${webdavUrl}`,
      '--webdav-user=apikey',
      `--webdav-pass=${obscuredKey}`,
      '--webdav-bearer-token=false',
      // VFS caching optimized for video editing
      '--vfs-cache-mode=full',
      `--vfs-cache-max-size=${cacheSize}`,
      '--vfs-read-chunk-size=128M',
      '--vfs-read-ahead=512M',
      '--buffer-size=256M',
      '--vfs-cache-max-age=168h',
      '--dir-cache-time=1h',
      '--vfs-write-back=5s',
      '--transfers=4',
      '--no-checksum',
      `--addr=localhost:${NFS_PORT}`,
      '--log-level=NOTICE',
    ];

    this._process = _deps.spawn(rclonePath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let nfsReady = false;

    this._process.stdout.on('data', (data) => {
      const line = data.toString().trim();
      if (line) this.emit('log', line);
    });

    this._process.stderr.on('data', (data) => {
      const line = data.toString().trim();
      if (line) {
        this.emit('log', `[err] ${line}`);
        // Detect NFS server ready
        if (line.includes('NFS Server running')) {
          nfsReady = true;
        }
      }
    });

    this._process.on('close', (code) => {
      this._process = null;
      // Unmount if still mounted
      this._unmountNfs(mountPoint);

      if (this._stopping) {
        this._setState('stopped');
        return;
      }
      if (code !== 0) {
        this.emit('log', `rclone exited with code ${code}`);
        this._setState('error');
        this._scheduleRestart({ apiUrl: webdavUrl, apiKey: '', mountPoint, cacheSize, remotePath });
      } else {
        this._setState('stopped');
      }
    });

    let spawnErrored = false;
    this._process.on('error', (err) => {
      spawnErrored = true;
      this._process = null;
      this.emit('log', `rclone spawn error: ${err.message}`);
      this._setState('error');
    });

    // Wait for NFS server to be ready
    const serverReady = await new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(false), 10000);
      const check = setInterval(() => {
        if (nfsReady) {
          clearInterval(check);
          clearTimeout(timeout);
          resolve(true);
        }
        if (spawnErrored) {
          clearInterval(check);
          clearTimeout(timeout);
          resolve(false);
        }
      }, 200);
      this._process?.once('close', () => {
        clearInterval(check);
        clearTimeout(timeout);
        resolve(false);
      });
    });

    if (!serverReady) {
      this.emit('log', 'NFS server failed to start');
      this._setState('error');
      return;
    }

    // Mount via mount_nfs
    try {
      _deps.execSync(
        `mount_nfs -o "vers=3,tcp,nolocks,locallocks,port=${NFS_PORT},mountport=${NFS_PORT}" localhost:/ "${mountPoint}"`,
        { timeout: 10000 }
      );
    } catch (err) {
      this.emit('log', `mount_nfs failed: ${err.message}`);
      // Kill the NFS server since mount failed
      try { this._process.kill('SIGTERM'); } catch { /* ignore */ }
      this._process = null;
      this._setState('error');
      return;
    }

    // Verify the mount is accessible
    try {
      _deps.readdirSync(mountPoint);
      this._setState('mounted');
      this._restartCount = 0;
      this.emit('log', `Mounted at ${mountPoint} via NFS`);
    } catch (err) {
      this.emit('log', `Mount verification failed: ${err.message}`);
      this._unmountNfs(mountPoint);
      try { this._process.kill('SIGTERM'); } catch { /* ignore */ }
      this._process = null;
      this._setState('error');
    }
  }

  /**
   * Non-macOS: Start rclone mount with FUSE (original approach).
   */
  async _startFuse(rclonePath, { webdavUrl, obscuredKey, mountPoint, cacheSize, remotePath, opts }) {
    const args = [
      'mount',
      `:webdav:${remotePath}`,
      mountPoint,
      `--webdav-url=${webdavUrl}`,
      '--webdav-user=apikey',
      `--webdav-pass=${obscuredKey}`,
      '--webdav-bearer-token=false',
      '--vfs-cache-mode=full',
      `--vfs-cache-max-size=${cacheSize}`,
      '--vfs-read-chunk-size=128M',
      '--vfs-read-ahead=512M',
      '--buffer-size=256M',
      '--vfs-cache-max-age=168h',
      '--dir-cache-time=1h',
      '--vfs-write-back=5s',
      '--transfers=4',
      '--no-checksum',
      '--no-check-certificate=false',
      '--log-level=NOTICE',
    ];

    this._process = _deps.spawn(rclonePath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    this._process.stdout.on('data', (data) => {
      const line = data.toString().trim();
      if (line) {
        this.emit('log', line);
        if (line.includes('Mounting on') || line.includes('vfs cache')) {
          this._setState('mounted');
          this._restartCount = 0;
        }
      }
    });

    this._process.stderr.on('data', (data) => {
      const line = data.toString().trim();
      if (line) {
        this.emit('log', `[err] ${line}`);
        if (line.includes('mount helper error') || line.includes('FUSE')) {
          this.emit('fuseError', line);
        }
      }
    });

    this._process.on('close', (code) => {
      this._process = null;
      if (this._stopping) {
        this._setState('stopped');
        return;
      }
      if (code !== 0) {
        this.emit('log', `rclone exited with code ${code}`);
        this._setState('error');
        if (opts) this._scheduleRestart(opts);
      } else {
        this._setState('stopped');
      }
    });

    this._process.on('error', (err) => {
      this._process = null;
      this.emit('log', `rclone spawn error: ${err.message}`);
      this._setState('error');
      if (!this._stopping && opts) {
        this._scheduleRestart(opts);
      }
    });

    // Wait for mount to establish
    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        if (this._state === 'starting') {
          try {
            _deps.accessSync(mountPoint);
            this._setState('mounted');
            this._restartCount = 0;
          } catch {
            this.emit('log', 'Mount point not accessible after timeout');
            this._setState('error');
          }
        }
        resolve();
      }, 10000);

      const onState = (state) => {
        if (state === 'mounted' || state === 'error' || state === 'stopped') {
          clearTimeout(timeout);
          this.removeListener('stateChange', onState);
          resolve();
        }
      };
      this.on('stateChange', onState);
    });
  }

  /**
   * Stop the mount gracefully.
   */
  async stop() {
    this._stopping = true;

    if (this._restartTimer) {
      clearTimeout(this._restartTimer);
      this._restartTimer = null;
    }

    if (!this._process) {
      this._setState('stopped');
      return;
    }

    const mountPoint = this._mountPoint;

    // Unmount the filesystem first
    if (mountPoint && process.platform !== 'win32') {
      this._unmountNfs(mountPoint);
    }

    // Kill the rclone process
    try {
      this._process.kill('SIGTERM');
    } catch { /* ignore */ }

    // Wait for process to exit
    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        if (this._process) {
          try { this._process.kill('SIGKILL'); } catch { /* ignore */ }
        }
        resolve();
      }, 5000);

      if (this._process) {
        this._process.once('close', () => {
          clearTimeout(timeout);
          resolve();
        });
      } else {
        clearTimeout(timeout);
        resolve();
      }
    });

    this._process = null;
    this._mountPoint = null;
    this._setState('stopped');
    this._restartCount = 0;
  }

  _unmountNfs(mountPoint) {
    if (!mountPoint) return;
    try {
      _deps.execSync(`umount "${mountPoint}" 2>/dev/null || true`, { timeout: 5000 });
    } catch { /* ignore */ }
  }

  _setState(state) {
    if (this._state !== state) {
      this._state = state;
      this.emit('stateChange', state);
    }
  }

  _scheduleRestart(opts) {
    this._restartCount++;
    const delay = Math.min(1000 * Math.pow(2, this._restartCount - 1), MAX_RESTART_DELAY);
    this.emit('log', `Restarting in ${Math.round(delay / 1000)}s (attempt ${this._restartCount})`);

    this._restartTimer = setTimeout(() => {
      this._restartTimer = null;
      if (!this._stopping) {
        let freshOpts = opts;
        try {
          const cfg = _deps.configLoad();
          if (cfg && cfg.apiKey && cfg.apiUrl) {
            const baseUrl = (cfg.mountApiUrl || cfg.apiUrl).replace(/\/$/, '');
            const webdavUrl = baseUrl + '/api/webdav';
            freshOpts = {
              apiUrl: webdavUrl,
              apiKey: cfg.apiKey,
              mountPoint: cfg.mountPoint || opts.mountPoint,
              cacheSize: cfg.mountCacheSize || opts.cacheSize || 'auto',
              remotePath: cfg.mountRemotePath || opts.remotePath || '/',
            };
          }
        } catch {
          // Config unreadable — fall back to original opts
        }
        this.start(freshOpts).catch((err) => {
          this.emit('log', `Restart failed: ${err.message}`);
          this._setState('error');
        });
      }
    }, delay);
  }
}

module.exports = { MountManager, DEFAULT_MOUNT_POINT, NFS_PORT, _deps };
