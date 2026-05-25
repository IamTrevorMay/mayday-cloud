const express = require('express');
const crypto = require('crypto');
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

// PUT /api/restrictions/admin/users/:id/role
// Body: { role: 'admin' | 'member' | 'viewer' }
router.put('/admin/users/:id/role', adminGuard, async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;
    if (!role || !['admin', 'member', 'viewer'].includes(role)) {
      return res.status(400).json({ error: 'role must be admin, member, or viewer' });
    }

    const sb = getSupabase();
    const { data, error } = await sb
      .from('profiles')
      .update({ role })
      .eq('id', id)
      .select('id, email, display_name, role')
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'User not found' });

    res.json(data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/restrictions/admin/users/:id/reset-password — send password reset email (admin only)
router.post('/admin/users/:id/reset-password', adminGuard, async (req, res) => {
  try {
    const { id } = req.params;
    const sb = getSupabase();

    // Look up user email from profiles
    const { data: profile, error: profileErr } = await sb
      .from('profiles')
      .select('email')
      .eq('id', id)
      .single();
    if (profileErr || !profile) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { error } = await sb.auth.resetPasswordForEmail(profile.email, {
      redirectTo: (process.env.WEB_URL || 'https://www.mayday.systems') + '/reset',
    });
    if (error) throw error;

    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/restrictions/admin/users — create a user (admin only)
router.post('/admin/users', adminGuard, async (req, res) => {
  try {
    const { email, display_name, role } = req.body;
    if (!email) return res.status(400).json({ error: 'email is required' });

    const sb = getSupabase();
    const randomPassword = crypto.randomBytes(32).toString('hex');

    const { data: authData, error: authErr } = await sb.auth.admin.createUser({
      email,
      password: randomPassword,
      email_confirm: true,
    });
    if (authErr) throw authErr;

    const userId = authData.user.id;

    // Update profile with display_name and role if provided
    const updates = {};
    if (display_name) updates.display_name = display_name;
    if (role && role !== 'member') updates.role = role;

    if (Object.keys(updates).length > 0) {
      const { error: profileErr } = await sb
        .from('profiles')
        .update(updates)
        .eq('id', userId);
      if (profileErr) console.error('Profile update warning:', profileErr.message);
    }

    // Fetch the final profile
    const { data: profile } = await sb
      .from('profiles')
      .select('id, email, display_name, role')
      .eq('id', userId)
      .single();

    res.json(profile || { id: userId, email, display_name: display_name || null, role: role || 'member' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /api/restrictions/admin/users/:id/folders — batch set blocked folders (admin only)
router.put('/admin/users/:id/folders', adminGuard, async (req, res) => {
  try {
    const { id } = req.params;
    const { blocked_folders } = req.body;
    if (!Array.isArray(blocked_folders)) {
      return res.status(400).json({ error: 'blocked_folders must be an array' });
    }

    const sb = getSupabase();

    // Delete all existing user_folder_restrictions for this user
    const { error: deleteErr } = await sb
      .from('user_folder_restrictions')
      .delete()
      .eq('user_id', id);
    if (deleteErr) throw deleteErr;

    // Insert new rows for each blocked folder
    if (blocked_folders.length > 0) {
      const rows = blocked_folders.map(path => ({
        user_id: id,
        folder_path: path,
        created_by: req.user.id,
      }));
      const { error: insertErr } = await sb
        .from('user_folder_restrictions')
        .insert(rows);
      if (insertErr) throw insertErr;
    }

    res.json({ success: true, user_id: id, blocked_folders });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/restrictions/admin/users/:id — delete a user (admin only)
router.delete('/admin/users/:id', adminGuard, async (req, res) => {
  try {
    const { id } = req.params;

    // Prevent self-deletion
    if (id === req.user.id) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    const sb = getSupabase();

    // Delete from Supabase Auth
    const { error: authErr } = await sb.auth.admin.deleteUser(id);
    if (authErr) throw authErr;

    // Delete profile row
    const { error: profileErr } = await sb
      .from('profiles')
      .delete()
      .eq('id', id);
    if (profileErr) throw profileErr;

    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
