import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';

const require = createRequire(import.meta.url);
const { scan } = require('./scanner');

let tmpDir;

function makeTmpDir() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scanner-test-'));
  return tmpDir;
}

afterEach(() => {
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = null;
  }
});

describe('scan', () => {
  it('returns empty array for empty folder', () => {
    const dir = makeTmpDir();
    const results = scan(dir);
    expect(results).toEqual([]);
  });

  it('returns one entry for a single file with correct properties', () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, 'hello.txt'), 'hello');

    const results = scan(dir);
    expect(results).toHaveLength(1);
    expect(results[0].relPath).toBe('hello.txt');
    expect(results[0].size).toBe(5);
    expect(typeof results[0].mtimeMs).toBe('number');
  });

  it('returns correct relPath for nested directories', () => {
    const dir = makeTmpDir();
    const nested = path.join(dir, 'a', 'b');
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(nested, 'file.txt'), 'content');

    const results = scan(dir);
    expect(results).toHaveLength(1);
    expect(results[0].relPath).toBe(path.join('a', 'b', 'file.txt'));
  });

  it('skips dotfiles', () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, '.hidden'), 'secret');
    fs.writeFileSync(path.join(dir, 'visible.txt'), 'hello');

    const results = scan(dir);
    expect(results).toHaveLength(1);
    expect(results[0].relPath).toBe('visible.txt');
  });

  it('skips dotfolders', () => {
    const dir = makeTmpDir();
    const dotDir = path.join(dir, '.git');
    fs.mkdirSync(dotDir, { recursive: true });
    fs.writeFileSync(path.join(dotDir, 'config'), 'gitconfig');
    fs.writeFileSync(path.join(dir, 'readme.txt'), 'hi');

    const results = scan(dir);
    expect(results).toHaveLength(1);
    expect(results[0].relPath).toBe('readme.txt');
  });

  it('returns all files for multiple files', () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, 'a.txt'), 'aaa');
    fs.writeFileSync(path.join(dir, 'b.txt'), 'bb');
    fs.writeFileSync(path.join(dir, 'c.txt'), 'c');

    const results = scan(dir);
    expect(results).toHaveLength(3);

    const names = results.map((r) => r.relPath).sort();
    expect(names).toEqual(['a.txt', 'b.txt', 'c.txt']);
  });

  it('handles unreadable directories gracefully', () => {
    if (process.platform === 'win32') return; // skip on Windows

    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, 'ok.txt'), 'fine');
    const restricted = path.join(dir, 'nope');
    fs.mkdirSync(restricted);
    fs.writeFileSync(path.join(restricted, 'secret.txt'), 'hidden');
    fs.chmodSync(restricted, 0o000);

    const results = scan(dir);
    const names = results.map((r) => r.relPath);
    expect(names).toContain('ok.txt');
    expect(names).not.toContain(path.join('nope', 'secret.txt'));

    // Restore permissions so cleanup works
    fs.chmodSync(restricted, 0o755);
  });
});
