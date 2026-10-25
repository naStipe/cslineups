const { createClient } = require("@supabase/supabase-js");
const r2 = require("./_lib/r2");
const { setCorsHeaders } = require("./_lib/cors");
const { getAuthUser, isAdmin } = require("./_lib/auth");
const { checkRateLimit } = require("./_lib/rate-limit");
const { isVideoName, verifyNewImages, setLongCache } = require("./_lib/uploads");

function supabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    { auth: { persistSession: false } }
  );
}

// getAuthUser verifies the bearer token locally (see api/_lib/auth.js).

function mapRow(row) {
  return {
    id:         row.id,
    mapId:      row.map_id,
    type:       row.type,
    name:       row.name || "",
    side:       row.side || "any",
    landing:    row.landing,
    throws:     row.throws,
    createdAt:  row.created_at,
    isOfficial: !!row.is_official,
    ownerId:    row.owner_id || null,
    submittedAt: row.submitted_at || null,
    deniedAt:   row.submission_denied_at || null,
  };
}

// Kept in sync with js/constants.js — only these values should ever be
// stored, since the client UI only ever offers these choices. Anything
// else can only have arrived via a hand-crafted request, and would
// otherwise get rendered unescaped into the detail panel's HTML on the
// read side (range/movement render as `LABELS[x] || x`, so an
// unrecognized value falls through as raw, attacker-controlled text).
const VALID_TYPES = ["smoke", "flash", "fire", "he", "decoy"];
const VALID_RANGES = ["throw", "mid-throw", "close-throw"];
// Kept in sync with js/constants.js's MOVEMENT_LABELS keys — including the
// legacy ones no longer offered in the dropdown, since existing saved
// throws still carry those values and re-saving an unrelated throw on the
// same lineup must not reject them.
const VALID_MOVEMENTS = [
  "none", "jumpthrow", "w-throw", "w-jumpthrow", "walk-throw", "walk-jumpthrow",
  "run-throw", "run-jumpthrow", "crouch-throw", "crouchjump",
  "crouch-walk-throw", "crouch-walk-jumpthrow",
  "run", "shift-w-throw", "shift-w-jumpthrow", "crouch",
  "crouchaim-jump", "crouchaim-crouchjump",
];
const VALID_SIDES = ["t", "ct", "any"];
const MAX_THROWS = 20;
const MAX_SCREENSHOTS = 5;
const MAX_STANDING = 3;
const MAX_NAME_LEN = 200;
const MAX_NOTES_LEN = 2000;

function isFiniteNum(n) { return typeof n === "number" && Number.isFinite(n); }

function isValidPos(p) {
  return p && typeof p === "object" && isFiniteNum(p.x) && isFiniteNum(p.y);
}

// Screenshots/standing/precise should only ever be URLs our own upload
// flow produced. Rejecting anything else prevents both stored-XSS via
// crafted `src` values and use of the lineups table to point at
// arbitrary external images.
//
// Two valid shapes now exist:
//  - public bucket (official lineups): <R2_PUBLIC_BASE_URL>/<file>
//  - private bucket (personal lineups): /api/private-image?path=<userId>/<file>
//    (a stable reference our own API resolves to a presigned R2 URL —
//    see api/private-image.js; never a raw R2 URL, since those expire)
// The private form is only accepted when we know which user is making this
// request (userId), and only when the path segment matches that user's
// own id — this stops one user's lineup payload from referencing another
// user's private image path. Bulk import (admin restore of official data)
// always passes userId = null/undefined, so private URLs are rejected
// outright there.
// Belt-and-suspenders on top of the prefix check below: a legitimate URL
// from our own upload flow is built from a UUID (userId) and a
// `${timestamp}-${random}.${ext}` filename, so it never contains quote or
// angle-bracket characters. Rejecting them here means that even if some
// render path ever forgets to HTML-escape one of these URLs, there's no
// attribute-breakout payload for it to render in the first place.
const HTML_BREAKOUT_CHARS = /["'<>]/;

function isOwnStorageUrl(url, userId) {
  if (typeof url !== "string" || url.length >= 500) return false;
  if (HTML_BREAKOUT_CHARS.test(url)) return false;
  const publicBase = `${r2.PUBLIC_BASE_URL()}/`;
  if (url.startsWith(publicBase)) return true;
  if (!userId) return false;
  const privateBase = `/api/private-image?path=${userId}/`;
  return url.startsWith(privateBase);
}

// Validates and normalizes one throw entry. Returns the cleaned object,
// or throws with a message describing what was wrong.
function sanitizeThrow(t, i, userId) {
  if (!t || typeof t !== "object") throw new Error(`throws[${i}] is not an object`);
  if (typeof t.id !== "string" || !t.id) throw new Error(`throws[${i}].id is missing`);
  if (!isValidPos(t.pos)) throw new Error(`throws[${i}].pos is invalid`);
  if (!VALID_RANGES.includes(t.range)) throw new Error(`throws[${i}].range is invalid`);
  if (!VALID_MOVEMENTS.includes(t.movement)) throw new Error(`throws[${i}].movement is invalid`);

  const screenshots = Array.isArray(t.screenshots) ? t.screenshots.slice(0, MAX_SCREENSHOTS) : [];
  const standing = Array.isArray(t.standing) ? t.standing.slice(0, MAX_STANDING) : [];
  screenshots.forEach((u, j) => { if (!isOwnStorageUrl(u, userId)) throw new Error(`throws[${i}].screenshots[${j}] is not a valid image URL`); });
  standing.forEach((u, j) => { if (!isOwnStorageUrl(u, userId)) throw new Error(`throws[${i}].standing[${j}] is not a valid image URL`); });
  if (t.precise != null && !isOwnStorageUrl(t.precise, userId)) throw new Error(`throws[${i}].precise is not a valid image URL`);
  if (t.result != null && !isOwnStorageUrl(t.result, userId)) throw new Error(`throws[${i}].result is not a valid image URL`);
  // One optional clip (mp4 / webm) per throw position, same storage rules as images.
  if (t.clip != null && (!isOwnStorageUrl(t.clip, userId) || !isVideoName(t.clip))) throw new Error(`throws[${i}].clip is not a valid clip URL`);

  return {
    id: t.id,
    pos: { x: t.pos.x, y: t.pos.y },
    range: t.range,
    movement: t.movement,
    notes: typeof t.notes === "string" ? t.notes.slice(0, MAX_NOTES_LEN) : "",
    screenshots,
    standing,
    precise: t.precise != null ? t.precise : null,
    result: t.result != null ? t.result : null,
    clip: t.clip != null ? t.clip : null,
    // When this throw position was added (ms since epoch; the dossier shows
    // "added N ago"). Optional: throws saved before it existed have none.
    ...(isFiniteNum(t.createdAt) && t.createdAt > 0 ? { createdAt: Math.trunc(t.createdAt) } : {}),
  };
}

// Validates a whole lineup payload before it's ever written to the DB.
// Throws with a descriptive message on the first problem found.
function sanitizeLineup(body, userId) {
  if (typeof body.mapId !== "string" || !body.mapId) throw new Error("mapId is missing");
  if (!VALID_TYPES.includes(body.type)) throw new Error("type is invalid");
  if (!isValidPos(body.landing)) throw new Error("landing is invalid");
  if (!Array.isArray(body.throws) || body.throws.length === 0) throw new Error("throws must be a non-empty array");
  if (body.throws.length > MAX_THROWS) throw new Error(`too many throws (max ${MAX_THROWS})`);

  return {
    mapId: body.mapId,
    type: body.type,
    name: typeof body.name === "string" ? body.name.slice(0, MAX_NAME_LEN) : "",
    // Optional on old clients: anything unrecognized falls back to "any".
    side: VALID_SIDES.includes(body.side) ? body.side : "any",
    landing: { x: body.landing.x, y: body.landing.y },
    throws: body.throws.map((t, i) => sanitizeThrow(t, i, userId)),
  };
}

module.exports = async function handler(req, res) {
  setCorsHeaders(req, res, "GET, POST, DELETE, OPTIONS");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  try {
    const sb = supabase();

    if (req.method === "GET") {
      // ?counts=true — single request returning {mapId: count} for all maps,
      // counting only official lineups (used for the home-screen grid).
      if (req.query.counts === "true") {
        const { data, error } = await sb.from("lineups").select("map_id").eq("is_official", true);
        if (error) throw new Error(error.message);
        const counts = {};
        (data || []).forEach(row => {
          counts[row.map_id] = (counts[row.map_id] || 0) + 1;
        });
        // Public, identical for everyone: let the edge absorb home-page loads.
        res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=600");
        res.status(200).json(counts);
        return;
      }

      const mapId = req.query && req.query.mapId;

      // ?mine=true — the caller's own personal (non-official) lineups.
      if (req.query.mine === "true") {
        const user = await getAuthUser(req, sb);
        if (!user) { res.status(401).json({ error: "Sign in required" }); return; }
        let query = sb.from("lineups").select("*").eq("is_official", false).eq("owner_id", user.id);
        if (mapId) query = query.eq("map_id", mapId);
        const { data, error } = await query;
        if (error) throw new Error(error.message);
        res.status(200).json((data || []).map(mapRow));
        return;
      }

      // Default: public official lineups (no auth required).
      let query = sb.from("lineups").select("*").eq("is_official", true);
      if (mapId) query = query.eq("map_id", mapId);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      res.status(200).json((data || []).map(mapRow));
      return;
    }

    // Every write requires a signed-in user from here on.
    const user = await getAuthUser(req, sb);
    if (!user) { res.status(401).json({ error: "Sign in required" }); return; }
    // A plain create/edit needs both the admin flag and the rate-limit RPC;
    // each is a DB round trip, so run them side by side. (Admins skip the
    // limit below; counting their writes anyway costs nothing.)
    const plainSave = req.method === "POST" && req.body && !Array.isArray(req.body.records) && req.body.id && req.body.action !== "submit";
    const [admin, underLimit] = await Promise.all([
      isAdmin(sb, user.id),
      plainSave ? checkRateLimit(sb, user.id, "lineup_write") : Promise.resolve(true),
    ]);

    if (req.method === "POST") {
      const body = req.body;

      // Bulk import (backup restore) — official data only, admins only.
      if (Array.isArray(body.records)) {
        if (!admin) { res.status(403).json({ error: "Admin access required" }); return; }
        let imported = 0;
        const skipped = [];
        for (const r of body.records) {
          if (!r || !r.id) continue;
          let clean;
          try {
            clean = sanitizeLineup(r, null); // bulk import: official data only, never private-bucket URLs
          } catch (e) {
            skipped.push({ id: r.id, reason: e.message });
            continue;
          }
          const { error } = await sb.from("lineups").upsert({
            id: r.id, map_id: clean.mapId, type: clean.type, name: clean.name, side: clean.side,
            landing: clean.landing, throws: clean.throws,
            created_at: r.createdAt || Date.now(),
            is_official: true, owner_id: null,
          });
          if (error) throw new Error(error.message);
          imported++;
        }
        res.status(200).json({ ok: true, count: imported, skipped });
        return;
      }

      // Admin: set the side on many official lineups at once (they predate
      // the side field and all default to "any").
      if (body.action === "set-side") {
        if (!admin) { res.status(403).json({ error: "Admin access required" }); return; }
        if (!VALID_SIDES.includes(body.side) || !Array.isArray(body.ids) || body.ids.length === 0 || body.ids.length > 500 || !body.ids.every(i => typeof i === "string")) {
          res.status(400).json({ error: "Invalid side or ids" }); return;
        }
        const { error } = await sb.from("lineups").update({ side: body.side }).in("id", body.ids).eq("is_official", true);
        if (error) throw new Error(error.message);
        res.status(200).json({ ok: true, count: body.ids.length });
        return;
      }

      if (!body.id) {
        res.status(400).json({ error: "Missing id" });
        return;
      }

      // Submit / withdraw a personal lineup for publication on the public
      // map. This is the owner's opt-in (consent to publish, see terms.html
      // "Your content"): the admin "publish" action in api/admin.js refuses
      // any lineup without submitted_at, so nothing private goes public
      // unless its owner asked for it.
      if (body.action === "submit") {
        const { data: row, error: fetchErr } = await sb.from("lineups").select("is_official, owner_id").eq("id", body.id).maybeSingle();
        if (fetchErr) throw new Error(fetchErr.message);
        if (!row) { res.status(404).json({ error: "Not found" }); return; }
        if (row.is_official || row.owner_id !== user.id) { res.status(403).json({ error: "You can only submit your own lineups" }); return; }
        const submittedAt = body.submit === true ? new Date().toISOString() : null;
        // Suggesting again clears an earlier "not accepted".
        const patch = submittedAt ? { submitted_at: submittedAt, submission_denied_at: null } : { submitted_at: null };
        const { error } = await sb.from("lineups").update(patch).eq("id", body.id).eq("owner_id", user.id);
        if (error) throw new Error(error.message);
        res.status(200).json({ ok: true, submittedAt });
        return;
      }

      // Admins are trusted (already gated by the is_admin check) and can do
      // heavy moderation/editing work, so only rate-limit ordinary users.
      if (!admin && !underLimit) {
        res.status(429).json({ error: "Too many changes. Try again in a bit." });
        return;
      }

      let clean;
      try {
        clean = sanitizeLineup(body, user.id);
      } catch (e) {
        res.status(400).json({ error: e.message });
        return;
      }

      // If this id already exists, keep its existing ownership/official
      // status (don't let a client flip a personal lineup into an official
      // one, or vice versa, via upsert) and just re-check permission
      // against what it already is.
      const { data: existing } = await sb.from("lineups").select("is_official, owner_id, throws").eq("id", body.id).maybeSingle();

      let isOfficial, ownerId;
      if (existing) {
        isOfficial = existing.is_official;
        ownerId = existing.owner_id;
        if (isOfficial && !admin) { res.status(403).json({ error: "Admin access required to edit an official lineup" }); return; }
        if (!isOfficial && ownerId !== user.id) { res.status(403).json({ error: "You can only edit your own lineups" }); return; }
      } else {
        // New lineup: officialness is requested by the client but only
        // honored for admins — everyone else always creates a personal one.
        isOfficial = body.isOfficial === true && admin;
        ownerId = isOfficial ? null : user.id;
      }

      // Size cap for newly referenced images (replaces the old per-upload
      // confirm call, see api/_lib/uploads.js verifyNewImages).
      const verified = await verifyNewImages(clean.throws, existing ? existing.throws : [], user.id);
      if (!verified.ok) { res.status(verified.status).json({ error: verified.error }); return; }

      const [{ error }] = await Promise.all([
        sb.from("lineups").upsert({
          id: body.id, map_id: clean.mapId, type: clean.type, name: clean.name, side: clean.side,
          landing: clean.landing, throws: clean.throws,
          created_at: body.createdAt || Date.now(),
          is_official: isOfficial, owner_id: ownerId,
        }),
        setLongCache(verified.newPublic), // best effort, never throws
      ]);
      if (error) throw new Error(error.message);
      res.status(200).json({ ok: true, isOfficial, ownerId });
      return;
    }

    if (req.method === "DELETE") {
      const id = req.query && req.query.id;
      if (!id) { res.status(400).json({ error: "Missing id" }); return; }

      const { data: existing, error: fetchErr } = await sb.from("lineups").select("is_official, owner_id").eq("id", id).maybeSingle();
      if (fetchErr) throw new Error(fetchErr.message);
      if (!existing) { res.status(404).json({ error: "Not found" }); return; }
      if (existing.is_official && !admin) { res.status(403).json({ error: "Admin access required to delete an official lineup" }); return; }
      if (!existing.is_official && existing.owner_id !== user.id) { res.status(403).json({ error: "You can only delete your own lineups" }); return; }

      const { error } = await sb.from("lineups").delete().eq("id", id);
      if (error) throw new Error(error.message);
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err && err.message || err) });
  }
};
