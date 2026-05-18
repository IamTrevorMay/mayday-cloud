const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const { requireRole } = require('../middleware/auth');

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

const adminGuard = requireRole('admin');

// GET /api/admin/users — list all profiles (admin only)
router.get('/admin/users', adminGuard, async (req, res) => {
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from('profiles')
      .select('id, email, display_name, role')
      .order('email');
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/restrictions?folder_path=X
// Returns { folder_path, blocked: { member, viewer }, blocked_users: [uuid, ...] }
router.get('/', adminGuard, async (req, res) => {
  try {
    const { folder_path } = req.query;
    if (!folder_path) return res.status(400).json({ error: 'folder_path required' });

    const sb = getSupabase();
    const [roleResult, userResult] = await Promise.all([
      sb.from('folder_restrictions').select('blocked_role').eq('folder_path', folder_path),
      sb.from('user_folder_restrictions').select('user_id').eq('folder_path', folder_path),
    ]);

    if (roleResult.error) throw roleResult.error;
    if (userResult.error) throw userResult.error;

    const blockedRoles = new Set((roleResult.data || []).map(r => r.blocked_role));
    const blockedUsers = (userResult.data || []).map(r => r.user_id);

    res.json({
      folder_path,
      blocked: {
        member: blockedRoles.has('member'),
        viewer: blockedRoles.has('viewer'),
      },
      blocked_users: blockedUsers,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /api/restrictions
// Body: { folder_path, blocked: { member, viewer }, blocked_users: [uuid, ...] }
router.put('/', adminGuard, async (req, res) => {
  try {
    const { folder_path, blocked, blocked_users } = req.body;
    if (!folder_path || !blocked) {
      return res.status(400).json({ error: 'folder_path and blocked required' });
    }

    const sb = getSupabase();

    // --- Role-level restrictions ---
    for (const role of ['member', 'viewer']) {
      if (blocked[role]) {
        const { error } = await sb
          .from('folder_restrictions')
          .upsert(
            { folder_path, blocked_role: role, created_by: req.user.id },
            { onConflict: 'folder_path,blocked_role' }
          );
        if (error) throw error;
      } else {
        const { error } = await sb
          .from('folder_restrictions')
          .delete()
          .eq('folder_path', folder_path)
          .eq('blocked_role', role);
        if (error) throw error;
      }
    }

    // --- Per-user restrictions ---
    if (Array.isArray(blocked_users)) {
      // Get current user restrictions for this folder
      const { data: existing, error: fetchErr } = await sb
        .from('user_folder_restrictions')
        .select('user_id')
        .eq('folder_path', folder_path);
      if (fetchErr) throw fetchErr;

      const currentSet = new Set((existing || []).map(r => r.user_id));
      const desiredSet = new Set(blocked_users);

      // Insert new blocks
      const toInsert = blocked_users.filter(uid => !currentSet.has(uid));
      if (toInsert.length > 0) {
        const { error } = await sb
          .from('user_folder_restrictions')
          .insert(toInsert.map(uid => ({ folder_path, user_id: uid, created_by: req.user.id })));
        if (error) throw error;
      }

      // Remove unblocked users
      const toRemove = [...currentSet].filter(uid => !desiredSet.has(uid));
      if (toRemove.length > 0) {
        const { error } = await sb
          .from('user_folder_restrictions')
          .delete()
          .eq('folder_path', folder_path)
          .in('user_id', toRemove);
        if (error) throw error;
      }
    }

    res.json({ success: true, folder_path, blocked, blocked_users: blocked_users || [] });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
