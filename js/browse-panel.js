// The right-hand browse panel: this map's lineups (search + list) and your
// collections, as two tabs. The sidebar is navigation only (maps, account);
// everything about the current map's content lives here.
//
// Desktop: a docked column beside the map that can be hidden; open/closed
// and the active tab are remembered. Phones: a sheet over the map, closed by
// default and opened from the topbar, closed again when a lineup is picked so
// the map is visible.
import { browsePanel, browseToggle, lineupSearchInput } from "./dom.js";

const KEY = "lineupr.browse";
const phoneMq = window.matchMedia("(max-width: 768px)");
const backdrop = document.getElementById("browseBackdrop");
const closeBtn = document.getElementById("browseClose");
const tabs = [...browsePanel.querySelectorAll(".browse-tab")];

function remembered() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}
function remember(patch) {
  try { localStorage.setItem(KEY, JSON.stringify({ ...remembered(), ...patch })); } catch {}
}

// Docked by default where there is room for it next to the map.
const saved = remembered();
let dockedOpen = typeof saved.open === "boolean" ? saved.open : window.innerWidth >= 1100;
let sheetOpen = false;

export const isPhone = () => phoneMq.matches;
export const browseOpen = () => (isPhone() ? sheetOpen : dockedOpen);

function sync() {
  const open = browseOpen();
  document.body.classList.toggle("browse-open", open);
  browseToggle.setAttribute("aria-expanded", open ? "true" : "false");
  browseToggle.classList.toggle("active", open);
  browsePanel.inert = !open;
  if (backdrop) backdrop.classList.toggle("show", isPhone() && open);
}

export function openBrowse({ tab, focusSearch = false } = {}) {
  if (tab) setTab(tab);
  if (isPhone()) sheetOpen = true;
  else { dockedOpen = true; remember({ open: true }); }
  sync();
  if (focusSearch && lineupSearchInput) {
    lineupSearchInput.focus({ preventScroll: true });
    lineupSearchInput.select();
  } else if (isPhone()) {
    const active = tabs.find(t => t.classList.contains("active"));
    if (active) active.focus({ preventScroll: true });
  }
}

export function closeBrowse() {
  const hadFocus = browsePanel.contains(document.activeElement);
  if (isPhone()) sheetOpen = false;
  else { dockedOpen = false; remember({ open: false }); }
  sync();
  if (hadFocus) browseToggle.focus({ preventScroll: true });
}

export function toggleBrowse() {
  if (browseOpen()) closeBrowse(); else openBrowse();
}

// After picking something in the sheet, get it out of the way of the map.
export function closeBrowseOnPhone() {
  if (isPhone() && sheetOpen) closeBrowse();
}

// ---- Tabs (WAI-ARIA tabs pattern: arrows move between tabs) ----
export function setTab(name) {
  tabs.forEach(t => {
    const on = t.dataset.tab === name;
    t.classList.toggle("active", on);
    t.setAttribute("aria-selected", on ? "true" : "false");
    t.tabIndex = on ? 0 : -1;
    const panel = document.getElementById(t.getAttribute("aria-controls"));
    if (panel) panel.hidden = !on;
  });
  remember({ tab: name });
}

tabs.forEach((t, i) => {
  t.onclick = () => setTab(t.dataset.tab);
  t.onkeydown = (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const next = tabs[(i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
    setTab(next.dataset.tab);
    next.focus();
  };
});

// Small count next to a tab's label; empty hides it.
export function setTabCount(name, n) {
  const el = document.getElementById(name === "lineups" ? "browseLineupCount" : "browseCollCount");
  if (el) el.textContent = n ? String(n) : "";
}

browseToggle.onclick = toggleBrowse;
if (closeBtn) closeBtn.onclick = closeBrowse;
if (backdrop) backdrop.onclick = closeBrowse;
phoneMq.addEventListener("change", () => { sheetOpen = false; sync(); });

setTab(saved.tab === "collections" ? "collections" : "lineups");
sync();
