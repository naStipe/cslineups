// POST /api/feedback: a suggestion or bug report from the feedback box on the
// map. GET /api/feedback lists the signed-in caller's own messages with their
// status and reply thread, POST { action: "reply", id, body } answers an
// admin's reply, and POST { action: "seen", ids } clears the dot on the
// feedback button for those items (sql/009 and sql/010).
// Sending is open to signed-out visitors too, so the abuse controls are: a small
// per-hour cap (per account, or per hashed IP when signed out), a hidden
// honeypot field, and strict length limits. Admins read and close these in
// admin.html (api/admin.js ?feedback=). The IP is only used as a hashed key
// in the existing rate_limits table, never stored with the message.
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");
const { setCorsHeaders } = require("./_lib/cors");
const { getAuthUser } = require("./_lib/auth");
const { checkRateLimit } = require("./_lib/rate-limit");
const { REPLY_MAX, repliesFor, addReply } = require("./_lib/feedback");

function supabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
}

const UUID = /^[0-9a-f-]{36}$/i;
const clean = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// An item is unseen once an admin closed it, or replied to it, after the
// user last looked.
function isUnseen(r) {
  const seen = r.user_seen_at ? Date.parse(r.user_seen_at) : 0;
  const closed = r.status !== "open" && r.closed_at ? Date.parse(r.closed_at) : 0;
  const replied = r.last_admin_reply_at ? Date.parse(r.last_admin_reply_at) : 0;
  return Math.max(closed, replied) > seen;
}

async function listOwn(sb, user, res) {
  const { data, error } = await sb.from("feedback")
    .select("id, kind, message, status, created_at, closed_at, user_seen_at, last_admin_reply_at")
    .eq("user_id", user.id).order("created_at", { ascending: false }).limit(50);
  if (error) throw new Error(error.message);
  const replies = await repliesFor(sb, (data || []).map(r => r.id));
  res.status(200).json({ items: (data || []).map(r => ({
    id: r.id, kind: r.kind, message: r.message, status: r.status,
    createdAt: r.created_at, closedAt: r.closed_at, unseen: isUnseen(r),
    replies: replies[r.id] || [],
  })) });
}

// Only the ids the user was shown, so an item closed in the meantime still
// gets its dot.
async function markSeen(sb, user, body, res) {
  const ids = Array.isArray(body.ids) ? body.ids.filter(id => typeof id === "string" && UUID.test(id)).slice(0, 50) : [];
  if (ids.length) {
    const { error } = await sb.from("feedback").update({ user_seen_at: new Date().toISOString() })
      .eq("user_id", user.id).in("id", ids);
    if (error) throw new Error(error.message);
  }
  res.status(200).json({ ok: true });
}

async function replyOwn(sb, user, body, res) {
  const text = clean(body.body, REPLY_MAX);
  if (typeof body.id !== "string" || !UUID.test(body.id) || !text) { res.status(400).json({ error: "Write a reply first." }); return; }
  const { data: item, error } = await sb.from("feedback").select("id").eq("id", body.id).eq("user_id", user.id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!item) { res.status(404).json({ error: "That feedback wasn't found." }); return; }
  if (!(await checkRateLimit(sb, user.id, "feedback_reply"))) { res.status(429).json({ error: "You've sent a lot of replies. Please try again later." }); return; }
  const reply = await addReply(sb, { feedbackId: item.id, authorId: user.id, fromAdmin: false, body: text });
  res.status(200).json({ reply });
}

// A stable uuid-shaped key for an IP, so signed-out visitors can share the
// per-user rate-limit table without storing the address itself.
function visitorKey(req) {
  const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
  const h = crypto.createHash("sha256").update(`feedback:${ip}:${process.env.SUPABASE_URL || ""}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

module.exports = async function handler(req, res) {
  setCorsHeaders(req, res, "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST" && req.method !== "GET") { res.status(405).json({ error: "Method not allowed" }); return; }
  res.setHeader("Cache-Control", "no-store");

  try {
    const body = req.body || {};
    if (req.method === "GET" || body.action === "seen" || body.action === "reply") {
      const sb = supabase();
      const user = await getAuthUser(req, sb);
      if (!user) { res.status(401).json({ error: "Sign in to see your feedback." }); return; }
      if (req.method === "GET") await listOwn(sb, user, res);
      else if (body.action === "reply") await replyOwn(sb, user, body, res);
      else await markSeen(sb, user, body, res);
      return;
    }

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
