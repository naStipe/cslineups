const { getStore } = require("@netlify/blobs");

const BLOB_KEY = "all";

function store() {
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

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  try {
    if (event.httpMethod === "GET") {
      const all = await readAll();
      return { statusCode: 200, headers, body: JSON.stringify(Object.values(all)) };
    }

    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");

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
