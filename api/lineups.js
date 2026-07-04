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
        for (const r of body.records) {
          if (!r || !r.id) continue;
          const { error } = await sb.from("lineups").upsert({
            id: r.id, map_id: r.mapId, type: r.type, name: r.name || "",
            landing: r.landing, throws: r.throws,
            created_at: r.createdAt || Date.now(),
            is_official: true, owner_id: null,
          });
          if (error) throw new Error(error.message);
        }
        res.status(200).json({ ok: true, count: body.records.length });
        return;
      }

      if (!body.id) {
        res.status(400).json({ error: "Missing id" });
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
        id: body.id, map_id: body.mapId, type: body.type, name: body.name || "",
        landing: body.landing, throws: body.throws,
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
