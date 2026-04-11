const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const router = express.Router();

function getCloudSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function getStudioSupabase() {
  return createClient(
    process.env.STUDIO_SUPABASE_URL,
    process.env.STUDIO_SUPABASE_ANON_KEY
  );
}

// ─── Sign up with Cloud credentials ───
router.post('/signup', async (req, res) => {
  const { email, password, displayName } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const sb = getCloudSupabase();
  const { data, error } = await sb.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: displayName || null },
  });

  if (error) {
    if (error.message.includes('already been registered')) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }
    return res.status(400).json({ error: error.message });
  }

  // Sign them in immediately
  const anonSb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: signIn, error: signInErr } = await anonSb.auth.signInWithPassword({ email, password });
  if (signInErr) {
    return res.status(500).json({ error: 'Account created but sign-in failed. Try logging in.' });
  }

  res.json({ session: signIn.session });
});

// ─── Sign in with Cloud credentials ───
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  // Use a client-level Supabase (not service role) for password auth
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data, error } = await sb.auth.signInWithPassword({ email, password });

  if (error) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  res.json({ session: data.session });
});

// ─── Sign in with Mayday Studio credentials ───
router.post('/studio', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  if (!process.env.STUDIO_SUPABASE_URL || !process.env.STUDIO_SUPABASE_ANON_KEY) {
    return res.status(503).json({ error: 'Studio sign-in is not configured' });
  }

  // 1. Verify credentials against Studio Hub
  const studio = getStudioSupabase();
  const { data: studioAuth, error: studioErr } = await studio.auth.signInWithPassword({
    email,
    password,
  });

  if (studioErr) {
    return res.status(401).json({ error: 'Invalid Mayday Studio credentials' });
  }

  // 2. Check if this user already exists in Cloud. Query the profiles table
  // directly by email — listUsers() pages at 50 by default and would miss
  // any existing user past the first page, creating duplicate accounts.
  const cloud = getCloudSupabase();
  const { data: existingProfile, error: lookupErr } = await cloud
    .from('profiles')
    .select('id, email')
    .eq('email', email)
    .maybeSingle();

  if (lookupErr) {
    console.error('[studio-auth] profile lookup failed:', lookupErr);
    return res.status(500).json({ error: 'Failed to look up Cloud account' });
  }

  const existingUser = existingProfile || null;

  let cloudSession;

  if (existingUser) {
    // User exists — generate a session for them
    const { data: linkData, error: linkErr } = await cloud.auth.admin.generateLink({
      type: 'magiclink',
      email,
    });

    if (linkErr) {
      console.error('[studio-auth] generateLink (existing) failed:', linkErr);
      return res.status(500).json({ error: 'Failed to create Cloud session' });
    }

    // Exchange the hashed token for a session
    const { data: otpData, error: otpErr } = await cloud.auth.verifyOtp({
      token_hash: linkData.properties.hashed_token,
      type: 'magiclink',
    });

    if (otpErr) {
      console.error('[studio-auth] verifyOtp (existing) failed:', otpErr);
      return res.status(500).json({ error: 'Failed to create Cloud session' });
    }

    cloudSession = otpData.session;
  } else {
    // New user — create a Cloud account linked to their Studio identity
    const studioUser = studioAuth.user;
    const randomPassword = require('crypto').randomBytes(32).toString('hex');

    const { data: newUser, error: createErr } = await cloud.auth.admin.createUser({
      email,
      password: randomPassword,
      email_confirm: true,
      user_metadata: {
        display_name: studioUser.user_metadata?.display_name || studioUser.user_metadata?.full_name || null,
        studio_linked: true,
      },
    });

    if (createErr) {
      console.error('[studio-auth] createUser failed:', createErr);
      return res.status(500).json({ error: 'Failed to create Cloud account' });
    }

    // Generate session for the new user
    const { data: linkData, error: linkErr } = await cloud.auth.admin.generateLink({
      type: 'magiclink',
      email,
    });

    if (linkErr) {
      console.error('[studio-auth] generateLink (new) failed:', linkErr);
      return res.status(500).json({ error: 'Failed to create Cloud session' });
    }

    const { data: otpData, error: otpErr } = await cloud.auth.verifyOtp({
      token_hash: linkData.properties.hashed_token,
      type: 'magiclink',
    });

    if (otpErr) {
      console.error('[studio-auth] verifyOtp (new) failed:', otpErr);
      return res.status(500).json({ error: 'Failed to create Cloud session' });
    }

    cloudSession = otpData.session;
  }

  if (!cloudSession) {
    return res.status(500).json({ error: 'Failed to establish session' });
  }

  res.json({ session: cloudSession });
});

module.exports = router;
