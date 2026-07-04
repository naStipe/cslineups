const { createClient } = require("@supabase/supabase-js");

function supabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    { auth: { persistSession: false } }
  );
}

// Verifies the bearer token (the logged-in user's Supabase access token) and
// returns the auth user it belongs to, or null if missing/invalid.
async function getAuthUser(req, sb) {
  const header = req.headers["authorization"] || req.headers["Authorization"];
  if (!header || !header.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data || !data.user) return null;
  return data.user;
}

// Looks up whether a user is flagged as an admin in public.profiles.
async function isAdmin(sb, userId) {
  if (!userId) return false;
  const { data, error } = await sb.from("profiles").select("is_admin").eq("id", userId).maybeSingle();
  if (error || !data) return false;
  return !!data.is_admin;
}

function mapRow(row) {
  return {
    id:         row.id,
    mapId:      row.map_id,
    type:       row.type,
    name:       row.name || "",
    landing:    row.landing,
    throws:     row.throws,
    createdAt:  row.created_at,
    isOfficial: !!row.is_official,
    ownerId:    row.owner_id || null,
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
const VALID_MOVEMENTS = [
  "none", "jumpthrow", "w-throw", "w-jumpthrow", "run", "run-throw",
  "run-jumpthrow", "shift-w-throw", "shift-w-jumpthrow", "crouch",
  "crouchjump", "crouchaim-jump", "crouchaim-crouchjump",
];
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
//  - public bucket (official lineups): .../object/public/lineup-images/<file>
//  - private bucket (personal lineups): .../object/authenticated/lineup-images-private/<userId>/<file>
// The private form is only accepted when we know which user is making this
// request (userId), and only when the folder segment matches that user's
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
  const publicBase = `${process.env.SUPABASE_URL}/storage/v1/object/public/lineup-images/`;
  if (url.startsWith(publicBase)) return true;
  if (!userId) return false;
  const privateBase = `${process.env.SUPABASE_URL}/storage/v1/object/authenticated/lineup-images-private/${userId}/`;
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

  return {
    id: t.id,
    pos: { x: t.pos.x, y: t.pos.y },
    range: t.range,
    movement: t.movement,
    notes: typeof t.notes === "string" ? t.notes.slice(0, MAX_NOTES_LEN) : "",
    screenshots,
    standing,
    precise: t.precise != null ? t.precise : null,
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
    landing: { x: body.landing.x, y: body.landing.y },
    throws: body.throws.map((t, i) => sanitizeThrow(t, i, userId)),
  };
}

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

module.exports = async function handler(req, res) {
  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));
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
    const admin = await isAdmin(sb, user.id);

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
            id: r.id, map_id: clean.mapId, type: clean.type, name: clean.name,
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

      if (!body.id) {
        res.status(400).json({ error: "Missing id" });
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
      const { data: existing } = await sb.from("lineups").select("is_official, owner_id").eq("id", body.id).maybeSingle();

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

      const { error } = await sb.from("lineups").upsert({
        id: body.id, map_id: clean.mapId, type: clean.type, name: clean.name,
        landing: clean.landing, throws: clean.throws,
        created_at: body.createdAt || Date.now(),
        is_official: isOfficial, owner_id: ownerId,
      });
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
