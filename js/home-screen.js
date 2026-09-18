import { setAddMode } from "./add-mode.js";
import { closeDetailPanel } from "./detail-panel.js";
import { appShell, homeScreen } from "./dom.js";
import { selectMap } from "./map-data.js";
import { closeSidebar } from "./sidebar.js";

// enterMap / goHome are pure view renders (no history). The nav wrappers
// below add the history entries so the map chooser and each map view are
// distinct "pages": the map view is pushed on top of the chooser, so the
// browser Back button and the in-app "Maps" button both return to it.
export function enterMap(id) {
  homeScreen.style.display = "none";
  appShell.removeAttribute("hidden");
  closeSidebar();
  return selectMap(id);
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
  closeDetailPanel();
  setAddMode(false);
  window.location.href = "/maps";
}
