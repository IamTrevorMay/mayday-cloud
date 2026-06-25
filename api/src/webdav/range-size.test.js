import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { webdavRangeSize, resolveWithinRoot, patchContentRange, _deps } = require('./range-size');

const ROOT = '/Volumes/May Server';

let origDeps;
beforeEach(() => { origDeps = { ..._deps }; });
afterEach(() => { Object.assign(_deps, origDeps); });

describe('patchContentRange', () => {
  it('rewrites unknown total size to the real size', () => {
    expect(patchContentRange('bytes 0-1023/*', 820330784)).toBe('bytes 0-1023/820330784');
  });
  it('leaves an already-sized range untouched', () => {
    expect(patchContentRange('bytes 0-1023/820330784', 999)).toBe('bytes 0-1023/820330784');
  });
  it('ignores non-matching values', () => {
    expect(patchContentRange('bytes */1234', 5)).toBe('bytes */1234');
    expect(patchContentRange(undefined, 5)).toBe(undefined);
  });
});

describe('resolveWithinRoot', () => {
  it('resolves a normal path inside the root', () => {
    expect(resolveWithinRoot('/Projects/clip.mov', ROOT)).toBe('/Volumes/May Server/Projects/clip.mov');
  });
  it('decodes percent-encoding', () => {
    expect(resolveWithinRoot('/Projects/Who%20will%20be%3F.mov', ROOT))
      .toBe('/Volumes/May Server/Projects/Who will be?.mov');
  });
  it('clamps traversal via .. inside the root (cannot escape)', () => {
    const r = resolveWithinRoot('/../../etc/passwd', ROOT);
    expect(r).toBe('/Volumes/May Server/etc/passwd');
    expect(r.startsWith('/Volumes/May Server/')).toBe(true);
  });
  it('clamps encoded traversal inside the root (cannot escape)', () => {
    const r = resolveWithinRoot('/%2e%2e/%2e%2e/etc/passwd', ROOT);
    expect(r.startsWith('/Volumes/May Server/')).toBe(true);
  });
  it('rejects null bytes', () => {
    expect(resolveWithinRoot('/a%00b', ROOT)).toBeNull();
  });
});

function mockRes() {
  return {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    writeHead(...args) { this.lastWriteHead = args; },
  };
}

describe('webdavRangeSize middleware', () => {
  it('skips non-GET requests', () => {
    const next = vi.fn();
    webdavRangeSize(ROOT)({ method: 'PROPFIND', headers: { range: 'bytes=0-' }, path: '/x' }, mockRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('skips requests without a Range header', () => {
    const next = vi.fn();
    webdavRangeSize(ROOT)({ method: 'GET', headers: {}, path: '/x' }, mockRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('calls next without patching when stat fails', () => {
    _deps.stat = (p, cb) => cb(new Error('ENOENT'));
    const next = vi.fn();
    const res = mockRes();
    webdavRangeSize(ROOT)({ method: 'GET', headers: { range: 'bytes=0-' }, path: '/missing.mov' }, res, next);
    expect(next).toHaveBeenCalledOnce();
    res.setHeader('Content-Range', 'bytes 0-1023/*');
    expect(res.headers['Content-Range']).toBe('bytes 0-1023/*'); // untouched
  });

  it('rewrites Content-Range via setHeader using the real size', () => {
    _deps.stat = (p, cb) => cb(null, { isFile: () => true, size: 820330784 });
    const next = vi.fn();
    const res = mockRes();
    webdavRangeSize(ROOT)({ method: 'GET', headers: { range: 'bytes=0-' }, path: '/clip.mov' }, res, next);
    expect(next).toHaveBeenCalledOnce();
    res.setHeader('Content-Range', 'bytes 0-1023/*');
    expect(res.headers['Content-Range']).toBe('bytes 0-1023/820330784');
  });

  it('rewrites Content-Range via writeHead headers object', () => {
    _deps.stat = (p, cb) => cb(null, { isFile: () => true, size: 500 });
    const next = vi.fn();
    const res = mockRes();
    webdavRangeSize(ROOT)({ method: 'GET', headers: { range: 'bytes=0-' }, path: '/clip.mov' }, res, next);
    const headers = { 'Content-Range': 'bytes 0-99/*', 'Content-Type': 'video/quicktime' };
    res.writeHead(206, headers);
    expect(headers['Content-Range']).toBe('bytes 0-99/500');
  });

  it('does not patch when target is a directory', () => {
    _deps.stat = (p, cb) => cb(null, { isFile: () => false, size: 0 });
    const next = vi.fn();
    const res = mockRes();
    webdavRangeSize(ROOT)({ method: 'GET', headers: { range: 'bytes=0-' }, path: '/folder' }, res, next);
    res.setHeader('Content-Range', 'bytes 0-1023/*');
    expect(res.headers['Content-Range']).toBe('bytes 0-1023/*');
  });
});
