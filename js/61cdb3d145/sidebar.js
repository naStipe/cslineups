import { MAPS, TYPES } from "./constants.js";
import { closeTypeFilter, mapList, mapLoading, mobileMenuBtn, mobileTypeFilterGrid, sidebar, sidebarOverlay, typeFilterBtn, typeFilterBtnLabel, typeFilterModal, typeFilters, typeGrid } from "./dom.js";
import { switchMap } from "./home-screen.js";
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

export function buildFilters() {
  typeFilters.innerHTML = "";
  TYPES.forEach(t => {
    const count = state.lineups.filter(l => l.type === t.id).length;
    const chip = document.createElement("div");
    chip.className = "filter-chip" + (state.activeFilters.has(t.id) ? "" : " off");
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

function toggleTypeFilter(typeId) {
  if (state.activeFilters.has(typeId)) state.activeFilters.delete(typeId);
  else state.activeFilters.add(typeId);
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
  TYPES.forEach(t => {
    const count = state.lineups.filter(l => l.type === t.id).length;
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
