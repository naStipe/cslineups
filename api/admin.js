const { createClient } = require("@supabase/supabase-js");
const r2 = require("./_lib/r2");
const { setCorsHeaders } = require("./_lib/cors");
// authenticate() returns { user } or { reason } describing exactly why it
// failed, which keeps an otherwise opaque 401 diagnosable from the client.
const { authenticate, isAdmin } = require("./_lib/auth");

function supabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    { auth: { persistSession: false } }
  );
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

// Pulls every image URL off a throw across all slots.
const IMAGE_SLOTS = ["standing", "screenshots", "precise", "result"];
function throwImageUrls(t) {
  const urls = [];
  (t.standing || []).forEach(u => urls.push(u));
  (t.screenshots || []).forEach(u => urls.push(u));
  if (t.precise) urls.push(t.precise);
  if (t.result) urls.push(t.result);
  if (t.clip) urls.push(t.clip);
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

module.exports = async function handler(req, res) {
  setCorsHeaders(req, res, "GET, POST, DELETE, OPTIONS");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }

  try {
    const sb = supabase();

    // Every route here is admin-only.
    const auth = await authenticate(req, sb);
    if (!auth.user) { res.status(401).json({ error: `Sign in required (${auth.reason})` }); return; }
    const user = auth.user;
    if (!(await isAdmin(sb, user.id))) { res.status(403).json({ error: "Admin access required" }); return; }

    // GET — the moderation queue. Personal lineups that have at least one
    // uploaded image. ?status=all includes already-reviewed ones; default is
    // unreviewed only.
    // GET ?stats=1 — site-wide numbers for the admin's settings panel.
    // Counts auth.users (the real list of registered accounts) via the auth
    // admin API's `total`; falls back to counting profile rows if this
    // supabase-js build doesn't report it.
    if (req.method === "GET" && req.query && req.query.stats) {
      let accounts = null;
      const { data: page, error: listErr } = await sb.auth.admin.listUsers({ page: 1, perPage: 1 });
      if (!listErr && page && typeof page.total === "number") accounts = page.total;
      if (accounts === null) {
        const { count, error } = await sb.from("profiles").select("id", { count: "exact", head: true });
        if (error) throw new Error(error.message);
        accounts = count || 0;
      }
      res.status(200).json({ accounts });
      return;
    }

    // GET ?feedback=open|closed|all — visitor suggestions and bug reports.
    if (req.method === "GET" && req.query && req.query.feedback) {
      const f = req.query.feedback;
      let q = sb.from("feedback").select("*").order("created_at", { ascending: false }).limit(500);
      if (f === "open") q = q.eq("status", "open");
      else if (f === "closed") q = q.neq("status", "open");
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      const emails = await fetchOwnerEmails(sb, new Set((data || []).map(r => r.user_id).filter(Boolean)));
      res.status(200).json({ items: (data || []).map(r => ({
        id: r.id, kind: r.kind, message: r.message, contact: r.contact, page: r.page, userAgent: r.user_agent,
        status: r.status, createdAt: r.created_at, closedAt: r.closed_at,
        from: r.user_id ? (emails[r.user_id] || r.user_id) : null,
      })) });
      return;
    }

    // GET ?collections=1 — shared collections for moderation: every public
    // one, plus any unlisted/private one that has an open report.
    if (req.method === "GET" && req.query && req.query.collections) {
      const [{ data: cols, error }, { data: reports, error: rerr }] = await Promise.all([
        sb.from("collections").select("*, collection_items(count)").neq("visibility", "private").order("updated_at", { ascending: false }).limit(300),
        sb.from("collection_reports").select("collection_id, reason, details, created_at").is("resolved_at", null),
      ]);
      if (error || rerr) throw new Error((error || rerr).message);
      const openByCol = {};
      (reports || []).forEach(r => { (openByCol[r.collection_id] = openByCol[r.collection_id] || []).push(r); });
      const { data: profs } = await sb.from("profiles").select("id, username, email").in("id", [...new Set((cols || []).map(c => c.owner_id))]);
      const prof = Object.fromEntries((profs || []).map(p => [p.id, p]));
      res.status(200).json({ collections: (cols || []).map(c => ({
        id: c.id, mapId: c.map_id, name: c.name, description: c.description, visibility: c.visibility, slug: c.share_slug,
        hidden: !!c.moderation_hidden_at, itemCount: c.collection_items && c.collection_items[0] ? c.collection_items[0].count : 0,
        owner: (prof[c.owner_id] && (prof[c.owner_id].username || prof[c.owner_id].email)) || c.owner_id,
        updatedAt: c.updated_at, reports: openByCol[c.id] || [],
      })) });
      return;
    }

    // GET ?users=1 — account management list: every registered account with
    // how many personal lineups / uploaded screenshots it owns.
    if (req.method === "GET" && req.query && req.query.users) {
      const authUsers = [];
      for (let page = 1; page <= 50; page++) {
        const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 });
        if (error) throw new Error(error.message);
        const batch = (data && data.users) || [];
        authUsers.push(...batch);
        if (batch.length < 1000) break;
      }

      const { data: profiles } = await sb.from("profiles").select("id, username, is_admin");
      const profileById = {};
      (profiles || []).forEach(p => { profileById[p.id] = p; });

      const { data: lineupRows, error: lineupErr } = await sb.from("lineups")
        .select("id, owner_id, throws, created_at").eq("is_official", false);
      if (lineupErr) throw new Error(lineupErr.message);
      const stats = {};
      for (const row of (lineupRows || [])) {
        if (!row.owner_id) continue;
        const st = stats[row.owner_id] || (stats[row.owner_id] = { lineups: 0, screenshots: 0, lastLineupAt: 0 });
        st.lineups++;
        if (Number(row.created_at) > st.lastLineupAt) st.lastLineupAt = Number(row.created_at);
        st.screenshots += (row.throws || []).reduce((n, t) => n + throwImageUrls(t).length, 0);
      }

      // "Last seen": Supabase's last_sign_in_at only moves on a real sign-in,
      // not when a saved session silently refreshes, so anyone who stays
      // logged in looks idle for days. Take the latest of that and actual
      // activity: their newest lineup and their last write (the rate-limit
      // table stamps every upload / save / delete).
      const { data: limitRows } = await sb.from("rate_limits").select("user_id, window_start");
      const lastWriteById = {};
      (limitRows || []).forEach(r => {
        const t = Date.parse(r.window_start);
        if (t > (lastWriteById[r.user_id] || 0)) lastWriteById[r.user_id] = t;
      });
      const lastSeen = (u) => {
        const t = Math.max(
          Date.parse(u.last_sign_in_at) || 0,
          (stats[u.id] && stats[u.id].lastLineupAt) || 0,
          lastWriteById[u.id] || 0,
        );
        return t ? new Date(t).toISOString() : null;
      };

      const users = authUsers.map(u => ({
        id: u.id,
        email: u.email || null,
        username: (profileById[u.id] && profileById[u.id].username) || null,
        isAdmin: !!(profileById[u.id] && profileById[u.id].is_admin),
        provider: (u.app_metadata && u.app_metadata.provider) || null,
        confirmed: !!(u.email_confirmed_at || u.confirmed_at),
        createdAt: u.created_at || null,
        lastSignInAt: lastSeen(u),
        lineups: (stats[u.id] && stats[u.id].lineups) || 0,
        screenshots: (stats[u.id] && stats[u.id].screenshots) || 0,
      })).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

      res.status(200).json({ users });
      return;
    }

    // GET — the moderation queue (or, with ?userId=, everything one account
    // has uploaded, reviewed or not).
    if (req.method === "GET") {
      const userId = req.query && req.query.userId;
      const status = userId ? "all" : ((req.query && req.query.status) || "unreviewed");

      let query = sb.from("lineups").select("*").eq("is_official", false);
      if (userId) query = query.eq("owner_id", userId);
      // "suggested": lineups their owners suggested for the official map and
      // that still await a decision; "all": everything; default: not yet approved.
      if (status === "suggested") query = query.not("submitted_at", "is", null);
      else if (status !== "all") query = query.is("moderation_reviewed_at", null);
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
            const urls = (slot === "precise" || slot === "result") ? (val ? [val] : []) : (Array.isArray(val) ? val : []);
            for (const url of urls) {
              imgs.push({ slot, url, viewUrl: await toViewUrl(sb, url) });
            }
          }
          if (imgs.length) throwsOut.push({ id: t.id, range: t.range, movement: t.movement, notes: t.notes || "", images: imgs });
        }
        // Lineups without images have nothing to moderate, except when the
        // owner suggested one: that still needs an approve / deny decision.
        if (!throwsOut.length && !row.submitted_at) continue;
        items.push({
          id: row.id,
          mapId: row.map_id,
          type: row.type,
          name: row.name || "",
          ownerId: row.owner_id || null,
          ownerEmail: emails[row.owner_id] || null,
          createdAt: row.created_at,
          reviewedAt: row.moderation_reviewed_at || null,
          submittedAt: row.submitted_at || null,
          deniedAt: row.submission_denied_at || null,
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

      // Collection moderation: hide / unhide (takes it off every shared
      // link), delete, or mark its reports as handled.
      // Feedback: mark solved, discard, or reopen.
      if (action === "feedback-status") {
        const { id, status } = body;
        if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id) || !["open", "solved", "discarded"].includes(status)) { res.status(400).json({ error: "Invalid feedback update" }); return; }
        const { error } = await sb.from("feedback").update({ status, closed_at: status === "open" ? null : new Date().toISOString() }).eq("id", id);
        if (error) throw new Error(error.message);
        res.status(200).json({ ok: true });
        return;
      }

      if (typeof action === "string" && action.startsWith("collection-")) {
        const cid = body.collectionId;
        if (typeof cid !== "string" || !/^[0-9a-f-]{36}$/i.test(cid)) { res.status(400).json({ error: "Invalid collectionId" }); return; }
        if (action === "collection-hide") {
          const { error } = await sb.from("collections").update({ moderation_hidden_at: body.hidden === false ? null : new Date().toISOString() }).eq("id", cid);
          if (error) throw new Error(error.message);
        } else if (action === "collection-delete") {
          const { error } = await sb.from("collections").delete().eq("id", cid);
          if (error) throw new Error(error.message);
        } else if (action === "collection-resolve") {
          const { error } = await sb.from("collection_reports").update({ resolved_at: new Date().toISOString() }).eq("collection_id", cid).is("resolved_at", null);
          if (error) throw new Error(error.message);
        } else { res.status(400).json({ error: "Unknown action" }); return; }
        res.status(200).json({ ok: true });
        return;
      }

      if (!lineupId) { res.status(400).json({ error: "Missing lineupId" }); return; }

      // Publish — promote a user's personal submission to an official lineup:
      // copy every screenshot into the public bucket, rewrite the URLs, flip
      // the row to official (owner cleared, marked reviewed), then clean up the
      // now-orphaned private originals. Images are copied first so that if any
      // copy fails we abort before touching the row (leaving the submission
      // untouched, at the cost of a few orphaned public objects).
      if (action === "publish") {
        const { data: row, error: fetchErr } = await sb.from("lineups")
          .select("id, is_official, throws, submitted_at").eq("id", lineupId).maybeSingle();
        if (fetchErr) throw new Error(fetchErr.message);
        if (!row) { res.status(404).json({ error: "Not found" }); return; }
        if (row.is_official) { res.status(400).json({ error: "That lineup is already official" }); return; }
        // Only lineups whose owner opted in ("Submit to public map") may be
        // published: the owner's licence to publish depends on it.
        if (!row.submitted_at) { res.status(403).json({ error: "The owner hasn't submitted this lineup for publication" }); return; }

        const orphans = [];
        const newThrows = [];
        for (const t of (row.throws || [])) {
          const nt = { ...t };
          nt.screenshots = [];
          for (const u of (t.screenshots || [])) { const nu = await copyToPublic(sb, u); nt.screenshots.push(nu); if (nu !== u) orphans.push(u); }
          nt.standing = [];
          for (const u of (t.standing || [])) { const nu = await copyToPublic(sb, u); nt.standing.push(nu); if (nu !== u) orphans.push(u); }
          if (t.precise) { const nu = await copyToPublic(sb, t.precise); nt.precise = nu; if (nu !== t.precise) orphans.push(t.precise); }
          if (t.result) { const nu = await copyToPublic(sb, t.result); nt.result = nu; if (nu !== t.result) orphans.push(t.result); }
          if (t.clip) { const nu = await copyToPublic(sb, t.clip); nt.clip = nu; if (nu !== t.clip) orphans.push(t.clip); }
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

      // Deny a suggestion for the official map: the lineup stays private to its
      // owner (and their screenshots untouched); it just stops being a
      // suggestion, and the owner sees that it was not accepted.
      if (action === "deny") {
        const { data: row, error: fetchErr } = await sb.from("lineups").select("id, is_official, submitted_at").eq("id", lineupId).maybeSingle();
        if (fetchErr) throw new Error(fetchErr.message);
        if (!row || row.is_official) { res.status(404).json({ error: "Not found" }); return; }
        if (!row.submitted_at) { res.status(400).json({ error: "That lineup isn't suggested for the official map" }); return; }
        const { error } = await sb.from("lineups").update({
          submitted_at: null, submission_denied_at: new Date().toISOString(), moderation_reviewed_at: new Date().toISOString(),
        }).eq("id", lineupId).eq("is_official", false);
        if (error) throw new Error(error.message);
        res.status(200).json({ ok: true, denied: true });
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
        if (t.result === targetUrl) { found = true; next.result = null; }
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
