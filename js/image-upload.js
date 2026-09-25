import { authUser, getAccessToken } from "./auth.js";
import { preciseInput, preciseThumbWrap, resultInput, resultThumbWrap, screenshotInput, standingInput, standingThumbGrid, thumbGrid } from "./dom.js";
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
// itself is two steps: ask our own API for a presigned R2 PUT (which is
// where the isOfficial/admin check, the MIME allow-list, and the size
// check are actually enforced), then PUT the bytes straight to R2 with it.
// This also sidesteps Vercel's serverless function body-size limit, which
// is well under the 15MB this app allows — the image bytes never pass
// through our API.
//
// PUT, not POST: R2's S3-compatible API doesn't implement the S3
// "POST Object" operation at all — every presigned-POST upload gets a flat
// 501 Not Implemented straight from R2, regardless of config. A presigned
// PUT has no equivalent of POST's content-length-range condition, so
// unlike Supabase Storage's old bucket-level file-size limit, R2 itself
// can't reject an oversized upload by signature anymore — size is now
// enforced by the checks in this file and in api/upload-url.js instead.
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
    body: JSON.stringify({ isOfficial: !!isOfficial, contentType: blob.type, contentLength: blob.size }),
  });
  if (!presignRes.ok) {
    const err = await presignRes.json().catch(() => ({}));
    throw new Error(`Image upload failed (${presignRes.status}): ${err.error || "could not get an upload URL"}`);
  }
  const { url, publicUrl, filename } = await presignRes.json();

  // Content-Type here must match exactly what api/upload-url.js signed
  // (blob.type, same value sent as contentType above) — R2 checks it
  // against the presigned signature and rejects a mismatch.
  const putRes = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": blob.type },
    body: blob,
  });
  if (!putRes.ok) {
    const err = await putRes.text().catch(() => "");
    throw new Error(`Image upload failed (${putRes.status}): ${err}`);
  }

  // A presigned PUT can't enforce the size cap by signature (R2 limitation
  // — see api/upload-url.js), so this second call checks the object's real
  // stored size server-side and deletes it if the client lied about
  // contentLength in the presign step.
  const confirmRes = await fetch("/api/upload-url", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action: "confirm", isOfficial: !!isOfficial, filename }),
  });
  if (!confirmRes.ok) {
    const err = await confirmRes.json().catch(() => ({}));
    throw new Error(err.error || `Image upload failed (${confirmRes.status})`);
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
//
// Each category's thumbs are also draggable, so a picture can be moved
// between categories (or reordered within one) by dropping it on another
// thumb or on empty grid space. CATS below is the single source of truth
// for how each category stores its image(s) and how to re-render it after
// a move; setupDropZone (bottom of file) wires the actual drag events.
const CATS = {
  standing:    { kind: "array",  max: MAX_STANDING,    label: "Standing spot", render: () => renderStandingThumbGrid(), el: () => standingThumbGrid },
  screenshots: { kind: "array",  max: MAX_SCREENSHOTS, label: "Throw screenshots", render: () => renderThumbGrid(), el: () => thumbGrid },
  precise:     { kind: "single", label: "Precise aim", render: () => renderPreciseThumb(), el: () => preciseThumbWrap },
  result:      { kind: "single", label: "Result", render: () => renderResultThumb(), el: () => resultThumbWrap },
};

function extractImage(cat, idx) {
  const meta = CATS[cat];
  if (meta.kind === "array") return pendingThrowDraft[cat].splice(idx, 1)[0];
  const v = pendingThrowDraft[cat];
  pendingThrowDraft[cat] = null;
  return v;
}

function insertImage(cat, value, idx) {
  const meta = CATS[cat];
  if (meta.kind === "array") {
    const arr = pendingThrowDraft[cat];
    arr.splice(idx == null ? arr.length : Math.min(idx, arr.length), 0, value);
  } else {
    pendingThrowDraft[cat] = value;
  }
}

function moveImage(fromCat, fromIdx, toCat, toIdx) {
  if (fromCat === toCat && fromIdx === toIdx) return;
  const moving = extractImage(fromCat, fromIdx);
  if (moving == null) return;

  const toMeta = CATS[toCat];
  if (toMeta.kind === "array" && fromCat !== toCat && pendingThrowDraft[toCat].length >= toMeta.max) {
    insertImage(fromCat, moving, fromIdx); // no room at destination — put it back
    alert(`${toMeta.label} already has the max of ${toMeta.max} images.`);
  } else if (toMeta.kind === "single") {
    const bumped = pendingThrowDraft[toCat];
    pendingThrowDraft[toCat] = moving;
    if (bumped != null) insertImage(fromCat, bumped, fromIdx); // swap the displaced image back
  } else {
    insertImage(toCat, moving, fromCat === toCat && fromIdx < toIdx ? toIdx - 1 : toIdx);
  }

  CATS[fromCat].render();
  if (toCat !== fromCat) CATS[toCat].render();
}

function makeThumb(src, cat, idx, onRemove) {
  const t = document.createElement("div");
  t.className = "thumb";
  t.draggable = true;
  t.dataset.cat = cat;
  t.dataset.idx = idx;
  t.innerHTML = `<img data-real-src="${escapeHtml(src)}"><button class="thumb-remove" type="button">✕</button>`;
  t.querySelector(".thumb-remove").onclick = onRemove;
  t.addEventListener("dragstart", (e) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", `${cat}:${idx}`);
    t.classList.add("dragging");
  });
  t.addEventListener("dragend", () => t.classList.remove("dragging"));
  return t;
}

let dropZonesReady = false;
function setupDropZones() {
  if (dropZonesReady) return;
  dropZonesReady = true;
  Object.keys(CATS).forEach(cat => {
    const el = CATS[cat].el();
    if (!el) return;
    el.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      el.classList.add("drag-over");
    });
    el.addEventListener("dragleave", (e) => {
      if (!el.contains(e.relatedTarget)) el.classList.remove("drag-over");
    });
    el.addEventListener("drop", (e) => {
      e.preventDefault();
      el.classList.remove("drag-over");
      const data = e.dataTransfer.getData("text/plain");
      if (!data) return;
      const [fromCat, fromIdxStr] = data.split(":");
      if (!CATS[fromCat]) return;
      const targetThumb = e.target.closest(".thumb");
      const toIdx = targetThumb ? Number(targetThumb.dataset.idx) : null;
      moveImage(fromCat, Number(fromIdxStr), cat, toIdx);
    });
  });
}

export function renderThumbGrid() {
  thumbGrid.innerHTML = "";
  (pendingThrowDraft.screenshots || []).forEach((src, i) => {
    thumbGrid.appendChild(makeThumb(src, "screenshots", i, () => {
      pendingThrowDraft.screenshots.splice(i, 1);
      renderThumbGrid();
    }));
  });
  hydrateImages(thumbGrid);
  setupDropZones();
}

export function renderPreciseThumb() {
  preciseThumbWrap.innerHTML = "";
  if (!pendingThrowDraft.precise) return;
  preciseThumbWrap.appendChild(makeThumb(pendingThrowDraft.precise, "precise", 0, () => {
    pendingThrowDraft.precise = null;
    renderPreciseThumb();
  }));
  hydrateImages(preciseThumbWrap);
  setupDropZones();
}

export function renderResultThumb() {
  resultThumbWrap.innerHTML = "";
  if (!pendingThrowDraft.result) return;
  resultThumbWrap.appendChild(makeThumb(pendingThrowDraft.result, "result", 0, () => {
    pendingThrowDraft.result = null;
    renderResultThumb();
  }));
  hydrateImages(resultThumbWrap);
  setupDropZones();
}

export function renderStandingThumbGrid() {
  standingThumbGrid.innerHTML = "";
  (pendingThrowDraft.standing || []).forEach((src, i) => {
    standingThumbGrid.appendChild(makeThumb(src, "standing", i, () => {
      pendingThrowDraft.standing.splice(i, 1);
      renderStandingThumbGrid();
    }));
  });
  hydrateImages(standingThumbGrid);
  setupDropZones();
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

resultInput.onchange = async () => {
  const file = resultInput.files[0];
  resultInput.value = "";
  if (!file) return;
  pendingThrowDraft.result = await readAsDataUrl(file);
  renderResultThumb();
};
