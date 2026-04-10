const { importJWK, jwtVerify, base64url } = require('jose');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

let cachedKey = null;

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

async function getJwtKey() {
  if (cachedKey) return cachedKey;
  const secret = process.env.SUPABASE_JWT_JWK;

  // Support both raw JWT secret (HS256) and JWK JSON (ES256)
  if (secret.startsWith('{')) {
    const jwk = JSON.parse(secret);
    cachedKey = await importJWK(jwk, 'ES256');
  } else {
    // Raw secret string — encode as HMAC key
    cachedKey = new TextEncoder().encode(secret);
  }
  return cachedKey;
}

// ─── Role cache (5-min TTL) ───
const roleCache = new Map();
const ROLE_TTL = 5 * 60 * 1000;

async function resolveRole(userId) {
  const cached = roleCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.role;

  const sb = getSupabase();
  const { data } = await sb.from('profiles').select('role').eq('id', userId).single();
  const role = data?.role || 'viewer';
  roleCache.set(userId, { role, expiresAt: Date.now() + ROLE_TTL });
  return role;
}

/**
 * Middleware factory: requireRole('admin', 'member')
 * Resolves the user's profile role and returns 403 if not allowed.
 */
function requireRole(...allowedRoles) {
  return async (req, res, next) => {
    try {
      const role = await resolveRole(req.user.id);
      if (!allowedRoles.includes(role)) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
      req.user.profileRole = role;
      next();
    } catch (err) {
      return res.status(500).json({ error: 'Role check failed' });
    }
  };
}

/**
 * Shared token verification — works for both JWT and API keys.
 * Returns { id, email, role, apiKey?, scopedPath? } or throws.
 */
async function verifyToken(token) {
  if (!token) throw new Error('No token');

  // API key path
  if (token.startsWith('mck_')) {
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    const sb = getSupabase();
    const { data: keyRow, error } = await sb
      .from('api_keys')
      .select('id, user_id, scoped_path, revoked_at')
      .eq('key_hash', hash)
      .single();

    if (error || !keyRow) throw new Error('Invalid API key');
    if (keyRow.revoked_at) throw new Error('API key revoked');

    const { data: profile } = await sb
      .from('profiles')
      .select('role')
      .eq('id', keyRow.user_id)
      .single();

    // Fire-and-forget last_used_at
    sb.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', keyRow.id).then(() => {});

    return {
      id: keyRow.user_id,
      apiKey: true,
      scopedPath: keyRow.scoped_path || null,
      role: profile?.role || 'viewer',
    };
  }

  // JWT path
  if (!process.env.SUPABASE_JWT_JWK) throw new Error('JWT key not configured');
  const key = await getJwtKey();
  const { payload } = await jwtVerify(token, key);
  return {
    id: payload.sub,
    email: payload.email,
    role: payload.role || 'authenticated',
  };
}

async function authMiddleware(req, res, next) {
  // Allow public drop endpoints (share links) without auth
  if (req.path.startsWith('/drop/')) {
    return next();
  }

  const header = req.headers.authorization;
  const queryToken = req.query.token;

  if (!header && !queryToken) {
    return res.status(401).json({ error: 'Missing authorization' });
  }

  const token = header ? header.slice(7) : queryToken;

  try {
    req.user = await verifyToken(token);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = { authMiddleware, requireRole, verifyToken };
