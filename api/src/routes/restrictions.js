const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const { requireRole } = require('../middleware/auth');

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

const adminGuard = requireRole('admin');

// GET /api/restrictions?folder_path=X
// Returns { blocked: { member: bool, viewer: bool } }
router.get('/', adminGuard, async (req, res) => {
  try {
    const { folder_path } = req.query;
    if (!folder_path) return res.status(400).json({ error: 'folder_path required' });

    const sb = getSupabase();
    const { data, error } = await sb
      .from('folder_restrictions')
      .select('blocked_role')
      .eq('folder_path', folder_path);

    if (error) throw error;

    const blockedRoles = new Set((data || []).map(r => r.blocked_role));
    res.json({
      folder_path,
      blocked: {
        member: blockedRoles.has('member'),
        viewer: blockedRoles.has('viewer'),
      },
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /api/restrictions
// Body: { folder_path, blocked: { member: bool, viewer: bool } }
router.put('/', adminGuard, async (req, res) => {
  try {
    const { folder_path, blocked } = req.body;
    if (!folder_path || !blocked) {
      return res.status(400).json({ error: 'folder_path and blocked required' });
    }

    const sb = getSupabase();

    for (const role of ['member', 'viewer']) {
      if (blocked[role]) {
        // Upsert restriction
        const { error } = await sb
          .from('folder_restrictions')
          .upsert(
            { folder_path, blocked_role: role, created_by: req.user.id },
            { onConflict: 'folder_path,blocked_role' }
          );
        if (error) throw error;
      } else {
        // Remove restriction
        const { error } = await sb
          .from('folder_restrictions')
          .delete()
          .eq('folder_path', folder_path)
          .eq('blocked_role', role);
        if (error) throw error;
      }
    }

    res.json({ success: true, folder_path, blocked });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
