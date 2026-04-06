const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');

const { getMimeType } = require('../utils/mime');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } });
const ASSETS_ROOT = process.env.ASSETS_ROOT || '/Volumes/May Server';

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function sanitizePath(requestedPath) {
  const resolved = path.resolve(ASSETS_ROOT, requestedPath || '');
  if (!resolved.startsWith(ASSETS_ROOT)) throw new Error('Path traversal blocked');
  return resolved;
}

// GET /api/drop/:token — Validate share link (public, no auth)
router.get('/:token', async (req, res) => {
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from('share_links')
      .select('id, target_path, mode, max_uses, used_count, expires_at, created_by')
      .eq('token', req.params.token)
      .single();

    if (error || !data) return res.status(404).json({ error: 'Link not found' });

    // Check expiry
    if (data.expires_at && new Date(data.expires_at) < new Date()) {
      return res.status(410).json({ error: 'Link expired' });
    }

    // Check usage
    if (data.max_uses && data.used_count >= data.max_uses) {
      return res.status(410).json({ error: 'Link usage limit reached' });
    }

    // Get creator email for display
    let created_by_email = null;
    const { data: profile } = await sb
      .from('profiles')
      .select('email')
      .eq('id', data.created_by)
      .single();
    if (profile) created_by_email = profile.email;

    // Determine target type (file vs directory)
    let target_type = 'file';
    try {
      const fullPath = sanitizePath(data.target_path);
      const stat = await fsp.stat(fullPath);
      target_type = stat.isDirectory() ? 'directory' : 'file';
    } catch {}

    res.json({
      mode: data.mode,
      expires_at: data.expires_at,
      remaining: data.max_uses ? data.max_uses - data.used_count : null,
      created_by_email,
      target_path: data.target_path,
      target_type,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/drop/:token/upload — Upload via share link (public, no auth)
router.post('/:token/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file provided' });

    const sb = getSupabase();
    const { data: link, error } = await sb
      .from('share_links')
      .select('*')
      .eq('token', req.params.token)
      .single();

    if (error || !link) return res.status(404).json({ error: 'Link not found' });

    // Validate
    if (link.expires_at && new Date(link.expires_at) < new Date()) {
      return res.status(410).json({ error: 'Link expired' });
    }
    if (link.max_uses && link.used_count >= link.max_uses) {
      return res.status(410).json({ error: 'Link usage limit reached' });
    }
    if (link.mode === 'download') {
      return res.status(403).json({ error: 'This link is download-only' });
    }

    // Write file
    const destDir = sanitizePath(link.target_path);
    const destPath = path.join(destDir, req.file.originalname);
    if (!destPath.startsWith(ASSETS_ROOT)) {
      return res.status(400).json({ error: 'Path traversal blocked' });
    }

    await fsp.mkdir(destDir, { recursive: true });
    await fsp.writeFile(destPath, req.file.buffer);

    // Atomically increment used_count (optimistic lock prevents race condition)
    const { data: updated, error: updateErr } = await sb
      .from('share_links')
      .update({ used_count: link.used_count + 1 })
      .eq('id', link.id)
      .eq('used_count', link.used_count)
      .select('id');

    if (updateErr || !updated || updated.length === 0) {
      // Another request incremented first — remove the written file and reject
      await fsp.unlink(destPath).catch(() => {});
      return res.status(410).json({ error: 'Link usage limit reached' });
    }

    res.json({ success: true, name: req.file.originalname });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/drop/:token/download — download via share link (public, no auth)
router.get('/:token/download', async (req, res) => {
  try {
    const sb = getSupabase();
    const { data: link, error } = await sb
      .from('share_links')
      .select('*')
      .eq('token', req.params.token)
      .single();

    if (error || !link) return res.status(404).json({ error: 'Link not found' });

    if (link.expires_at && new Date(link.expires_at) < new Date()) {
      return res.status(410).json({ error: 'Link expired' });
    }
    if (link.max_uses && link.used_count >= link.max_uses) {
      return res.status(410).json({ error: 'Link usage limit reached' });
    }
    if (link.mode === 'upload') {
      return res.status(403).json({ error: 'This link is upload-only' });
    }

    const fullPath = sanitizePath(link.target_path);
    const stat = await fsp.stat(fullPath);

    if (stat.isDirectory()) {
      // Directory share
      const requestedFile = req.query.file;
      if (!requestedFile) {
        // List files in directory
        const entries = await fsp.readdir(fullPath, { withFileTypes: true });
        const files = entries
          .filter(e => !e.isDirectory())
          .map(e => ({ name: e.name }));
        return res.json({ type: 'directory', files });
      }
      // Stream the requested file
      const filePath = path.join(fullPath, requestedFile);
      if (!filePath.startsWith(fullPath)) {
        return res.status(400).json({ error: 'Path traversal blocked' });
      }
      const fileStat = await fsp.stat(filePath);
      const ext = path.extname(requestedFile).toLowerCase().slice(1);
      res.setHeader('Content-Disposition', `attachment; filename="${requestedFile}"`);
      res.setHeader('Content-Type', getMimeType(ext));
      res.setHeader('Content-Length', fileStat.size);
      const stream = fs.createReadStream(filePath);
      stream.on('error', (err) => {
        if (!res.headersSent) res.status(500).json({ error: err.message });
        else res.end();
      });
      return stream.pipe(res);
    }

    // File share — stream directly
    const fileName = path.basename(fullPath);
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

module.exports = router;
