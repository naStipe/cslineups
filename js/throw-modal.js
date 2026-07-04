import { setAddMode } from "./add-mode.js";
import { dbGetAll, dbPut } from "./api.js";
import { authUser, isAdmin } from "./auth.js";
import { openDetail } from "./detail-panel.js";
import { cancelThrow, mapImage, movementSelect, notesInput, saveThrow, throwModal, throwModalHint, throwModalTitle, throwRangeSelect, tmPreviewImg, tmPreviewLanding, tmPreviewSvg, tmPreviewThrow } from "./dom.js";
import { renderPreciseThumb, renderStandingThumbGrid, renderThumbGrid, uploadDataUrlToSupabase } from "./image-upload.js";
import { refreshLocal, upsertLocalLineup } from "./map-data.js";
import { getCssVarColor, typeColor } from "./markers.js";
import { closeModal } from "./modal-utils.js";
import { requireCanCreate, requireLineupEditable } from "./permissions.js";
import { state, uid } from "./state.js";

export let pendingThrowDraft = null; // {x,y,screenshot,...} being built before save

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
    standing: existingThrow ? [...(existingThrow.standing || [])] : [],
    screenshots: existingThrow ? [...existingThrow.screenshots] : [],
    precise: existingThrow ? existingThrow.precise || null : null,
    editingThrowId: existingThrow ? existingThrow.id : null,
  };

  renderStandingThumbGrid();
  renderThumbGrid();
  renderPreciseThumb();
  throwRangeSelect.value = existingThrow ? existingThrow.range : "throw";
  movementSelect.value = existingThrow ? existingThrow.movement : "none";
  notesInput.value = existingThrow ? existingThrow.notes || "" : "";

  if (existingThrow) {
    throwModalTitle.textContent = "Edit throw position";
    throwModalHint.textContent = "Editing this throw position's details. The map position stays the same.";
  } else {
    throwModalTitle.textContent = isNewLineup ? "New lineup — throw position" : "Add throw position";
    throwModalHint.textContent = "Click confirmed. Fill in the details below.";
  }
  throwModal.classList.add("show");
}

cancelThrow.onclick = () => {
  closeModal(throwModal);
  pendingThrowDraft = null;
  setAddMode(false);
  state.pendingThrowFor = null;
};

saveThrow.onclick = async () => {
  if (!pendingThrowDraft) return;
  if (pendingThrowDraft.isNewLineup) {
    if (!requireCanCreate()) return;
  } else {
    const existingLineup = state.lineups.find(l => l.id === pendingThrowDraft.lineupId);
    if (!requireLineupEditable(existingLineup)) return;
  }
  if (pendingThrowDraft.screenshots.length === 0) {
    if (!confirm("No screenshots attached — save anyway?")) return;
  }

  saveThrow.disabled = true;
  saveThrow.textContent = "Uploading images…";

  try {
    const draft = pendingThrowDraft;

    // Upload any local data URLs to Supabase now (parallel)
    const [standing, screenshots, precise] = await Promise.all([
      Promise.all(draft.standing.map(uploadDataUrlToSupabase)),
      Promise.all(draft.screenshots.map(uploadDataUrlToSupabase)),
      draft.precise ? uploadDataUrlToSupabase(draft.precise) : Promise.resolve(null),
    ]);

    saveThrow.textContent = "Saving…";

    const throwEntryBase = {
      pos: draft.throwPos,
      standing,
      screenshots,
      precise,
      range: throwRangeSelect.value,
      movement: movementSelect.value,
      notes: notesInput.value.trim(),
    };

    if (draft.isNewLineup) {
      const isOfficial = state.viewMode === "official" && isAdmin();
      const lineup = {
        id: draft.lineupId,
        mapId: state.mapId,
        type: draft.typeId,
        name: state.pendingName || "",
        landing: draft.landingPos,
        throws: [{ id: uid(), ...throwEntryBase }],
        createdAt: Date.now(),
        isOfficial,
        ownerId: isOfficial ? null : (authUser ? authUser.id : null),
      };
      await dbPut(lineup, isOfficial);
      upsertLocalLineup(lineup);
    } else {
      let lineup = state.lineups.find(l => l.id === draft.lineupId);
      if (!lineup) {
        const all = await dbGetAll();
        lineup = all.find(l => l.id === draft.lineupId);
      }
      if (!lineup) throw new Error("Could not find the lineup to save this throw position to.");

      if (draft.editingThrowId) {
        const idx = lineup.throws.findIndex(t => t.id === draft.editingThrowId);
        if (idx === -1) throw new Error("Could not find the throw position to update.");
        lineup.throws[idx] = { id: draft.editingThrowId, ...throwEntryBase };
      } else {
        lineup.throws.push({ id: uid(), ...throwEntryBase });
      }
      await dbPut(lineup, lineup.isOfficial);
      upsertLocalLineup(lineup);
    }

    const wasEditing = !!draft.editingThrowId;
    const reopenId = draft.lineupId;

    closeModal(throwModal);
    pendingThrowDraft = null;
    setAddMode(false);
    state.pendingThrowFor = null;
    refreshLocal();

    // If we were editing an existing throw, reopen the dossier so changes are visible immediately
    if (wasEditing) openDetail(reopenId);
  } catch (err) {
    console.error(err);
    alert(
      err && err.message === "SIGN_IN_REQUIRED" ? "Please sign in first." :
      err && err.message === "FORBIDDEN"        ? "You don't have permission to do that." :
      "Could not save: " + (err && err.message ? err.message : err)
    );
  } finally {
    saveThrow.disabled = false;
    saveThrow.textContent = "Save throw position";
  }
};
