import { setAddMode } from "./add-mode.js";
import { buildSavedThrowKeys, dbGetAll, dbGetMine, dbGetSaved } from "./api.js";
import { authUser } from "./auth.js";
import { updateCheatsheet } from "./cheatsheet.js";
import { MAPS } from "./constants.js";
import { currentMapName, detailPanel, lineupCount, linkSvg, mapImage, markerLayer, officialViewBtn, personalViewBtn } from "./dom.js";
import { renderMarkers, resetRenderedThrowSig } from "./markers.js";
import { resetZoom } from "./pan-zoom.js";
import { buildFilters, buildSidebar, showMapLoading } from "./sidebar.js";
import { state } from "./state.js";
import { applyViewModeClass, setViewMode } from "./view-mode.js";

export async function selectMap(id) {
  state.mapId = id;
  state.selectedLineupId = null;
  state.lineups = [];
  markerLayer.innerHTML = "";
  linkSvg.innerHTML = "";
  resetRenderedThrowSig();
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
  applyViewModeClass();
  await loadLineups();
}

export let loadToken = 0;

export async function loadLineups() {
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

export function refreshLocal() {
  lineupCount.textContent = `${state.lineups.length} lineup${state.lineups.length === 1 ? "" : "s"}`;
  buildFilters();
  renderMarkers();
}

export function upsertLocalLineup(lineup) {
  const idx = state.lineups.findIndex(l => l.id === lineup.id);
  if (idx >= 0) state.lineups[idx] = lineup;
  else state.lineups.push(lineup);
}
