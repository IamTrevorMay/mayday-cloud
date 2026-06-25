const { execSync } = require('child_process');
const fs = require('fs');

const GiB = 1024 * 1024 * 1024;

// Sizing policy (hybrid): cache = clamp(min(50% of free, free - RESERVE), FLOOR, CAP)
const RESERVE_BYTES = 150 * GiB; // keep this much free for macOS / the user
const FLOOR_BYTES = 15 * GiB;    // never smaller than this
const CAP_BYTES = 300 * GiB;     // never larger than this

// Internal deps — overridable for testing
const _deps = {
  execSync,
  statfsSync: fs.statfsSync ? fs.statfsSync.bind(fs) : null,
  platform: process.platform,
};

/**
 * Free bytes available to the user on the volume backing `mountPoint`.
 *
 * macOS `df`/statfs under-reports because it excludes *purgeable* space
 * (caches the OS reclaims on demand). `diskutil` reports true container
 * free space, so we prefer it on darwin and fall back to statfs elsewhere.
 *
 * @returns {number|null} free bytes, or null if it can't be determined
 */
function getFreeBytes() {
  if (_deps.platform === 'darwin') {
    try {
      const out = _deps.execSync('diskutil info /System/Volumes/Data', {
        encoding: 'utf8',
        timeout: 5000,
      });
      // Line looks like: "   Container Free Space:      413.5 GB (413492346880 Bytes) ..."
      const match = out.match(/Container Free Space:.*?\((\d+)\s*Bytes\)/i);
      if (match) return parseInt(match[1], 10);
    } catch {
      // fall through to statfs
    }
  }

  if (_deps.statfsSync) {
    try {
      const st = _deps.statfsSync(_deps.platform === 'win32' ? 'C:\\' : '/');
      // bavail = blocks available to unprivileged user
      return st.bavail * st.bsize;
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Compute an rclone cache size label from free bytes using the hybrid policy.
 * @param {number} freeBytes
 * @returns {string} e.g. "192G"
 */
function computeCacheSize(freeBytes) {
  const target = Math.min(freeBytes * 0.5, freeBytes - RESERVE_BYTES);
  const clamped = Math.max(FLOOR_BYTES, Math.min(CAP_BYTES, target));
  const gib = Math.max(1, Math.round(clamped / GiB));
  return `${gib}G`;
}

/**
 * Resolve the cache size to pass to rclone.
 * If the user pinned an explicit size in config, honor it. Otherwise size
 * dynamically from free disk. Falls back to the floor if disk can't be read.
 *
 * @param {string} [configValue] - mountCacheSize from config ('auto'/'' = dynamic)
 * @returns {string} rclone size label, e.g. "192G"
 */
function resolveCacheSize(configValue) {
  if (configValue && configValue !== 'auto') return configValue;

  const free = getFreeBytes();
  if (free == null) return `${Math.round(FLOOR_BYTES / GiB)}G`;
  return computeCacheSize(free);
}

module.exports = { getFreeBytes, computeCacheSize, resolveCacheSize, _deps, GiB };
