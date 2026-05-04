const express = require('express');
const fsp = require('fs/promises');
const { exec } = require('child_process');
const { createClient } = require('@supabase/supabase-js');
const { requireRole } = require('../middleware/auth');

const router = express.Router();
const ASSETS_ROOT = process.env.ASSETS_ROOT || '/Volumes/May Server';

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function getDiskUsage() {
  return new Promise((resolve, reject) => {
    exec(`df -k "${ASSETS_ROOT}"`, (err, stdout) => {
      if (err) return reject(err);
      const lines = stdout.trim().split('\n');
      if (lines.length < 2) return reject(new Error('Unexpected df output'));
      const parts = lines[1].split(/\s+/);
      // df -k columns: Filesystem 1K-blocks Used Available Capacity ...
      const total = parseInt(parts[1], 10) * 1024;
      const used = parseInt(parts[2], 10) * 1024;
      const available = parseInt(parts[3], 10) * 1024;
      const percent = parts[4]; // e.g. "45%"
      resolve({ total, used, available, percent });
    });
  });
}

router.get('/health', requireRole('admin'), async (req, res) => {
  try {
    const sb = getSupabase();

    // API status
    const api = { ok: true, uptime_s: Math.floor(process.uptime()) };

    // NAS connectivity
    let nas;
    try {
      await fsp.access(ASSETS_ROOT, fsp.constants.R_OK | fsp.constants.W_OK);
      nas = { connected: true, assetsRoot: ASSETS_ROOT };
    } catch {
      nas = { connected: false, assetsRoot: ASSETS_ROOT };
    }

    // Disk usage
    let disk;
    try {
      disk = await getDiskUsage();
    } catch {
      disk = { error: 'Could not read disk usage' };
    }

    // User count
    const { count: userCount } = await sb
      .from('profiles')
      .select('*', { count: 'exact', head: true });

    // Active share links
    const { data: shares } = await sb
      .from('share_links')
      .select('mode, max_uses, used_count, expires_at')
      .or('expires_at.is.null,expires_at.gt.' + new Date().toISOString());

    const activeShares = (shares || []).filter(s =>
      !s.max_uses || s.used_count < s.max_uses
    );
    const byMode = { upload: 0, download: 0, both: 0 };
    for (const s of activeShares) {
      if (byMode[s.mode] !== undefined) byMode[s.mode]++;
    }

    res.json({
      api,
      nas,
      disk,
      users: { count: userCount || 0 },
      shares: { active_count: activeShares.length, by_mode: byMode },
    });
  } catch (err) {
    console.error('[admin/health] error:', err.message);
    res.status(500).json({ error: 'Health check failed' });
  }
});

module.exports = router;
