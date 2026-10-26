import { setAddMode, startAddFlow } from "./add-mode.js";
import { initAuth } from "./auth.js";
import { MAPS, TYPES } from "./constants.js";
import { closeDetailPanel, hideDetailPanel, openDetail, throwIndexFromParams } from "./detail-panel.js";
import { appShell, detailPanel, homeBrand, lightboxModal, lightboxNext, lightboxPrev, lineupSearchInput, sidebarBrand } from "./dom.js";
import "./tooltip.js"; // side effect only: data-tip tooltips
import "./feedback.js"; // side effect only: feedback box
import "./feedback-prompt.js"; // side effect only: one-time "send feedback" nudge
import "./offline.js"; // side effect only: service worker, offline banner
import "./collections.js"; // side effect only: collections rail, panel, popover
import { openCollectionBySlug } from "./collections.js";
import "./marker-preview.js"; // side effect only: hover card on landing markers
import "./fx.js"; // side effect only: home-screen visual effects
import "./profile-modal.js"; // side effect only: wires up the profile button + modal
import { enterMap, goHome } from "./home-screen.js";
import { focusLineup, openMobileSearch, orderedVisibleLineups } from "./lineup-list.js";
import { renderMarkers } from "./markers.js";
import { resetZoom } from "./pan-zoom.js";
import { registerLayer, registerShortcut, setShortcutSuspender } from "./shortcuts.js";
import { buildFilters, buildSidebar, closeSidebar, toggleTypeFilter } from "./sidebar.js";
import { state } from "./state.js";

// The map view is its own history entry above the chooser, so going home from
// the logo pops back to it (keeping Back/Forward symmetric). Fall back to a
// direct render if there's no map entry to pop (shouldn't happen in normal flow).
function goHomeFromLogo() {
  closeSidebar();
  if (history.state && history.state.view === "map" && !history.state.lineup) history.back();
  else goHome();
}
homeBrand.onclick = goHomeFromLogo;
sidebarBrand.onclick = goHomeFromLogo;

// Browser Back/Forward between the chooser and a map view. URL-driven and
// render-only — never pushes, or Back would get stuck.
window.addEventListener("popstate", () => {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("map");
  if (!id || !MAPS.some(m => m.id === id)) { goHome(); return; }
  // Same map still on screen: only the open lineup changed (Back/Forward
  // over a dossier entry), so open/close it without reloading the map.
  if (id === state.mapId && !appShell.hidden) {
    const lineupId = params.get("lineup");
    if (lineupId && state.lineups.some(l => l.id === lineupId)) openDetail(lineupId, throwIndexFromParams(params) ?? 0);
    else if (detailPanel.classList.contains("open")) hideDetailPanel();
    return;
  }
  enterMap(id);
});

// ── Keyboard: every global shortcut goes through js/shortcuts.js ──────────
// Escape peels back one layer at a time (highest priority first); the other
// keys are plain shortcuts, ignored while typing or while a modal is open.
const inMap = () => !appShell.hidden;
const lightboxOpen = () => lightboxModal.classList.contains("show");
const dossierOpen = () => detailPanel.classList.contains("open");

// While repositioning, the reposition overlay owns the keyboard (its own
// Escape = cancel), so suspend every global shortcut.
setShortcutSuspender(() => state.reposition);

registerLayer({ priority: 90, isOpen: lightboxOpen, close: () => lightboxModal.classList.remove("show") });
// Topmost open modal. A modal can name its own dismiss control with
// [data-esc] (e.g. the throw modal's Cancel, which may ask about unsaved
// changes first); otherwise it is simply hidden and any add flow is reset.
registerLayer({
  priority: 80,
  isOpen: () => !!document.querySelector(".modal-backdrop.show"),
  close: () => {
    const open = [...document.querySelectorAll(".modal-backdrop.show")];
    const top = open[open.length - 1];
    const dismiss = top.querySelector("[data-esc]");
    if (dismiss) { dismiss.click(); return; }
    top.classList.remove("show");
    if (!document.querySelector(".modal-backdrop.show")) setAddMode(false);
  },
});
registerLayer({ priority: 70, isOpen: dossierOpen, close: closeDetailPanel });
registerLayer({ priority: 60, isOpen: () => !!state.openClusterKey, close: () => { state.openClusterKey = null; renderMarkers(); } });
registerLayer({ priority: 50, isOpen: () => !!state.selectedLineupId, close: () => { state.selectedLineupId = null; renderMarkers(); } });
registerLayer({ priority: 40, isOpen: () => state.addMode || !!state.pendingThrowFor, close: () => { setAddMode(false); state.pendingThrowFor = null; } });

const TYPE_PLURALS = { smoke: "smokes", flash: "flashes", fire: "molotovs", he: "HE grenades", decoy: "decoys" };
TYPES.forEach((t, i) => {
  registerShortcut({
    keys: [String(i + 1)], label: String(i + 1), description: `Show / hide ${TYPE_PLURALS[t.id] || t.label}`, group: "Map",
    when: inMap, handler: () => { toggleTypeFilter(t.id); buildFilters(); },
  });
});
registerShortcut({
  keys: ["/"], label: "/", description: "Search lineups", group: "Map", when: inMap,
  handler: () => {
    // The sidebar search is hidden at phone width; use the search popup there.
    if (lineupSearchInput && lineupSearchInput.getClientRects().length) { lineupSearchInput.focus(); lineupSearchInput.select(); }
    else openMobileSearch();
  },
});
registerShortcut({
  keys: ["a", "A"], label: "A", description: "Add a lineup / cancel adding", group: "Map", when: inMap,
  handler: () => { if (state.addMode) { setAddMode(false); state.pendingThrowFor = null; } else startAddFlow(); },
});
registerShortcut({ keys: ["z", "Z"], label: "Z", description: "Reset zoom", group: "Map", when: inMap, handler: resetZoom });

registerShortcut({
  keys: ["ArrowLeft"], label: "←", description: "Previous image (lightbox) / previous lineup (dossier)", group: "Lineups",
  priority: 10, allowInModal: true, when: lightboxOpen, handler: () => lightboxPrev.onclick(),
});
registerShortcut({
  keys: ["ArrowRight"], label: "→", description: "Next image (lightbox) / next lineup (dossier)", group: "Lineups",
  priority: 10, allowInModal: true, when: lightboxOpen, handler: () => lightboxNext.onclick(),
});
registerShortcut({ keys: ["ArrowLeft"], label: "←", group: "Lineups", when: dossierOpen, handler: () => stepLineup(-1) });
registerShortcut({ keys: ["ArrowRight"], label: "→", group: "Lineups", when: dossierOpen, handler: () => stepLineup(1) });

// ←/→ in the dossier: walk the lineups currently visible on the map, in the
// same order as the sidebar list, wrapping around at either end.
function stepLineup(dir) {
  const list = orderedVisibleLineups();
  if (!list.length) return;
  const i = list.findIndex(l => l.id === state.selectedLineupId);
  const next = list[(i + dir + list.length) % list.length];
  if (next && next.id !== state.selectedLineupId) openDetail(next.id, 0);
}

export async function loadConfig() {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch("/api/config");
      if (!res.ok) continue;
      const cfg = await res.json();
      if (cfg.supabaseUrl && cfg.supabaseAnonKey) {
        window.__SUPABASE_URL      = cfg.supabaseUrl;
        window.__SUPABASE_ANON_KEY = cfg.supabaseAnonKey;
        return true;
      }
    } catch (e) { console.warn("Config attempt", attempt + 1, "failed:", e); }
  }
  return false;
}

buildSidebar();

buildFilters();

// Deep links from the server-rendered SEO pages ("Open in interactive
// map"): /?map=dust2 opens that map, /?map=dust2&lineup=<id> also picks that
// lineup (outlines it on the map, hides the rest) once its lineups have loaded.
// /?map=dust2&lineup=<id>&throw=2 (shared from the dossier: 1-based, like the
// "VARIANT 02" label) opens the dossier straight on that variant and briefly
// highlights it; the dossier pushes its own history entry above the map one.
async function handleDeepLink() {
  const params = new URLSearchParams(window.location.search);
  const mapId = params.get("map");
  if (!mapId || !MAPS.some(m => m.id === mapId)) return;
  // Seed a chooser entry beneath this map view so Back / the "Maps" button
  // land on the chooser even when the user deep-linked straight to a map.
  history.replaceState({ view: "home" }, "", "/");
  history.pushState({ view: "map", map: mapId }, "", `/?map=${mapId}`);
  await enterMap(mapId);
  const collectionSlug = params.get("collection");
  if (collectionSlug) { await openCollectionBySlug(collectionSlug); return; }
  const lineupId = params.get("lineup");
  if (!lineupId) return;
  // The initial auth event can restart the lineup load mid-flight (see
  // auth.js onAuthStateChange -> loadLineups), cancelling the load we just
  // awaited — so poll briefly for the lineup instead of checking once.
  for (let i = 0; i < 50; i++) {
    if (state.lineups.some(l => l.id === lineupId)) {
      const throwIdx = throwIndexFromParams(params);
      if (throwIdx !== undefined) openDetail(lineupId, throwIdx, { highlight: true });
      else focusLineup(lineupId);
      return;
    }
    await new Promise(r => setTimeout(r, 100));
  }
}

loadConfig().then(async () => {
  // Offline (or with a broken auth backend) the public map must still open.
  try { await initAuth(); } catch (e) { console.warn("auth init failed:", e); }
  handleDeepLink();
});

// Home "Guides for every map" cards ship with prerendered counts; refresh
// them with the live official-lineup counts (one small request).
async function refreshHomeMapCounts() {
  const els = document.querySelectorAll("[data-map-count]");
  if (!els.length) return;
  try {
    const res = await fetch("/api/lineups?counts=true");
    if (!res.ok) return;
    const counts = await res.json();
    els.forEach(el => {
      const n = counts[el.dataset.mapCount] || 0;
      el.textContent = n === 0 ? "Lineups coming soon" : `${n} lineup${n === 1 ? "" : "s"}`;
    });
  } catch (e) { /* keep the prerendered counts */ }
}
if (!document.documentElement.hasAttribute("data-deep-link")) refreshHomeMapCounts();
