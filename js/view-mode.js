import { openAuthModal } from "./auth-modal.js";
import { authUser } from "./auth.js";
import { closeDetailPanel } from "./detail-panel.js";
import { officialViewBtn, personalViewBtn } from "./dom.js";
import { loadLineups } from "./map-data.js";
import { state } from "./state.js";

export function setViewMode(mode) {
  if (mode === "personal" && !authUser) { openAuthModal("signin"); return; }
  state.viewMode = mode;
  if (officialViewBtn) officialViewBtn.classList.toggle("active", mode === "official");
  if (personalViewBtn) personalViewBtn.classList.toggle("active", mode === "personal");
  state.selectedLineupId = null;
  closeDetailPanel();
  loadLineups();
}

if (officialViewBtn) officialViewBtn.onclick = () => setViewMode("official");

if (personalViewBtn) personalViewBtn.onclick = () => setViewMode("personal");
