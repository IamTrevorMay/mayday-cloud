const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.SUPABASE_JWT_SECRET;

function authMiddleware(req, res, next) {
  // Allow public drop endpoints (share links) without auth
  if (req.path.startsWith('/drop/')) {
    return next();
  }

  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization header' });
  }

  const token = header.slice(7);

  try {
    if (!JWT_SECRET) {
      return res.status(500).json({ error: 'JWT secret not configured' });
    }
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = {
      id: decoded.sub,
      email: decoded.email,
      role: decoded.role || 'authenticated',
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = { authMiddleware };
