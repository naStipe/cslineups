import { authUser, getAccessToken } from "./auth.js";
import { preciseInput, preciseThumbWrap, resultInput, resultThumbWrap, screenshotInput, standingInput, standingThumbGrid, thumbGrid, tmUploadSummary } from "./dom.js";
import { escapeHtml } from "./html-utils.js";
import { hydrateImages } from "./private-images.js";
import { markThrowDraftDirty, pendingThrowDraft } from "./throw-modal.js";
import { toast, toastError } from "./toast.js";

export const MAX_SCREENSHOTS = 5;

export const MAX_STANDING = 3;

// Client-side guardrails only — a determined attacker can call
// /api/upload-url directly and skip this file entirely, so the real
// enforcement lives server-side (api/upload-url.js re-checks the MIME type
// and, for official uploads, admin status; api/lineups.js HEADs every newly
// referenced object at save time and rejects anything over the cap). This
// just stops honest users from accidentally uploading huge or non-image
// files, and gives a clear error instead of a confusing server failure.
const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // 15 MB

// Official lineups are admin-curated and meant to be visible to every
// visitor, so their images go to the public R2 bucket and get a permanent,
// unauthenticated URL back. Personal lineups are private to their owner, so
// their images go to a separate, non-public bucket under a per-user key —
// resolved later through /api/private-image (see private-images.js), never
// used directly as an <img src>. That's why a draft's isOfficial has to be
// settled before the first byte is uploaded (js/throw-modal.js decides it
// when the modal opens).
//
// R2 has no per-object RLS the way Supabase Storage did, so an upload is:
// ask our own API for presigned R2 PUTs (where the isOfficial/admin check
// and the MIME allow-list are enforced), then PUT the bytes straight to R2.
// This also sidesteps Vercel's serverless body-size limit, which is well
// under the 15MB this app allows — the image bytes never pass through our
// API.
//
// PUT, not POST: R2's S3-compatible API doesn't implement "POST Object" at
// all (every presigned-POST upload gets a flat 501), and a presigned PUT has
// no content-length-range condition, so the size cap is checked against the
// stored object when the lineup is saved (see api/_lib/uploads.js).
//
// ── Background uploads ──────────────────────────────────────────────────
// Saving used to start compressing and uploading every image only after
// Save was clicked (3 API round trips per image, compression on the main
// thread). Now each image starts the moment it is added (picked, pasted or
// dropped): compress in a worker → one batched presign for everything added
// together → XHR PUT with progress. Save only waits for whatever is still in
// flight, then writes the row.
//
// Draft image values (pendingThrowDraft.standing/screenshots arrays and the
// precise/result singles) are either:
//  - a plain string: an already-stored URL (editing an existing throw), or
//  - an upload item: { id, file, previewUrl, status, progress, url,
//    filename, error, isOfficial } where status is
//    "compressing" | "uploading" | "done" | "error".
// imageUrlOf() turns either into what gets saved.

export function isUploadItem(v) {
  return !!v && typeof v === "object";
}

export function imageUrlOf(v) {
  return isUploadItem(v) ? v.url : v;
}

// Every upload item in a draft, in slot order.
export function draftItems(draft) {
  if (!draft) return [];
  return [...draft.standing, ...draft.screenshots, draft.precise, draft.result].filter(isUploadItem);
}

// ── Compression ─────────────────────────────────────────────────────────
// Every upload is re-encoded before it leaves the browser: game screenshots
// arrive as 2-4 MB PNGs, which made opening one lineup cost ~12 MB. WebP at
// q0.82 and max 1920px keeps them sharp at ~150-300 KB. Browsers that can't
// encode WebP from a canvas (older Safari hands back a PNG instead) fall
// back to JPEG. GIFs pass through untouched so animation survives, and the
// original is kept whenever re-encoding wouldn't make it smaller.
// The work runs in js/image-worker.js (same rules); compressImage below is
// the main-thread fallback for browsers without OffscreenCanvas in workers.
const MAX_DIM = 1920;
const WEBP_QUALITY = 0.82;
const JPEG_QUALITY = 0.85;

function canvasToBlob(canvas, type, quality) {
  return new Promise(resolve => canvas.toBlob(resolve, type, quality));
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not read that image.")); };
    img.src = url;
  });
}

export async function compressImage(file) {
  if (file.type === "image/gif") return file;
  const img = await loadImage(file);
  let width = img.naturalWidth, height = img.naturalHeight;
  if (width > MAX_DIM || height > MAX_DIM) {
    const scale = MAX_DIM / Math.max(width, height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  canvas.getContext("2d").drawImage(img, 0, 0, width, height);

  let blob = await canvasToBlob(canvas, "image/webp", WEBP_QUALITY);
  if (!blob || blob.type !== "image/webp") blob = await canvasToBlob(canvas, "image/jpeg", JPEG_QUALITY);
  if (!blob) return file;
  const resized = width !== img.naturalWidth;
  return blob.size < file.size || resized ? blob : file;
}

// A small pool of module workers (decode + encode is CPU-bound, so a couple
// in parallel helps on multi-core machines). Created lazily, reused for the
// page's lifetime. If workers or OffscreenCanvas aren't available, or a
// worker fails to start, everything falls back to compressImage.
const workerSupported = typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined" &&
  typeof OffscreenCanvas.prototype.convertToBlob === "function" && typeof createImageBitmap === "function";
let pool = null;
let poolBroken = false;
let jobSeq = 0;
const jobs = new Map(); // id -> { resolve, reject, worker }

function getPool() {
  if (pool || poolBroken || !workerSupported) return pool;
  const size = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 2) - 1));
  try {
    pool = [];
    for (let i = 0; i < size; i++) {
      const w = new Worker(new URL("./image-worker.js", import.meta.url), { type: "module" });
      w.busy = 0;
      w.onmessage = (e) => {
        const job = jobs.get(e.data.id);
        if (!job) return;
        jobs.delete(e.data.id);
        w.busy--;
        if (e.data.error) job.reject(new Error(e.data.error));
        else job.resolve(e.data.blob);
      };
      // A worker that can't even start (no module-worker support, CSP)
      // fails every job it holds; those jobs and all later ones go through
      // the main-thread path instead.
      w.onerror = (ev) => {
        ev.preventDefault();
        poolBroken = true;
        for (const [id, job] of jobs) if (job.worker === w) { jobs.delete(id); job.fallback(); }
      };
      pool.push(w);
    }
  } catch {
    poolBroken = true;
    pool = null;
  }
  return pool;
}

function compressInWorker(file) {
  const workers = getPool();
  if (!workers || poolBroken) return compressImage(file);
  const w = workers.reduce((a, b) => (b.busy < a.busy ? b : a));
  return new Promise((resolve, reject) => {
    const id = ++jobSeq;
    const fallback = () => compressImage(file).then(resolve, reject);
    jobs.set(id, { resolve, reject, worker: w, fallback });
    w.busy++;
    w.postMessage({ id, file, maxDim: MAX_DIM, webpQuality: WEBP_QUALITY, jpegQuality: JPEG_QUALITY });
  });
}

async function compressForUpload(file) {
  if (file.type === "image/gif") return file;
  const t0 = performance.now();
  const blob = await compressInWorker(file);
  // User Timing mark, so the cost is visible in DevTools' Performance panel.
  try { performance.measure("lineupr:compress", { start: t0, end: performance.now() }); } catch {}
  return blob;
}

// ── Presign batching ────────────────────────────────────────────────────
// Images added together (a multi-select, several drops) share one presign
// request: an item that finishes compressing waits briefly while siblings
// are still compressing, then everything queued goes out as one
// { files: [...] } call (max 10 per request, same as the server).
const PRESIGN_BATCH = 10;
const PRESIGN_WAIT_MS = 250;
let presignQueue = [];
let presignTimer = null;
let compressingCount = 0;

function queuePresign(item, blob) {
  return new Promise((resolve, reject) => {
    presignQueue.push({ item, blob, resolve, reject });
    schedulePresign();
  });
}

function schedulePresign() {
  clearTimeout(presignTimer);
  if (!presignQueue.length) return;
  presignTimer = setTimeout(flushPresign, compressingCount > 0 ? PRESIGN_WAIT_MS : 0);
}

async function flushPresign() {
  const queue = presignQueue;
  presignQueue = [];
  const groups = new Map(); // isOfficial -> entries
  for (const entry of queue) {
    const key = !!entry.item.isOfficial;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  for (const [isOfficial, entries] of groups) {
    for (let i = 0; i < entries.length; i += PRESIGN_BATCH) {
      presignChunk(isOfficial, entries.slice(i, i + PRESIGN_BATCH));
    }
  }
}

async function presignChunk(isOfficial, entries) {
  try {
    const token = await getAccessToken();
    if (!token) throw new Error("Sign in to upload images.");
    const res = await fetch("/api/upload-url", {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        isOfficial,
        files: entries.map(e => ({ contentType: e.blob.type, contentLength: e.blob.size })),
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Could not get an upload URL (${res.status})`);
    }
    const { uploads } = await res.json();
    entries.forEach((e, i) => e.resolve(uploads[i]));
  } catch (err) {
    entries.forEach(e => e.reject(err));
  }
}

// PUT straight to R2 with XMLHttpRequest rather than fetch: fetch can't
// report upload progress, and the thumb ring is driven by upload.onprogress.
// Content-Type must match exactly what was presigned (the blob's type, sent
// as contentType) — R2 checks it against the signature.
function putWithProgress(item, url, blob) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    item.xhr = xhr;
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", blob.type);
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      item.progress = e.loaded / e.total;
      updateItemUi(item);
    };
    xhr.onload = () => {
      item.xhr = null;
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => { item.xhr = null; reject(new Error("Network error while uploading")); };
    xhr.onabort = () => { item.xhr = null; reject(new Error("cancelled")); };
    xhr.send(blob);
  });
}

// ── Item lifecycle ──────────────────────────────────────────────────────
let itemSeq = 0;

function guessType(file) {
  if (file.type) return file.type;
  const ext = (file.name || "").toLowerCase().split(".").pop();
  return { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" }[ext] || "";
}

// Validates a picked/pasted/dropped file. Returns an error string or null.
function fileProblem(file) {
  const type = guessType(file);
  if (!ALLOWED_MIME_TYPES.includes(type)) return `"${file.name || type || "That file"}" isn't a supported image. Use PNG, JPEG, WEBP or GIF.`;
  if (file.size > MAX_UPLOAD_BYTES) return `That image is too large (max ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB).`;
  return null;
}

function createItem(file, isOfficial) {
  const type = guessType(file);
  const f = file.type === type ? file : new File([file], file.name || "image", { type });
  return {
    id: `up${++itemSeq}`,
    file: f,
    previewUrl: URL.createObjectURL(f),
    status: "compressing",
    progress: 0,
    url: null,
    filename: null,
    error: null,
    isOfficial: !!isOfficial,
    blob: null,
    cancelled: false,
    promise: null,
    xhr: null,
  };
}

function startUpload(item) {
  item.status = "compressing";
  item.progress = 0;
  item.error = null;
  updateItemUi(item);
  item.promise = (async () => {
    if (!authUser) throw new Error("Sign in to upload images.");
    if (!item.blob) {
      compressingCount++;
      try { item.blob = await compressForUpload(item.file); }
      finally { compressingCount--; schedulePresign(); }
    }
    if (item.cancelled) throw new Error("cancelled");
    item.status = "uploading";
    updateItemUi(item);
    const target = await queuePresign(item, item.blob);
    item.filename = target.filename;
    if (item.cancelled) { deleteUploads([item.filename], item.isOfficial); throw new Error("cancelled"); }
    const t0 = performance.now();
    await putWithProgress(item, target.url, item.blob);
    try { performance.measure("lineupr:upload", { start: t0, end: performance.now() }); } catch {}
    item.url = target.publicUrl;
    item.status = "done";
    item.progress = 1;
    updateItemUi(item);
    return item.url;
  })().catch((err) => {
    if (!item.cancelled) {
      item.status = "error";
      item.error = (err && err.message) || "Upload failed";
      updateItemUi(item);
    }
    throw err;
  });
  item.promise.catch(() => {}); // surfaced through the thumb + save, not as an unhandled rejection
  return item;
}

export function retryUpload(item) {
  if (!item || item.status !== "error") return;
  startUpload(item);
}

// Best-effort removal of uploads that will never be saved (image removed,
// modal discarded, page closed). keepalive lets the request outlive the page.
// The server only deletes fresh, randomly named objects the caller owns and
// that no saved lineup references (see api/upload-url.js deleteUploads).
function deleteUploads(filenames, isOfficial) {
  if (!filenames.length) return;
  getAccessToken().then((token) => {
    if (!token) return;
    for (let i = 0; i < filenames.length; i += PRESIGN_BATCH) {
      fetch("/api/upload-url", {
        method: "POST",
        keepalive: true,
        headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", isOfficial: !!isOfficial, filenames: filenames.slice(i, i + PRESIGN_BATCH) }),
      }).catch(() => {});
    }
  }).catch(() => {});
}

// Cancels and forgets upload items that are not going to be saved: stops
// work in flight, deletes whatever already reached R2, frees the previews.
export function discardItems(items) {
  const byBucket = new Map();
  for (const item of items) {
    if (!isUploadItem(item) || item.cancelled) continue;
    item.cancelled = true;
    if (item.xhr) item.xhr.abort();
    if (item.filename) {
      const k = !!item.isOfficial;
      if (!byBucket.has(k)) byBucket.set(k, []);
      byBucket.get(k).push(item.filename);
    }
    releaseItem(item);
  }
  for (const [isOfficial, names] of byBucket) deleteUploads(names, isOfficial);
}

// Frees an item's preview once it's no longer shown (after a save, or
// when discarded).
export function releaseItem(item) {
  if (item.previewUrl) { URL.revokeObjectURL(item.previewUrl); item.previewUrl = null; }
  item.file = null;
  item.blob = null;
}

// ── Slots (categories) ──────────────────────────────────────────────────
// Each category's thumbs are draggable, so a picture can be moved between
// categories (or reordered within one) by dropping it on another thumb or
// on empty slot space. CATS is the single source of truth for how each
// category stores its image(s) and how to re-render it after a change;
// setupDropZones (below) wires the drag events, including files dropped
// from the desktop.
export const CAT_ORDER = ["standing", "screenshots", "precise", "result"];
const CATS = {
  standing:    { kind: "array",  max: MAX_STANDING,    label: "Where to stand", el: () => standingThumbGrid, input: () => standingInput },
  screenshots: { kind: "array",  max: MAX_SCREENSHOTS, label: "Where to aim",   el: () => thumbGrid,         input: () => screenshotInput },
  precise:     { kind: "single", max: 1,               label: "Precise",        el: () => preciseThumbWrap,  input: () => preciseInput },
  result:      { kind: "single", max: 1,               label: "Result",         el: () => resultThumbWrap,   input: () => resultInput },
};

function slotEl(cat) {
  const el = CATS[cat].el();
  return el ? el.closest(".tm-upload-col") || el : null;
}

function catCount(cat) {
  const v = pendingThrowDraft[cat];
  return CATS[cat].kind === "array" ? v.length : (v ? 1 : 0);
}

function catRoom(cat) {
  return CATS[cat].max - catCount(cat);
}

// Where an image without an explicit target (paste, drop on the modal
// body) goes: the first empty slot in Standing → Aim → Precise → Result
// order; once every slot has something, more aim screenshots, then more
// standing ones.
export function nextAutoSlot() {
  const empty = CAT_ORDER.find(cat => catCount(cat) === 0);
  if (empty) return empty;
  return ["screenshots", "standing"].find(cat => catRoom(cat) > 0) || null;
}

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
    toast(`${toMeta.label} already has the max of ${toMeta.max} images.`);
  } else if (toMeta.kind === "single") {
    const bumped = pendingThrowDraft[toCat];
    pendingThrowDraft[toCat] = moving;
    if (bumped != null) insertImage(fromCat, bumped, fromIdx); // swap the displaced image back
  } else {
    insertImage(toCat, moving, fromCat === toCat && fromIdx < toIdx ? toIdx - 1 : toIdx);
  }
  markThrowDraftDirty();
  renderCat(fromCat);
  if (toCat !== fromCat) renderCat(toCat);
}

function removeImage(cat, idx) {
  const removed = extractImage(cat, idx);
  // A fresh upload that is removed before saving is an orphan in R2: cancel
  // it and delete it. A stored URL (editing an existing throw) is left alone;
  // it only stops being referenced once the throw is saved.
  if (isUploadItem(removed)) discardItems([removed]);
  markThrowDraftDirty();
  renderCat(cat);
}

// Adds files to one slot (or, with cat = null, routes each to nextAutoSlot)
// and starts uploading them right away. Returns the slots that received
// something.
export function addFiles(cat, files, { highlight = false } = {}) {
  const draft = pendingThrowDraft;
  if (!draft) return [];
  const received = new Set();
  let refused = 0;
  for (const file of files) {
    const problem = fileProblem(file);
    if (problem) { toastError(problem); continue; }
    let target = cat;
    if (target && catRoom(target) <= 0 && CATS[target].kind === "single") {
      // A new file picked or dropped onto a single slot replaces its image.
      const old = draft[target];
      if (isUploadItem(old)) discardItems([old]);
      draft[target] = null;
    }
    if (!target || catRoom(target) <= 0) target = cat ? null : nextAutoSlot();
    if (!target) { refused++; continue; }
    insertImage(target, startUpload(createItem(file, draft.isOfficial)));
    received.add(target);
  }
  if (refused) {
    toast(cat ? `${CATS[cat].label} already has the max of ${CATS[cat].max} image${CATS[cat].max > 1 ? "s" : ""}.` : "Every image slot is full.");
  }
  if (received.size) markThrowDraftDirty();
  received.forEach((c) => {
    renderCat(c);
    if (highlight) flashSlot(c);
  });
  return [...received];
}

// Brief highlight on the slot that just received a pasted/dropped image.
function flashSlot(cat) {
  const el = slotEl(cat);
  if (!el) return;
  el.classList.remove("slot-received");
  void el.offsetWidth; // restart the animation if it's already running
  el.classList.add("slot-received");
  setTimeout(() => el.classList.remove("slot-received"), 900);
}

// ── Thumbs ──────────────────────────────────────────────────────────────
const RING_R = 15;
const RING_C = 2 * Math.PI * RING_R;

function statusLabel(item) {
  if (item.status === "compressing") return "Optimizing…";
  if (item.status === "uploading") return `Uploading ${Math.round(item.progress * 100)}%`;
  if (item.status === "done") return "Uploaded";
  return `Upload failed: ${item.error || "unknown error"}`;
}

function makeThumb(value, cat, idx) {
  const t = document.createElement("div");
  t.className = "thumb";
  t.draggable = true;
  t.dataset.cat = cat;
  t.dataset.idx = idx;
  const label = `${CATS[cat].label} image ${idx + 1}`;
  if (isUploadItem(value)) {
    t.dataset.itemId = value.id;
    t.innerHTML = `
      <img src="${escapeHtml(value.previewUrl || "")}" alt="">
      <div class="thumb-status" role="img">
        <svg class="thumb-ring" viewBox="0 0 36 36" aria-hidden="true">
          <circle class="thumb-ring-track" cx="18" cy="18" r="${RING_R}"></circle>
          <circle class="thumb-ring-bar" cx="18" cy="18" r="${RING_R}" stroke-dasharray="${RING_C.toFixed(2)}" stroke-dashoffset="${RING_C.toFixed(2)}"></circle>
        </svg>
        <span class="thumb-check" aria-hidden="true">✓</span>
        <button class="thumb-retry" type="button" aria-label="Retry upload of ${escapeHtml(label)}">↻</button>
      </div>
      <button class="thumb-remove" type="button" aria-label="Remove ${escapeHtml(label)}">✕</button>`;
    t.querySelector(".thumb-retry").onclick = (e) => { e.stopPropagation(); retryUpload(value); };
    applyItemState(t, value);
  } else {
    t.innerHTML = `<img data-real-src="${escapeHtml(value)}" alt=""><button class="thumb-remove" type="button" aria-label="Remove ${escapeHtml(label)}">✕</button>`;
  }
  t.querySelector(".thumb-remove").onclick = () => removeImage(cat, idx);
  t.addEventListener("dragstart", (e) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/x-lineupr-thumb", `${cat}:${idx}`);
    e.dataTransfer.setData("text/plain", `${cat}:${idx}`);
    t.classList.add("dragging");
  });
  t.addEventListener("dragend", () => t.classList.remove("dragging"));
  return t;
}

function applyItemState(t, item) {
  t.classList.toggle("is-compressing", item.status === "compressing");
  t.classList.toggle("is-uploading", item.status === "uploading");
  t.classList.toggle("is-done", item.status === "done");
  t.classList.toggle("is-error", item.status === "error");
  const status = t.querySelector(".thumb-status");
  status.setAttribute("aria-label", statusLabel(item));
  status.title = item.status === "error" ? statusLabel(item) : "";
  const bar = t.querySelector(".thumb-ring-bar");
  const p = item.status === "uploading" ? Math.max(0.04, item.progress) : item.status === "done" ? 1 : 0.25;
  bar.setAttribute("stroke-dashoffset", (RING_C * (1 - p)).toFixed(2));
}

// Progress events arrive many times a second: update the one thumb in
// place instead of re-rendering the slot.
function updateItemUi(item) {
  const t = document.querySelector(`#throwModal .thumb[data-item-id="${item.id}"]`);
  if (t) applyItemState(t, item);
  updateUploadSummary();
}

// The footer line next to Save ("Uploading 3 of 8…"), also announced to
// screen readers (aria-live on the element).
export function updateUploadSummary() {
  if (!tmUploadSummary) return;
  const items = draftItems(pendingThrowDraft);
  const failed = items.filter(i => i.status === "error").length;
  const done = items.filter(i => i.status === "done").length;
  let text = "";
  if (failed) text = `${failed} upload${failed > 1 ? "s" : ""} failed. Retry or remove ${failed > 1 ? "them" : "it"}.`;
  else if (items.length && done < items.length) text = `Uploading ${done + 1} of ${items.length}…`;
  else if (items.length) text = items.length === 1 ? "Screenshot uploaded" : `All ${items.length} screenshots uploaded`;
  if (tmUploadSummary.textContent !== text) tmUploadSummary.textContent = text;
  tmUploadSummary.classList.toggle("is-error", !!failed);
}

function renderCat(cat) {
  const el = CATS[cat].el();
  el.innerHTML = "";
  const v = pendingThrowDraft[cat];
  const values = CATS[cat].kind === "array" ? v || [] : v ? [v] : [];
  values.forEach((value, i) => el.appendChild(makeThumb(value, cat, i)));
  hydrateImages(el);
  setupDropZones();
  updateUploadSummary();
}

export function renderThumbGrid() { renderCat("screenshots"); }
export function renderPreciseThumb() { renderCat("precise"); }
export function renderResultThumb() { renderCat("result"); }
export function renderStandingThumbGrid() { renderCat("standing"); }

// ── Drag & drop: thumbs between slots, and files from the desktop ───────
function isFileDrag(e) {
  return !!e.dataTransfer && [...(e.dataTransfer.types || [])].includes("Files");
}

let dropZonesReady = false;
function setupDropZones() {
  if (dropZonesReady) return;
  dropZonesReady = true;
  Object.keys(CATS).forEach(cat => {
    const el = slotEl(cat);
    if (!el) return;
    el.dataset.slot = cat;
    el.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = isFileDrag(e) ? "copy" : "move";
      el.classList.add("drag-over");
    });
    el.addEventListener("dragleave", (e) => {
      if (!el.contains(e.relatedTarget)) el.classList.remove("drag-over");
    });
    el.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      el.classList.remove("drag-over");
      const files = [...(e.dataTransfer.files || [])];
      if (files.length) { addFiles(cat, files, { highlight: true }); return; }
      const data = e.dataTransfer.getData("text/x-lineupr-thumb") || e.dataTransfer.getData("text/plain");
      if (!data) return;
      const [fromCat, fromIdxStr] = data.split(":");
      if (!CATS[fromCat]) return;
      const targetThumb = e.target.closest(".thumb");
      const toIdx = targetThumb ? Number(targetThumb.dataset.idx) : null;
      moveImage(fromCat, Number(fromIdxStr), cat, toIdx);
    });
  });
}

// Clears any leftover drop highlight (e.g. a drag that left the window).
export function clearDropHighlights() {
  document.querySelectorAll("#throwModal .drag-over").forEach(el => el.classList.remove("drag-over"));
}

// ── File inputs ─────────────────────────────────────────────────────────
Object.keys(CATS).forEach((cat) => {
  const input = CATS[cat].input();
  if (!input) return;
  input.onchange = () => {
    const files = Array.from(input.files || []);
    input.value = "";
    if (!files.length || !pendingThrowDraft) return;
    addFiles(cat, CATS[cat].kind === "single" ? files.slice(0, 1) : files);
  };
});
