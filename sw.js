// Lineupr service worker: makes the map usable offline.
//
//  - Hashed JS (/js/<hash>/…), fonts, vendor code and radar images: cache-first
//    (their URLs change when their content does).
//  - The app shell (/ and /style.css): network-first with a cache fallback, so
//    a deploy is never stuck behind a stale copy.
//  - Official lineup data (/api/lineups?mapId=…, /api/areas) and the public
//    /api/config: stale-while-
//    revalidate, so maps you've opened still load with no connection.
//  - Public R2 screenshots: cache-first, capped at IMG_LIMIT entries (oldest
//    used goes first).
//
// Deliberately NOT cached: /api/private-image and every other /api route
// (personal lineups, collections, auth, uploads). Private data never lands in
// a cache, so there is nothing user-specific to clear on sign-out.
//
// __BUILD_ID__ is replaced at build time (scripts/hash-js.js) with the js hash,
// so every deploy installs a fresh worker and drops the previous caches.
const BUILD = "__BUILD_ID__";
const STATIC = `lineupr-static-${BUILD}`;
const PAGES = `lineupr-pages-${BUILD}`;
const API = `lineupr-api-${BUILD}`;
const IMG = "lineupr-img"; // R2 filenames are random and never reused, so this one survives deploys
const IMG_LIMIT = 300;
const R2_PUBLIC = "https://pub-2cec3282a91349ff8b41e10a2c129998.r2.dev";
const SHELL = "/";

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(PAGES);
    // Best effort: a failed precache must not block installing the worker.
    await Promise.all([SHELL, "/style.css"].map(u => cache.add(new Request(u, { cache: "reload" })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keep = new Set([STATIC, PAGES, API, IMG]);
    const names = await caches.keys();
    await Promise.all(names.filter(n => n.startsWith("lineupr-") && !keep.has(n)).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

const isCacheable = (res) => res && (res.ok || res.type === "opaque");

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (isCacheable(res)) cache.put(req, res.clone());
  return res;
}

async function networkFirst(req, cacheName, key) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(key || req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(key || req);
    if (hit) return hit;
    throw err;
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  const refresh = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; });
  if (hit) { refresh.catch(() => {}); return hit; }
  return refresh;
}

// Screenshot cache with a size cap; a hit is re-inserted so it counts as
// recently used.
async function imageCache(req) {
  const cache = await caches.open(IMG);
  const hit = await cache.match(req);
  if (hit) { cache.put(req, hit.clone()).catch(() => {}); return hit; }
  const res = await fetch(req);
  if (isCacheable(res)) {
    await cache.put(req, res.clone());
    const keys = await cache.keys();
    for (let i = 0; i < keys.length - IMG_LIMIT; i++) await cache.delete(keys[i]);
  }
  return res;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.origin === R2_PUBLIC) {
    if (req.destination === "image") event.respondWith(imageCache(req));
    return; // video etc.: Range requests are left to the browser
  }
  if (url.origin !== self.location.origin) return;
  if (req.headers.has("range")) return;

  const path = url.pathname;

  if (path.startsWith("/api/")) {
    // Only public, identical-for-everyone data is cached.
    const publicLineups = path === "/api/lineups" && url.searchParams.has("mapId") && !url.searchParams.has("mine") && !req.headers.has("authorization");
    // /api/config is the public Supabase URL + anon key (already in every page load).
    if (publicLineups || path === "/api/areas" || path === "/api/config") event.respondWith(staleWhileRevalidate(req, API));
    return;
  }

  if (path.startsWith("/js/") || path.startsWith("/fonts/") || path.startsWith("/vendor/") || path.startsWith("/maps/")) {
    event.respondWith(cacheFirst(req, STATIC));
    return;
  }

  if (req.mode === "navigate") {
    // Every /?map=… deep link is the same shell document.
    if (path === "/" || path === "/index.html") {
      event.respondWith(networkFirst(req, PAGES, SHELL).catch(() => caches.match(SHELL)));
    }
    return;
  }

  if (path === "/style.css") event.respondWith(networkFirst(req, PAGES));
});
