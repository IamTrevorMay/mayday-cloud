const { createClient } = require('@supabase/supabase-js');
const os = require('os');

// Supabase public config (anon key is safe to embed — it's a public key)
const SUPABASE_URL = 'https://cuqurazxkyotoqsznjil.supabase.co';
// Public anon key — safe to embed (same key used in web app)
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN1cXVyYXp4a3lvdG9xc3puamlsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0OTI5OTksImV4cCI6MjA5MTA2ODk5OX0.3q6b0rsZlCJ2AGsaeu_s0s0XghKzekZk98qXzyx_nW0';
const API_URL = process.env.API_URL || 'https://assets.maydaystudio.net';

let supabase = null;

function getSupabase() {
  if (!supabase) {
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return supabase;
}

/**
 * Generate an mck_* API key using a Cloud JWT access token.
 * Shared by both login flows.
 */
async function generateApiKey(accessToken) {
  const keyName = `Desktop - ${os.hostname()}`;
  const res = await fetch(`${API_URL}/api/keys`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name: keyName }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Failed to generate API key (${res.status})`);
  }

  return (await res.json()).raw_key;
}

/**
 * Log in with Cloud email + password, then auto-generate an API key.
 * Returns { apiKey, apiUrl, email }.
 */
async function login(email, password) {
  const sb = getSupabase();

  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);

  const apiKey = await generateApiKey(data.session.access_token);

  // Sign out from Supabase — we only needed the JWT to create the API key
  await sb.auth.signOut();

  return { apiKey, apiUrl: API_URL, email };
}

/**
 * Log in with Mayday Studio credentials via the API bridge.
 * The API validates against Studio Supabase and returns a Cloud session.
 * Returns { apiKey, apiUrl, email }.
 */
async function studioLogin(email, password) {
  const res = await fetch(`${API_URL}/api/auth/studio`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Studio sign-in failed (${res.status})`);

  const apiKey = await generateApiKey(body.session.access_token);

  return { apiKey, apiUrl: API_URL, email };
}

module.exports = { login, studioLogin };
