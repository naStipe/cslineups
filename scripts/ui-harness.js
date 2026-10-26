// Dev-only browser harness: serves the repo statically, mocks /api/**, drives
// the pre-installed Playwright Chromium and prints bounding boxes so UI jumps
// can be measured. Not deployed (vercel.json redirects /scripts/*).
//
//   node scripts/ui-harness.js --url "/?map=mirage&collection=demo-set" \
//     --viewport 1366x768 --selectors ".step-bar,#detailNext" \
//     --click "#detailNext" --steps 3
//
// As a module: const { launch, VIEWPORTS } = require("./ui-harness");
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

async function mockApi(context, overrides = {}) {
  await context.route("**/api/**", route => {
    const u = new URL(route.request().url());
    const key = u.pathname;
    if (overrides[key]) return overrides[key](route, u);
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
async function launch({ viewport = "1366x768", url = "/?map=mirage", overrides, reducedMotion = "no-preference", consent = "denied" } = {}) {
  const { chromium } = require("playwright");
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const context = await browser.newContext({ ...VIEWPORTS[viewport], reducedMotion, serviceWorkers: "block" });
  if (consent) await context.addInitScript(v => { try { localStorage.setItem("lineupr_consent", v); } catch {} }, consent);
  await mockApi(context, overrides);
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
  return { page, boxes, errors, close, base };
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
