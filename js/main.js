import { setAddMode } from "./add-mode.js";
import { initAuth } from "./auth.js";
import { closeDetailPanel } from "./detail-panel.js";
import { backBtn, detailPanel, lightboxModal, lightboxNext, lightboxPrev } from "./dom.js";
import "./export-import.js"; // side effect only: wires up the export-backup button
import "./profile-modal.js"; // side effect only: wires up the profile button + modal
import { buildHomeScreen, goHome } from "./home-screen.js";
import { renderMarkers } from "./markers.js";
import { resetZoom } from "./pan-zoom.js";
import { buildFilters, buildSidebar } from "./sidebar.js";
import { state } from "./state.js";

backBtn.onclick = goHome;

document.addEventListener("keydown", (e) => {
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

loadConfig().then(async () => {
  await initAuth();
  buildHomeScreen();
});
