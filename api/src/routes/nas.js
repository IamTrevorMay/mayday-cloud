const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const multer = require('multer');

const { getMimeType } = require('../utils/mime');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } });

const ASSETS_ROOT = process.env.ASSETS_ROOT || '/Volumes/May Server';

function sanitizePath(requestedPath, assetsRoot) {
  const resolved = path.resolve(assetsRoot, requestedPath || '');
  if (!resolved.startsWith(assetsRoot)) {
    throw new Error('Path traversal blocked');
  }
  return resolved;
}

// GET /api/nas/health
router.get('/health', async (req, res) => {
  try {
    await fsp.access(ASSETS_ROOT, fs.constants.R_OK | fs.constants.W_OK);
    res.json({ connected: true, assetsRoot: ASSETS_ROOT });
  } catch (err) {
    res.json({ connected: false, error: `Cannot access ${ASSETS_ROOT}: ${err.message}` });
  }
});

// GET /api/nas/list?path=/video&sort=name&order=asc
router.get('/list', async (req, res) => {
  try {
    const requestedPath = req.query.path || '';
    const fullPath = sanitizePath(requestedPath, ASSETS_ROOT);
    const sort = req.query.sort || 'name';
    const order = req.query.order || 'asc';

    const entries = await fsp.readdir(fullPath, { withFileTypes: true });

    const isRoot = !requestedPath || requestedPath === '' || requestedPath === '/';
    let items = (await Promise.all(entries.map(async (entry) => {
      if (isRoot && entry.name === '.trash') return null;
      try {
        const entryPath = path.join(fullPath, entry.name);
        const stat = await fsp.stat(entryPath);
        return {
          name: entry.name,
          path: path.relative(ASSETS_ROOT, entryPath),
          type: entry.isDirectory() ? 'directory' : 'file',
          size: stat.size,
          modified: stat.mtime.toISOString(),
          extension: entry.isDirectory() ? null : path.extname(entry.name).toLowerCase().slice(1) || null,
        };
      } catch {
        return null;
      }
    }))).filter(Boolean);

    items.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      let cmp = 0;
      if (sort === 'size') cmp = a.size - b.size;
      else if (sort === 'modified') cmp = new Date(a.modified || 0) - new Date(b.modified || 0);
      else cmp = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      return order === 'desc' ? -cmp : cmp;
    });

    res.json({ path: requestedPath || '/', items });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/nas/stat?path=...
router.get('/stat', async (req, res) => {
  try {
    const requestedPath = req.query.path;
    if (!requestedPath) return res.status(400).json({ error: 'path required' });
    const fullPath = sanitizePath(requestedPath, ASSETS_ROOT);
    const stat = await fsp.stat(fullPath);
    res.json({
      name: path.basename(fullPath),
      path: requestedPath,
      type: stat.isDirectory() ? 'directory' : 'file',
      size: stat.size,
      modified: stat.mtime.toISOString(),
      extension: path.extname(fullPath).toLowerCase().slice(1) || null,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/nas/download?path=...
router.get('/download', async (req, res) => {
  try {
    const requestedPath = req.query.path;
    if (!requestedPath) return res.status(400).json({ error: 'path required' });
    const fullPath = sanitizePath(requestedPath, ASSETS_ROOT);
    const fileName = path.basename(fullPath);

    const stat = await fsp.stat(fullPath);
    if (stat.isDirectory()) return res.status(400).json({ error: 'Cannot download a directory' });

    const ext = path.extname(fileName).toLowerCase().slice(1);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Type', getMimeType(ext));
    res.setHeader('Content-Length', stat.size);

    const stream = fs.createReadStream(fullPath);
    stream.on('error', (err) => {
      if (!res.headersSent) res.status(500).json({ error: err.message });
      else res.end();
    });
    stream.pipe(res);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/nas/upload
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    const targetPath = req.body.path || '';
    if (!req.file) return res.status(400).json({ error: 'No file provided' });

    const destDir = sanitizePath(targetPath, ASSETS_ROOT);
    const destPath = path.join(destDir, req.file.originalname);

    if (!destPath.startsWith(ASSETS_ROOT)) {
      return res.status(400).json({ error: 'Path traversal blocked' });
    }

    await fsp.mkdir(destDir, { recursive: true });
    await fsp.writeFile(destPath, req.file.buffer);

    res.json({ success: true, path: path.join(targetPath, req.file.originalname) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/nas/mkdir
router.post('/mkdir', async (req, res) => {
  try {
    const { path: dirPath } = req.body;
    if (!dirPath) return res.status(400).json({ error: 'path required' });
    const fullPath = sanitizePath(dirPath, ASSETS_ROOT);
    await fsp.mkdir(fullPath, { recursive: true });
    res.json({ success: true, path: dirPath });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/nas/rename
router.post('/rename', async (req, res) => {
  try {
    const { path: oldPath, newName } = req.body;
    if (!oldPath || !newName) return res.status(400).json({ error: 'path and newName required' });
    const fullOld = sanitizePath(oldPath, ASSETS_ROOT);
    const fullNew = path.join(path.dirname(fullOld), newName);
    if (!fullNew.startsWith(ASSETS_ROOT)) return res.status(400).json({ error: 'Path traversal blocked' });
    await fsp.rename(fullOld, fullNew);
    res.json({ success: true, path: path.relative(ASSETS_ROOT, fullNew) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/nas/delete
router.delete('/delete', async (req, res) => {
  try {
    const { path: filePath } = req.body;
    if (!filePath) return res.status(400).json({ error: 'path required' });
    const fullPath = sanitizePath(filePath, ASSETS_ROOT);
    const stat = await fsp.stat(fullPath);

    // Move to .trash instead of permanent delete
    const trashDir = path.join(ASSETS_ROOT, '.trash');
    await fsp.mkdir(trashDir, { recursive: true });
    const trashDest = path.join(trashDir, `${Date.now()}_${path.basename(fullPath)}`);
    await fsp.rename(fullPath, trashDest);

    res.json({ success: true, trashedTo: path.relative(ASSETS_ROOT, trashDest) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/nas/search?q=...&dataset=...
router.get('/search', async (req, res) => {
  try {
    const query = req.query.q;
    if (!query) return res.status(400).json({ error: 'q required' });
    const dataset = req.query.dataset || '';
    const searchRoot = sanitizePath(dataset, ASSETS_ROOT);
    const lowerQuery = query.toLowerCase();

    async function walk(dir, depth = 0) {
      if (depth > 10) return []; // safety limit
      let results = [];
      let entries;
      try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return results; }
      for (const entry of entries) {
        try {
          const entryPath = path.join(dir, entry.name);
          const isDir = entry.isDirectory();
          if (entry.name.toLowerCase().includes(lowerQuery)) {
            const stat = await fsp.stat(entryPath);
            results.push({
              name: entry.name,
              path: path.relative(ASSETS_ROOT, entryPath),
              type: isDir ? 'directory' : 'file',
              size: stat.size,
              modified: stat.mtime.toISOString(),
              extension: isDir ? null : path.extname(entry.name).toLowerCase().slice(1) || null,
            });
          }
          if (isDir) results = results.concat(await walk(entryPath, depth + 1));
        } catch { continue; }
      }
      return results;
    }

    const results = await walk(searchRoot);
    res.json({ query, results });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/nas/trash — list trash contents
router.get('/trash', async (req, res) => {
  try {
    const trashDir = path.join(ASSETS_ROOT, '.trash');
    try { await fsp.access(trashDir); } catch { return res.json({ items: [] }); }

    const entries = await fsp.readdir(trashDir, { withFileTypes: true });
    const items = (await Promise.all(entries.map(async (entry) => {
      try {
        const entryPath = path.join(trashDir, entry.name);
        const stat = await fsp.stat(entryPath);
        // Parse {timestamp}_{basename}
        const underscoreIdx = entry.name.indexOf('_');
        const timestamp = underscoreIdx > 0 ? parseInt(entry.name.slice(0, underscoreIdx), 10) : 0;
        const originalName = underscoreIdx > 0 ? entry.name.slice(underscoreIdx + 1) : entry.name;
        return {
          trashName: entry.name,
          originalName,
          type: entry.isDirectory() ? 'directory' : 'file',
          size: stat.size,
          deletedAt: timestamp ? new Date(timestamp).toISOString() : null,
          extension: entry.isDirectory() ? null : path.extname(originalName).toLowerCase().slice(1) || null,
        };
      } catch { return null; }
    }))).filter(Boolean);

    items.sort((a, b) => new Date(b.deletedAt || 0) - new Date(a.deletedAt || 0));
    res.json({ items });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/nas/trash/restore — restore item from trash
router.post('/trash/restore', async (req, res) => {
  try {
    const { trashName } = req.body;
    if (!trashName) return res.status(400).json({ error: 'trashName required' });

    const trashDir = path.join(ASSETS_ROOT, '.trash');
    const trashPath = path.join(trashDir, trashName);
    if (!trashPath.startsWith(trashDir)) return res.status(400).json({ error: 'Path traversal blocked' });

    // Parse original name
    const underscoreIdx = trashName.indexOf('_');
    const originalName = underscoreIdx > 0 ? trashName.slice(underscoreIdx + 1) : trashName;
    let destPath = path.join(ASSETS_ROOT, originalName);

    // Collision handling: append (1), (2), etc.
    if (await fsp.access(destPath).then(() => true).catch(() => false)) {
      const ext = path.extname(originalName);
      const base = ext ? originalName.slice(0, -ext.length) : originalName;
      let counter = 1;
      while (await fsp.access(destPath).then(() => true).catch(() => false)) {
        destPath = path.join(ASSETS_ROOT, `${base} (${counter})${ext}`);
        counter++;
      }
    }

    await fsp.rename(trashPath, destPath);
    res.json({ success: true, restoredTo: path.relative(ASSETS_ROOT, destPath) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/nas/trash/delete — permanently delete a single trash item
router.delete('/trash/delete', async (req, res) => {
  try {
    const { trashName } = req.body;
    if (!trashName) return res.status(400).json({ error: 'trashName required' });

    const trashDir = path.join(ASSETS_ROOT, '.trash');
    const trashPath = path.join(trashDir, trashName);
    if (!trashPath.startsWith(trashDir)) return res.status(400).json({ error: 'Path traversal blocked' });

    const stat = await fsp.stat(trashPath);
    if (stat.isDirectory()) {
      await fsp.rm(trashPath, { recursive: true, force: true });
    } else {
      await fsp.unlink(trashPath);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/nas/trash/empty — permanently delete all trash items
router.delete('/trash/empty', async (req, res) => {
  try {
    const trashDir = path.join(ASSETS_ROOT, '.trash');
    try { await fsp.access(trashDir); } catch { return res.json({ success: true, deleted: 0 }); }

    const entries = await fsp.readdir(trashDir);
    for (const entry of entries) {
      const entryPath = path.join(trashDir, entry);
      await fsp.rm(entryPath, { recursive: true, force: true });
    }
    res.json({ success: true, deleted: entries.length });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
