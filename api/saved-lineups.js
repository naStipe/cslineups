const { createClient } = require("@supabase/supabase-js");

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

// Bookmarks: which official lineups a signed-in user has saved to their
// personal map. Every method here requires a signed-in user.
module.exports = async function handler(req, res) {
  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  try {
    const sb = supabase();
    const user = await getAuthUser(req, sb);
    if (!user) { res.status(401).json({ error: "Sign in required" }); return; }

    if (req.method === "GET") {
      // Returns full lineup records, but with `throws` filtered down to only
      // the specific throw positions this user has bookmarked — not the
      // whole lineup. If they've saved 2 of a lineup's 5 variants, only
      // those 2 come back. Optionally narrowed to one map.
      const mapId = req.query && req.query.mapId;

      const { data: saved, error: savedErr } = await sb
        .from("saved_lineups")
        .select("lineup_id, throw_id")
        .eq("user_id", user.id);
      if (savedErr) throw new Error(savedErr.message);
      if (!saved || saved.length === 0) { res.status(200).json([]); return; }

      const throwIdsByLineup = {};
      saved.forEach(r => {
        (throwIdsByLineup[r.lineup_id] = throwIdsByLineup[r.lineup_id] || new Set()).add(r.throw_id);
      });
      const ids = Object.keys(throwIdsByLineup);

      let query = sb.from("lineups").select("*").in("id", ids);
      if (mapId) query = query.eq("map_id", mapId);
      const { data, error } = await query;
      if (error) throw new Error(error.message);

      const result = (data || [])
        .map(row => {
          const wanted = throwIdsByLineup[row.id];
          const throws = (row.throws || []).filter(t => wanted.has(t.id));
          if (throws.length === 0) return null; // saved throw(s) no longer exist on the lineup
          return mapRow({ ...row, throws });
        })
        .filter(Boolean);
      res.status(200).json(result);
      return;
    }

    if (req.method === "POST") {
      const lineupId = req.body && req.body.lineupId;
      const throwId = req.body && req.body.throwId;
      if (!lineupId || !throwId) { res.status(400).json({ error: "Missing lineupId or throwId" }); return; }

      // Can only bookmark lineups/throws that actually exist and are
      // official — saving someone's personal lineup wouldn't make sense
      // (and RLS on the underlying lineups table would hide it from you anyway).
      const { data: lineup, error: lookupErr } = await sb.from("lineups").select("id, is_official, throws").eq("id", lineupId).maybeSingle();
      if (lookupErr) throw new Error(lookupErr.message);
      if (!lineup || !lineup.is_official) { res.status(400).json({ error: "That lineup can't be saved" }); return; }
      if (!(lineup.throws || []).some(t => t.id === throwId)) { res.status(400).json({ error: "That throw position doesn't exist" }); return; }

      const { error } = await sb.from("saved_lineups").upsert({ user_id: user.id, lineup_id: lineupId, throw_id: throwId });
      if (error) throw new Error(error.message);
      res.status(200).json({ ok: true });
      return;
    }

    if (req.method === "DELETE") {
      const lineupId = req.query && req.query.lineupId;
      const throwId = req.query && req.query.throwId;
      if (!lineupId || !throwId) { res.status(400).json({ error: "Missing lineupId or throwId" }); return; }
      const { error } = await sb.from("saved_lineups").delete()
        .eq("user_id", user.id).eq("lineup_id", lineupId).eq("throw_id", throwId);
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
