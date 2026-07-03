const webdav = require('webdav-server').v2;
const path = require('path');
const { MaydayWebDAVAuth } = require('./auth');
const { resolveRole } = require('../middleware/auth');

// Directories that should be hidden from WebDAV listings
const HIDDEN_DIRS = new Set(['.trash', '.thumbs', '.tus-staging']);

// Methods that create, modify, or delete resources. These require a
// writer role (admin or member); viewers get read-only access.
const WRITE_METHODS = new Set([
  'PUT', 'DELETE', 'MOVE', 'COPY', 'MKCOL', 'PROPPATCH', 'LOCK', 'UNLOCK', 'POST',
]);

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

  // Add a before-request handler for path traversal safety + authorization.
  // Authentication runs during context creation, so ctx.user is populated
  // here. Without this, webdav-server grants every authenticated principal
  // full read/write/delete over the whole filesystem regardless of role or
  // API-key scope.
  server.beforeRequest((ctx, next) => {
    const reqPath = ctx.requested.path;
    const pathStr = (reqPath && typeof reqPath.toString === 'function')
      ? reqPath.toString()
      : '/';

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

    const mUser = ctx.user && ctx.user._maydayUser;
    const method = (ctx.request.method || '').toUpperCase();

    // Enforce API-key path scoping on every request (read and write). A key
    // created with scoped_path can only touch paths within that subtree.
    if (mUser && mUser.scopedPath) {
      const scope = mUser.scopedPath.replace(/^\/+|\/+$/g, '');
      const rel = pathStr.replace(/^\/+|\/+$/g, '');
      if (scope && rel !== scope && !rel.startsWith(scope + '/')) {
        ctx.setCode(403);
        ctx.exit();
        return;
      }
    }

    // Write methods require a writer role (admin or member). The JWT role
    // claim is always 'authenticated', so resolve the real profile role.
    if (WRITE_METHODS.has(method)) {
      if (!mUser) {
        ctx.setCode(401);
        ctx.exit();
        return;
      }
      resolveRole(mUser.id)
        .then((role) => {
          if (role !== 'admin' && role !== 'member') {
            ctx.setCode(403);
            ctx.exit();
            return;
          }
          next();
        })
        .catch(() => {
          ctx.setCode(500);
          ctx.exit();
        });
      return;
    }

    next();
  });

  return server;
}

module.exports = { createWebDAVServer };
