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

// Static blog posts (plain HTML files under /blog, not sourced from
// Supabase). Add the filename here when a new post is added.
const BLOG_POSTS = [
  { file: "how-to-learn-cs2-nade-lineups-fast.html", lastmod: "2026-09-18" },
  { file: "cs2-jumpthrow-bind-guide.html", lastmod: "2026-09-18" },
  { file: "dust2-smokes-that-matter.html", lastmod: "2026-09-18" },
];

module.exports = async function handler(req, res) {
  try {
    const { MAPS } = CONSTANTS;
    const lineups = await fetchOfficialLineups(supabase());

    // Most recent lineup edit across all maps, used as a lastmod proxy for
    // the homepage and the /maps index — both aggregate all lineups, so
    // their "freshest" date is whichever lineup changed last.
    const lineupDates = lineups.map(l => isoDate(l.createdAt)).filter(Boolean).sort();
    const latestLineupDate = lineupDates.length ? lineupDates[lineupDates.length - 1] : null;
    const latestBlogDate = BLOG_POSTS.map(p => p.lastmod).filter(Boolean).sort().pop() || null;

    const urls = [
      urlTag(`${SITE}/`, latestLineupDate),
      urlTag(`${SITE}/maps`, latestLineupDate),
      ...MAPS.map(m => urlTag(`${SITE}/${m.id}`)),
      ...lineups.map(l => urlTag(SITE + lineupPath(l), isoDate(l.createdAt))),
      urlTag(`${SITE}/blog`, latestBlogDate),
      ...BLOG_POSTS.map(p => urlTag(`${SITE}/blog/${p.file}`, p.lastmod)),
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
