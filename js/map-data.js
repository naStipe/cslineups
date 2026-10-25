import { setAddMode } from "./add-mode.js";
import { buildSavedThrowKeys, dbGetAll, dbGetMine, dbGetSaved } from "./api.js";
import { authUser } from "./auth.js";
import { updateCheatsheet } from "./cheatsheet.js";
import { LAST_MAP_KEY, MAPS } from "./constants.js";
import { updateLevelSwitch } from "./level-switch.js";
import { currentMapName, detailPanel, mapFrame, lineupCount, lineupSearchInput, linkSvg, mapImage, markerLayer, officialViewBtn, personalViewBtn } from "./dom.js";
import { buildLineupList } from "./lineup-list.js";
import { renderMarkers, resetRenderedThrowSig } from "./markers.js";
import { resetZoom } from "./pan-zoom.js";
import { buildFilters, buildSidebar, showMapLoading } from "./sidebar.js";
import { state } from "./state.js";
import { applyViewModeClass, setViewMode } from "./view-mode.js";

export async function selectMap(id) {
  state.mapId = id;
  // Remembered so admin.html's "Back to site" returns to this map.
  try { localStorage.setItem(LAST_MAP_KEY, id); } catch {}
  state.selectedLineupId = null;
  state.lineups = [];
  markerLayer.innerHTML = "";
  linkSvg.innerHTML = "";
  resetRenderedThrowSig();
  detailPanel.classList.remove("open");
  setAddMode(false);
  resetZoom();
  if (lineupSearchInput) lineupSearchInput.value = ""; // fresh search per map
  state.lineupsLoading = true;
  buildLineupList();                                   // clear the previous map's list right away
  buildSidebar();
  const m = MAPS.find(x => x.id === id);
  currentMapName.textContent = m.name.toUpperCase();
  document.title = `${m.name} — Lineupr`;
  retrigger(currentMapName, "name-in");
  await playMapOut();
  if (state.mapId !== id) return; // a newer switch took over while the old map faded out
  mapImage.src = m.file;
  pendingImageReady = waitForMapImage(mapImage);
  pendingImageReady
    .then(() => (mapImage.decode ? Promise.race([mapImage.decode().catch(() => {}), new Promise(r => setTimeout(r, 300))]) : null))
    .then(() => { if (state.mapId === id) playMapIn(); });
  updateLevelSwitch(id);
  updateCheatsheet(id);
  if (!authUser && state.viewMode === "personal") state.viewMode = "official";
  if (officialViewBtn) officialViewBtn.classList.toggle("active", state.viewMode === "official");
  if (personalViewBtn) personalViewBtn.classList.toggle("active", state.viewMode === "personal");
  applyViewModeClass();
  await loadLineups();
}

// ---- Map switch animation: old map blurs out, new one wipes in under a radar sweep ----
const reducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
let mapShown = false;
let sweepEl = null;

function retrigger(el, cls) {
  if (reducedMotion) return;
  el.classList.remove(cls);
  void el.offsetWidth; // restart the CSS animation
  el.classList.add(cls);
}

// The frame is always hidden (map-out) before the new source is assigned, so the
// radar can never flash fully visible before its wipe-in starts.
async function playMapOut() {
  if (reducedMotion) return;
  mapFrame.classList.add("map-out");
  if (mapShown) await new Promise(r => setTimeout(r, 230));
}

function playMapIn() {
  mapShown = true;
  if (reducedMotion) return;
  if (!sweepEl) {
    sweepEl = document.createElement("div");
    sweepEl.className = "map-sweep";
    sweepEl.setAttribute("aria-hidden", "true");
    mapFrame.appendChild(sweepEl);
  }
  mapFrame.classList.remove("map-out");
  mapFrame.classList.remove("map-in");
  void mapFrame.offsetWidth;
  mapFrame.classList.add("map-in");
  retrigger(sweepEl, "run");
}

export let loadToken = 0;
let pendingImageReady = Promise.resolve();

// Resolves once the map <img> has actually painted the new source (or failed/
// timed out), so callers can avoid revealing new lineup markers over the
// still-visible previous map bitmap while it downloads.
function waitForMapImage(img) {
  return new Promise(resolve => {
    if (img.complete) return resolve();
    const done = () => { img.removeEventListener("load", done); img.removeEventListener("error", done); resolve(); };
    img.addEventListener("load", done, { once: true });
    img.addEventListener("error", done, { once: true });
    setTimeout(done, 4000); // safety net so a stalled image never wedges the loading overlay
  });
}

export async function loadLineups() {
  const myToken = ++loadToken;

  if (state.viewMode === "personal" && !authUser) {
    setViewMode("official");
    return;
  }

  lineupCount.textContent = "loading…";
  state.lineupsLoading = true;
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
    state.lineupsLoading = false;
    lineupCount.textContent = `${lineups.length} lineup${lineups.length === 1 ? "" : "s"}`;
    buildFilters();
    buildLineupList();
    renderMarkers();
  } catch (err) {
    if (myToken !== loadToken) return;
    lineupCount.textContent = "load failed";
    state.lineupsLoading = false;
    buildLineupList();
    console.error(err);
  } finally {
    if (myToken === loadToken) {
      await pendingImageReady;
      if (myToken === loadToken) showMapLoading(false);
    }
  }
}

export function refreshLocal() {
  lineupCount.textContent = `${state.lineups.length} lineup${state.lineups.length === 1 ? "" : "s"}`;
  buildFilters();
  buildLineupList();
  renderMarkers();
}

export function upsertLocalLineup(lineup) {
  const idx = state.lineups.findIndex(l => l.id === lineup.id);
  if (idx >= 0) state.lineups[idx] = lineup;
  else state.lineups.push(lineup);
}
