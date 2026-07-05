// Shared helpers for the SEO/SSR functions (api/render.js, api/sitemap.js).
// Lives under api/_lib/ so Vercel does not expose it as its own endpoint.
const { createClient } = require("@supabase/supabase-js");
const CONSTANTS = require("./constants");

const SITE = process.env.SITE_URL || "https://lineupr.org";

function supabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    { auth: { persistSession: false } }
  );
}

// Same shape the SPA consumes from api/lineups.js.
function mapRow(row) {
  return {
    id:         row.id,
    mapId:      row.map_id,
    type:       row.type,
    name:       row.name || "",
    landing:    row.landing,
    throws:     Array.isArray(row.throws) ? row.throws : [],
    createdAt:  row.created_at,
  };
}

// Public pages only ever show official lineups — never personal ones.
async function fetchOfficialLineups(sb, mapId) {
  let query = sb.from("lineups").select("*").eq("is_official", true);
  if (mapId) query = query.eq("map_id", mapId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data || []).map(mapRow);
}

// Mirror of js/html-utils.js escapeHtml — every piece of lineup-derived
// text (name, notes) and every attribute value goes through this before
// being concatenated into HTML.
function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Only images from our own public storage bucket are ever rendered.
// Same posture as api/lineups.js isOwnStorageUrl, restricted to the public
// bucket: official lineups never reference the private one, and public
// pages must never leak a private-bucket path anyway. The breakout-char
// check is belt-and-suspenders on top of the attribute escaping.
const HTML_BREAKOUT_CHARS = /["'<>]/;
function isPublicStorageUrl(url) {
  if (typeof url !== "string" || url.length >= 500) return false;
  if (HTML_BREAKOUT_CHARS.test(url)) return false;
  return url.startsWith(`${process.env.SUPABASE_URL}/storage/v1/object/public/lineup-images/`);
}

function slugify(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
}

// Short stable id appended to lineup URLs. Alphanumeric only, so the URL
// parser can always recover it as the last hyphen-separated token.
function shortIdOf(id) {
  return String(id).replace(/[^a-z0-9]/gi, "").slice(0, 10).toLowerCase();
}

function lineupPath(l) {
  const slug = slugify(l.name);
  const sid = shortIdOf(l.id);
  return `/${l.mapId}/${l.type}/${slug ? `${slug}-${sid}` : sid}`;
}

function lineupDisplayName(l, typeLabel) {
  const name = String(l.name || "").trim();
  return name || `Unnamed ${typeLabel.toLowerCase()} lineup`;
}

module.exports = {
  SITE,
  CONSTANTS,
  supabase,
  fetchOfficialLineups,
  esc,
  isPublicStorageUrl,
  slugify,
  shortIdOf,
  lineupPath,
  lineupDisplayName,
};
