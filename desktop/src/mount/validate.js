const fs = require('fs');
const path = require('path');

// Internal deps — overridable for testing
const _deps = {
  statSync: fs.statSync,
  readdirSync: fs.readdirSync,
};

/**
 * Validate a mount point path before use.
 * @param {string} mountPath
 * @returns {{ valid: boolean, error?: string }}
 */
function validateMountPoint(mountPath) {
  if (!mountPath || typeof mountPath !== 'string') {
    return { valid: false, error: 'Mount point is required' };
  }

  const trimmed = mountPath.trim();
  if (!trimmed) {
    return { valid: false, error: 'Mount point is required' };
  }

  // Windows drive letter is allowed (e.g. "M:")
  const isWindowsDrive = /^[A-Za-z]:$/.test(trimmed);

  if (!isWindowsDrive && !path.isAbsolute(trimmed)) {
    return { valid: false, error: 'Mount point must be an absolute path' };
  }

  // For non-Windows-drive paths, check that parent directory exists
  if (!isWindowsDrive) {
    const parent = path.dirname(trimmed);
    try {
      const stat = _deps.statSync(parent);
      if (!stat.isDirectory()) {
        return { valid: false, error: `Parent path is not a directory: ${parent}` };
      }
    } catch {
      return { valid: false, error: `Parent directory does not exist: ${parent}` };
    }

    // Check if the path is a regular file (not a directory)
    try {
      const stat = _deps.statSync(trimmed);
      if (stat.isFile()) {
        return { valid: false, error: 'Mount point is a file, not a directory' };
      }
      // If it's a non-empty directory, it's already in use
      if (stat.isDirectory()) {
        const entries = _deps.readdirSync(trimmed);
        if (entries.length > 0) {
          return { valid: false, error: 'Mount point directory is not empty' };
        }
      }
    } catch {
      // Path doesn't exist yet — that's fine, rclone/mkdirSync will create it
    }
  }

  return { valid: true };
}

module.exports = { validateMountPoint, _deps };
