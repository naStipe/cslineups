// Searchable list of the current map's lineups in the sidebar. Clicking an
// entry focuses (pins + centers) its marker on the map AND expands a compact
// inline detail (throw technique + zoomable screenshot thumbnails) right in
// the list — the marker isn't auto-opened into the big detail panel.
//
// Independent of the topbar type-filter chips: the list is a "find any
// lineup" tool, so a chip being toggled off doesn't hide it here — focusing
// simply re-enables that type's markers if needed.
import { MOVEMENT_LABELS, RANGE_LABELS, TYPES } from "./constants.js";
import { lineupList, lineupSearchInput, markerLayer } from "./dom.js";
import { escapeHtml } from "./html-utils.js";
import { openLightbox } from "./lightbox.js";
import { centerOnMapPercent } from "./pan-zoom.js";
import { hydrateImages } from "./private-images.js";
import { buildFilters } from "./sidebar.js";
import { state } from "./state.js";

// Which lineup's inline detail is currently expanded (survives map-selection
// re-renders; reset whenever the list itself is rebuilt).
let expandedId = null;

function typeInfo(id) {
  return TYPES.find(t => t.id === id) || { label: id, color: "var(--signal)" };
}

function displayName(l) {
  const n = (l.name || "").trim();
  return n || `Unnamed ${typeInfo(l.type).label.toLowerCase()}`;
}

// Every image attached to a throw, in the order they're shown in the big
// detail panel: where to stand, where to aim, then the precise pixel.
function throwImages(t) {
  return [
    ...(Array.isArray(t.standing) ? t.standing : []),
    ...(Array.isArray(t.screenshots) ? t.screenshots : []),
    ...(t.precise ? [t.precise] : []),
  ].filter(Boolean);
}

export function buildLineupList() {
  if (!lineupList) return;
  expandedId = null; // a rebuild collapses any open inline detail
  const term = (lineupSearchInput && lineupSearchInput.value || "").trim().toLowerCase();

  const matches = state.lineups
    .filter(l => {
      if (!term) return true;
      const t = typeInfo(l.type);
      return displayName(l).toLowerCase().includes(term)
        || t.label.toLowerCase().includes(term)
        || l.type.toLowerCase().includes(term);
    })
    .sort((a, b) => {
      const ta = TYPES.findIndex(t => t.id === a.type);
      const tb = TYPES.findIndex(t => t.id === b.type);
      if (ta !== tb) return ta - tb;
      return displayName(a).localeCompare(displayName(b));
    });

  lineupList.innerHTML = "";

  if (matches.length === 0) {
    const empty = document.createElement("p");
    empty.className = "lineup-list-empty";
    empty.textContent = state.lineups.length === 0 ? "No lineups on this map." : "No matches.";
    lineupList.appendChild(empty);
    return;
  }

  matches.forEach(l => {
    const t = typeInfo(l.type);

    const entry = document.createElement("div");
    entry.className = "lineup-entry";

    const item = document.createElement("button");
    item.type = "button";
    item.className = "lineup-item" + (l.id === state.selectedLineupId ? " active" : "");
    item.dataset.lid = l.id;
    item.title = `${displayName(l)} — ${t.label}`;

    const dot = document.createElement("span");
    dot.className = "lineup-item-dot";
    dot.style.background = t.color;

    const name = document.createElement("span");
    name.className = "lineup-item-name";
    name.textContent = displayName(l);

    const meta = document.createElement("span");
    meta.className = "lineup-item-meta";
    meta.textContent = `${l.throws.length}×`;
    meta.title = `${l.throws.length} throw position${l.throws.length === 1 ? "" : "s"}`;

    const chevron = document.createElement("span");
    chevron.className = "lineup-item-chevron";
    chevron.textContent = "›";

    item.append(dot, name, meta, chevron);

    const detail = document.createElement("div");
    detail.className = "lineup-item-detail";

    item.onclick = () => {
      focusLineup(l.id);
      toggleExpand(entry, detail, l);
    };

    entry.append(item, detail);
    lineupList.appendChild(entry);
  });
}

function toggleExpand(entry, detail, l) {
  const isOpen = entry.classList.contains("expanded");

  // Single-open accordion — collapse whichever other entry is expanded.
  lineupList.querySelectorAll(".lineup-entry.expanded").forEach(e => {
    if (e === entry) return;
    e.classList.remove("expanded");
    const d = e.querySelector(".lineup-item-detail");
    if (d) d.innerHTML = "";
  });

  if (isOpen) {
    entry.classList.remove("expanded");
    detail.innerHTML = "";
    expandedId = null;
  } else {
    entry.classList.add("expanded");
    renderInlineDetail(detail, l);
    expandedId = l.id;
  }
}

function renderInlineDetail(container, l) {
  const html = l.throws.map((th, idx) => {
    const move = MOVEMENT_LABELS[th.movement] || th.movement || "—";
    const range = RANGE_LABELS[th.range] || th.range || "—";
    const imgs = throwImages(th);
    const thumbs = imgs.map((u, j) =>
      `<img class="lli-thumb" data-real-src="${escapeHtml(u)}" data-throw="${idx}" data-idx="${j}" alt="Throw ${idx + 1} screenshot ${j + 1}" loading="lazy">`
    ).join("");
    return `<div class="lli-throw">
      <div class="lli-throw-head">Throw ${idx + 1}<span class="lli-throw-tech"> · ${escapeHtml(move)} · ${escapeHtml(range)}</span></div>
      ${th.notes && th.notes.trim() ? `<p class="lli-notes">${escapeHtml(th.notes.trim())}</p>` : ""}
      ${thumbs ? `<div class="lli-thumbs">${thumbs}</div>` : ""}
    </div>`;
  }).join("");

  container.innerHTML = html || `<p class="lli-notes">No throw details.</p>`;
  hydrateImages(container); // resolves private-bucket images; public ones pass through

  container.querySelectorAll(".lli-thumb").forEach(img => {
    img.onclick = () => {
      const th = l.throws[+img.dataset.throw];
      if (!th) return;
      openLightbox(throwImages(th), +img.dataset.idx, `${displayName(l)} — throw ${+img.dataset.throw + 1}`);
    };
  });
}

// Keep the list's highlighted row in sync with the map selection (e.g. when a
// marker is picked directly on the map). Cheap class toggle only — no rebuild.
export function syncLineupListSelection() {
  if (!lineupList) return;
  lineupList.querySelectorAll(".lineup-item").forEach(el => {
    el.classList.toggle("active", el.dataset.lid === state.selectedLineupId);
  });
}

export function focusLineup(id) {
  const lineup = state.lineups.find(l => l.id === id);
  if (!lineup) return;

  // Make sure the marker is actually shown before we fly to it.
  if (!state.activeFilters.has(lineup.type)) {
    state.activeFilters.add(lineup.type);
    buildFilters();
  }
  state.openClusterKey = null;
  state.selectedLineupId = id;

  // Note: we deliberately don't close the mobile drawer here — the inline
  // detail we're about to expand lives inside it. The map focus is applied
  // underneath, ready for when the user dismisses the drawer.

  // centerOnMapPercent → applyTransform → renderMarkers, so the pinned marker
  // exists by the time we look for it on the next frame.
  centerOnMapPercent(lineup.landing.x, lineup.landing.y);
  syncLineupListSelection();

  requestAnimationFrame(() => {
    const el = markerLayer.querySelector(".marker.landing.pinned");
    if (!el) return;
    el.classList.remove("focus-flash");
    void el.offsetWidth; // restart the animation if it's already applied
    el.classList.add("focus-flash");
    el.addEventListener("animationend", () => el.classList.remove("focus-flash"), { once: true });
  });
}

if (lineupSearchInput) {
  lineupSearchInput.addEventListener("input", buildLineupList);
}
