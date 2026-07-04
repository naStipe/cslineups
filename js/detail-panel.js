import { setAddMode } from "./add-mode.js";
import { dbDelete, dbPut, dbSaveLineup, dbUnsaveLineup, throwKey } from "./api.js";
import { authUser } from "./auth.js";
import { MOVEMENT_LABELS, RANGE_LABELS, TYPES } from "./constants.js";
import { addHint, addThrowBtn, closeDetail, deleteLineupBtn, detailNameInput, detailOwnerBadge, detailPanel, detailTitle, detailType, saveLineupBtn, throwList, typeModal } from "./dom.js";
import { openLightbox } from "./lightbox.js";
import { loadLineups, refreshLocal, upsertLocalLineup } from "./map-data.js";
import { getCssVarColor, renderMarkers } from "./markers.js";
import { closeModal } from "./modal-utils.js";
import { canModifyLineup, requireLineupEditable } from "./permissions.js";
import { buildTypeGrid } from "./sidebar.js";
import { state } from "./state.js";
import { openThrowModal } from "./throw-modal.js";

export let selectedThrowIdx = 0;

export function openDetail(lineupId, throwIdx) {
  state.selectedLineupId = lineupId;
  selectedThrowIdx = throwIdx !== undefined ? throwIdx : 0;
  const lineup = state.lineups.find(l => l.id === lineupId);
  if (!lineup) return;
  renderDetail(lineup);
  detailPanel.classList.add("open");
  renderMarkers();
}

export function renderDetail(lineup) {
  const editable = canModifyLineup(lineup);
  const canBookmark = state.viewMode === "official" && lineup.isOfficial && !!authUser;
  const isBookmarkedRef = state.viewMode === "personal" && lineup.isOfficial;

  renderDetailType(lineup, editable);
  detailTitle.textContent = `${lineup.throws.length} variant${lineup.throws.length === 1 ? "" : "s"}`;

  if (detailOwnerBadge) {
    detailOwnerBadge.textContent = lineup.isOfficial ? "Official" : "My lineup";
    detailOwnerBadge.classList.toggle("badge-official", lineup.isOfficial);
    detailOwnerBadge.classList.toggle("badge-personal", !lineup.isOfficial);
  }

  addThrowBtn.classList.toggle("hidden", !editable);
  // Whole-lineup delete only applies to content you actually own/administer.
  // Bookmarked references are removed one throw position at a time instead
  // (see the per-throw button in the hero card below).
  deleteLineupBtn.classList.toggle("hidden", !editable);
  deleteLineupBtn.textContent = "Delete this lineup";

  if (saveLineupBtn) saveLineupBtn.classList.add("hidden"); // superseded by the per-throw button in the hero card

  // Name field
  detailNameInput.value = lineup.name || "";
  detailNameInput.disabled = !editable;
  detailNameInput.onchange = async () => {
    if (!editable) { detailNameInput.value = lineup.name || ""; return; }
    lineup.name = detailNameInput.value.trim();
    await dbPut(lineup, lineup.isOfficial);
    refreshLocal();
  };
  throwList.innerHTML = "";

  if (!lineup.throws.length) return;

  selectedThrowIdx = Math.min(selectedThrowIdx, lineup.throws.length - 1);
  const active = lineup.throws[selectedThrowIdx];

  // ── HERO ──
  const hero = document.createElement("div");
  hero.className = "detail-hero";
  hero.innerHTML = buildHeroHtml(active, selectedThrowIdx, lineup);
  wireCarousels(hero, active);
  const heroEditBtn = hero.querySelector(".edit-btn");
  const heroRemoveBtn = hero.querySelector(".remove-btn");
  const heroSaveBtn = hero.querySelector(".save-btn");
  if (editable) {
    heroEditBtn.onclick = () => {
      openThrowModal(active.pos, lineup.id, false, lineup.type, lineup.landing, active);
    };
    heroRemoveBtn.onclick = async () => {
      lineup.throws = lineup.throws.filter(x => x.id !== active.id);
      if (lineup.throws.length === 0) {
        await dbDelete(lineup.id);
        state.lineups = state.lineups.filter(l => l.id !== lineup.id);
        closeDetailPanel();
      } else {
        await dbPut(lineup, lineup.isOfficial);
        upsertLocalLineup(lineup);
      }
      refreshLocal();
      if (state.selectedLineupId) openDetail(state.selectedLineupId, Math.max(0, selectedThrowIdx - 1));
    };
  } else {
    heroEditBtn.style.display = "none";
    heroRemoveBtn.style.display = "none";
  }

  // Bookmarking works per throw position, not per whole lineup: in the
  // official view, any signed-in user can save just this variant; in the
  // personal view, a bookmarked (non-owned) variant can be removed the
  // same way, one at a time.
  if (canBookmark) {
    const saved = state.savedThrowKeys.has(throwKey(lineup.id, active.id));
    heroSaveBtn.style.display = "";
    heroSaveBtn.textContent = saved ? "★ Saved" : "☆ Save to my map";
    heroSaveBtn.classList.toggle("saved", saved);
    heroSaveBtn.onclick = async () => {
      heroSaveBtn.disabled = true;
      try {
        if (saved) {
          await dbUnsaveLineup(lineup.id, active.id);
          state.savedThrowKeys.delete(throwKey(lineup.id, active.id));
        } else {
          await dbSaveLineup(lineup.id, active.id);
          state.savedThrowKeys.add(throwKey(lineup.id, active.id));
        }
        renderDetail(lineup);
      } catch (err) {
        alert((err && err.message) || "Something went wrong.");
      } finally {
        heroSaveBtn.disabled = false;
      }
    };
  } else if (isBookmarkedRef) {
    heroSaveBtn.style.display = "";
    heroSaveBtn.textContent = "✕ Remove from my map";
    heroSaveBtn.classList.remove("saved");
    heroSaveBtn.onclick = async () => {
      if (!confirm("Remove this throw position from your personal map?")) return;
      heroSaveBtn.disabled = true;
      try {
        await dbUnsaveLineup(lineup.id, active.id);
        state.savedThrowKeys.delete(throwKey(lineup.id, active.id));
        lineup.throws = lineup.throws.filter(x => x.id !== active.id);
        if (lineup.throws.length === 0) {
          state.lineups = state.lineups.filter(l => l.id !== lineup.id);
          closeDetailPanel();
          refreshLocal();
        } else {
          upsertLocalLineup(lineup);
          refreshLocal();
          openDetail(lineup.id, Math.max(0, selectedThrowIdx - 1));
        }
      } catch (err) {
        alert((err && err.message) || "Something went wrong.");
        heroSaveBtn.disabled = false;
      }
    };
  } else {
    heroSaveBtn.style.display = "none";
  }

  throwList.appendChild(hero);

  // ── THUMBNAIL STRIP ──
  if (lineup.throws.length > 1) {
    const strip = document.createElement("div");
    strip.className = "detail-strip";
    lineup.throws.forEach((t, i) => {
      const thumb = document.createElement("div");
      thumb.className = "detail-strip-thumb" + (i === selectedThrowIdx ? " active" : "");
      const preview = (t.screenshots && t.screenshots[0]) || (t.standing && t.standing[0]) || "";
      thumb.innerHTML = `
        ${preview ? `<img src="${escapeHtml(preview)}" alt="Variant ${i+1}">` : `<div class="strip-thumb-empty"></div>`}
        <span class="strip-thumb-label">V${String(i+1).padStart(2,"0")}</span>
      `;
      thumb.onclick = () => {
        selectedThrowIdx = i;
        renderDetail(lineup);
      };
      strip.appendChild(thumb);
    });
    throwList.appendChild(strip);
  }
}

export function buildHeroHtml(t, idx, lineup) {
  const standingImgs = (t.standing && t.standing.length) ? t.standing : [];
  const aimImgs = (t.screenshots && t.screenshots.length) ? t.screenshots : [];
  const hasImages = standingImgs.length || aimImgs.length || t.precise;

  const makeCarousel = (imgs, label, cssClass) => {
    if (!imgs.length) return "";
    const multi = imgs.length > 1;
    return `
      <div class="tc-carousel" data-class="${cssClass}">
        <div class="tc-carousel-label">${label}</div>
        <div class="tc-carousel-inner">
          <img class="tc-carousel-img ${cssClass}" src="${escapeHtml(imgs[0])}" data-imgs='${escapeHtml(JSON.stringify(imgs))}' data-idx="0" alt="${label}">
          ${multi ? `<button class="tc-arrow tc-prev" type="button">‹</button>
                     <button class="tc-arrow tc-next" type="button">›</button>
                     <div class="tc-dots">${imgs.map((_,i) => `<span class="tc-dot${i===0?" active":""}"></span>`).join("")}</div>` : ""}
        </div>
      </div>`;
  };

  const preciseHtml = t.precise ? `
    <div class="tc-carousel">
      <div class="tc-carousel-label">Precise</div>
      <div class="tc-carousel-inner">
        <img class="tc-carousel-img" src="${escapeHtml(t.precise)}" alt="Precise lineup">
      </div>
    </div>` : "";

  return `
    <div class="hero-header">
      <span class="variant-tag">VARIANT ${String(idx+1).padStart(2,"0")}</span>
      <div class="throw-meta">
        <span class="tag">${RANGE_LABELS[t.range] || escapeHtml(t.range)}</span>
        <span class="tag">${MOVEMENT_LABELS[t.movement] || escapeHtml(t.movement)}</span>
      </div>
      <div class="throw-card-actions">
        <button class="save-btn">☆ Save to my map</button>
        <button class="edit-btn">Edit</button>
        <button class="remove-btn">Remove</button>
      </div>
    </div>
    ${hasImages ? `<div class="tc-galleries hero-galleries">
      ${makeCarousel(standingImgs, "Stand here", "standing-gallery")}
      ${makeCarousel(aimImgs, "Aim here", "aim-gallery")}
      ${preciseHtml}
    </div>` : ""}
    ${t.notes ? `<div class="throw-notes hero-notes">${escapeHtml(t.notes)}</div>` : ""}
  `;
}

export function wireCarousels(container, t) {
  container.querySelectorAll(".tc-carousel").forEach(carousel => {
    const img = carousel.querySelector(".tc-carousel-img");
    if (!img) return;
    const inner = carousel.querySelector(".tc-carousel-inner");
    const raw = img.dataset.imgs;
    if (!raw) {
      img.onclick = () => openLightbox([img.src], 0, img.alt);
      return;
    }
    const imgs = JSON.parse(raw);
    const dots = carousel.querySelectorAll(".tc-dot");
    let cur = 0;
    const go = (n) => {
      cur = (n + imgs.length) % imgs.length;
      img.src = imgs[cur];
      img.dataset.idx = cur;
      dots.forEach((d, i) => d.classList.toggle("active", i === cur));
    };
    const prev = carousel.querySelector(".tc-prev");
    const next = carousel.querySelector(".tc-next");
    if (prev) prev.onclick = (e) => { e.stopPropagation(); go(cur - 1); };
    if (next) next.onclick = (e) => { e.stopPropagation(); go(cur + 1); };
    img.onclick = () => openLightbox(imgs, cur, img.alt);

    // Touch swipe through photos on mobile
    if (inner && imgs.length > 1) {
      let swipeStartX = null;
      inner.addEventListener("touchstart", e => {
        swipeStartX = e.touches[0].clientX;
      }, { passive: true });
      inner.addEventListener("touchend", e => {
        if (swipeStartX === null) return;
        const dx = e.changedTouches[0].clientX - swipeStartX;
        swipeStartX = null;
        if (Math.abs(dx) < 35) return;
        if (dx < 0) go(cur + 1); else go(cur - 1);
      }, { passive: true });
    }
  });
}

export function renderDetailType(lineup, editable) {
  const typeInfo = TYPES.find(t => t.id === lineup.type);
  detailType.textContent = editable ? typeInfo.label + " ✎" : typeInfo.label;
  detailType.style.color = "#0a0d0e";
  detailType.style.background = getCssVarColor(typeInfo.color);
  detailType.style.cursor = editable ? "pointer" : "default";
  detailType.title = editable ? "Click to change nade type" : "";
  detailType.onclick = () => {
    if (!editable) return;
    openTypeModalForEdit(lineup);
  };
}

export function openTypeModalForEdit(lineup) {
  buildTypeGrid(async (typeId) => {
    closeModal(typeModal);
    lineup.type = typeId;
    await dbPut(lineup, lineup.isOfficial);
    await loadLineups();
    openDetail(lineup.id);
  });
  typeModal.classList.add("show");
}

export function closeDetailPanel() {
  state.selectedLineupId = null;
  detailPanel.classList.remove("open");
  renderMarkers();
}

closeDetail.onclick = closeDetailPanel;

detailPanel.addEventListener("click", (e) => {
  if (e.target === detailPanel) closeDetailPanel();
});

addThrowBtn.onclick = () => {
  const lineup = state.lineups.find(l => l.id === state.selectedLineupId);
  if (!requireLineupEditable(lineup)) return;
  state.pendingThrowFor = state.selectedLineupId;
  setAddMode(true);
  addHint.textContent = "Click the spot you throw from.";
  detailPanel.classList.remove("open");
};

deleteLineupBtn.onclick = async () => {
  if (!state.selectedLineupId) return;
  const lineup = state.lineups.find(l => l.id === state.selectedLineupId);
  if (!lineup) return;
  if (!requireLineupEditable(lineup)) return;
  if (!confirm("Delete this entire lineup, including all throw positions?")) return;
  const delId = state.selectedLineupId;
  await dbDelete(delId);
  state.lineups = state.lineups.filter(l => l.id !== delId);
  closeDetailPanel();
  refreshLocal();
};

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
