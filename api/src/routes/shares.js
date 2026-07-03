const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { requireRole } = require('../middleware/auth');

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

const writeGuard = requireRole('admin', 'member');

// POST /api/shares — Create a share link (authed)
router.post('/', writeGuard, async (req, res) => {
  try {
    const { target_path, mode = 'upload', max_uses = 10, expires_in_hours = 72 } = req.body;
    if (!target_path) return res.status(400).json({ error: 'target_path required' });
    if (!['upload', 'download', 'both'].includes(mode)) {
      return res.status(400).json({ error: "mode must be 'upload', 'download', or 'both'" });
    }
    // null/undefined max_uses means unlimited; a provided limit must be >= 1.
    // A stored max_uses of 0 read as falsy downstream ("&& used_count >= ...")
    // and silently became unlimited.
    if (max_uses !== null && max_uses !== undefined && (!Number.isInteger(max_uses) || max_uses < 1)) {
      return res.status(400).json({ error: 'max_uses must be a positive integer, or null for unlimited' });
    }
    if (!Number.isFinite(expires_in_hours) || expires_in_hours <= 0) {
      return res.status(400).json({ error: 'expires_in_hours must be a positive number' });
    }

    const token = crypto.randomBytes(24).toString('base64url');
    const expires_at = new Date(Date.now() + expires_in_hours * 3600000).toISOString();

    const sb = getSupabase();
    const { data, error } = await sb.from('share_links').insert({
      token,
      target_path,
      mode,
      max_uses,
      expires_at,
      created_by: req.user.id,
      used_count: 0,
    }).select().single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/shares — List my share links (authed)
router.get('/', async (req, res) => {
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from('share_links')
      .select('*')
      .eq('created_by', req.user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/shares/:id — Revoke a share link (authed)
router.delete('/:id', writeGuard, async (req, res) => {
  try {
    const sb = getSupabase();
    const { error } = await sb
      .from('share_links')
      .delete()
      .eq('id', req.params.id)
      .eq('created_by', req.user.id);

    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
