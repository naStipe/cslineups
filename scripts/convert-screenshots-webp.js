// One-off: re-encode existing lineup screenshots (PNG/JPEG) to WebP.
//
// New uploads are already compressed in the browser (js/image-upload.js);
// this converts what was uploaded before that. For every image referenced
// by a lineup's throws (screenshots, standing, precise, result) it:
//   1. downloads the original from R2,
//   2. re-encodes it to WebP (quality 82, max 1920px, never upscaled),
//   3. with --apply: uploads `<name>.webp` next to the original, then
//      rewrites the URL in every lineup row that references it.
// Originals are never deleted, so a rollback is just pointing the rows back.
// An image is skipped when WebP would not be smaller.
//
// Usage (from the repo root, needs .env with Supabase + R2 credentials):
//   npm i --no-save sharp
//   node scripts/convert-screenshots-webp.js                 # dry run (default): report only
//   node scripts/convert-screenshots-webp.js --apply         # upload WebPs + update rows
//   node scripts/convert-screenshots-webp.js --rollback <log.json>
// Options: --official-only, --limit <n> (first n images, for a quick sample)
//
// --apply writes a JSON log of every URL it changed (old -> new) to the OS
// temp dir; pass that file to --rollback to restore the original URLs.
const fs = require("fs");
const os = require("os");
const path = require("path");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

let sharp;
try { sharp = require("sharp"); } catch {
  console.error("sharp is not installed. Run: npm i --no-save sharp");
  process.exit(1);
}
const { createClient } = require("@supabase/supabase-js");
const { GetObjectCommand, PutObjectCommand } = require("@aws-sdk/client-s3");
const r2 = require("../api/_lib/r2");

const MAX_DIM = 1920;
const WEBP_QUALITY = 82;
const CONCURRENCY = 4;
const SLOTS = ["screenshots", "standing", "precise", "result"];
const CONVERTIBLE = /\.(png|jpe?g)$/i;

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const OFFICIAL_ONLY = args.includes("--official-only");
const limitIdx = args.indexOf("--limit");
const LIMIT = limitIdx >= 0 ? Number(args[limitIdx + 1]) : Infinity;
const rollbackIdx = args.indexOf("--rollback");
const ROLLBACK_LOG = rollbackIdx >= 0 ? args[rollbackIdx + 1] : null;

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const publicBase = `${r2.PUBLIC_BASE_URL()}/`;
const PRIVATE_PREFIX = "/api/private-image?path=";

// Same two URL shapes api/lineups.js accepts. Anything else is left alone.
function parseUrl(url) {
  if (typeof url !== "string") return null;
  if (url.startsWith(publicBase)) {
    const key = url.slice(publicBase.length);
    return { bucket: r2.PUBLIC_BUCKET(), key, isPrivate: false };
  }
  if (url.startsWith(PRIVATE_PREFIX)) {
    const key = decodeURIComponent(url.slice(PRIVATE_PREFIX.length));
    if (!r2.parsePrivateKey(key)) return null;
    return { bucket: r2.PRIVATE_BUCKET(), key, isPrivate: true };
  }
  return null;
}

function webpUrl(url) {
  return url.replace(CONVERTIBLE, ".webp");
}

function throwUrls(t) {
  const out = [];
  for (const slot of SLOTS) {
    const v = t[slot];
    if (Array.isArray(v)) out.push(...v);
    else if (v) out.push(v);
  }
  return out;
}

function mapThrowUrls(throws, mapping) {
  let changed = false;
  const next = throws.map((t) => {
    const nt = { ...t };
    for (const slot of SLOTS) {
      const v = nt[slot];
      if (Array.isArray(v)) {
        nt[slot] = v.map((u) => (mapping.has(u) ? (changed = true, mapping.get(u)) : u));
      } else if (v && mapping.has(v)) {
        nt[slot] = mapping.get(v);
        changed = true;
      }
    }
    return nt;
  });
  return { next, changed };
}

async function fetchAllLineups() {
  const rows = [];
  const PAGE = 500;
  for (let from = 0; ; from += PAGE) {
    let q = sb.from("lineups").select("id, name, map_id, is_official, throws").order("id").range(from, from + PAGE - 1);
    if (OFFICIAL_ONLY) q = q.eq("is_official", true);
    const { data, error } = await q;
    if (error) throw error;
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return rows;
}

async function download(bucket, key) {
  const res = await r2.client().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return Buffer.from(await res.Body.transformToByteArray());
}

async function encode(buf) {
  return sharp(buf)
    .rotate()
    .resize({ width: MAX_DIM, height: MAX_DIM, fit: "inside", withoutEnlargement: true })
    .webp({ quality: WEBP_QUALITY, effort: 5 })
    .toBuffer({ resolveWithObject: true });
}

async function upload(bucket, key, body, isPrivate) {
  await r2.client().send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: "image/webp",
    CacheControl: isPrivate ? "private, max-age=31536000, immutable" : "public, max-age=31536000, immutable",
  }));
}

// Runs fn over items with a fixed number of workers.
async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const idx = i++; await fn(items[idx], idx); }
  }));
}

const kb = (n) => `${Math.round(n / 1024)} KB`;
const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;

// Re-reads each row just before writing, so an edit made while the script
// ran isn't overwritten with stale throws.
async function rewriteRows(rowIds, mapping) {
  let updated = 0;
  for (const id of rowIds) {
    const { data: row, error } = await sb.from("lineups").select("id, throws").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!row || !Array.isArray(row.throws)) continue;
    const { next, changed } = mapThrowUrls(row.throws, mapping);
    if (!changed) continue;
    const { error: updErr } = await sb.from("lineups").update({ throws: next }).eq("id", id);
    if (updErr) throw updErr;
    updated++;
  }
  return updated;
}

async function rollback(logFile) {
  const log = JSON.parse(fs.readFileSync(logFile, "utf8"));
  const reverse = new Map(log.converted.map((c) => [c.newUrl, c.oldUrl]));
  console.log(`Rolling back ${reverse.size} URLs across ${log.rowIds.length} lineups...`);
  const updated = await rewriteRows(log.rowIds, reverse);
  console.log(`Done. ${updated} lineups restored. The .webp files stay in R2.`);
}

async function main() {
  if (ROLLBACK_LOG) return rollback(ROLLBACK_LOG);

  console.log(`Mode: ${APPLY ? "APPLY (writes to R2 and the lineups table)" : "DRY RUN (no writes)"}`);
  const rows = await fetchAllLineups();

  // url -> { parsed, rowIds:Set }
  const images = new Map();
  let skippedFormat = 0, skippedForeign = 0;
  for (const row of rows) {
    for (const t of row.throws || []) {
      for (const url of throwUrls(t)) {
        const parsed = parseUrl(url);
        if (!parsed) { skippedForeign++; continue; }
        if (!CONVERTIBLE.test(parsed.key)) { skippedFormat++; continue; }
        if (!images.has(url)) images.set(url, { parsed, rowIds: new Set() });
        images.get(url).rowIds.add(row.id);
      }
    }
  }
  const list = [...images.entries()].slice(0, LIMIT);
  console.log(`${rows.length} lineups, ${images.size} PNG/JPEG images` +
    (list.length < images.size ? ` (processing first ${list.length})` : "") +
    `; skipped ${skippedFormat} already WebP/GIF, ${skippedForeign} unrecognised URLs.`);

  const results = [];
  let done = 0;
  await pool(list, CONCURRENCY, async ([url, { parsed, rowIds }]) => {
    try {
      const original = await download(parsed.bucket, parsed.key);
      const { data: webp, info } = await encode(original);
      const r = { url, newUrl: webpUrl(url), parsed, rowIds, before: original.length, after: webp.length, dims: `${info.width}x${info.height}` };
      if (webp.length >= original.length) r.skip = "WebP not smaller";
      else if (APPLY) await upload(parsed.bucket, parsed.key.replace(CONVERTIBLE, ".webp"), webp, parsed.isPrivate);
      results.push(r);
    } catch (err) {
      results.push({ url, error: String(err && err.message || err) });
    }
    done++;
    if (done % 10 === 0 || done === list.length) process.stdout.write(`  processed ${done}/${list.length}\r`);
  });
  console.log();

  const ok = results.filter((r) => !r.error && !r.skip);
  const errors = results.filter((r) => r.error);
  const notSmaller = results.filter((r) => r.skip);
  const before = ok.reduce((s, r) => s + r.before, 0);
  const after = ok.reduce((s, r) => s + r.after, 0);

  console.log("\nLargest savings:");
  for (const r of [...ok].sort((a, b) => (b.before - b.after) - (a.before - a.after)).slice(0, 10)) {
    console.log(`  ${r.parsed.key.padEnd(48)} ${kb(r.before).padStart(8)} -> ${kb(r.after).padStart(7)}  ${r.dims}${r.parsed.isPrivate ? "  (private)" : ""}`);
  }
  console.log(`\nConvert: ${ok.length} images (${ok.filter((r) => !r.parsed.isPrivate).length} public, ${ok.filter((r) => r.parsed.isPrivate).length} private)`);
  console.log(`Size:    ${mb(before)} -> ${mb(after)} (${before ? Math.round((1 - after / before) * 100) : 0}% smaller)`);
  console.log(`Rows to update: ${new Set(ok.flatMap((r) => [...r.rowIds])).size} lineups`);
  if (notSmaller.length) console.log(`Kept as-is (WebP not smaller): ${notSmaller.length}`);
  if (errors.length) {
    console.log(`Errors: ${errors.length}`);
    for (const e of errors.slice(0, 10)) console.log(`  ${e.url}: ${e.error}`);
  }

  if (!APPLY) { console.log("\nDry run only. Nothing was written. Re-run with --apply to convert."); return; }

  const mapping = new Map(ok.map((r) => [r.url, r.newUrl]));
  const rowIds = [...new Set(ok.flatMap((r) => [...r.rowIds]))];
  const logFile = path.join(os.tmpdir(), `webp-migration-${Date.now()}.json`);
  fs.writeFileSync(logFile, JSON.stringify({
    at: new Date().toISOString(),
    rowIds,
    converted: ok.map((r) => ({ oldUrl: r.url, newUrl: r.newUrl, before: r.before, after: r.after })),
  }, null, 2));
  console.log(`\nLog written to ${logFile} (use with --rollback).`);
  const updated = await rewriteRows(rowIds, mapping);
  console.log(`Updated ${updated} lineups. Originals are still in R2.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
