// One-time nudge toward the feedback box. A small non-blocking card shown
// ONCE PER USER, ever (localStorage + auth user_metadata for signed-in users).
//
// Engagement rule: after the visitor has opened 3 different lineups on the map
// (nothing time-based, so a deep link or a quick visit never triggers it).
// It then waits until the UI is calm (no modal, dossier, lightbox, add flow,
// reposition overlay, select mode, cookie banner or offline state) for two
// ticks in a row. It is marked seen the moment it is SHOWN.
import { authReady, authUser, getAuthClient } from "./auth.js";
import { detailPanel, appShell } from "./dom.js";
import { openFeedback } from "./feedback.js";
import { isOnline } from "./offline.js";
import { registerLayer } from "./shortcuts.js";
import { state } from "./state.js";

const KEY = "lineupr_feedback_prompt_seen";
const NEEDED = 3;
const card = document.getElementById("fbPrompt");
const opened = new Set();
let shown = false;
let calm = 0;
let syncing = false;
const t0 = Date.now();

function seenLocal() { try { return !!localStorage.getItem(KEY); } catch (e) { return false; } }
function setLocal() { try { localStorage.setItem(KEY, "1"); } catch (e) {} }
const seenAccount = () => !!(authUser && authUser.user_metadata && authUser.user_metadata.feedback_prompt_seen);

function saveAccount() {
  if (!authUser || seenAccount() || syncing) return;
  syncing = true;
  getAuthClient().auth.updateUser({ data: { feedback_prompt_seen: true } }).catch(() => {}).then(() => { syncing = false; });
}

function blocked() {
  return !!document.querySelector(".modal-backdrop.show, #consentBanner, .coll-select-bar:not([hidden])")
    || detailPanel.classList.contains("open") || state.addMode || state.reposition || !!state.pendingThrowFor
    || !!state.pendingLanding || !isOnline() || document.hidden || (appShell && appShell.hasAttribute("hidden"));
}

function hide() { shown = false; suspended = false; card.hidden = true; }

function show() {
  shown = true;
  card.hidden = false;
  setLocal();
  saveAccount();
}

// A shown card steps aside while something else takes over the bottom of the
// screen (select bar, add flow, cookie banner, ...) and returns once it's calm
// again. Dismissing it (✕ / Not now / Esc) clears `shown`, so it never returns then.
let suspended = false;
function tickShown() {
  if (blocked()) { card.hidden = true; suspended = true; calm = 0; return; }
  if (!suspended) return;
  if (++calm >= 2) { card.hidden = false; suspended = false; }
}

function tick() {
  if (shown) { tickShown(); return; }
  // Wait for the session restore (so a signed-in user's account flag is known); if auth never comes up, carry on anyway.
  if (!authReady && Date.now() - t0 < 15000) return;
  if (seenAccount()) { setLocal(); return; }
  if (seenLocal()) { saveAccount(); return; } // signed in later: carry the flag to the account
  if (opened.size < NEEDED) return;
  calm = blocked() ? 0 : calm + 1;
  if (calm >= 2) show();
}

new MutationObserver(() => {
  if (detailPanel.classList.contains("open") && state.selectedLineupId) opened.add(state.selectedLineupId);
}).observe(detailPanel, { attributes: true, attributeFilter: ["class"] });
setInterval(tick, 1000);

const go = (kind) => () => { hide(); openFeedback({ kind }); };
document.getElementById("fbPromptSuggest").onclick = go("suggestion");
document.getElementById("fbPromptBug").onclick = go("bug");
document.getElementById("fbPromptLater").onclick = hide;
document.getElementById("fbPromptX").onclick = hide;
registerLayer({
  priority: 95,
  isOpen: () => shown && !document.querySelector(".modal-backdrop.show") && !detailPanel.classList.contains("open"),
  close: hide,
});
