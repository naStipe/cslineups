// Map areas (named polygons, later callout points) per map and radar level.
//   GET  /api/areas?mapId=dust2   public: the areas for one map
//   PUT  /api/areas               admin: replace one map's areas (editor save)
// Polygons are small and change rarely, so GET is edge-cached briefly.
const { createClient } = require("@supabase/supabase-js");
const { setCorsHeaders } = require("./_lib/cors");
const { getAuthUser, isAdmin } = require("./_lib/auth");
const { MAPS } = require("./_lib/constants");

const MAX_AREAS_PER_MAP = 60;
const MAX_POINTS = 80;

function supabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
}

function isPct(n) { return typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 100; }
function isPt(p) { return p && typeof p === "object" && isPct(p.x) && isPct(p.y); }

function cleanArea(a, i) {
  if (!a || typeof a !== "object") throw new Error(`areas[${i}] is not an object`);
  const kind = a.kind === "callout" ? "callout" : "area";
  if (typeof a.slug !== "string" || !/^[a-z0-9-]{1,32}$/.test(a.slug)) throw new Error(`areas[${i}].slug is invalid`);
  if (typeof a.name !== "string" || a.name.trim().length < 1 || a.name.length > 40) throw new Error(`areas[${i}].name is invalid`);
  const level = typeof a.level === "string" && /^[a-z0-9-]{1,16}$/.test(a.level) ? a.level : "top";
  const row = { level, kind, slug: a.slug, name: a.name.trim(), sort: Number.isInteger(a.sort) ? a.sort : i, polygon: null, point: null };
  if (kind === "area") {
    if (!Array.isArray(a.polygon) || a.polygon.length < 3 || a.polygon.length > MAX_POINTS || !a.polygon.every(isPt)) {
      throw new Error(`areas[${i}].polygon needs 3–${MAX_POINTS} points inside the map`);
    }
    row.polygon = a.polygon.map(p => ({ x: p.x, y: p.y }));
  } else {
    if (!isPt(a.point)) throw new Error(`areas[${i}].point is invalid`);
    row.point = { x: a.point.x, y: a.point.y };
  }
  return row;
}

module.exports = async function handler(req, res) {
  setCorsHeaders(req, res, "GET, PUT, OPTIONS");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  try {
    const sb = supabase();
    const mapId = req.query && req.query.mapId;
    if (!MAPS.some(m => m.id === mapId)) { res.status(400).json({ error: "Unknown mapId" }); return; }

    if (req.method === "GET") {
      const { data, error } = await sb.from("map_areas").select("level, kind, slug, name, polygon, point, sort").eq("map_id", mapId).order("sort");
      if (error) throw new Error(error.message);
      res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=3600");
      res.status(200).json(data || []);
      return;
    }

    if (req.method === "PUT") {
      const user = await getAuthUser(req, sb);
      if (!user || !(await isAdmin(sb, user.id))) { res.status(403).json({ error: "Admin access required" }); return; }
      const list = req.body && req.body.areas;
      if (!Array.isArray(list) || list.length > MAX_AREAS_PER_MAP) { res.status(400).json({ error: "areas must be an array" }); return; }
      let rows;
      try { rows = list.map(cleanArea); } catch (e) { res.status(400).json({ error: e.message }); return; }
      const keys = new Set();
      for (const r of rows) {
        const k = `${r.level}|${r.kind}|${r.slug}`;
        if (keys.has(k)) { res.status(400).json({ error: `Duplicate area ${r.slug} on level ${r.level}` }); return; }
        keys.add(k);
      }
      // Upsert first, then drop rows no longer present, so a failed write
      // never leaves the map without areas.
      const stamped = rows.map(r => ({ ...r, map_id: mapId, updated_at: new Date().toISOString() }));
      if (stamped.length) {
        const { error } = await sb.from("map_areas").upsert(stamped, { onConflict: "map_id,level,kind,slug" });
        if (error) throw new Error(error.message);
      }
      const { data: existing, error: listErr } = await sb.from("map_areas").select("id, level, kind, slug").eq("map_id", mapId);
      if (listErr) throw new Error(listErr.message);
      const stale = (existing || []).filter(e => !keys.has(`${e.level}|${e.kind}|${e.slug}`)).map(e => e.id);
      if (stale.length) {
        const { error } = await sb.from("map_areas").delete().in("id", stale);
        if (error) throw new Error(error.message);
      }
      res.status(200).json({ ok: true, count: stamped.length });
      return;
    }

    res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err && err.message || err) });
  }
};
