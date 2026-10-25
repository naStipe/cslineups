// Admin tool: moderate shared collections. Lists every public or unlisted
// collection (open reports first), with hide / unhide, delete and
// "mark reports handled". Hiding takes a collection off its share link
// without deleting it; the owner still sees it.
import { MAPS } from "./constants.js";
import { confirmDialog } from "./confirm-dialog.js";
import { toast, toastError } from "./toast.js";
import { emptyState } from "./ui-utils.js";

const MAP_NAMES = Object.fromEntries(MAPS.map(m => [m.id, m.name]));

export function mountCollectionModeration(root, authHeaders) {
  let rows = [];

  async function call(body) {
    const res = await fetch("/api/admin", {
      method: "POST", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.status);
  }

  async function load() {
    root.replaceChildren(Object.assign(document.createElement("p"), { className: "admin-hint", textContent: "Loading…" }));
    try {
      const res = await fetch("/api/admin?collections=1", { headers: await authHeaders() });
      if (!res.ok) throw new Error(res.status);
      rows = (await res.json()).collections;
    } catch (e) { root.replaceChildren(emptyState({ title: "Couldn't load collections", body: String(e.message || e), compact: true })); return; }
    draw();
  }

  function draw() {
    root.replaceChildren();
    if (!rows.length) { root.append(emptyState({ title: "No shared collections yet", compact: true })); return; }
    // Reported first, then newest.
    [...rows].sort((a, b) => b.reports.length - a.reports.length).forEach(c => {
      const card = document.createElement("div");
      card.className = "os-item cm-item" + (c.reports.length ? " reported" : "");
      const info = document.createElement("div");
      info.className = "cm-info";
      const title = document.createElement("strong");
      title.textContent = c.name + (c.hidden ? " (hidden)" : "");
      const meta = document.createElement("span");
      meta.className = "cm-meta";
      meta.textContent = `${MAP_NAMES[c.mapId] || c.mapId} · ${c.itemCount} lineups · ${c.visibility} · by ${c.owner}`;
      info.append(title, meta);
      if (c.description) info.append(Object.assign(document.createElement("span"), { className: "cm-meta", textContent: c.description }));
      c.reports.forEach(r => info.append(Object.assign(document.createElement("span"), {
        className: "cm-report", textContent: `Report: ${r.reason || "other"}${r.details ? " — " + r.details : ""}`,
      })));

      const btns = document.createElement("div");
      btns.className = "cm-actions";
      const add = (label, fn, cls = "ghost-btn") => { const b = Object.assign(document.createElement("button"), { type: "button", className: cls, textContent: label }); b.onclick = fn; btns.append(b); };
      add("Open", () => window.open(`/c/${c.slug}`, "_blank", "noopener"));
      add(c.hidden ? "Unhide" : "Hide", async () => {
        try { await call({ action: "collection-hide", collectionId: c.id, hidden: !c.hidden }); c.hidden = !c.hidden; toast(c.hidden ? "Hidden" : "Visible again"); draw(); }
        catch (e) { toastError(e.message); }
      });
      if (c.reports.length) add("Reports handled", async () => {
        try { await call({ action: "collection-resolve", collectionId: c.id }); c.reports = []; draw(); } catch (e) { toastError(e.message); }
      });
      add("Delete", async () => {
        if (!(await confirmDialog({ title: `Delete “${c.name}”?`, body: "This removes the collection and its share link for good.", confirmLabel: "Delete", danger: true }))) return;
        try { await call({ action: "collection-delete", collectionId: c.id }); rows = rows.filter(x => x.id !== c.id); toast("Collection deleted"); draw(); }
        catch (e) { toastError(e.message); }
      });
      card.append(info, btns);
      root.append(card);
    });
  }

  load();
}
