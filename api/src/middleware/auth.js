const { importJWK, jwtVerify } = require('jose');

let cachedKey = null;

async function getPublicKey() {
  if (cachedKey) return cachedKey;
  const jwk = JSON.parse(process.env.SUPABASE_JWT_JWK);
  cachedKey = await importJWK(jwk, 'ES256');
  return cachedKey;
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
    if (!process.env.SUPABASE_JWT_JWK) {
      return res.status(500).json({ error: 'JWT key not configured' });
    }
    const key = await getPublicKey();
    const { payload } = await jwtVerify(token, key);
    req.user = {
      id: payload.sub,
      email: payload.email,
      role: payload.role || 'authenticated',
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = { authMiddleware };
