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
// this endpoint directly, same caveat as the MIME check below. The real
// size guarantee is the HEAD of the stored object: it used to be a separate
// "confirm" call after every PUT (one more serverless invocation + Supabase
// auth round trip per image); it now happens once per lineup save in
// api/lineups.js (see verifyNewImages in api/_lib/uploads.js), so a
// too-large object can never end up referenced by a saved lineup. The
// confirm action is kept below for browsers still running the old script.
//
// Actions (POST body):
//  - { isOfficial, contentType, contentLength }        → one presigned PUT
//    (original shape, kept for compatibility)
//  - { isOfficial, files: [{ contentType, contentLength }, ...] } → N PUTs
//    in one round trip ({ uploads: [{ url, publicUrl, filename }] })
//  - { action: "delete", isOfficial, filenames: [...] } → best-effort cleanup
//    of uploads the caller just made but didn't save (image removed, throw
//    modal discarded). See deleteUploads for the guards.
//  - { action: "confirm", isOfficial, filename }        → legacy size check
const { createClient } = require("@supabase/supabase-js");
const r2 = require("./_lib/r2");
const { setCorsHeaders } = require("./_lib/cors");
const { getAuthUser, isAdmin } = require("./_lib/auth");
const { checkRateLimit } = require("./_lib/rate-limit");
const { ALLOWED_EXT, MAX_UPLOAD_BYTES, RANDOM_FILENAME, isVideoName, maxBytesFor, randomFilename, resolveTarget } = require("./_lib/uploads");

function supabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    { auth: { persistSession: false } }
  );
}

// Most images one throw position can hold (3 standing + 5 aim + precise +
// result); a batch presign or delete never needs more.
const MAX_BATCH = 10;

// How old an upload may be and still be deleted by the "delete" action.
const FRESH_MS = 24 * 60 * 60 * 1000;

// Only positive integers up to MAX_UPLOAD_BYTES are accepted — a sanity
// bound on the presigned URL's declared size, not the real enforcement
// (that is the save-time HEAD in api/lineups.js, see the top of this file).
function validContentLength(v, ext) {
  return Number.isInteger(v) && v > 0 && v <= maxBytesFor(ext);
}

// Returns { contentType, contentLength, ext } or { error }.
function parseFileSpec(spec) {
  const contentType = spec && typeof spec.contentType === "string" ? spec.contentType : "";
  const ext = ALLOWED_EXT[contentType];
  if (!ext) return { error: `Unsupported file type: ${contentType || "unknown"}` };
  const contentLength = Math.trunc(Number(spec.contentLength));
  if (!validContentLength(contentLength, ext)) {
    return { error: `Invalid or missing contentLength (must be > 0 and <= ${maxBytesFor(ext)} bytes)` };
  }
  return { contentType, contentLength, ext };
}

async function presignUpload(req, res, sb, user) {
  const body = req.body || {};
  const batch = Array.isArray(body.files);
  const specs = batch ? body.files : [body];
  if (!specs.length || specs.length > MAX_BATCH) {
    res.status(400).json({ error: `Send between 1 and ${MAX_BATCH} files` });
    return;
  }
  const parsed = specs.map(parseFileSpec);
  const bad = parsed.find(p => p.error);
  if (bad) { res.status(400).json({ error: bad.error }); return; }

  const isOfficial = body.isOfficial === true;
  // The rate limit is per presigned file, not per request, so batching
  // doesn't stretch the hourly cap: one check per file, all in parallel
  // with each other and with the admin lookup (each is a DB round trip).
  const [admin, ...allowed] = await Promise.all([
    isOfficial ? isAdmin(sb, user.id) : Promise.resolve(false),
    ...parsed.map(() => checkRateLimit(sb, user.id, "upload")),
  ]);
  if (allowed.some(ok => !ok)) {
    res.status(429).json({ error: "Too many uploads. Try again in a bit." });
    return;
  }
  if (isOfficial && !admin) {
    res.status(403).json({ error: "Admin access required to upload official screenshots" });
    return;
  }

  const uploads = await Promise.all(parsed.map(async (p) => {
    const filename = randomFilename(p.ext);
    const { bucket, key, publicUrl } = resolveTarget(isOfficial, user.id, filename);
    const url = await r2.presignPut(bucket, key, p.contentType, p.contentLength, 300);
    return { url, publicUrl, filename };
  }));
  res.status(200).json(batch ? { uploads } : uploads[0]);
}

// Best-effort removal of uploads the caller made but never saved (the user
// removed the image, or discarded the throw modal). Guards, so this can only
// ever undo the caller's own fresh uploads:
//  - every filename must match RANDOM_FILENAME (what presignUpload mints)
//    and its embedded base36 timestamp must be under a day old, so only
//    fresh uploads qualify, never older objects;
//  - personal keys are rebuilt inside the caller's own folder
//    (resolveTarget), never taken from the client;
//  - public (official) keys need an admin;
//  - an object referenced by any saved lineup is never deleted: each URL is
//    looked up in lineups.throws first (jsonb containment, one query per
//    image field) and skipped if found.
async function deleteUploads(req, res, sb, user) {
  const body = req.body || {};
  const filenames = Array.isArray(body.filenames) ? body.filenames : [];
  if (!filenames.length || filenames.length > MAX_BATCH || !filenames.every(f => typeof f === "string" && RANDOM_FILENAME.test(f))) {
    res.status(400).json({ error: "Invalid filenames" });
    return;
  }
  const now = Date.now();
  if (!filenames.every(f => { const t = parseInt(f.split("-")[0], 36); return t > now - FRESH_MS && t <= now + 60000; })) {
    res.status(400).json({ error: "Only fresh uploads can be deleted" });
    return;
  }
  const isOfficial = body.isOfficial === true;
  if (isOfficial && !(await isAdmin(sb, user.id))) {
    res.status(403).json({ error: "Admin access required" });
    return;
  }

  const targets = [...new Set(filenames)].map(f => resolveTarget(isOfficial, user.id, f));
  const referenced = await Promise.all(targets.map(t => isReferenced(sb, t.publicUrl, isOfficial ? null : user.id)));
  const doomed = targets.filter((t, i) => !referenced[i]);
  if (doomed.length) await r2.deleteObjects(doomed[0].bucket, doomed.map(t => t.key));
  res.status(200).json({ ok: true, deleted: doomed.length, kept: targets.length - doomed.length });
}

// Is this stored image URL used by a saved lineup? Personal URLs can only be
// referenced by their owner's lineups (api/lineups.js rejects anyone else's
// private path), so that lookup is scoped to the owner; public URLs may be
// referenced by any lineup.
async function isReferenced(sb, url, ownerId) {
  const probes = [
    [{ screenshots: [url] }],
    [{ standing: [url] }],
    [{ precise: url }],
    [{ result: url }],
  ];
  const results = await Promise.all(probes.map(async (probe) => {
    let q = sb.from("lineups").select("id").contains("throws", JSON.stringify(probe)).limit(1);
    if (ownerId) q = q.eq("owner_id", ownerId);
    const { data, error } = await q;
    if (error) throw new Error(error.message); // fail closed: never delete on a lookup error
    return !!(data && data.length);
  }));
  return results.some(Boolean);
}

// Legacy second step of the old upload flow (one call per image after its
// PUT). Superseded by the save-time check in api/lineups.js, kept so a
// browser still running the previous script keeps working until it reloads.
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
    else if (action === "delete") await deleteUploads(req, res, sb, user);
    else await presignUpload(req, res, sb, user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err && err.message || err) });
  }
};
