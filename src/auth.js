const crypto = require('crypto');

// Single hardcoded admin account via env vars — see ROADMAP "Multiple users"
// for the multi-account/roles version, deliberately not built yet.
const USERNAME = process.env.ADMIN_USERNAME || '';
const PASSWORD = process.env.ADMIN_PASSWORD || '';

if (!USERNAME || !PASSWORD) {
  console.warn('ADMIN_USERNAME/ADMIN_PASSWORD are not set — the admin panel cannot be logged into.');
}

// Constant-time comparison so response timing can't leak how much of the
// guess was correct. Pads to matching length first since timingSafeEqual
// throws on a length mismatch (which would itself leak length info).
function safeEqual(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, Buffer.alloc(bufA.length));
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function checkCredentials(username, password) {
  return safeEqual(username || '', USERNAME) && safeEqual(password || '', PASSWORD);
}

function requireAuth(req, res, next) {
  if (req.session.loggedIn) return next();
  res.redirect('/admin/login');
}

module.exports = { checkCredentials, requireAuth };
