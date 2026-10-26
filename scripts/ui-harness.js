// Dev-only browser harness: serves the repo statically, mocks /api/**, drives
// the pre-installed Playwright Chromium and prints bounding boxes so UI jumps
// can be measured. Not deployed (vercel.json redirects /scripts/*).
//
//   node scripts/ui-harness.js --url "/?map=mirage&collection=demo-set" \
//     --viewport 1366x768 --selectors ".step-bar,#detailNext" \
//     --click "#detailNext" --steps 3
//
// As a module: const { launch, VIEWPORTS } = require("./ui-harness");
//
// Signed-in sessions: launch({ user: { id: "u-owner", email: "me@x.com", isAdmin: false } })
//   - installs a stub of vendor/supabase.js + /api/config so initAuth() restores
//     a session for that user (isAdmin drives profiles.is_admin);
//   - turns the sample data into an in-memory backend (returned as `h.api`):
//       lu-1 (3 variants) and lu-2 belong to the user (isOfficial:false, ownerId = user.id);
//       lu-3 and lu-4 stay official. The official view serves only official lineups,
//       "My Map" (?mine) serves the user's. The page starts in My Map (user.view = "official"
//       to start on the public map instead).
//       The sample collection becomes the user's own (isOwner true), starting with 4 items.
//   - POST/DELETE /api/lineups (save, "submit" action, delete), /api/saved-lineups,
//     /api/collections (create/update/add-items/remove-item/reorder/update-item/fork/report/DELETE),
//     /api/upload-url (presign + delete, PUT target at /__r2/), /api/feedback are
//     handled in memory. Every /api call is recorded.
//   - h.api.calls                 [{ method, path, query, body, at }] in order
//   - h.api.callsTo("POST", "/api/lineups")   filtered calls
//   - h.api.lineups / collections / saved / feedback   live store arrays
//   - h.api.failNext("POST", "/api/lineups", 500, "boom")   next matching call fails once
//   - h.api.hold("POST", "/api/lineups") -> release()      delay matching calls until released
//   Without `user` the harness behaves exactly as before (signed out, static data).
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".json": "application/json", ".woff2": "font/woff2", ".woff": "font/woff", ".ico": "image/x-icon" };

const VIEWPORTS = {
  "1366x768": { viewport: { width: 1366, height: 768 } },
  "1920x1200": { viewport: { width: 1920, height: 1200 } },
  "390x844": { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
};

// ---- Sample data: varied on purpose ----
const IMG = n => `/maps/hero/${["mirage", "dust2", "inferno", "nuke", "ancient", "anubis"][n % 6]}.webp`;
const LONG_NOTE = "Stand on the box corner, align the crosshair with the antenna tip, jump-throw with a short run-up and keep W held for the whole motion. If the smoke lands short, check that you are not clipping the railing; the tick-rate matters here so do it on a clean 64 tick server first and only then in matchmaking. ".repeat(3);
const mk = (id, name, extra) => ({ id, mapId: "mirage", type: "smoke", name, side: "T", landing: { x: 50, y: 50 }, isOfficial: true, createdAt: "2026-01-01T00:00:00Z", throws: [], ...extra });
const th = (id, x, y, shots, extra) => ({ id, pos: { x, y }, range: "throw", movement: "jumpthrow", standing: [], screenshots: shots, notes: "", ...extra });
const LINEUPS = [
  mk("lu-1", "A Ramp smoke", {
    landing: { x: 62, y: 55 },
    throws: [
      th("t1", 30, 70, [IMG(0)], { notes: "Short note." }),
      th("t2", 35, 75, [IMG(0), IMG(1), IMG(2), IMG(3)], { precise: IMG(4), result: IMG(5), notes: LONG_NOTE }),
      th("t3", 40, 80, [], {}),
    ],
  }),
  mk("lu-2", "Window one-way smoke from T spawn that has an unreasonably long name to test wrapping", {
    landing: { x: 45, y: 40 },
    throws: [th("t1", 20, 60, [IMG(1), IMG(2)], { notes: "Two images." })],
  }),
  mk("lu-3", "Top mid flash", { type: "flash", landing: { x: 50, y: 30 }, throws: [th("t1", 25, 45, [IMG(3)], { notes: "" })] }),
  mk("lu-4", "Jungle molotov", { type: "fire", landing: { x: 70, y: 35 }, throws: [th("t1", 55, 65, [IMG(4), IMG(5), IMG(0)], { notes: "Three images." })] }),
];
const COLLECTION = {
  id: "col-1", slug: "demo-set", mapId: "mirage", name: "Demo A-site execute", description: "Sample collection for the UI harness.",
  visibility: "public", isOwner: false, ownerName: "harness",
  items: [
    { id: "i1", lineupId: "lu-1", throwId: "t2", status: "ok", lineup: LINEUPS[0], role: "Entry", timing: "0:45", note: "Throw this first, then wait for the flash. " + LONG_NOTE },
    { id: "i2", lineupId: "lu-2", throwId: "t1", status: "ok", lineup: LINEUPS[1], role: "", timing: "", note: "" },
    { id: "i3", lineupId: "lu-3", throwId: "t1", status: "ok", lineup: LINEUPS[2], role: "Support", timing: "", note: "" },
    { id: "i4", lineupId: "lu-4", throwId: "t1", status: "ok", lineup: LINEUPS[3], role: "", timing: "1:10", note: "Short note" },
  ],
};

// ---- Signed-in backend: a small in-memory API (see header) ----
const clone = x => JSON.parse(JSON.stringify(x));

function createBackend(user) {
  const owner = { id: user.id, email: user.email, isAdmin: !!user.isAdmin };
  const lineups = clone(LINEUPS).map((l, i) => i < 2 ? { ...l, isOfficial: false, ownerId: owner.id } : l);
  const saved = []; // [{lineupId, throwId}]
  const feedback = [];
  const calls = [];
  const fails = [];
  const holds = [];
  let seq = 1;
  const nid = p => `${p}-${seq++}`;
  const collections = [{
    id: "col-1", slug: "demo-set", mapId: "mirage", name: COLLECTION.name, description: COLLECTION.description,
    visibility: "private", ownerId: owner.id, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
    items: COLLECTION.items.map(i => ({ id: i.id, lineupId: i.lineupId, throwId: i.throwId, role: i.role, timing: i.timing, note: i.note })),
  }];
  const mapLineups = mapId => lineups.filter(l => !mapId || l.mapId === mapId);
  const resolve = it => {
    const l = lineups.find(x => x.id === it.lineupId);
    const base = { ...it, snapshotName: l ? l.name : "", snapshotType: l ? l.type : "" };
    return l ? { ...base, status: "ok", lineup: l } : { ...base, status: "missing" };
  };
  const summary = c => ({
    id: c.id, mapId: c.mapId, name: c.name, description: c.description, visibility: c.visibility, slug: c.slug,
    forkedFrom: c.forkedFrom || null, hidden: false, itemCount: c.items.length,
    members: c.items.map(i => `${i.lineupId}|${i.throwId || ""}`), createdAt: c.createdAt, updatedAt: c.updatedAt,
  });
  const full = c => ({ ...summary(c), isOwner: c.ownerId === owner.id, ownerName: c.ownerId === owner.id ? "harness" : "someone", items: c.items.map(resolve) });

  function lineupsApi(method, u, body) {
    if (method === "GET") {
      if (u.searchParams.has("counts")) return { mirage: lineups.filter(l => l.isOfficial).length };
      const mapId = u.searchParams.get("mapId");
      if (u.searchParams.get("mine")) return mapLineups(mapId).filter(l => l.ownerId === owner.id);
      return mapLineups(mapId).filter(l => l.isOfficial);
    }
    if (method === "DELETE") {
      const i = lineups.findIndex(l => l.id === u.searchParams.get("id"));
      if (i < 0) return [404, { error: "Not found" }];
      const l = lineups[i];
      if (l.isOfficial ? !owner.isAdmin : l.ownerId !== owner.id) return [403, { error: "Forbidden" }];
      lineups.splice(i, 1);
      return { ok: true };
    }
    if (body && body.action === "submit") {
      const l = lineups.find(x => x.id === body.id);
      if (!l || l.ownerId !== owner.id) return [403, { error: "Forbidden" }];
      l.submittedAt = body.submit ? new Date().toISOString() : null;
      return { ok: true, submittedAt: l.submittedAt };
    }
    // save (create or replace)
    const i = lineups.findIndex(l => l.id === body.id);
    const old = i >= 0 ? lineups[i] : null;
    if (old && (old.isOfficial ? !owner.isAdmin : old.ownerId !== owner.id)) return [403, { error: "Forbidden" }];
    const isOfficial = old ? old.isOfficial : (body.isOfficial === true && owner.isAdmin);
    const rec = { createdAt: new Date().toISOString(), ...(old || {}), ...body, isOfficial, ownerId: isOfficial ? null : owner.id };
    delete rec.action;
    if (i >= 0) lineups[i] = rec; else lineups.push(rec);
    return { ok: true, isOfficial, ownerId: rec.ownerId };
  }

  function savedApi(method, u, body) {
    if (method === "GET") {
      const ids = new Set(saved.map(s => s.lineupId));
      return lineups.filter(l => ids.has(l.id) && l.ownerId !== owner.id).map(l => ({ ...l, throws: l.throws.filter(t => saved.some(s => s.lineupId === l.id && s.throwId === t.id)) }));
    }
    if (method === "POST") { saved.push({ lineupId: body.lineupId, throwId: body.throwId }); return { ok: true }; }
    const k = [u.searchParams.get("lineupId"), u.searchParams.get("throwId")];
    const i = saved.findIndex(s => s.lineupId === k[0] && s.throwId === k[1]);
    if (i >= 0) saved.splice(i, 1);
    return { ok: true };
  }

  function collectionsApi(method, u, body) {
    const q = u.searchParams;
    if (method === "GET") {
      if (q.get("mine")) return collections.filter(c => c.ownerId === owner.id && (!q.get("mapId") || c.mapId === q.get("mapId"))).map(summary);
      const c = collections.find(x => (q.get("id") && x.id === q.get("id")) || (q.get("slug") && x.slug === q.get("slug")));
      return c ? full(c) : [404, { error: "Collection not found" }];
    }
    if (method === "DELETE") {
      const i = collections.findIndex(c => c.id === q.get("id"));
      if (i < 0) return [404, { error: "Collection not found" }];
      collections.splice(i, 1);
      return { ok: true };
    }
    const now = new Date().toISOString();
    const mkItems = list => (list || []).map(r => ({ id: nid("item"), lineupId: r.lineupId, throwId: r.throwId == null ? null : r.throwId, role: "", timing: "", note: "" }));
    if (body.action === "create") {
      const c = { id: nid("col"), slug: "slug" + seq, mapId: body.mapId, name: body.name, description: body.description || "", visibility: "private", ownerId: owner.id, createdAt: now, updatedAt: now, items: mkItems(body.items) };
      collections.push(c);
      return summary(c);
    }
    if (body.action === "report") return { ok: true };
    if (body.action === "fork") {
      const src = collections.find(c => c.id === body.id || c.slug === body.slug);
      if (!src) return [404, { error: "Collection not found" }];
      const c = { ...clone(src), id: nid("col"), slug: "slug" + seq, name: src.name + " (copy)", visibility: "private", ownerId: owner.id, forkedFrom: src.id, items: src.items.map(i => ({ ...i, id: nid("item") })) };
      collections.push(c);
      return summary(c);
    }
    const c = collections.find(x => x.id === body.id && x.ownerId === owner.id);
    if (!c) return [404, { error: "Collection not found" }];
    c.updatedAt = now;
    switch (body.action) {
      case "update":
        for (const k of ["name", "description", "visibility"]) if (body[k] !== undefined) c[k] = body[k];
        return summary(c);
      case "add-items": {
        const have = new Set(c.items.map(i => `${i.lineupId}|${i.throwId || ""}`));
        const fresh = mkItems(body.items).filter(i => !have.has(`${i.lineupId}|${i.throwId || ""}`));
        c.items.push(...fresh);
        return { ok: true, added: fresh.length, skipped: body.items.length - fresh.length };
      }
      case "remove-item":
        c.items = c.items.filter(i => body.itemId !== undefined ? i.id !== body.itemId : !(i.lineupId === body.lineupId && (i.throwId || null) === (body.throwId || null)));
        return { ok: true };
      case "reorder":
        c.items = body.order.map(id => c.items.find(i => i.id === id)).filter(Boolean);
        return { ok: true };
      case "update-item": {
        const it = c.items.find(i => i.id === body.itemId);
        if (!it) return [404, { error: "Item not found" }];
        for (const k of ["role", "timing", "note"]) if (body[k] !== undefined) it[k] = body[k];
        return { ok: true };
      }
    }
    return [400, { error: "Unknown action" }];
  }

  function uploadApi(method, u, body) {
    if (body && body.action === "delete") return { ok: true };
    return { uploads: (body.files || []).map(() => {
      const n = seq++;
      return { filename: `up-${n}.webp`, url: `/__r2/up-${n}.webp`, publicUrl: IMG(n) };
    }) };
  }

  const routes = {
    "/api/lineups": lineupsApi,
    "/api/saved-lineups": savedApi,
    "/api/collections": collectionsApi,
    "/api/upload-url": uploadApi,
    "/api/feedback": (m, u, body) => { feedback.push(body); return { ok: true }; },
  };

  const api = {
    user: owner, lineups, collections, saved, feedback, calls,
    callsTo: (method, p) => calls.filter(c => c.method === method && c.path === p),
    failNext: (method, p, status = 500, error = "Injected failure") => { fails.push({ method, path: p, status, error }); },
    hold: (method, p) => {
      let release; const gate = new Promise(r => { release = r; });
      holds.push({ method, path: p, gate });
      return release;
    },
    // Returns a handler(route, url) for the given path, or null if this backend does not own it.
    handler(p) {
      const fn = routes[p];
      if (!fn) return null;
      return async (route, u) => {
        const req = route.request();
        const method = req.method();
        let body = null;
        try { body = req.postDataJSON(); } catch {}
        calls.push({ method, path: p, query: Object.fromEntries(u.searchParams), body, at: Date.now() });
        const h = holds.findIndex(x => x.method === method && x.path === p);
        if (h >= 0) { const [{ gate }] = holds.splice(h, 1); await gate; }
        const f = fails.findIndex(x => x.method === method && x.path === p);
        if (f >= 0) { const [x] = fails.splice(f, 1); return json(route, { error: x.error }, x.status); }
        const out = fn(method, u, body || {});
        return Array.isArray(out) && typeof out[0] === "number" ? json(route, out[1], out[0]) : json(route, out);
      };
    },
  };
  return api;
}

// Replaces vendor/supabase.js with a stub whose session belongs to `user`.
async function installAuth(context, user) {
  const session = { user: { id: user.id, email: user.email, user_metadata: {} }, access_token: "harness-token", expires_at: 9e9 };
  const profile = { is_admin: !!user.isAdmin, username: user.username || user.email.split("@")[0], email: user.email };
  await context.route("**/vendor/supabase*.js", r => r.fulfill({
    contentType: "text/javascript",
    body: `window.supabase={createClient:()=>({auth:{
      getSession:async()=>({data:{session:${JSON.stringify(session)}}}),
      getUser:async()=>({data:{user:${JSON.stringify(session.user)}},error:null}),
      updateUser:async()=>({data:{},error:null}),
      signOut:async()=>({error:null}),
      onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},
      from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:${JSON.stringify(profile)},error:null})})})})})};`,
  }));
  // PUT targets from /api/upload-url
  await context.route("**/__r2/**", r => r.fulfill({ status: 200, body: "" }));
}

function serve() {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/" || p === "/maps") p = "/index.html";
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(r => server.listen(0, "127.0.0.1", () => r(server)));
}

const json = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

async function mockApi(context, overrides = {}, backend) {
  await context.route("**/api/**", route => {
    const u = new URL(route.request().url());
    const key = u.pathname;
    if (overrides[key]) return overrides[key](route, u);
    if (backend) {
      if (key === "/api/config") return json(route, { supabaseUrl: "http://supabase.invalid", supabaseAnonKey: "harness" });
      const h = backend.handler(key);
      if (h) return h(route, u);
    }
    if (key === "/api/config") return json(route, {});
    if (key === "/api/lineups") {
      if (u.searchParams.has("counts")) return json(route, { mirage: LINEUPS.length });
      if (u.searchParams.get("mine")) return json(route, []);
      return json(route, LINEUPS);
    }
    if (key === "/api/areas") return json(route, []);
    if (key === "/api/collections") {
      if (route.request().method() !== "GET") return json(route, {});
      if (u.searchParams.get("mine")) return json(route, [COLLECTION]);
      return json(route, COLLECTION);
    }
    return json(route, {});
  });
}

// Opens a fresh page at `url` (path + query) for the named viewport.
async function launch({ viewport = "1366x768", url = "/?map=mirage", overrides, setup, reducedMotion = "no-preference", consent = "denied", user } = {}) {
  const { chromium } = require("playwright");
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const context = await browser.newContext({ ...VIEWPORTS[viewport], reducedMotion, serviceWorkers: "block" });
  if (consent) await context.addInitScript(v => { try { localStorage.setItem("lineupr_consent", v); } catch {} }, consent);
  const api = user ? createBackend(user) : null;
  if (user) {
    await installAuth(context, user);
    if (user.view !== "official") await context.addInitScript(() => { try { localStorage.setItem("lineupr.filters.mirage", JSON.stringify({ view: "personal" })); } catch {} });
  }
  await mockApi(context, overrides, api);
  if (setup) await setup(context); // extra routes / init scripts (e.g. a stubbed Supabase for admin.html)
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  page.on("console", m => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.goto(base + url, { waitUntil: "load" });
  const boxes = async selectors => {
    const out = {};
    for (const s of selectors) {
      const b = await page.locator(s).first().boundingBox().catch(() => null);
      out[s] = b ? [b.x, b.y, b.width, b.height].map(n => Math.round(n * 10) / 10).join(",") : "—";
    }
    return out;
  };
  const close = async () => { await browser.close(); server.close(); };
  return { page, boxes, errors, close, base, api };
}

async function cli() {
  const arg = (n, d) => { const i = process.argv.indexOf("--" + n); return i > -1 ? process.argv[i + 1] : d; };
  const selectors = (arg("selectors", "") || "").split(",").map(s => s.trim()).filter(Boolean);
  const click = arg("click");
  const steps = +arg("steps", 0);
  const h = await launch({ viewport: arg("viewport", "1366x768"), url: arg("url", "/?map=mirage&collection=demo-set") });
  await h.page.waitForTimeout(+arg("wait", 1500));
  const row = async label => console.log(label.padEnd(8), JSON.stringify(await h.boxes(selectors)));
  await row("step 0");
  for (let i = 1; i <= steps && click; i++) {
    await h.page.locator(click).first().click();
    await h.page.waitForTimeout(600);
    await row("step " + i);
  }
  if (arg("shot")) await h.page.screenshot({ path: arg("shot") });
  if (h.errors.length) console.log("console errors:", h.errors);
  await h.close();
}

module.exports = { launch, VIEWPORTS, LINEUPS, COLLECTION };
if (require.main === module) cli().catch(e => { console.error(e); process.exit(1); });
