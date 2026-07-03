/**
 * Redact auth credentials from a URL before logging it. Media endpoints accept
 * the JWT / mck_ key as a ?token= query param, so req.originalUrl otherwise
 * writes a live credential into the logs on every playback/download.
 */
function redactUrl(url) {
  if (!url) return url;
  return url.replace(/([?&](?:token|access_token|api_key|apikey)=)[^&]*/gi, '$1[redacted]');
}

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
      route: redactUrl(req.originalUrl),
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

module.exports = { requestLogger, redactUrl };
