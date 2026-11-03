// Feedback box: a button on the map opens a small form (suggestion or bug
// report). The message goes to /api/feedback and is read, solved or
// discarded by an admin in admin.html. Works signed out too; signed-out
// visitors can leave an email if they want a reply.
//
// Signed-in users also get a "Your feedback" tab listing what they sent and
// its status. When an admin closes one of their items, a dot shows on the
// button until they open that tab, which tells the API those items were seen
// (stored server-side, so the dot shows once per item across devices).
import { authHeaders, authUser } from "./auth.js";
import { feedbackBtn } from "./dom.js";
import { closeModal, watchDialog } from "./modal-utils.js";
import { sideSegment } from "./side.js";
import { state } from "./state.js";
import { fullDate, relativeTime } from "./time-utils.js";
import { toast, toastError } from "./toast.js";
import { emptyState, setBusy } from "./ui-utils.js";

const modal = document.getElementById("feedbackModal");
const title = document.getElementById("feedbackTitle");
const tabs = document.getElementById("feedbackTabs");
const form = document.getElementById("feedbackForm");
const mine = document.getElementById("feedbackMine");
const dot = document.getElementById("feedbackDot");
const message = document.getElementById("feedbackMessage");
const count = document.getElementById("feedbackCount");
const contactWrap = document.getElementById("feedbackContactWrap");
const contact = document.getElementById("feedbackContact");
const website = document.getElementById("feedbackWebsite");
const send = document.getElementById("feedbackSend");
const cancel = document.getElementById("feedbackCancel");
const KINDS = [{ id: "suggestion", label: "Suggestion" }, { id: "bug", label: "Bug report" }];
const TABS = [{ id: "send", label: "Send feedback" }, { id: "mine", label: "Your feedback" }];
const STATUS = { open: "Pending", solved: "Resolved", discarded: "Discarded" };
let kind = "suggestion";
let tab = "send";
let items = null; // the signed-in user's own feedback, newest first (null = not loaded)
let loadedFor = null; // user id `items` belongs to
let lastLoad = 0;

function buildKind() {
  document.getElementById("feedbackKind").replaceChildren(sideSegment(KINDS, kind, (v) => { kind = v; }, { label: "Type of feedback" }));
}

const unseenCount = () => (items ? items.filter(i => i.unseen).length : 0);

function drawDot() {
  const n = authUser ? unseenCount() : 0;
  dot.hidden = !n;
  if (feedbackBtn) feedbackBtn.setAttribute("aria-label", n ? `Feedback, ${n} update${n === 1 ? "" : "s"}` : "Feedback");
  const tabDot = tabs.querySelector(".fb-tab-dot");
  if (tabDot) tabDot.hidden = !n;
}

export async function loadMine() {
  if (!authUser) { items = null; loadedFor = null; drawDot(); return; }
  const uid = authUser.id;
  try {
    const res = await fetch("/api/feedback", { headers: await authHeaders() });
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    if (!authUser || authUser.id !== uid) return; // signed out or switched meanwhile
    items = data.items || [];
    loadedFor = uid;
    lastLoad = Date.now();
  } catch (e) {
    if (loadedFor !== uid) items = null;
  }
  drawDot();
}

function itemRow(it) {
  const row = document.createElement("li");
  row.className = "fb-mine-item" + (it.unseen ? " unseen" : "");
  const head = document.createElement("div");
  head.className = "fb-mine-head";
  const created = Date.parse(it.createdAt);
  const closed = it.closedAt ? Date.parse(it.closedAt) : 0;
  head.append(
    Object.assign(document.createElement("span"), { className: `fb-status fb-status--${it.status}`, textContent: STATUS[it.status] || it.status }),
    Object.assign(document.createElement("span"), { className: "fb-mine-kind", textContent: it.kind === "bug" ? "Bug report" : "Suggestion" }),
    Object.assign(document.createElement("span"), { className: "fb-mine-date", textContent: relativeTime(created), title: `Sent ${fullDate(created)}` + (closed ? `\n${STATUS[it.status]} ${fullDate(closed)}` : "") }),
  );
  if (it.unseen) head.append(Object.assign(document.createElement("span"), { className: "fb-new", textContent: "New" }));
  const msg = Object.assign(document.createElement("p"), { className: "fb-mine-msg", textContent: it.message, title: it.message });
  row.append(head, msg);
  return row;
}

function drawMine() {
  if (items === null) { mine.replaceChildren(emptyState({ title: "Couldn't load your feedback", body: "Check your connection and try again.", compact: true })); return; }
  if (!items.length) { mine.replaceChildren(emptyState({ title: "Nothing sent yet", body: "Suggestions and bug reports you send show up here with their status.", compact: true })); return; }
  const list = document.createElement("ul");
  list.className = "fb-mine-list";
  list.append(...items.map(itemRow));
  mine.replaceChildren(list);
}

// The rows keep their "New" tag for this viewing; the next load comes back
// with unseen: false.
async function markSeen() {
  const ids = (items || []).filter(i => i.unseen).map(i => i.id);
  if (!ids.length) return;
  items.forEach(i => { i.unseen = false; });
  drawDot();
  try {
    const res = await fetch("/api/feedback", {
      method: "POST", headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify({ action: "seen", ids }),
    });
    if (!res.ok) throw new Error(res.status);
  } catch (e) { /* the dot comes back on the next load and they can look again */ }
}

function showTab(id) {
  tab = id;
  const listing = id === "mine";
  form.hidden = listing;
  mine.hidden = !listing;
  send.hidden = listing;
  cancel.textContent = listing ? "Close" : "Cancel";
  if (listing) { drawMine(); markSeen(); }
}

function buildTabs() {
  tabs.hidden = !authUser;
  if (!authUser) { tabs.replaceChildren(); return; }
  const seg = sideSegment(TABS, tab, showTab, { label: "Feedback view" });
  const tabDot = Object.assign(document.createElement("i"), { className: "fb-tab-dot", hidden: !unseenCount() });
  tabDot.setAttribute("aria-hidden", "true");
  seg.querySelector('[data-side="mine"]').append(tabDot);
  tabs.replaceChildren(seg);
}

async function open() {
  kind = "suggestion";
  buildKind();
  message.value = "";
  website.value = "";
  count.textContent = "0 / 2000";
  contactWrap.hidden = !!authUser; // signed-in users are reachable through their account
  title.textContent = authUser ? "Feedback" : "Send feedback";
  // Fresh statuses before choosing the tab: an admin may have acted since the last check.
  if (authUser && (loadedFor !== authUser.id || Date.now() - lastLoad > 30_000)) await loadMine();
  tab = authUser && unseenCount() ? "mine" : "send";
  buildTabs();
  showTab(tab);
  modal.classList.add("show");
}

async function submit() {
  const text = message.value.trim();
  if (!text) { message.focus(); toast("Write a message first"); return; }
  setBusy(send, true, "Sending…");
  try {
    const sel = state.selectedLineupId ? ` lineup:${state.selectedLineupId}` : "";
    const headers = { "Content-Type": "application/json" };
    if (authUser) Object.assign(headers, await authHeaders());
    const res = await fetch("/api/feedback", {
      method: "POST", headers,
      body: JSON.stringify({ kind, message: text, contact: contact.value.trim(), page: `map:${state.mapId}${sel}`, website: website.value }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Couldn't send your message.");
    closeModal(modal);
    toast("Thanks! Your feedback was sent.");
    if (authUser) loadMine();
  } catch (e) { toastError(e.message); }
  setBusy(send, false);
}

watchDialog(modal, "show", () => (tab === "mine" ? tabs.querySelector(".side-seg-btn.active") : message));
if (feedbackBtn) feedbackBtn.onclick = open;
cancel.onclick = () => closeModal(modal);
send.onclick = submit;
message.addEventListener("input", () => { count.textContent = `${message.value.length} / 2000`; });
// applyAuthState (js/auth.js) fires this on startup and whenever who is
// signed in changes.
document.addEventListener("authchange", () => { if ((authUser ? authUser.id : null) !== loadedFor) loadMine(); });
// Pick up an admin's verdict when the user comes back to the tab.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && authUser && Date.now() - lastLoad > 60_000) loadMine();
});
