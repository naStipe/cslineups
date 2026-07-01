const { getStore } = require("@netlify/blobs");
const { createClient } = require("@supabase/supabase-js");

const LINEUP_KEY = "all";
const BUCKET = "lineup-images";

function lineupStore() {
  const siteID = process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
  const token  = process.env.NETLIFY_AUTH_TOKEN || process.env.BLOBS_TOKEN;
  if (siteID && token) return getStore({ name: "lineups", siteID, token });
  return getStore("lineups");
}

function supabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    { auth: { persistSession: false } }
  );
}

async function readAll() {
  const data = await lineupStore().get(LINEUP_KEY, { type: "json" });
  return data || {};
}

async function writeAll(obj) {
  await lineupStore().setJSON(LINEUP_KEY, obj);
}

function checkPassword(event) {
  const required = process.env.EDIT_PASSWORD;
  if (!required) return true;
  const supplied = event.headers["x-edit-password"] || event.headers["X-Edit-Password"];
  return supplied === required;
}

// Upload a single base64 data URI to Supabase Storage, return the public URL
async function uploadImage(dataUrl, sb) {
  if (!dataUrl || !dataUrl.startsWith("data:")) return dataUrl;
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return dataUrl;
  const [, mime, b64] = match;
  const ext = mime.split("/")[1] || "jpg";
  const filename = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const buf = Buffer.from(b64, "base64");

  const { error } = await sb.storage.from(BUCKET).upload(filename, buf, {
    contentType: mime,
    upsert: false,
  });
  if (error) throw new Error(`Supabase upload failed: ${error.message}`);

  const { data } = sb.storage.from(BUCKET).getPublicUrl(filename);
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

const headers = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Edit-Password",
  "Content-Type": "application/json",
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  try {
    if (event.httpMethod === "GET") {
      const all = await readAll();
      return { statusCode: 200, headers, body: JSON.stringify(Object.values(all)) };
    }

    if (!checkPassword(event)) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: "Wrong or missing edit password" }) };
    }

    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");

      if (body.checkPassword === true) {
        return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
      }

      const sb = supabase();

      if (Array.isArray(body.records)) {
        const all = await readAll();
        for (const r of body.records) {
          if (r && r.id) {
            r.throws = await processThrows(r.throws, sb);
            all[r.id] = r;
          }
        }
        await writeAll(all);
        return { statusCode: 200, headers, body: JSON.stringify({ ok: true, count: body.records.length }) };
      }

      if (!body.id) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing id" }) };
      }

      body.throws = await processThrows(body.throws, sb);
      const all = await readAll();
      all[body.id] = body;
      await writeAll(all);
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    if (event.httpMethod === "DELETE") {
      const id = event.queryStringParameters && event.queryStringParameters.id;
      if (!id) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing id" }) };
      }
      const all = await readAll();
      delete all[id];
      await writeAll(all);
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: String(err && err.message || err) }) };
  }
};
