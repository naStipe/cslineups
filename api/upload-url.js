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
const { setCorsHeaders } = require("./_lib/cors");
const { checkRateLimit } = require("./_lib/rate-limit");

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

// Enforced again server-side (the client-side check in js/image-upload.js
// is just a courtesy) — this is the cap actually applied by the confirm
// step below, since a presigned PUT can't enforce it by signature.
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

function randomFilename(ext) {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
}

// Only positive integers up to MAX_UPLOAD_BYTES are accepted — a sanity
// bound on the presigned URL's declared size, not the real enforcement
// (see confirmUpload below for that).
function validContentLength(v) {
  return Number.isInteger(v) && v > 0 && v <= MAX_UPLOAD_BYTES;
}

// Resolves the same bucket/key/publicUrl an isOfficial+filename pair would
// have gotten from presignUpload, so confirmUpload can re-derive them from
// just what it's told without trusting a client-supplied bucket or key.
function resolveTarget(isOfficial, userId, filename) {
  if (isOfficial) {
    return {
      bucket: r2.PUBLIC_BUCKET(),
      key: filename,
      publicUrl: `${r2.PUBLIC_BASE_URL()}/${filename}`,
    };
  }
  return {
    bucket: r2.PRIVATE_BUCKET(),
    key: r2.privateKey(userId, filename),
    publicUrl: `/api/private-image?path=${userId}/${filename}`,
  };
}

async function presignUpload(req, res, sb, user) {
  if (!(await checkRateLimit(sb, user.id, "upload"))) {
    res.status(429).json({ error: "Too many uploads. Try again in a bit." });
    return;
  }

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
  const { bucket, key, publicUrl } = resolveTarget(isOfficial, user.id, filename);

  const url = await r2.presignPut(bucket, key, contentType, contentLength, 300);
  res.status(200).json({ url, publicUrl, filename });
}

// Second step of the upload flow, called by the client right after its PUT
// to R2 succeeds. A presigned PUT has no signature-level size limit (see
// the top-of-file comment), so the declared contentLength presignUpload
// checked could be a lie — this reads the object's *actual* stored size
// straight from R2 and deletes it if it's over the cap, closing that gap.
async function confirmUpload(req, res, sb, user) {
  const body = req.body || {};
  const filename = typeof body.filename === "string" ? body.filename : "";
  if (!filename || /[\/\\]/.test(filename)) { res.status(400).json({ error: "Invalid filename" }); return; }

  const isOfficial = body.isOfficial === true;
  if (isOfficial && !(await isAdmin(sb, user.id))) {
    res.status(403).json({ error: "Admin access required to upload official screenshots" });
    return;
  }

  const { bucket, key } = resolveTarget(isOfficial, user.id, filename);
  const meta = await r2.headObject(bucket, key);
  if (!meta) { res.status(400).json({ error: "Upload not found" }); return; }
  if (meta.contentLength > MAX_UPLOAD_BYTES) {
    await r2.deleteObject(bucket, key);
    res.status(413).json({ error: `That file is too large (max ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB).` });
    return;
  }
  res.status(200).json({ ok: true });
}

module.exports = async function handler(req, res) {
  setCorsHeaders(req, res, "POST, OPTIONS");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  try {
    const sb = supabase();
    const user = await getAuthUser(req, sb);
    if (!user) { res.status(401).json({ error: "Sign in required" }); return; }

    const action = req.body && req.body.action;
    if (action === "confirm") await confirmUpload(req, res, sb, user);
    else await presignUpload(req, res, sb, user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err && err.message || err) });
  }
};
