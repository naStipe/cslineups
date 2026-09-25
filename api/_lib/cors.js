// Origin-aware CORS headers, shared by every API route. Wildcard
// ("Access-Control-Allow-Origin: *") let any site make cross-origin
// requests against these endpoints; scoping to our own origin(s) still
// leaves same-site fetches (what the app itself does) working exactly as
// before, since the browser only consults ACAO for cross-origin calls.
//
// ALLOWED_ORIGINS accepts a comma-separated list via env for extra origins
// (e.g. a staging domain). The production domain and any Vercel preview
// deployment (*.vercel.app) are always allowed.
const EXTRA_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",").map(s => s.trim()).filter(Boolean);
const SITE_ORIGIN = (process.env.SITE_URL || "https://lineupr.org").replace(/\/+$/, "");
const VERCEL_PREVIEW = /^https:\/\/[a-z0-9-]+\.vercel\.app$/i;

function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (origin === SITE_ORIGIN) return true;
  if (EXTRA_ORIGINS.includes(origin)) return true;
  if (VERCEL_PREVIEW.test(origin)) return true;
  return false;
}

// Sets the CORS headers on `res` for this request. `methods` is the
// endpoint's Access-Control-Allow-Methods value (e.g. "GET, POST, OPTIONS").
function setCorsHeaders(req, res, methods) {
  const origin = req.headers.origin;
  res.setHeader("Access-Control-Allow-Origin", isAllowedOrigin(origin) ? origin : SITE_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", methods);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Vary", "Origin");
}

module.exports = { setCorsHeaders };
