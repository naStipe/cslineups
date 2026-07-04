import { openAuthModal } from "./auth-modal.js";
import { authUser } from "./auth.js";
import { closeDetailPanel } from "./detail-panel.js";
import { officialViewBtn, personalViewBtn } from "./dom.js";
import { loadLineups } from "./map-data.js";
import { state } from "./state.js";

// Mirrors the current view onto the <body> so CSS can react to it — notably
// hiding the "Add lineup" button for non-admins while the official map is
// open (they can only add to their own "My Map"). Kept in sync everywhere the
// view mode changes.
export function applyViewModeClass() {
  document.body.classList.toggle("view-official", state.viewMode === "official");
  document.body.classList.toggle("view-personal", state.viewMode === "personal");
}

export function setViewMode(mode) {
  if (mode === "personal" && !authUser) { openAuthModal("signin"); return; }
  state.viewMode = mode;
  if (officialViewBtn) officialViewBtn.classList.toggle("active", mode === "official");
  if (personalViewBtn) personalViewBtn.classList.toggle("active", mode === "personal");
  applyViewModeClass();
  state.selectedLineupId = null;
  closeDetailPanel();
  loadLineups();
}

if (officialViewBtn) officialViewBtn.onclick = () => setViewMode("official");

if (personalViewBtn) personalViewBtn.onclick = () => setViewMode("personal");
