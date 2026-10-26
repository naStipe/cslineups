// Collections: named, ordered sets of lineups on one map (a strategy to plan,
// practise and share). This module owns
//   - the sidebar "Collections" section (your collections for the map),
//   - the "Add to collection" popover (dossier button + multi-select bar),
//   - multi-select on the map (Shift-click, or the Select mode),
//   - collection view mode: the map shows only the collection's lineups with
//     numbered markers and throw lines, plus an ordered panel with a
//     step-through (buttons, and ← / → through the shortcut registry),
//   - editing (rename, reorder, role / timing / note, remove, duplicate,
//     delete with undo), sharing (visibility + link) and reporting.
//
// Server rules live in api/collections.js; sharing only exposes official
// lineups to viewers, so a shared collection shows the owner's personal
// lineups as "locked" placeholders.
import {
  addItems, createCollection, deleteCollection, forkCollection, getById, getBySlug, listMine,
  removeItem, reorderItems, reportCollection, shareUrl, updateCollection, updateItem,
} from "./collections-api.js";
import { dbGetAll, dbGetMine, dbSaveLineup, throwKey } from "./api.js";
import { authUser } from "./auth.js";
import { openAuthModal } from "./auth-modal.js";
import { MAPS, TYPES } from "./constants.js";
import {
  addToCollBtn, collList, collNewBtn, detailPanel, collPanel, collPopover, collRail, collSelectBar, collSelectBtn,
  linkSvg, markerLayer, appShell,
} from "./dom.js";
import { escapeHtml } from "./html-utils.js";
import { closeDetailPanel, openDetail, selectedThrowIdx } from "./detail-panel.js";
import { focusLineup } from "./lineup-list.js";
import { loadLineups, refreshLocal } from "./map-data.js";
import { hooks } from "./marker-hooks.js";
import { closeModal, watchDialog } from "./modal-utils.js";
import { resetZoom, revealPercentPoints, zoom as mapZoom } from "./pan-zoom.js";
import { registerLayer, registerShortcut } from "./shortcuts.js";
import { buildFilters } from "./sidebar.js";
import { state } from "./state.js";
import { toast, toastError } from "./toast.js";
import { deferDelete } from "./undo-delete.js";
import { emptyState, setBusy } from "./ui-utils.js";
import { switchMap } from "./home-screen.js";

const $ = (id) => document.getElementById(id);
const typeInfo = (id) => TYPES.find(t => t.id === id) || { label: id || "Lineup", color: "var(--signal)" };
const mapName = (id) => (MAPS.find(m => m.id === id) || { name: id }).name;
const VIS = {
  private:  { label: "Private",  note: "Only you can open it." },
  unlisted: { label: "Unlisted", note: "Anyone with the link can open it. It isn't listed or indexed." },
  public:   { label: "Public",   note: "Anyone can open it, and it may appear in search engines." },
};

// ---------------------------------------------------------------- state ---
let mine = [];            // summaries of the signed-in user's collections on this map
let mineLoaded = false;
let view = null;          // { data, step, saved } while a collection is open (mirrors state.collectionView)
let selectMode = false;
const selection = new Set(); // lineup ids picked on the map

const keyOf = (lineupId, throwId) => `${lineupId}|${throwId || ""}`;
const isOwner = () => !!(view && view.data.isOwner);
const okItems = () => (view ? view.data.items.filter(i => i.status === "ok") : []);

// -------------------------------------------------------- my collections ---
export async function refreshCollections() {
  if (!authUser) { mine = []; mineLoaded = true; renderRail(); return; }
  try {
    mine = await listMine(state.mapId);
  } catch (e) { console.warn("collections:", e); mine = []; }
  mineLoaded = true;
  renderRail();
}

function renderRail() {
  if (!collList) return;
  collList.replaceChildren();
  if (!authUser) {
    collList.append(emptyState({
      title: "Plan a strategy", body: "Group lineups into an execute and share it with your team.", compact: true,
      action: { label: "Sign in", onClick: () => openAuthModal("signin") },
    }));
    return;
  }
  if (!mineLoaded) {
    for (let i = 0; i < 2; i++) { const s = document.createElement("div"); s.className = "skeleton coll-skel"; collList.append(s); }
    return;
  }
  if (!mine.length) {
    collList.append(emptyState({
      title: "No collections yet", body: "Group lineups into a strategy: an execute, a default, a retake.", compact: true,
      action: { label: "New collection", onClick: () => openEditModal() },
    }));
    return;
  }
  mine.forEach(c => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "coll-row" + (view && view.data.id === c.id ? " active" : "");
    b.innerHTML = `<span class="coll-row-name"></span><span class="coll-row-meta"></span>`;
    b.querySelector(".coll-row-name").textContent = c.name;
    b.querySelector(".coll-row-meta").textContent = `${c.itemCount} · ${VIS[c.visibility].label}`;
    b.onclick = () => openCollection({ id: c.id });
    collList.append(b);
  });
}

// Called when the map changes: leave any open collection and reload the list.
export function resetCollections() {
  if (view) leaveViewState();
  selection.clear();
  setSelectMode(false);
  closePopover();
  mine = []; mineLoaded = false;
  renderRail();
}

// ------------------------------------------------------- create / rename ---
const editModal = $("collEditModal");
let editTarget = null; // null = create, else collection id being renamed
let editPreset = null; // items to put into a new collection

function openEditModal({ collection = null, items = null } = {}) {
  if (!authUser) { openAuthModal("signin"); return; }
  editTarget = collection ? collection.id : null;
  editPreset = items;
  $("collEditTitle").textContent = collection ? "Edit collection" : "New collection";
  $("collEditSave").textContent = collection ? "Save" : "Create";
  $("collNameInput").value = collection ? collection.name : "";
  $("collDescInput").value = collection ? collection.description || "" : "";
  editModal.classList.add("show");
}

async function saveEditModal() {
  const name = $("collNameInput").value.trim();
  if (!name) { $("collNameInput").focus(); toast("Give it a name first"); return; }
  const description = $("collDescInput").value.trim();
  const btn = $("collEditSave");
  setBusy(btn, true, "Saving…");
  try {
    if (editTarget) {
      const updated = await updateCollection(editTarget, { name, description });
      const row = mine.find(c => c.id === editTarget);
      if (row) Object.assign(row, { name: updated.name, description: updated.description });
      if (view && view.data.id === editTarget) { Object.assign(view.data, { name: updated.name, description: updated.description }); renderPanel(); }
      toast("Collection saved");
    } else {
      const created = await createCollection(state.mapId, name, description, editPreset || undefined);
      mine.unshift(created);
      toast(`Created “${created.name}”`, { action: { label: "Open", onClick: () => openCollection({ id: created.id }) } });
      selection.clear(); setSelectMode(false); syncSelectionUi();
    }
    closeModal(editModal);
    renderRail();
  } catch (e) { toastError(e.message); }
  setBusy(btn, false);
}

// ------------------------------------------------------- add-to popover ---
// Tick the collections a lineup (or the selected lineups) should be in, then
// press Save. Nothing changes until Save; unticking a collection that holds
// it takes it out. "New collection" creates one with the lineups straight away.
let popAnchor = null;
let popCtx = null; // { lineupIds, throwId, throws, variantOnly, pending: Map(collectionId -> wanted) }

function popoverOpen() { return !collPopover.hidden; }
function closePopover() { collPopover.hidden = true; popAnchor = null; popCtx = null; }

const popThrow = () => (popCtx.lineupIds.length === 1 && popCtx.variantOnly ? popCtx.throwId : null);
const heldCount = (c) => popCtx.lineupIds.filter(id => c.members.includes(keyOf(id, popThrow()))).length;
// "all" | "some" | "none", as it would be after the pending changes.
function popState(c) {
  if (popCtx.pending.has(c.id)) return popCtx.pending.get(c.id) ? "all" : "none";
  const h = heldCount(c);
  return h === 0 ? "none" : h === popCtx.lineupIds.length ? "all" : "some";
}

// ctx: { lineupIds: [...], throwId?: string|null, throws?: n } — throwId is
// the variant being viewed (single-lineup adds only).
async function openPopover(anchor, ctx) {
  if (!authUser) { openAuthModal("signin"); return; }
  if (popoverOpen() && popAnchor === anchor) { closePopover(); return; }
  popAnchor = anchor; popCtx = { ...ctx, variantOnly: false, pending: new Map() };
  if (!mineLoaded) await refreshCollections();
  renderPopover();
  collPopover.hidden = false;
  const r = anchor.getBoundingClientRect();
  const w = 300;
  const left = Math.min(Math.max(8, r.right - w), window.innerWidth - w - 8);
  const top = Math.min(r.bottom + 6, window.innerHeight - collPopover.offsetHeight - 8);
  collPopover.style.left = left + "px";
  collPopover.style.top = Math.max(8, top) + "px";
  const first = collPopover.querySelector(".coll-check, input[type=text]");
  if (first) first.focus({ preventScroll: true });
}

// Re-renders can make the popover taller; keep its bottom on screen.
function clampPopover() {
  if (collPopover.hidden) return;
  const top = Math.min(parseFloat(collPopover.style.top) || 8, window.innerHeight - collPopover.offsetHeight - 8);
  collPopover.style.top = Math.max(8, top) + "px";
}

function renderPopover() {
  const { lineupIds, throwId, throws } = popCtx;
  const single = lineupIds.length === 1;
  collPopover.replaceChildren();

  const head = document.createElement("div");
  head.className = "coll-pop-head";
  head.textContent = single ? "Add to collection" : `Add ${lineupIds.length} lineups to…`;
  collPopover.append(head);

  if (single && throws > 1 && throwId) {
    const seg = document.createElement("div");
    seg.className = "side-seg";
    seg.setAttribute("role", "radiogroup");
    [["whole", "Whole lineup"], ["variant", "This variant"]].forEach(([id, label]) => {
      const b = document.createElement("button");
      b.type = "button";
      const on = (id === "variant") === popCtx.variantOnly;
      b.className = "side-seg-btn" + (on ? " active" : "");
      b.setAttribute("role", "radio"); b.setAttribute("aria-checked", on ? "true" : "false");
      b.textContent = label;
      b.onclick = () => { popCtx.variantOnly = id === "variant"; popCtx.pending.clear(); renderPopover(); };
      seg.append(b);
    });
    collPopover.append(seg);
  }

  const list = document.createElement("div");
  list.className = "coll-pop-list";
  if (!mine.length) {
    const p = document.createElement("p");
    p.className = "coll-pop-empty";
    p.textContent = "You have no collections on this map yet. Create the first one below.";
    list.append(p);
  }
  mine.forEach(c => {
    const st = popState(c);
    const row = document.createElement("button");
    row.type = "button";
    row.className = "coll-pop-row" + (popCtx.pending.has(c.id) ? " changed" : "");
    row.setAttribute("role", "checkbox");
    row.setAttribute("aria-checked", st === "all" ? "true" : st === "some" ? "mixed" : "false");
    row.innerHTML = `<span class="coll-check ${st}" aria-hidden="true"></span><span class="coll-pop-name"></span><small></small>`;
    row.querySelector(".coll-pop-name").textContent = c.name;
    row.querySelector("small").textContent = String(c.itemCount);
    row.onclick = () => {
      popCtx.pending.set(c.id, st !== "all");
      // Back to what it already was: not a change.
      const h = heldCount(c);
      const wasAll = h === popCtx.lineupIds.length;
      if (popCtx.pending.get(c.id) === wasAll && (wasAll || h === 0)) popCtx.pending.delete(c.id);
      renderPopover();
    };
    list.append(row);
  });
  collPopover.append(list);

  const save = document.createElement("button");
  save.type = "button";
  save.className = "primary-btn coll-pop-save";
  save.textContent = "Save";
  save.disabled = popCtx.pending.size === 0;
  save.onclick = savePopover;
  const cancel = Object.assign(document.createElement("button"), { type: "button", className: "ghost-btn", textContent: "Cancel" });
  cancel.onclick = closePopover;
  const actions = document.createElement("div");
  actions.className = "coll-pop-actions";
  actions.append(cancel, save);
  collPopover.append(actions);

  const foot = document.createElement("form");
  foot.className = "coll-pop-new";
  foot.innerHTML = `<input type="text" class="coll-input" maxlength="80" placeholder="New collection name" aria-label="New collection name" autocomplete="off"><button type="submit" class="ghost-btn">Create</button>`;
  foot.onsubmit = async (e) => {
    e.preventDefault();
    const input = foot.querySelector("input");
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    const btn = foot.querySelector("button");
    setBusy(btn, true, "…");
    try {
      const created = await createCollection(state.mapId, name, "", lineupIds.map(id => ({ lineupId: id, throwId: popThrow() || undefined })));
      mine.unshift(created);
      renderRail();
      closePopover();
      toast(`Added to “${created.name}”`, { action: { label: "Open", onClick: () => openCollection({ id: created.id }) } });
    } catch (err) { toastError(err.message); setBusy(btn, false); }
  };
  collPopover.append(foot);
  clampPopover();
}

async function savePopover() {
  const ctx = popCtx;
  if (!ctx || !ctx.pending.size) return;
  const btn = collPopover.querySelector(".coll-pop-save");
  setBusy(btn, true, "Saving…");
  const throwId = popThrow();
  const keys = ctx.lineupIds.map(id => keyOf(id, throwId));
  const jobs = [...ctx.pending].map(async ([cid, want]) => {
    const c = mine.find(x => x.id === cid);
    if (!c) return;
    const held = keys.filter(k => c.members.includes(k)).length;
    if (want && held < keys.length) {
      await addItems(c.id, ctx.lineupIds.map(id => ({ lineupId: id, throwId: throwId || undefined })));
      keys.forEach(k => { if (!c.members.includes(k)) c.members.push(k); });
    } else if (!want && held > 0) {
      await Promise.all(ctx.lineupIds.map(id => removeItem(c.id, { lineupId: id, ...(throwId ? { throwId } : {}) })));
      c.members = c.members.filter(m => !keys.includes(m));
    }
    c.itemCount = c.members.length;
  });
  const results = await Promise.allSettled(jobs);
  const failed = results.filter(r => r.status === "rejected");
  renderRail();
  if (view && ctx.pending.has(view.data.id)) reloadOpenCollection();
  if (failed.length) {
    toastError(failed[0].reason && failed[0].reason.message ? failed[0].reason.message : "Some changes didn't save.");
    ctx.pending.clear();
    if (popoverOpen()) renderPopover();
    return;
  }
  closePopover();
  toast(`Saved to ${ctx.pending.size} collection${ctx.pending.size === 1 ? "" : "s"}`);
  if (selection.size) { selection.clear(); setSelectMode(false); }
}

if (addToCollBtn) {
  addToCollBtn.onclick = () => {
    const id = state.selectedLineupId;
    const lineup = state.lineups.find(l => l.id === id);
    if (!lineup) return;
    const t = lineup.throws[selectedThrowIdx];
    openPopover(addToCollBtn, { lineupIds: [id], throwId: t ? t.id : null, throws: lineup.throws.length });
  };
}
document.addEventListener("pointerdown", (e) => {
  if (popoverOpen() && !collPopover.contains(e.target) && e.target !== popAnchor && !(popAnchor && popAnchor.contains(e.target))) closePopover();
}, true);

// ---------------------------------------------------------- multi-select ---
// Select mode (or Shift-click) picks lineups on the map. A combined marker
// opens up so the lineups inside it can be picked one at a time. While adding
// lineups to an open collection ("picking") the same mechanism feeds that
// collection directly.
const picking = () => !!(view && view.picking);

function setSelectMode(on) {
  selectMode = on;
  document.body.classList.toggle("select-mode", on);
  if (collSelectBtn) { collSelectBtn.setAttribute("aria-pressed", on ? "true" : "false"); collSelectBtn.classList.toggle("active", on); }
  syncSelectionUi();
}

function syncSelectionUi() {
  const bar = collSelectBar;
  if (bar) {
    bar.hidden = !(selection.size || selectMode);
    $("collSelectCount").textContent = selection.size
      ? `${selection.size} selected`
      : picking() ? `Click lineups on the map to add them to “${view.data.name}”` : "Tap lineups on the map to select them";
    $("collSelectAdd").disabled = !selection.size;
    $("collSelectAdd").textContent = picking() ? (selection.size ? `Add ${selection.size} to collection` : "Add to collection") : "Add to collection";
    $("collSelectClear").textContent = picking() ? "Done" : "Clear";
  }
  markerLayer.querySelectorAll(".marker.landing[data-lids]").forEach(el => {
    const ids = el.dataset.lids.split(",");
    el.classList.toggle("multi-sel", ids.length > 0 && ids.every(id => selection.has(id)));
  });
  markerLayer.querySelectorAll(".fan-petal[data-lid]").forEach(el => {
    el.classList.toggle("multi-sel", selection.has(el.dataset.lid));
  });
}

function endSelecting() {
  selection.clear();
  setSelectMode(false);
  if (picking()) finishPicking();
}

if (collSelectBtn) collSelectBtn.onclick = () => {
  if (!authUser) { openAuthModal("signin"); return; }
  if (selectMode) endSelecting(); else setSelectMode(true);
};
$("collSelectClear").onclick = endSelecting;
$("collSelectAdd").onclick = (e) => (picking() ? commitPicking() : openPopover(e.currentTarget, { lineupIds: [...selection] }));

// Marker clicks: Shift-click (or Select mode, or picking) toggles instead of opening.
hooks.intercept = (e, lineups) => {
  if (view && !picking()) return false;
  if (!(e.shiftKey || selectMode || picking())) return false;
  if (!authUser) { openAuthModal("signin"); return true; }
  // A combined marker is not toggled as a whole: let it open so each lineup
  // inside can be chosen on its own.
  if (lineups.length > 1) return false;
  const id = lineups[0].id;
  if (selection.has(id)) selection.delete(id); else selection.add(id);
  syncSelectionUi();
  return true;
};

// --------------------------------------------------- collection view mode ---
const stepOf = (lineupId) => {
  const nums = [];
  view && view.data.items.forEach((it, i) => { if (it.status === "ok" && it.lineupId === lineupId) nums.push(i + 1); });
  return nums;
};

// Numbered badges on landing markers while a collection is open.
hooks.badge = (el, cluster) => {
  // Also called for markers kept across renders, so start from a clean slate.
  el.querySelectorAll(".marker-badge.step").forEach(n => n.remove());
  el.classList.remove("has-step", "coll-current");
  if (!view) return;
  const nums = cluster.lineups.flatMap(l => stepOf(l.id)).sort((a, b) => a - b);
  if (!nums.length) return;
  el.classList.add("has-step");
  const b = document.createElement("span");
  b.className = "marker-badge step";
  b.textContent = nums.join("·");
  el.appendChild(b);
  if (cluster.lineups.some(l => view.data.items[view.step] && view.data.items[view.step].lineupId === l.id)) el.classList.add("coll-current");
};

// Runs after every marker render: throw lines for the collection's chosen
// variants, and the multi-select highlight.
hooks.afterRender = () => {
  document.querySelectorAll("[data-coll]").forEach(n => n.remove());
  if (view) {
    view.data.items.forEach((it, i) => {
      if (it.status !== "ok") return;
      const th = it.lineup.throws.find(t => t.id === it.throwId) || it.lineup.throws[0];
      if (!th) return;
      const current = i === view.step;
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.dataset.coll = "1";
      line.setAttribute("x1", th.pos.x + "%"); line.setAttribute("y1", th.pos.y + "%");
      line.setAttribute("x2", it.lineup.landing.x + "%"); line.setAttribute("y2", it.lineup.landing.y + "%");
      line.setAttribute("class", "coll-line" + (current ? " current" : ""));
      line.style.color = typeInfo(it.lineup.type).color;
      linkSvg.appendChild(line);
      const dot = document.createElement("div");
      dot.dataset.coll = "1";
      dot.className = "coll-throw-dot" + (current ? " current" : "");
      dot.style.left = th.pos.x + "%"; dot.style.top = th.pos.y + "%";
      dot.textContent = String(i + 1);
      dot.title = `Step ${i + 1}: ${it.lineup.name || "Unnamed position"}`;
      dot.onclick = (e) => { e.stopPropagation(); goStep(i); };
      markerLayer.appendChild(dot);
    });
  }
  syncSelectionUi();
};

async function openCollection(ref, { fromUrl = false } = {}) {
  if (selectMode) { selection.clear(); setSelectMode(false); }
  closePopover();
  collPanel.hidden = false;
  collPanel.innerHTML = `<div class="coll-panel-skel"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>`;
  let data;
  try {
    data = ref.slug ? await getBySlug(ref.slug) : await getById(ref.id);
  } catch (e) {
    collPanel.hidden = true;
    if (e.status === 404) toastError("That collection doesn't exist, or it isn't shared with you.");
    else toastError(e.message);
    return;
  }
  if (data.mapId !== state.mapId) {
    await switchMap(data.mapId);
    if (fromUrl) { /* map already matches in the deep-link path */ }
  }
  const saved = view ? view.saved : {
    types: new Set(state.activeFilters), side: state.sideFilter, area: state.areaFilter,
  };
  view = { data, step: 0, saved };
  state.collectionView = { id: data.id };
  document.body.classList.add("in-collection");
  closeDetailPanel();
  applyViewLineups();
  renderPanel();
  renderRail();
  try { history.replaceState(history.state, "", `/?map=${data.mapId}&collection=${data.slug}`); } catch {}
}

// Only the collection's lineups are on the map; filters don't apply.
function applyViewLineups() {
  state.activeFilters = new Set(TYPES.map(t => t.id));
  state.sideFilter = "all"; state.areaFilter = null;
  state.selectedLineupId = null;
  const seen = new Set();
  state.lineups = okItems().map(i => i.lineup).filter(l => !seen.has(l.id) && seen.add(l.id));
  refreshLocal();
}

async function reloadOpenCollection() {
  if (!view) return;
  try {
    const fresh = await getById(view.data.id);
    view.data = fresh;
    view.step = Math.min(view.step, Math.max(0, fresh.items.length - 1));
    if (view.picking) refreshLocal(); // adding lineups: keep the whole map on screen
    else applyViewLineups();
    renderPanel();
  } catch (e) { console.warn(e); }
}

function leaveViewState() {
  document.body.classList.remove("in-collection");
  const bar = $("detailCollBar"); if (bar) { bar.hidden = true; bar.replaceChildren(); }
  collPanel.hidden = true;
  collPanel.replaceChildren();
  state.collectionView = null;
  view = null;
  if (autoZoomed) { autoZoomed = false; resetZoom(); }
}

export async function exitCollection() {
  if (!view) return;
  const { saved, data } = view;
  leaveViewState();
  state.activeFilters = saved.types; state.sideFilter = saved.side; state.areaFilter = saved.area;
  closeDetailPanel();
  try { history.replaceState(history.state, "", `/?map=${data.mapId}`); } catch {}
  renderRail();
  await loadLineups();
  buildFilters();
}

export async function openCollectionBySlug(slug) {
  await openCollection({ slug }, { fromUrl: true });
}

// Prev / Next / clicking a step focuses that lineup on the map (pins its marker
// and throw lines, flashes it) without opening it. If the lineup view is already
// open (stepping from inside it), it follows along instead.
function goStep(i, { open = false } = {}) {
  if (!view) return;
  const items = view.data.items;
  if (!items.length) return;
  // Skip over placeholders so Next/Prev always lands on a real lineup.
  const n = items.length;
  let idx = ((i % n) + n) % n;
  const dir = i >= view.step ? 1 : -1;
  for (let k = 0; k < n && items[idx].status !== "ok"; k++) idx = (((idx + dir) % n) + n) % n;
  if (items[idx].status !== "ok") return;
  view.step = idx;
  const it = items[idx];
  const tIdx = Math.max(0, it.lineup.throws.findIndex(t => t.id === it.throwId));
  if (open || detailPanel.classList.contains("open")) openDetail(it.lineupId, tIdx);
  else { state.openClusterKey = null; focusLineup(it.lineupId); revealStep(it, tIdx); }
  renderPanel();
}
let autoZoomed = false; // the map was zoomed by revealStep (not the user): undo it on exit
// Keep the focused step's landing marker and throw spot out from under the panel.
function revealStep(it, tIdx) {
  if (collPanel.hidden) return;
  const pts = [it.lineup.landing, it.lineup.throws[tIdx] && it.lineup.throws[tIdx].pos].filter(p => p && isFinite(p.x) && isFinite(p.y));
  const before = mapZoom;
  revealPercentPoints(pts, collPanel.getBoundingClientRect());
  if (before <= 1 && mapZoom > 1) autoZoomed = true;
}
const nextStep = () => goStep(view.step + 1);
const prevStep = () => goStep(view.step - 1);

// ---- Adding lineups to the open collection --------------------------------
// The collection view only shows the collection's own lineups, which is
// useless for filling an empty one. "Add lineups" brings the whole map back
// and turns on select mode; picked lineups go straight into this collection.
async function startPicking() {
  if (!view || !isOwner()) return;
  view.picking = true;
  closeDetailPanel(); closePopover();
  selection.clear();
  setSelectMode(true);
  try {
    const [official, own] = await Promise.all([dbGetAll(), authUser ? dbGetMine().catch(() => []) : []]);
    const seen = new Set();
    state.lineups = [...official, ...own].filter(l => !seen.has(l.id) && seen.add(l.id));
  } catch (e) {
    toastError("Couldn't load the lineups on this map.");
    view.picking = false; setSelectMode(false);
    return;
  }
  state.activeFilters = new Set(TYPES.map(t => t.id));
  state.selectedLineupId = null;
  renderPanel();
  refreshLocal();
  syncSelectionUi();
}

async function commitPicking() {
  const ids = [...selection];
  if (!view || !ids.length) return;
  const btn = $("collSelectAdd");
  setBusy(btn, true, "Adding…");
  try {
    const r = await addItems(view.data.id, ids.map(id => ({ lineupId: id })));
    toast(r.added ? `Added ${r.added} lineup${r.added === 1 ? "" : "s"}` : "Those are already in the collection");
    selection.clear();
    await reloadOpenCollection();
    refreshCollections();
  } catch (e) { toastError(e.message); }
  setBusy(btn, false);
  syncSelectionUi();
}

function finishPicking() {
  if (!view) return;
  view.picking = false;
  selection.clear();
  setSelectMode(false);
  applyViewLineups();
  renderPanel();
}

// "Save to my map" for a lineup in someone else's collection: bookmarks the
// variant it points at, or every variant if it covers the whole lineup.
async function saveItemToMap(it) {
  if (!authUser) { openAuthModal("signin"); return; }
  const ids = it.throwId ? [it.throwId] : it.lineup.throws.map(t => t.id);
  try {
    for (const tid of ids) {
      if (state.savedThrowKeys.has(throwKey(it.lineupId, tid))) continue;
      await dbSaveLineup(it.lineupId, tid);
      state.savedThrowKeys.add(throwKey(it.lineupId, tid));
    }
    toast("Saved to your map");
  } catch (e) { toastError((e && e.message) || "Couldn't save it."); }
}

// Step bar inside the dossier (which is a full-screen overlay while a
// lineup is open): position in the strategy, Prev / Next, and the role /
// timing / note the owner attached to this step.
function renderDossierBar() {
  const bar = $("detailCollBar");
  if (!bar) return;
  const it = view && view.data.items[view.step];
  if (!view || !it || it.status !== "ok") { bar.hidden = true; bar.replaceChildren(); return; }
  bar.hidden = false;
  bar.replaceChildren();
  // Row 1 (fixed height): title left, Prev / Next pinned right. Row 2: role /
  // timing chips and the note, clamped, with its space reserved whenever any
  // step in this collection has one, so the buttons never move between steps.
  const main = document.createElement("div");
  main.className = "detail-coll-main";
  const info = document.createElement("div");
  info.className = "detail-coll-info";
  const t = document.createElement("strong");
  const tName = Object.assign(document.createElement("span"), { className: "detail-coll-name", textContent: view.data.name });
  const tStep = Object.assign(document.createElement("span"), { className: "detail-coll-step", textContent: ` · Step ${view.step + 1} of ${view.data.items.length}` });
  t.append(tName, tStep);
  t.title = t.textContent;
  info.append(t);
  const nav = document.createElement("div");
  nav.className = "detail-coll-nav";
  const prev = Object.assign(document.createElement("button"), { type: "button", className: "ghost-btn", textContent: "‹ Prev" });
  const next = Object.assign(document.createElement("button"), { type: "button", className: "primary-btn", textContent: "Next ›" });
  prev.onclick = prevStep; next.onclick = nextStep;
  if (okItems().length < 2) { prev.disabled = true; next.disabled = true; }
  nav.append(prev, next);
  main.append(info, nav);
  bar.append(main);
  if (view.data.items.some(i => i.role || i.timing || i.note)) {
    const meta = document.createElement("div");
    meta.className = "detail-coll-meta";
    const chips = document.createElement("span");
    chips.className = "detail-coll-chips";
    if (it.role) chips.append(Object.assign(document.createElement("span"), { className: "coll-chip", textContent: it.role }));
    if (it.timing) chips.append(Object.assign(document.createElement("span"), { className: "coll-chip alt", textContent: it.timing }));
    meta.append(chips);
    if (it.note) meta.append(Object.assign(document.createElement("p"), { className: "coll-item-note", textContent: it.note, title: it.note }));
    bar.append(meta);
  }
}

// ----------------------------------------------------------------- panel ---
function renderPanel() {
  if (!view) return;
  renderDossierBar();
  const { data } = view;
  const owner = isOwner();
  const prevScroll = collPanel.querySelector(".coll-items")?.scrollTop || 0;
  collPanel.hidden = false;
  collPanel.replaceChildren();
  // Everything above the step list sits in a fixed block so Prev / Next keep
  // their place; only the list scrolls.
  const top = document.createElement("div");
  top.className = "coll-panel-top";
  collPanel.append(top);

  const head = document.createElement("div");
  head.className = "coll-panel-head";
  head.innerHTML = `
    <button type="button" class="ghost-btn coll-exit">← Exit</button>
    <div class="coll-title"><h3></h3><p class="coll-meta"></p></div>`;
  head.querySelector("h3").textContent = data.name;
  head.querySelector(".coll-meta").textContent =
    `${mapName(data.mapId)} · ${data.items.length} lineup${data.items.length === 1 ? "" : "s"}` +
    (owner ? ` · ${VIS[data.visibility].label}` : data.ownerName ? ` · by ${data.ownerName}` : "");
  head.querySelector(".coll-exit").onclick = exitCollection;
  top.append(head);

  if (data.description) {
    const p = document.createElement("p");
    p.className = "coll-desc";
    p.textContent = data.description;
    top.append(p);
  }

  // Actions
  const actions = document.createElement("div");
  actions.className = "coll-actions";
  const btn = (label, fn, cls = "ghost-btn") => {
    const b = document.createElement("button");
    b.type = "button"; b.className = cls; b.textContent = label; b.onclick = fn; actions.append(b); return b;
  };
  if (owner) {
    btn(view.picking ? "Adding lineups…" : "＋ Add lineups", startPicking, "primary-btn").disabled = !!view.picking;
    btn("Edit", () => openEditModal({ collection: data }));
    btn("Share", openShareModal);
    btn("Duplicate", duplicateCollection);
    btn("Delete", deleteOpenCollection);
  } else {
    btn("Save a copy", saveCopy, "primary-btn");
    if (authUser && data.visibility !== "private") btn("Report", () => $("collReportModal").classList.add("show"));
  }
  top.append(actions);

  // Step-through
  const okCount = okItems().length;
  if (okCount) {
    const step = document.createElement("div");
    step.className = "coll-step";
    step.innerHTML = `<button type="button" class="ghost-btn" aria-label="Previous step">‹ Prev</button><span class="coll-step-count" aria-live="polite"></span><button type="button" class="primary-btn" aria-label="Next step">Next ›</button>`;
    const [prev, , next] = step.children;
    step.querySelector(".coll-step-count").textContent = `Step ${view.step + 1} of ${data.items.length}`;
    prev.onclick = prevStep; next.onclick = nextStep;
    if (okCount === 1) { prev.disabled = true; next.disabled = true; }
    top.append(step);
  }

  // Items
  const list = document.createElement("ol");
  list.className = "coll-items";
  if (!data.items.length) {
    list.append(Object.assign(document.createElement("li"), { className: "coll-items-empty" }));
    list.firstChild.append(emptyState({
      title: "This collection is empty",
      body: owner ? "Add lineups from the map: press “Add lineups”, then click the lineups you want." : "The owner hasn't added any lineups yet.",
      compact: true,
      action: owner && !view.picking ? { label: "＋ Add lineups", onClick: startPicking } : undefined,
    }));
  }
  data.items.forEach((it, i) => list.append(renderItem(it, i, owner)));
  collPanel.append(list);
  // Keep the scroll position across re-renders, and the current step in view.
  list.scrollTop = prevScroll;
  const cur = list.querySelector(".coll-item.current");
  if (cur) {
    if (cur.offsetTop < list.scrollTop) list.scrollTop = cur.offsetTop;
    else if (cur.offsetTop + cur.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = cur.offsetTop + cur.offsetHeight - list.clientHeight;
  }

  if (!owner) {
    const note = document.createElement("p");
    note.className = "coll-foot-note";
    note.textContent = "Shared with you by the owner. Save a lineup to your map, or save the whole collection as a copy.";
    collPanel.append(note);
  }
}

function renderItem(it, i, owner) {
  const li = document.createElement("li");
  li.className = "coll-item" + (i === view.step ? " current" : "") + (it.status !== "ok" ? " " + it.status : "");
  li.dataset.id = it.id;
  const name = it.status === "ok" ? (it.lineup.name || "Unnamed position") : (it.snapshotName || "Lineup");
  const t = typeInfo(it.status === "ok" ? it.lineup.type : it.snapshotType);

  const row = document.createElement("div");
  row.className = "coll-item-row";
  const num = document.createElement("span");
  num.className = "coll-num"; num.textContent = String(i + 1);
  const main = document.createElement("button");
  main.type = "button"; main.className = "coll-item-main";
  main.disabled = it.status !== "ok";
  main.innerHTML = `<span class="lineup-item-dot" style="background:${t.color}"></span><span class="coll-item-name"></span>`;
  main.querySelector(".coll-item-name").textContent = name;
  main.onclick = () => goStep(i);
  row.append(num, main);

  const tools = document.createElement("span");
  tools.className = "coll-item-tools";
  const mk = (label, aria, fn, disabled) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "icon-btn"; b.textContent = label; b.setAttribute("aria-label", aria); b.title = aria; b.onclick = fn; b.disabled = !!disabled;
    return b;
  };
  if (it.status === "ok") tools.append(mk("↗", `Open ${name}`, () => goStep(i, { open: true })));
  // Someone else's lineup (official, or shared by its owner): bookmark it.
  if (it.status === "ok" && !(authUser && it.lineup.ownerId === authUser.id)) tools.append(mk("☆", `Save ${name} to my map`, () => saveItemToMap(it)));
  if (owner) {
    tools.append(
      mk("↑", `Move ${name} up`, () => moveItem(i, -1), i === 0),
      mk("↓", `Move ${name} down`, () => moveItem(i, 1), i === view.data.items.length - 1),
      mk("✕", `Remove ${name}`, () => removeItemUndoable(it)),
    );
  }
  row.append(tools);
  if (owner) {
    li.draggable = true;
    li.ondragstart = (e) => { li.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(i)); };
    li.ondragend = () => li.classList.remove("dragging");
    li.ondragover = (e) => { e.preventDefault(); li.classList.add("drop"); };
    li.ondragleave = () => li.classList.remove("drop");
    li.ondrop = (e) => {
      e.preventDefault(); li.classList.remove("drop");
      const from = Number(e.dataTransfer.getData("text/plain"));
      if (Number.isInteger(from) && from !== i) moveItemTo(from, i);
    };
  }
  li.append(row);

  if (it.status === "missing") {
    const m = document.createElement("p");
    m.className = "coll-item-note";
    m.textContent = "Lineup no longer available";
    li.append(m);
  } else if (it.status === "locked") {
    const m = document.createElement("p");
    m.className = "coll-item-note";
    m.textContent = "Personal lineup (private to its owner)";
    li.append(m);
  } else if (it.throwId) {
    const idx = it.lineup.throws.findIndex(x => x.id === it.throwId);
    if (idx >= 0) li.append(Object.assign(document.createElement("span"), { className: "coll-variant", textContent: `Variant ${String(idx + 1).padStart(2, "0")}` }));
  }

  // Role / timing / note: inline inputs for the owner, plain text for viewers.
  if (owner) li.append(itemFields(it));
  else if (it.role || it.timing || it.note) {
    const d = document.createElement("div");
    d.className = "coll-item-info";
    if (it.role) d.append(Object.assign(document.createElement("span"), { className: "coll-chip", textContent: it.role }));
    if (it.timing) d.append(Object.assign(document.createElement("span"), { className: "coll-chip alt", textContent: it.timing }));
    if (it.note) d.append(Object.assign(document.createElement("p"), { className: "coll-item-note", textContent: it.note }));
    li.append(d);
  }
  return li;
}

function itemFields(it) {
  const wrap = document.createElement("div");
  wrap.className = "coll-fields";
  [["role", "Role", "Player 1, Entry…", 40], ["timing", "Timing", "On execute call…", 60], ["note", "Note", "Short note", 280]].forEach(([key, label, ph, max]) => {
    const input = document.createElement("input");
    input.type = "text"; input.maxLength = max; input.placeholder = ph; input.value = it[key] || "";
    input.setAttribute("aria-label", label);
    input.className = "coll-field coll-field-" + key;
    input.onchange = async () => {
      const prev = it[key];
      it[key] = input.value.trim();
      try { await updateItem(view.data.id, it.id, { [key]: it[key] }); }
      catch (e) { it[key] = prev; input.value = prev || ""; toastError(e.message); }
    };
    wrap.append(input);
  });
  return wrap;
}

async function moveItemTo(from, to) {
  const items = view.data.items;
  const prev = [...items];
  const [moved] = items.splice(from, 1);
  items.splice(to, 0, moved);
  view.step = items.findIndex(x => x.id === prev[view.step]?.id);
  if (view.step < 0) view.step = 0;
  renderPanel(); refreshLocal();
  try { await reorderItems(view.data.id, items.map(x => x.id)); }
  catch (e) { view.data.items = prev; renderPanel(); refreshLocal(); toastError("Couldn't save the new order. " + e.message); }
}
const moveItem = (i, d) => moveItemTo(i, i + d);

function removeItemUndoable(it) {
  const data = view.data;
  const index = data.items.findIndex(x => x.id === it.id);
  deferDelete({
    key: `coll-item:${it.id}`,
    message: "Removed from collection",
    apply: () => { data.items.splice(index, 1); view.step = Math.min(view.step, Math.max(0, data.items.length - 1)); applyViewLineups(); renderPanel(); bumpCount(data.id, -1); },
    restore: () => { data.items.splice(index, 0, it); applyViewLineups(); renderPanel(); bumpCount(data.id, 1); },
    request: { method: "POST", url: "/api/collections", body: { action: "remove-item", id: data.id, itemId: it.id } },
    onError: (err) => toastError("Couldn't remove it. " + err.message),
  });
}
function bumpCount(id, d) {
  const row = mine.find(c => c.id === id);
  if (row) { row.itemCount = Math.max(0, row.itemCount + d); renderRail(); }
}

async function duplicateCollection() {
  try {
    const copy = await forkCollection({ id: view.data.id });
    mine.unshift(copy);
    toast(`Duplicated as “${copy.name}”`, { action: { label: "Open", onClick: () => openCollection({ id: copy.id }) } });
    renderRail();
  } catch (e) { toastError(e.message); }
}

async function saveCopy() {
  if (!authUser) { openAuthModal("signin"); return; }
  try {
    const copy = await forkCollection({ slug: view.data.slug });
    mine.unshift(copy);
    renderRail();
    toast(`Saved to your collections as “${copy.name}”`, { action: { label: "Open", onClick: () => openCollection({ id: copy.id }) } });
  } catch (e) { toastError(e.message); }
}

function deleteOpenCollection() {
  const data = view.data;
  const prevMine = [...mine];
  deferDelete({
    key: `collection:${data.id}`,
    message: `Deleted “${data.name}”`,
    apply: () => { mine = mine.filter(c => c.id !== data.id); exitCollection(); },
    restore: () => { mine = prevMine; renderRail(); },
    request: { method: "DELETE", url: `/api/collections?id=${encodeURIComponent(data.id)}` },
    onError: (err) => toastError("Couldn't delete the collection. " + err.message),
  });
}

// ---------------------------------------------------------------- share ---
const shareModal = $("collShareModal");
function openShareModal() {
  renderShare();
  shareModal.classList.add("show");
}
function renderShare() {
  const data = view.data;
  const box = $("collVis");
  box.replaceChildren();
  Object.entries(VIS).forEach(([id, v]) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "coll-vis-opt" + (data.visibility === id ? " active" : "");
    b.setAttribute("role", "radio"); b.setAttribute("aria-checked", data.visibility === id ? "true" : "false");
    b.innerHTML = `<strong>${escapeHtml(v.label)}</strong><span>${escapeHtml(v.note)}</span>`;
    b.onclick = async () => {
      if (data.visibility === id) return;
      const prev = data.visibility;
      data.visibility = id; renderShare();
      try {
        await updateCollection(data.id, { visibility: id });
        const row = mine.find(c => c.id === data.id); if (row) row.visibility = id;
        renderRail(); renderPanel();
      } catch (e) { data.visibility = prev; renderShare(); toastError(e.message); }
    };
    box.append(b);
  });
  const shared = data.visibility !== "private";
  $("collLinkRow").hidden = !shared;
  $("collShareNote").textContent = shared ? "" : "Switch to Unlisted or Public to get a link you can send to your team.";
  $("collLinkInput").value = shareUrl(data.slug);
}
$("collCopyBtn").onclick = async () => {
  const input = $("collLinkInput"), btn = $("collCopyBtn");
  try { await navigator.clipboard.writeText(input.value); } catch { input.select(); document.execCommand && document.execCommand("copy"); }
  btn.textContent = "✓ Copied";
  toast("Link copied");
  setTimeout(() => { btn.textContent = "Copy link"; }, 1200);
};
$("collShareDone").onclick = () => closeModal(shareModal);

// --------------------------------------------------------------- report ---
const reportModal = $("collReportModal");
$("collReportCancel").onclick = () => closeModal(reportModal);
$("collReportSend").onclick = async () => {
  const btn = $("collReportSend");
  setBusy(btn, true, "Sending…");
  try {
    await reportCollection(view.data.slug, $("collReportReason").value, $("collReportDetails").value.trim());
    closeModal(reportModal);
    toast("Thanks. We'll review this collection.");
  } catch (e) { toastError(e.message); }
  setBusy(btn, false);
};

// --------------------------------------------------------------- wiring ---
watchDialog(editModal, "show", () => $("collNameInput"));
watchDialog(shareModal, "show", () => $("collVis").querySelector("button"));
watchDialog(reportModal, "show", () => $("collReportReason"));
$("collEditCancel").onclick = () => closeModal(editModal);
$("collEditSave").onclick = saveEditModal;
$("collNameInput").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); saveEditModal(); } });
if (collNewBtn) collNewBtn.onclick = () => openEditModal();

registerShortcut({
  keys: ["ArrowLeft"], label: "←", description: "Previous step (collection)", group: "Collections", priority: 20,
  when: () => !!view && okItems().length > 0 && !document.getElementById("lightboxModal").classList.contains("show"),
  handler: prevStep,
});
registerShortcut({
  keys: ["ArrowRight"], label: "→", description: "Next step (collection)", group: "Collections", priority: 20,
  when: () => !!view && okItems().length > 0 && !document.getElementById("lightboxModal").classList.contains("show"),
  handler: nextStep,
});
registerShortcut({
  keys: ["c", "C"], label: "C", description: "New collection", group: "Collections",
  when: () => !appShell.hidden && !!authUser, handler: () => openEditModal(),
});
registerLayer({ priority: 85, isOpen: popoverOpen, close: closePopover });
registerLayer({ priority: 55, isOpen: () => selection.size > 0 || selectMode, close: endSelecting });
registerLayer({ priority: 35, isOpen: () => !!view, close: exitCollection });

// The map changed / its lineups (re)loaded: keep the sidebar list in step.
hooks.onMapChange = resetCollections;
hooks.afterLoad = () => { if (!mineLoaded || authUser) refreshCollections(); else renderRail(); };
