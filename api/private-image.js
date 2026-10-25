// Resolves a personal-lineup screenshot for its owner. The DB only ever
// stores a stable reference of the form /api/private-image?path=<userId>/
// <filename> (see js/image-upload.js and api/upload-url.js) — never a raw
// R2 URL, since presigned URLs expire and can't be persisted. This route
// checks the caller's Supabase session token, confirms the path's userId
// segment matches (an R2 equivalent of the old Storage RLS policy that
// scoped the private bucket to its owner), and redirects to a short-lived
// presigned R2 GET URL for the actual bytes.
//
// Admin moderation viewing of *other* users' private images is handled
// separately in api/admin.js (via the service key, bypassing this
// ownership check entirely) — this route serves a user's own images, plus
// images of lineups their owner has shared in a collection (api/_lib/sharing.js).
const { createClient } = require("@supabase/supabase-js");
const r2 = require("./_lib/r2");
const { setCorsHeaders } = require("./_lib/cors");
const { getAuthUser } = require("./_lib/auth");
const { isSharedPrivateImage } = require("./_lib/sharing");

function supabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    { auth: { persistSession: false } }
  );
}

// getAuthUser verifies the bearer token locally (see api/_lib/auth.js).

module.exports = async function handler(req, res) {
  setCorsHeaders(req, res, "GET, OPTIONS");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "GET") { res.status(405).json({ error: "Method not allowed" }); return; }

  try {
    const sb = supabase();
    const user = await getAuthUser(req, sb); // may be null: shared images work signed out

    const raw = req.query && req.query.path;
    const path = typeof raw === "string" ? decodeURIComponent(raw) : "";
    const slash = path.indexOf("/");
    if (slash < 0) { res.status(400).json({ error: "Malformed path" }); return; }
    const ownerId = path.slice(0, slash);
    const filename = path.slice(slash + 1);
    if (!ownerId || !filename) { res.status(400).json({ error: "Malformed path" }); return; }
    // Your own images, or one used by a lineup its owner currently shares in
    // a collection (anyone with that collection's link may see it, even signed
    // out). Anything else stays private.
    if (!user || ownerId !== user.id) {
      if (!(await isSharedPrivateImage(sb, ownerId, filename))) {
        res.status(user ? 403 : 401).json({ error: user ? "You can only view your own images" : "Sign in required" });
        return;
      }
    }

    const key = r2.privateKey(ownerId, filename);
    const signedUrl = await r2.presignGet(r2.PRIVATE_BUCKET(), key, 300);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Location", signedUrl);
    res.status(302).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err && err.message || err) });
  }
};
