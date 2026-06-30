const { getStore } = require("@netlify/blobs");

const BLOB_KEY = "all";

function store() {
  const siteID = process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
  const token = process.env.NETLIFY_AUTH_TOKEN || process.env.BLOBS_TOKEN;

  // Prefer automatic context (works in most Netlify deploys). Fall back to
  // manual config if the environment doesn't inject it automatically.
  if (siteID && token) {
    return getStore({ name: "lineups", siteID, token });
  }
  return getStore("lineups");
}

async function readAll() {
  const s = store();
  const data = await s.get(BLOB_KEY, { type: "json" });
  return data || {};
}

async function writeAll(obj) {
  const s = store();
  await s.setJSON(BLOB_KEY, obj);
}

function checkPassword(event) {
  const required = process.env.EDIT_PASSWORD;
  if (!required) return true; // no password configured = open editing
  const supplied = event.headers["x-edit-password"] || event.headers["X-Edit-Password"];
  return supplied === required;
}

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Edit-Password",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  try {
    if (event.httpMethod === "GET") {
      // Reading/previewing is always open, no password needed
      const all = await readAll();
      return { statusCode: 200, headers, body: JSON.stringify(Object.values(all)) };
    }

    // All write operations require the edit password
    if (!checkPassword(event)) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: "Wrong or missing edit password" }) };
    }

    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");

      // Just verifying a password (e.g. unlocking edit mode in the UI)
      if (body.checkPassword === true) {
        return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
      }

      // Bulk import: { records: [...] }
      if (Array.isArray(body.records)) {
        const all = await readAll();
        body.records.forEach((r) => {
          if (r && r.id) all[r.id] = r;
        });
        await writeAll(all);
        return { statusCode: 200, headers, body: JSON.stringify({ ok: true, count: body.records.length }) };
      }

      // Single upsert: the record itself
      if (!body.id) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing id" }) };
      }
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
    return { statusCode: 500, headers, body: JSON.stringify({ error: String(err && err.message || err) }) };
  }
};
