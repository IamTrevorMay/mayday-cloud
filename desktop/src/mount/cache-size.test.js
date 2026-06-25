import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { getFreeBytes, computeCacheSize, resolveCacheSize, _deps, GiB } = require('./cache-size');

let origDeps;

beforeEach(() => {
  origDeps = { ..._deps };
});

afterEach(() => {
  Object.assign(_deps, origDeps);
});

describe('computeCacheSize (hybrid policy)', () => {
  it('uses 50% of free when that is below the free-minus-reserve line', () => {
    // 413.5 GB free → 50% ≈ 193GiB wins over (free - 150GiB)
    expect(computeCacheSize(413.5 * 1e9)).toBe('193G');
  });

  it('uses free-minus-reserve when that is the smaller of the two', () => {
    // 200GiB free → min(100, 200-150=50) = 50GiB
    expect(computeCacheSize(200 * GiB)).toBe('50G');
  });

  it('clamps up to the 15G floor on a nearly-full disk', () => {
    expect(computeCacheSize(120 * GiB)).toBe('15G');
  });

  it('clamps down to the 300G cap on a huge disk', () => {
    expect(computeCacheSize(2000 * GiB)).toBe('300G');
  });

  it('never returns below the floor even with tiny free space', () => {
    expect(computeCacheSize(1 * GiB)).toBe('15G');
  });
});

describe('getFreeBytes', () => {
  it('parses diskutil Container Free Space on darwin', () => {
    _deps.platform = 'darwin';
    _deps.execSync = () =>
      '   Volume Free Space:         12.0 GB\n   Container Free Space:      413.5 GB (413492346880 Bytes) (exactly ...)\n';
    expect(getFreeBytes()).toBe(413492346880);
  });

  it('falls back to statfs when diskutil fails', () => {
    _deps.platform = 'darwin';
    _deps.execSync = () => { throw new Error('no diskutil'); };
    _deps.statfsSync = () => ({ bavail: 1000, bsize: GiB });
    expect(getFreeBytes()).toBe(1000 * GiB);
  });

  it('uses statfs directly on non-darwin', () => {
    _deps.platform = 'linux';
    _deps.statfsSync = () => ({ bavail: 50, bsize: GiB });
    expect(getFreeBytes()).toBe(50 * GiB);
  });

  it('returns null when nothing works', () => {
    _deps.platform = 'linux';
    _deps.statfsSync = null;
    expect(getFreeBytes()).toBeNull();
  });
});

describe('resolveCacheSize', () => {
  it('honors an explicit pinned config value', () => {
    expect(resolveCacheSize('100G')).toBe('100G');
  });

  it('computes dynamically for "auto"', () => {
    _deps.platform = 'linux';
    _deps.statfsSync = () => ({ bavail: 200, bsize: GiB }); // 200GiB free → 50G
    expect(resolveCacheSize('auto')).toBe('50G');
  });

  it('computes dynamically for empty/undefined', () => {
    _deps.platform = 'linux';
    _deps.statfsSync = () => ({ bavail: 200, bsize: GiB });
    expect(resolveCacheSize('')).toBe('50G');
    expect(resolveCacheSize(undefined)).toBe('50G');
  });

  it('falls back to the floor when free space is unknown', () => {
    _deps.platform = 'linux';
    _deps.statfsSync = null;
    expect(resolveCacheSize('auto')).toBe('15G');
  });
});
