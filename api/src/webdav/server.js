const webdav = require('webdav-server').v2;
const path = require('path');
const { MaydayWebDAVAuth } = require('./auth');

// Directories that should be hidden from WebDAV listings
const HIDDEN_DIRS = new Set(['.trash', '.thumbs', '.tus-staging']);

/**
 * Creates and configures the WebDAV server instance.
 * Uses PhysicalFileSystem rooted at ASSETS_ROOT.
 */
function createWebDAVServer(assetsRoot) {
  const server = new webdav.WebDAVServer({
    httpAuthentication: new MaydayWebDAVAuth(),
    requireAuthentification: true,
  });

  // Mount the NAS root as a physical filesystem
  const physFS = new webdav.PhysicalFileSystem(assetsRoot);

  // Wrap the readDir method to filter hidden directories
  const originalReadDir = physFS.readDir || physFS._readDir;
  if (physFS._readDir) {
    const origReadDir = physFS._readDir.bind(physFS);
    physFS._readDir = function (pathObj, ctx, callback) {
      origReadDir(pathObj, ctx, (err, files) => {
        if (err) return callback(err);
        const filtered = (files || []).filter((f) => {
          const name = typeof f === 'string' ? f : f.name || f;
          return !HIDDEN_DIRS.has(name);
        });
        callback(null, filtered);
      });
    };
  }

  server.setFileSystem('/', physFS, (success) => {
    if (success) {
      console.log('[webdav] Mounted PhysicalFileSystem at /');
    } else {
      console.error('[webdav] Failed to mount PhysicalFileSystem');
    }
  });

  // Add a before-request handler for path traversal safety
  server.beforeRequest((ctx, next) => {
    const reqPath = ctx.requested.path;
    if (reqPath && typeof reqPath.toString === 'function') {
      const pathStr = reqPath.toString();
      // Block path traversal attempts
      if (pathStr.includes('..')) {
        ctx.setCode(403);
        ctx.exit();
        return;
      }
      // Block access to hidden directories
      const parts = pathStr.split('/').filter(Boolean);
      if (parts.some((p) => HIDDEN_DIRS.has(p))) {
        ctx.setCode(404);
        ctx.exit();
        return;
      }
    }
    next();
  });

  return server;
}

module.exports = { createWebDAVServer };
