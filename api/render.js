// Server-rendered, crawlable HTML pages for official lineups.
// Reached via vercel.json rewrites:
//   /maps                  -> ?page=maps    (index of all maps)
//   /<map>                 -> ?page=map     (all official lineups on one map)
//   /<map>/<type>/<slug>   -> ?page=lineup  (one official lineup)
// The interactive SPA stays at / — these pages exist so search engines get
// real content, and they link into the SPA for the interactive experience.
const {
  SITE, CONSTANTS, supabase, fetchOfficialLineups,
  esc, isPublicStorageUrl, lineupPath, shortIdOf, lineupDisplayName,
} = require("./_lib/seo");

// Section headers on map pages. Presentation-only, keyed by type id.
const TYPE_PLURALS = {
  smoke: "Smokes", flash: "Flashes", fire: "Molotovs",
  he: "HE Grenades", decoy: "Decoys",
};

// Pages are cached at the edge so crawls don't hammer Supabase, but the
// window is kept short (60s fresh) so an admin's edit — rename, new throw,
// delete — shows up within about a minute. stale-while-revalidate lets the
// edge serve the slightly-stale copy instantly while it refreshes in the
// background, so Supabase is still shielded under crawl bursts.
const CACHE_OK = "public, s-maxage=60, stale-while-revalidate=600";
const CACHE_MISS = "public, s-maxage=60";

function sendHtml(res, status, html, cacheControl) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", cacheControl);
  res.status(status).send(html);
}

// `<` is escaped inside the JSON so lineup text can never contain a
// literal `</script>` that terminates the JSON-LD block.
function jsonLdScript(obj) {
  return `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, "\\u003c")}</script>`;
}

const BRAND_SVG = `<svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" width="26" height="26" aria-hidden="true"><circle cx="20" cy="20" r="17" stroke="#ffa53e" stroke-width="2.2"/><circle cx="20" cy="20" r="9" stroke="#ffa53e" stroke-width="1" opacity="0.3"/><line x1="20" y1="3" x2="20" y2="11" stroke="#ffa53e" stroke-width="2" stroke-linecap="round"/><line x1="20" y1="29" x2="20" y2="37" stroke="#ffa53e" stroke-width="2" stroke-linecap="round"/><line x1="3" y1="20" x2="11" y2="20" stroke="#ffa53e" stroke-width="2" stroke-linecap="round"/><line x1="29" y1="20" x2="37" y2="20" stroke="#ffa53e" stroke-width="2" stroke-linecap="round"/><circle cx="20" cy="20" r="3.5" fill="#ffa53e"/><circle cx="20" cy="20" r="1.4" fill="#0f0c09"/></svg>`;

// Inline CSS matching the rest of the site (home page, blog): same palette,
// header, footer and type. No external stylesheet, so each page stays a
// single fetch.
const PAGE_CSS = `
:root{--void:#0c0a08;--hull:#161210;--panel:#1d1815;--panel-2:#25201a;--line:#382e25;--line-soft:#2a221c;--text:#f2ece2;--dim:#a99d8c;--faint:#8f8270;--signal:#ffa53e;--signal-dim:#6b4a1f;--ease-out:cubic-bezier(.22,1,.36,1)}
*{box-sizing:border-box}
body{margin:0;background:var(--void);color:var(--text);font:16px/1.65 Inter,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
::selection{background:var(--signal-dim);color:var(--text)}
a{color:var(--signal);text-decoration:none}
a:focus-visible{outline:2px solid var(--signal);outline-offset:3px;border-radius:4px}
.site-head{position:sticky;top:0;z-index:20;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px 48px;border-bottom:1px solid var(--line-soft);background:rgba(12,10,8,.78);backdrop-filter:blur(14px) saturate(1.3);-webkit-backdrop-filter:blur(14px) saturate(1.3);transition:border-color .3s,box-shadow .3s}
.site-head.is-scrolled{border-bottom-color:var(--line);box-shadow:0 10px 30px -18px rgba(0,0,0,.8)}
.brand-link{display:flex;align-items:center;gap:10px;color:var(--text)}
.brand-link svg{transition:transform .8s var(--ease-out)}
.brand-link:hover svg{transform:rotate(180deg)}
.wordmark{font-family:Bahnschrift,Oswald,"Arial Narrow",sans-serif;font-stretch:condensed;font-weight:700;font-size:21px;letter-spacing:.06em;color:var(--text)}
.wordmark span{color:var(--signal)}
.site-head nav{display:flex;align-items:center;gap:22px}
.site-head nav a{color:var(--dim);font-size:14.5px;font-weight:500;transition:color .2s}
.site-head nav a:hover{color:var(--text)}
.site-head .nav-cta{padding:8px 16px;border:1px solid var(--signal-dim);border-radius:999px;color:var(--signal);font-weight:600}
.site-head .nav-cta:hover{border-color:var(--signal);color:var(--signal);background:rgba(255,165,62,.08)}
.wrap{max-width:960px;margin:0 auto;padding:48px 32px 72px}
.crumbs{font-size:13px;color:var(--faint);margin:0 0 24px}
.crumbs a{color:var(--dim)}
.crumbs a:hover{color:var(--text)}
.page-head{margin:0 0 28px}
.kicker{display:flex;align-items:center;flex-wrap:wrap;gap:6px 12px;margin:0 0 12px;font-size:13px;color:var(--faint)}
.kicker a{color:var(--dim);text-decoration:none}
.kicker a:hover{color:var(--text)}
.kicker > :not(.tag) + :not(.tag)::before{content:"·";margin-right:12px;color:var(--line)}
.tag{display:inline-flex;align-items:center;gap:7px;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:600;color:var(--signal);background:rgba(255,165,62,.12)}
.tag .dot{width:7px;height:7px}
h1{margin:0;font-size:clamp(30px,4.4vw,44px);line-height:1.12;font-weight:700;letter-spacing:-.02em;color:var(--text)}
h2{margin:44px 0 14px;display:flex;align-items:center;gap:10px;font-size:21px;font-weight:700;letter-spacing:-.01em;color:var(--text)}
h2 .count{font-size:13px;font-weight:500;color:var(--faint)}
.lede{color:var(--dim);margin:12px 0 0;max-width:64ch;font-size:17px;line-height:1.65}
.actions{display:flex;flex-wrap:wrap;align-items:center;gap:10px 20px;margin:24px 0 8px}
.cta{display:inline-flex;align-items:center;gap:8px;padding:12px 22px;border-radius:999px;background:var(--signal);color:#1a1006;font-size:15px;font-weight:600;transition:transform .3s var(--ease-out),box-shadow .3s}
.cta:hover{transform:translateY(-2px);box-shadow:0 10px 30px rgba(255,165,62,.22)}
.cta svg{transition:transform .3s var(--ease-out)}
.cta:hover svg{transform:translateX(3px)}
.link-quiet{color:var(--dim);font-size:15px;font-weight:500}
.link-quiet:hover{color:var(--text)}
main p a{text-decoration:underline;text-decoration-color:rgba(255,165,62,.4);text-underline-offset:3px}
ul.plain,ul.rows{list-style:none;padding:0;margin:0}
ul.plain li{padding:10px 0;border-bottom:1px solid var(--line-soft)}
ul.plain .sub{color:var(--faint);font-size:13px;margin-left:8px}
ul.rows{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px}
ul.rows a{display:flex;align-items:center;gap:12px;height:100%;padding:13px 16px;border:1px solid var(--line);border-radius:12px;background:var(--hull);color:var(--text);transition:border-color .3s,background .3s,transform .4s var(--ease-out)}
ul.rows a:hover{border-color:rgba(255,165,62,.5);background:var(--panel);transform:translateY(-2px)}
ul.rows .num{flex-shrink:0;width:24px;height:24px;border-radius:7px;display:grid;place-items:center;font-size:12px;font-weight:600;color:var(--signal);background:rgba(255,165,62,.12)}
ul.rows .name{flex:1;min-width:0;font-weight:600;font-size:15px;line-height:1.35}
ul.rows .sub{display:block;margin-top:2px;font-weight:400;font-size:12.5px;color:var(--faint)}
ul.rows .arrow{flex-shrink:0;color:var(--faint);transition:color .3s,transform .3s var(--ease-out)}
ul.rows a:hover .arrow{color:var(--signal);transform:translateX(3px)}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chips a{padding:7px 14px;border:1px solid var(--line);border-radius:999px;color:var(--dim);font-size:14px;transition:border-color .2s,color .2s}
.chips a:hover{border-color:var(--signal);color:var(--text)}
.dot{width:8px;height:8px;border-radius:50%;display:inline-block;flex-shrink:0}
.dot-smoke{background:#c7cdd2}.dot-flash{background:#f5d142}.dot-fire{background:#ff6a45}.dot-he{background:#79e07e}.dot-decoy{background:#cf9f6e}
.throw{background:var(--hull);border:1px solid var(--line);border-radius:16px;padding:20px 22px;margin:0 0 18px}
.throw-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:0 0 12px}
.throw h3{margin:0;font-size:18px;font-weight:700}
.throw-head a{font-size:13.5px;font-weight:500}
.facts{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 14px;padding:0;list-style:none}
.facts li{padding:4px 12px;border-radius:999px;background:var(--panel-2);font-size:13px;color:var(--dim)}
.facts b{color:var(--text);font-weight:600}
.notes{margin:0 0 16px;font-size:15.5px;line-height:1.7;color:#ddd5c9}
.shots{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px}
.shots figure{margin:0}
.shots img{width:100%;height:auto;border-radius:10px;border:1px solid var(--line);display:block;cursor:zoom-in;transition:border-color .3s}
.shots img:hover{border-color:var(--signal-dim)}
.shots figcaption{font-size:12.5px;color:var(--faint);margin-top:6px}
.site-footer{padding:48px 32px 40px;border-top:1px solid var(--line);background:var(--hull)}
.site-footer-grid{max-width:1080px;margin:0 auto;display:grid;grid-template-columns:1.4fr 1.6fr 1fr 1fr;gap:32px}
.site-footer-brand .wordmark{font-size:20px}
.site-footer-brand p{margin:12px 0 0;max-width:36ch;font-size:12.5px;line-height:1.6;color:var(--faint)}
.site-footer-title{margin:0 0 12px;font-size:13px;font-weight:600;color:var(--text)}
.site-footer-col ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.site-footer-col ul.site-footer-maps{display:grid;grid-template-columns:1fr 1fr;gap:8px 16px}
.site-footer-col a{color:var(--dim);font-size:13.5px;line-height:1.5;transition:color .2s}
.site-footer-col a:hover{color:var(--signal)}
.lb{position:fixed;inset:0;background:rgba(4,6,7,.93);display:none;align-items:center;justify-content:center;z-index:100;overflow:hidden}
.lb.show{display:flex}
.lb img{max-width:94vw;max-height:92vh;border-radius:4px;user-select:none;-webkit-user-drag:none;transform-origin:center;will-change:transform}
.lb-close{position:absolute;top:12px;right:16px;background:none;border:none;color:#fff;font-size:32px;line-height:1;cursor:pointer;padding:4px 10px}
.lb-hint{position:absolute;bottom:14px;left:50%;transform:translateX(-50%);color:var(--dim);font-size:12px;pointer-events:none}
.fx-progress{position:fixed;inset:0 0 auto 0;height:3px;z-index:700;transform:scaleX(0);transform-origin:left;background:var(--signal);pointer-events:none;will-change:transform}
html.fx .fx-rv{opacity:0;translate:0 24px;transition:opacity .8s var(--ease-out) var(--d,0ms),translate .8s var(--ease-out) var(--d,0ms)}
html.fx .fx-rv.is-in{opacity:1;translate:0 0}
@media(max-width:900px){.site-footer-grid{grid-template-columns:1fr 1fr}}
@media(max-width:640px){.site-head{padding:12px 16px}.site-head nav a:not(.nav-cta){display:none}.wrap{padding:28px 18px 56px}.lede{font-size:16px}.throw{padding:16px}.site-footer{padding:36px 20px 32px}.site-footer-grid{grid-template-columns:1fr;gap:28px}}
`.trim();

const ARROW_SVG = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

// Same header and column footer as the home page and blog.
const SITE_HEADER = `<header class="site-head">
<a class="brand-link" href="/" aria-label="Lineupr home">${BRAND_SVG.replace('width="26" height="26"', 'width="30" height="30"')}<span class="wordmark">lineup<span>r</span></span></a>
<nav aria-label="Primary"><a href="/maps">Maps</a><a href="/blog">Blog</a><a class="nav-cta" href="/maps">Open the map</a></nav>
</header>`;

function siteFooter(C) {
  return `<footer class="site-footer" aria-label="Site footer">
<div class="site-footer-grid">
<div class="site-footer-brand"><span class="wordmark">lineup<span>r</span></span><p>Built by players, for players. An independent fan project, not affiliated with or endorsed by Valve. Counter-Strike 2 and its map images are trademarks or copyrighted material of Valve.</p></div>
<nav class="site-footer-col" aria-label="Lineups by map"><p class="site-footer-title">Lineups by map</p><ul class="site-footer-maps">${C.MAPS.map(m => `<li><a href="/${esc(m.id)}">${esc(m.name)}</a></li>`).join("")}</ul></nav>
<nav class="site-footer-col" aria-label="Lineupr"><p class="site-footer-title">Lineupr</p><ul><li><a href="/">Home</a></li><li><a href="/maps">All maps</a></li><li><a href="/blog">Blog</a></li><li><a href="mailto:support@nastipe.dev">Contact</a></li></ul></nav>
<nav class="site-footer-col" aria-label="Legal"><p class="site-footer-title">Legal</p><ul><li><a href="/privacy.html">Privacy</a></li><li><a href="/terms.html">Terms</a></li><li><a href="/cookies.html">Cookies</a></li><li><a href="mailto:support@nastipe.dev?subject=Content%20report">Report content</a></li></ul></nav>
</div>
</footer>`;
}

// Self-contained click-to-zoom lightbox for the screenshot <img>s. Vanilla,
// inline, no dependencies — click a shot to open it fullscreen; wheel or
// click to zoom, drag to pan, Esc/×/backdrop to close.
const LIGHTBOX_HTML = `<div class="lb" id="lb" role="dialog" aria-modal="true" aria-label="Screenshot viewer">
<button class="lb-close" id="lbClose" aria-label="Close">&times;</button>
<img id="lbImg" alt="">
<div class="lb-hint">Scroll or click to zoom · drag to pan · Esc to close</div>
</div>
<script>
(function(){
var o=document.getElementById('lb'),im=document.getElementById('lbImg'),z=1,x=0,y=0,d=false,sx=0,sy=0,px=0,py=0;
function t(){im.style.transform='translate('+x+'px,'+y+'px) scale('+z+')';im.style.cursor=z>1?'grab':'zoom-in';}
function open(s,a){im.src=s;im.alt=a||'';z=1;x=0;y=0;t();o.classList.add('show');document.body.style.overflow='hidden';}
function close(){o.classList.remove('show');im.removeAttribute('src');document.body.style.overflow='';}
var shots=document.querySelectorAll('.shots img');
for(var i=0;i<shots.length;i++){(function(img){img.addEventListener('click',function(){open(img.currentSrc||img.src,img.alt);});})(shots[i]);}
document.getElementById('lbClose').addEventListener('click',close);
o.addEventListener('click',function(e){if(e.target===o)close();});
document.addEventListener('keydown',function(e){if(e.key==='Escape'&&o.classList.contains('show'))close();});
o.addEventListener('wheel',function(e){e.preventDefault();z=Math.min(Math.max(z*(e.deltaY<0?1.2:1/1.2),1),6);if(z===1){x=0;y=0;}t();},{passive:false});
im.addEventListener('click',function(e){e.stopPropagation();if(z>1){z=1;x=0;y=0;}else{z=2.5;}t();});
im.addEventListener('mousedown',function(e){if(z<=1)return;e.preventDefault();d=true;sx=e.clientX;sy=e.clientY;px=x;py=y;im.style.cursor='grabbing';});
window.addEventListener('mousemove',function(e){if(!d)return;x=px+(e.clientX-sx);y=py+(e.clientY-sy);t();});
window.addEventListener('mouseup',function(){if(d){d=false;t();}});
})();
</script>`;

function layout({ title, description, path, ogImage, ogType, jsonLd, crumbs, body, lightbox, robots, head }) {
  const canonical = SITE + path;
  const image = ogImage || `${SITE}/og-image.png`;
  const imageDims = ogImage ? "" : `<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="630">\n`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
${robots ? `<meta name="robots" content="${esc(robots)}">\n` : ""}${head || ""}
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<meta property="og:type" content="${ogType || "website"}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${esc(image)}">
${imageDims}<meta property="og:site_name" content="Lineupr">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(image)}">
<style>${PAGE_CSS}</style>
${(jsonLd || []).map(jsonLdScript).join("\n")}
<script defer src="/site-fx.js"></script>
</head>
<body>
${SITE_HEADER}
<div class="wrap">
${crumbs ? `<nav class="crumbs" aria-label="Breadcrumb">${crumbs}</nav>` : ""}
<main>
${body}
</main>
</div>
${siteFooter(CONSTANTS)}
${lightbox ? LIGHTBOX_HTML : ""}
</body>
</html>`;
}

function breadcrumbLd(items) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": items.map(([name, path], i) => ({
      "@type": "ListItem",
      "position": i + 1,
      "name": name,
      "item": SITE + path,
    })),
  };
}

function firstValidScreenshot(lineup) {
  for (const t of lineup.throws) {
    for (const u of (Array.isArray(t.screenshots) ? t.screenshots : [])) {
      if (isPublicStorageUrl(u)) return u;
    }
  }
  return null;
}

// ---------------------------------------------------------------- /maps ---
// Deliberately NOT built on layout() — this page reuses the SPA's own
// home-screen markup/CSS classes (style.css) verbatim, rather than the
// lightweight inline-CSS template the other SEO pages use, so it looks
// exactly like the chooser screen that used to live at "/" before the
// hero landing page replaced it there. Map cards are real <a href> links
// (work with no JS) to "/?map=<id>", which main.js's deep-link handler
// already opens directly into the interactive app.
async function renderMapsIndex(res, C) {
  const lineups = await fetchOfficialLineups(supabase());
  const counts = {};
  lineups.forEach(l => { counts[l.mapId] = (counts[l.mapId] || 0) + 1; });

  const total = lineups.length;
  const cards = C.MAPS.map((m, i) => {
    const n = counts[m.id] || 0;
    return `<a class="map-card" href="/?map=${esc(m.id)}" data-reveal data-spot data-tilt>
<div class="map-card-bg" style="background-image:url('/maps/${m.id}-logo.jpg')"></div>
<span class="map-card-index" aria-hidden="true">${String(i + 1).padStart(2, "0")}</span>
<span class="map-card-badge${n === 0 ? " empty" : ""}"><b>${n}</b> lineup${n === 1 ? "" : "s"}</span>
<div class="map-card-content">
<div class="map-card-name">${esc(m.name)}</div>
<div class="map-card-count${n === 0 ? " empty" : ""}">${n === 0 ? "No lineups yet" : `${n} lineup${n === 1 ? "" : "s"}`}<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
</div>
</a>`;
  }).join("\n");

  const jsonLd = [{
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "name": "CS2 Grenade Lineups by Map",
    "url": `${SITE}/maps`,
    "mainEntity": {
      "@type": "ItemList",
      "itemListElement": C.MAPS.map((m, i) => ({
        "@type": "ListItem", "position": i + 1, "name": `${m.name} grenade lineups`, "url": `${SITE}/${m.id}`,
      })),
    },
  }];

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<script>if(!(window.matchMedia&&matchMedia("(prefers-reduced-motion: reduce)").matches))document.documentElement.classList.add("fx-hero");</script>
<title>Choose a Map — CS2 Grenade Lineups | Lineupr</title>
<meta name="description" content="Pick a CS2 map — Dust II, Mirage, Inferno, Nuke, Ancient, Anubis, Vertigo, Cache or Overpass — and browse its official smoke, flash, molotov and HE grenade lineups.">
<link rel="canonical" href="${SITE}/maps">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<meta property="og:type" content="website">
<meta property="og:url" content="${SITE}/maps">
<meta property="og:title" content="Choose a Map — CS2 Grenade Lineups | Lineupr">
<meta property="og:description" content="Pick a CS2 map and browse its official smoke, flash, molotov and HE grenade lineups.">
<meta property="og:image" content="${SITE}/og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Choose a Map — CS2 Grenade Lineups | Lineupr">
<meta name="twitter:image" content="${SITE}/og-image.png">
${jsonLd.map(jsonLdScript).join("\n")}
<link href="/fonts/fonts.css" rel="stylesheet">
<link rel="stylesheet" href="/style.css">
<script defer src="/site-fx.js"></script>
<script defer src="/cursor.js"></script>
</head>
<body>
<div class="home-screen home-screen--maps" id="homeScreen">
  <header class="home-header">
    <a class="home-brand" href="/" aria-label="Lineupr home">
      ${BRAND_SVG.replace('width="26" height="26"', 'width="32" height="32"')}
      <span class="home-wordmark">lineup<span class="home-wordmark-r">r</span></span>
    </a>
    <nav class="home-nav" aria-label="Primary">
      <a href="/blog" class="home-nav-link">Blog</a>
      <a href="/?map=dust2" class="home-nav-cta">Open the map</a>
    </nav>
  </header>
  <div class="home-body">
    <div class="maps-head">
      <p class="hero-eyebrow"><span class="hero-eyebrow-dot"></span>${C.MAPS.length} maps · ${total} lineups</p>
      <h1 class="maps-title">Pick your <span>battlefield</span></h1>
      <p class="maps-sub">Every active-duty CS2 map, with smokes, flashes, molotovs and HEs ready to learn.</p>
    </div>
    <div class="home-grid"><div class="home-grid-inner">
${cards}
    </div></div>
  </div>
  <footer class="home-footer site-footer" aria-label="Site footer">
    <div class="site-footer-grid">
      <div class="site-footer-brand">
        <span class="home-wordmark">lineup<span class="home-wordmark-r">r</span></span>
        <p>Built by players, for players. An independent fan project, not affiliated with or endorsed by Valve. Counter-Strike 2 and its map images are trademarks or copyrighted material of Valve.</p>
      </div>
      <nav class="site-footer-col" aria-label="Lineups by map">
        <p class="site-footer-title">Lineups by map</p>
        <ul class="site-footer-maps">
${C.MAPS.map(m => `          <li><a href="/${m.id}">${esc(m.name)}</a></li>`).join("\n")}
        </ul>
      </nav>
      <nav class="site-footer-col" aria-label="Lineupr">
        <p class="site-footer-title">Lineupr</p>
        <ul>
          <li><a href="/">Home</a></li>
          <li><a href="/blog">Blog</a></li>
          <li><a href="mailto:support@nastipe.dev">Contact</a></li>
        </ul>
      </nav>
      <nav class="site-footer-col" aria-label="Legal">
        <p class="site-footer-title">Legal</p>
        <ul>
          <li><a href="/privacy.html">Privacy</a></li>
          <li><a href="/terms.html">Terms</a></li>
          <li><a href="/cookies.html">Cookies</a></li>
          <li><a href="mailto:support@nastipe.dev?subject=Content%20report">Report content</a></li>
        </ul>
      </nav>
    </div>
  </footer>
</div>
</body>
</html>`;

  sendHtml(res, 200, html, CACHE_OK);
}

// --------------------------------------------------------------- /<map> ---
async function renderMapPage(res, C, mapId) {
  const map = C.MAPS.find(m => m.id === mapId);
  if (!map) return notFound(res);

  const lineups = await fetchOfficialLineups(supabase(), mapId);
  lineups.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  const sections = C.TYPES.map(t => {
    const ofType = lineups.filter(l => l.type === t.id);
    if (ofType.length === 0) return "";
    const items = ofType.map(l => {
      const n = l.throws.length;
      return `<li><a href="${esc(lineupPath(l))}"><span class="dot dot-${esc(t.id)}"></span><span class="name">${esc(lineupDisplayName(l, t.label))}<span class="sub">${n} throw${n === 1 ? "" : "s"}</span></span><span class="arrow">${ARROW_SVG}</span></a></li>`;
    }).join("\n");
    return `<h2><span class="dot dot-${esc(t.id)}"></span>${esc(map.name)} ${TYPE_PLURALS[t.id] || t.label} <span class="count">${ofType.length}</span></h2>\n<ul class="rows">\n${items}\n</ul>`;
  }).join("\n");

  const otherMaps = C.MAPS.filter(m => m.id !== mapId)
    .map(m => `<a href="/${m.id}">${esc(m.name)}</a>`).join("");

  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      "name": `${map.name} Grenade Lineups (CS2)`,
      "url": `${SITE}/${map.id}`,
      "mainEntity": {
        "@type": "ItemList",
        "numberOfItems": lineups.length,
        "itemListElement": lineups.slice(0, 50).map((l, i) => {
          const t = C.TYPES.find(x => x.id === l.type);
          return {
            "@type": "ListItem", "position": i + 1,
            "name": lineupDisplayName(l, t ? t.label : l.type),
            "url": SITE + lineupPath(l),
          };
        }),
      },
    },
    breadcrumbLd([["Maps", "/maps"], [map.name, `/${map.id}`]]),
  ];

  const body = `
<header class="page-head">
<p class="kicker"><span class="tag">Map</span><span>${lineups.length} official lineup${lineups.length === 1 ? "" : "s"}</span></p>
<h1>${esc(map.name)} Grenade Lineups (CS2)</h1>
<p class="lede">${lineups.length} official grenade lineup${lineups.length === 1 ? "" : "s"} for ${esc(map.name)} — smokes, flashes, molotovs and HE grenades. Every lineup includes where to stand, where to aim, the throw technique, and screenshots.</p>
<div class="actions"><a class="cta" href="/?map=${esc(map.id)}">Open ${esc(map.name)} in the interactive map ${ARROW_SVG}</a><a class="link-quiet" href="/maps">All maps</a></div>
</header>
${sections || `<p class="lede">No official lineups for ${esc(map.name)} yet — check back soon.</p>`}
<h2>Other maps</h2>
<div class="chips">${otherMaps}</div>`;

  sendHtml(res, 200, layout({
    title: `${map.name} Grenade Lineups (CS2) — Smokes, Flashes & Molotovs | Lineupr`,
    description: `${lineups.length} official ${map.name} grenade lineups for CS2 with screenshots: smoke, flash, molotov and HE spots, plus throw technique for each one.`,
    path: `/${map.id}`,
    jsonLd,
    crumbs: `<a href="/">Home</a> › <a href="/maps">Maps</a> › ${esc(map.name)}`,
    body,
  }), CACHE_OK);
}

// -------------------------------------------------- /<map>/<type>/<slug> ---
function throwImages(t) {
  const groups = [
    ["standing", Array.isArray(t.standing) ? t.standing : [], "where to stand"],
    ["aim", Array.isArray(t.screenshots) ? t.screenshots : [], "where to aim"],
    ["precise", t.precise != null ? [t.precise] : [], "precise aim point"],
    ["result", t.result != null ? [t.result] : [], "result"],
  ];
  return groups
    .map(([kind, urls, label]) => [kind, urls.filter(isPublicStorageUrl), label])
    .filter(([, urls]) => urls.length > 0);
}

async function renderLineupPage(res, C, mapId, typeId, slug) {
  const map = C.MAPS.find(m => m.id === mapId);
  const type = C.TYPES.find(t => t.id === typeId);
  if (!map || !type || typeof slug !== "string" || !slug) return notFound(res);

  // The short id is the last hyphen-separated token of the slug (it is
  // generated alphanumeric-only, so this always recovers it).
  const short = slug.split("-").pop().toLowerCase();
  const lineups = await fetchOfficialLineups(supabase(), mapId);
  const lineup = lineups.find(l => l.type === typeId && shortIdOf(l.id) === short);
  if (!lineup) return notFound(res);

  const displayName = lineupDisplayName(lineup, type.label);
  const canonicalPath = lineupPath(lineup);
  const ogImage = firstValidScreenshot(lineup);

  // The first screenshot on the page is the LCP candidate — load it eagerly
  // and at high priority instead of lazily like the rest.
  let firstImageSeen = false;
  const throwsHtml = lineup.throws.map((t, i) => {
    const movement = esc(C.MOVEMENT_LABELS[t.movement] || t.movement || "—");
    const range = esc(C.RANGE_LABELS[t.range] || t.range || "—");
    const notes = String(t.notes || "").trim();
    const imgs = throwImages(t).map(([, urls, label]) =>
      urls.map((u, j) => {
        const alt = `${map.name} ${type.label.toLowerCase()} lineup ${displayName} — throw ${i + 1}, ${label}${urls.length > 1 ? ` (${j + 1})` : ""}`;
        const isFirst = !firstImageSeen;
        firstImageSeen = true;
        const loadAttrs = isFirst
          ? `loading="eager" fetchpriority="high"`
          : `loading="lazy"`;
        return `<figure><img src="${esc(u)}" alt="${esc(alt)}" ${loadAttrs} decoding="async"><figcaption>Throw ${i + 1} — ${esc(label)}</figcaption></figure>`;
      }).join("\n")
    ).join("\n");

    return `<section class="throw">
<div class="throw-head"><h3>Throw ${i + 1} of ${lineup.throws.length}</h3>${lineup.throws.length > 1 ? `<a href="/?map=${esc(map.id)}&amp;lineup=${esc(lineup.id)}&amp;throw=${i + 1}">Open this throw in the map →</a>` : ""}</div>
<ul class="facts"><li>Movement: <b>${movement}</b></li><li>Range: <b>${range}</b></li></ul>
${notes ? `<p class="notes">${esc(notes).replace(/\r?\n/g, "<br>")}</p>` : ""}
${imgs ? `<div class="shots">\n${imgs}\n</div>` : ""}
</section>`;
  }).join("\n");

  // Related lineups: same type first, then anything else on this map.
  const related = lineups
    .filter(l => l.id !== lineup.id)
    .sort((a, b) => (b.type === typeId) - (a.type === typeId))
    .slice(0, 6);
  const relatedHtml = related.length ? `
<h2>More ${esc(map.name)} lineups</h2>
<ul class="rows">
${related.map(l => {
    const t = C.TYPES.find(x => x.id === l.type);
    const label = t ? t.label : l.type;
    return `<li><a href="${esc(lineupPath(l))}"><span class="dot dot-${esc(l.type)}"></span><span class="name">${esc(lineupDisplayName(l, label))}<span class="sub">${esc(label)}</span></span><span class="arrow">${ARROW_SVG}</span></a></li>`;
  }).join("\n")}
</ul>` : "";

  const firstThrow = lineup.throws[0] || {};
  const firstMove = C.MOVEMENT_LABELS[firstThrow.movement] || "";
  const firstNotes = String(firstThrow.notes || "").trim().replace(/\s+/g, " ");
  const description = (firstNotes
    ? `${displayName} — ${map.name} ${type.label.toLowerCase()} lineup for CS2. ${firstNotes}`
    : `How to throw the ${displayName} ${type.label.toLowerCase()} on ${map.name} in CS2${firstMove ? ` (${firstMove.toLowerCase()})` : ""}, with screenshots showing where to stand and where to aim.`
  ).slice(0, 158);

  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "HowTo",
      "name": `${displayName} — ${map.name} ${type.label} lineup (CS2)`,
      "description": description,
      ...(ogImage ? { "image": [ogImage] } : {}),
      "step": lineup.throws.map((t, i) => {
        const imgs = throwImages(t).flatMap(([, urls]) => urls);
        return {
          "@type": "HowToStep",
          "position": i + 1,
          "name": `Throw ${i + 1}: ${C.MOVEMENT_LABELS[t.movement] || t.movement} (${C.RANGE_LABELS[t.range] || t.range})`,
          "text": String(t.notes || "").trim() || `Use a ${(C.MOVEMENT_LABELS[t.movement] || t.movement || "standard throw").toLowerCase()} at ${(C.RANGE_LABELS[t.range] || t.range || "throw").toLowerCase()} range.`,
          ...(imgs.length ? { "image": imgs } : {}),
        };
      }),
    },
    breadcrumbLd([["Maps", "/maps"], [map.name, `/${map.id}`], [displayName, canonicalPath]]),
  ];

  const body = `
<header class="page-head">
<p class="kicker"><span class="tag"><span class="dot dot-${esc(type.id)}"></span>${esc(type.label)}</span><a href="/${esc(map.id)}">${esc(map.name)}</a><span>${lineup.throws.length} throw${lineup.throws.length === 1 ? "" : "s"}</span></p>
<h1>${esc(displayName)}</h1>
<p class="lede">Official Lineupr lineup with screenshots and technique for each throw.</p>
<div class="actions"><a class="cta" href="/?map=${esc(map.id)}&amp;lineup=${esc(lineup.id)}">Open in interactive map ${ARROW_SVG}</a><a class="link-quiet" href="/${esc(map.id)}">All ${esc(map.name)} lineups</a></div>
</header>
${throwsHtml}
${relatedHtml}
<h2>Browse more</h2>
<div class="chips"><a href="/${esc(map.id)}">All ${esc(map.name)} lineups</a><a href="/maps">All maps</a></div>`;

  sendHtml(res, 200, layout({
    title: `${displayName} — ${map.name} ${type.label} Lineup (CS2) | Lineupr`,
    description,
    path: canonicalPath,
    ogImage,
    ogType: "article",
    jsonLd,
    crumbs: `<a href="/">Home</a> › <a href="/maps">Maps</a> › <a href="/${esc(map.id)}">${esc(map.name)}</a> › ${esc(displayName)}`,
    body,
    lightbox: true,
  }), CACHE_OK);
}

// ------------------------------------------------------- shared collection ---
// /c/<slug>: link-preview + crawlable page for a shared collection. Real
// visitors are sent straight on to the interactive app; Discord / Telegram /
// crawlers read the title, description and image from here. Only OFFICIAL
// lineups are ever listed (a collection's personal lineups stay private).
// Public collections are indexable; unlisted ones are noindex.
async function renderCollectionPage(res, C, slug) {
  if (!/^[A-Za-z0-9]{10}$/.test(slug)) return notFound(res);
  const sb = supabase();
  const { data: col, error } = await sb.from("collections").select("*").eq("share_slug", slug).maybeSingle();
  if (error) throw new Error(error.message);
  if (!col || col.visibility === "private" || col.moderation_hidden_at) return notFound(res);
  const map = C.MAPS.find(m => m.id === col.map_id);
  if (!map) return notFound(res);

  const { data: items, error: ierr } = await sb.from("collection_items").select("lineup_id, role, timing, position").eq("collection_id", col.id).order("position");
  if (ierr) throw new Error(ierr.message);
  const ids = (items || []).map(i => i.lineup_id).filter(Boolean);
  let lineups = [];
  if (ids.length) {
    const { data: rows, error: lerr } = await sb.from("lineups").select("*").in("id", ids).eq("is_official", true);
    if (lerr) throw new Error(lerr.message);
    lineups = (rows || []).map(r => ({ id: r.id, mapId: r.map_id, type: r.type, name: r.name || "", landing: r.landing, throws: Array.isArray(r.throws) ? r.throws : [], createdAt: r.created_at }));
  }
  const byId = new Map(lineups.map(l => [l.id, l]));
  const visible = (items || []).map(i => ({ item: i, lineup: byId.get(i.lineup_id) })).filter(x => x.lineup);
  const total = (items || []).length;

  const title = `${col.name} · ${total} lineup${total === 1 ? "" : "s"} · ${map.name} | Lineupr`;
  const description = (col.description && col.description.trim()) || `A ${map.name} CS2 grenade lineup collection on Lineupr: ${total} lineup${total === 1 ? "" : "s"} to practise as one strategy.`;
  const appUrl = `/?map=${encodeURIComponent(col.map_id)}&collection=${encodeURIComponent(slug)}`;
  const ogImage = (visible.map(x => firstValidScreenshot(x.lineup)).find(Boolean)) || null;

  const list = visible.map(({ item, lineup }, i) => {
    const type = C.TYPES.find(t => t.id === lineup.type);
    const label = lineupDisplayName(lineup, type ? type.label : lineup.type);
    const extra = [item.role, item.timing].filter(Boolean).map(esc).join(" · ");
    return `<li><a href="${esc(lineupPath(lineup))}"><span class="num">${i + 1}</span><span class="name">${esc(label)}<span class="sub">${esc(type ? type.label : "")}${extra ? " · " + extra : ""}</span></span><span class="arrow">${ARROW_SVG}</span></a></li>`;
  }).join("");

  sendHtml(res, 200, layout({
    title, description, path: `/c/${slug}`, ogImage,
    robots: col.visibility === "public" ? "index,follow" : "noindex,nofollow",
    // Real browsers go straight to the app; link-preview bots don't run JS.
    head: `<script>if(!/bot|crawl|spider|preview|facebookexternalhit|discord|telegram|slack/i.test(navigator.userAgent))location.replace(${JSON.stringify(appUrl)});</script>\n`,
    crumbs: `<a href="/">Lineupr</a> › <a href="/${esc(map.id)}">${esc(map.name)}</a> › Collection`,
    body: `<header class="page-head">
<p class="kicker"><span class="tag">Collection</span><a href="/${esc(map.id)}">${esc(map.name)}</a><span>${total} lineup${total === 1 ? "" : "s"}</span></p>
<h1>${esc(col.name)}</h1>
<p class="lede">${esc(description)}</p>
<div class="actions"><a class="cta" href="${esc(appUrl)}">Open in the interactive map ${ARROW_SVG}</a></div>
</header>
<h2>${total} lineup${total === 1 ? "" : "s"} on ${esc(map.name)}</h2>
${list ? `<ul class="rows">${list}</ul>` : `<p class="lede">No official lineups to show.</p>`}
${visible.length < total ? `<p class="lede">${total - visible.length} more ${total - visible.length === 1 ? "item is" : "items are"} personal or no longer available.</p>` : ""}`,
  }), CACHE_OK);
}

// ------------------------------------------------------------------ 404 ---
function notFound(res) {
  sendHtml(res, 404, layout({
    title: "Page not found | Lineupr",
    description: "This lineup or map page does not exist.",
    path: "/maps",
    body: `<header class="page-head"><p class="kicker"><span class="tag">404</span></p><h1>Page not found</h1><p class="lede">This lineup or map doesn't exist (it may have been removed).</p><div class="actions"><a class="cta" href="/maps">Browse all maps ${ARROW_SVG}</a><a class="link-quiet" href="/">Home</a></div></header>`,
  }), CACHE_MISS);
}

module.exports = async function handler(req, res) {
  try {
    const C = CONSTANTS;
    const q = req.query || {};
    // Params are whitelisted in the vercel.json rewrites, but this function
    // is also directly reachable at /api/render — validate again here.
    if (q.page === "maps") return await renderMapsIndex(res, C);
    if (q.page === "map") return await renderMapPage(res, C, String(q.map || ""));
    if (q.page === "collection") return await renderCollectionPage(res, C, String(q.slug || ""));
    if (q.page === "lineup") {
      return await renderLineupPage(res, C, String(q.map || ""), String(q.type || ""), String(q.slug || ""));
    }
    return notFound(res);
  } catch (err) {
    console.error(err);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.status(500).send("<!doctype html><title>Error</title><p>Something went wrong rendering this page. <a href=\"/\">Back to Lineupr</a></p>");
  }
};
