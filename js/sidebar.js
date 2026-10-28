import { MAPS, TYPES } from "./constants.js";
import { appShell, closeTypeFilter, markerLayer, mapList, mapLoading, mobileMenuBtn, mobileTypeFilterGrid, sidebar, sideFilters, sidebarOverlay, typeFilterBtn, typeFilterBtnLabel, typeFilterModal, typeFilters, typeGrid } from "./dom.js";
import { switchMap } from "./home-screen.js";
import { areaBounds, areaOptions } from "./areas.js";
import { buildLineupList, countsByType } from "./lineup-list.js";
import { renderMarkers } from "./markers.js";
import { resetZoom, zoomToBox } from "./pan-zoom.js";
import { SIDE_FILTERS, sideSegment } from "./side.js";
import { closeModal } from "./modal-utils.js";
import { state } from "./state.js";

// Official lineup count per map ({ dust2: 26, … }), fetched once and shared
// by the sidebar and the home screen's map cards. Resolves null on failure.
let countsPromise = null;
let mapCounts = null;
export function fetchMapCounts() {
  if (!countsPromise) {
    countsPromise = fetch("/api/lineups?counts=true")
      .then(r => (r.ok ? r.json() : null))
      .catch(() => null)
      .then(c => { mapCounts = c; if (c) buildSidebar(); return c; });
  }
  return countsPromise;
}

export function buildSidebar() {
  mapList.innerHTML = "";
  MAPS.forEach(m => {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "map-item" + (m.id === state.mapId ? " active" : "");
    if (m.id === state.mapId) el.setAttribute("aria-current", "page");
    el.innerHTML = `<img class="map-item-icon" src="/maps/icons/${m.id}.webp" alt="" width="28" height="28" decoding="async"><span class="map-item-name"></span><span class="map-item-count"></span>`;
    el.querySelector(".map-item-name").textContent = m.name;
    const n = mapCounts ? mapCounts[m.id] || 0 : null;
    if (n !== null) {
      el.querySelector(".map-item-count").textContent = n || "soon";
      el.title = n ? `${m.name} — ${n} lineup${n === 1 ? "" : "s"}` : `${m.name} — lineups coming soon`;
    }
    el.onclick = () => { closeSidebar(); switchMap(m.id); };
    mapList.appendChild(el);
  });
  if (!countsPromise && !appShell.hidden) fetchMapCounts();
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
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "filter-chip" + (state.activeFilters.has(t.id) ? "" : " off") + (count === 0 ? " zero" : "");
    chip.style.setProperty("--chip-color", t.color);
    chip.setAttribute("aria-pressed", state.activeFilters.has(t.id) ? "true" : "false");
    chip.setAttribute("aria-label", `${t.label}, ${count} lineup${count === 1 ? "" : "s"}`);
    chip.innerHTML = `<span class="dot" style="background:${t.color}"></span>${t.label}<span class="chip-count">${count}</span>`;
    chip.onclick = () => {
      toggleTypeFilter(t.id);
      chip.classList.toggle("off", !state.activeFilters.has(t.id));
      chip.setAttribute("aria-pressed", state.activeFilters.has(t.id) ? "true" : "false");
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
  fitFilters();
}

// Desktop topbar: show the filter row only when it fits between the map
// title and the action buttons — first dropping the per-type counts, then
// swapping the row for the "Filters" button that opens the same controls as
// a popup. Measured rather than set by breakpoint, since the row's width
// depends on the map (area list) and sign-in ("My Map", "Add lineup").
const topbar = document.querySelector(".topbar");
const filterBar = document.querySelector(".filter-bar");
function filterBarWidth() {
  const parts = [...filterBar.children].filter(c => c.offsetWidth);
  return parts.reduce((w, c) => w + c.offsetWidth, 0)
    + (parseFloat(getComputedStyle(filterBar).columnGap) || 0) * Math.max(0, parts.length - 1);
}
function fitFilters() {
  if (!topbar || !filterBar) return;
  topbar.classList.remove("filters-tight", "filters-compact");
  if (drawerMq.matches) return;
  const cs = getComputedStyle(topbar);
  const gap = parseFloat(cs.columnGap) || 0;
  const avail = topbar.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
    - topbar.querySelector(".topbar-left").offsetWidth - topbar.querySelector(".topbar-right").offsetWidth - 2 * gap;
  if (filterBarWidth() <= avail) return;
  topbar.classList.add("filters-tight");
  if (filterBarWidth() <= avail) return;
  topbar.classList.add("filters-compact");
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

// "Filters" plus how many filters are narrowing the map, if any.
function updateTypeFilterBtnLabel() {
  if (!typeFilterBtnLabel) return;
  const hiddenTypes = TYPES.filter(t => !state.activeFilters.has(t.id)).length;
  const n = hiddenTypes + (state.sideFilter !== "all" ? 1 : 0) + (state.areaFilter ? 1 : 0);
  typeFilterBtnLabel.textContent = n ? `Filters (${n})` : "Filters";
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
    const opt = document.createElement("button");
    opt.type = "button";
    opt.className = "type-opt" + (active ? " active" : " off");
    opt.setAttribute("aria-pressed", active ? "true" : "false");
    opt.innerHTML = `<span class="dot" style="background:${t.color}"></span>${t.label}<span class="chip-count">${count}</span>`;
    opt.onclick = () => {
      toggleTypeFilter(t.id);
      opt.classList.toggle("off", !state.activeFilters.has(t.id));
      opt.classList.toggle("active", state.activeFilters.has(t.id));
      opt.setAttribute("aria-pressed", state.activeFilters.has(t.id) ? "true" : "false");
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
  TYPES.forEach((t, i) => {
    const opt = document.createElement("div");
    opt.className = "type-opt";
    opt.innerHTML = `<span class="dot" style="background:${t.color}"></span>${t.label}<kbd class="type-key" aria-hidden="true">${i + 1}</kbd>`;
    opt.onclick = () => onPick(t.id);
    typeGrid.appendChild(opt);
  });
}

// On phones the sidebar is an off-screen drawer: keep it out of the tab
// order while closed, move focus in when it opens and back to ☰ on close.
const drawerMq = window.matchMedia("(max-width: 768px)");
// Re-fit when the bar or either side zone changes width (window resize,
// sign-in showing "My Map", admin status showing "Add lineup").
if (topbar) {
  const ro = new ResizeObserver(() => fitFilters());
  [topbar, topbar.querySelector(".topbar-left"), topbar.querySelector(".topbar-right")].forEach(el => el && ro.observe(el));
}
const sidebarClose = document.getElementById("sidebarClose");
function syncSidebarInert() {
  sidebar.inert = drawerMq.matches && !sidebar.classList.contains("open");
}
drawerMq.addEventListener("change", syncSidebarInert);
syncSidebarInert();

export function sidebarOpen() {
  return drawerMq.matches && sidebar.classList.contains("open");
}

export function openSidebar() {
  sidebar.classList.add("open");
  sidebarOverlay.classList.add("show");
  syncSidebarInert();
  if (sidebarClose) sidebarClose.focus({ preventScroll: true });
}

export function closeSidebar() {
  const hadFocus = sidebar.contains(document.activeElement);
  sidebar.classList.remove("open");
  sidebarOverlay.classList.remove("show");
  syncSidebarInert();
  if (hadFocus && drawerMq.matches && mobileMenuBtn) mobileMenuBtn.focus({ preventScroll: true });
}

if (mobileMenuBtn) mobileMenuBtn.onclick = openSidebar;
if (sidebarClose) sidebarClose.onclick = closeSidebar;

if (sidebarOverlay) sidebarOverlay.onclick = closeSidebar;

export function showMapLoading(on) {
  if (mapLoading) mapLoading.classList.toggle("show", on);
}
