import { addHint, addModeBtn, cancelType, detailPanel, lineupNameInput, mapFrame, mapImage, typeModal } from "./dom.js";
import { renderMarkers } from "./markers.js";
import { closeModal } from "./modal-utils.js";
import { consumeDragFlags } from "./pan-zoom.js";
import { requireCanCreate } from "./permissions.js";
import { buildTypeGrid } from "./sidebar.js";
import { state, uid } from "./state.js";
import { openThrowModal } from "./throw-modal.js";

export function setAddMode(on) {
  state.addMode = on;
  state.pendingType = null;
  state.pendingLanding = null;
  addModeBtn.classList.toggle("active", on);
  mapFrame.classList.toggle("add-mode", on);
  addHint.classList.toggle("show", on);
  if (on) addHint.textContent = "Click anywhere on the map to drop the landing spot for a new lineup.";
}

addModeBtn.onclick = () => {
  if (!requireCanCreate()) return;
  setAddMode(true);
  openTypeModal((typeId) => {
    state.pendingType = typeId;
    state.pendingName = lineupNameInput ? lineupNameInput.value.trim() : "";
    closeModal(typeModal);
    addHint.textContent = "Now click where this nade lands.";
  });
};

mapFrame.addEventListener("click", (e) => {
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
    openThrowModal({ x, y }, state.pendingThrowFor, false);
    return;
  }

  if (state.addMode && state.pendingType) {
    if (!state.pendingLanding) {
      state.pendingLanding = { x, y };
      addHint.textContent = "Now click the spot you throw from.";
    } else {
      const newId = uid();
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
