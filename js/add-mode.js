import { addFlowBar, addFlowCancel, addFlowStep, addFlowText, addModeBtn, cancelType, detailPanel, fabAddBtn, lineupNameHint, lineupNameInput, lineupNameSuggestions, lineupSideSlot, mapFrame, mapImage, markerLayer, typeGrid, typeModal } from "./dom.js";
import { getCssVarColor, renderMarkers, typeColor } from "./markers.js";
import { closeModal } from "./modal-utils.js";
import { consumeDragFlags } from "./pan-zoom.js";
import { requireCanCreate } from "./permissions.js";
import { TYPES } from "./constants.js";
import { SIDES, sideSegment } from "./side.js";
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
  if (fabAddBtn) fabAddBtn.classList.toggle("active", on);
  mapFrame.classList.toggle("add-mode", on);
  if (!on) { hideAddFlow(); clearAddPreview(); }
}

export function startAddFlow() {
  if (!requireCanCreate()) return;
  setAddMode(true);
  openTypeModal((typeId) => {
    state.pendingType = typeId;
    state.pendingName = lineupNameInput ? lineupNameInput.value.trim() : "";
    // pendingSide was kept up to date by the segmented control in the dialog.
    closeModal(typeModal);
    showAddFlow(1, 2, "Click on the map where the nade lands.");
  });
}
addModeBtn.onclick = startAddFlow;
if (fabAddBtn) fabAddBtn.onclick = startAddFlow;

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

// ── Type picker + name prompt ────────────────────────────────────────────
// The name field gets focus as soon as the picker opens, so the user can
// type straight away. Keyboard: Enter in the name field confirms the
// highlighted type; the type grid is a radio group (arrows move, Enter /
// Space picks, 1-5 pick directly). The highlighted type starts as the one
// used last (people tend to add several smokes in a row); with no history
// nothing is highlighted, and Enter moves focus into the grid instead of
// silently picking a type for them. A blank name is allowed (the dossier
// shows "Unnamed position" and offers to name it later), but a soft,
// non-blocking warning appears once the user moves on without one.
const LAST_TYPE_KEY = "lineupr_last_type";
let highlightedType = null;
let typePick = null;

// Pluggable name suggestions (callouts for the map, recent names, ...).
// There is no callout data yet, so the default returns nothing and no chips
// render. A provider gets { mapId, typeId } and returns an array of strings.
let nameSuggestionProvider = () => [];
export function setNameSuggestionProvider(fn) {
  nameSuggestionProvider = typeof fn === "function" ? fn : () => [];
}

function renderNameSuggestions() {
  if (!lineupNameSuggestions) return;
  let list = [];
  try { list = nameSuggestionProvider({ mapId: state.mapId, typeId: highlightedType }) || []; } catch { list = []; }
  list = list.filter(n => typeof n === "string" && n.trim()).slice(0, 6);
  lineupNameSuggestions.innerHTML = "";
  list.forEach((name) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = name;
    b.onclick = () => { lineupNameInput.value = name; setNameHint(); lineupNameInput.focus(); };
    lineupNameSuggestions.appendChild(b);
  });
  lineupNameSuggestions.hidden = !list.length;
}

function setNameHint(warn = false) {
  if (!lineupNameHint) return;
  const named = !!lineupNameInput.value.trim();
  const label = highlightedType && (TYPES.find(t => t.id === highlightedType) || {}).label;
  if (warn && !named) {
    lineupNameHint.textContent = "No name yet. Unnamed lineups are harder to find later; you can also name it from the dossier.";
  } else if (label) {
    lineupNameHint.textContent = `Press Enter to continue as ${label}, or pick another type.`;
  } else {
    lineupNameHint.textContent = "Type a name, then pick the nade type.";
  }
  lineupNameHint.classList.toggle("is-warn", warn && !named);
}

function typeOptions() {
  return [...typeGrid.querySelectorAll(".type-opt")];
}

function highlightType(typeId, focus) {
  highlightedType = typeId;
  typeOptions().forEach((opt, i) => {
    const on = opt.dataset.type === typeId;
    opt.setAttribute("aria-checked", on ? "true" : "false");
    opt.tabIndex = on || (!typeId && i === 0) ? 0 : -1;
    if (on && focus) opt.focus();
  });
  setNameHint(lineupNameHint && lineupNameHint.classList.contains("is-warn"));
  renderNameSuggestions();
}

function pickType(typeId) {
  if (!typeId || !typePick) return;
  try { localStorage.setItem(LAST_TYPE_KEY, typeId); } catch {}
  typePick(typeId);
}

// buildTypeGrid (sidebar.js) makes plain clickable tiles; give them radio
// semantics and keyboard support here.
function enhanceTypeGrid() {
  typeOptions().forEach((opt, i) => {
    opt.dataset.type = TYPES[i].id;
    opt.setAttribute("role", "radio");
    opt.onclick = () => pickType(opt.dataset.type);
  });
}

if (typeGrid) {
  typeGrid.addEventListener("keydown", (e) => {
    if (!typePick) return;
    const opts = typeOptions();
    const i = Math.max(0, opts.indexOf(document.activeElement));
    if (["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(e.key)) {
      e.preventDefault();
      const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1;
      highlightType(opts[(i + step + opts.length) % opts.length].dataset.type, true);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      pickType((opts[i] && opts[i].dataset.type) || highlightedType);
    } else if (/^[1-9]$/.test(e.key) && opts[+e.key - 1]) {
      e.preventDefault();
      pickType(opts[+e.key - 1].dataset.type);
    }
  });
  typeGrid.addEventListener("focusin", () => setNameHint(true));
  typeGrid.addEventListener("pointerenter", () => { if (!lineupNameInput.value.trim()) setNameHint(true); });
}

if (lineupNameInput) {
  lineupNameInput.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.isComposing || !typePick || !typeModal.classList.contains("show")) return;
    e.preventDefault();
    if (highlightedType) pickType(highlightedType);
    else { setNameHint(true); highlightType(null); (typeOptions()[0] || lineupNameInput).focus(); }
  });
  lineupNameInput.addEventListener("input", () => setNameHint(false));
}

export function openTypeModal(onPick) {
  buildTypeGrid(onPick);
  typePick = onPick;
  enhanceTypeGrid();
  if (lineupNameInput) lineupNameInput.value = "";
  state.pendingSide = "any";
  if (lineupSideSlot) {
    lineupSideSlot.replaceChildren(sideSegment(SIDES, "any", (v) => { state.pendingSide = v; }, { label: "Side" }));
  }
  let last = null;
  try { last = localStorage.getItem(LAST_TYPE_KEY); } catch {}
  highlightType(TYPES.some(t => t.id === last) ? last : null);
  setNameHint(false);
  typeModal.classList.add("show");
  if (lineupNameInput) lineupNameInput.focus({ preventScroll: true });
}

cancelType.onclick = () => { closeModal(typeModal); typePick = null; setAddMode(false); };

// Cancel the whole placement flow from the guided bar.
if (addFlowCancel) {
  addFlowCancel.onclick = () => {
    closeModal(typeModal);
    setAddMode(false);
    state.pendingThrowFor = null;
  };
}
