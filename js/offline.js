// Offline support: registers the service worker (sw.js), shows an
// "Offline: showing saved lineups" banner while the connection is down, and
// marks the actions that need the server (create / edit / delete / collections)
// as unavailable with a tooltip. The guards in js/permissions.js stop any
// click that still gets through (including on controls built later).
import { toast } from "./toast.js";

const NEEDS_ONLINE = "#addModeBtn, #fabAddBtn, #addThrowBtn, #deleteLineupBtn, #collNewBtn, #collSelectBtn, #addToCollBtn, #saveLineupBtn, #submitLineupBtn, #feedbackBtn";
const HINT = "Unavailable while offline";

let banner = null;

export function isOnline() {
  return navigator.onLine !== false;
}

// For use by guards: explains and returns false when offline.
export function requireOnline() {
  if (isOnline()) return true;
  toast("You're offline. Reconnect to make changes.");
  return false;
}

function apply() {
  const offline = !isOnline();
  document.body.classList.toggle("is-offline", offline);
  if (!banner) {
    banner = document.createElement("div");
    banner.className = "offline-banner";
    banner.setAttribute("role", "status");
    banner.textContent = "Offline: showing saved lineups";
    document.body.appendChild(banner);
  }
  banner.classList.toggle("show", offline);
  document.querySelectorAll(NEEDS_ONLINE).forEach(el => {
    if (offline) {
      if (!el.dataset.onlineTitle) el.dataset.onlineTitle = el.title || "";
      el.title = HINT;
      el.setAttribute("aria-disabled", "true");
    } else if ("onlineTitle" in el.dataset) {
      el.title = el.dataset.onlineTitle;
      delete el.dataset.onlineTitle;
      el.removeAttribute("aria-disabled");
    }
  });
}

window.addEventListener("online", () => { apply(); toast("Back online"); });
window.addEventListener("offline", apply);
apply();

if ("serviceWorker" in navigator) {
  // After load, so registering never competes with the first paint.
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => console.warn("service worker:", err));
  });
}
