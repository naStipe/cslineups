import { setAddMode } from "./add-mode.js";
import { API_URL } from "./api.js";
import { MAPS } from "./constants.js";
import { closeDetailPanel } from "./detail-panel.js";
import { appShell, homeGrid, homeScreen } from "./dom.js";
import { selectMap } from "./map-data.js";
import { closeSidebar } from "./sidebar.js";

export async function buildHomeScreen() {
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
    card.onclick = () => openMap(m.id);
    inner.appendChild(card);
  });

  homeGrid.appendChild(inner);
}

// enterMap / goHome are pure view renders (no history). The nav wrappers
// below add the history entries so the map chooser and each map view are
// distinct "pages": the map view is pushed on top of the chooser, so the
// browser Back button and the in-app "Maps" button both return to it.
export function enterMap(id) {
  homeScreen.style.display = "none";
  appShell.removeAttribute("hidden");
  closeSidebar();
  return selectMap(id);
}

// From the chooser into a map: push a new history entry.
export function openMap(id) {
  history.pushState({ view: "map", map: id }, "", `/?map=${id}`);
  return enterMap(id);
}

// Switching maps while already in the app: replace, so there's still just one
// map entry sitting above the chooser (Back always returns to the chooser).
export function switchMap(id) {
  history.replaceState({ view: "map", map: id }, "", `/?map=${id}`);
  return selectMap(id);
}

export function goHome() {
  appShell.setAttribute("hidden", "");
  homeScreen.style.display = "";
  closeDetailPanel();
  setAddMode(false);
  buildHomeScreen(); // refresh counts when returning
}
