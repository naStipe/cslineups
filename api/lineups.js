const { createClient } = require("@supabase/supabase-js");

function supabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    { auth: { persistSession: false } }
  );
}

function checkPassword(req) {
  const required = process.env.EDIT_PASSWORD;
  if (!required) return true;
  return req.headers["x-edit-password"] === required;
}

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Edit-Password",
};

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.set(corsHeaders).status(204).end();
    return;
  }
  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));

  try {
    const sb = supabase();

    if (req.method === "GET") {
      const mapId = req.query && req.query.mapId;
      let query = sb.from("lineups").select("*");
      if (mapId) query = query.eq("map_id", mapId);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      const lineups = (data || []).map(row => ({
        id:        row.id,
        mapId:     row.map_id,
        type:      row.type,
        landing:   row.landing,
        throws:    row.throws,
        createdAt: row.created_at,
      }));
      res.status(200).json(lineups);
      return;
    }

    if (!checkPassword(req)) {
      res.status(401).json({ error: "Wrong or missing edit password" });
      return;
    }

    if (req.method === "POST") {
      const body = req.body;

      if (body.checkPassword === true) {
        res.status(200).json({ ok: true });
        return;
      }

      if (Array.isArray(body.records)) {
        for (const r of body.records) {
          if (!r || !r.id) continue;
          const { error } = await sb.from("lineups").upsert({
            id: r.id, map_id: r.mapId, type: r.type,
            landing: r.landing, throws: r.throws,
            created_at: r.createdAt || Date.now(),
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

      // Images are already uploaded as public URLs — just save the metadata
      const { error } = await sb.from("lineups").upsert({
        id: body.id, map_id: body.mapId, type: body.type,
        landing: body.landing, throws: body.throws,
        created_at: body.createdAt || Date.now(),
      });
      if (error) throw new Error(error.message);
      res.status(200).json({ ok: true });
      return;
    }

    if (req.method === "DELETE") {
      const id = req.query && req.query.id;
      if (!id) { res.status(400).json({ error: "Missing id" }); return; }
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
