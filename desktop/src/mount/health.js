const { execFile } = require('child_process');
const EventEmitter = require('events');

const DEFAULT_INTERVAL = 30000; // 30 seconds
const CHECK_TIMEOUT = 10000;    // 10 seconds — if ls doesn't return, mount is hung

// Internal deps — overridable for testing
const _deps = {
  execFile,
};

class MountHealthMonitor extends EventEmitter {
  constructor(interval = DEFAULT_INTERVAL) {
    super();
    this._interval = interval;
    this._timer = null;
    this._mountPoint = null;
    this._running = false;
    this._checkInFlight = false;
  }

  get running() { return this._running; }

  /**
   * Start health monitoring for the given mount point.
   * @param {string} mountPoint
   */
  start(mountPoint) {
    this.stop(); // Clear any existing monitor
    this._mountPoint = mountPoint;
    this._running = true;
    this._timer = setInterval(() => this._check(), this._interval);
  }

  /**
   * Stop health monitoring.
   */
  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    this._running = false;
    this._mountPoint = null;
    this._checkInFlight = false;
  }

  /**
   * Run a single health check in a subprocess so a hung mount
   * cannot block the Electron main process event loop.
   */
  _check() {
    if (!this._mountPoint || this._checkInFlight) return;

    this._checkInFlight = true;

    // List the mount in a child process with a hard timeout. If the mount is
    // hung the subprocess blocks (not us) and gets killed. Use a platform-
    // appropriate command — `ls` doesn't exist on Windows, where its ENOENT
    // would otherwise fail the check every interval on a healthy drive.
    const isWin = process.platform === 'win32';
    const cmd = isWin ? 'cmd' : 'ls';
    const args = isWin ? ['/c', 'dir', this._mountPoint] : [this._mountPoint];
    _deps.execFile(cmd, args, { timeout: CHECK_TIMEOUT }, (err) => {
      this._checkInFlight = false;
      if (!this._running) return;

      if (err) {
        const msg = err.killed
          ? 'Mount health check timed out — mount may be hung'
          : (err.message || 'Mount point inaccessible');
        this.emit('healthCheckFailed', msg);
      }
    });
  }
}

module.exports = { MountHealthMonitor, _deps };
