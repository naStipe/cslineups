import { getAccessToken } from "./auth.js";
import { preciseInput, preciseThumbWrap, screenshotInput, standingInput, standingThumbGrid, thumbGrid } from "./dom.js";
import { pendingThrowDraft } from "./throw-modal.js";

export const MAX_SCREENSHOTS = 5;

export const MAX_STANDING = 3;

// Client-side guardrails only — a determined attacker can call the storage
// API directly with their own token and skip this file entirely, so the
// real enforcement has to live in the Supabase Storage bucket's own
// settings (allowed MIME types + a max file size on the `lineup-images`
// bucket). This just stops honest users from accidentally uploading huge
// or non-image files, and gives a clear error instead of a confusing
// server-side failure.
const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // 15 MB

export async function uploadFileToSupabase(file) {
  const url = window.__SUPABASE_URL;
  const anonKey = window.__SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error("Supabase config not available — check SUPABASE_URL and SUPABASE_ANON_KEY in Vercel");

  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    throw new Error(`"${file.type || "unknown"}" isn't a supported image type. Use JPEG, PNG, WEBP, or GIF.`);
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(`That file is too large (max ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB).`);
  }

  // Needs the signed-in user's own access token here, not the anon/publishable
  // key — Storage parses whatever is in Authorization as a JWT to check
  // auth.uid() against the bucket's policies, and Supabase's newer
  // "publishable" keys aren't JWTs at all, which is exactly what produced
  // "Invalid Compact JWS": the anon key was being sent as if it were a
  // logged-in user's token.
  const token = await getAccessToken();
  if (!token) throw new Error("You need to be signed in to upload images.");

  const blob = await maybeResize(file);
  const ext  = blob.type.split("/")[1] || "jpg";
  const filename = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}.${ext}`;

  const res = await fetch(
    `${url}/storage/v1/object/lineup-images/${filename}`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "apikey": anonKey,
        "Content-Type": blob.type,
        "x-upsert": "false",
      },
      body: blob,
    }
  );
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`Image upload failed (${res.status}): ${err}`);
  }
  return `${url}/storage/v1/object/public/lineup-images/${filename}`;
}

export async function uploadDataUrlToSupabase(dataUrl) {
  if (!dataUrl || !dataUrl.startsWith("data:")) return dataUrl; // already a URL
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return dataUrl;
  const [, mime, b64] = match;
  const buf = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const blob = new Blob([buf], { type: mime });
  return uploadFileToSupabase(blob);
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

export function renderThumbGrid() {
  thumbGrid.innerHTML = "";
  (pendingThrowDraft.screenshots || []).forEach((src, i) => {
    const t = document.createElement("div");
    t.className = "thumb";
    t.innerHTML = `<img src="${src}"><button class="thumb-remove" type="button">✕</button>`;
    t.querySelector(".thumb-remove").onclick = () => {
      pendingThrowDraft.screenshots.splice(i, 1);
      renderThumbGrid();
    };
    thumbGrid.appendChild(t);
  });
}

export function renderPreciseThumb() {
  preciseThumbWrap.innerHTML = "";
  if (!pendingThrowDraft.precise) return;
  const t = document.createElement("div");
  t.className = "thumb";
  t.innerHTML = `<img src="${pendingThrowDraft.precise}"><button class="thumb-remove" type="button">✕</button>`;
  t.querySelector(".thumb-remove").onclick = () => {
    pendingThrowDraft.precise = null;
    renderPreciseThumb();
  };
  preciseThumbWrap.appendChild(t);
}

export function renderStandingThumbGrid() {
  standingThumbGrid.innerHTML = "";
  (pendingThrowDraft.standing || []).forEach((src, i) => {
    const t = document.createElement("div");
    t.className = "thumb";
    t.innerHTML = `<img src="${src}"><button class="thumb-remove" type="button">✕</button>`;
    t.querySelector(".thumb-remove").onclick = () => {
      pendingThrowDraft.standing.splice(i, 1);
      renderStandingThumbGrid();
    };
    standingThumbGrid.appendChild(t);
  });
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
