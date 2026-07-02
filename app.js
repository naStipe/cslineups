/* ===================== EDIT LOCK ===================== */

const PW_STORAGE_KEY = "lineups-edit-password";

function getEditPassword() {
  return sessionStorage.getItem(PW_STORAGE_KEY) || "";
}
function setEditPassword(pw) {
  sessionStorage.setItem(PW_STORAGE_KEY, pw);
}
function isUnlocked() {
  return !!getEditPassword();
}
function lockEditing() {
  sessionStorage.removeItem(PW_STORAGE_KEY);
  applyLockState();
}
function applyLockState() {
  const unlocked = isUnlocked();
  document.body.classList.toggle("locked", !unlocked);
  lockBtn.textContent = unlocked ? "🔓 Editing unlocked" : "🔒 Unlock editing";
  lockBtn.classList.toggle("unlocked", unlocked);
}



const MAPS = [
  { id: "dust2",    name: "Dust II",   file: "maps/dust2.webp",    logo: "maps/dust2-logo.jpg",    cheatsheet: null },
  { id: "mirage",   name: "Mirage",    file: "maps/mirage.webp",   logo: "maps/mirage-logo.jpg",   cheatsheet: "maps/mirage-insta-smokes.webp" },
  { id: "inferno",  name: "Inferno",   file: "maps/inferno.webp",  logo: "maps/inferno-logo.jpg",  cheatsheet: "maps/inferno-insta-smokes.webp" },
  { id: "nuke",     name: "Nuke",      file: "maps/nuke.webp",     logo: "maps/nuke-logo.jpg",     cheatsheet: null },
  { id: "ancient",  name: "Ancient",   file: "maps/ancient.webp",  logo: "maps/ancient-logo.jpg",  cheatsheet: null },
  { id: "anubis",   name: "Anubis",    file: "maps/anubis.png",    logo: "maps/anubis-logo.jpg",   cheatsheet: "maps/anubis-insta-smokes.webp" },
  { id: "overpass", name: "Overpass",  file: "maps/overpass.webp", logo: "maps/overpass-logo.jpg", cheatsheet: null },
  { id: "cache",    name: "Cache",     file: "maps/cache.webp",    logo: "maps/cache-logo.jpg",    cheatsheet: null },
];

const TYPES = [
  { id: "smoke", label: "Smoke",     color: "var(--smoke)" },
  { id: "flash", label: "Flash",     color: "var(--flash)" },
  { id: "fire",  label: "Molotov",   color: "var(--fire)"  },
  { id: "he",    label: "HE Grenade",color: "var(--he)"    },
  { id: "decoy", label: "Decoy",     color: "var(--decoy)" },
];

const RANGE_LABELS = {
  "throw": "Throw",
  "mid-throw": "Mid-throw",
  "close-throw": "Close-throw",
};

const MOVEMENT_LABELS = {
  "none":                  "Standing",
  "jumpthrow":             "Jumpthrow",
  "w-throw":               "W + Throw",
  "w-jumpthrow":           "W + Jumpthrow",
  "run":                   "Run",
  "run-throw":             "Run + Throw",
  "run-jumpthrow":         "Run + Jumpthrow",
  "shift-w-throw":         "Shift + W + Throw",
  "shift-w-jumpthrow":     "Shift + W + Jumpthrow",
  "crouch":                "Crouch",
  "crouchjump":            "Crouch + Jump",
  "crouchaim-jump":        "Crouch-aim + Jump",
  "crouchaim-crouchjump":  "Crouch-aim + Crouch-jump",
};

/* ===================== STORAGE (Netlify Function API) ===================== */

const API_URL = "/api/lineups";

async function dbGetAll() {
  const res = await fetch(`${API_URL}?mapId=${encodeURIComponent(state.mapId)}`);
  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(`Failed to load lineups (${res.status}): ${msg}`);
  }
  return res.json();
}

async function dbPut(record) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Edit-Password": getEditPassword() },
    body: JSON.stringify(record),
  });
  if (res.status === 401) throw new Error("LOCKED");
  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(`Failed to save lineup (${res.status}): ${msg}`);
  }
}

async function dbDelete(id) {
  const res = await fetch(`${API_URL}?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { "X-Edit-Password": getEditPassword() },
  });
  if (res.status === 401) throw new Error("LOCKED");
  if (!res.ok) throw new Error("Failed to delete lineup");
}

async function dbImportBulk(records) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Edit-Password": getEditPassword() },
    body: JSON.stringify({ records }),
  });
  if (res.status === 401) throw new Error("LOCKED");
  if (!res.ok) throw new Error("Failed to import lineups");
}

async function verifyPassword(pw) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Edit-Password": pw },
    body: JSON.stringify({ checkPassword: true }),
  });
  return res.ok;
}

/* ===================== STATE ===================== */

let state = {
  mapId: MAPS[0].id,
  lineups: [],          // all lineups for current map, loaded from DB
  activeFilters: new Set(TYPES.map(t => t.id)),
  pendingType: null,
  pendingName: "",     // type chosen in type modal, awaiting landing click
  pendingLanding: null,  // {x,y} percent, awaiting throw-pos click for a NEW lineup
  pendingThrowFor: null, // lineup id awaiting a throw-pos click (adding to existing lineup)
  selectedLineupId: null,
  addMode: false,
};

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/* ===================== DOM REFS ===================== */

const mapList = document.getElementById("mapList");
const homeScreen = document.getElementById("homeScreen");
const homeGrid = document.getElementById("homeGrid");
const appShell = document.getElementById("appShell");
const backBtn = document.getElementById("backBtn");
const typeFilters = document.getElementById("typeFilters");
const mapImage = document.getElementById("mapImage");
const mapFrame = document.getElementById("mapFrame");
const markerLayer = document.getElementById("markerLayer");
const mapStage = document.getElementById("mapStage");
const zoomInBtn = document.getElementById("zoomIn");
const zoomOutBtn = document.getElementById("zoomOut");
const zoomResetBtn = document.getElementById("zoomReset");
const cheatsheetPanel = document.getElementById("cheatsheetPanel");
const cheatsheetTab   = document.getElementById("cheatsheetTab");
const cheatsheetBody  = document.getElementById("cheatsheetBody");
const cheatsheetClose = document.getElementById("cheatsheetClose");
const cheatsheetImg   = document.getElementById("cheatsheetImg");
const linkSvg = document.getElementById("linkSvg");
const currentMapName = document.getElementById("currentMapName");
const lineupCount = document.getElementById("lineupCount");
const addModeBtn = document.getElementById("addModeBtn");
const addHint = document.getElementById("addHint");

const typeModal = document.getElementById("typeModal");
const typeGrid = document.getElementById("typeGrid");
const lineupNameInput = document.getElementById("lineupNameInput");
const cancelType = document.getElementById("cancelType");

const throwModal = document.getElementById("throwModal");
const throwModalTitle = document.getElementById("throwModalTitle");
const throwModalHint = document.getElementById("throwModalHint");
const screenshotInput = document.getElementById("screenshotInput");
const thumbGrid = document.getElementById("thumbGrid");
const standingInput = document.getElementById("standingInput");
const standingThumbGrid = document.getElementById("standingThumbGrid");
const preciseInput = document.getElementById("preciseInput");
const preciseThumbWrap = document.getElementById("preciseThumbWrap");
const throwRangeSelect = document.getElementById("throwRangeSelect");
const movementSelect = document.getElementById("movementSelect");
const notesInput = document.getElementById("notesInput");
const cancelThrow = document.getElementById("cancelThrow");
const saveThrow = document.getElementById("saveThrow");

const lightboxModal = document.getElementById("lightboxModal");
const lightboxImage = document.getElementById("lightboxImage");
const lightboxCaption = document.getElementById("lightboxCaption");
const lightboxClose = document.getElementById("lightboxClose");
const lightboxPrev = document.getElementById("lightboxPrev");
const lightboxNext = document.getElementById("lightboxNext");

const detailPanel = document.getElementById("detailPanel");
const detailType = document.getElementById("detailType");
const detailTitle = document.getElementById("detailTitle");
const detailNameInput = document.getElementById("detailNameInput");
const throwList = document.getElementById("throwList");
const closeDetail = document.getElementById("closeDetail");
const addThrowBtn = document.getElementById("addThrowBtn");
const deleteLineupBtn = document.getElementById("deleteLineupBtn");

const exportBtn = document.getElementById("exportBtn");
const importInput = document.getElementById("importInput");
const lockBtn = document.getElementById("lockBtn");

const clusterModal = document.getElementById("clusterModal");
const clusterGrid = document.getElementById("clusterGrid");
const cancelCluster = document.getElementById("cancelCluster");

let pendingThrowDraft = null; // {x,y,screenshot,...} being built before save

/* ===================== HOME SCREEN ===================== */

async function buildHomeScreen() {
  homeGrid.innerHTML = "";
  const inner = document.createElement("div");
  inner.className = "home-grid-inner";

  // Fetch counts for all maps in parallel
  const counts = await Promise.all(
    MAPS.map(m =>
      fetch(`${API_URL}?mapId=${encodeURIComponent(m.id)}`)
        .then(r => r.ok ? r.json() : [])
        .then(rows => rows.length)
        .catch(() => 0)
    )
  );

  MAPS.forEach((m, i) => {
    const count = counts[i];
    const card = document.createElement("div");
    card.className = "map-card";
    card.innerHTML = `
      <div class="map-card-bg" style="background-image:url('${m.logo || m.file}')"></div>
      <div class="map-card-content">
        <div class="map-card-name">${m.name}</div>
        <div class="map-card-count ${count === 0 ? "empty" : ""}">
          ${count === 0 ? "No lineups yet" : `${count} lineup${count === 1 ? "" : "s"}`}
        </div>
      </div>
    `;
    card.onclick = () => enterMap(m.id);
    inner.appendChild(card);
  });

  homeGrid.appendChild(inner);
}

function enterMap(id) {
  homeScreen.style.display = "none";
  appShell.removeAttribute("hidden");
  selectMap(id);
}

function goHome() {
  appShell.setAttribute("hidden", "");
  homeScreen.style.display = "";
  closeDetailPanel();
  setAddMode(false);
  buildHomeScreen(); // refresh counts when returning
}

/* ===================== CHEATSHEET ===================== */

function updateCheatsheet(mapId) {
  const m = MAPS.find(x => x.id === mapId);
  if (m && m.cheatsheet) {
    cheatsheetImg.src = m.cheatsheet;
    cheatsheetPanel.classList.remove("hidden");
    cheatsheetPanel.classList.remove("open");
  } else {
    cheatsheetPanel.classList.add("hidden");
    cheatsheetPanel.classList.remove("open");
  }
}

cheatsheetTab.onclick = () => cheatsheetPanel.classList.add("open");
cheatsheetClose.onclick = () => cheatsheetPanel.classList.remove("open");

// Click image to open fullscreen lightbox
cheatsheetImg.onclick = () => {
  const m = MAPS.find(x => x.id === state.mapId);
  if (m && m.cheatsheet) openLightbox([m.cheatsheet], 0, "Instant Smokes");
};

let zoom = 1;
let panX = 0, panY = 0;
let isDragging = false;
let hasDragged = false;
let dragStartX, dragStartY, dragPanX, dragPanY;
const MAX_ZOOM = 6;

function applyTransform(rerender = true) {
  mapFrame.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
  // Scale markers inversely so they appear the same size on screen regardless of zoom
  const markerScale = 1 / zoom;
  document.documentElement.style.setProperty("--marker-scale", markerScale);
  mapStage.style.cursor = zoom > 1 ? "grab" : "";
  if (rerender) renderMarkers();
}

function resetZoom() {
  zoom = 1; panX = 0; panY = 0;
  applyTransform();
  mapStage.style.cursor = "";
}

function zoomAt(clientX, clientY, factor) {
  const newZoom = Math.min(Math.max(zoom * factor, 1), MAX_ZOOM);
  if (newZoom === zoom) return;
  const rf = newZoom / zoom;

  // cursor offset from current frame center in screen space
  const r = mapFrame.getBoundingClientRect();
  const cx = clientX - (r.left + r.width / 2);
  const cy = clientY - (r.top + r.height / 2);

  // adjust pan so the point under cursor stays stationary
  panX = panX + cx * (1 - rf);
  panY = panY + cy * (1 - rf);
  zoom = newZoom;

  if (zoom <= 1) { zoom = 1; panX = 0; panY = 0; }
  applyTransform();
}

mapStage.addEventListener("wheel", (e) => {
  e.preventDefault();
  zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.2 : 1 / 1.2);
}, { passive: false });

mapStage.addEventListener("mousedown", (e) => {
  if (e.button !== 0 || zoom <= 1 || state.addMode || state.pendingThrowFor) return;
  isDragging = true;
  hasDragged = false;
  dragStartX = e.clientX; dragStartY = e.clientY;
  dragPanX = panX; dragPanY = panY;
  mapStage.classList.add("panning");
  e.preventDefault();
});
window.addEventListener("mousemove", (e) => {
  if (!isDragging) return;
  const dx = e.clientX - dragStartX;
  const dy = e.clientY - dragStartY;
  if (Math.hypot(dx, dy) > 4) hasDragged = true;
  panX = dragPanX + dx;
  panY = dragPanY + dy;
  applyTransform(false);
});
window.addEventListener("mouseup", () => {
  if (!isDragging) return;
  isDragging = false;
  mapStage.classList.remove("panning");
  mapStage.style.cursor = zoom > 1 ? "grab" : "";
});

// Pinch to zoom (touch)
let lastTouchDist = null;
mapStage.addEventListener("touchstart", (e) => {
  if (e.touches.length === 2) {
    lastTouchDist = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY
    );
  }
}, { passive: true });
mapStage.addEventListener("touchmove", (e) => {
  if (e.touches.length !== 2 || !lastTouchDist) return;
  const dist = Math.hypot(
    e.touches[0].clientX - e.touches[1].clientX,
    e.touches[0].clientY - e.touches[1].clientY
  );
  const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
  const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
  zoomAt(midX, midY, dist / lastTouchDist);
  lastTouchDist = dist;
  e.preventDefault();
}, { passive: false });
mapStage.addEventListener("touchend", () => { lastTouchDist = null; });

zoomInBtn.onclick    = () => { const r = mapStage.getBoundingClientRect(); zoomAt(r.left + r.width/2, r.top + r.height/2, 1.5); };
zoomOutBtn.onclick   = () => { const r = mapStage.getBoundingClientRect(); zoomAt(r.left + r.width/2, r.top + r.height/2, 1/1.5); };
zoomResetBtn.onclick = resetZoom;

/* ===================== INIT ===================== */

function buildSidebar() {
  mapList.innerHTML = "";
  MAPS.forEach(m => {
    const el = document.createElement("div");
    el.className = "map-item" + (m.id === state.mapId ? " active" : "");
    el.innerHTML = `<span class="swatch"></span>${m.name}`;
    el.onclick = () => selectMap(m.id);
    mapList.appendChild(el);
  });
}

function buildFilters() {
  typeFilters.innerHTML = "";
  TYPES.forEach(t => {
    const chip = document.createElement("div");
    chip.className = "filter-chip";
    chip.innerHTML = `<span class="dot" style="background:${t.color}"></span>${t.label}`;
    chip.onclick = () => {
      if (state.activeFilters.has(t.id)) {
        state.activeFilters.delete(t.id);
        chip.classList.add("off");
      } else {
        state.activeFilters.add(t.id);
        chip.classList.remove("off");
      }
      renderMarkers();
    };
    typeFilters.appendChild(chip);
  });
}

function buildTypeGrid(onPick) {
  typeGrid.innerHTML = "";
  TYPES.forEach(t => {
    const opt = document.createElement("div");
    opt.className = "type-opt";
    opt.innerHTML = `<span class="dot" style="background:${t.color}"></span>${t.label}`;
    opt.onclick = () => onPick(t.id);
    typeGrid.appendChild(opt);
  });
}

async function selectMap(id) {
  state.mapId = id;
  state.selectedLineupId = null;
  state.lineups = [];
  markerLayer.innerHTML = "";
  linkSvg.innerHTML = "";
  detailPanel.classList.remove("open");
  setAddMode(false);
  resetZoom();
  buildSidebar();
  const m = MAPS.find(x => x.id === id);
  currentMapName.textContent = m.name.toUpperCase();
  mapImage.src = m.file;
  updateCheatsheet(id);
  await loadLineups();
}

let loadToken = 0;

async function loadLineups() {
  const myToken = ++loadToken;
  lineupCount.textContent = "loading…";
  try {
    const lineups = await dbGetAll();
    if (myToken !== loadToken) return;
    state.lineups = lineups;
    lineupCount.textContent = `${lineups.length} lineup${lineups.length === 1 ? "" : "s"}`;
    renderMarkers();
  } catch (err) {
    if (myToken !== loadToken) return;
    lineupCount.textContent = "load failed";
    console.error(err);
  }
}

/* ===================== ADD MODE / MAP CLICKS ===================== */

function setAddMode(on) {
  state.addMode = on;
  state.pendingType = null;
  state.pendingLanding = null;
  addModeBtn.classList.toggle("active", on);
  mapFrame.classList.toggle("add-mode", on);
  addHint.classList.toggle("show", on);
  if (on) addHint.textContent = "Click anywhere on the map to drop the landing spot for a new lineup.";
}

lockBtn.onclick = async () => {
  if (isUnlocked()) {
    lockEditing();
    return;
  }
  const pw = prompt("Enter edit password:");
  if (pw === null) return;
  const ok = await verifyPassword(pw);
  if (ok) {
    setEditPassword(pw);
    applyLockState();
  } else {
    alert("Wrong password.");
  }
};

function requireUnlocked() {
  if (isUnlocked()) return true;
  lockBtn.click();
  return false;
}

addModeBtn.onclick = () => {
  if (!requireUnlocked()) return;
  setAddMode(true);
  openTypeModal((typeId) => {
    state.pendingType = typeId;
    state.pendingName = lineupNameInput ? lineupNameInput.value.trim() : "";
    closeModal(typeModal);
    addHint.textContent = "Now click where this nade lands.";
  });
};

mapFrame.addEventListener("click", (e) => {
  const rect = mapImage.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * 100;
  const y = ((e.clientY - rect.top) / rect.height) * 100;
  if (x < 0 || x > 100 || y < 0 || y > 100) return;

  if (state.pendingThrowFor) {
    openThrowModal({ x, y }, state.pendingThrowFor, false);
    return;
  }

  if (state.addMode && state.pendingType) {
    if (!state.pendingLanding) {
      state.pendingLanding = { x, y };
      addHint.textContent = "Now click the spot you throw from.";
    } else {
      const newId = uid();
      openThrowModal({ x, y }, newId, true, state.pendingType, state.pendingLanding);
    }
    return;
  }

  if (state.selectedLineupId && !detailPanel.classList.contains("open")) {
    if (hasDragged) { hasDragged = false; return; }
    state.selectedLineupId = null;
    renderMarkers();
  }
});

function openTypeModal(onPick) {
  buildTypeGrid(onPick);
  if (lineupNameInput) lineupNameInput.value = "";
  typeModal.classList.add("show");
}
cancelType.onclick = () => { closeModal(typeModal); setAddMode(false); };

function closeModal(m) { m.classList.remove("show"); }

/* ===================== THROW MODAL ===================== */

const MAX_SCREENSHOTS = 5;
const MAX_STANDING = 3;

/* ===================== SUPABASE DIRECT IMAGE UPLOAD ===================== */

async function uploadFileToSupabase(file) {
  if (!window.__SUPABASE_URL || !window.__SUPABASE_ANON_KEY) {
    await loadConfig();
  }
  const url = window.__SUPABASE_URL;
  const key = window.__SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase config not available — check SUPABASE_URL and SUPABASE_ANON_KEY in Vercel");

  const blob = await maybeResize(file);
  const ext  = blob.type.split("/")[1] || "jpg";
  const filename = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}.${ext}`;

  const res = await fetch(
    `${url}/storage/v1/object/lineup-images/${filename}`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${key}`,
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

async function uploadDataUrlToSupabase(dataUrl) {
  if (!dataUrl || !dataUrl.startsWith("data:")) return dataUrl; // already a URL
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return dataUrl;
  const [, mime, b64] = match;
  const buf = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const blob = new Blob([buf], { type: mime });
  return uploadFileToSupabase(blob);
}

async function maybeResize(file) {
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

// Read a file as a local data URL (for instant preview — no upload yet)
function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function renderThumbGrid() {
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

function renderPreciseThumb() {
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

function renderStandingThumbGrid() {
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

function openThrowModal(throwPos, lineupId, isNewLineup, typeId, landingPos, existingThrow) {
  pendingThrowDraft = {
    throwPos,
    lineupId,
    isNewLineup,
    typeId,
    landingPos,
    standing: existingThrow ? [...(existingThrow.standing || [])] : [],
    screenshots: existingThrow ? [...existingThrow.screenshots] : [],
    precise: existingThrow ? existingThrow.precise || null : null,
    editingThrowId: existingThrow ? existingThrow.id : null,
  };

  renderStandingThumbGrid();
  renderThumbGrid();
  renderPreciseThumb();
  throwRangeSelect.value = existingThrow ? existingThrow.range : "throw";
  movementSelect.value = existingThrow ? existingThrow.movement : "none";
  notesInput.value = existingThrow ? existingThrow.notes || "" : "";

  if (existingThrow) {
    throwModalTitle.textContent = "Edit throw position";
    throwModalHint.textContent = "Editing this throw position's details. The map position stays the same.";
  } else {
    throwModalTitle.textContent = isNewLineup ? "New lineup — throw position" : "Add throw position";
    throwModalHint.textContent = "Click confirmed. Fill in the details below.";
  }
  throwModal.classList.add("show");
}

cancelThrow.onclick = () => {
  closeModal(throwModal);
  pendingThrowDraft = null;
  setAddMode(false);
  state.pendingThrowFor = null;
};

saveThrow.onclick = async () => {
  if (!pendingThrowDraft) return;
  if (!requireUnlocked()) return;
  if (pendingThrowDraft.screenshots.length === 0) {
    if (!confirm("No screenshots attached — save anyway?")) return;
  }

  saveThrow.disabled = true;
  saveThrow.textContent = "Uploading images…";

  try {
    const draft = pendingThrowDraft;

    // Upload any local data URLs to Supabase now (parallel)
    const [standing, screenshots, precise] = await Promise.all([
      Promise.all(draft.standing.map(uploadDataUrlToSupabase)),
      Promise.all(draft.screenshots.map(uploadDataUrlToSupabase)),
      draft.precise ? uploadDataUrlToSupabase(draft.precise) : Promise.resolve(null),
    ]);

    saveThrow.textContent = "Saving…";

    const throwEntryBase = {
      pos: draft.throwPos,
      standing,
      screenshots,
      precise,
      range: throwRangeSelect.value,
      movement: movementSelect.value,
      notes: notesInput.value.trim(),
    };

    if (draft.isNewLineup) {
      const lineup = {
        id: draft.lineupId,
        mapId: state.mapId,
        type: draft.typeId,
        name: state.pendingName || "",
        landing: draft.landingPos,
        throws: [{ id: uid(), ...throwEntryBase }],
        createdAt: Date.now(),
      };
      await dbPut(lineup);
    } else {
      let lineup = state.lineups.find(l => l.id === draft.lineupId);
      if (!lineup) {
        const all = await dbGetAll();
        lineup = all.find(l => l.id === draft.lineupId);
      }
      if (!lineup) throw new Error("Could not find the lineup to save this throw position to.");

      if (draft.editingThrowId) {
        const idx = lineup.throws.findIndex(t => t.id === draft.editingThrowId);
        if (idx === -1) throw new Error("Could not find the throw position to update.");
        lineup.throws[idx] = { id: draft.editingThrowId, ...throwEntryBase };
      } else {
        lineup.throws.push({ id: uid(), ...throwEntryBase });
      }
      await dbPut(lineup);
    }

    const wasEditing = !!draft.editingThrowId;
    const reopenId = draft.lineupId;

    closeModal(throwModal);
    pendingThrowDraft = null;
    setAddMode(false);
    state.pendingThrowFor = null;
    await loadLineups();

    // If we were editing an existing throw, reopen the dossier so changes are visible immediately
    if (wasEditing) openDetail(reopenId);
  } catch (err) {
    console.error(err);
    alert(
      err && err.message === "LOCKED"
        ? "Editing is locked — unlock it first."
        : "Could not save: " + (err && err.message ? err.message : err)
    );
  } finally {
    saveThrow.disabled = false;
    saveThrow.textContent = "Save throw position";
  }
};

/* ===================== MARKERS / RENDERING ===================== */

function typeColor(typeId) {
  return TYPES.find(t => t.id === typeId)?.color || "#fff";
}

function getCssVarColor(v) {
  if (v.startsWith("var(")) {
    return getComputedStyle(document.documentElement).getPropertyValue(v.slice(4, -1)).trim();
  }
  return v;
}

function clusterLineups(list) {
  const THRESHOLD = 3.5 / zoom;
  const clusters = [];
  list.forEach(lineup => {
    const c = clusters.find(cl => Math.hypot(cl.x - lineup.landing.x, cl.y - lineup.landing.y) < THRESHOLD);
    if (c) {
      c.lineups.push(lineup);
      c.x = c.lineups.reduce((s, l) => s + l.landing.x, 0) / c.lineups.length;
      c.y = c.lineups.reduce((s, l) => s + l.landing.y, 0) / c.lineups.length;
    } else {
      clusters.push({ x: lineup.landing.x, y: lineup.landing.y, lineups: [lineup] });
    }
  });
  return clusters;
}

function renderMarkers() {
  markerLayer.innerHTML = "";
  linkSvg.innerHTML = "";
  const visible = state.lineups.filter(l => state.activeFilters.has(l.type));
  const clusters = clusterLineups(visible);

  clusters.forEach(cluster => {
    const count = cluster.lineups.length;
    const sameType = count === 1 || cluster.lineups.every(l => l.type === cluster.lineups[0].type);
    const colorClass = sameType ? cluster.lineups[0].type : "multi";

    const landing = document.createElement("div");
    landing.className = `marker landing ${colorClass}`;
    landing.style.left = cluster.x + "%";
    landing.style.top = cluster.y + "%";

    if (count > 1) {
      landing.title = `${count} lineups here`;
      const badge = document.createElement("span");
      badge.className = "marker-badge";
      badge.textContent = count;
      landing.appendChild(badge);
    } else {
      const totalThrows = cluster.lineups[0].throws.length;
      landing.title = totalThrows > 1
        ? `${totalThrows} throw positions for this lineup`
        : "Click to see throw position";
      if (totalThrows > 1) {
        const badge = document.createElement("span");
        badge.className = "marker-badge sub";
        badge.textContent = totalThrows;
        landing.appendChild(badge);
      }
    }

    landing.onclick = (e) => {
      e.stopPropagation();
      if (count > 1) {
        openClusterPicker(cluster.lineups);
        return;
      }
      const lineup = cluster.lineups[0];
      if (state.selectedLineupId === lineup.id) {
        openDetail(lineup.id);
      } else {
        state.selectedLineupId = lineup.id;
        renderMarkers();
      }
    };
    markerLayer.appendChild(landing);

    const openLineup = cluster.lineups.find(l => l.id === state.selectedLineupId);
    if (openLineup) {
      openLineup.throws.forEach((t, throwIdx) => {
        const tp = document.createElement("div");
        tp.className = `marker throwpos ${openLineup.type}`;
        tp.style.left = t.pos.x + "%";
        tp.style.top = t.pos.y + "%";
        tp.title = "Click to open this lineup";
        tp.onclick = (e) => { e.stopPropagation(); openDetail(openLineup.id, throwIdx); };
        markerLayer.appendChild(tp);

        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", t.pos.x + "%");
        line.setAttribute("y1", t.pos.y + "%");
        line.setAttribute("x2", openLineup.landing.x + "%");
        line.setAttribute("y2", openLineup.landing.y + "%");
        line.setAttribute("stroke", getCssVarColor(typeColor(openLineup.type)));
        line.setAttribute("class", "link-line");
        linkSvg.appendChild(line);
      });
    }
  });
}

function openClusterPicker(lineups) {
  clusterGrid.innerHTML = "";
  lineups.forEach((lineup, i) => {
    const typeInfo = TYPES.find(t => t.id === lineup.type);
    const label = lineup.name || `${typeInfo.label} #${i + 1}`;
    const opt = document.createElement("div");
    opt.className = "type-opt";
    opt.innerHTML = `<span class="dot" style="background:${typeInfo.color}"></span>${label} — ${lineup.throws.length} position${lineup.throws.length === 1 ? "" : "s"}`;
    opt.onclick = () => {
      closeModal(clusterModal);
      // Reveal throw positions on map first (same as clicking a single landing marker)
      state.selectedLineupId = lineup.id;
      renderMarkers();
    };
    clusterGrid.appendChild(opt);
  });
  clusterModal.classList.add("show");
}
cancelCluster.onclick = () => closeModal(clusterModal);

/* ===================== DETAIL PANEL ===================== */

let selectedThrowIdx = 0;

function openDetail(lineupId, throwIdx) {
  state.selectedLineupId = lineupId;
  selectedThrowIdx = throwIdx !== undefined ? throwIdx : 0;
  const lineup = state.lineups.find(l => l.id === lineupId);
  if (!lineup) return;
  renderDetail(lineup);
  detailPanel.classList.add("open");
  renderMarkers();
}

function renderDetail(lineup) {
  renderDetailType(lineup);
  detailTitle.textContent = `${lineup.throws.length} variant${lineup.throws.length === 1 ? "" : "s"}`;

  // Name field
  detailNameInput.value = lineup.name || "";
  detailNameInput.onchange = async () => {
    if (!requireUnlocked()) { detailNameInput.value = lineup.name || ""; return; }
    lineup.name = detailNameInput.value.trim();
    await dbPut(lineup);
    await loadLineups();
  };
  throwList.innerHTML = "";

  if (!lineup.throws.length) return;

  selectedThrowIdx = Math.min(selectedThrowIdx, lineup.throws.length - 1);
  const active = lineup.throws[selectedThrowIdx];

  // ── HERO ──
  const hero = document.createElement("div");
  hero.className = "detail-hero";
  hero.innerHTML = buildHeroHtml(active, selectedThrowIdx, lineup);
  wireCarousels(hero, active);
  hero.querySelector(".edit-btn").onclick = () => {
    if (!requireUnlocked()) return;
    openThrowModal(active.pos, lineup.id, false, lineup.type, lineup.landing, active);
  };
  hero.querySelector(".remove-btn").onclick = async () => {
    if (!requireUnlocked()) return;
    lineup.throws = lineup.throws.filter(x => x.id !== active.id);
    if (lineup.throws.length === 0) {
      await dbDelete(lineup.id);
      closeDetailPanel();
    } else {
      await dbPut(lineup);
    }
    await loadLineups();
    if (state.selectedLineupId) openDetail(state.selectedLineupId, Math.max(0, selectedThrowIdx - 1));
  };
  throwList.appendChild(hero);

  // ── THUMBNAIL STRIP ──
  if (lineup.throws.length > 1) {
    const strip = document.createElement("div");
    strip.className = "detail-strip";
    lineup.throws.forEach((t, i) => {
      const thumb = document.createElement("div");
      thumb.className = "detail-strip-thumb" + (i === selectedThrowIdx ? " active" : "");
      const preview = (t.screenshots && t.screenshots[0]) || (t.standing && t.standing[0]) || "";
      thumb.innerHTML = `
        ${preview ? `<img src="${preview}" alt="Variant ${i+1}">` : `<div class="strip-thumb-empty"></div>`}
        <span class="strip-thumb-label">V${String(i+1).padStart(2,"0")}</span>
      `;
      thumb.onclick = () => {
        selectedThrowIdx = i;
        renderDetail(lineup);
      };
      strip.appendChild(thumb);
    });
    throwList.appendChild(strip);
  }
}

function buildHeroHtml(t, idx, lineup) {
  const standingImgs = (t.standing && t.standing.length) ? t.standing : [];
  const aimImgs = (t.screenshots && t.screenshots.length) ? t.screenshots : [];
  const hasImages = standingImgs.length || aimImgs.length || t.precise;

  const makeCarousel = (imgs, label, cssClass) => {
    if (!imgs.length) return "";
    const multi = imgs.length > 1;
    return `
      <div class="tc-carousel" data-class="${cssClass}">
        <div class="tc-carousel-label">${label}</div>
        <div class="tc-carousel-inner">
          <img class="tc-carousel-img ${cssClass}" src="${imgs[0]}" data-imgs='${JSON.stringify(imgs)}' data-idx="0" alt="${label}">
          ${multi ? `<button class="tc-arrow tc-prev" type="button">‹</button>
                     <button class="tc-arrow tc-next" type="button">›</button>
                     <div class="tc-dots">${imgs.map((_,i) => `<span class="tc-dot${i===0?" active":""}"></span>`).join("")}</div>` : ""}
        </div>
      </div>`;
  };

  const preciseHtml = t.precise ? `
    <div class="tc-carousel">
      <div class="tc-carousel-label">Precise</div>
      <div class="tc-carousel-inner">
        <img class="tc-carousel-img" src="${t.precise}" alt="Precise lineup">
      </div>
    </div>` : "";

  return `
    <div class="hero-header">
      <span class="variant-tag">VARIANT ${String(idx+1).padStart(2,"0")}</span>
      <div class="throw-meta">
        <span class="tag">${RANGE_LABELS[t.range] || t.range}</span>
        <span class="tag">${MOVEMENT_LABELS[t.movement] || t.movement}</span>
      </div>
      <div class="throw-card-actions">
        <button class="edit-btn">Edit</button>
        <button class="remove-btn">Remove</button>
      </div>
    </div>
    ${hasImages ? `<div class="tc-galleries hero-galleries">
      ${makeCarousel(standingImgs, "Stand here", "standing-gallery")}
      ${makeCarousel(aimImgs, "Aim here", "aim-gallery")}
      ${preciseHtml}
    </div>` : ""}
    ${t.notes ? `<div class="throw-notes hero-notes">${escapeHtml(t.notes)}</div>` : ""}
  `;
}

function wireCarousels(container, t) {
  const standingImgs = (t.standing && t.standing.length) ? t.standing : [];
  const aimImgs = (t.screenshots && t.screenshots.length) ? t.screenshots : [];

  container.querySelectorAll(".tc-carousel").forEach(carousel => {
    const img = carousel.querySelector(".tc-carousel-img");
    if (!img) return;
    const raw = img.dataset.imgs;
    if (!raw) {
      img.onclick = () => openLightbox([img.src], 0, img.alt);
      return;
    }
    const imgs = JSON.parse(raw);
    const dots = carousel.querySelectorAll(".tc-dot");
    let cur = 0;
    const go = (n) => {
      cur = (n + imgs.length) % imgs.length;
      img.src = imgs[cur];
      img.dataset.idx = cur;
      dots.forEach((d, i) => d.classList.toggle("active", i === cur));
    };
    const prev = carousel.querySelector(".tc-prev");
    const next = carousel.querySelector(".tc-next");
    if (prev) prev.onclick = (e) => { e.stopPropagation(); go(cur - 1); };
    if (next) next.onclick = (e) => { e.stopPropagation(); go(cur + 1); };
    img.onclick = () => openLightbox(imgs, cur, img.alt);
  });
}

function renderDetailType(lineup) {
  const typeInfo = TYPES.find(t => t.id === lineup.type);
  detailType.textContent = typeInfo.label + " ✎";
  detailType.style.color = "#0a0d0e";
  detailType.style.background = getCssVarColor(typeInfo.color);
  detailType.title = "Click to change nade type";
  detailType.onclick = () => {
    if (!requireUnlocked()) return;
    openTypeModalForEdit(lineup);
  };
}

function openTypeModalForEdit(lineup) {
  buildTypeGrid(async (typeId) => {
    closeModal(typeModal);
    lineup.type = typeId;
    await dbPut(lineup);
    await loadLineups();
    openDetail(lineup.id);
  });
  typeModal.classList.add("show");
}

/* ===================== LIGHTBOX ===================== */

let lightboxState = { images: [], index: 0, caption: "" };

function openLightbox(images, index, caption) {
  const valid = (images || []).filter(Boolean);
  if (!valid.length) return;
  lightboxState = { images: valid, index, caption: caption || "" };
  renderLightbox();
  lightboxModal.classList.add("show");
}

function renderLightbox() {
  lightboxImage.src = lightboxState.images[lightboxState.index];
  const multi = lightboxState.images.length > 1;
  lightboxPrev.style.display = multi ? "" : "none";
  lightboxNext.style.display = multi ? "" : "none";
  lightboxCaption.textContent = multi
    ? `${lightboxState.caption} — ${lightboxState.index + 1} / ${lightboxState.images.length}`
    : lightboxState.caption;
}

lightboxPrev.onclick = () => {
  lightboxState.index = (lightboxState.index - 1 + lightboxState.images.length) % lightboxState.images.length;
  renderLightbox();
};
lightboxNext.onclick = () => {
  lightboxState.index = (lightboxState.index + 1) % lightboxState.images.length;
  renderLightbox();
};
lightboxClose.onclick = () => lightboxModal.classList.remove("show");
lightboxModal.addEventListener("click", (e) => {
  if (e.target === lightboxModal) lightboxModal.classList.remove("show");
});
document.addEventListener("keydown", (e) => {
  if (!lightboxModal.classList.contains("show")) return;
  if (e.key === "Escape") lightboxModal.classList.remove("show");
  if (e.key === "ArrowLeft") lightboxPrev.onclick();
  if (e.key === "ArrowRight") lightboxNext.onclick();
});

function closeDetailPanel() {
  state.selectedLineupId = null;
  detailPanel.classList.remove("open");
  renderMarkers();
}
closeDetail.onclick = closeDetailPanel;
detailPanel.addEventListener("click", (e) => {
  if (e.target === detailPanel) closeDetailPanel();
});

addThrowBtn.onclick = () => {
  if (!requireUnlocked()) return;
  state.pendingThrowFor = state.selectedLineupId;
  setAddMode(true);
  addHint.textContent = "Click the spot you throw from.";
  detailPanel.classList.remove("open");
};

deleteLineupBtn.onclick = async () => {
  if (!requireUnlocked()) return;
  if (!state.selectedLineupId) return;
  if (!confirm("Delete this entire lineup, including all throw positions?")) return;
  await dbDelete(state.selectedLineupId);
  closeDetailPanel();
  await loadLineups();
};

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

/* ===================== EXPORT / IMPORT / CLEAR ===================== */

exportBtn.onclick = async () => {
  const all = await dbGetAll();
  const blob = new Blob([JSON.stringify(all, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "lineups-backup.json";
  a.click();
  URL.revokeObjectURL(url);
};

importInput.onchange = async () => {
  if (!requireUnlocked()) { importInput.value = ""; return; }
  const file = importInput.files[0];
  if (!file) return;
  const text = await file.text();
  try {
    const records = JSON.parse(text);
    await dbImportBulk(records);
    await loadLineups();
    alert(`Imported ${records.length} lineups.`);
  } catch (err) {
    alert("Could not import that backup: " + err.message);
  }
  importInput.value = "";
};

/* ===================== BOOT ===================== */

backBtn.onclick = goHome;

async function loadConfig() {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch("/api/config");
      if (!res.ok) continue;
      const cfg = await res.json();
      if (cfg.supabaseUrl && cfg.supabaseAnonKey) {
        window.__SUPABASE_URL      = cfg.supabaseUrl;
        window.__SUPABASE_ANON_KEY = cfg.supabaseAnonKey;
        return true;
      }
    } catch (e) { console.warn("Config attempt", attempt + 1, "failed:", e); }
  }
  return false;
}

buildSidebar();
buildFilters();
applyLockState();
loadConfig().then(() => buildHomeScreen());
