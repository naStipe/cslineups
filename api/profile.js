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

// Username changes and account deletion both live here, behind the service
// key, on purpose:
//  - the username UPDATE touches exactly one column, so no client-side RLS
//    policy has to exist on profiles at all (a permissive one could let a
//    user update is_admin);
//  - deleting an auth user is only possible via the admin API.
// Password changes don't need any of this — the client calls
// supabase.auth.updateUser() with its own session.

const USERNAME_MIN = 2;
const USERNAME_MAX = 32;
// Mirrors the HTML-breakout rejection used elsewhere: usernames get rendered
// into innerHTML templates in a few places, so keep quote/angle chars out.
const HTML_BREAKOUT_CHARS = /["'<>]/;

// Best-effort removal of everything a user owns in the private image bucket
// (objects live under a folder named by their user id). Never throws.
async function removeUserImages(sb, userId) {
  try {
    const { data: objects } = await sb.storage.from("lineup-images-private").list(userId, { limit: 1000 });
    if (objects && objects.length) {
      await sb.storage.from("lineup-images-private").remove(objects.map(o => `${userId}/${o.name}`));
    }
  } catch (e) {
    console.warn("Failed to clean private images for", userId, e && e.message);
  }
}

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

module.exports = async function handler(req, res) {
  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === "OPTIONS") { res.status(204).end(); return; }

  try {
    const sb = supabase();
    const user = await getAuthUser(req, sb);
    if (!user) { res.status(401).json({ error: "Sign in required" }); return; }

    // POST — change username.
    if (req.method === "POST") {
      const raw = req.body && req.body.username;
      const username = typeof raw === "string" ? raw.trim() : "";
      if (username.length < USERNAME_MIN) { res.status(400).json({ error: `Username must be at least ${USERNAME_MIN} characters.` }); return; }
      if (username.length > USERNAME_MAX) { res.status(400).json({ error: `Username must be at most ${USERNAME_MAX} characters.` }); return; }
      if (HTML_BREAKOUT_CHARS.test(username)) { res.status(400).json({ error: "Username can't contain quotes or angle brackets." }); return; }

      // Uniqueness look-ahead — but changing only the letter case of your own
      // username shouldn't count as a collision with yourself.
      const { data: current } = await sb.from("profiles").select("username").eq("id", user.id).maybeSingle();
      const sameOwn = current && current.username && current.username.toLowerCase() === username.toLowerCase();
      if (!sameOwn) {
        const { data: available, error: rpcErr } = await sb.rpc("username_available", { uname: username });
        if (!rpcErr && available === false) {
          res.status(409).json({ error: "That username is already taken." });
          return;
        }
      }

      const { error } = await sb.from("profiles").update({ username }).eq("id", user.id);
      if (error) {
        // The unique index is the race-proof backstop behind the look-ahead.
        if (/unique|duplicate/i.test(error.message)) { res.status(409).json({ error: "That username is already taken." }); return; }
        throw new Error(error.message);
      }
      res.status(200).json({ ok: true, username });
      return;
    }

    // DELETE — remove the account and everything it owns.
    if (req.method === "DELETE") {
      // Children first, in case there are no ON DELETE CASCADE constraints.
      const { error: savedErr } = await sb.from("saved_lineups").delete().eq("user_id", user.id);
      if (savedErr) throw new Error(savedErr.message);

      const { error: lineupsErr } = await sb.from("lineups").delete().eq("is_official", false).eq("owner_id", user.id);
      if (lineupsErr) throw new Error(lineupsErr.message);

      await removeUserImages(sb, user.id);

      const { error: profileErr } = await sb.from("profiles").delete().eq("id", user.id);
      if (profileErr) throw new Error(profileErr.message);

      const { error: authErr } = await sb.auth.admin.deleteUser(user.id);
      if (authErr) throw new Error(authErr.message);

      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err && err.message || err) });
  }
};
