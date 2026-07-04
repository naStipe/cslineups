/* ===================== AUTH (Supabase Auth) ===================== */

let sbClient = null;      // supabase-js client, created once config is loaded
let authUser = null;      // current auth.users row (or null when signed out)
let authProfile = null;   // { is_admin } from public.profiles
let authReady = false;    // true once the initial session restore has resolved

function getAuthClient() {
  if (!sbClient) {
    sbClient = window.supabase.createClient(window.__SUPABASE_URL, window.__SUPABASE_ANON_KEY);
  }
  return sbClient;
}

async function getAccessToken() {
  if (!authUser) return null;
  const sb = getAuthClient();
  const { data } = await sb.auth.getSession();
  return data && data.session ? data.session.access_token : null;
}

function authHeaders() {
  return getAccessToken().then(token => token ? { "Authorization": `Bearer ${token}` } : {});
}

async function refreshProfile() {
  if (!authUser) { authProfile = null; return; }
  const sb = getAuthClient();
  const { data, error } = await sb.from("profiles").select("is_admin").eq("id", authUser.id).maybeSingle();
  authProfile = error ? { is_admin: false } : { is_admin: !!(data && data.is_admin) };
}

function isAdmin() {
  return !!(authProfile && authProfile.is_admin);
}

async function signUpWithPassword(email, password) {
  const sb = getAuthClient();
  const { error } = await sb.auth.signUp({ email, password });
  if (error) throw error;
}

async function signInWithPassword(email, password) {
  const sb = getAuthClient();
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

async function signInWithGoogle() {
  const sb = getAuthClient();
  const { error } = await sb.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: window.location.origin + window.location.pathname,
      queryParams: { prompt: "select_account" },
    },
  });
  if (error) throw error;
}

async function signOut() {
  const sb = getAuthClient();
  await sb.auth.signOut();
}

async function initAuth() {
  const sb = getAuthClient();
  const { data } = await sb.auth.getSession();
  authUser = data && data.session ? data.session.user : null;
  await refreshProfile();
  authReady = true;
  applyAuthState();

  sb.auth.onAuthStateChange(async (_event, session) => {
    authUser = session ? session.user : null;
    await refreshProfile();
    applyAuthState();
    // Personal view depends entirely on being signed in — bounce back to
    // the official view (and reload) whenever auth state changes under it.
    if (state.viewMode === "personal" && !authUser) setViewMode("official");
    else if (appShell && !appShell.hasAttribute("hidden")) loadLineups();
  });
}

function applyAuthState() {
  document.body.classList.toggle("signed-in", !!authUser);
  document.body.classList.toggle("is-admin", isAdmin());
  if (authEmailLabel) authEmailLabel.textContent = authUser ? authUser.email : "";
  if (personalViewBtn) personalViewBtn.classList.toggle("hidden", !authUser);
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
  "crouchjump":            "Crouch + Jumpthrow",
  "crouchaim-jump":        "Crouch-aim + Jumpthrow",
  "crouchaim-crouchjump":  "Crouch-aim + Crouch-Jumpthrow",
};

/* ===================== STORAGE (Vercel Function API) ===================== */

const API_URL = "/api/lineups";
const SAVED_URL = "/api/saved-lineups";

// Official lineups for the current map — public, no auth required.
async function dbGetAll() {
  const res = await fetch(`${API_URL}?mapId=${encodeURIComponent(state.mapId)}`);
  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(`Failed to load lineups (${res.status}): ${msg}`);
  }
  return res.json();
}

async function dbGetAllMaps() {
  // Fetch official lineups across every map, for export
  const res = await fetch(API_URL);
  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(`Failed to fetch all lineups (${res.status}): ${msg}`);
  }
  return res.json();
}

// The signed-in user's own personal (non-official) lineups for the current map.
async function dbGetMine() {
  const headers = await authHeaders();
  const res = await fetch(`${API_URL}?mapId=${encodeURIComponent(state.mapId)}&mine=true`, { headers });
  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(`Failed to load your lineups (${res.status}): ${msg}`);
  }
  return res.json();
}

// Full lineup records the user has bookmarked from the official set, for the current map.
async function dbGetSaved() {
  const headers = await authHeaders();
  const res = await fetch(`${SAVED_URL}?mapId=${encodeURIComponent(state.mapId)}`, { headers });
  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(`Failed to load saved lineups (${res.status}): ${msg}`);
  }
  return res.json();
}

async function dbSaveLineup(lineupId, throwId) {
  const headers = await authHeaders();
  const res = await fetch(SAVED_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ lineupId, throwId }),
  });
  if (!res.ok) throw new Error("Failed to save this throw position to your map");
}

async function dbUnsaveLineup(lineupId, throwId) {
  const headers = await authHeaders();
  const res = await fetch(`${SAVED_URL}?lineupId=${encodeURIComponent(lineupId)}&throwId=${encodeURIComponent(throwId)}`, {
    method: "DELETE",
    headers,
  });
  if (!res.ok) throw new Error("Failed to remove this throw position from your map");
}

// Composite key used to track which individual throw positions (not whole
// lineups) the signed-in user has bookmarked.
function throwKey(lineupId, throwId) {
  return `${lineupId}::${throwId}`;
}

// dbGetSaved() already returns each lineup with `.throws` filtered down to
// just the bookmarked ones — every throw present there is, by definition, saved.
function buildSavedThrowKeys(savedLineups) {
  const keys = new Set();
  savedLineups.forEach(l => l.throws.forEach(t => keys.add(throwKey(l.id, t.id))));
  return keys;
}

async function dbPut(record, isOfficial) {
  const headers = await authHeaders();
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ ...record, isOfficial: !!isOfficial }),
  });
  if (res.status === 401) throw new Error("SIGN_IN_REQUIRED");
  if (res.status === 403) throw new Error("FORBIDDEN");
  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(`Failed to save lineup (${res.status}): ${msg}`);
  }
  return res.json();
}

async function dbDelete(id) {
  const headers = await authHeaders();
  const res = await fetch(`${API_URL}?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers,
  });
  if (res.status === 401) throw new Error("SIGN_IN_REQUIRED");
  if (res.status === 403) throw new Error("FORBIDDEN");
  if (!res.ok) throw new Error("Failed to delete lineup");
}

async function dbImportBulk(records) {
  const headers = await authHeaders();
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ records }),
  });
  if (res.status === 401) throw new Error("SIGN_IN_REQUIRED");
  if (res.status === 403) throw new Error("FORBIDDEN");
  if (!res.ok) throw new Error("Failed to import lineups");
}

/* ===================== STATE ===================== */

let state = {
  mapId: MAPS[0].id,
  viewMode: "official",  // "official" (public map) or "personal" (signed-in user's own map)
  lineups: [],          // all lineups for current map + view, loaded from DB
  savedThrowKeys: new Set(), // `${lineupId}::${throwId}` for every individual throw position the user has bookmarked
  activeFilters: new Set(TYPES.map(t => t.id)),
  pendingType: null,
  pendingName: "",     // type chosen in type modal, awaiting landing click
  pendingLanding: null,  // {x,y} percent, awaiting throw-pos click for a NEW lineup
  pendingThrowFor: null, // lineup id awaiting a throw-pos click (adding to existing lineup)
  selectedLineupId: null,
  addMode: false,
  openClusterKey: null,  // key of a stacked marker currently fanned open on the map
};

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/* ===================== DOM REFS ===================== */

const mapList = document.getElementById("mapList");
const homeScreen = document.getElementById("homeScreen");
const homeGrid = document.getElementById("homeGrid");
const appShell = document.getElementById("appShell");
const backBtn = document.getElementById("backBtn");
const mobileMenuBtn = document.getElementById("mobileMenuBtn");
const sidebar = document.getElementById("sidebar");
const sidebarOverlay = document.getElementById("sidebarOverlay");
const mapLoading = document.getElementById("mapLoading");
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
const tmPreviewImg = document.getElementById("tmPreviewImg");
const tmPreviewSvg = document.getElementById("tmPreviewSvg");
const tmPreviewLanding = document.getElementById("tmPreviewLanding");
const tmPreviewThrow = document.getElementById("tmPreviewThrow");
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
const detailOwnerBadge = document.getElementById("detailOwnerBadge");
const detailTitle = document.getElementById("detailTitle");
const detailNameInput = document.getElementById("detailNameInput");
const throwList = document.getElementById("throwList");
const closeDetail = document.getElementById("closeDetail");
const addThrowBtn = document.getElementById("addThrowBtn");
const deleteLineupBtn = document.getElementById("deleteLineupBtn");
const saveLineupBtn = document.getElementById("saveLineupBtn");

const exportBtn = document.getElementById("exportBtn");

const signInBtn = document.getElementById("signInBtn");
const signOutBtn = document.getElementById("signOutBtn");
const authEmailLabel = document.getElementById("authEmailLabel");
const officialViewBtn = document.getElementById("officialViewBtn");
const personalViewBtn = document.getElementById("personalViewBtn");

const authModal = document.getElementById("authModal");
const authModalTitle = document.getElementById("authModalTitle");
const authError = document.getElementById("authError");
const authEmailInput = document.getElementById("authEmailInput");
const authPasswordInput = document.getElementById("authPasswordInput");
const authSubmitBtn = document.getElementById("authSubmitBtn");
const authGoogleBtn = document.getElementById("authGoogleBtn");
const authSwitchText = document.getElementById("authSwitchText");
const authSwitchLink = document.getElementById("authSwitchLink");
const cancelAuth = document.getElementById("cancelAuth");

let pendingThrowDraft = null; // {x,y,screenshot,...} being built before save

/* ===================== HOME SCREEN ===================== */

async function buildHomeScreen() {
  homeGrid.innerHTML = "";
  const inner = document.createElement("div");
  inner.className = "home-grid-inner";

  // Single request for all map counts
  let counts = {};
  try {
    const res = await fetch(`${API_URL}?counts=true`);
    if (res.ok) counts = await res.json();
  } catch (e) { /* counts stay 0 */ }

  MAPS.forEach(m => {
    const count = counts[m.id] || 0;
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
  closeSidebar();
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

function clampPan() {
  if (zoom <= 1) { panX = 0; panY = 0; return; }
  const sw = mapStage.clientWidth;
  const sh = mapStage.clientHeight;
  const fw = mapFrame.offsetWidth;
  const fh = mapFrame.offsetHeight;
  // Scaled frame size
  const scaledW = fw * zoom;
  const scaledH = fh * zoom;
  // The frame center is at (sw/2 + panX, sh/2 + panY)
  // Keep at least 20% of the frame visible in each direction
  const minVisible = 60; // px of frame that must stay on screen
  const maxPanX = sw / 2 - minVisible + scaledW / 2;
  const minPanX = -(sw / 2 - minVisible + scaledW / 2);
  const maxPanY = sh / 2 - minVisible + scaledH / 2;
  const minPanY = -(sh / 2 - minVisible + scaledH / 2);
  panX = Math.min(maxPanX, Math.max(minPanX, panX));
  panY = Math.min(maxPanY, Math.max(minPanY, panY));
}

function applyTransform(rerender = true) {
  clampPan();
  mapFrame.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
  // Scale markers inversely so they appear the same size on screen regardless of zoom
  const markerScale = 1 / zoom;
  document.documentElement.style.setProperty("--marker-scale", markerScale);
  mapStage.style.cursor = zoom > 1 ? "grab" : "";
  if (rerender) renderMarkers(false);  // re-cluster on zoom, but no enter/exit animation (avoids flicker)
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

// Touch: single-finger pan + two-finger pinch zoom
let lastTouchDist = null;
let touchPanActive = false;
let touchStartX = 0, touchStartY = 0;
let hasTouchMoved = false;

mapStage.addEventListener("touchstart", (e) => {
  if (e.touches.length === 2) {
    // Pinch start
    lastTouchDist = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY
    );
    touchPanActive = false;
  } else if (e.touches.length === 1) {
    // Single finger — potential pan or tap
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    hasTouchMoved = false;
    // Allow pan when zoomed (and not in add/throw mode)
    if (zoom > 1 && !state.addMode && !state.pendingThrowFor) {
      touchPanActive = true;
      dragPanX = panX;
      dragPanY = panY;
    }
  }
}, { passive: true });

mapStage.addEventListener("touchmove", (e) => {
  if (e.touches.length === 2 && lastTouchDist) {
    // Pinch zoom
    const dist = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY
    );
    const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
    const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    zoomAt(midX, midY, dist / lastTouchDist);
    lastTouchDist = dist;
    e.preventDefault();
  } else if (e.touches.length === 1 && touchPanActive) {
    // Single-finger pan
    const dx = e.touches[0].clientX - touchStartX;
    const dy = e.touches[0].clientY - touchStartY;
    if (Math.hypot(dx, dy) > 6) hasTouchMoved = true;
    panX = dragPanX + dx;
    panY = dragPanY + dy;
    applyTransform(false);
    e.preventDefault();
  }
}, { passive: false });

mapStage.addEventListener("touchend", () => {
  lastTouchDist = null;
  touchPanActive = false;
});

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
    el.onclick = () => { closeSidebar(); selectMap(m.id); };
    mapList.appendChild(el);
  });
}

function buildFilters() {
  typeFilters.innerHTML = "";
  TYPES.forEach(t => {
    const count = state.lineups.filter(l => l.type === t.id).length;
    const chip = document.createElement("div");
    chip.className = "filter-chip" + (state.activeFilters.has(t.id) ? "" : " off");
    chip.style.setProperty("--chip-color", t.color);
    chip.innerHTML = `<span class="dot" style="background:${t.color}"></span>${t.label}<span class="chip-count">${count}</span>`;
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
  renderedThrowSig = null;
  detailPanel.classList.remove("open");
  setAddMode(false);
  resetZoom();
  buildSidebar();
  const m = MAPS.find(x => x.id === id);
  currentMapName.textContent = m.name.toUpperCase();
  mapImage.src = m.file;
  updateCheatsheet(id);
  if (!authUser && state.viewMode === "personal") state.viewMode = "official";
  if (officialViewBtn) officialViewBtn.classList.toggle("active", state.viewMode === "official");
  if (personalViewBtn) personalViewBtn.classList.toggle("active", state.viewMode === "personal");
  await loadLineups();
}

let loadToken = 0;

async function loadLineups() {
  const myToken = ++loadToken;

  if (state.viewMode === "personal" && !authUser) {
    setViewMode("official");
    return;
  }

  lineupCount.textContent = "loading…";
  showMapLoading(true);
  try {
    let lineups;
    if (state.viewMode === "personal") {
      const [mine, saved] = await Promise.all([dbGetMine(), dbGetSaved()]);
      state.savedThrowKeys = buildSavedThrowKeys(saved);
      lineups = [...mine, ...saved];
    } else {
      lineups = await dbGetAll();
      if (authUser) {
        dbGetSaved()
          .then(saved => { state.savedThrowKeys = buildSavedThrowKeys(saved); })
          .catch(() => {});
      }
    }
    if (myToken !== loadToken) return;
    state.lineups = lineups;
    lineupCount.textContent = `${lineups.length} lineup${lineups.length === 1 ? "" : "s"}`;
    buildFilters();
    renderMarkers();
  } catch (err) {
    if (myToken !== loadToken) return;
    lineupCount.textContent = "load failed";
    console.error(err);
  } finally {
    if (myToken === loadToken) showMapLoading(false);
  }
}

// Refresh the UI from the in-memory state.lineups after an edit — no network
// round-trip and no loading overlay, so adds/deletes take effect instantly.
function refreshLocal() {
  lineupCount.textContent = `${state.lineups.length} lineup${state.lineups.length === 1 ? "" : "s"}`;
  buildFilters();
  renderMarkers();
}

// Insert or replace a lineup in the local cache by id.
function upsertLocalLineup(lineup) {
  const idx = state.lineups.findIndex(l => l.id === lineup.id);
  if (idx >= 0) state.lineups[idx] = lineup;
  else state.lineups.push(lineup);
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

/* ===================== PERMISSIONS ===================== */

function canModifyLineup(lineup) {
  if (!authUser || !lineup) return false;
  if (lineup.isOfficial) return isAdmin();
  return lineup.ownerId === authUser.id;
}

// Creating a brand-new lineup: official view needs an admin, personal view
// just needs to be signed in.
function requireCanCreate() {
  if (!authUser) { openAuthModal("signin"); return false; }
  if (state.viewMode === "official" && !isAdmin()) {
    alert('Only admins can add official lineups. Switch to "My Map" to add your own.');
    return false;
  }
  return true;
}

// Editing/renaming/deleting an existing lineup.
function requireLineupEditable(lineup) {
  if (!authUser) { openAuthModal("signin"); return false; }
  if (!canModifyLineup(lineup)) {
    alert(lineup && lineup.isOfficial
      ? "Only admins can edit official lineups."
      : "You can only edit your own lineups.");
    return false;
  }
  return true;
}

addModeBtn.onclick = () => {
  if (!requireCanCreate()) return;
  setAddMode(true);
  openTypeModal((typeId) => {
    state.pendingType = typeId;
    state.pendingName = lineupNameInput ? lineupNameInput.value.trim() : "";
    closeModal(typeModal);
    addHint.textContent = "Now click where this nade lands.";
  });
};

/* ===================== VIEW MODE (Official / My Map) ===================== */

function setViewMode(mode) {
  if (mode === "personal" && !authUser) { openAuthModal("signin"); return; }
  state.viewMode = mode;
  if (officialViewBtn) officialViewBtn.classList.toggle("active", mode === "official");
  if (personalViewBtn) personalViewBtn.classList.toggle("active", mode === "personal");
  state.selectedLineupId = null;
  closeDetailPanel();
  loadLineups();
}
if (officialViewBtn) officialViewBtn.onclick = () => setViewMode("official");
if (personalViewBtn) personalViewBtn.onclick = () => setViewMode("personal");

/* ===================== AUTH MODAL ===================== */

let authMode = "signin";

function openAuthModal(mode) {
  authMode = mode || "signin";
  updateAuthModalMode();
  authError.hidden = true;
  authError.classList.remove("info");
  authEmailInput.value = "";
  authPasswordInput.value = "";
  authModal.classList.add("show");
}
function updateAuthModalMode() {
  const isSignup = authMode === "signup";
  authModalTitle.textContent = isSignup ? "Create account" : "Sign in";
  authSubmitBtn.textContent = isSignup ? "Sign up" : "Sign in";
  authSwitchText.textContent = isSignup ? "Already have an account?" : "Don't have an account?";
  authSwitchLink.textContent = isSignup ? "Sign in" : "Sign up";
}
authSwitchLink.onclick = (e) => {
  e.preventDefault();
  authMode = authMode === "signup" ? "signin" : "signup";
  updateAuthModalMode();
};
cancelAuth.onclick = () => closeModal(authModal);

authSubmitBtn.onclick = async () => {
  const email = authEmailInput.value.trim();
  const password = authPasswordInput.value;
  if (!email || !password) {
    authError.textContent = "Enter an email and password.";
    authError.hidden = false;
    return;
  }
  authSubmitBtn.disabled = true;
  try {
    if (authMode === "signup") {
      await signUpWithPassword(email, password);
      authError.textContent = "Check your email to confirm your account, then sign in.";
      authError.classList.add("info");
      authError.hidden = false;
    } else {
      await signInWithPassword(email, password);
      closeModal(authModal);
    }
  } catch (err) {
    authError.classList.remove("info");
    authError.textContent = (err && err.message) || "Something went wrong.";
    authError.hidden = false;
  } finally {
    authSubmitBtn.disabled = false;
  }
};

authGoogleBtn.onclick = async () => {
  try { await signInWithGoogle(); } catch (err) { alert((err && err.message) || "Google sign-in failed."); }
};

signInBtn.onclick = () => openAuthModal("signin");
signOutBtn.onclick = async () => { await signOut(); };

mapFrame.addEventListener("click", (e) => {
  const rect = mapImage.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * 100;
  const y = ((e.clientY - rect.top) / rect.height) * 100;
  if (x < 0 || x > 100 || y < 0 || y > 100) return;

  if (state.openClusterKey) {
    state.openClusterKey = null;
    renderMarkers();
    return;
  }

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
    if (hasDragged || hasTouchMoved) { hasDragged = false; hasTouchMoved = false; return; }
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

function renderThrowModalPreview(throwPos, landingPos, typeId) {
  tmPreviewImg.src = mapImage.src;
  const color = getCssVarColor(typeColor(typeId));
  tmPreviewThrow.style.background = color;

  const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line.setAttribute("x1", throwPos.x + "%");
  line.setAttribute("y1", throwPos.y + "%");
  line.setAttribute("x2", landingPos.x + "%");
  line.setAttribute("y2", landingPos.y + "%");
  line.setAttribute("stroke", color);
  line.setAttribute("class", "tm-preview-line");
  tmPreviewSvg.innerHTML = "";
  tmPreviewSvg.appendChild(line);

  tmPreviewLanding.style.left = landingPos.x + "%";
  tmPreviewLanding.style.top = landingPos.y + "%";
  tmPreviewThrow.style.left = throwPos.x + "%";
  tmPreviewThrow.style.top = throwPos.y + "%";
}

function openThrowModal(throwPos, lineupId, isNewLineup, typeId, landingPos, existingThrow) {
  const existingLineup = !isNewLineup ? state.lineups.find(l => l.id === lineupId) : null;
  landingPos = landingPos || (existingLineup && existingLineup.landing);
  typeId = typeId || (existingLineup && existingLineup.type);
  renderThrowModalPreview(throwPos, landingPos, typeId);

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
  if (pendingThrowDraft.isNewLineup) {
    if (!requireCanCreate()) return;
  } else {
    const existingLineup = state.lineups.find(l => l.id === pendingThrowDraft.lineupId);
    if (!requireLineupEditable(existingLineup)) return;
  }
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
      const isOfficial = state.viewMode === "official" && isAdmin();
      const lineup = {
        id: draft.lineupId,
        mapId: state.mapId,
        type: draft.typeId,
        name: state.pendingName || "",
        landing: draft.landingPos,
        throws: [{ id: uid(), ...throwEntryBase }],
        createdAt: Date.now(),
        isOfficial,
        ownerId: isOfficial ? null : (authUser ? authUser.id : null),
      };
      await dbPut(lineup, isOfficial);
      upsertLocalLineup(lineup);
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
      await dbPut(lineup, lineup.isOfficial);
      upsertLocalLineup(lineup);
    }

    const wasEditing = !!draft.editingThrowId;
    const reopenId = draft.lineupId;

    closeModal(throwModal);
    pendingThrowDraft = null;
    setAddMode(false);
    state.pendingThrowFor = null;
    refreshLocal();

    // If we were editing an existing throw, reopen the dossier so changes are visible immediately
    if (wasEditing) openDetail(reopenId);
  } catch (err) {
    console.error(err);
    alert(
      err && err.message === "SIGN_IN_REQUIRED" ? "Please sign in first." :
      err && err.message === "FORBIDDEN"        ? "You don't have permission to do that." :
      "Could not save: " + (err && err.message ? err.message : err)
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

// Builds a pie-chart style conic-gradient for a marker representing several
// different lineup types clustered at the same spot, e.g. { flash: 1, fire: 1, smoke: 1 }
// -> "conic-gradient(var(--flash) 0deg 120deg, var(--fire) 120deg 240deg, var(--smoke) 240deg 360deg)"
function buildPieGradient(typeCounts) {
  const total = Object.values(typeCounts).reduce((a, b) => a + b, 0);
  let angle = 0;
  const stops = [];
  TYPES.forEach(t => {
    const c = typeCounts[t.id];
    if (!c) return;
    const start = angle;
    angle += (c / total) * 360;
    stops.push(`${t.color} ${start}deg ${angle}deg`);
  });
  return `conic-gradient(${stops.join(", ")})`;
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

function clusterKey(cluster) {
  // Include each lineup's throw count so that saving/removing an individual
  // throw position (which changes the marker's badge number) counts as a
  // real change in cluster identity — otherwise the reconciler below sees
  // "same lineup ids here" and leaves the stale marker/badge in place.
  return cluster.lineups.map(l => `${l.id}:${l.throws.length}`).sort().join(",");
}

// Fans a stacked marker out into one petal per lineup, arranged evenly around
// the hub. Clicking a petal collapses the fan back into the hub, then opens
// that lineup exactly like a normal single-marker selection.
function renderClusterFan(cluster, key, animate = true) {
  const count = cluster.lineups.length;
  const radius = 46;
  const lineRadius = 28;
  const startAngle = -90;
  const step = 360 / count;

  const wrap = document.createElement("div");
  wrap.className = "cluster-fan";
  wrap.style.left = cluster.x + "%";
  wrap.style.top = cluster.y + "%";

  const hub = document.createElement("div");
  hub.className = "marker landing fan-hub";
  const sameType = cluster.lineups.every(l => l.type === cluster.lineups[0].type);
  if (sameType) {
    hub.classList.add(cluster.lineups[0].type);
  } else {
    const typeCounts = {};
    cluster.lineups.forEach(l => { typeCounts[l.type] = (typeCounts[l.type] || 0) + 1; });
    hub.style.background = buildPieGradient(typeCounts);
  }
  const badge = document.createElement("span");
  badge.className = "marker-badge";
  badge.textContent = count;
  hub.appendChild(badge);
  wrap.appendChild(hub);

  const lineEls = [];
  const petalEls = [];

  cluster.lineups.forEach((lineup, i) => {
    const angle = startAngle + i * step;
    const rad = angle * Math.PI / 180;
    const dx = Math.round(Math.cos(rad) * radius);
    const dy = Math.round(Math.sin(rad) * radius);

    const openPetal = `translate(-50%,-50%) translate(${dx}px, ${dy}px) scale(1)`;
    const shutPetal = "translate(-50%,-50%) translate(0,0) scale(.3)";

    const line = document.createElement("div");
    line.className = "fan-petal-line";
    line.style.width = lineRadius + "px";
    line.style.transform = `rotate(${angle}deg) scaleX(${animate ? 0 : 1})`;
    wrap.appendChild(line);
    lineEls.push({ el: line, angle });

    const petal = document.createElement("div");
    petal.className = "fan-petal" + (animate ? "" : " show");
    petal.style.transform = animate ? shutPetal : openPetal;
    const typeInfo = TYPES.find(t => t.id === lineup.type);
    const label = lineup.name || `${typeInfo.label} #${i + 1}`;
    const dot = document.createElement("div");
    dot.className = "fan-petal-dot";
    dot.style.background = typeInfo.color;
    dot.style.color = getCssVarColor(typeInfo.color);  // for the currentColor hover glow
    const labelEl = document.createElement("div");
    labelEl.className = "fan-petal-label";
    labelEl.textContent = label;
    petal.appendChild(dot);
    petal.appendChild(labelEl);
    petal.onclick = (e) => {
      e.stopPropagation();
      collapseFan(wrap, lineEls, petalEls, () => {
        state.openClusterKey = null;
        state.selectedLineupId = lineup.id;
        renderMarkers();
      });
    };
    wrap.appendChild(petal);
    petalEls.push({ el: petal, dx, dy });
  });

  hub.onclick = (e) => {
    e.stopPropagation();
    // Re-show every other marker immediately, then let the petals retract on top.
    state.openClusterKey = null;
    wrap.remove();                    // keep the fan out of the way of the rebuild
    renderMarkers();                  // other markers reappear right away (fade-in)
    markerLayer.appendChild(wrap);    // put the collapsing fan back on top
    collapseFan(wrap, lineEls, petalEls, () => wrap.remove());
  };

  markerLayer.appendChild(wrap);

  if (!animate) {
    // Already rendered in the open position — no entrance animation (e.g. zoom re-cluster).
    wrap.classList.add("open");
    return;
  }

  requestAnimationFrame(() => {
    wrap.classList.add("open");
    lineEls.forEach(({ el, angle }) => { el.style.transform = `rotate(${angle}deg) scaleX(1)`; });
    petalEls.forEach(({ el, dx, dy }) => {
      el.classList.add("show");
      el.style.transform = `translate(-50%,-50%) translate(${dx}px, ${dy}px) scale(1)`;
    });
  });
}

function collapseFan(wrap, lineEls, petalEls, onDone) {
  wrap.classList.remove("open");
  lineEls.forEach(({ el, angle }) => { el.style.transform = `rotate(${angle}deg) scaleX(0)`; });
  petalEls.forEach(({ el }) => {
    el.classList.remove("show");
    el.style.transform = "translate(-50%,-50%) translate(0,0) scale(.3)";
  });
  setTimeout(onDone, 320);
}

let renderedThrowSig = null;

// Reconciling renderer: landing markers are keyed by their cluster (the set of
// lineup ids stacked there). Markers whose cluster is unchanged are left in the
// DOM untouched — only clusters that actually appear or disappear animate. This
// keeps unrelated markers from flickering when a filter is toggled or on zoom.
function renderMarkers(animate = true) {
  const visible = state.lineups.filter(l => state.activeFilters.has(l.type));
  const clusters = clusterLineups(visible);

  // Work out what should be on the map right now.
  const desiredLandings = new Map();   // key -> { cluster, isPinned }
  let desiredFanKey = null, fanCluster = null;
  let pinnedCluster = null;

  for (const cluster of clusters) {
    const key = clusterKey(cluster);
    if (state.openClusterKey && state.openClusterKey !== key) continue;
    if (cluster.lineups.length > 1 && state.openClusterKey === key) {
      desiredFanKey = key; fanCluster = cluster; continue;
    }
    const isPinned = cluster.lineups.some(l => l.id === state.selectedLineupId);
    if (state.selectedLineupId && !isPinned) continue;
    desiredLandings.set(key, { cluster, isPinned });
    if (isPinned) pinnedCluster = cluster;
  }

  // --- Fan wrap ---
  let fanKept = false;
  markerLayer.querySelectorAll(":scope > .cluster-fan").forEach(el => {
    if (el.dataset.mkey === desiredFanKey) fanKept = true;
    else el.remove();
  });
  if (desiredFanKey && !fanKept) renderClusterFan(fanCluster, desiredFanKey, animate);

  // --- Landing markers: keep matching keys, drop the rest, add the new ones ---
  let pinnedLandingEl = null;
  const seen = new Set();
  markerLayer.querySelectorAll(":scope > .marker.landing:not(.fan-hub)").forEach(el => {
    const key = el.dataset.mkey;
    const d = desiredLandings.get(key);
    if (d && !seen.has(key)) {
      // Keep it, or revive one that was mid fade-out (e.g. rapid fan open→close),
      // so we don't stack a second fading-in copy on top of it.
      seen.add(key);
      if (el._leaveTimer) { clearTimeout(el._leaveTimer); el._leaveTimer = null; }
      el.classList.remove("leaving");
      el.classList.toggle("pinned", !!d.isPinned);
      if (d.isPinned) pinnedLandingEl = el;
    } else {
      if (el.classList.contains("leaving")) return;  // already fading out
      if (animate) { el.classList.add("leaving"); el._leaveTimer = setTimeout(() => el.remove(), 200); }
      else el.remove();
    }
  });
  desiredLandings.forEach((d, key) => {
    if (seen.has(key)) return;
    const el = buildLandingMarker(d.cluster, key, d.isPinned, animate);
    markerLayer.appendChild(el);
    if (d.isPinned) pinnedLandingEl = el;
  });

  // --- Throw positions + link lines: only rebuild when the selection changes ---
  const openLineup = pinnedCluster && pinnedCluster.lineups.find(l => l.id === state.selectedLineupId);
  const throwSig = openLineup
    ? openLineup.id + "|" + openLineup.throws.map(t => `${t.pos.x},${t.pos.y}`).join(";")
    : null;
  if (throwSig !== renderedThrowSig) {
    markerLayer.querySelectorAll(":scope > .marker.throwpos").forEach(el => el.remove());
    linkSvg.innerHTML = "";
    if (openLineup && pinnedLandingEl) buildThrows(openLineup, pinnedLandingEl, animate);
    renderedThrowSig = throwSig;
  }
}

function buildLandingMarker(cluster, key, isPinned, animate) {
  const count = cluster.lineups.length;
  const sameType = count === 1 || cluster.lineups.every(l => l.type === cluster.lineups[0].type);
  const colorClass = sameType ? cluster.lineups[0].type : "multi";

  const landing = document.createElement("div");
  landing.className = `marker landing ${colorClass}${isPinned ? " pinned" : ""}${animate ? " enter" : ""}`;
  if (animate) landing.addEventListener("animationend", () => landing.classList.remove("enter"), { once: true });
  landing.dataset.mkey = key;
  landing.style.left = cluster.x + "%";
  landing.style.top = cluster.y + "%";

  if (!sameType) {
    const typeCounts = {};
    cluster.lineups.forEach(l => { typeCounts[l.type] = (typeCounts[l.type] || 0) + 1; });
    landing.style.background = buildPieGradient(typeCounts);
  }

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
      state.openClusterKey = key;
      renderMarkers();
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
  return landing;
}

function buildThrows(openLineup, landingEl, animate) {
  const lines = [];
  openLineup.throws.forEach((t, throwIdx) => {
    const tp = document.createElement("div");
    tp.className = `marker throwpos ${openLineup.type}${animate ? " enter" : ""}`;
    if (animate) tp.addEventListener("animationend", () => tp.classList.remove("enter"), { once: true });
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
    const linkColor = getCssVarColor(typeColor(openLineup.type));
    line.setAttribute("stroke", linkColor);
    line.style.color = linkColor;
    line.setAttribute("class", "link-line");
    linkSvg.appendChild(line);
    lines.push(line);

    // Glow only the path for the hovered throw position.
    tp.onmouseenter = () => line.classList.add("glow");
    tp.onmouseleave = () => line.classList.remove("glow");
  });

  // Hovering the lineup marker itself glows all of its paths (onmouseenter
  // property assignment overwrites cleanly if the landing element is reused).
  landingEl.onmouseenter = () => lines.forEach(l => l.classList.add("glow"));
  landingEl.onmouseleave = () => lines.forEach(l => l.classList.remove("glow"));
}

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
  const editable = canModifyLineup(lineup);
  const canBookmark = state.viewMode === "official" && lineup.isOfficial && !!authUser;
  const isBookmarkedRef = state.viewMode === "personal" && lineup.isOfficial;

  renderDetailType(lineup, editable);
  detailTitle.textContent = `${lineup.throws.length} variant${lineup.throws.length === 1 ? "" : "s"}`;

  if (detailOwnerBadge) {
    detailOwnerBadge.textContent = lineup.isOfficial ? "Official" : "My lineup";
    detailOwnerBadge.classList.toggle("badge-official", lineup.isOfficial);
    detailOwnerBadge.classList.toggle("badge-personal", !lineup.isOfficial);
  }

  addThrowBtn.classList.toggle("hidden", !editable);
  // Whole-lineup delete only applies to content you actually own/administer.
  // Bookmarked references are removed one throw position at a time instead
  // (see the per-throw button in the hero card below).
  deleteLineupBtn.classList.toggle("hidden", !editable);
  deleteLineupBtn.textContent = "Delete this lineup";

  if (saveLineupBtn) saveLineupBtn.classList.add("hidden"); // superseded by the per-throw button in the hero card

  // Name field
  detailNameInput.value = lineup.name || "";
  detailNameInput.disabled = !editable;
  detailNameInput.onchange = async () => {
    if (!editable) { detailNameInput.value = lineup.name || ""; return; }
    lineup.name = detailNameInput.value.trim();
    await dbPut(lineup, lineup.isOfficial);
    refreshLocal();
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
  const heroEditBtn = hero.querySelector(".edit-btn");
  const heroRemoveBtn = hero.querySelector(".remove-btn");
  const heroSaveBtn = hero.querySelector(".save-btn");
  if (editable) {
    heroEditBtn.onclick = () => {
      openThrowModal(active.pos, lineup.id, false, lineup.type, lineup.landing, active);
    };
    heroRemoveBtn.onclick = async () => {
      lineup.throws = lineup.throws.filter(x => x.id !== active.id);
      if (lineup.throws.length === 0) {
        await dbDelete(lineup.id);
        state.lineups = state.lineups.filter(l => l.id !== lineup.id);
        closeDetailPanel();
      } else {
        await dbPut(lineup, lineup.isOfficial);
        upsertLocalLineup(lineup);
      }
      refreshLocal();
      if (state.selectedLineupId) openDetail(state.selectedLineupId, Math.max(0, selectedThrowIdx - 1));
    };
  } else {
    heroEditBtn.style.display = "none";
    heroRemoveBtn.style.display = "none";
  }

  // Bookmarking works per throw position, not per whole lineup: in the
  // official view, any signed-in user can save just this variant; in the
  // personal view, a bookmarked (non-owned) variant can be removed the
  // same way, one at a time.
  if (canBookmark) {
    const saved = state.savedThrowKeys.has(throwKey(lineup.id, active.id));
    heroSaveBtn.style.display = "";
    heroSaveBtn.textContent = saved ? "★ Saved" : "☆ Save to my map";
    heroSaveBtn.classList.toggle("saved", saved);
    heroSaveBtn.onclick = async () => {
      heroSaveBtn.disabled = true;
      try {
        if (saved) {
          await dbUnsaveLineup(lineup.id, active.id);
          state.savedThrowKeys.delete(throwKey(lineup.id, active.id));
        } else {
          await dbSaveLineup(lineup.id, active.id);
          state.savedThrowKeys.add(throwKey(lineup.id, active.id));
        }
        renderDetail(lineup);
      } catch (err) {
        alert((err && err.message) || "Something went wrong.");
      } finally {
        heroSaveBtn.disabled = false;
      }
    };
  } else if (isBookmarkedRef) {
    heroSaveBtn.style.display = "";
    heroSaveBtn.textContent = "✕ Remove from my map";
    heroSaveBtn.classList.remove("saved");
    heroSaveBtn.onclick = async () => {
      if (!confirm("Remove this throw position from your personal map?")) return;
      heroSaveBtn.disabled = true;
      try {
        await dbUnsaveLineup(lineup.id, active.id);
        state.savedThrowKeys.delete(throwKey(lineup.id, active.id));
        lineup.throws = lineup.throws.filter(x => x.id !== active.id);
        if (lineup.throws.length === 0) {
          state.lineups = state.lineups.filter(l => l.id !== lineup.id);
          closeDetailPanel();
          refreshLocal();
        } else {
          upsertLocalLineup(lineup);
          refreshLocal();
          openDetail(lineup.id, Math.max(0, selectedThrowIdx - 1));
        }
      } catch (err) {
        alert((err && err.message) || "Something went wrong.");
        heroSaveBtn.disabled = false;
      }
    };
  } else {
    heroSaveBtn.style.display = "none";
  }

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
        <button class="save-btn">☆ Save to my map</button>
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
  container.querySelectorAll(".tc-carousel").forEach(carousel => {
    const img = carousel.querySelector(".tc-carousel-img");
    if (!img) return;
    const inner = carousel.querySelector(".tc-carousel-inner");
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

    // Touch swipe through photos on mobile
    if (inner && imgs.length > 1) {
      let swipeStartX = null;
      inner.addEventListener("touchstart", e => {
        swipeStartX = e.touches[0].clientX;
      }, { passive: true });
      inner.addEventListener("touchend", e => {
        if (swipeStartX === null) return;
        const dx = e.changedTouches[0].clientX - swipeStartX;
        swipeStartX = null;
        if (Math.abs(dx) < 35) return;
        if (dx < 0) go(cur + 1); else go(cur - 1);
      }, { passive: true });
    }
  });
}

function renderDetailType(lineup, editable) {
  const typeInfo = TYPES.find(t => t.id === lineup.type);
  detailType.textContent = editable ? typeInfo.label + " ✎" : typeInfo.label;
  detailType.style.color = "#0a0d0e";
  detailType.style.background = getCssVarColor(typeInfo.color);
  detailType.style.cursor = editable ? "pointer" : "default";
  detailType.title = editable ? "Click to change nade type" : "";
  detailType.onclick = () => {
    if (!editable) return;
    openTypeModalForEdit(lineup);
  };
}

function openTypeModalForEdit(lineup) {
  buildTypeGrid(async (typeId) => {
    closeModal(typeModal);
    lineup.type = typeId;
    await dbPut(lineup, lineup.isOfficial);
    await loadLineups();
    openDetail(lineup.id);
  });
  typeModal.classList.add("show");
}

/* ===================== LIGHTBOX ===================== */

let lightboxState = { images: [], index: 0, caption: "" };
let lbZoom = 1, lbPanX = 0, lbPanY = 0;
let lbDragging = false, lbDragStartX = 0, lbDragStartY = 0, lbDragPanX = 0, lbDragPanY = 0;
let lbHasDragged = false;

function lbApplyTransform() {
  // Clamp pan so image can't be dragged too far off screen
  if (lbZoom > 1) {
    const maxPan = (lbZoom - 1) * 300;
    lbPanX = Math.min(maxPan, Math.max(-maxPan, lbPanX));
    lbPanY = Math.min(maxPan, Math.max(-maxPan, lbPanY));
  } else {
    lbPanX = 0; lbPanY = 0;
  }
  lightboxImage.style.transform = `translate(${lbPanX}px, ${lbPanY}px) scale(${lbZoom})`;
  lightboxImage.style.cursor = lbZoom > 1 ? "grab" : "default";
}

function lbResetZoom() {
  lbZoom = 1; lbPanX = 0; lbPanY = 0;
  lbApplyTransform();
}

function lbZoomAt(clientX, clientY, factor) {
  const newZoom = Math.min(Math.max(lbZoom * factor, 1), 8);
  if (newZoom === lbZoom) return;
  const rect = lightboxImage.getBoundingClientRect();
  const cx = clientX - (rect.left + rect.width / 2);
  const cy = clientY - (rect.top + rect.height / 2);
  const rf = newZoom / lbZoom;
  lbPanX = lbPanX + cx * (1 - rf);
  lbPanY = lbPanY + cy * (1 - rf);
  lbZoom = newZoom;
  lbApplyTransform();
}

function openLightbox(images, index, caption) {
  const valid = (images || []).filter(Boolean);
  if (!valid.length) return;
  lightboxState = { images: valid, index, caption: caption || "" };
  lbResetZoom();
  renderLightbox();
  lightboxModal.classList.add("show");
}

function renderLightbox() {
  lbResetZoom();
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

// Double-click / double-tap to toggle zoom
lightboxImage.addEventListener("dblclick", (e) => {
  if (lbZoom > 1) { lbResetZoom(); }
  else { lbZoomAt(e.clientX, e.clientY, 3); }
});

// Scroll wheel zoom
lightboxModal.addEventListener("wheel", (e) => {
  e.preventDefault();
  lbZoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.2 : 1 / 1.2);
}, { passive: false });

// Mouse drag to pan
lightboxImage.addEventListener("mousedown", (e) => {
  if (lbZoom <= 1) return;
  e.preventDefault();
  lbDragging = true; lbHasDragged = false;
  lbDragStartX = e.clientX; lbDragStartY = e.clientY;
  lbDragPanX = lbPanX; lbDragPanY = lbPanY;
  lightboxImage.style.cursor = "grabbing";
});
window.addEventListener("mousemove", (e) => {
  if (!lbDragging) return;
  const dx = e.clientX - lbDragStartX, dy = e.clientY - lbDragStartY;
  if (Math.hypot(dx, dy) > 3) lbHasDragged = true;
  lbPanX = lbDragPanX + dx; lbPanY = lbDragPanY + dy;
  lbApplyTransform();
});
window.addEventListener("mouseup", () => {
  if (!lbDragging) return;
  lbDragging = false;
  lightboxImage.style.cursor = lbZoom > 1 ? "grab" : "default";
});

// Click backdrop to close (but not after drag)
lightboxModal.addEventListener("click", (e) => {
  if (lbHasDragged) { lbHasDragged = false; return; }
  if (e.target === lightboxModal) lightboxModal.classList.remove("show");
});

// Touch: pinch zoom + single-finger pan
let lbLastTouchDist = null, lbTouchPanActive = false;
let lbTouchStartX = 0, lbTouchStartY = 0, lbTouchMoved = false;
lightboxModal.addEventListener("touchstart", (e) => {
  if (e.touches.length === 2) {
    lbLastTouchDist = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY
    );
    lbTouchPanActive = false;
  } else if (e.touches.length === 1) {
    lbTouchStartX = e.touches[0].clientX;
    lbTouchStartY = e.touches[0].clientY;
    lbTouchMoved = false;
    if (lbZoom > 1) {
      lbTouchPanActive = true;
      lbDragPanX = lbPanX; lbDragPanY = lbPanY;
    }
  }
}, { passive: true });
lightboxModal.addEventListener("touchmove", (e) => {
  if (e.touches.length === 2 && lbLastTouchDist) {
    const dist = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY
    );
    const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
    const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    lbZoomAt(midX, midY, dist / lbLastTouchDist);
    lbLastTouchDist = dist;
    e.preventDefault();
  } else if (e.touches.length === 1 && lbTouchPanActive) {
    const dx = e.touches[0].clientX - lbTouchStartX;
    const dy = e.touches[0].clientY - lbTouchStartY;
    if (Math.hypot(dx, dy) > 5) lbTouchMoved = true;
    lbPanX = lbDragPanX + dx; lbPanY = lbDragPanY + dy;
    lbApplyTransform();
    e.preventDefault();
  }
}, { passive: false });
lightboxModal.addEventListener("touchend", (e) => {
  // Double-tap to zoom
  if (!lbTouchMoved && e.changedTouches.length === 1) {
    const now = Date.now();
    if (lightboxModal._lastTap && now - lightboxModal._lastTap < 300) {
      const t = e.changedTouches[0];
      if (lbZoom > 1) lbResetZoom(); else lbZoomAt(t.clientX, t.clientY, 3);
      lightboxModal._lastTap = null;
    } else {
      lightboxModal._lastTap = now;
    }
  }
  // Swipe to next/prev (only when not zoomed)
  if (!lbTouchMoved && lbZoom <= 1) {
    const dx = e.changedTouches[0].clientX - lbTouchStartX;
    if (Math.abs(dx) >= 35) {
      if (dx < 0) lightboxNext.onclick(); else lightboxPrev.onclick();
    }
  }
  lbLastTouchDist = null; lbTouchPanActive = false;
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
  const lineup = state.lineups.find(l => l.id === state.selectedLineupId);
  if (!requireLineupEditable(lineup)) return;
  state.pendingThrowFor = state.selectedLineupId;
  setAddMode(true);
  addHint.textContent = "Click the spot you throw from.";
  detailPanel.classList.remove("open");
};

// Only ever visible when the lineup is editable (own/admin content) — see
// renderDetail(). Bookmarked references are removed one throw position at a
// time via the "Remove from my map" button in the hero card instead.
deleteLineupBtn.onclick = async () => {
  if (!state.selectedLineupId) return;
  const lineup = state.lineups.find(l => l.id === state.selectedLineupId);
  if (!lineup) return;
  if (!requireLineupEditable(lineup)) return;
  if (!confirm("Delete this entire lineup, including all throw positions?")) return;
  const delId = state.selectedLineupId;
  await dbDelete(delId);
  state.lineups = state.lineups.filter(l => l.id !== delId);
  closeDetailPanel();
  refreshLocal();
};

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

/* ===================== EXPORT / IMPORT / CLEAR ===================== */

exportBtn.onclick = async () => {
  try {
    exportBtn.textContent = "Exporting…";
    // No mapId filter — fetches all lineups across every map
    const res = await fetch(API_URL);
    if (!res.ok) throw new Error(`${res.status}`);
    const all = await res.json();
    const blob = new Blob([JSON.stringify(all, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lineups-backup-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    alert("Export failed: " + err.message);
  } finally {
    exportBtn.textContent = "Export backup";
  }
};

/* ===================== BOOT ===================== */

backBtn.onclick = goHome;

/* Mobile sidebar toggle */
function openSidebar() {
  sidebar.classList.add("open");
  sidebarOverlay.classList.add("show");
}
function closeSidebar() {
  sidebar.classList.remove("open");
  sidebarOverlay.classList.remove("show");
}
if (mobileMenuBtn) mobileMenuBtn.onclick = openSidebar;
if (sidebarOverlay) sidebarOverlay.onclick = closeSidebar;

/* Close sidebar on map select (mobile) */
const _origSelectMap = selectMap;

/* Loading skeleton */
function showMapLoading(on) {
  if (mapLoading) mapLoading.classList.toggle("show", on);
}

/* Keyboard shortcuts */
document.addEventListener("keydown", (e) => {
  const tag = e.target.tagName;
  const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";

  if (e.key === "Escape") {
    if (lightboxModal.classList.contains("show")) { lightboxModal.classList.remove("show"); return; }
    if (detailPanel.classList.contains("open")) { closeDetailPanel(); return; }
    if (document.querySelector(".modal-backdrop.show")) {
      document.querySelectorAll(".modal-backdrop.show").forEach(m => m.classList.remove("show"));
      setAddMode(false); return;
    }
    if (state.openClusterKey) { state.openClusterKey = null; renderMarkers(); return; }
    if (state.selectedLineupId) { state.selectedLineupId = null; renderMarkers(); return; }
    if (state.addMode) { setAddMode(false); return; }
  }

  if (!typing) {
    if (e.key === "z" || e.key === "Z") resetZoom();
    if (e.key === "ArrowLeft"  && lightboxModal.classList.contains("show")) lightboxPrev.onclick();
    if (e.key === "ArrowRight" && lightboxModal.classList.contains("show")) lightboxNext.onclick();
  }
});

/* Touch swipe in lightbox */
let _lbTouchX = null;
lightboxModal.addEventListener("touchstart", e => { _lbTouchX = e.touches[0].clientX; }, { passive: true });
lightboxModal.addEventListener("touchend", e => {
  if (_lbTouchX === null) return;
  const dx = e.changedTouches[0].clientX - _lbTouchX;
  _lbTouchX = null;
  if (Math.abs(dx) < 40) return;
  if (dx < 0) lightboxNext.onclick(); else lightboxPrev.onclick();
});

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
loadConfig().then(async () => {
  await initAuth();
  buildHomeScreen();
});
