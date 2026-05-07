import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { validateMountPoint, _deps } = require('./validate');

let origDeps;

beforeEach(() => {
  origDeps = { ..._deps };
  _deps.statSync = vi.fn();
  _deps.readdirSync = vi.fn();
});

import { afterEach } from 'vitest';
afterEach(() => {
  Object.assign(_deps, origDeps);
});

describe('validateMountPoint', () => {
  it('rejects empty string', () => {
    const result = validateMountPoint('');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/required/i);
  });

  it('rejects null/undefined', () => {
    expect(validateMountPoint(null).valid).toBe(false);
    expect(validateMountPoint(undefined).valid).toBe(false);
  });

  it('rejects whitespace-only string', () => {
    const result = validateMountPoint('   ');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/required/i);
  });

  it('rejects relative path', () => {
    const result = validateMountPoint('relative/path');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/absolute/i);
  });

  it('rejects when parent directory does not exist', () => {
    _deps.statSync.mockImplementation(() => { throw new Error('ENOENT'); });
    const result = validateMountPoint('/nonexistent/parent/mount');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/parent/i);
  });

  it('rejects when mount point is a file', () => {
    _deps.statSync.mockImplementation((p) => {
      if (p === '/Volumes') return { isDirectory: () => true, isFile: () => false };
      return { isDirectory: () => false, isFile: () => true };
    });
    const result = validateMountPoint('/Volumes/somefile');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/file/i);
  });

  it('rejects non-empty directory', () => {
    _deps.statSync.mockImplementation(() => ({ isDirectory: () => true, isFile: () => false }));
    _deps.readdirSync.mockReturnValue(['existing-file.txt']);
    const result = validateMountPoint('/Volumes/Mayday Cloud');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/not empty/i);
  });

  it('accepts valid empty directory', () => {
    _deps.statSync.mockImplementation(() => ({ isDirectory: () => true, isFile: () => false }));
    _deps.readdirSync.mockReturnValue([]);
    const result = validateMountPoint('/Volumes/Mayday Cloud');
    expect(result.valid).toBe(true);
  });

  it('accepts path that does not exist yet (parent exists)', () => {
    _deps.statSync.mockImplementation((p) => {
      if (p === '/Volumes') return { isDirectory: () => true, isFile: () => false };
      throw new Error('ENOENT');
    });
    const result = validateMountPoint('/Volumes/NewMount');
    expect(result.valid).toBe(true);
  });
});
