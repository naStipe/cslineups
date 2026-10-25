// Shared rules for screenshot uploads, used by api/upload-url.js (presign,
// delete, legacy confirm) and api/lineups.js (the save-time size check).
const r2 = require("./r2");

// Same allow-list as js/image-upload.js — enforced again server-side since
// the client-side check is just a courtesy; this is the real gate now that
// Storage-bucket-level MIME restrictions are gone.
const ALLOWED_EXT = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  // One short clip per throw position (see js/image-upload.js addClip).
  "video/mp4": "mp4",
  "video/webm": "webm",
};

const VIDEO_EXT = ["mp4", "webm"];

// The hard per-object cap. A presigned PUT can't enforce it by signature
// (R2 has no POST Object / content-length-range, see api/_lib/r2.js), so it
// is checked against the object's real stored size with a HEAD: at lineup
// save time for every newly referenced image (verifyNewImages below), and by
// the legacy confirm action for clients still running the old upload flow.
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
// Clips are bigger by nature: ~15 s of H.264 / WebM.
const MAX_VIDEO_BYTES = 20 * 1024 * 1024;

const isVideoName = (name) => VIDEO_EXT.includes(String(name).split(".").pop().toLowerCase());
// The cap that applies to a stored object, from its key / filename.
const maxBytesFor = (name) => (isVideoName(name) ? MAX_VIDEO_BYTES : MAX_UPLOAD_BYTES);

function randomFilename(ext) {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
}

// What randomFilename produces (base36 timestamp, "-", 1-6 random base36
// chars, one of our extensions). The delete action only accepts names in
// this shape, so it can never be pointed at a hand-named or legacy object.
const RANDOM_FILENAME = /^[a-z0-9]{6,12}-[a-z0-9]{1,6}\.(jpg|png|webp|gif|mp4|webm)$/;

// Resolves the bucket/key/publicUrl for an isOfficial+filename pair from
// just that pair plus the caller's own id, so no route ever trusts a
// client-supplied bucket or key: a personal key is always inside the
// caller's own folder.
function resolveTarget(isOfficial, userId, filename) {
  if (isOfficial) {
    return {
      bucket: r2.PUBLIC_BUCKET(),
      key: filename,
      publicUrl: `${r2.PUBLIC_BASE_URL()}/${filename}`,
      isPublic: true,
    };
  }
  return {
    bucket: r2.PRIVATE_BUCKET(),
    key: r2.privateKey(userId, filename),
    publicUrl: `/api/private-image?path=${userId}/${filename}`,
    isPublic: false,
  };
}

// Reverse of resolveTarget for a stored image URL. Private URLs are only
// resolved inside `userId`'s own folder (api/lineups.js has already rejected
// any other user's path before this runs). Returns null for anything else.
function targetFromUrl(url, userId) {
  if (typeof url !== "string") return null;
  const publicBase = `${r2.PUBLIC_BASE_URL()}/`;
  if (url.startsWith(publicBase)) {
    const key = url.slice(publicBase.length);
    return key && !/[\/\\]/.test(key) ? { bucket: r2.PUBLIC_BUCKET(), key, isPublic: true } : null;
  }
  if (!userId) return null;
  const privateBase = `/api/private-image?path=${userId}/`;
  if (url.startsWith(privateBase)) {
    const filename = url.slice(privateBase.length);
    return filename && !/[\/\\]/.test(filename) ? { bucket: r2.PRIVATE_BUCKET(), key: r2.privateKey(userId, filename), isPublic: false } : null;
  }
  return null;
}

// Every image URL referenced by a list of throws.
function imageUrls(throws) {
  const out = [];
  for (const t of Array.isArray(throws) ? throws : []) {
    if (!t || typeof t !== "object") continue;
    for (const u of Array.isArray(t.screenshots) ? t.screenshots : []) out.push(u);
    for (const u of Array.isArray(t.standing) ? t.standing : []) out.push(u);
    if (t.precise) out.push(t.precise);
    if (t.result) out.push(t.result);
    if (t.clip) out.push(t.clip);
  }
  return out.filter(u => typeof u === "string");
}

// Save-time replacement for the old per-image "confirm" round trip.
// The client now uploads in the background and never confirms; instead,
// when a lineup is saved, every image URL that is new to the row (not on
// the stored version) is HEADed in parallel: a missing object or one over
// MAX_UPLOAD_BYTES rejects the whole save, and an oversized object is
// deleted on the spot (the client may have lied about contentLength when
// presigning). Images already on the row were verified when they were first
// saved, so editing a lineup only pays for what was added.
//
// Returns { ok: true, newPublic: [{bucket,key,contentType}] } or
// { ok: false, status, error }.
async function verifyNewImages(nextThrows, prevThrows, userId) {
  const prev = new Set(imageUrls(prevThrows));
  const fresh = [...new Set(imageUrls(nextThrows))].filter(u => !prev.has(u));
  if (!fresh.length) return { ok: true, newPublic: [] };

  const checks = await Promise.all(fresh.map(async (url) => {
    const target = targetFromUrl(url, userId);
    if (!target) return { url, problem: "invalid" };
    const meta = await r2.headObject(target.bucket, target.key);
    if (!meta) return { url, problem: "missing" };
    if (meta.contentLength > maxBytesFor(target.key)) {
      try { await r2.deleteObject(target.bucket, target.key); } catch (err) { console.error("delete oversized upload failed", target.key, err); }
      return { url, problem: "too_large" };
    }
    return { url, target, contentType: meta.contentType };
  }));

  if (checks.some(c => c.problem === "too_large")) {
    return { ok: false, status: 413, error: `An upload is too large (images max ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB, clips max ${MAX_VIDEO_BYTES / (1024 * 1024)}MB). Remove it and try again.` };
  }
  if (checks.some(c => c.problem)) {
    return { ok: false, status: 400, error: "An image upload didn't finish. Remove it, add it again and save." };
  }
  return {
    ok: true,
    newPublic: checks.filter(c => c.target.isPublic).map(c => ({ ...c.target, contentType: c.contentType })),
  };
}

// Public screenshots get a random, never-reused filename, so they can be
// cached forever. Best effort (a failure must never fail the save); this used
// to run in the per-image confirm step and now runs once the lineup row that
// references the new images has been written.
async function setLongCache(targets) {
  await Promise.all(targets.map(async (t) => {
    try {
      await r2.setCacheControl(t.bucket, t.key, t.contentType || "application/octet-stream", "public, max-age=31536000, immutable");
    } catch (err) {
      console.error("setCacheControl failed", t.key, err);
    }
  }));
}

module.exports = {
  ALLOWED_EXT,
  MAX_UPLOAD_BYTES,
  MAX_VIDEO_BYTES,
  maxBytesFor,
  isVideoName,
  RANDOM_FILENAME,
  randomFilename,
  resolveTarget,
  targetFromUrl,
  imageUrls,
  verifyNewImages,
  setLongCache,
};
