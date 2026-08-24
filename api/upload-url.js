// Issues a presigned R2 PUT for a screenshot upload. The client never gets
// R2 credentials — it authenticates to us with its Supabase session token,
// we check permissions the same way Supabase Storage's RLS policies used to
// (official uploads require admin; personal uploads just require being
// signed in), then hand back a short-lived PUT good for one upload.
//
// A presigned upload (not a proxy through this function) is required, not
// just convenient: Vercel serverless functions cap request bodies well
// under the 15MB screenshots this app allows, so the actual image bytes
// must go straight from the browser to R2.
//
// PUT, not POST: R2's S3-compatible API doesn't implement the S3
// "POST Object" operation (every attempt gets a flat 501 Not Implemented
// from R2 itself), so the presigned-POST + content-length-range approach
// this used to use can never work against R2. A presigned PUT has no
// equivalent size-range condition, so the hard per-upload size guarantee
// Supabase Storage's bucket settings used to give us is now just this
// contentLength check below plus the client-side check in
// js/image-upload.js — both bypassable by a determined attacker hitting
// this endpoint directly, same caveat as the MIME check below.
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

// Same cap as js/image-upload.js's client-side check — enforced again here
// (via the presigned POST's content-length-range condition) since that
// client-side check alone is bypassable.
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

function randomFilename(ext) {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// Only positive integers up to MAX_UPLOAD_BYTES are accepted — this is the
// only server-side size guard left now that R2 can't enforce a
// content-length-range by signature (see the top-of-file comment).
function validContentLength(v) {
  return Number.isInteger(v) && v > 0 && v <= MAX_UPLOAD_BYTES;
}

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

    const contentLength = Math.trunc(Number(body.contentLength));
    if (!validContentLength(contentLength)) {
      res.status(400).json({ error: `Invalid or missing contentLength (must be > 0 and <= ${MAX_UPLOAD_BYTES} bytes)` });
      return;
    }

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

    const url = await r2.presignPut(bucket, key, contentType, contentLength, 300);
    res.status(200).json({ url, publicUrl });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err && err.message || err) });
  }
};
