import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const rclone = require('./rclone');
const { _deps } = rclone;

let origDeps;

beforeEach(() => {
  origDeps = { ..._deps };
  _deps.execSync = vi.fn();
  _deps.existsSync = vi.fn(() => false);
  rclone._resetCache();
});

afterEach(() => {
  Object.assign(_deps, origDeps);
  rclone._resetCache();
});

describe('findRclone', () => {
  it('returns null when rclone is not found anywhere', () => {
    _deps.existsSync.mockReturnValue(false);
    _deps.execSync.mockImplementation(() => { throw new Error('not found'); });
    expect(rclone.findRclone()).toBeNull();
  });

  it('returns the first matching search path', () => {
    _deps.existsSync.mockImplementation((p) => p === '/usr/local/bin/rclone');
    const result = rclone.findRclone();
    expect(result).toBe('/usr/local/bin/rclone');
  });

  it('falls back to PATH lookup via which', () => {
    _deps.existsSync.mockImplementation((p) => {
      if (p === '/custom/bin/rclone') return true;
      return false;
    });
    _deps.execSync.mockReturnValue('/custom/bin/rclone\n');
    const result = rclone.findRclone();
    expect(result).toBe('/custom/bin/rclone');
  });

  it('caches the result after first call', () => {
    _deps.existsSync.mockImplementation((p) => p === '/usr/local/bin/rclone');
    rclone.findRclone();
    _deps.existsSync.mockReturnValue(false);
    expect(rclone.findRclone()).toBe('/usr/local/bin/rclone');
  });
});

describe('getVersion', () => {
  it('returns null when rclone is not found', () => {
    _deps.existsSync.mockReturnValue(false);
    _deps.execSync.mockImplementation(() => { throw new Error('not found'); });
    expect(rclone.getVersion()).toBeNull();
  });

  it('parses a standard version string', () => {
    _deps.existsSync.mockImplementation((p) => p === '/usr/local/bin/rclone');
    _deps.execSync.mockImplementation((cmd) => {
      if (cmd.includes('version')) return 'rclone v1.67.0\n- os/version: darwin\n';
      throw new Error('not found');
    });
    expect(rclone.getVersion()).toBe('1.67.0');
  });
});

describe('obscurePassword', () => {
  it('throws when rclone is not found', () => {
    _deps.existsSync.mockReturnValue(false);
    _deps.execSync.mockImplementation(() => { throw new Error('not found'); });
    expect(() => rclone.obscurePassword('secret')).toThrow(/rclone not found/);
  });
});

describe('checkMountSupport', () => {
  it('returns supported: false when rclone is not found', () => {
    _deps.existsSync.mockReturnValue(false);
    _deps.execSync.mockImplementation(() => { throw new Error('not found'); });
    const result = rclone.checkMountSupport();
    expect(result.supported).toBe(false);
    expect(result.error).toMatch(/not found/);
  });

  it('returns supported: true when help mount succeeds', () => {
    _deps.existsSync.mockImplementation((p) => p === '/usr/local/bin/rclone');
    _deps.execSync.mockImplementation((cmd) => {
      if (cmd.includes('help mount')) return 'Usage:\n  rclone mount remote:path /path/to/mount\n';
      throw new Error('not found');
    });
    const result = rclone.checkMountSupport();
    expect(result.supported).toBe(true);
  });

  it('returns supported: false when mount command is unknown', () => {
    _deps.existsSync.mockImplementation((p) => p === '/usr/local/bin/rclone');
    _deps.execSync.mockImplementation((cmd) => {
      if (cmd.includes('help mount')) {
        const err = new Error('exit code 1');
        err.stderr = 'Unknown command "mount"';
        throw err;
      }
      throw new Error('not found');
    });
    const result = rclone.checkMountSupport();
    expect(result.supported).toBe(false);
    expect(result.error).toMatch(/not available/);
  });
});
