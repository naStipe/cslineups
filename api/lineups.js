const { createClient } = require("@supabase/supabase-js");

const IMAGE_BUCKET = "lineup-images";
const DATA_BUCKET  = "lineup-data";
const DATA_KEY     = "all.json";

function supabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    { auth: { persistSession: false } }
  );
}

async function readAll(sb) {
  const { data, error } = await sb.storage.from(DATA_BUCKET).download(DATA_KEY);
  if (error) {
    if (error.message && error.message.includes("not found")) return {};
    throw new Error(`Failed to read lineups: ${error.message}`);
  }
  const text = await data.text();
  return JSON.parse(text);
}

async function writeAll(sb, obj) {
  const json = JSON.stringify(obj);
  const buf  = Buffer.from(json, "utf8");
  const { error } = await sb.storage.from(DATA_BUCKET).upload(DATA_KEY, buf, {
    contentType: "application/json",
    upsert: true,
  });
  if (error) throw new Error(`Failed to write lineups: ${error.message}`);
}

function checkPassword(req) {
  const required = process.env.EDIT_PASSWORD;
  if (!required) return true;
  const supplied = req.headers["x-edit-password"];
  return supplied === required;
}

async function uploadImage(dataUrl, sb) {
  if (!dataUrl || !dataUrl.startsWith("data:")) return dataUrl;
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return dataUrl;
  const [, mime, b64] = match;
  const ext = mime.split("/")[1] || "jpg";
  const filename = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const buf = Buffer.from(b64, "base64");
  const { error } = await sb.storage.from(IMAGE_BUCKET).upload(filename, buf, {
    contentType: mime,
    upsert: false,
  });
  if (error) throw new Error(`Image upload failed: ${error.message}`);
  const { data } = sb.storage.from(IMAGE_BUCKET).getPublicUrl(filename);
  return data.publicUrl;
}

async function processThrows(throws, sb) {
  return Promise.all((throws || []).map(async (t) => ({
    ...t,
    screenshots: await Promise.all((t.screenshots || []).map(u => uploadImage(u, sb))),
    standing:    await Promise.all((t.standing    || []).map(u => uploadImage(u, sb))),
    precise:     t.precise ? await uploadImage(t.precise, sb) : null,
  })));
}

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Edit-Password",
};

module.exports = async function handler(req, res) {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.set(corsHeaders).status(204).end();
    return;
  }
  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));

  try {
    const sb = supabase();

    if (req.method === "GET") {
      const all = await readAll(sb);
      res.status(200).json(Object.values(all));
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
        const all = await readAll(sb);
        for (const r of body.records) {
          if (r && r.id) {
            r.throws = await processThrows(r.throws, sb);
            all[r.id] = r;
          }
        }
        await writeAll(sb, all);
        res.status(200).json({ ok: true, count: body.records.length });
        return;
      }

      if (!body.id) {
        res.status(400).json({ error: "Missing id" });
        return;
      }

      body.throws = await processThrows(body.throws, sb);
      const all = await readAll(sb);
      all[body.id] = body;
      await writeAll(sb, all);
      res.status(200).json({ ok: true });
      return;
    }

    if (req.method === "DELETE") {
      const id = req.query && req.query.id;
      if (!id) {
        res.status(400).json({ error: "Missing id" });
        return;
      }
      const all = await readAll(sb);
      delete all[id];
      await writeAll(sb, all);
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err && err.message || err) });
  }
};
