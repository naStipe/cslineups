// Admin tool: read the feedback visitors sent from the map, and close each
// one as solved or discard it (either can be reopened).
import { MAPS } from "./constants.js";
import { toast, toastError } from "./toast.js";
import { emptyState } from "./ui-utils.js";
import { relativeTime, fullDate } from "./time-utils.js";

export function mountFeedback(root, authHeaders) {
  let filter = "open";
  let items = [];

  async function setStatus(item, status) {
    const prev = item.status;
    item.status = status; draw();
    try {
      const res = await fetch("/api/admin", {
        method: "POST", headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ action: "feedback-status", id: item.id, status }),
      });
      if (!res.ok) throw new Error(res.status);
      toast(status === "solved" ? "Marked as solved" : status === "discarded" ? "Discarded" : "Reopened");
      if (filter !== "all") { items = items.filter(i => (filter === "open") === (i.status === "open")); draw(); }
    } catch (e) { item.status = prev; draw(); toastError("Couldn't update it: " + e.message); }
  }

  function draw() {
    root.replaceChildren();
    const bar = document.createElement("div");
    bar.className = "ae-bar";
    const seg = document.createElement("div");
    seg.className = "side-seg";
    [["open", "Open"], ["closed", "Closed"], ["all", "All"]].forEach(([id, label]) => {
      const b = Object.assign(document.createElement("button"), { type: "button", className: "side-seg-btn" + (filter === id ? " active" : ""), textContent: label });
      b.onclick = () => { filter = id; load(); };
      seg.append(b);
    });
    bar.append(seg);
    root.append(bar);

    if (!items.length) { root.append(emptyState({ title: filter === "open" ? "No open feedback" : "Nothing here", compact: true })); return; }
    items.forEach(it => {
      const card = document.createElement("div");
      card.className = "os-item cm-item fb-item" + (it.status !== "open" ? " closed" : "");
      const info = document.createElement("div");
      info.className = "cm-info";
      const head = document.createElement("div");
      head.className = "fb-head";
      head.append(
        Object.assign(document.createElement("span"), { className: "type-chip", textContent: it.kind === "bug" ? "Bug" : "Suggestion" }),
        Object.assign(document.createElement("span"), { className: "cm-meta", textContent: `${it.from || "anonymous"} · ${relativeTime(Date.parse(it.createdAt))}`, title: fullDate(Date.parse(it.createdAt)) }),
      );
      if (it.status !== "open") head.append(Object.assign(document.createElement("span"), { className: "cm-meta", textContent: it.status === "solved" ? "✓ solved" : "discarded" }));
      const msg = Object.assign(document.createElement("p"), { className: "fb-message", textContent: it.message });
      info.append(head, msg);
      const where = (it.page || "").replace(/^map:([a-z0-9]+)/, (_, m) => (MAPS.find(x => x.id === m) || { name: m }).name);
      if (where) info.append(Object.assign(document.createElement("span"), { className: "cm-meta", textContent: `On: ${where}` }));
      if (it.contact) info.append(Object.assign(document.createElement("span"), { className: "cm-meta", textContent: `Contact: ${it.contact}` }));

      const btns = document.createElement("div");
      btns.className = "cm-actions";
      const add = (label, status, cls = "ghost-btn") => { const b = Object.assign(document.createElement("button"), { type: "button", className: cls, textContent: label }); b.onclick = () => setStatus(it, status); btns.append(b); };
      if (it.status === "open") { add("Mark solved", "solved", "primary-btn"); add("Discard", "discarded"); }
      else add("Reopen", "open");
      card.append(info, btns);
      root.append(card);
    });
  }

  async function load() {
    try {
      const res = await fetch(`/api/admin?feedback=${filter}`, { headers: await authHeaders() });
      if (!res.ok) throw new Error(res.status);
      items = (await res.json()).items;
    } catch (e) { items = []; toastError("Couldn't load feedback."); }
    draw();
  }
  load();
}
