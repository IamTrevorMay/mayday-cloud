const fs = require('fs');
const EventEmitter = require('events');

const DEFAULT_INTERVAL = 30000; // 30 seconds

// Internal deps — overridable for testing
const _deps = {
  accessSync: fs.accessSync,
  readdirSync: fs.readdirSync,
};

class MountHealthMonitor extends EventEmitter {
  constructor(interval = DEFAULT_INTERVAL) {
    super();
    this._interval = interval;
    this._timer = null;
    this._mountPoint = null;
    this._running = false;
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
  }

  /**
   * Run a single health check.
   */
  _check() {
    if (!this._mountPoint) return;

    try {
      _deps.accessSync(this._mountPoint);
      _deps.readdirSync(this._mountPoint);
    } catch (err) {
      this.emit('healthCheckFailed', err.message || 'Mount point inaccessible');
    }
  }
}

module.exports = { MountHealthMonitor, _deps };
