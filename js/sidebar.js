import { MAPS, TYPES } from "./constants.js";
import { mapList, mapLoading, mobileMenuBtn, sidebar, sidebarOverlay, typeFilters, typeGrid } from "./dom.js";
import { switchMap } from "./home-screen.js";
import { renderMarkers } from "./markers.js";
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
