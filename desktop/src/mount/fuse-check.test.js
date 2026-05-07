import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { checkMacFuse, checkWinFsp, checkLinuxFuse, _deps } = require('./fuse-check');

let origDeps;

beforeEach(() => {
  origDeps = { ..._deps };
  _deps.execSync = vi.fn(() => { throw new Error('not available'); });
  _deps.existsSync = vi.fn(() => false);
});

afterEach(() => {
  Object.assign(_deps, origDeps);
});

describe('checkMacFuse', () => {
  it('detects macFUSE via kextstat', () => {
    _deps.execSync.mockImplementation((cmd) => {
      if (cmd.includes('kextstat')) return '  com.github.macfuse.filesystems.macfuse (4.0)';
      throw new Error('fail');
    });
    const result = checkMacFuse();
    expect(result.installed).toBe(true);
    expect(result.name).toBe('macFUSE');
  });

  it('detects macFUSE via filesystem path', () => {
    _deps.existsSync.mockImplementation((p) => p === '/Library/Filesystems/macfuse.fs');
    const result = checkMacFuse();
    expect(result.installed).toBe(true);
    expect(result.name).toBe('macFUSE');
  });

  it('detects FUSE-T via filesystem path', () => {
    _deps.existsSync.mockImplementation((p) => p === '/Library/Filesystems/fuse-t.fs');
    const result = checkMacFuse();
    expect(result.installed).toBe(true);
    expect(result.name).toBe('FUSE-T');
  });

  it('returns not installed when nothing found', () => {
    const result = checkMacFuse();
    expect(result.installed).toBe(false);
    expect(result.installInstructions).toBeDefined();
  });
});

describe('checkWinFsp', () => {
  it('detects WinFsp via registry', () => {
    _deps.execSync.mockReturnValue('    InstallDir    REG_SZ    C:\\Program Files (x86)\\WinFsp\\');
    const result = checkWinFsp();
    expect(result.installed).toBe(true);
    expect(result.name).toBe('WinFsp');
  });

  it('returns not installed when not in registry and dll missing', () => {
    const result = checkWinFsp();
    expect(result.installed).toBe(false);
  });
});

describe('checkLinuxFuse', () => {
  it('detects FUSE via /dev/fuse', () => {
    _deps.existsSync.mockImplementation((p) => p === '/dev/fuse');
    const result = checkLinuxFuse();
    expect(result.installed).toBe(true);
    expect(result.name).toBe('FUSE');
  });
});
