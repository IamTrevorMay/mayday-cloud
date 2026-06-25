const fs = require('fs');
const path = require('path');

// Internal deps — overridable for testing
const _deps = {
  stat: fs.stat,
};

/**
 * Resolve a decoded WebDAV request path to an absolute path inside assetsRoot.
 * Returns null if the path escapes the root (traversal) or can't be decoded.
 */
function resolveWithinRoot(reqPath, assetsRoot) {
  let decoded;
  try {
    decoded = decodeURIComponent(reqPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;

  const rootResolved = path.resolve(assetsRoot);
  const full = path.resolve(rootResolved, '.' + path.posix.normalize('/' + decoded));
  if (full !== rootResolved && !full.startsWith(rootResolved + path.sep)) {
    return null;
  }
  return full;
}

/**
 * Rewrite a Content-Range value of the form `bytes a-b/*` to use the real
 * total size: `bytes a-b/<size>`. Leaves anything else untouched.
 */
function patchContentRange(value, size) {
  if (typeof value !== 'string') return value;
  return value.replace(/^(bytes \d+-\d+)\/\*$/i, `$1/${size}`);
}

/**
 * Express middleware: for range GETs on the WebDAV mount, stat the target file
 * and rewrite the `webdav-server` library's `Content-Range: bytes a-b/*`
 * (unknown total size) to report the real file size. This lets rclone's VFS
 * learn the file size from a read response instead of issuing an extra
 * HEAD/PROPFIND round-trip.
 *
 * Purely additive: on any error or non-range request it calls next() with no
 * behavior change. Mount BEFORE the webdav handler, e.g.
 *   app.use('/api/webdav', webdavRangeSize(ASSETS_ROOT))
 *
 * @param {string} assetsRoot
 */
function webdavRangeSize(assetsRoot) {
  return function (req, res, next) {
    if (req.method !== 'GET' || !req.headers.range) return next();

    const full = resolveWithinRoot(req.path, assetsRoot);
    if (!full) return next();

    _deps.stat(full, (err, stat) => {
      if (err || !stat || !stat.isFile()) return next();
      const size = stat.size;

      const origSetHeader = res.setHeader.bind(res);
      res.setHeader = function (name, value) {
        if (String(name).toLowerCase() === 'content-range') {
          value = patchContentRange(value, size);
        }
        return origSetHeader(name, value);
      };

      const origWriteHead = res.writeHead.bind(res);
      res.writeHead = function (...args) {
        const headers = args.find((a) => a && typeof a === 'object');
        if (headers) {
          for (const key of Object.keys(headers)) {
            if (key.toLowerCase() === 'content-range') {
              headers[key] = patchContentRange(headers[key], size);
            }
          }
        }
        return origWriteHead(...args);
      };

      next();
    });
  };
}

module.exports = { webdavRangeSize, resolveWithinRoot, patchContentRange, _deps };
