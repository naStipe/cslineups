import { openTypeModal, setAddMode, showAddFlow } from "./add-mode.js";
import { API_URL, SAVED_URL, dbPut, dbSaveLineup, dbShareLineup, dbSubmitLineup, dbUnsaveLineup, throwKey } from "./api.js";
import { authUser } from "./auth.js";
import { MOVEMENT_LABELS, RANGE_LABELS, TYPES } from "./constants.js";
import { addThrowBtn, closeDetail, deleteLineupBtn, detailNameInput, detailOwnerBadge, detailSideSlot, detailPanel, detailTitle, detailType, markerLayer, saveLineupBtn, shareLineupBtn, submitLineupBtn, submitLineupNote, throwList, typeModal } from "./dom.js";
import { attachInlineZoom, attachSheetDrag, attachStripReorder, attachVariantSwipe, loadFrameImage, loadFrameImages } from "./dossier-gestures.js";
import { openLightbox } from "./lightbox.js";
import { refreshLocal, upsertLocalLineup } from "./map-data.js";
import { getCssVarColor, renderMarkers } from "./markers.js";
import { closeModal, watchDialog } from "./modal-utils.js";
import { canModifyLineup, requireLineupEditable } from "./permissions.js";
import { startReposition } from "./reposition.js";
import { state } from "./state.js";
import { escapeHtml } from "./html-utils.js";
import { openThrowModal } from "./throw-modal.js";
import { confirmDialog } from "./confirm-dialog.js";
import { timeEl } from "./time-utils.js";
import { resolveImageSrc } from "./private-images.js";
import { SIDES, normalizeSide, sideLabel, sideSegment } from "./side.js";
import { toast, toastError } from "./toast.js";
import { setBusy } from "./ui-utils.js";
import { deferDelete } from "./undo-delete.js";

export let selectedThrowIdx = 0;

const detailNameNudge = document.getElementById("detailNameNudge");
const sheet = detailPanel.querySelector(".detail-panel-inner");
const sheetHandle = detailPanel.querySelector(".sheet-handle");
const pad2 = (n) => String(n).padStart(2, "0");
const isOpenOn = (lineupId) => state.selectedLineupId === lineupId && detailPanel.classList.contains("open");

// `throwIdx` undefined means "the default variant" (the first one), except
// when the dossier is already showing this lineup (e.g. reopened after an
// edit), where it stays on the variant being looked at.
// opts.highlight briefly rings the variant (used for ?throw= deep links).
// Last lineup shown in the dossier: focus returns to its marker on close.
let lastDossierLineupId = null;

export function openDetail(lineupId, throwIdx, opts = {}) {
  const lineup = state.lineups.find(l => l.id === lineupId);
  if (!lineup) return;
  lastDossierLineupId = lineupId;
  const keep = throwIdx === undefined && isOpenOn(lineupId);
  state.selectedLineupId = lineupId;
  if (!keep) selectedThrowIdx = throwIdx !== undefined ? throwIdx : 0;
  selectedThrowIdx = clampIdx(lineup, selectedThrowIdx);
  renderDetail(lineup, { highlight: !!opts.highlight });
  detailPanel.classList.add("open");
  renderMarkers();
  syncLineupUrl(lineup);
}

const clampIdx = (lineup, i) => Math.max(0, Math.min(Number.isInteger(i) ? i : 0, lineup.throws.length - 1));

// ?throw=N in a lineup URL is 1-based, matching the "VARIANT 0N" label.
// Returns the 0-based index, or undefined when absent / not a number.
export function throwIndexFromParams(params) {
  const n = parseInt(params.get("throw"), 10);
  return Number.isFinite(n) && n >= 1 ? n - 1 : undefined;
}

// The variant only goes in the URL when there's more than one to pick from.
function lineupPath(lineup, idx) {
  let url = `/?map=${state.mapId}&lineup=${encodeURIComponent(lineup.id)}`;
  if (lineup.throws.length > 1) url += `&throw=${idx + 1}`;
  return url;
}

// The open lineup lives in the URL (/?map=x&lineup=id[&throw=n]) as its own
// history entry on top of the map view, so browser Back closes the dossier
// instead of leaving the map. Switching lineups or variants while one is open
// replaces that entry (variants are never their own Back step). Entries we
// pushed carry `dossier: true` in their state, so closing knows to pop them,
// including after Back/Forward brought one back.
function syncLineupUrl(lineup) {
  const url = lineupPath(lineup, selectedThrowIdx);
  const hs = history.state;
  const throwNo = lineup.throws.length > 1 ? selectedThrowIdx + 1 : null;
  if (hs && hs.lineup === lineup.id && (hs.throw || null) === throwNo && location.pathname + location.search === url) return;
  if (hs && hs.lineup) history.replaceState({ ...hs, view: "map", map: state.mapId, lineup: lineup.id, throw: throwNo }, "", url);
  else history.pushState({ view: "map", map: state.mapId, lineup: lineup.id, throw: throwNo, dossier: true }, "", url);
}

// Hide without touching history — for popstate and full-page navigations.
export function hideDetailPanel() {
  state.selectedLineupId = null;
  detailPanel.classList.remove("open");
  renderMarkers();
}

function selectVariant(lineup, idx, { dir = 0, focusThumb = false } = {}) {
  idx = clampIdx(lineup, idx);
  if (idx === selectedThrowIdx && !focusThumb) return;
  selectedThrowIdx = idx;
  renderDetail(lineup, { dir });
  syncLineupUrl(lineup);
  if (focusThumb) focusActiveThumb();
}

export function stepVariant(dir) {
  const lineup = state.lineups.find(l => l.id === state.selectedLineupId);
  if (!lineup || !detailPanel.classList.contains("open")) return;
  const next = selectedThrowIdx + dir;
  if (next < 0 || next >= lineup.throws.length) return; // no wrap: the ends are the ends
  selectVariant(lineup, next, { dir });
}

function focusActiveThumb() {
  const el = throwList.querySelector(".detail-strip-thumb.active") || throwList.querySelector(".variant-tag");
  if (el) el.focus({ preventScroll: true });
}

export function renderDetail(lineup, opts = {}) {
  const editable = canModifyLineup(lineup);
  // Someone else's personal lineup only reaches you through a collection its
  // owner shared; it can be bookmarked to your map like an official one.
  const othersPersonal = !lineup.isOfficial && !editable;
  const inCollection = !!state.collectionView;
  const canBookmark = !!authUser && ((state.viewMode === "official" && lineup.isOfficial) || (inCollection && (lineup.isOfficial || othersPersonal)) || (othersPersonal && state.viewMode === "official"));
  const isBookmarkedRef = state.viewMode === "personal" && !inCollection && (lineup.isOfficial || othersPersonal);
  const multi = lineup.throws.length > 1;

  renderDetailType(lineup, editable);
  const typeLabel = TYPES.find(t => t.id === lineup.type)?.label || "Lineup";
  document.getElementById("detailDialogTitle").textContent = lineup.name ? `${lineup.name} — ${typeLabel}` : `${typeLabel} lineup`;

  // Quiet meta line: variant count, plus when it was added for your own
  // lineups (official ones are curated content; a date there means little).
  detailTitle.textContent = `${lineup.throws.length} variant${multi ? "s" : ""}`;
  if (!lineup.isOfficial && lineup.createdAt) {
    const sep = document.createElement("span");
    sep.className = "meta-sep";
    sep.setAttribute("aria-hidden", "true");
    sep.textContent = "·";
    detailTitle.append(sep, timeEl(lineup.createdAt, "added "));
  }

  if (detailOwnerBadge) {
    // Personal lineups show where they stand with the official map.
    detailOwnerBadge.textContent = lineup.isOfficial ? "Official"
      : !editable ? "Shared lineup"
      : lineup.submittedAt ? "Suggested · awaiting review"
      : lineup.deniedAt ? "Suggestion not accepted"
      : "My lineup · not approved";
    detailOwnerBadge.classList.toggle("badge-official", lineup.isOfficial);
    detailOwnerBadge.classList.toggle("badge-personal", !lineup.isOfficial);
  }

  addThrowBtn.classList.toggle("hidden", !editable);
  // Whole-lineup delete only applies to content you actually own/administer.
  // Bookmarked references are removed one throw position at a time instead
  // (see the per-throw button in the hero card below).
  deleteLineupBtn.classList.toggle("hidden", !editable);
  deleteLineupBtn.textContent = "Delete this lineup";

  renderSubmitControls(lineup, editable);
  renderLinkShareControls(lineup, editable);

  if (saveLineupBtn) saveLineupBtn.classList.add("hidden"); // superseded by the per-throw button in the hero card

  if (shareLineupBtn) {
    const needsOptIn = editable && !lineup.isOfficial && !lineup.linkShared;
    const label = needsOptIn ? "Share with a link" : multi ? "Copy link to this variant" : "Copy shareable link";
    shareLineupBtn.title = label;
    if (!shareLineupBtn.classList.contains("copied")) shareLineupBtn.setAttribute("aria-label", label);
    shareLineupBtn.onclick = () => copyShareLink(lineup);
  }

  renderName(lineup, editable);
  renderSide(lineup, editable);

  throwList.innerHTML = "";

  if (!lineup.throws.length) return;

  selectedThrowIdx = clampIdx(lineup, selectedThrowIdx);
  const active = lineup.throws[selectedThrowIdx];

  // ── HERO ──
  const hero = document.createElement("div");
  hero.className = "detail-hero";
  if (opts.dir) hero.classList.add(opts.dir > 0 ? "enter-next" : "enter-prev");
  hero.innerHTML = (multi ? buildPagerHtml(lineup) : "") + buildHeroHtml(active, selectedThrowIdx, lineup);
  if (multi) {
    hero.querySelector(".pager-prev").onclick = () => stepVariant(-1);
    hero.querySelector(".pager-next").onclick = () => stepVariant(1);
  }
  // Per-variant time, only where the variant carries one (older throws don't).
  const vt = hero.querySelector(".variant-time");
  if (vt && !lineup.isOfficial && active.createdAt) vt.replaceWith(timeEl(active.createdAt, "added "));
  else if (vt) vt.remove();
  wireCarousels(hero, active);
  wireClips(hero);
  const heroEditBtn = hero.querySelector(".edit-btn");
  const heroRemoveBtn = hero.querySelector(".remove-btn");
  const heroReposBtn = hero.querySelector(".reposition-btn");
  const heroSaveBtn = hero.querySelector(".save-btn");
  const heroDefaultBtn = hero.querySelector(".default-btn");
  if (editable) {
    heroEditBtn.onclick = () => {
      openThrowModal(active.pos, lineup.id, false, lineup.type, lineup.landing, active);
    };
    // Reposition just this throw-from spot: close the dossier, drag on the
    // full map, then reopen the dossier on the same throw.
    heroReposBtn.onclick = () => {
      const throwIdx = selectedThrowIdx;
      detailPanel.classList.remove("open"); // hide dossier but keep selection
      startReposition({
        typeId: lineup.type,
        landing: lineup.landing,
        throwPos: lineup.throws[throwIdx].pos,
        onDone: async (result) => {
          if (result) {
            lineup.throws[throwIdx].pos = result.throwPos;
            upsertLocalLineup(lineup);
            refreshLocal();       // reflect the new spot on the map immediately
            openDetail(lineup.id, throwIdx);
            try {
              await dbPut(lineup, lineup.isOfficial); // persist in the background
            } catch (err) {
              toastError("Could not save the new position: " + (err && err.message ? err.message : err));
            }
          } else {
            openDetail(lineup.id, throwIdx);
          }
        },
      });
    };
    // Removing the last variant removes the whole lineup, and says so.
    const last = lineup.throws.length <= 1;
    heroRemoveBtn.textContent = last ? "Delete lineup" : "Remove variant";
    heroRemoveBtn.setAttribute("aria-label", last ? "Delete this lineup" : `Remove variant ${pad2(selectedThrowIdx + 1)}`);
    heroRemoveBtn.onclick = () => {
      if (lineup.throws.length <= 1) { deleteLineupDeferred(lineup); return; }
      removeThrowDeferred(lineup, active, selectedThrowIdx, {
        message: "Variant removed",
        request: { method: "POST", url: API_URL, body: () => ({ ...lineup, isOfficial: !!lineup.isOfficial }) },
      });
    };
    // The first variant is the one the dossier opens on. Dragging the strip
    // reorders; this is the same thing for keyboard and one-handed use.
    if (selectedThrowIdx > 0) {
      heroDefaultBtn.onclick = () => {
        const order = lineup.throws.map((_, i) => i).filter(i => i !== selectedThrowIdx);
        saveThrowOrder(lineup, [selectedThrowIdx, ...order], { focusThumb: true });
      };
    } else {
      heroDefaultBtn.remove();
    }
  } else {
    heroEditBtn.remove();
    heroRemoveBtn.remove();
    heroReposBtn.remove();
    heroDefaultBtn.remove();
  }

  // Bookmarking works per throw position, not per whole lineup: in the
  // official view, any signed-in user can save just this variant; in the
  // personal view, a bookmarked (non-owned) variant can be removed the
  // same way, one at a time.
  if (canBookmark) {
    const saved = state.savedThrowKeys.has(throwKey(lineup.id, active.id));
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
        toastError((err && err.message) || "Something went wrong.");
      } finally {
        heroSaveBtn.disabled = false;
      }
    };
  } else if (isBookmarkedRef) {
    heroSaveBtn.textContent = "✕ Remove from my map";
    heroSaveBtn.classList.remove("saved");
    heroSaveBtn.onclick = () => {
      const key = throwKey(lineup.id, active.id);
      removeThrowDeferred(lineup, active, selectedThrowIdx, {
        message: "Removed from your map",
        key: `saved:${key}`,
        onApply: () => state.savedThrowKeys.delete(key),
        onRestore: () => state.savedThrowKeys.add(key),
        request: { method: "DELETE", url: `${SAVED_URL}?lineupId=${encodeURIComponent(lineup.id)}&throwId=${encodeURIComponent(active.id)}` },
      });
    };
  } else {
    heroSaveBtn.remove();
  }
  const actions = hero.querySelector(".throw-card-actions");
  if (actions && !actions.children.length) actions.remove();

  throwList.appendChild(hero);

  // ── THUMBNAIL STRIP ──
  let activeThumb = null;
  if (multi) {
    const strip = document.createElement("div");
    strip.className = "detail-strip" + (editable ? " can-reorder" : "");
    strip.setAttribute("aria-label", "Variants");
    const reorder = editable ? attachStripReorder(strip, { onReorder: (order) => saveThrowOrder(lineup, order) }) : null;
    lineup.throws.forEach((t, i) => {
      const thumb = document.createElement("div");
      const isActive = i === selectedThrowIdx;
      thumb.className = "detail-strip-thumb" + (isActive ? " active" : "");
      thumb.dataset.idx = String(i);
      thumb.tabIndex = 0;
      thumb.setAttribute("role", "button");
      thumb.setAttribute("aria-label", `Variant ${pad2(i + 1)}${i === 0 ? " (default)" : ""}`);
      if (isActive) thumb.setAttribute("aria-current", "true");
      if (editable) thumb.title = "Drag to reorder";
      const preview = (t.screenshots && t.screenshots[0]) || (t.standing && t.standing[0]) || "";
      thumb.innerHTML = `
        ${preview ? `<span class="strip-thumb-frame img-frame"><img data-real-src="${escapeHtml(preview)}" alt="" draggable="false"></span>` : `<div class="strip-thumb-empty"></div>`}
        <span class="strip-thumb-label">V${pad2(i + 1)}${editable && i === 0 ? ` <span class="strip-thumb-default">Default</span>` : ""}</span>
      `;
      thumb.onclick = () => {
        if (reorder && reorder.justDragged) return;
        selectVariant(lineup, i, { dir: Math.sign(i - selectedThrowIdx) });
      };
      thumb.onkeydown = (e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        selectVariant(lineup, i, { dir: Math.sign(i - selectedThrowIdx), focusThumb: true });
      };
      if (isActive) activeThumb = thumb;
      strip.appendChild(thumb);
    });
    throwList.appendChild(strip);
    if (editable) {
      const hint = document.createElement("p");
      hint.className = "strip-hint";
      const touch = window.matchMedia("(hover: none)").matches;
      hint.textContent = `${touch ? "Long-press and drag" : "Drag"} to reorder · the first variant opens by default`;
      throwList.appendChild(hint);
    }
    loadFrameImages(strip);
  }

  if (opts.highlight) {
    hero.classList.add("flash");
    if (activeThumb) activeThumb.classList.add("flash");
    setTimeout(() => { hero.classList.remove("flash"); if (activeThumb) activeThumb.classList.remove("flash"); }, 1800);
  }
}

function buildPagerHtml(lineup) {
  const n = lineup.throws.length, i = selectedThrowIdx;
  return `
    <div class="variant-pager">
      <button type="button" class="pager-btn pager-prev" aria-label="Previous variant"${i === 0 ? " disabled" : ""}>‹</button>
      <div class="pager-dots" aria-hidden="true">${lineup.throws.map((_, j) => `<span class="pager-dot${j === i ? " active" : ""}"></span>`).join("")}</div>
      <span class="pager-count" aria-live="polite">${i + 1} / ${n}</span>
      <button type="button" class="pager-btn pager-next" aria-label="Next variant"${i === n - 1 ? " disabled" : ""}>›</button>
    </div>`;
}

// T / CT side: a segmented control for whoever can edit the lineup (the change
// is only saved when "Save" is pressed), a small read-only badge for everyone
// else (nothing shown for "any").
function renderSide(lineup, editable) {
  if (!detailSideSlot) return;
  const side = normalizeSide(lineup.side);
  if (!editable) {
    detailSideSlot.replaceChildren();
    if (side !== "any") {
      const b = document.createElement("span");
      b.className = "side-badge";
      b.textContent = sideLabel(side);
      detailSideSlot.append(b);
    }
    return;
  }
  let chosen = side;
  const save = Object.assign(document.createElement("button"), { type: "button", className: "primary-btn side-save", textContent: "Save", hidden: true });
  const seg = sideSegment(SIDES, side, (v) => { chosen = v; save.hidden = chosen === normalizeSide(lineup.side); }, { label: "Side" });
  save.onclick = async () => {
    setBusy(save, true, "Saving…");
    const prev = lineup.side;
    lineup.side = chosen;
    try {
      await dbPut(lineup, lineup.isOfficial);
      refreshLocal();
      toast(`Side set to ${sideLabel(chosen)}`);
      save.hidden = true;
    } catch (err) {
      lineup.side = prev;
      toastError("Couldn't save the side. Please try again.");
    }
    setBusy(save, false);
  };
  const wrap = document.createElement("div");
  wrap.className = "side-edit";
  wrap.append(seg, save);
  detailSideSlot.replaceChildren(wrap);
}

// Name field, plus the "Unnamed position" state: muted placeholder for
// everyone, and a small nudge for whoever can actually name it.
function renderName(lineup, editable) {
  detailNameInput.value = lineup.name || "";
  detailNameInput.disabled = !editable;
  const syncNudge = () => {
    const unnamed = !detailNameInput.value.trim();
    detailNameInput.classList.toggle("is-unnamed", unnamed);
    if (detailNameNudge) detailNameNudge.classList.toggle("hidden", !(editable && unnamed && !lineup.name));
  };
  syncNudge();
  detailNameInput.oninput = () => detailNameInput.classList.toggle("is-unnamed", !detailNameInput.value.trim());
  if (detailNameNudge) detailNameNudge.onclick = () => { detailNameInput.focus(); detailNameInput.select(); };
  detailNameInput.onchange = async () => {
    if (!editable) { detailNameInput.value = lineup.name || ""; return; }
    const prev = lineup.name || "";
    lineup.name = detailNameInput.value.trim();
    syncNudge();
    refreshLocal();
    try {
      await dbPut(lineup, lineup.isOfficial);
      toast(lineup.name ? "Name saved" : "Name cleared");
    } catch (err) {
      lineup.name = prev;
      if (detailNameInput.value.trim() === lineup.name || document.activeElement !== detailNameInput) detailNameInput.value = prev;
      syncNudge();
      refreshLocal();
      toastError("Couldn't save the name. Please try again.");
    }
  };
}

// Copy-link feedback: the 🔗 turns into ✓ for a moment, plus a toast. With
// several variants the link points at the one being viewed (&throw=n).
let copyResetTimer = null;
async function copyShareLink(lineup) {
  // A personal lineup is private until its owner opts in to link sharing.
  if (canModifyLineup(lineup) && !lineup.isOfficial && !lineup.linkShared) {
    const ok = await confirmDialog({
      title: "Share this lineup with a link?",
      body: "Anyone with the link can view this lineup, its notes and its screenshots. It isn't listed, searchable or shown on the map to others, and you can stop sharing any time.",
      confirmLabel: "Share and copy link",
    });
    if (!ok) return;
    try {
      await dbShareLineup(lineup.id, true);
      lineup.linkShared = true;
      renderLinkShareControls(lineup, true);
      shareLineupBtn.title = lineup.throws.length > 1 ? "Copy link to this variant" : "Copy shareable link";
      shareLineupBtn.setAttribute("aria-label", shareLineupBtn.title);
    } catch { toastError("Couldn't turn on sharing. Please try again."); return; }
  }
  const url = `${location.origin}${lineupPath(lineup, selectedThrowIdx)}`;
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    toast(`Copy this link: ${url}`, { duration: 10000 });
    return;
  }
  shareLineupBtn.textContent = "✓";
  shareLineupBtn.classList.add("copied");
  shareLineupBtn.setAttribute("aria-label", "Link copied");
  clearTimeout(copyResetTimer);
  copyResetTimer = setTimeout(() => {
    shareLineupBtn.textContent = "🔗";
    shareLineupBtn.classList.remove("copied");
    shareLineupBtn.setAttribute("aria-label", shareLineupBtn.title || "Copy shareable link");
  }, 1200);
  toast(lineup.throws.length > 1 ? `Link copied · variant ${pad2(selectedThrowIdx + 1)}` : "Link copied");
}

// Persist a new variant order (`order` = old indices in their new order).
// Optimistic: the dossier and map update at once; on failure the old order
// comes back with an error toast. Only the latest save may roll back, so a
// quick second drag isn't undone by the first one's failure.
let orderSaveSeq = 0;
async function saveThrowOrder(lineup, order, { focusThumb = false } = {}) {
  const prev = lineup.throws.slice();
  const viewingId = prev[selectedThrowIdx] && prev[selectedThrowIdx].id;
  const apply = (throws) => {
    lineup.throws = throws;
    upsertLocalLineup(lineup);
    refreshLocal();
    if (!isOpenOn(lineup.id)) return;
    const i = lineup.throws.findIndex(t => t.id === viewingId);
    selectedThrowIdx = i < 0 ? 0 : i;
    renderDetail(lineup);
    syncLineupUrl(lineup);
  };
  apply(order.map(i => prev[i]).filter(Boolean));
  if (focusThumb) focusActiveThumb();
  const seq = ++orderSaveSeq;
  try {
    await dbPut(lineup, lineup.isOfficial);
    if (seq === orderSaveSeq) toast("Order saved");
  } catch (err) {
    if (seq !== orderSaveSeq) return;
    apply(prev);
    toastError("Couldn't save the new order. Please try again.");
  }
}

// One short clip per throw position: muted, looped, inline, nothing fetched
// until it scrolls into view (wireClips). The poster is the throw's result
// (or first) screenshot.
function clipHtml(t) {
  const poster = t.result || (t.screenshots && t.screenshots[0]) || (t.standing && t.standing[0]) || "";
  return `
    <div class="tc-clip" data-clip="${escapeHtml(t.clip)}" data-poster="${escapeHtml(poster)}">
      <div class="tc-carousel-label">Clip</div>
      <div class="img-frame clip-frame">
        <video muted loop playsinline preload="none" aria-label="Clip of this throw"></video>
      </div>
      <div class="clip-controls">
        <button type="button" class="ghost-btn clip-play" aria-pressed="true">Pause</button>
        <button type="button" class="ghost-btn clip-speed" aria-pressed="false" title="Half speed, for timing jumpthrows">0.5×</button>
      </div>
    </div>`;
}

// Lazy-loads each clip when it becomes visible and plays it while it is on
// screen (unless the user paused it or prefers reduced motion).
export function wireClips(container) {
  const reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  container.querySelectorAll(".tc-clip").forEach(box => {
    const video = box.querySelector("video");
    const playBtn = box.querySelector(".clip-play");
    const speedBtn = box.querySelector(".clip-speed");
    let loaded = false, userPaused = reduced;
    const sync = () => { playBtn.textContent = video.paused ? "Play" : "Pause"; playBtn.setAttribute("aria-pressed", video.paused ? "false" : "true"); };
    const load = async () => {
      loaded = true;
      const [src, poster] = await Promise.all([resolveImageSrc(box.dataset.clip), box.dataset.poster ? resolveImageSrc(box.dataset.poster) : ""]);
      if (!src) { box.querySelector(".clip-frame").classList.add("clip-failed"); return; }
      if (poster) video.poster = poster;
      video.preload = "metadata";
      video.src = src;
      if (!userPaused) video.play().catch(() => {});
    };
    playBtn.onclick = () => {
      if (video.paused) { userPaused = false; video.play().catch(() => {}); } else { userPaused = true; video.pause(); }
    };
    speedBtn.onclick = () => {
      const slow = video.playbackRate !== 0.5;
      video.playbackRate = slow ? 0.5 : 1;
      speedBtn.setAttribute("aria-pressed", slow ? "true" : "false");
      speedBtn.classList.toggle("active", slow);
    };
    video.addEventListener("play", sync); video.addEventListener("pause", sync); sync();
    const io = new IntersectionObserver((entries) => {
      entries.forEach(en => {
        if (en.isIntersecting) { if (!loaded) load(); else if (!userPaused) video.play().catch(() => {}); }
        else if (loaded) video.pause();
      });
    }, { threshold: 0.25 });
    io.observe(box);
  });
}

export function buildHeroHtml(t, idx, lineup) {
  const standingImgs = (t.standing && t.standing.length) ? t.standing : [];
  const aimImgs = (t.screenshots && t.screenshots.length) ? t.screenshots : [];
  const hasImages = standingImgs.length || aimImgs.length || t.precise || t.result;

  // Every frame reserves the 16:9 box (.img-frame) so the skeleton and the
  // loaded image take the same space and nothing jumps.
  const makeCarousel = (imgs, label, cssClass) => {
    if (!imgs.length) return "";
    const multi = imgs.length > 1;
    return `
      <div class="tc-carousel" data-class="${cssClass}">
        <div class="tc-carousel-label">${label}</div>
        <div class="tc-carousel-inner img-frame"${multi ? " data-multi" : ""}>
          <img class="tc-carousel-img ${cssClass}" data-real-src="${escapeHtml(imgs[0])}" data-imgs='${escapeHtml(JSON.stringify(imgs))}' data-idx="0" alt="${label}" draggable="false">
          ${multi ? `<button class="tc-arrow tc-prev" type="button" aria-label="Previous photo">‹</button>
                     <button class="tc-arrow tc-next" type="button" aria-label="Next photo">›</button>
                     <div class="tc-dots">${imgs.map((_,i) => `<span class="tc-dot${i===0?" active":""}"></span>`).join("")}</div>` : ""}
        </div>
      </div>`;
  };

  const single = (url, label, alt) => url ? `
    <div class="tc-carousel">
      <div class="tc-carousel-label">${label}</div>
      <div class="tc-carousel-inner img-frame">
        <img class="tc-carousel-img" data-real-src="${escapeHtml(url)}" alt="${alt}" draggable="false">
      </div>
    </div>` : "";

  return `
    <div class="hero-header">
      <span class="variant-tag" tabindex="-1">VARIANT ${pad2(idx + 1)}</span>
      <div class="throw-meta">
        <span class="tag">${RANGE_LABELS[t.range] || escapeHtml(t.range)}</span>
        <span class="tag">${MOVEMENT_LABELS[t.movement] || escapeHtml(t.movement)}</span>
        <span class="variant-time"></span>
      </div>
      <div class="throw-card-actions">
        <button type="button" class="save-btn">☆ Save to my map</button>
        <button type="button" class="default-btn" title="Open this variant first">Make default</button>
        <button type="button" class="reposition-btn">⤢ Reposition</button>
        <button type="button" class="edit-btn">Edit</button>
        <button type="button" class="remove-btn">Remove variant</button>
      </div>
    </div>
    ${hasImages ? `<div class="tc-galleries hero-galleries">
      ${makeCarousel(standingImgs, "Stand here", "standing-gallery")}
      ${makeCarousel(aimImgs, "Aim here", "aim-gallery")}
      ${single(t.precise, "Precise", "Precise lineup")}
      ${single(t.result, "Result", "Result of lineup")}
    </div>` : ""}
    ${t.clip ? clipHtml(t) : ""}
    ${t.notes ? `<div class="throw-notes hero-notes">${escapeHtml(t.notes)}</div>` : ""}
  `;
}

// Each screenshot frame: skeleton while loading, click / Enter / single tap
// opens the lightbox, pinch or double-tap zooms inline (touch), and frames
// with several photos flip with the arrows or a horizontal swipe.
export function wireCarousels(container, t) {
  container.querySelectorAll(".tc-carousel").forEach(carousel => {
    const img = carousel.querySelector(".tc-carousel-img");
    const inner = carousel.querySelector(".tc-carousel-inner");
    if (!img || !inner) return;
    // Keyboard access to the lightbox (and a focus target to return to).
    img.tabIndex = 0;
    img.setAttribute("role", "button");
    img.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); img.click(); } };
    const imgs = img.dataset.imgs ? JSON.parse(img.dataset.imgs) : [img.dataset.realSrc];
    const dots = carousel.querySelectorAll(".tc-dot");
    let cur = 0;
    const openLb = () => openLightbox(imgs, cur, img.alt);
    const go = (n) => {
      cur = (n + imgs.length) % imgs.length;
      if (inner._inlineZoom) inner._inlineZoom.reset();
      loadFrameImage(img, imgs[cur]);
      img.dataset.idx = cur;
      dots.forEach((d, i) => d.classList.toggle("active", i === cur));
    };
    const prev = carousel.querySelector(".tc-prev");
    const next = carousel.querySelector(".tc-next");
    if (prev) prev.onclick = (e) => { e.stopPropagation(); go(cur - 1); };
    if (next) next.onclick = (e) => { e.stopPropagation(); go(cur + 1); };
    img.onclick = openLb;
    attachInlineZoom(inner, img, { onTap: openLb, onSwipe: imgs.length > 1 ? (d) => go(cur + d) : null });
    loadFrameImage(img, imgs[0]);
  });
}

// Horizontal swipes in the hero step between variants, except where the
// touch began on something that owns horizontal swipes itself: a frame with
// several photos (it flips photos), a zoomed frame (it pans), form fields.
attachVariantSwipe(throwList, {
  onSwipe: (dir) => stepVariant(dir),
  ignore: (target) => !target.closest(".detail-hero") ||
    !!target.closest(".tc-carousel-inner[data-multi], .tc-carousel-inner.zoomed, input, textarea"),
});

if (sheet && sheetHandle) attachSheetDrag(sheetHandle, sheet, { onClose: () => closeDetailPanel() });

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

// Same picker as "Add lineup", without the name / side fields. The change
// shows at once and rolls back if the save fails.
export function openTypeModalForEdit(lineup) {
  openTypeModal(async (typeId) => {
    closeModal(typeModal);
    if (typeId === lineup.type) return;
    const prev = lineup.type;
    lineup.type = typeId;
    refreshLocal();
    if (isOpenOn(lineup.id)) renderDetail(lineup);
    try {
      await dbPut(lineup, lineup.isOfficial);
      toast(`Type changed to ${TYPES.find(t => t.id === typeId)?.label || typeId}`);
    } catch (err) {
      lineup.type = prev;
      refreshLocal();
      if (isOpenOn(lineup.id)) renderDetail(lineup);
      toastError("Couldn't change the type. Please try again.");
    }
  }, { editType: lineup.type });
}

export function closeDetailPanel() {
  const hs = history.state;
  hideDetailPanel();
  if (!(hs && hs.lineup)) return;
  // Pop the entry we pushed (so Back afterwards goes where it should, never
  // back into this dossier); an entry we didn't push is just rewritten.
  if (hs.dossier) history.back();
  else history.replaceState({ view: "map", map: state.mapId }, "", `/?map=${state.mapId}`);
}

closeDetail.onclick = closeDetailPanel;
// While closed, the dossier is only faded out; keep its controls out of the
// tab order and the accessibility tree. Registered before watchDialog so the
// panel is no longer inert when that moves focus into it.
const syncDossierInert = () => { detailPanel.inert = !detailPanel.classList.contains("open"); };
new MutationObserver(syncDossierInert).observe(detailPanel, { attributes: true, attributeFilter: ["class"] });
syncDossierInert();
watchDialog(detailPanel, "open", () => closeDetail, () => {
  if (!lastDossierLineupId) return null;
  return [...markerLayer.querySelectorAll(".marker.landing[data-lids]")]
    .find(el => el.dataset.lids.split(",").includes(lastDossierLineupId)) || null;
});

detailPanel.addEventListener("click", (e) => {
  if (e.target === detailPanel) closeDetailPanel();
});

addThrowBtn.onclick = () => {
  const lineup = state.lineups.find(l => l.id === state.selectedLineupId);
  if (!requireLineupEditable(lineup)) return;
  state.pendingThrowFor = state.selectedLineupId;
  setAddMode(true);
  showAddFlow(null, null, "Click on the map where you throw from.");
  detailPanel.classList.remove("open");
};

// "Submit to public map": the owner's explicit opt-in before an admin may
// publish a personal lineup (and its screenshots) on the official map. The
// confirm text is the licence grant described in terms.html "Your content".
const SUBMIT_CONSENT = "Submit this lineup to the public map?\n\n" +
  "If an admin accepts it, the lineup, its notes and screenshots are published on Lineupr for everyone, " +
  "without your name, and stay up even if you later delete your account (email support@nastipe.dev to have it removed).\n\n" +
  "Only submit screenshots and notes you made yourself. You can withdraw the submission any time before it is published.";

function renderSubmitControls(lineup, editable) {
  if (!submitLineupBtn) return;
  const show = editable && !lineup.isOfficial;
  submitLineupBtn.classList.toggle("hidden", !show);
  submitLineupNote.classList.toggle("hidden", !show || !lineup.submittedAt);
  if (!show) return;
  const submitted = !!lineup.submittedAt;
  submitLineupBtn.textContent = submitted ? "Withdraw suggestion" : "★ Suggest for the official map";
  submitLineupNote.classList.toggle("hidden", !submitted && !lineup.deniedAt);
  submitLineupNote.textContent = submitted
    ? "Suggested. An admin will review it and may add it to the official map."
    : lineup.deniedAt ? "An admin didn't accept this suggestion. You can improve it and suggest it again." : "";
  submitLineupBtn.onclick = async () => {
    if (!submitted) {
      // First paragraph is the question, the rest is the consent text.
      const [title, ...rest] = SUBMIT_CONSENT.split("\n\n");
      const ok = await confirmDialog({ title, body: rest.join("\n\n"), confirmLabel: "Submit" });
      if (!ok) return;
    }
    submitLineupBtn.disabled = true;
    try {
      const { submittedAt } = await dbSubmitLineup(lineup.id, !submitted);
      lineup.submittedAt = submittedAt;
      if (submittedAt) lineup.deniedAt = null;
      detailOwnerBadge.textContent = submittedAt ? "Suggested · awaiting review" : "My lineup · not approved";
      renderSubmitControls(lineup, editable);
      toast(submittedAt ? "Suggested for the official map" : "Suggestion withdrawn");
    } catch (e) {
      toastError("Couldn't update the submission. Please try again.");
    } finally {
      submitLineupBtn.disabled = false;
    }
  };
}

// Owner of a link-shared personal lineup: a way to switch sharing off again.
function renderLinkShareControls(lineup, editable) {
  const btn = document.getElementById("linkShareOffBtn");
  if (!btn) return;
  const show = editable && !lineup.isOfficial && !!lineup.linkShared;
  btn.classList.toggle("hidden", !show);
  if (!show) return;
  btn.onclick = async () => {
    btn.disabled = true;
    try {
      await dbShareLineup(lineup.id, false);
      lineup.linkShared = false;
      renderLinkShareControls(lineup, editable);
      if (shareLineupBtn) { shareLineupBtn.title = "Share with a link"; shareLineupBtn.setAttribute("aria-label", "Share with a link"); }
      toast("Link sharing is off. The old link no longer works");
    } catch { toastError("Couldn't turn off sharing. Please try again."); }
    finally { btn.disabled = false; }
  };
}

deleteLineupBtn.onclick = () => {
  if (!state.selectedLineupId) return;
  const lineup = state.lineups.find(l => l.id === state.selectedLineupId);
  if (!lineup) return;
  if (!requireLineupEditable(lineup)) return;
  deleteLineupDeferred(lineup);
};

// Undo-able whole-lineup delete (see js/undo-delete.js): gone from the map at
// once, "Deleted · Undo" for a few seconds, then the real DELETE goes out.
// Restore only puts it back if the user is still looking at the same map and
// view — otherwise the next load shows the truth anyway.
export function deleteLineupDeferred(lineup) {
  const ctx = { mapId: state.mapId, viewMode: state.viewMode };
  let idx = -1;
  const label = lineup.name ? `“${lineup.name}”` : "Lineup";
  deferDelete({
    key: `lineup:${lineup.id}`,
    message: `${label} deleted`,
    apply: () => {
      idx = state.lineups.indexOf(lineup);
      state.lineups = state.lineups.filter(l => l.id !== lineup.id);
      if (state.selectedLineupId === lineup.id) closeDetailPanel();
      refreshLocal();
    },
    restore: () => {
      if (state.mapId !== ctx.mapId || state.viewMode !== ctx.viewMode) return;
      if (state.lineups.some(l => l.id === lineup.id)) return;
      state.lineups.splice(idx < 0 ? state.lineups.length : Math.min(idx, state.lineups.length), 0, lineup);
      refreshLocal();
    },
    request: { method: "DELETE", url: `${API_URL}?id=${encodeURIComponent(lineup.id)}` },
  });
}

// Undo-able removal of one variant (throw position) from a lineup. The
// request is whatever persists the removal: re-saving the lineup for an owned
// one, or deleting the bookmark for a saved official one.
function removeThrowDeferred(lineup, t, throwIdx, { message, request, key, onApply, onRestore }) {
  const ctx = { mapId: state.mapId, viewMode: state.viewMode };
  deferDelete({
    key: key || `lineup:${lineup.id}`,
    message,
    apply: () => {
      lineup.throws = lineup.throws.filter(x => x.id !== t.id);
      if (onApply) onApply();
      if (lineup.throws.length === 0) {
        // A bookmarked lineup with no saved variants left disappears from My Map.
        state.lineups = state.lineups.filter(l => l.id !== lineup.id);
        if (state.selectedLineupId === lineup.id) closeDetailPanel();
      } else {
        upsertLocalLineup(lineup);
        if (state.selectedLineupId === lineup.id && detailPanel.classList.contains("open")) openDetail(lineup.id, Math.max(0, throwIdx - 1));
      }
      refreshLocal();
    },
    restore: () => {
      if (onRestore) onRestore();
      if (!lineup.throws.some(x => x.id === t.id)) lineup.throws.splice(Math.min(throwIdx, lineup.throws.length), 0, t);
      if (state.mapId !== ctx.mapId || state.viewMode !== ctx.viewMode) return;
      if (!state.lineups.some(l => l.id === lineup.id)) state.lineups.push(lineup);
      refreshLocal();
      if (state.selectedLineupId === lineup.id && detailPanel.classList.contains("open")) openDetail(lineup.id, throwIdx);
    },
    request,
  });
}

