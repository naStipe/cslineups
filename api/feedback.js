// POST /api/feedback: a suggestion or bug report from the feedback box on the
// map. Open to signed-out visitors too, so the abuse controls are: a small
// per-hour cap (per account, or per hashed IP when signed out), a hidden
// honeypot field, and strict length limits. Admins read and close these in
// admin.html (api/admin.js ?feedback=). The IP is only used as a hashed key
// in the existing rate_limits table, never stored with the message.
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");
const { setCorsHeaders } = require("./_lib/cors");
const { getAuthUser } = require("./_lib/auth");
const { checkRateLimit } = require("./_lib/rate-limit");

function supabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
}

const clean = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// A stable uuid-shaped key for an IP, so signed-out visitors can share the
// per-user rate-limit table without storing the address itself.
function visitorKey(req) {
  const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
  const h = crypto.createHash("sha256").update(`feedback:${ip}:${process.env.SUPABASE_URL || ""}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

module.exports = async function handler(req, res) {
  setCorsHeaders(req, res, "POST, OPTIONS");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }
  res.setHeader("Cache-Control", "no-store");

  try {
    const body = req.body || {};
    // Honeypot: real visitors never see or fill this field. Pretend success.
    if (body.website) { res.status(200).json({ ok: true }); return; }

    const kind = body.kind === "bug" ? "bug" : body.kind === "suggestion" ? "suggestion" : null;
    const message = clean(body.message, 2000);
    if (!kind || !message) { res.status(400).json({ error: "Choose a type and write a message." }); return; }

    const sb = supabase();
    const user = await getAuthUser(req, sb);
    const allowed = await checkRateLimit(sb, user ? user.id : visitorKey(req), "feedback");
    if (!allowed) { res.status(429).json({ error: "You've sent a few messages already. Please try again later." }); return; }

    const { error } = await sb.from("feedback").insert({
      user_id: user ? user.id : null,
      kind,
      message,
      contact: clean(body.contact, 200),
      page: clean(body.page, 300),
      user_agent: clean(req.headers["user-agent"], 300),
    });
    if (error) throw new Error(error.message);
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Couldn't send your message. Please try again." });
  }
};
