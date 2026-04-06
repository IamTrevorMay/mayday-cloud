const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

// POST /api/keys — Generate a new API key
router.post('/', async (req, res) => {
  try {
    const { name, scoped_path } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });

    const rawBytes = crypto.randomBytes(32);
    const rawKey = 'mck_' + rawBytes.toString('base64url');
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
    const keyPrefix = rawKey.slice(0, 12);

    const sb = getSupabase();
    const { data, error } = await sb.from('api_keys').insert({
      user_id: req.user.id,
      name,
      key_hash: keyHash,
      key_prefix: keyPrefix,
      scoped_path: scoped_path || null,
    }).select('id, name, key_prefix, scoped_path, created_at').single();

    if (error) throw error;
    res.json({ ...data, raw_key: rawKey });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/keys — List user's API keys
router.get('/', async (req, res) => {
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from('api_keys')
      .select('id, name, key_prefix, scoped_path, created_at, last_used_at, revoked_at')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/keys/:id — Soft revoke an API key
router.delete('/:id', async (req, res) => {
  try {
    const sb = getSupabase();
    const { error } = await sb
      .from('api_keys')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('user_id', req.user.id);

    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
