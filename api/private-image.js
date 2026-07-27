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
// ownership check entirely) — this route is only for a user viewing their
// own images.
const { createClient } = require("@supabase/supabase-js");
const r2 = require("./_lib/r2");

function supabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    { auth: { persistSession: false } }
  );
}

async function getAuthUser(req, sb) {
  const header = req.headers["authorization"] || req.headers["Authorization"];
  if (!header || !header.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data || !data.user) return null;
  return data.user;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

module.exports = async function handler(req, res) {
  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "GET") { res.status(405).json({ error: "Method not allowed" }); return; }

  try {
    const sb = supabase();
    const user = await getAuthUser(req, sb);
    if (!user) { res.status(401).json({ error: "Sign in required" }); return; }

    const raw = req.query && req.query.path;
    const path = typeof raw === "string" ? decodeURIComponent(raw) : "";
    const slash = path.indexOf("/");
    if (slash < 0) { res.status(400).json({ error: "Malformed path" }); return; }
    const ownerId = path.slice(0, slash);
    const filename = path.slice(slash + 1);
    if (!ownerId || !filename) { res.status(400).json({ error: "Malformed path" }); return; }
    if (ownerId !== user.id) { res.status(403).json({ error: "You can only view your own images" }); return; }

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
