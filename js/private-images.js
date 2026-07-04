import { getAccessToken } from "./auth.js";

// In-memory cache so the same private image isn't re-fetched every time
// it's shown again (carousel navigation, reopening the same lineup,
// switching maps and back). Blob URLs are cheap to keep for the page's
// lifetime; we don't bother revoking them since this is a small app and
// the count stays modest for a single session.
const blobUrlCache = new Map();

function isPrivateStorageUrl(url) {
  return typeof url === "string" && url.includes("/object/authenticated/");
}

// Personal-lineup images live in a private Supabase Storage bucket and
// can only be fetched with the viewer's own auth token — a plain
// <img src="..."> can't attach that header, so this downloads the bytes
// ourselves and hands back a local blob: URL for the <img> to point at
// instead. Official-lineup images are still plain public URLs and pass
// straight through untouched, same for local data: URIs (still-unsaved
// drafts) and anything else.
export async function resolveImageSrc(url) {
  if (!url || !isPrivateStorageUrl(url)) return url || "";
  if (blobUrlCache.has(url)) return blobUrlCache.get(url);

  const token = await getAccessToken();
  if (!token) return ""; // signed out (or session expired) — nothing to show

  let res;
  try {
    res = await fetch(url, {
      headers: {
        "Authorization": `Bearer ${token}`,
        "apikey": window.__SUPABASE_ANON_KEY,
      },
    });
  } catch {
    return "";
  }
  if (!res.ok) return "";

  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  blobUrlCache.set(url, objectUrl);
  return objectUrl;
}

// Finds every <img data-real-src="..."> under `root` (freshly built via
// innerHTML, so nothing has actually started loading yet) and resolves +
// assigns each one's real src. Call this right after inserting any HTML
// block that might contain a personal-lineup image.
export async function hydrateImages(root) {
  const imgs = root.querySelectorAll("img[data-real-src]");
  await Promise.all([...imgs].map(async (img) => {
    img.src = await resolveImageSrc(img.dataset.realSrc);
  }));
}
