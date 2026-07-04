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
    card.onclick = () => enterMap(m.id);
    inner.appendChild(card);
  });

  homeGrid.appendChild(inner);
}

export function enterMap(id) {
  homeScreen.style.display = "none";
  appShell.removeAttribute("hidden");
  closeSidebar();
  selectMap(id);
}

export function goHome() {
  appShell.setAttribute("hidden", "");
  homeScreen.style.display = "";
  closeDetailPanel();
  setAddMode(false);
  buildHomeScreen(); // refresh counts when returning
}
