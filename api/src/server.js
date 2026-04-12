require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { Server: TusServer } = require('@tus/server');
const { FileStore } = require('@tus/file-store');
const { authMiddleware, verifyToken } = require('./middleware/auth');
const nasRouter = require('./routes/nas');
const sharesRouter = require('./routes/shares');
const keysRouter = require('./routes/keys');
const dropRouter = require('./routes/drop');
const authRouter = require('./routes/auth');

const app = express();
const PORT = process.env.PORT || 4000;
const ASSETS_ROOT = process.env.ASSETS_ROOT || '/Volumes/May Server';

app.use(cors({
  origin: true,
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

// Tus endpoint — handles its own auth in onUploadCreate
app.all('/api/nas/tus', (req, res) => tusServer.handle(req, res));
app.all('/api/nas/tus/*', (req, res) => tusServer.handle(req, res));

// Protected routes — require valid Supabase JWT or API key
app.use('/api', authMiddleware);
app.use('/api/nas', nasRouter);
app.use('/api/shares', sharesRouter);
app.use('/api/keys', keysRouter);

// User info (tests that auth works)
app.get('/api/me', (req, res) => {
  res.json({ user: req.user });
});

app.listen(PORT, () => {
  console.log(`[Mayday Cloud API] listening on :${PORT}`);
});
