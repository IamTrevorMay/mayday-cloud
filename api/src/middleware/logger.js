/**
 * Structured request logging middleware.
 * Emits one JSON line per request to stdout (captured by pm2).
 */
function requestLogger(req, res, next) {
  const start = Date.now();

  const originalEnd = res.end;
  res.end = function (...args) {
    const duration_ms = Date.now() - start;
    const entry = {
      ts: new Date().toISOString(),
      method: req.method,
      route: req.originalUrl,
      status: res.statusCode,
      duration_ms,
      user_id: req.user?.id || null,
      ip: req.ip,
    };
    if (res.statusCode >= 400) {
      entry.error = res.statusMessage || null;
    }
    console.log(JSON.stringify(entry));
    originalEnd.apply(res, args);
  };

  next();
}

module.exports = { requestLogger };
