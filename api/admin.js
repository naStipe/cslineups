const { createClient } = require("@supabase/supabase-js");
const r2 = require("./_lib/r2");

function supabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    { auth: { persistSession: false } }
  );
}

// Verifies the bearer token (the logged-in user's Supabase access token) and
// returns { user } on success, or { reason } describing exactly why it
// failed. Keeping the reason distinct (no header vs. no token vs. token
// rejected + the auth server's message) is what makes an otherwise opaque
// 401 diagnosable from the client.
async function getAuthUser(req, sb) {
  const header = req.headers["authorization"] || req.headers["Authorization"];
  if (!header) return { reason: "no Authorization header reached the API" };
  if (!header.startsWith("Bearer ")) return { reason: "Authorization header is not a Bearer token" };
  const token = header.slice(7).trim();
  if (!token) return { reason: "Bearer token was empty" };
  const { data, error } = await sb.auth.getUser(token);
  if (error) return { reason: `token rejected by auth server: ${error.message}` };
  if (!data || !data.user) return { reason: "auth server returned no user for this token" };
  return { user: data.user };
}

async function isAdmin(sb, userId) {
  if (!userId) return false;
  const { data, error } = await sb.from("profiles").select("is_admin").eq("id", userId).maybeSingle();
  if (error || !data) return false;
  return !!data.is_admin;
}

// The two image-URL shapes our upload flow produces (see
// js/image-upload.js and api/upload-url.js). Given a stored image URL, work
// out which R2 bucket it lives in and its object key within that bucket, so
// we can both sign it (private images can't be fetched by the admin's
// browser directly — nothing can read the private bucket without a
// presigned URL) and delete it. Returns null for anything that isn't one of
// our own storage URLs.
function parseStoragePath(url) {
  if (typeof url !== "string") return null;
  const publicPrefix = `${r2.PUBLIC_BASE_URL()}/`;
  const privatePrefix = "/api/private-image?path=";
  if (url.startsWith(publicPrefix)) {
    return { bucket: r2.PUBLIC_BUCKET(), path: url.slice(publicPrefix.length), isPrivate: false };
  }
  if (url.startsWith(privatePrefix)) {
    const rawPath = decodeURIComponent(url.slice(privatePrefix.length));
    const slash = rawPath.indexOf("/");
    if (slash < 0) return null;
    const userId = rawPath.slice(0, slash);
    const filename = rawPath.slice(slash + 1);
    return { bucket: r2.PRIVATE_BUCKET(), path: r2.privateKey(userId, filename), isPrivate: true };
  }
  return null;
}

// Turns a stored image URL into something the admin's browser can actually
// render: public URLs pass through untouched; private ones get a short-lived
// presigned R2 URL (bypassing the ownership check that api/private-image.js
// applies for regular users — moderation has to be able to view anyone's
// submission). On any failure we hand back the original URL so the panel
// still shows a (broken) slot rather than crashing.
//
// Unlike private-images.js's fetch-and-blob approach, this URL is set
// directly as the moderation panel's <img src> (simplest for a grid of many
// images), so it IS visible/copyable from that page for as long as it's
// valid — keep this short. 5 minutes is enough to review a queue entry;
// reloading the queue re-mints fresh URLs for anything still unreviewed.
async function toViewUrl(sb, url) {
  const parsed = parseStoragePath(url);
  if (!parsed || !parsed.isPrivate) return url;
  try {
    return await r2.presignGet(parsed.bucket, parsed.path, 5 * 60); // 5 minutes
  } catch {
    return url;
  }
}

// Best-effort deletion of the underlying storage object when an image is
// rejected or its lineup is removed. Never throws — a leftover orphan in
// storage is far less bad than a failed moderation action.
async function removeStorageObject(sb, url) {
  const parsed = parseStoragePath(url);
  if (!parsed) return;
  try {
    await r2.deleteObject(parsed.bucket, parsed.path);
  } catch (e) {
    console.warn("Failed to remove storage object", parsed.path, e && e.message);
  }
}

// Copies one image out of the private bucket into the public one and returns
// its new public URL, for publishing a user submission to the official map
// (official lineups must be world-readable, private-bucket URLs aren't). URLs
// that are already public (or not ours) pass straight through unchanged.
// Throws on any copy failure so the caller can abort before mutating the row.
async function copyToPublic(sb, url) {
  const parsed = parseStoragePath(url);
  if (!parsed || !parsed.isPrivate) return url;

  // Public-bucket objects live at the bucket root as a bare filename (see
  // js/image-upload.js); mint a fresh collision-proof one rather than reusing
  // the private key (which is namespaced under the owner's user id).
  const ext = (parsed.path.split(".").pop() || "jpg").toLowerCase();
  const filename = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  try {
    await r2.copyObject(parsed.bucket, parsed.path, r2.PUBLIC_BUCKET(), filename);
  } catch (e) {
    throw new Error(`could not publish image (${parsed.path}): ${e && e.message}`);
  }
  return `${r2.PUBLIC_BASE_URL()}/${filename}`;
}

// Pulls every image URL off a throw across all three slots.
const IMAGE_SLOTS = ["standing", "screenshots", "precise"];
function throwImageUrls(t) {
  const urls = [];
  (t.standing || []).forEach(u => urls.push(u));
  (t.screenshots || []).forEach(u => urls.push(u));
  if (t.precise) urls.push(t.precise);
  return urls;
}

// Builds a lookup of owner id -> email for the given set of ids, using the
// service-key-only auth admin API. Missing/errored lookups just map to null.
async function fetchOwnerEmails(sb, ownerIds) {
  const emails = {};
  await Promise.all([...ownerIds].map(async (id) => {
    if (!id) return;
    try {
      const { data } = await sb.auth.admin.getUserById(id);
      emails[id] = (data && data.user && data.user.email) || null;
    } catch {
      emails[id] = null;
    }
  }));
  return emails;
}

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

module.exports = async function handler(req, res) {
  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === "OPTIONS") { res.status(204).end(); return; }

  try {
    const sb = supabase();

    // Every route here is admin-only.
    const auth = await getAuthUser(req, sb);
    if (!auth.user) { res.status(401).json({ error: `Sign in required (${auth.reason})` }); return; }
    const user = auth.user;
    if (!(await isAdmin(sb, user.id))) { res.status(403).json({ error: "Admin access required" }); return; }

    // GET — the moderation queue. Personal lineups that have at least one
    // uploaded image. ?status=all includes already-reviewed ones; default is
    // unreviewed only.
    if (req.method === "GET") {
      const status = (req.query && req.query.status) || "unreviewed";

      let query = sb.from("lineups").select("*").eq("is_official", false);
      if (status !== "all") query = query.is("moderation_reviewed_at", null);
      const { data, error } = await query.order("created_at", { ascending: false });
      if (error) throw new Error(error.message);

      const rows = data || [];
      const ownerIds = new Set(rows.map(r => r.owner_id).filter(Boolean));
      const emails = await fetchOwnerEmails(sb, ownerIds);

      const items = [];
      for (const row of rows) {
        const throwsOut = [];
        for (const t of (row.throws || [])) {
          const imgs = [];
          for (const slot of IMAGE_SLOTS) {
            const val = t[slot];
            const urls = slot === "precise" ? (val ? [val] : []) : (Array.isArray(val) ? val : []);
            for (const url of urls) {
              imgs.push({ slot, url, viewUrl: await toViewUrl(sb, url) });
            }
          }
          if (imgs.length) throwsOut.push({ id: t.id, range: t.range, movement: t.movement, notes: t.notes || "", images: imgs });
        }
        if (!throwsOut.length) continue; // no images to moderate on this lineup
        items.push({
          id: row.id,
          mapId: row.map_id,
          type: row.type,
          name: row.name || "",
          ownerId: row.owner_id || null,
          ownerEmail: emails[row.owner_id] || null,
          createdAt: row.created_at,
          reviewedAt: row.moderation_reviewed_at || null,
          throws: throwsOut,
        });
      }

      res.status(200).json({ items });
      return;
    }

    // POST — mark a lineup reviewed ("approve": leave the content in place,
    // just take it off the queue), un-review it, or "publish" it to the
    // official public map.
    if (req.method === "POST") {
      const body = req.body || {};
      const { action, lineupId } = body;
      if (!lineupId) { res.status(400).json({ error: "Missing lineupId" }); return; }

      // Publish — promote a user's personal submission to an official lineup:
      // copy every screenshot into the public bucket, rewrite the URLs, flip
      // the row to official (owner cleared, marked reviewed), then clean up the
      // now-orphaned private originals. Images are copied first so that if any
      // copy fails we abort before touching the row (leaving the submission
      // untouched, at the cost of a few orphaned public objects).
      if (action === "publish") {
        const { data: row, error: fetchErr } = await sb.from("lineups")
          .select("id, is_official, throws").eq("id", lineupId).maybeSingle();
        if (fetchErr) throw new Error(fetchErr.message);
        if (!row) { res.status(404).json({ error: "Not found" }); return; }
        if (row.is_official) { res.status(400).json({ error: "That lineup is already official" }); return; }

        const orphans = [];
        const newThrows = [];
        for (const t of (row.throws || [])) {
          const nt = { ...t };
          nt.screenshots = [];
          for (const u of (t.screenshots || [])) { const nu = await copyToPublic(sb, u); nt.screenshots.push(nu); if (nu !== u) orphans.push(u); }
          nt.standing = [];
          for (const u of (t.standing || [])) { const nu = await copyToPublic(sb, u); nt.standing.push(nu); if (nu !== u) orphans.push(u); }
          if (t.precise) { const nu = await copyToPublic(sb, t.precise); nt.precise = nu; if (nu !== t.precise) orphans.push(t.precise); }
          newThrows.push(nt);
        }

        const { error: updErr } = await sb.from("lineups").update({
          throws: newThrows,
          is_official: true,
          owner_id: null,
          moderation_reviewed_at: new Date().toISOString(),
        }).eq("id", lineupId);
        if (updErr) throw new Error(updErr.message);

        await Promise.all(orphans.map(u => removeStorageObject(sb, u)));
        res.status(200).json({ ok: true, published: true });
        return;
      }

      if (action !== "approve" && action !== "unreview") {
        res.status(400).json({ error: "Unknown action" });
        return;
      }
      const reviewedAt = action === "approve" ? new Date().toISOString() : null;
      const { error } = await sb.from("lineups")
        .update({ moderation_reviewed_at: reviewedAt })
        .eq("id", lineupId).eq("is_official", false);
      if (error) throw new Error(error.message);
      res.status(200).json({ ok: true, reviewedAt });
      return;
    }

    // DELETE — reject content. With ?url= it removes that single image from
    // the throw (and from storage); without it, the whole personal lineup is
    // deleted along with all of its uploaded images.
    if (req.method === "DELETE") {
      const q = req.query || {};
      const lineupId = q.lineupId;
      if (!lineupId) { res.status(400).json({ error: "Missing lineupId" }); return; }

      const { data: row, error: fetchErr } = await sb.from("lineups")
        .select("id, is_official, throws").eq("id", lineupId).maybeSingle();
      if (fetchErr) throw new Error(fetchErr.message);
      if (!row) { res.status(404).json({ error: "Not found" }); return; }
      if (row.is_official) { res.status(400).json({ error: "Refusing to moderate an official lineup here" }); return; }

      // Whole-lineup rejection: delete the row and clean up every image.
      if (!q.url) {
        const { error: delErr } = await sb.from("lineups").delete().eq("id", lineupId);
        if (delErr) throw new Error(delErr.message);
        const allUrls = (row.throws || []).flatMap(throwImageUrls);
        await Promise.all(allUrls.map(u => removeStorageObject(sb, u)));
        res.status(200).json({ ok: true, deleted: "lineup" });
        return;
      }

      // Single-image rejection: strip the URL out of whichever slot holds it,
      // on whichever throw, then persist and delete the object.
      const targetUrl = q.url;
      let found = false;
      const throwsOut = (row.throws || []).map(t => {
        const next = { ...t };
        next.screenshots = (t.screenshots || []).filter(u => { if (u === targetUrl) { found = true; return false; } return true; });
        next.standing    = (t.standing    || []).filter(u => { if (u === targetUrl) { found = true; return false; } return true; });
        if (t.precise === targetUrl) { found = true; next.precise = null; }
        return next;
      });
      if (!found) { res.status(404).json({ error: "Image not found on this lineup" }); return; }

      const { error: updErr } = await sb.from("lineups").update({ throws: throwsOut }).eq("id", lineupId);
      if (updErr) throw new Error(updErr.message);
      await removeStorageObject(sb, targetUrl);
      res.status(200).json({ ok: true, deleted: "image" });
      return;
    }

    res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err && err.message || err) });
  }
};
