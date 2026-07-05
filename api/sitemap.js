// Dynamic sitemap.xml (rewritten from /sitemap.xml in vercel.json).
// Lists the SPA root, the /maps index, the 8 map pages, and every official
// lineup page.
const { SITE, CONSTANTS, supabase, fetchOfficialLineups, lineupPath } = require("./_lib/seo");

function escXml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function urlTag(loc, lastmod) {
  return `<url><loc>${escXml(loc)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}</url>`;
}

// created_at is stored as epoch milliseconds.
function isoDate(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return null;
  const d = new Date(n);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

module.exports = async function handler(req, res) {
  try {
    const { MAPS } = CONSTANTS;
    const lineups = await fetchOfficialLineups(supabase());

    const urls = [
      urlTag(`${SITE}/`),
      urlTag(`${SITE}/maps`),
      ...MAPS.map(m => urlTag(`${SITE}/${m.id}`)),
      ...lineups.map(l => urlTag(SITE + lineupPath(l), isoDate(l.createdAt))),
    ];

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join("\n")}
</urlset>`;

    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
    res.status(200).send(xml);
  } catch (err) {
    console.error(err);
    res.setHeader("Cache-Control", "no-store");
    res.status(500).send("sitemap generation failed");
  }
};
