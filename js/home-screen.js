import { setAddMode } from "./add-mode.js";
import { hideDetailPanel } from "./detail-panel.js";
import { LAST_MAP_KEY, MAPS } from "./constants.js";
import { appShell, homeScreen } from "./dom.js";
import { selectMap } from "./map-data.js";
import { preloadMapImages } from "./map-preload.js";
import { closeSidebar } from "./sidebar.js";

// enterMap / goHome are pure view renders (no history). The nav wrappers
// below add the history entries so the map chooser and each map view are
// distinct "pages": the map view is pushed on top of the chooser, so the
// browser Back button and the in-app "Maps" button both return to it.
export function enterMap(id) {
  homeScreen.style.display = "none";
  appShell.removeAttribute("hidden");
  closeSidebar();
  const loaded = selectMap(id);
  // Warm the other radars once the user is actually in the map app.
  preloadMapImages();
  return loaded;
}

// From the chooser into a map: push a new history entry.
export function openMap(id) {
  history.pushState({ view: "map", map: id }, "", `/?map=${id}`);
  return enterMap(id);
}

// Switching maps while already in the app: replace, so there's still just one
// map entry sitting above the chooser (Back always returns to the chooser).
export function switchMap(id) {
  history.replaceState({ view: "map", map: id }, "", `/?map=${id}`);
  return selectMap(id);
}

export function goHome() {
  hideDetailPanel();
  setAddMode(false);
  window.location.href = "/maps";
}

// "Continue on Dust II" next to the main call to action, from the map the
// user opened last. Hidden when nothing valid is stored.
(function addContinueButton() {
  const actions = document.querySelector(".hero-actions");
  if (!actions) return;
  let last = null;
  try { last = localStorage.getItem(LAST_MAP_KEY); } catch {}
  const map = MAPS.find(m => m.id === last);
  if (!map) return;
  const a = document.createElement("a");
  a.className = "hero-continue";
  a.href = `/?map=${map.id}`;
  a.innerHTML = `<span>Continue on</span> ${map.name}`;
  const cta = actions.querySelector(".hero-cta");
  if (cta) cta.after(a); else actions.prepend(a);
})();
