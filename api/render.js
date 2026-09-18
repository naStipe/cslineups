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

// Minimal inline CSS matching the SPA's dark theme — no external
// stylesheet or webfont requests, so the pages stay a single fetch.
const PAGE_CSS = `
:root{--void:#0c0a08;--panel:#1d1815;--line:#382e25;--text:#f2ece2;--dim:#a99d8c;--faint:#6b5f51;--signal:#ffa53e}
*{box-sizing:border-box}
body{margin:0;background:var(--void);color:var(--text);font:16px/1.6 Inter,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
a{color:var(--signal);text-decoration:none}a:hover{text-decoration:underline}
.wrap{max-width:880px;margin:0 auto;padding:20px 20px 64px}
.site-head{display:flex;align-items:center;gap:10px;padding:6px 0 22px;border-bottom:1px solid var(--line);margin-bottom:24px}
.site-head a{display:flex;align-items:center;gap:10px;color:var(--text);font-weight:700;letter-spacing:.02em}
.crumbs{font-size:13px;color:var(--faint);margin:0 0 14px}
.crumbs a{color:var(--dim)}
h1{font-family:Bahnschrift,Oswald,"Arial Narrow",sans-serif;font-stretch:condensed;letter-spacing:.03em;font-size:32px;margin:0 0 10px}
h2{font-family:Bahnschrift,Oswald,"Arial Narrow",sans-serif;font-stretch:condensed;letter-spacing:.03em;font-size:21px;margin:34px 0 12px;color:var(--signal)}
.lede{color:var(--dim);margin:0 0 20px;max-width:64ch}
.cta{display:inline-block;background:var(--signal);color:#1a150f;font-weight:600;padding:10px 18px;border-radius:8px;margin:6px 0 10px}
.cta:hover{text-decoration:none;filter:brightness(1.08)}
ul.plain{list-style:none;padding:0;margin:0}
ul.plain li{padding:9px 0;border-bottom:1px solid var(--line)}
ul.plain .sub{color:var(--faint);font-size:13px;margin-left:8px}
ol.steps{color:var(--dim);font-size:14px;line-height:1.7;margin:0 0 28px;padding-left:22px}
ol.steps li{padding:2px 0}
.map-card-grid{list-style:none;padding:0;margin:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}
.map-card-item{border:1px solid var(--line);border-radius:10px;overflow:hidden;background:var(--panel)}
.map-card-link{display:block;color:inherit}
.map-card-link:hover{text-decoration:none}
.map-card-link:hover .map-card-title{color:var(--signal)}
.map-card-thumb{display:block;aspect-ratio:16/10;background-size:cover;background-position:center;background-color:var(--void)}
.map-card-info{display:block;padding:12px 14px}
.map-card-title{display:block;font-family:inherit;font-weight:700;font-size:16px;color:var(--text)}
.map-card-info .sub{display:block;margin:2px 0 0;color:var(--faint);font-size:12.5px}
.map-card-breakdown{display:flex;flex-wrap:wrap;gap:2px 10px;margin-top:8px;font-size:12px;color:var(--dim)}
.map-card-type{display:inline-flex;align-items:center;gap:5px}
.dot{width:7px;height:7px;border-radius:50%;display:inline-block}
.dot-smoke{background:#c7cdd2}
.dot-flash{background:#f5d142}
.dot-fire{background:#ff6a45}
.dot-he{background:#79e07e}
.dot-decoy{background:#cf9f6e}
.throw{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:16px 18px;margin:0 0 18px}
.throw h3{margin:0 0 8px;font-size:17px}
.facts{display:flex;flex-wrap:wrap;gap:6px 20px;font-size:14px;color:var(--dim);margin:0 0 10px;padding:0;list-style:none}
.facts b{color:var(--text);font-weight:600}
.notes{margin:0 0 12px;white-space:normal}
.shots{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px}
.shots figure{margin:0}
.shots img{width:100%;height:auto;border-radius:6px;border:1px solid var(--line);display:block}
.shots figcaption{font-size:12px;color:var(--faint);margin-top:4px}
.foot{margin-top:44px;padding-top:16px;border-top:1px solid var(--line);font-size:13px;color:var(--faint)}
.foot a{color:var(--dim)}
.shots img{cursor:zoom-in}
.lb{position:fixed;inset:0;background:rgba(4,6,7,.93);display:none;align-items:center;justify-content:center;z-index:100;overflow:hidden}
.lb.show{display:flex}
.lb img{max-width:94vw;max-height:92vh;border-radius:4px;user-select:none;-webkit-user-drag:none;transform-origin:center;will-change:transform}
.lb-close{position:absolute;top:12px;right:16px;background:none;border:none;color:#fff;font-size:32px;line-height:1;cursor:pointer;padding:4px 10px}
.lb-hint{position:absolute;bottom:14px;left:50%;transform:translateX(-50%);color:var(--dim);font-size:12px;pointer-events:none}
`.trim();

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

function layout({ title, description, path, ogImage, ogType, jsonLd, crumbs, body, lightbox }) {
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
</head>
<body>
<div class="wrap">
<header class="site-head"><a href="/">${BRAND_SVG}<span>lineupr</span></a></header>
${crumbs ? `<nav class="crumbs" aria-label="Breadcrumb">${crumbs}</nav>` : ""}
<main>
${body}
</main>
<footer class="foot">
<p><a href="/">Lineupr</a> — the interactive CS2 grenade lineup map. <a href="/maps">Browse lineups by map</a>. <a href="/blog">Blog</a>. · <a href="/privacy.html">Privacy</a> · <a href="/terms.html">Terms</a> · <a href="/cookies.html">Cookies</a></p>
</footer>
</div>
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

  const cards = C.MAPS.map(m => {
    const n = counts[m.id] || 0;
    return `<a class="map-card" href="/?map=${esc(m.id)}">
<div class="map-card-bg" style="background-image:url('/maps/${m.id}-logo.jpg')"></div>
<div class="map-card-content">
<div class="map-card-name">${esc(m.name)}</div>
<div class="map-card-count${n === 0 ? " empty" : ""}">${n === 0 ? "No lineups yet" : `${n} lineup${n === 1 ? "" : "s"}`}</div>
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
<title>Choose a Map — CS2 Grenade Lineups | Lineupr</title>
<meta name="description" content="Pick a CS2 map — Dust II, Mirage, Inferno, Nuke, Ancient, Anubis, Overpass or Cache — and browse its official smoke, flash, molotov and HE grenade lineups.">
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
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/style.css">
</head>
<body>
<div class="home-screen">
  <header class="home-header">
    <a class="home-brand" href="/" aria-label="Lineupr home">
      ${BRAND_SVG.replace('width="26" height="26"', 'width="32" height="32"')}
      <span class="home-wordmark">lineup<span class="home-wordmark-r">r</span></span>
    </a>
  </header>
  <div class="home-body">
    <h2 class="home-section-title">Lineups</h2>
    <div class="home-grid"><div class="home-grid-inner">
${cards}
    </div></div>
  </div>
  <footer class="home-footer" aria-label="Map chooser footer">
    <nav class="home-footer-links" aria-label="Browse lineups by map">
      <a href="/">Home</a>
      <a href="/dust2">Dust II lineups</a>
      <a href="/mirage">Mirage lineups</a>
      <a href="/inferno">Inferno lineups</a>
      <a href="/nuke">Nuke lineups</a>
      <a href="/ancient">Ancient lineups</a>
      <a href="/anubis">Anubis lineups</a>
      <a href="/overpass">Overpass lineups</a>
      <a href="/cache">Cache lineups</a>
      <a href="/blog">Blog</a>
      <a href="/privacy.html">Privacy</a>
      <a href="/terms.html">Terms</a>
      <a href="/cookies.html">Cookies</a>
    </nav>
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
      return `<li><a href="${esc(lineupPath(l))}">${esc(lineupDisplayName(l, t.label))}</a><span class="sub">${n} throw${n === 1 ? "" : "s"}</span></li>`;
    }).join("\n");
    return `<h2>${esc(map.name)} ${TYPE_PLURALS[t.id] || t.label} (${ofType.length})</h2>\n<ul class="plain">\n${items}\n</ul>`;
  }).join("\n");

  const otherMaps = C.MAPS.filter(m => m.id !== mapId)
    .map(m => `<a href="/${m.id}">${esc(m.name)}</a>`).join(" · ");

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
<h1>${esc(map.name)} Grenade Lineups (CS2)</h1>
<p class="lede">${lineups.length} official grenade lineup${lineups.length === 1 ? "" : "s"} for ${esc(map.name)} — smokes, flashes, molotovs and HE grenades. Every lineup includes where to stand, where to aim, the throw technique, and screenshots.</p>
<a class="cta" href="/?map=${esc(map.id)}">Open ${esc(map.name)} in the interactive map</a>
${sections || `<p class="lede">No official lineups for ${esc(map.name)} yet — check back soon.</p>`}
<h2>Other maps</h2>
<p>${otherMaps} · <a href="/maps">All maps</a></p>`;

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
<h3>Throw ${i + 1} of ${lineup.throws.length}</h3>
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
<ul class="plain">
${related.map(l => {
    const t = C.TYPES.find(x => x.id === l.type);
    const label = t ? t.label : l.type;
    return `<li><a href="${esc(lineupPath(l))}">${esc(lineupDisplayName(l, label))}</a><span class="sub">${esc(label)}</span></li>`;
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
<h1>${esc(displayName)}</h1>
<p class="lede">${esc(map.name)} · ${esc(type.label)} · ${lineup.throws.length} throw${lineup.throws.length === 1 ? "" : "s"} — official Lineupr lineup with screenshots and technique for each throw.</p>
<a class="cta" href="/?map=${esc(map.id)}&amp;lineup=${esc(lineup.id)}">Open in interactive map</a>
${throwsHtml}
${relatedHtml}
<h2>Browse more</h2>
<p><a href="/${esc(map.id)}">All ${esc(map.name)} lineups</a> · <a href="/maps">All maps</a></p>`;

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

// ------------------------------------------------------------------ 404 ---
function notFound(res) {
  sendHtml(res, 404, layout({
    title: "Page not found | Lineupr",
    description: "This lineup or map page does not exist.",
    path: "/maps",
    body: `<h1>Page not found</h1><p class="lede">This lineup or map doesn't exist (it may have been removed).</p><p><a href="/maps">Browse all maps</a> or <a href="/">open the interactive map</a>.</p>`,
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
