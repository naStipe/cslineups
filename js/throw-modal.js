import { setAddMode } from "./add-mode.js";
import { dbGetAll, dbPut } from "./api.js";
import { authUser, isAdmin } from "./auth.js";
import { openDetail } from "./detail-panel.js";
import { cancelThrow, cancelThrowBtn, mapImage, movementSelect, notesInput, repositionOnMapBtn, saveThrow, throwModal, throwModalHint, throwModalTitle, throwRangeSelect, tmPasteHint, tmPreviewImg, tmPreviewLanding, tmPreviewSvg, tmPreviewThrow } from "./dom.js";
import { addFiles, clearDropHighlights, discardItems, draftItems, imageUrlOf, releaseItem, renderPreciseThumb, renderResultThumb, renderStandingThumbGrid, renderThumbGrid, updateUploadSummary } from "./image-upload.js";
import { refreshLocal, upsertLocalLineup } from "./map-data.js";
import { getCssVarColor, typeColor } from "./markers.js";
import { closeModal, watchDialog } from "./modal-utils.js";
import { requireCanCreate, requireLineupEditable } from "./permissions.js";
import { startReposition } from "./reposition.js";
import { confirmDialog, isConfirmOpen } from "./confirm-dialog.js";
import { toast, toastError } from "./toast.js";
import { setBusy } from "./ui-utils.js";
import { state, uid } from "./state.js";

// The throw position being built before save:
// { throwPos, lineupId, isNewLineup, typeId, landingPos, isOfficial,
//   standing: [], screenshots: [], precise, result, editingThrowId, dirty }
// Image values are stored URLs (strings) or upload items, see
// js/image-upload.js.
export let pendingThrowDraft = null;

// Anything the user would lose by closing: an image added/removed/moved, a
// field edited, the spot repositioned. Drives the discard confirmation and
// the beforeunload prompt.
export function markThrowDraftDirty() {
  if (pendingThrowDraft) pendingThrowDraft.dirty = true;
}

export function renderThrowModalPreview(throwPos, landingPos, typeId) {
  tmPreviewImg.src = mapImage.src;
  const color = getCssVarColor(typeColor(typeId));
  tmPreviewThrow.style.background = color;

  const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line.setAttribute("x1", throwPos.x + "%");
  line.setAttribute("y1", throwPos.y + "%");
  line.setAttribute("x2", landingPos.x + "%");
  line.setAttribute("y2", landingPos.y + "%");
  line.setAttribute("stroke", color);
  line.setAttribute("class", "tm-preview-line");
  tmPreviewSvg.innerHTML = "";
  tmPreviewSvg.appendChild(line);

  tmPreviewLanding.style.left = landingPos.x + "%";
  tmPreviewLanding.style.top = landingPos.y + "%";
  tmPreviewThrow.style.left = throwPos.x + "%";
  tmPreviewThrow.style.top = throwPos.y + "%";
}

export function openThrowModal(throwPos, lineupId, isNewLineup, typeId, landingPos, existingThrow) {
  const existingLineup = !isNewLineup ? state.lineups.find(l => l.id === lineupId) : null;
  landingPos = landingPos || (existingLineup && existingLineup.landing);
  typeId = typeId || (existingLineup && existingLineup.type);
  renderThrowModalPreview(throwPos, landingPos, typeId);

  pendingThrowDraft = {
    throwPos,
    lineupId,
    isNewLineup,
    typeId,
    landingPos,
    // Officialness decides which bucket images go to (public for official,
    // private-per-user for personal), and images now upload the moment
    // they're added, so it's settled here rather than at save time.
    isOfficial: isNewLineup ? (state.viewMode === "official" && isAdmin()) : !!(existingLineup && existingLineup.isOfficial),
    standing: existingThrow ? [...(existingThrow.standing || [])] : [],
    screenshots: existingThrow ? [...existingThrow.screenshots] : [],
    precise: existingThrow ? existingThrow.precise || null : null,
    result: existingThrow ? existingThrow.result || null : null,
    editingThrowId: existingThrow ? existingThrow.id : null,
    dirty: false,
  };
  hoveredSlot = null;
  focusedSlot = null;

  renderStandingThumbGrid();
  renderThumbGrid();
  renderPreciseThumb();
  renderResultThumb();
  throwRangeSelect.value = existingThrow ? existingThrow.range : "throw";
  movementSelect.value = existingThrow ? existingThrow.movement : "none";
  notesInput.value = existingThrow ? existingThrow.notes || "" : "";

  if (existingThrow) {
    throwModalTitle.textContent = "Edit throw position";
    throwModalHint.textContent = "Update details below, or use ⤢ Reposition on map to move the throw spot.";
  } else {
    throwModalTitle.textContent = isNewLineup ? "New lineup — throw position" : "Add throw position";
    throwModalHint.textContent = "Add screenshots and technique. Not quite right? ⤢ Reposition on map to nudge the spot.";
  }
  throwModal.classList.add("show");
}

watchDialog(throwModal, "show", () => cancelThrow);

[throwRangeSelect, movementSelect, notesInput].forEach(el => {
  el.addEventListener("input", markThrowDraftDirty);
  el.addEventListener("change", markThrowDraftDirty);
});

// On a Mac the paste shortcut is ⌘V; Win+Shift+S is how Windows players
// grab a region, so the hint names it there.
if (tmPasteHint && /Mac|iPhone|iPad/.test(navigator.platform || "")) {
  tmPasteHint.innerHTML = "Tip: paste screenshots with <kbd>⌘</kbd><kbd>V</kbd>, or drop image files onto a slot.";
} else if (tmPasteHint) {
  tmPasteHint.innerHTML = "Tip: paste screenshots with <kbd>Ctrl</kbd>+<kbd>V</kbd> (grab one with <kbd>Win</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd>), or drop image files onto a slot.";
}

// Hide the modal, let the user drag the throw-from spot on the full map, then
// reopen the modal with the updated position (no save yet — the throw is only
// persisted when the modal's Save button is pressed). Uploads keep running.
if (repositionOnMapBtn) {
  repositionOnMapBtn.onclick = () => {
    const draft = pendingThrowDraft;
    if (!draft) return;
    throwModal.classList.remove("show");
    startReposition({
      typeId: draft.typeId,
      landing: draft.landingPos,
      throwPos: draft.throwPos,
      onDone: (result) => {
        if (result) {
          draft.throwPos = result.throwPos;
          draft.dirty = true;
          renderThrowModalPreview(draft.throwPos, draft.landingPos, draft.typeId);
        }
        throwModal.classList.add("show");
      },
    });
  };
}

// Resets the add flow and forgets the draft. `discard` also cancels and
// deletes uploads that were never saved; after a successful save the items
// are referenced by the lineup, so only their local previews are freed.
function endThrowFlow({ discard }) {
  const draft = pendingThrowDraft;
  closeModal(throwModal);
  pendingThrowDraft = null;
  setAddMode(false);
  state.pendingThrowFor = null;
  clearDropHighlights();
  if (draft) {
    const items = draftItems(draft);
    if (discard) discardItems(items);
    else items.forEach(releaseItem);
  }
}

// Every way of closing the modal goes through here: ✕ (#cancelThrow, which
// Escape clicks via data-esc), Cancel, and a click on the backdrop. If
// anything would be lost, ask first.
let closing = false;
async function requestCloseThrowModal() {
  const draft = pendingThrowDraft;
  if (!draft || closing) return;
  if (saveThrow.dataset.busy === "1") return; // saving: let it finish
  if (draft.dirty) {
    closing = true;
    const n = draftItems(draft).length;
    const ok = await confirmDialog({
      title: "Discard this throw position?",
      body: n ? `The ${n === 1 ? "screenshot" : `${n} screenshots`} and details you added will be lost.` : "Your changes will be lost.",
      confirmLabel: "Discard",
      cancelLabel: "Keep editing",
      danger: true,
    });
    closing = false;
    if (!ok || pendingThrowDraft !== draft) return;
  }
  endThrowFlow({ discard: true });
}
cancelThrow.onclick = requestCloseThrowModal;
if (cancelThrowBtn) cancelThrowBtn.onclick = requestCloseThrowModal;

// Backdrop click: only when the press also started on the backdrop, so a
// text selection dragged out of the notes field doesn't close the modal.
let pressOnBackdrop = false;
throwModal.addEventListener("pointerdown", (e) => { pressOnBackdrop = e.target === throwModal; });
throwModal.addEventListener("click", (e) => {
  if (e.target === throwModal && pressOnBackdrop) requestCloseThrowModal();
  pressOnBackdrop = false;
});

// Leaving the page with unsaved work: the browser's own "Leave site?"
// prompt while anything is dirty or still uploading, and a best-effort
// cleanup of unsaved uploads if the page really goes away.
window.addEventListener("beforeunload", (e) => {
  const draft = pendingThrowDraft;
  if (!draft) return;
  if (draft.dirty || draftItems(draft).some(i => i.status !== "done")) {
    e.preventDefault();
    e.returnValue = "";
  }
});
window.addEventListener("pagehide", (e) => {
  if (e.persisted || !pendingThrowDraft) return;
  discardItems(draftItems(pendingThrowDraft));
});

// ── Paste (Ctrl+V) and drops outside a slot ─────────────────────────────
// A pasted image goes to the slot under the pointer, else the slot that
// has focus, else the next empty slot (Standing → Aim → Precise → Result).
let hoveredSlot = null;
let focusedSlot = null;
throwModal.addEventListener("pointerover", (e) => {
  const col = e.target.closest && e.target.closest("[data-slot]");
  hoveredSlot = col ? col.dataset.slot : null;
});
throwModal.addEventListener("pointerleave", () => { hoveredSlot = null; });
throwModal.addEventListener("focusin", (e) => {
  const col = e.target.closest && e.target.closest("[data-slot]");
  focusedSlot = col ? col.dataset.slot : null;
});

function imageFilesFrom(dt) {
  if (!dt) return [];
  let files = [...(dt.files || [])];
  if (!files.length && dt.items) {
    files = [...dt.items].filter(i => i.kind === "file").map(i => i.getAsFile()).filter(Boolean);
  }
  return files.filter(f => !f.type || f.type.startsWith("image/"));
}

document.addEventListener("paste", (e) => {
  if (!pendingThrowDraft || !throwModal.classList.contains("show") || isConfirmOpen()) return;
  const files = imageFilesFrom(e.clipboardData);
  if (!files.length) return; // plain text paste into notes stays untouched
  e.preventDefault();
  addFiles(hoveredSlot || focusedSlot || null, files, { highlight: true });
});

// Files dropped on the modal but not on a slot are routed like a paste,
// and never let the browser navigate away to the dropped file.
throwModal.addEventListener("dragover", (e) => {
  if (![...(e.dataTransfer.types || [])].includes("Files")) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "copy";
});
throwModal.addEventListener("drop", (e) => {
  const files = imageFilesFrom(e.dataTransfer);
  if (!files.length) return;
  e.preventDefault();
  clearDropHighlights();
  if (pendingThrowDraft) addFiles(null, files, { highlight: true });
});
document.addEventListener("dragend", clearDropHighlights);

// ── Save ────────────────────────────────────────────────────────────────
// Uploads normally finished while the user was filling in the form, so Save
// usually just writes the row. Anything still in flight is awaited here,
// with the button counting down.
async function waitForUploads(draft) {
  const items = draftItems(draft);
  const pending = items.filter(i => i.status === "compressing" || i.status === "uploading");
  if (pending.length) {
    const label = () => {
      const left = draftItems(draft).filter(i => i.status === "compressing" || i.status === "uploading").length;
      return left ? `Uploading… ${left} left` : "Saving…";
    };
    setBusy(saveThrow, true, label());
    await Promise.all(pending.map(i => i.promise.catch(() => {}).then(() => setBusy(saveThrow, true, label()))));
  }
  return draftItems(draft).filter(i => i.status === "error").length;
}

saveThrow.onclick = async () => {
  const draft = pendingThrowDraft;
  if (!draft || saveThrow.dataset.busy === "1") return;
  if (draft.isNewLineup) {
    if (!requireCanCreate()) return;
  } else {
    const existingLineup = state.lineups.find(l => l.id === draft.lineupId);
    if (!requireLineupEditable(existingLineup)) return;
  }
  if (draft.screenshots.length === 0) {
    const ok = await confirmDialog({
      title: "Save without screenshots?",
      body: "No throw screenshots are attached. You can add them later by editing this throw position.",
      confirmLabel: "Save anyway",
    });
    if (!ok || pendingThrowDraft !== draft) return;
  }

  setBusy(saveThrow, true, "Saving…");

  try {
    const failed = await waitForUploads(draft);
    if (pendingThrowDraft !== draft) return;
    if (failed) {
      toastError(`${failed === 1 ? "A screenshot" : `${failed} screenshots`} didn't upload. Retry or remove ${failed === 1 ? "it" : "them"}, then save.`);
      return;
    }
    setBusy(saveThrow, true, "Saving…");

    let existingLineup = null;
    if (!draft.isNewLineup) {
      existingLineup = state.lineups.find(l => l.id === draft.lineupId);
      if (!existingLineup) {
        const all = await dbGetAll();
        existingLineup = all.find(l => l.id === draft.lineupId);
      }
      if (!existingLineup) throw new Error("Could not find the lineup to save this throw position to.");
      if (!!existingLineup.isOfficial !== draft.isOfficial && draftItems(draft).length) {
        throw new Error("This lineup changed while you were editing. Close the form and try again.");
      }
    }
    const isOfficial = draft.isNewLineup ? draft.isOfficial : !!existingLineup.isOfficial;

    const throwEntryBase = {
      pos: draft.throwPos,
      standing: draft.standing.map(imageUrlOf),
      screenshots: draft.screenshots.map(imageUrlOf),
      precise: draft.precise ? imageUrlOf(draft.precise) : null,
      result: draft.result ? imageUrlOf(draft.result) : null,
      range: throwRangeSelect.value,
      movement: movementSelect.value,
      notes: notesInput.value.trim(),
    };

    if (draft.isNewLineup) {
      const lineup = {
        id: draft.lineupId,
        mapId: state.mapId,
        type: draft.typeId,
        name: state.pendingName || "",
        landing: draft.landingPos,
        throws: [{ id: uid(), createdAt: Date.now(), ...throwEntryBase }],
        createdAt: Date.now(),
        isOfficial,
        ownerId: isOfficial ? null : (authUser ? authUser.id : null),
      };
      await dbPut(lineup, isOfficial);
      upsertLocalLineup(lineup);
    } else {
      // Work on a copy so a failed save doesn't leave the local lineup
      // half-edited.
      const lineup = { ...existingLineup, throws: [...existingLineup.throws] };
      if (draft.editingThrowId) {
        const idx = lineup.throws.findIndex(t => t.id === draft.editingThrowId);
        if (idx === -1) throw new Error("Could not find the throw position to update.");
        const prev = lineup.throws[idx];
        lineup.throws[idx] = { id: draft.editingThrowId, ...(prev.createdAt ? { createdAt: prev.createdAt } : {}), ...throwEntryBase };
      } else {
        lineup.throws.push({ id: uid(), createdAt: Date.now(), ...throwEntryBase });
      }
      await dbPut(lineup, lineup.isOfficial);
      Object.assign(existingLineup, lineup);
      upsertLocalLineup(existingLineup);
    }

    const wasEditing = !!draft.editingThrowId;
    const reopenId = draft.lineupId;

    setBusy(saveThrow, false);
    endThrowFlow({ discard: false });
    refreshLocal();

    // If we were editing an existing throw, reopen the dossier so changes are visible immediately
    if (wasEditing) openDetail(reopenId);
    toast(wasEditing ? "Throw position updated" : "Lineup saved");
  } catch (err) {
    console.error(err);
    toastError(
      err && err.message === "SIGN_IN_REQUIRED" ? "Please sign in first." :
      err && err.message === "FORBIDDEN"        ? "You don't have permission to do that." :
      "Could not save: " + (err && err.message ? err.message : err)
    );
  } finally {
    setBusy(saveThrow, false);
    updateUploadSummary();
  }
};
