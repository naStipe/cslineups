// Named map areas (A Site, Mid, B Site, …): polygons drawn by admins in
// admin.html, stored in public.map_areas and served by /api/areas. Same
// percent coordinate space as lineup positions. A lineup belongs to an area
// when its landing point is inside the polygon. Lineups don't record a radar
// level, so on two-level maps (Nuke, Vertigo) an area matches by slug across
// both levels. `kind: "callout"` rows (single points) are reserved for the
// upcoming callout / name-suggestion work and ignored here.
import { state } from "./state.js";

const cache = new Map(); // mapId -> Promise<area[]>

export function fetchAreas(mapId) {
  if (!cache.has(mapId)) {
    const p = fetch(`/api/areas?mapId=${encodeURIComponent(mapId)}`)
      .then(r => (r.ok ? r.json() : []))
      .then(rows => (Array.isArray(rows) ? rows : []))
      .catch(() => []);
    cache.set(mapId, p);
  }
  return cache.get(mapId);
}

export function dropAreaCache(mapId) {
  cache.delete(mapId);
}

// Ray casting; polygon is [{x,y}, ...].
export function pointInPolygon(pt, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// Distinct selectable areas for the current map (by slug, first name wins).
export function areaOptions() {
  const seen = new Map();
  (state.areas || []).filter(a => a.kind === "area" && Array.isArray(a.polygon)).forEach(a => {
    if (!seen.has(a.slug)) seen.set(a.slug, { slug: a.slug, name: a.name, sort: a.sort });
  });
  return [...seen.values()].sort((a, b) => a.sort - b.sort);
}

export function lineupInArea(lineup, slug) {
  if (!slug) return true;
  return (state.areas || []).some(a =>
    a.slug === slug && a.kind === "area" && Array.isArray(a.polygon) && pointInPolygon(lineup.landing, a.polygon));
}

// Centre + bounding box of an area's polygons (percent), for zooming to it.
export function areaBounds(slug) {
  const pts = (state.areas || []).filter(a => a.slug === slug && Array.isArray(a.polygon)).flatMap(a => a.polygon);
  if (!pts.length) return null;
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, w: maxX - minX, h: maxY - minY };
}
