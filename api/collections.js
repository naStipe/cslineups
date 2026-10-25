// Collections: a named, ordered set of lineups on one map (a strategy to plan,
// practise and share). Owner-only writes; reads follow the share rules below.
//
//   GET    ?mine=1&mapId=…          the caller's collections on a map (summaries)
//   GET    ?id=<uuid>               one collection with resolved items (owner/admin)
//   GET    ?slug=<slug>             one collection by share slug (any viewer it is shared with)
//   POST   {action:"create"|"update"|"add-items"|"remove-item"|"reorder"|"update-item"|"fork"|"report"}
//   DELETE ?id=<uuid>
//
// Sharing rule: a collection set to Unlisted or Public exposes the lineups in
// it, official ones and the owner's personal ones, to anyone with the link
// (the share dialog says so). Personal lineups are only visible while the
// collection stays shared (see api/_lib/sharing.js, which also governs their
// screenshots in /api/private-image). A personal lineup that is not (or no
// longer) shared appears to other viewers as a "locked" placeholder.
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");
const { setCorsHeaders } = require("./_lib/cors");
const { getAuthUser, isAdmin } = require("./_lib/auth");
const { checkRateLimit } = require("./_lib/rate-limit");
const { MAPS } = require("./_lib/constants");
const { sharedPersonalIds } = require("./_lib/sharing");

const MAX_COLLECTIONS_PER_USER = 50;
const MAX_ITEMS = 30;
const VISIBILITIES = ["private", "unlisted", "public"];
const REPORT_REASONS = ["", "copyright", "abuse", "spam", "other"];
const SLUG_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

function supabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
}

function newSlug() {
  const bytes = crypto.randomBytes(10);
  let s = "";
  for (let i = 0; i < 10; i++) s += SLUG_CHARS[bytes[i] % SLUG_CHARS.length];
  return s;
}

const isUuid = (v) => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);
const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Same shape the SPA consumes from api/lineups.js.
function lineupShape(row) {
  return {
    id: row.id, mapId: row.map_id, type: row.type, name: row.name || "", side: row.side || "any",
    landing: row.landing, throws: row.throws, createdAt: row.created_at,
    isOfficial: !!row.is_official, ownerId: row.owner_id || null, submittedAt: row.submitted_at || null,
  };
}

function summary(row, itemCount, members) {
  return {
    members: members || [],
    id: row.id, mapId: row.map_id, name: row.name, description: row.description,
    visibility: row.visibility, slug: row.share_slug, forkedFrom: row.forked_from || null,
    hidden: !!row.moderation_hidden_at, itemCount: itemCount || 0,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

// Resolve each item against the lineups table for this viewer.
// status: "ok" (lineup included) | "locked" (personal lineup the viewer can't
// see) | "missing" (deleted). Locked/missing items keep their snapshot name
// and type so the list still reads sensibly.
async function resolveItems(sb, collection, viewerId) {
  const { data: items, error } = await sb.from("collection_items").select("*")
    .eq("collection_id", collection.id).order("position", { ascending: true });
  if (error) throw new Error(error.message);
  const ids = [...new Set((items || []).map(i => i.lineup_id).filter(Boolean))];
  const byId = new Map();
  if (ids.length) {
    const { data: rows, error: lerr } = await sb.from("lineups").select("*").in("id", ids);
    if (lerr) throw new Error(lerr.message);
    (rows || []).forEach(r => byId.set(r.id, r));
  }
  const rows = [...byId.values()];
  const shared = await sharedPersonalIds(sb, rows);
  return (items || []).map(i => {
    const base = {
      id: i.id, position: i.position, lineupId: i.lineup_id, throwId: i.throw_id,
      role: i.role, timing: i.timing, note: i.note,
      snapshotName: i.snapshot_name, snapshotType: i.snapshot_type,
    };
    const row = i.lineup_id ? byId.get(i.lineup_id) : null;
    if (!row) return { ...base, status: "missing" };
    if (row.is_official || (viewerId && row.owner_id === viewerId) || shared.has(row.id)) return { ...base, status: "ok", lineup: lineupShape(row) };
    return { ...base, status: "locked" };
  });
}

// Loads a collection the caller may view, or throws 404 (never reveals that a
// private one exists).
async function loadViewable(sb, { id, slug }, user, admin) {
  let q = sb.from("collections").select("*");
  q = slug ? q.eq("share_slug", slug) : q.eq("id", id);
  const { data: c, error } = await q.maybeSingle();
  if (error) throw new Error(error.message);
  if (!c) throw new HttpError(404, "Collection not found");
  const isOwner = user && user.id === c.owner_id;
  if (isOwner || admin) return c;
  if (c.visibility === "private" || c.moderation_hidden_at) throw new HttpError(404, "Collection not found");
  return c;
}

async function loadOwned(sb, id, user) {
  if (!isUuid(id)) throw new HttpError(400, "Invalid id");
  const { data: c, error } = await sb.from("collections").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!c || c.owner_id !== user.id) throw new HttpError(404, "Collection not found");
  return c;
}

const touch = (sb, id) => sb.from("collections").update({ updated_at: new Date().toISOString() }).eq("id", id);

// Validates + snapshots requested items against the lineups the caller can use.
async function prepareItems(sb, collection, requested, user) {
  if (!Array.isArray(requested) || requested.length === 0 || requested.length > MAX_ITEMS) throw new HttpError(400, "items must be a non-empty list");
  const ids = [...new Set(requested.map(r => r && r.lineupId).filter(x => typeof x === "string"))];
  const { data: rows, error } = await sb.from("lineups").select("id, map_id, type, name, is_official, owner_id, throws").in("id", ids);
  if (error) throw new Error(error.message);
  const byId = new Map((rows || []).map(r => [r.id, r]));
  // Your own lineups, official ones, and other people's personal lineups that
  // they currently share (so a copied or bookmarked one can be collected too).
  const shared = await sharedPersonalIds(sb, rows);
  return requested.map(r => {
    const row = r && byId.get(r.lineupId);
    if (!row || (!row.is_official && row.owner_id !== user.id && !shared.has(row.id))) throw new HttpError(400, "A lineup could not be added (not found or not yours)");
    if (row.map_id !== collection.map_id) throw new HttpError(400, "Lineups must be on the same map as the collection");
    let throwId = null;
    if (r.throwId != null) {
      if (typeof r.throwId !== "string" || !(row.throws || []).some(t => t.id === r.throwId)) throw new HttpError(400, "Unknown throw position");
      throwId = r.throwId;
    }
    return { lineup_id: row.id, throw_id: throwId, snapshot_name: (row.name || "").slice(0, 200), snapshot_type: row.type };
  });
}

async function nextPosition(sb, collectionId) {
  const { data } = await sb.from("collection_items").select("position").eq("collection_id", collectionId).order("position", { ascending: false }).limit(1);
  return data && data.length ? data[0].position + 1 : 0;
}

async function insertCollection(sb, fields) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data, error } = await sb.from("collections").insert({ ...fields, share_slug: newSlug() }).select().single();
    if (!error) return data;
    if (error.code !== "23505") throw new Error(error.message); // retry only slug collisions
  }
  throw new Error("Could not allocate a share link");
}

module.exports = async function handler(req, res) {
  setCorsHeaders(req, res, "GET, POST, DELETE, OPTIONS");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  res.setHeader("Cache-Control", "no-store");

  try {
    const sb = supabase();
    const q = req.query || {};
    const user = await getAuthUser(req, sb); // null when signed out

    if (req.method === "GET") {
      if (q.mine) {
        if (!user) throw new HttpError(401, "Sign in required");
        let query = sb.from("collections").select("*, collection_items(lineup_id, throw_id)").eq("owner_id", user.id).order("updated_at", { ascending: false });
        if (q.mapId) query = query.eq("map_id", q.mapId);
        const { data, error } = await query;
        if (error) throw new Error(error.message);
        // `members` = "lineupId|throwId" per item, so "Add to collection" can
        // show which collections already hold a lineup / variant.
        res.status(200).json((data || []).map(r => {
          const its = r.collection_items || [];
          return summary(r, its.length, its.map(i => `${i.lineup_id}|${i.throw_id || ""}`));
        }));
        return;
      }
      if (q.id || q.slug) {
        if (q.id && !isUuid(q.id)) throw new HttpError(400, "Invalid id");
        if (q.slug && !/^[A-Za-z0-9]{10}$/.test(q.slug)) throw new HttpError(404, "Collection not found");
        const admin = user ? await isAdmin(sb, user.id) : false;
        const c = await loadViewable(sb, { id: q.id, slug: q.slug }, user, admin);
        const items = await resolveItems(sb, c, user && user.id);
        let owner = null;
        if (c.visibility !== "private" || (user && user.id === c.owner_id)) {
          const { data: p } = await sb.from("profiles").select("username").eq("id", c.owner_id).maybeSingle();
          owner = (p && p.username) || null;
        }
        res.status(200).json({ ...summary(c, items.length), isOwner: !!(user && user.id === c.owner_id), ownerName: owner, items });
        return;
      }
      throw new HttpError(400, "Missing query");
    }

    if (!user) throw new HttpError(401, "Sign in required");

    if (req.method === "DELETE") {
      if (!(await checkRateLimit(sb, user.id, "collection_write"))) throw new HttpError(429, "Too many changes. Try again in a bit.");
      const c = await loadOwned(sb, q.id, user);
      const { error } = await sb.from("collections").delete().eq("id", c.id);
      if (error) throw new Error(error.message);
      res.status(200).json({ ok: true });
      return;
    }

    if (req.method !== "POST") throw new HttpError(405, "Method not allowed");
    const body = req.body || {};
    const action = body.action;

    if (action === "report") {
      if (!(await checkRateLimit(sb, user.id, "collection_report"))) throw new HttpError(429, "Too many reports. Try again later.");
      const c = await loadViewable(sb, { slug: str(body.slug, 10) }, null, false); // must be publicly viewable
      if (c.owner_id === user.id) throw new HttpError(400, "You can't report your own collection");
      const reason = REPORT_REASONS.includes(body.reason) ? body.reason : "other";
      const { error } = await sb.from("collection_reports").upsert(
        { collection_id: c.id, reporter_id: user.id, reason, details: str(body.details, 1000), resolved_at: null },
        { onConflict: "collection_id,reporter_id" });
      if (error) throw new Error(error.message);
      res.status(200).json({ ok: true });
      return;
    }

    if (!(await checkRateLimit(sb, user.id, "collection_write"))) throw new HttpError(429, "Too many changes. Try again in a bit.");

    if (action === "create") {
      if (!MAPS.some(m => m.id === body.mapId)) throw new HttpError(400, "Unknown map");
      const name = str(body.name, 80);
      if (!name) throw new HttpError(400, "Name is required");
      const { count, error: cerr } = await sb.from("collections").select("id", { count: "exact", head: true }).eq("owner_id", user.id);
      if (cerr) throw new Error(cerr.message);
      if ((count || 0) >= MAX_COLLECTIONS_PER_USER) throw new HttpError(400, `You can have at most ${MAX_COLLECTIONS_PER_USER} collections`);
      const c = await insertCollection(sb, { owner_id: user.id, map_id: body.mapId, name, description: str(body.description, 500) });
      let added = 0;
      if (Array.isArray(body.items) && body.items.length) {
        const rows = await prepareItems(sb, c, body.items, user);
        const { error } = await sb.from("collection_items").insert(rows.map((r, i) => ({ ...r, collection_id: c.id, position: i, added_by: user.id })));
        if (error) throw new Error(error.message);
        added = rows.length;
      }
      res.status(200).json(summary(c, added));
      return;
    }

    if (action === "update") {
      const c = await loadOwned(sb, body.id, user);
      const patch = {};
      if (body.name !== undefined) { patch.name = str(body.name, 80); if (!patch.name) throw new HttpError(400, "Name is required"); }
      if (body.description !== undefined) patch.description = str(body.description, 500);
      if (body.visibility !== undefined) {
        if (!VISIBILITIES.includes(body.visibility)) throw new HttpError(400, "Invalid visibility");
        patch.visibility = body.visibility;
      }
      patch.updated_at = new Date().toISOString();
      const { data, error } = await sb.from("collections").update(patch).eq("id", c.id).select().single();
      if (error) throw new Error(error.message);
      res.status(200).json(summary(data));
      return;
    }

    if (action === "add-items") {
      const c = await loadOwned(sb, body.id, user);
      const rows = await prepareItems(sb, c, body.items, user);
      const { data: existing, error: eerr } = await sb.from("collection_items").select("lineup_id, throw_id").eq("collection_id", c.id);
      if (eerr) throw new Error(eerr.message);
      const have = new Set((existing || []).map(e => `${e.lineup_id}|${e.throw_id || ""}`));
      const fresh = rows.filter(r => !have.has(`${r.lineup_id}|${r.throw_id || ""}`));
      if ((existing || []).length + fresh.length > MAX_ITEMS) throw new HttpError(400, `A collection holds at most ${MAX_ITEMS} lineups`);
      if (fresh.length) {
        const start = await nextPosition(sb, c.id);
        const { error } = await sb.from("collection_items").insert(fresh.map((r, i) => ({ ...r, collection_id: c.id, position: start + i, added_by: user.id })));
        if (error) throw new Error(error.message);
        await touch(sb, c.id);
      }
      res.status(200).json({ ok: true, added: fresh.length, skipped: rows.length - fresh.length });
      return;
    }

    if (action === "remove-item") {
      const c = await loadOwned(sb, body.id, user);
      // By item id, or by lineup (+ optional variant) from the "Add to collection" popover.
      let del = sb.from("collection_items").delete().eq("collection_id", c.id);
      if (body.itemId !== undefined) {
        if (!isUuid(body.itemId)) throw new HttpError(400, "Invalid itemId");
        del = del.eq("id", body.itemId);
      } else if (typeof body.lineupId === "string") {
        del = del.eq("lineup_id", body.lineupId);
        del = typeof body.throwId === "string" ? del.eq("throw_id", body.throwId) : del.is("throw_id", null);
      } else throw new HttpError(400, "Missing itemId or lineupId");
      const { error } = await del;
      if (error) throw new Error(error.message);
      await touch(sb, c.id);
      res.status(200).json({ ok: true });
      return;
    }

    if (action === "reorder") {
      const c = await loadOwned(sb, body.id, user);
      const order = body.order;
      if (!Array.isArray(order) || !order.every(isUuid)) throw new HttpError(400, "Invalid order");
      const { data: items, error } = await sb.from("collection_items").select("id").eq("collection_id", c.id);
      if (error) throw new Error(error.message);
      const have = new Set((items || []).map(i => i.id));
      if (order.length !== have.size || !order.every(id => have.has(id)) || new Set(order).size !== order.length) throw new HttpError(400, "Order must list every item once");
      const results = await Promise.all(order.map((id, i) => sb.from("collection_items").update({ position: i }).eq("id", id).eq("collection_id", c.id)));
      const failed = results.find(r => r.error);
      if (failed) throw new Error(failed.error.message);
      await touch(sb, c.id);
      res.status(200).json({ ok: true });
      return;
    }

    if (action === "update-item") {
      const c = await loadOwned(sb, body.id, user);
      if (!isUuid(body.itemId)) throw new HttpError(400, "Invalid itemId");
      const patch = {};
      if (body.role !== undefined) patch.role = str(body.role, 40);
      if (body.timing !== undefined) patch.timing = str(body.timing, 60);
      if (body.note !== undefined) patch.note = str(body.note, 280);
      if (!Object.keys(patch).length) throw new HttpError(400, "Nothing to update");
      const { error } = await sb.from("collection_items").update(patch).eq("id", body.itemId).eq("collection_id", c.id);
      if (error) throw new Error(error.message);
      await touch(sb, c.id);
      res.status(200).json({ ok: true });
      return;
    }

    if (action === "fork") {
      const admin = await isAdmin(sb, user.id);
      const src = await loadViewable(sb, { id: isUuid(body.id) ? body.id : undefined, slug: body.slug ? str(body.slug, 10) : undefined }, user, admin);
      const { count } = await sb.from("collections").select("id", { count: "exact", head: true }).eq("owner_id", user.id);
      if ((count || 0) >= MAX_COLLECTIONS_PER_USER) throw new HttpError(400, `You can have at most ${MAX_COLLECTIONS_PER_USER} collections`);
      // Only items the forker can actually see carry over.
      const items = (await resolveItems(sb, src, user.id)).filter(i => i.status === "ok");
      const copy = await insertCollection(sb, {
        owner_id: user.id, map_id: src.map_id, name: str(`${src.name} (copy)`, 80), description: src.description, forked_from: src.id,
      });
      if (items.length) {
        const { error } = await sb.from("collection_items").insert(items.map((i, n) => ({
          collection_id: copy.id, lineup_id: i.lineupId, throw_id: i.throwId, position: n, role: i.role, timing: i.timing, note: i.note,
          snapshot_name: i.snapshotName, snapshot_type: i.snapshotType, added_by: user.id,
        })));
        if (error) throw new Error(error.message);
      }
      res.status(200).json(summary(copy, items.length));
      return;
    }

    throw new HttpError(400, "Unknown action");
  } catch (err) {
    if (err instanceof HttpError) { res.status(err.status).json({ error: err.message }); return; }
    console.error(err);
    res.status(500).json({ error: String(err && err.message || err) });
  }
};
