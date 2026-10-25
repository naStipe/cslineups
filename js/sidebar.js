import { MAPS, TYPES } from "./constants.js";
import { closeTypeFilter, markerLayer, mapList, mapLoading, mobileMenuBtn, mobileTypeFilterGrid, sidebar, sideFilters, sidebarOverlay, typeFilterBtn, typeFilterBtnLabel, typeFilterModal, typeFilters, typeGrid } from "./dom.js";
import { switchMap } from "./home-screen.js";
import { areaBounds, areaOptions } from "./areas.js";
import { buildLineupList, countsByType } from "./lineup-list.js";
import { renderMarkers } from "./markers.js";
import { resetZoom, zoomToBox } from "./pan-zoom.js";
import { SIDE_FILTERS, sideSegment } from "./side.js";
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
      side: state.sideFilter,
      area: state.areaFilter,
    }));
  } catch {}
}

// Returns the remembered view ("official" | "personal") or null; applies the
// type filters directly to state.
export function restoreFilters(mapId) {
  try {
    const saved = JSON.parse(localStorage.getItem(filterKey(mapId)));
    state.sideFilter = saved && ["t", "ct"].includes(saved.side) ? saved.side : "all";
    state.areaFilter = saved && typeof saved.area === "string" ? saved.area : null; // dropped in refreshAreaUi if the map has no such area
    if (!saved) { state.activeFilters = new Set(TYPES.map(t => t.id)); return null; }
    const ids = Array.isArray(saved.types) ? saved.types.filter(id => TYPES.some(t => t.id === id)) : [];
    state.activeFilters = new Set(ids.length ? ids : TYPES.map(t => t.id));
    return saved.view === "personal" ? "personal" : "official";
  } catch {
    state.activeFilters = new Set(TYPES.map(t => t.id));
    state.sideFilter = "all";
    state.areaFilter = null;
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
  buildSideAndAreaFilters();
}

// T / CT segment and the area dropdown, in the topbar and (mobile) the filter popup.
function filterControls() {
  const frag = document.createDocumentFragment();
  frag.append(sideSegment(SIDE_FILTERS, state.sideFilter, setSideFilter, { label: "Filter by side" }));
  const opts = areaOptions();
  if (opts.length) {
    const sel = document.createElement("select");
    sel.className = "area-select";
    sel.setAttribute("aria-label", "Filter by area");
    sel.innerHTML = `<option value="">All areas</option>` + opts.map(o => `<option value="${o.slug}">${o.name}</option>`).join("");
    sel.value = state.areaFilter && opts.some(o => o.slug === state.areaFilter) ? state.areaFilter : "";
    sel.onchange = () => setAreaFilter(sel.value || null);
    frag.append(sel);
  }
  return frag;
}

function buildSideAndAreaFilters() {
  if (sideFilters) sideFilters.replaceChildren(filterControls());
  if (mobileTypeFilterGrid) {
    const row = document.createElement("div");
    row.className = "mobile-extra-filters";
    row.append(filterControls());
    mobileTypeFilterGrid.append(row);
  }
}

function afterFilterChange() {
  saveFilters();
  buildFilters();
  buildLineupList();
  renderMarkers();
}

export function setSideFilter(side) {
  state.sideFilter = side;
  afterFilterChange();
}

export function setAreaFilter(slug) {
  state.areaFilter = slug;
  afterFilterChange();
  renderAreaLabels();
  const b = slug && areaBounds(slug);
  if (b) zoomToBox(b); else resetZoom();
}

// Rebuild the area dropdown + on-map labels after the map's areas load (or
// after a filter reset). A remembered area the map doesn't have is dropped.
export function refreshAreaUi() {
  if (state.areaFilter && !areaOptions().some(o => o.slug === state.areaFilter)) state.areaFilter = null;
  buildSideAndAreaFilters();
  renderAreaLabels();
}

// Faint clickable labels at each area's centre; clicking one filters to it
// and zooms in. They are scaled inversely to the zoom like the markers.
function renderAreaLabels() {
  markerLayer.querySelectorAll(":scope > .area-label").forEach(el => el.remove());
  areaOptions().forEach(o => {
    const b = areaBounds(o.slug);
    if (!b) return;
    const el = document.createElement("button");
    el.type = "button";
    el.className = "area-label" + (state.areaFilter === o.slug ? " active" : "");
    el.textContent = o.name;
    el.style.left = b.cx + "%";
    el.style.top = b.cy + "%";
    el.onclick = (e) => { e.stopPropagation(); setAreaFilter(state.areaFilter === o.slug ? null : o.slug); };
    markerLayer.appendChild(el);
  });
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
