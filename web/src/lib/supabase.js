import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:4000';

/**
 * Fetch wrapper that attaches the current Supabase JWT.
 */
export async function authedFetch(path, options = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const headers = {
    ...options.headers,
    Authorization: `Bearer ${session.access_token}`,
  };

  // Don't set Content-Type for FormData (browser sets multipart boundary)
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
  }

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `API error ${res.status}`);
  }

  return res.json();
}

/**
 * Build a URL to the API with auth token as query param (for downloads, image src, etc.)
 */
export async function authedUrl(path) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const sep = path.includes('?') ? '&' : '?';
  return `${API_URL}${path}${sep}token=${session.access_token}`;
}
