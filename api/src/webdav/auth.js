const webdav = require('webdav-server').v2;
const { verifyToken } = require('../middleware/auth');

/**
 * Custom HTTP Basic Auth adapter for WebDAV.
 * Username: "apikey" (literal, ignored)
 * Password: mck_* API key or Supabase JWT
 *
 * Compatible with rclone's --webdav-user / --webdav-pass flags.
 */
class MaydayWebDAVAuth extends webdav.HTTPBasicAuthentication {
  constructor() {
    super(new webdav.SimpleUserManager(), 'Mayday Cloud');
  }

  getUser(ctx, callback) {
    // ctx.headers.find() returns the header value as a string (not an object)
    const authHeader = ctx.headers.find('Authorization');
    if (!authHeader) {
      return callback(webdav.Errors.MissingAuthorisationHeader);
    }

    const match = authHeader.match(/^Basic\s+(.+)$/i);
    if (!match) {
      return callback(webdav.Errors.WrongHeaderFormat);
    }

    let decoded;
    try {
      decoded = Buffer.from(match[1], 'base64').toString('utf8');
    } catch {
      return callback(webdav.Errors.WrongHeaderFormat);
    }

    // Split on first colon only (password may contain colons)
    const colonIdx = decoded.indexOf(':');
    if (colonIdx === -1) {
      return callback(webdav.Errors.WrongHeaderFormat);
    }

    const password = decoded.slice(colonIdx + 1);
    if (!password) {
      return callback(webdav.Errors.BadAuthentication);
    }

    // Verify the token/API key through the existing auth system
    verifyToken(password)
      .then((user) => {
        // Create a simple user object that webdav-server expects
        const wdUser = { uid: user.id, username: user.email || 'apikey', isAdministrator: false, _maydayUser: user };
        callback(null, wdUser);
      })
      .catch(() => {
        callback(webdav.Errors.BadAuthentication);
      });
  }
}

module.exports = { MaydayWebDAVAuth };
