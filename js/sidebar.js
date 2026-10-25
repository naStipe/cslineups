import { MAPS, TYPES } from "./constants.js";
import { closeTypeFilter, mapList, mapLoading, mobileMenuBtn, mobileTypeFilterGrid, sidebar, sidebarOverlay, typeFilterBtn, typeFilterBtnLabel, typeFilterModal, typeFilters, typeGrid } from "./dom.js";
import { switchMap } from "./home-screen.js";
import { countsByType } from "./lineup-list.js";
import { renderMarkers } from "./markers.js";
import { closeModal } from "./modal-utils.js";
import { state } from "./state.js";

export function buildSidebar() {
  mapList.innerHTML = "";
  MAPS.forEach(m => {
    const el = document.createElement("div");
    el.className = "map-item" + (m.id === state.mapId ? " active" : "");
    el.innerHTML = `<span class="swatch"></span>${m.name}`;
    el.onclick = () => { closeSidebar(); switchMap(m.id); };
    mapList.appendChild(el);
  });
}

// Active type filters and the official/personal view are remembered per map,
// so a reload or a trip to another map doesn't reset them.
const filterKey = (mapId) => `lineupr.filters.${mapId}`;

export function saveFilters() {
  try {
    localStorage.setItem(filterKey(state.mapId), JSON.stringify({
      types: TYPES.filter(t => state.activeFilters.has(t.id)).map(t => t.id),
      view: state.viewMode,
    }));
  } catch {}
}

// Returns the remembered view ("official" | "personal") or null; applies the
// type filters directly to state.
export function restoreFilters(mapId) {
  try {
    const saved = JSON.parse(localStorage.getItem(filterKey(mapId)));
    if (!saved) { state.activeFilters = new Set(TYPES.map(t => t.id)); return null; }
    const ids = Array.isArray(saved.types) ? saved.types.filter(id => TYPES.some(t => t.id === id)) : [];
    state.activeFilters = new Set(ids.length ? ids : TYPES.map(t => t.id));
    return saved.view === "personal" ? "personal" : "official";
  } catch {
    state.activeFilters = new Set(TYPES.map(t => t.id));
    return null;
  }
}

export function buildFilters() {
  typeFilters.innerHTML = "";
  const counts = countsByType();
  TYPES.forEach(t => {
    const count = counts[t.id] || 0;
    const chip = document.createElement("div");
    chip.className = "filter-chip" + (state.activeFilters.has(t.id) ? "" : " off") + (count === 0 ? " zero" : "");
    chip.style.setProperty("--chip-color", t.color);
    chip.innerHTML = `<span class="dot" style="background:${t.color}"></span>${t.label}<span class="chip-count">${count}</span>`;
    chip.onclick = () => {
      toggleTypeFilter(t.id);
      chip.classList.toggle("off", !state.activeFilters.has(t.id));
    };
    typeFilters.appendChild(chip);
  });
  buildMobileTypeFilters();
}

export function toggleTypeFilter(typeId) {
  if (state.activeFilters.has(typeId)) state.activeFilters.delete(typeId);
  else state.activeFilters.add(typeId);
  saveFilters();
  renderMarkers();
}

function updateTypeFilterBtnLabel() {
  if (!typeFilterBtnLabel) return;
  const activeCount = TYPES.filter(t => state.activeFilters.has(t.id)).length;
  typeFilterBtnLabel.textContent = activeCount === TYPES.length ? "Types" : `Types (${activeCount})`;
}

// Mobile stand-in for the topbar's type-chip row — the row doesn't fit at
// phone width, so this popup (opened by #typeFilterBtn) offers the same
// toggles as a tappable grid instead.
function buildMobileTypeFilters() {
  if (!mobileTypeFilterGrid) return;
  mobileTypeFilterGrid.innerHTML = "";
  const counts = countsByType();
  TYPES.forEach(t => {
    const count = counts[t.id] || 0;
    const active = state.activeFilters.has(t.id);
    const opt = document.createElement("div");
    opt.className = "type-opt" + (active ? " active" : " off");
    opt.innerHTML = `<span class="dot" style="background:${t.color}"></span>${t.label}<span class="chip-count">${count}</span>`;
    opt.onclick = () => {
      toggleTypeFilter(t.id);
      opt.classList.toggle("off", !state.activeFilters.has(t.id));
      opt.classList.toggle("active", state.activeFilters.has(t.id));
      updateTypeFilterBtnLabel();
    };
    mobileTypeFilterGrid.appendChild(opt);
  });
  updateTypeFilterBtnLabel();
}

if (typeFilterBtn) typeFilterBtn.onclick = () => typeFilterModal.classList.add("show");
if (closeTypeFilter) closeTypeFilter.onclick = () => closeModal(typeFilterModal);

export function buildTypeGrid(onPick) {
  typeGrid.innerHTML = "";
  TYPES.forEach(t => {
    const opt = document.createElement("div");
    opt.className = "type-opt";
    opt.innerHTML = `<span class="dot" style="background:${t.color}"></span>${t.label}`;
    opt.onclick = () => onPick(t.id);
    typeGrid.appendChild(opt);
  });
}

export function openSidebar() {
  sidebar.classList.add("open");
  sidebarOverlay.classList.add("show");
}

export function closeSidebar() {
  sidebar.classList.remove("open");
  sidebarOverlay.classList.remove("show");
}

if (mobileMenuBtn) mobileMenuBtn.onclick = openSidebar;

if (sidebarOverlay) sidebarOverlay.onclick = closeSidebar;

export function showMapLoading(on) {
  if (mapLoading) mapLoading.classList.toggle("show", on);
}
