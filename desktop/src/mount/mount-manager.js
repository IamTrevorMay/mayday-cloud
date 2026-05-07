const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const EventEmitter = require('events');
const { findRclone, obscurePassword } = require('./rclone');
const config = require('../sync/config');

const DEFAULT_MOUNT_POINT = process.platform === 'darwin'
  ? '/Volumes/Mayday Cloud'
  : process.platform === 'win32'
    ? 'M:'
    : path.join(require('os').homedir(), 'mayday-cloud-mount');

const MAX_RESTART_DELAY = 60000;

// Internal deps — overridable for testing
const _deps = {
  spawn,
  execSync,
  mkdirSync: fs.mkdirSync,
  accessSync: fs.accessSync,
  findRclone,
  obscurePassword,
  configLoad: config.load.bind(config),
};

class MountManager extends EventEmitter {
  constructor() {
    super();
    this._process = null;
    this._state = 'stopped'; // stopped | starting | mounted | error
    this._restartCount = 0;
    this._restartTimer = null;
    this._stopping = false;
  }

  get state() { return this._state; }
  get mounted() { return this._state === 'mounted'; }

  /**
   * Start the rclone mount.
   * @param {object} opts
   * @param {string} opts.apiUrl - WebDAV base URL (e.g. https://cloud-api.maydaystudio.net/api/webdav)
   * @param {string} opts.apiKey - mck_* API key
   * @param {string} opts.mountPoint - Local mount path
   * @param {string} [opts.cacheSize='50G'] - VFS cache max size
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
      cacheSize = '50G',
      remotePath = '/',
    } = opts;

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

    const webdavUrl = apiUrl.replace(/\/$/, '');

    const args = [
      'mount',
      `:webdav:${remotePath}`,
      mountPoint,
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
      '--vfs-cache-max-age=72h',
      '--dir-cache-time=30s',
      '--vfs-write-back=5s',
      '--transfers=4',
      '--no-checksum',
      // Prevent rclone from checking for updates
      '--no-check-certificate=false',
      // Logging
      '--log-level=NOTICE',
    ];

    // Platform-specific flags
    if (process.platform === 'darwin') {
      args.push(`--volname=Mayday Cloud`);
    }

    this._process = _deps.spawn(rclonePath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    this._process.stdout.on('data', (data) => {
      const line = data.toString().trim();
      if (line) {
        this.emit('log', line);
        // rclone logs "Mounting on" when the mount is ready
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
        // Detect common errors
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
        this._scheduleRestart(opts);
      } else {
        this._setState('stopped');
      }
    });

    this._process.on('error', (err) => {
      this._process = null;
      this.emit('log', `rclone spawn error: ${err.message}`);
      this._setState('error');
      if (!this._stopping) {
        this._scheduleRestart(opts);
      }
    });

    // Wait a moment for the mount to establish, then verify
    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        // If still starting after 10s, verify mount point is actually accessible
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

    // Try graceful unmount first
    const mountPoint = this._getMountPointFromArgs();

    if (process.platform === 'win32') {
      try {
        this._process.kill('SIGTERM');
      } catch { /* ignore */ }
    } else {
      // On macOS/Linux, try umount then SIGTERM
      if (mountPoint) {
        try {
          _deps.execSync(`umount "${mountPoint}" 2>/dev/null || true`, { timeout: 5000 });
        } catch { /* ignore */ }
      }
      try {
        this._process.kill('SIGTERM');
      } catch { /* ignore */ }
    }

    // Wait for process to exit
    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        // Force kill if still running
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
    this._setState('stopped');
    this._restartCount = 0;
  }

  _setState(state) {
    if (this._state !== state) {
      this._state = state;
      this.emit('stateChange', state);
    }
  }

  _getMountPointFromArgs() {
    if (!this._process || !this._process.spawnargs) return null;
    // The mount point is the third argument (after 'rclone', 'mount', ':webdav:/')
    const args = this._process.spawnargs;
    const mountIdx = args.indexOf('mount');
    if (mountIdx >= 0 && args.length > mountIdx + 2) {
      return args[mountIdx + 2];
    }
    return null;
  }

  _scheduleRestart(opts) {
    this._restartCount++;
    const delay = Math.min(1000 * Math.pow(2, this._restartCount - 1), MAX_RESTART_DELAY);
    this.emit('log', `Restarting in ${Math.round(delay / 1000)}s (attempt ${this._restartCount})`);

    this._restartTimer = setTimeout(() => {
      this._restartTimer = null;
      if (!this._stopping) {
        // Bug 9: Reload config for fresh opts instead of using stale closure variable
        let freshOpts = opts;
        try {
          const cfg = _deps.configLoad();
          if (cfg && cfg.apiKey && cfg.apiUrl) {
            const webdavUrl = cfg.apiUrl.replace(/\/$/, '') + '/api/webdav';
            freshOpts = {
              apiUrl: webdavUrl,
              apiKey: cfg.apiKey,
              mountPoint: cfg.mountPoint || opts.mountPoint,
              cacheSize: cfg.mountCacheSize || opts.cacheSize || '50G',
              remotePath: cfg.mountRemotePath || opts.remotePath || '/',
            };
          }
        } catch {
          // Config unreadable — fall back to original opts
        }
        this.start(freshOpts).catch((err) => {
          this.emit('log', `Restart failed: ${err.message}`);
          // Bug 4: Set error state when restart fails
          this._setState('error');
        });
      }
    }, delay);
  }
}

module.exports = { MountManager, DEFAULT_MOUNT_POINT, _deps };
