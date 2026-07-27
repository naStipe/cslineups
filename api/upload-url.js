// Issues a presigned R2 PUT URL for a screenshot upload. The client never
// gets R2 credentials — it authenticates to us with its Supabase session
// token, we check permissions the same way Supabase Storage's RLS policies
// used to (official uploads require admin; personal uploads just require
// being signed in), then hand back a short-lived URL good for one PUT.
//
// Presigned PUT (not a proxy through this function) is required, not just
// convenient: Vercel serverless functions cap request bodies well under the
// 15MB screenshots this app allows, so the actual image bytes must go
// straight from the browser to R2.
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

async function isAdmin(sb, userId) {
  if (!userId) return false;
  const { data, error } = await sb.from("profiles").select("is_admin").eq("id", userId).maybeSingle();
  if (error || !data) return false;
  return !!data.is_admin;
}

// Same allow-list as js/image-upload.js — enforced again here since the
// client-side check is just a courtesy; this is the real gate now that
// Storage-bucket-level MIME restrictions are gone.
const ALLOWED_EXT = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

function randomFilename(ext) {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

module.exports = async function handler(req, res) {
  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  try {
    const sb = supabase();
    const user = await getAuthUser(req, sb);
    if (!user) { res.status(401).json({ error: "Sign in required" }); return; }

    const body = req.body || {};
    const contentType = typeof body.contentType === "string" ? body.contentType : "";
    const ext = ALLOWED_EXT[contentType];
    if (!ext) { res.status(400).json({ error: `Unsupported image type: ${contentType || "unknown"}` }); return; }

    const isOfficial = body.isOfficial === true;
    if (isOfficial && !(await isAdmin(sb, user.id))) {
      res.status(403).json({ error: "Admin access required to upload official screenshots" });
      return;
    }

    const filename = randomFilename(ext);
    let bucket, key, publicUrl;
    if (isOfficial) {
      bucket = r2.PUBLIC_BUCKET();
      key = filename;
      publicUrl = `${r2.PUBLIC_BASE_URL()}/${filename}`;
    } else {
      bucket = r2.PRIVATE_BUCKET();
      key = r2.privateKey(user.id, filename);
      publicUrl = `/api/private-image?path=${user.id}/${filename}`;
    }

    const uploadUrl = await r2.presignPut(bucket, key, contentType, 300);
    res.status(200).json({ uploadUrl, contentType, publicUrl });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err && err.message || err) });
  }
};
