// Feedback box: a button on the map opens a small form (suggestion or bug
// report). The message goes to /api/feedback and is read, solved or
// discarded by an admin in admin.html. Works signed out too; signed-out
// visitors can leave an email if they want a reply.
//
// Signed-in users also get a "Your feedback" tab listing what they sent, its
// status and a reply thread with the team. When an admin closes or replies to
// one of their items, a dot shows on the button until they open that tab, which tells the API those items were seen
// (stored server-side, so the dot shows once per item across devices).
//
// For admins the button is a shortcut instead: it shows how many items are
// still open and goes straight to the feedback list in admin.html.
import { authHeaders, authUser, isAdmin } from "./auth.js";
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
let expanded = new Set(); // ids of items whose thread is showing
let adminOpen = 0; // open items site-wide, shown on the button for admins
const ADMIN_LIST = "/admin.html?view=feedback";

function buildKind() {
  document.getElementById("feedbackKind").replaceChildren(sideSegment(KINDS, kind, (v) => { kind = v; }, { label: "Type of feedback" }));
}

const unseenCount = () => (items ? items.filter(i => i.unseen).length : 0);

function drawDot() {
  const admin = !!authUser && isAdmin();
  const n = !authUser ? 0 : admin ? adminOpen : unseenCount();
  dot.hidden = !n;
  dot.classList.toggle("count", admin);
  dot.textContent = admin && n ? (n > 99 ? "99+" : String(n)) : "";
  if (feedbackBtn) {
    if (admin) feedbackBtn.removeAttribute("aria-haspopup");
    else feedbackBtn.setAttribute("aria-haspopup", "dialog");
    feedbackBtn.setAttribute("aria-label", admin
      ? (n ? `Feedback, ${n} open` : "Feedback list")
      : (n ? `Feedback, ${n} update${n === 1 ? "" : "s"}` : "Feedback"));
    feedbackBtn.title = admin ? "Open the feedback list" : "";
  }
  const tabDot = tabs.querySelector(".fb-tab-dot");
  if (tabDot) tabDot.hidden = !n;
}

async function loadAdminCount() {
  const uid = authUser.id;
  try {
    const res = await fetch("/api/admin?feedback=count", { headers: await authHeaders() });
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    if (!authUser || authUser.id !== uid) return;
    adminOpen = data.open || 0;
    loadedFor = uid;
    lastLoad = Date.now();
  } catch (e) { /* keep the last count */ }
  drawDot();
}

export async function loadMine() {
  if (!authUser) { items = null; adminOpen = 0; loadedFor = null; drawDot(); return; }
  if (isAdmin()) return loadAdminCount();
  const uid = authUser.id;
  try {
    const res = await fetch("/api/feedback", { headers: await authHeaders() });
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    if (!authUser || authUser.id !== uid) return; // signed out or switched meanwhile
    items = (data.items || []).map(i => ({ ...i, replies: i.replies || [] }));
    loadedFor = uid;
    lastLoad = Date.now();
  } catch (e) {
    if (loadedFor !== uid) items = null;
  }
  drawDot();
}

function replyRow(r) {
  const li = document.createElement("li");
  li.className = "fb-reply" + (r.fromAdmin ? " from-admin" : "");
  const created = Date.parse(r.createdAt);
  const meta = document.createElement("div");
  meta.className = "fb-reply-meta";
  meta.append(
    Object.assign(document.createElement("span"), { className: "fb-reply-who", textContent: r.fromAdmin ? "Lineupr team" : "You" }),
    Object.assign(document.createElement("span"), { textContent: relativeTime(created), title: fullDate(created) }),
  );
  li.append(meta, Object.assign(document.createElement("p"), { className: "fb-reply-body", textContent: r.body }));
  return li;
}

function replyForm(it, onSent) {
  const wrap = document.createElement("div");
  wrap.className = "fb-reply-form";
  const box = Object.assign(document.createElement("textarea"), { rows: 2, maxLength: 2000, placeholder: it.replies.length ? "Reply to the team…" : "Add a comment…" });
  box.setAttribute("aria-label", "Your reply");
  const btn = Object.assign(document.createElement("button"), { type: "button", className: "primary-btn", textContent: "Reply" });
  btn.onclick = async () => {
    const text = box.value.trim();
    if (!text) { box.focus(); return; }
    setBusy(btn, true, "Sending…");
    try {
      const res = await fetch("/api/feedback", {
        method: "POST", headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ action: "reply", id: it.id, body: text }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't send your reply.");
      it.replies.push(data.reply);
      onSent();
    } catch (e) { toastError(e.message); setBusy(btn, false); }
  };
  wrap.append(box, btn);
  return wrap;
}

function itemRow(it) {
  const row = document.createElement("li");
  row.className = "fb-mine-item" + (it.unseen ? " unseen" : "");
  const open = expanded.has(it.id);
  const toggle = Object.assign(document.createElement("button"), { type: "button", className: "fb-mine-toggle" });
  toggle.setAttribute("aria-expanded", String(open));
  const head = document.createElement("span");
  head.className = "fb-mine-head";
  const created = Date.parse(it.createdAt);
  const closed = it.closedAt ? Date.parse(it.closedAt) : 0;
  head.append(
    Object.assign(document.createElement("span"), { className: `fb-status fb-status--${it.status}`, textContent: STATUS[it.status] || it.status }),
    Object.assign(document.createElement("span"), { className: "fb-mine-kind", textContent: it.kind === "bug" ? "Bug report" : "Suggestion" }),
    Object.assign(document.createElement("span"), { className: "fb-mine-date", textContent: relativeTime(created), title: `Sent ${fullDate(created)}` + (closed ? `
${STATUS[it.status]} ${fullDate(closed)}` : "") }),
  );
  if (it.unseen) head.append(Object.assign(document.createElement("span"), { className: "fb-new", textContent: "New" }));
  const msg = Object.assign(document.createElement("span"), { className: "fb-mine-msg" + (open ? " full" : ""), textContent: it.message });
  toggle.append(head, msg);
  const n = it.replies.length;
  toggle.append(Object.assign(document.createElement("span"), { className: "fb-mine-more", textContent: open ? "Hide replies" : n ? `${n} repl${n === 1 ? "y" : "ies"}` : "Comment" }));
  toggle.onclick = () => {
    if (expanded.has(it.id)) expanded.delete(it.id); else expanded.add(it.id);
    row.replaceWith(itemRow(it));
  };
  row.append(toggle);
  if (open) {
    const thread = document.createElement("div");
    thread.className = "fb-thread";
    if (n) {
      const list = document.createElement("ul");
      list.className = "fb-replies";
      list.append(...it.replies.map(replyRow));
      thread.append(list);
    }
    thread.append(replyForm(it, () => {
      const next = itemRow(it);
      row.replaceWith(next);
      next.querySelector(".fb-reply-form textarea").focus({ preventScroll: true });
    }));
    row.append(thread);
  }
  return row;
}

function drawMine() {
  if (items === null) { mine.replaceChildren(emptyState({ title: "Couldn't load your feedback", body: "Check your connection and try again.", compact: true })); return; }
  if (!items.length) { mine.replaceChildren(emptyState({ title: "Nothing sent yet", body: "Suggestions and bug reports you send show up here with their status.", compact: true })); return; }
  // Items with something new (a verdict or a team reply) open expanded.
  expanded = new Set(items.filter(i => i.unseen).map(i => i.id));
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
if (feedbackBtn) feedbackBtn.onclick = () => { if (authUser && isAdmin()) location.assign(ADMIN_LIST); else open(); };
cancel.onclick = () => closeModal(modal);
send.onclick = submit;
message.addEventListener("input", () => { count.textContent = `${message.value.length} / 2000`; });
// applyAuthState (js/auth.js) fires this on startup and whenever who is
// signed in changes.
document.addEventListener("authchange", () => { if ((authUser ? authUser.id : null) !== loadedFor) loadMine(); });
// Pick up an admin's verdict (or, for admins, new open items) when the
// user comes back to the tab.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && authUser && Date.now() - lastLoad > 60_000) loadMine();
});
