require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const { Server: TusServer } = require('@tus/server');
const { FileStore } = require('@tus/file-store');
const webdav = require('webdav-server').v2;
const { authMiddleware, verifyToken, requireRole } = require('./middleware/auth');
const { createWebDAVServer } = require('./webdav/server');
const nasRouter = require('./routes/nas');
const sharesRouter = require('./routes/shares');
const keysRouter = require('./routes/keys');
const dropRouter = require('./routes/drop');
const authRouter = require('./routes/auth');

const app = express();
const PORT = process.env.PORT || 4000;
const ASSETS_ROOT = process.env.ASSETS_ROOT || '/Volumes/May Server';

const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || 'https://www.mayday.systems,http://localhost:3000').split(',');

app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (curl, server-to-server, mobile apps)
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error('CORS origin not allowed'));
  },
  credentials: true,
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'Tus-Resumable',
    'Upload-Length',
    'Upload-Metadata',
    'Upload-Offset',
    'Upload-Concat',
    'Upload-Defer-Length',
  ],
  exposedHeaders: [
    'Tus-Resumable',
    'Upload-Offset',
    'Upload-Length',
    'Tus-Version',
    'Tus-Extension',
    'Tus-Max-Size',
    'Location',
  ],
}));
app.use(express.json());

// ─── Rate limiting ───
const globalLimiter = rateLimit({
  windowMs: 60 * 1000, max: 100, standardHeaders: true, legacyHeaders: false,
  skip: (req) => req.originalUrl.startsWith('/api/webdav'),
});
const authLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts, try again later' } });
const dropUploadLimiter = rateLimit({ windowMs: 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false, message: { error: 'Upload rate limit exceeded' } });

app.use(globalLimiter);
app.use('/api/auth', authLimiter);
app.use('/api/drop/:token/upload', dropUploadLimiter);

// ─── Structured request logging ───
app.use((req, res, next) => {
  const start = Date.now();
  const originalEnd = res.end;
  res.end = function (...args) {
    const duration = Date.now() - start;
    const log = {
      method: req.method,
      route: req.originalUrl,
      status: res.statusCode,
      duration_ms: duration,
      user_id: req.user?.id || null,
    };
    if (res.statusCode >= 400) {
      console.error('[req]', JSON.stringify(log));
    } else {
      console.log('[req]', JSON.stringify(log));
    }
    originalEnd.apply(this, args);
  };
  next();
});

// ─── Tus resumable upload server ───
const tusStaging = path.join(ASSETS_ROOT, '.tus-staging');
fs.mkdirSync(tusStaging, { recursive: true });

const tusServer = new TusServer({
  path: '/api/nas/tus',
  datastore: new FileStore({ directory: tusStaging }),
  maxSize: 10 * 1024 * 1024 * 1024, // 10GB
  // @tus/server v2: callbacks receive (req, upload) where req is a Web API
  // Request and upload has { id, metadata, size, offset, storage }.
  async onUploadCreate(req, upload) {
    const header = typeof req.headers.get === 'function'
      ? req.headers.get('authorization')
      : req.headers.authorization;
    if (!header) {
      console.error('[tus] onUploadCreate: missing Authorization header');
      throw { status_code: 401, body: 'Missing authorization' };
    }
    const token = header.slice(7);
    try {
      await verifyToken(token);
    } catch (err) {
      console.error('[tus] onUploadCreate: verifyToken failed:', err.message, '| token prefix:', token.slice(0, 20));
      throw { status_code: 401, body: 'Invalid token' };
    }
    return upload;
  },
  async onUploadFinish(req, upload) {
    // Move completed file from staging to target path
    try {
      const metadata = upload.metadata || {};
      const filename = metadata.filename || upload.id;
      const targetPath = metadata.targetPath || '';

      const destDir = path.resolve(ASSETS_ROOT, targetPath || '');
      if (!destDir.startsWith(ASSETS_ROOT)) {
        throw new Error('Path traversal blocked');
      }

      fs.mkdirSync(destDir, { recursive: true });
      const destFile = path.join(destDir, filename);
      if (!destFile.startsWith(ASSETS_ROOT)) {
        throw new Error('Path traversal blocked');
      }

      // v2: storage.path is the absolute path to the completed file
      const srcFile = upload.storage?.path || path.join(tusStaging, upload.id);
      fs.renameSync(srcFile, destFile);

      // Clean up .info file
      const infoFile = srcFile + '.info';
      fs.unlink(infoFile, () => {});
    } catch (err) {
      console.error('[tus] onUploadFinish error:', err.message);
    }
    return upload;
  },
});

// Public health check
app.get('/health', (req, res) => res.json({ ok: true, service: 'mayday-cloud-api' }));

// Public routes (no auth)
app.use('/api/drop', dropRouter);
app.use('/api/auth', authRouter);

// Client-side error reporting (public, fire-and-forget)
app.post('/api/errors', (req, res) => {
  const { message, stack, url, timestamp } = req.body || {};
  console.error('[client-error]', JSON.stringify({ message, url, timestamp, stack: stack?.split('\n').slice(0, 3).join(' | ') }));
  res.json({ ok: true });
});

// Tus endpoint — handles its own auth in onUploadCreate
app.all('/api/nas/tus', (req, res) => tusServer.handle(req, res));
app.all('/api/nas/tus/*', (req, res) => tusServer.handle(req, res));

// ─── WebDAV endpoint — handles its own auth via HTTP Basic ───
const webdavServer = createWebDAVServer(ASSETS_ROOT);
webdavServer.afterRequest((ctx, next) => {
  // Log WebDAV requests at the same level as other routes
  const log = {
    method: ctx.request.method,
    route: ctx.requested.uri,
    status: ctx.response.statusCode,
    user_id: ctx.user?._maydayUser?.id || null,
  };
  if (ctx.response.statusCode >= 400) {
    console.error('[webdav]', JSON.stringify(log));
  }
  next();
});
app.use(webdav.extensions.express('/api/webdav', webdavServer));

// Protected routes — require valid Supabase JWT or API key
app.use('/api', authMiddleware);
app.use('/api/nas', nasRouter);
app.use('/api/shares', sharesRouter);
app.use('/api/keys', keysRouter);

// User info (tests that auth works)
app.get('/api/me', (req, res) => {
  res.json({ user: req.user });
});

// ─── Admin health dashboard ───
app.get('/api/admin/health', requireRole('admin'), async (req, res) => {
  const { createClient } = require('@supabase/supabase-js');
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const checks = {};

  // API
  checks.api = { ok: true };

  // NAS
  try {
    fs.accessSync(ASSETS_ROOT, fs.constants.R_OK | fs.constants.W_OK);
    checks.nas = { ok: true, path: ASSETS_ROOT };
  } catch {
    checks.nas = { ok: false, path: ASSETS_ROOT };
  }

  // Disk usage
  try {
    const { execSync } = require('child_process');
    const df = execSync(`df -k "${ASSETS_ROOT}"`, { encoding: 'utf8' });
    const lines = df.trim().split('\n');
    if (lines.length >= 2) {
      const parts = lines[1].split(/\s+/);
      checks.disk = {
        total_gb: Math.round(parseInt(parts[1]) / 1024 / 1024),
        used_gb: Math.round(parseInt(parts[2]) / 1024 / 1024),
        available_gb: Math.round(parseInt(parts[3]) / 1024 / 1024),
        percent: parts[4],
      };
    }
  } catch {
    checks.disk = { error: 'Could not read disk usage' };
  }

  // User count
  try {
    const { count } = await sb.from('profiles').select('id', { count: 'exact', head: true });
    checks.users = { count: count || 0 };
  } catch {
    checks.users = { error: 'Could not count users' };
  }

  // Active share links
  try {
    const { count } = await sb
      .from('share_links')
      .select('id', { count: 'exact', head: true })
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);
    checks.active_shares = { count: count || 0 };
  } catch {
    checks.active_shares = { error: 'Could not count shares' };
  }

  // API keys
  try {
    const { count } = await sb
      .from('api_keys')
      .select('id', { count: 'exact', head: true })
      .is('revoked_at', null);
    checks.active_api_keys = { count: count || 0 };
  } catch {
    checks.active_api_keys = { error: 'Could not count keys' };
  }

  const allOk = checks.api.ok && checks.nas.ok && !checks.disk?.error;
  res.json({ ok: allOk, timestamp: new Date().toISOString(), checks });
});

app.listen(PORT, () => {
  console.log(`[Mayday Cloud API] listening on :${PORT}`);
});
