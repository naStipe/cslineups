import { authUser, getAccessToken } from "./auth.js";
import { preciseInput, preciseThumbWrap, screenshotInput, standingInput, standingThumbGrid, thumbGrid } from "./dom.js";
import { escapeHtml } from "./html-utils.js";
import { hydrateImages } from "./private-images.js";
import { pendingThrowDraft } from "./throw-modal.js";

export const MAX_SCREENSHOTS = 5;

export const MAX_STANDING = 3;

// Client-side guardrails only — a determined attacker can call
// /api/upload-url directly and skip this file entirely, so the real
// enforcement has to live server-side (api/upload-url.js re-checks both the
// MIME type and, for official uploads, admin status). This just stops
// honest users from accidentally uploading huge or non-image files, and
// gives a clear error instead of a confusing server-side failure.
const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // 15 MB

// Official lineups are admin-curated and meant to be visible to every
// visitor, so their images go to the public R2 bucket and get a permanent,
// unauthenticated URL back. Personal lineups are private to their owner, so
// their images go to a separate, non-public bucket under a per-user key —
// resolved later through /api/private-image (see private-images.js), never
// used directly as an <img src>.
//
// R2 has no per-object RLS the way Supabase Storage did, so the upload
// itself is two steps: ask our own API for a presigned R2 POST (which is
// where the isOfficial/admin check, the MIME allow-list, and the hard size
// cap are actually enforced), then POST the bytes straight to R2 with it.
// This also sidesteps Vercel's serverless function body-size limit, which
// is well under the 15MB this app allows — the image bytes never pass
// through our API.
//
// A presigned POST (not PUT) is what lets R2 itself reject an oversized
// upload by signature — Supabase's old bucket settings enforced a hard
// file-size limit independent of the client, and a plain presigned PUT URL
// has no way to replicate that (only POST's content-length-range
// condition does).
export async function uploadFile(file, isOfficial) {
  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    throw new Error(`"${file.type || "unknown"}" isn't a supported image type. Use JPEG, PNG, WEBP, or GIF.`);
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(`That file is too large (max ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB).`);
  }

  const token = await getAccessToken();
  if (!token) throw new Error("You need to be signed in to upload images.");
  if (!isOfficial && !authUser) throw new Error("You need to be signed in to upload images.");

  const blob = await maybeResize(file);

  const presignRes = await fetch("/api/upload-url", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ isOfficial: !!isOfficial, contentType: blob.type }),
  });
  if (!presignRes.ok) {
    const err = await presignRes.json().catch(() => ({}));
    throw new Error(`Image upload failed (${presignRes.status}): ${err.error || "could not get an upload URL"}`);
  }
  const { url, fields, publicUrl } = await presignRes.json();

  const form = new FormData();
  Object.entries(fields).forEach(([k, v]) => form.append(k, v));
  form.append("file", blob); // must be appended last — R2/S3 ignores fields after the file part

  const putRes = await fetch(url, { method: "POST", body: form });
  if (!putRes.ok) {
    const err = await putRes.text().catch(() => "");
    throw new Error(`Image upload failed (${putRes.status}): ${err}`);
  }

  return publicUrl;
}

export async function uploadDataUrl(dataUrl, isOfficial) {
  if (!dataUrl || !dataUrl.startsWith("data:")) return dataUrl; // already a URL
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return dataUrl;
  const [, mime, b64] = match;
  const buf = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const blob = new Blob([buf], { type: mime });
  return uploadFile(blob, isOfficial);
}

export async function maybeResize(file) {
  if (file.size < 5 * 1024 * 1024) return file;
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const MAX_DIM = 1920;
        let { width, height } = img;
        if (width > MAX_DIM || height > MAX_DIM) {
          const scale = MAX_DIM / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        const isPng = file.type === "image/png";
        canvas.toBlob(resolve, isPng ? "image/png" : "image/jpeg", 0.98);
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Thumbnails here can hold either a fresh local data: URI (just picked,
// not uploaded yet — used as-is) or an already-uploaded storage URL (when
// editing an existing throw's images), which may be a private one that
// needs an authenticated fetch. data-real-src + hydrateImages handles
// both cases the same way; passthrough is instant for data: URIs.
export function renderThumbGrid() {
  thumbGrid.innerHTML = "";
  (pendingThrowDraft.screenshots || []).forEach((src, i) => {
    const t = document.createElement("div");
    t.className = "thumb";
    t.innerHTML = `<img data-real-src="${escapeHtml(src)}"><button class="thumb-remove" type="button">✕</button>`;
    t.querySelector(".thumb-remove").onclick = () => {
      pendingThrowDraft.screenshots.splice(i, 1);
      renderThumbGrid();
    };
    thumbGrid.appendChild(t);
  });
  hydrateImages(thumbGrid);
}

export function renderPreciseThumb() {
  preciseThumbWrap.innerHTML = "";
  if (!pendingThrowDraft.precise) return;
  const t = document.createElement("div");
  t.className = "thumb";
  t.innerHTML = `<img data-real-src="${escapeHtml(pendingThrowDraft.precise)}"><button class="thumb-remove" type="button">✕</button>`;
  t.querySelector(".thumb-remove").onclick = () => {
    pendingThrowDraft.precise = null;
    renderPreciseThumb();
  };
  preciseThumbWrap.appendChild(t);
  hydrateImages(preciseThumbWrap);
}

export function renderStandingThumbGrid() {
  standingThumbGrid.innerHTML = "";
  (pendingThrowDraft.standing || []).forEach((src, i) => {
    const t = document.createElement("div");
    t.className = "thumb";
    t.innerHTML = `<img data-real-src="${escapeHtml(src)}"><button class="thumb-remove" type="button">✕</button>`;
    t.querySelector(".thumb-remove").onclick = () => {
      pendingThrowDraft.standing.splice(i, 1);
      renderStandingThumbGrid();
    };
    standingThumbGrid.appendChild(t);
  });
  hydrateImages(standingThumbGrid);
}

standingInput.onchange = async () => {
  const files = Array.from(standingInput.files || []);
  standingInput.value = "";
  if (!files.length) return;
  const room = MAX_STANDING - pendingThrowDraft.standing.length;
  const toAdd = files.slice(0, Math.max(room, 0));
  if (!toAdd.length) return;
  const dataUrls = await Promise.all(toAdd.map(readAsDataUrl));
  pendingThrowDraft.standing.push(...dataUrls);
  renderStandingThumbGrid();
};

screenshotInput.onchange = async () => {
  const files = Array.from(screenshotInput.files || []);
  screenshotInput.value = "";
  if (!files.length) return;
  const room = MAX_SCREENSHOTS - pendingThrowDraft.screenshots.length;
  const toAdd = files.slice(0, Math.max(room, 0));
  if (!toAdd.length) return;
  const dataUrls = await Promise.all(toAdd.map(readAsDataUrl));
  pendingThrowDraft.screenshots.push(...dataUrls);
  renderThumbGrid();
};

preciseInput.onchange = async () => {
  const file = preciseInput.files[0];
  preciseInput.value = "";
  if (!file) return;
  pendingThrowDraft.precise = await readAsDataUrl(file);
  renderPreciseThumb();
};
