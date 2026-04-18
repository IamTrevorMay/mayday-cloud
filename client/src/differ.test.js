import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { diff } = require('./differ');

describe('diff', () => {
  it('returns nothing for empty inputs', () => {
    const result = diff([], []);
    expect(result.toUpload).toEqual([]);
    expect(result.toDelete).toEqual([]);
    expect(result.toMkdir).toEqual([]);
  });

  it('marks new files for upload and collects parent dirs', () => {
    const scanned = [
      { relPath: 'docs/readme.txt', size: 100, mtimeMs: 1000 },
      { relPath: 'docs/notes/todo.txt', size: 200, mtimeMs: 2000 },
    ];
    const result = diff(scanned, []);

    expect(result.toUpload).toEqual(scanned);
    expect(result.toMkdir).toContain('docs');
    expect(result.toMkdir).toContain('docs/notes');
    expect(result.toDelete).toEqual([]);
  });

  it('returns nothing when scanned matches db (synced)', () => {
    const scanned = [
      { relPath: 'file.txt', size: 100, mtimeMs: 1000 },
    ];
    const dbFiles = [
      { rel_path: 'file.txt', size: 100, mtime_ms: 1000, status: 'synced' },
    ];
    const result = diff(scanned, dbFiles);

    expect(result.toUpload).toEqual([]);
    expect(result.toDelete).toEqual([]);
    expect(result.toMkdir).toEqual([]);
  });

  it('detects modified file by size', () => {
    const scanned = [{ relPath: 'file.txt', size: 200, mtimeMs: 1000 }];
    const dbFiles = [{ rel_path: 'file.txt', size: 100, mtime_ms: 1000, status: 'synced' }];
    const result = diff(scanned, dbFiles);

    expect(result.toUpload).toHaveLength(1);
    expect(result.toUpload[0].relPath).toBe('file.txt');
  });

  it('detects modified file by mtime', () => {
    const scanned = [{ relPath: 'file.txt', size: 100, mtimeMs: 2000 }];
    const dbFiles = [{ rel_path: 'file.txt', size: 100, mtime_ms: 1000, status: 'synced' }];
    const result = diff(scanned, dbFiles);

    expect(result.toUpload).toHaveLength(1);
    expect(result.toUpload[0].relPath).toBe('file.txt');
  });

  it('marks deleted files (in db but not scanned)', () => {
    const scanned = [];
    const dbFiles = [
      { rel_path: 'old.txt', size: 50, mtime_ms: 500, status: 'synced' },
    ];
    const result = diff(scanned, dbFiles);

    expect(result.toDelete).toEqual(['old.txt']);
    expect(result.toUpload).toEqual([]);
  });

  it('retries files with error status even if size/mtime match', () => {
    const scanned = [{ relPath: 'file.txt', size: 100, mtimeMs: 1000 }];
    const dbFiles = [{ rel_path: 'file.txt', size: 100, mtime_ms: 1000, status: 'error' }];
    const result = diff(scanned, dbFiles);

    expect(result.toUpload).toHaveLength(1);
    expect(result.toUpload[0].relPath).toBe('file.txt');
  });

  it('retries files with pending status even if size/mtime match', () => {
    const scanned = [{ relPath: 'file.txt', size: 100, mtimeMs: 1000 }];
    const dbFiles = [{ rel_path: 'file.txt', size: 100, mtime_ms: 1000, status: 'pending' }];
    const result = diff(scanned, dbFiles);

    expect(result.toUpload).toHaveLength(1);
  });

  it('does not upload synced file with unchanged size/mtime', () => {
    const scanned = [{ relPath: 'file.txt', size: 100, mtimeMs: 1000 }];
    const dbFiles = [{ rel_path: 'file.txt', size: 100, mtime_ms: 1000, status: 'synced' }];
    const result = diff(scanned, dbFiles);

    expect(result.toUpload).toHaveLength(0);
  });

  it('sorts toMkdir parent-first', () => {
    const scanned = [
      { relPath: 'a/b/c/deep.txt', size: 10, mtimeMs: 100 },
    ];
    const result = diff(scanned, []);

    expect(result.toMkdir).toEqual(['a', 'a/b', 'a/b/c']);
  });

  it('classifies a mixed scenario correctly', () => {
    const scanned = [
      { relPath: 'unchanged.txt', size: 100, mtimeMs: 1000 },
      { relPath: 'modified.txt', size: 999, mtimeMs: 1000 },
      { relPath: 'brand-new.txt', size: 50, mtimeMs: 3000 },
    ];
    const dbFiles = [
      { rel_path: 'unchanged.txt', size: 100, mtime_ms: 1000, status: 'synced' },
      { rel_path: 'modified.txt', size: 100, mtime_ms: 1000, status: 'synced' },
      { rel_path: 'removed.txt', size: 10, mtime_ms: 500, status: 'synced' },
    ];
    const result = diff(scanned, dbFiles);

    const uploadPaths = result.toUpload.map((f) => f.relPath);
    expect(uploadPaths).toContain('modified.txt');
    expect(uploadPaths).toContain('brand-new.txt');
    expect(uploadPaths).not.toContain('unchanged.txt');

    expect(result.toDelete).toEqual(['removed.txt']);
  });
});
