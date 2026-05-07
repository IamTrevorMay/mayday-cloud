const { execFile, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// Common rclone install locations.
// On macOS, prefer user-local / official binary over Homebrew because
// the Homebrew build does not include FUSE mount support.
const SEARCH_PATHS = process.platform === 'win32'
  ? [
    'C:\\Program Files\\rclone\\rclone.exe',
    'C:\\rclone\\rclone.exe',
    path.join(process.env.LOCALAPPDATA || '', 'rclone', 'rclone.exe'),
    path.join(process.env.USERPROFILE || '', 'scoop', 'shims', 'rclone.exe'),
  ]
  : [
    path.join(process.env.HOME || '', '.local', 'bin', 'rclone'),
    path.join(process.env.HOME || '', 'bin', 'rclone'),
    '/usr/local/bin/rclone',
    '/usr/bin/rclone',
    '/opt/homebrew/bin/rclone',
  ];

// Internal deps — overridable for testing
const _deps = {
  execSync,
  existsSync: fs.existsSync,
};

let _cachedPath = null;

/**
 * Find the rclone binary. Returns the absolute path or null.
 */
function findRclone() {
  if (_cachedPath) return _cachedPath;

  // Check known locations first (ordered by preference — official binary before Homebrew)
  for (const p of SEARCH_PATHS) {
    if (p && _deps.existsSync(p)) {
      _cachedPath = p;
      return p;
    }
  }

  // Fall back to PATH lookup
  try {
    const cmd = process.platform === 'win32' ? 'where rclone' : 'which rclone';
    const result = _deps.execSync(cmd, { encoding: 'utf8', timeout: 5000 }).trim().split('\n')[0];
    if (result && _deps.existsSync(result)) {
      _cachedPath = result;
      return result;
    }
  } catch {
    // Not on PATH
  }

  return null;
}

/**
 * Get rclone version string, or null if not found.
 */
function getVersion() {
  const bin = findRclone();
  if (!bin) return null;

  try {
    const output = _deps.execSync(`"${bin}" version`, { encoding: 'utf8', timeout: 5000 });
    const match = output.match(/rclone\s+v([\d.]+)/);
    return match ? match[1] : output.trim().split('\n')[0];
  } catch {
    return null;
  }
}

/**
 * Obscure a password/token for rclone (avoids plaintext on command line).
 * Returns the obscured string.
 */
function obscurePassword(password) {
  const bin = findRclone();
  if (!bin) throw new Error('rclone not found');

  const result = _deps.execSync(`"${bin}" obscure "${password}"`, { encoding: 'utf8', timeout: 5000 });
  return result.trim();
}

/**
 * Returns install instructions for the current platform.
 */
function getInstallInstructions() {
  if (process.platform === 'darwin') {
    return {
      platform: 'macOS',
      methods: [
        { label: 'Direct download (required for mount)', url: 'https://rclone.org/downloads/' },
        { label: 'Homebrew (no mount support)', command: 'brew install rclone' },
      ],
    };
  } else if (process.platform === 'win32') {
    return {
      platform: 'Windows',
      methods: [
        { label: 'Scoop', command: 'scoop install rclone' },
        { label: 'Winget', command: 'winget install Rclone.Rclone' },
        { label: 'Direct download', url: 'https://rclone.org/downloads/' },
      ],
    };
  }
  return {
    platform: 'Linux',
    methods: [
      { label: 'Package manager', command: 'sudo apt install rclone  # or your distro equivalent' },
      { label: 'Direct download', url: 'https://rclone.org/downloads/' },
    ],
  };
}

/**
 * Check if the installed rclone supports the `mount` command.
 * Some builds (e.g. Homebrew on macOS) omit FUSE mount support.
 * @returns {{ supported: boolean, error?: string }}
 */
function checkMountSupport() {
  const bin = findRclone();
  if (!bin) return { supported: false, error: 'rclone not found' };

  try {
    _deps.execSync(`"${bin}" help mount`, { encoding: 'utf8', timeout: 5000 });
    return { supported: true };
  } catch (err) {
    const msg = err.stderr || err.stdout || err.message || '';
    if (msg.includes('Unknown command') || msg.includes('unknown command')) {
      return { supported: false, error: 'rclone mount command not available (Homebrew build?)' };
    }
    // The help command may exit non-zero but still print help text — treat as supported
    if (msg.includes('mount') && msg.includes('Usage')) {
      return { supported: true };
    }
    return { supported: false, error: `Unable to verify mount support: ${msg.slice(0, 200)}` };
  }
}

/**
 * Reset the cached rclone path (for test isolation).
 */
function _resetCache() {
  _cachedPath = null;
}

module.exports = { findRclone, getVersion, obscurePassword, getInstallInstructions, checkMountSupport, _resetCache, _deps };
