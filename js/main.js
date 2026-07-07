import { setAddMode } from "./add-mode.js";
import { initAuth } from "./auth.js";
import { MAPS } from "./constants.js";
import { closeDetailPanel, openDetail } from "./detail-panel.js";
import { backBtn, detailPanel, lightboxModal, lightboxNext, lightboxPrev } from "./dom.js";
import "./export-import.js"; // side effect only: wires up the export-backup button
import "./profile-modal.js"; // side effect only: wires up the profile button + modal
import { buildHomeScreen, enterMap, goHome } from "./home-screen.js";
import { renderMarkers } from "./markers.js";
import { resetZoom } from "./pan-zoom.js";
import { buildFilters, buildSidebar } from "./sidebar.js";
import { state } from "./state.js";

// The map view is its own history entry above the chooser, so "Maps" pops
// back to the chooser (keeping Back/Forward symmetric). Fall back to a direct
// render if there's no map entry to pop (shouldn't happen in normal flow).
backBtn.onclick = () => {
  if (history.state && history.state.view === "map") history.back();
  else goHome();
};

// Browser Back/Forward between the chooser and a map view. URL-driven and
// render-only — never pushes, or Back would get stuck.
window.addEventListener("popstate", () => {
  const id = new URLSearchParams(window.location.search).get("map");
  if (id && MAPS.some(m => m.id === id)) enterMap(id);
  else goHome();
});

document.addEventListener("keydown", (e) => {
  // While repositioning, the reposition overlay owns the keyboard (its own
  // Escape = cancel). Don't let the global shortcuts below also fire.
  if (state.reposition) return;

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

export async function loadConfig() {
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

// Deep links from the server-rendered SEO pages ("Open in interactive
// map"): /?map=dust2 opens that map, /?map=dust2&lineup=<id> also opens the
// lineup's detail panel once its lineups have loaded.
async function handleDeepLink() {
  const params = new URLSearchParams(window.location.search);
  const mapId = params.get("map");
  if (!mapId || !MAPS.some(m => m.id === mapId)) return;
  // Seed a chooser entry beneath this map view so Back / the "Maps" button
  // land on the chooser even when the user deep-linked straight to a map.
  history.replaceState({ view: "home" }, "", "/");
  history.pushState({ view: "map", map: mapId }, "", `/?map=${mapId}`);
  await enterMap(mapId);
  const lineupId = params.get("lineup");
  if (!lineupId) return;
  // The initial auth event can restart the lineup load mid-flight (see
  // auth.js onAuthStateChange -> loadLineups), cancelling the load we just
  // awaited — so poll briefly for the lineup instead of checking once.
  for (let i = 0; i < 50; i++) {
    if (state.lineups.some(l => l.id === lineupId)) {
      openDetail(lineupId, 0);
      return;
    }
    await new Promise(r => setTimeout(r, 100));
  }
}

loadConfig().then(async () => {
  await initAuth();
  buildHomeScreen();
  handleDeepLink();
});
