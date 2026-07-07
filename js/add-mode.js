import { addFlowBar, addFlowCancel, addFlowStep, addFlowText, addModeBtn, cancelType, detailPanel, lineupNameInput, mapFrame, mapImage, markerLayer, typeModal } from "./dom.js";
import { getCssVarColor, renderMarkers, typeColor } from "./markers.js";
import { closeModal } from "./modal-utils.js";
import { consumeDragFlags } from "./pan-zoom.js";
import { requireCanCreate } from "./permissions.js";
import { buildTypeGrid } from "./sidebar.js";
import { state, uid } from "./state.js";
import { openThrowModal } from "./throw-modal.js";

// ── Guided placement bar ─────────────────────────────────────────────────
// Shown while the user is clicking on the map to place a lineup's landing /
// throw markers, with a step counter and a Cancel button.
export function showAddFlow(step, total, text) {
  if (total) { addFlowStep.textContent = `Step ${step} of ${total}`; addFlowStep.hidden = false; }
  else { addFlowStep.hidden = true; }
  addFlowText.textContent = text;
  addFlowBar.hidden = false;
}
export function hideAddFlow() { if (addFlowBar) addFlowBar.hidden = true; }

// A ghost "Lands here" marker so the user can see where they dropped the
// landing spot before they click the throw-from spot.
let addPreviewEl = null;
function renderAddLandingPreview(landing, typeId) {
  clearAddPreview();
  const el = document.createElement("div");
  el.className = "repos-dot is-landing is-fixed add-preview-dot";
  el.style.setProperty("--dot-color", getCssVarColor(typeColor(typeId)));
  el.style.left = landing.x + "%";
  el.style.top = landing.y + "%";
  el.innerHTML = `<span class="repos-label">Lands here</span>`;
  markerLayer.appendChild(el);
  addPreviewEl = el;
}
function clearAddPreview() {
  if (addPreviewEl) { addPreviewEl.remove(); addPreviewEl = null; }
}

export function setAddMode(on) {
  state.addMode = on;
  state.pendingType = null;
  state.pendingLanding = null;
  addModeBtn.classList.toggle("active", on);
  mapFrame.classList.toggle("add-mode", on);
  if (!on) { hideAddFlow(); clearAddPreview(); }
}

addModeBtn.onclick = () => {
  if (!requireCanCreate()) return;
  setAddMode(true);
  openTypeModal((typeId) => {
    state.pendingType = typeId;
    state.pendingName = lineupNameInput ? lineupNameInput.value.trim() : "";
    closeModal(typeModal);
    showAddFlow(1, 2, "Click on the map where the nade lands.");
  });
};

mapFrame.addEventListener("click", (e) => {
  if (state.reposition) return; // reposition overlay handles its own drags
  const rect = mapImage.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * 100;
  const y = ((e.clientY - rect.top) / rect.height) * 100;
  if (x < 0 || x > 100 || y < 0 || y > 100) return;

  if (state.openClusterKey) {
    state.openClusterKey = null;
    renderMarkers();
    return;
  }

  if (state.pendingThrowFor) {
    hideAddFlow();
    openThrowModal({ x, y }, state.pendingThrowFor, false);
    return;
  }

  if (state.addMode && state.pendingType) {
    if (!state.pendingLanding) {
      state.pendingLanding = { x, y };
      renderAddLandingPreview({ x, y }, state.pendingType);
      showAddFlow(2, 2, "Now click the spot you throw from.");
    } else {
      const newId = uid();
      hideAddFlow();
      openThrowModal({ x, y }, newId, true, state.pendingType, state.pendingLanding);
    }
    return;
  }

  if (state.selectedLineupId && !detailPanel.classList.contains("open")) {
    if (consumeDragFlags()) return;
    state.selectedLineupId = null;
    renderMarkers();
  }
});

export function openTypeModal(onPick) {
  buildTypeGrid(onPick);
  if (lineupNameInput) lineupNameInput.value = "";
  typeModal.classList.add("show");
}

cancelType.onclick = () => { closeModal(typeModal); setAddMode(false); };

// Cancel the whole placement flow from the guided bar.
if (addFlowCancel) {
  addFlowCancel.onclick = () => {
    closeModal(typeModal);
    setAddMode(false);
    state.pendingThrowFor = null;
  };
}
