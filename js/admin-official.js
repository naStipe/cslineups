// Admin tool: set the T / CT side on official lineups, one at a time or in
// bulk (they predate the side field and all default to "any").
import { MAPS, TYPES } from "./constants.js";
import { SIDES, normalizeSide, sideSegment } from "./side.js";
import { toast, toastError } from "./toast.js";
import { escapeHtml } from "./html-utils.js";

const TYPE_LABELS = Object.fromEntries(TYPES.map(t => [t.id, t.label]));

export function mountOfficialSides(root, authHeaders) {
  let mapId = MAPS[0].id;
  let lineups = [];
  const checked = new Set();

  root.innerHTML = `
    <div class="ae-bar">
      <select class="area-select" id="osMap" aria-label="Map"></select>
      <span class="admin-hint" id="osCount"></span>
      <span class="os-bulk">Set selected to <span id="osBulk"></span></span>
    </div>
    <ul class="os-list" id="osList"></ul>`;
  const $ = (id) => root.querySelector("#" + id);
  const mapSel = $("osMap"), listEl = $("osList");
  mapSel.innerHTML = MAPS.map(m => `<option value="${m.id}">${escapeHtml(m.name)}</option>`).join("");

  async function setSide(ids, side) {
    const res = await fetch("/api/lineups", {
      method: "POST", headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify({ id: ids[0], action: "set-side", ids, side }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.status);
    ids.forEach(id => { const l = lineups.find(x => x.id === id); if (l) l.side = side; });
  }

  function draw() {
    $("osCount").textContent = `${lineups.length} official lineup${lineups.length === 1 ? "" : "s"} · ${checked.size} selected`;
    listEl.innerHTML = "";
    lineups.forEach(l => {
      const li = document.createElement("li");
      li.className = "os-item";
      const cb = document.createElement("input");
      cb.type = "checkbox"; cb.checked = checked.has(l.id); cb.setAttribute("aria-label", `Select ${l.name || "unnamed"}`);
      cb.onchange = () => { cb.checked ? checked.add(l.id) : checked.delete(l.id); $("osCount").textContent = `${lineups.length} official lineups · ${checked.size} selected`; };
      const name = document.createElement("span");
      name.className = "os-name";
      name.textContent = `${l.name || "Unnamed position"} · ${TYPE_LABELS[l.type] || l.type}`;
      li.append(cb, name, sideSegment(SIDES, normalizeSide(l.side), async (v) => {
        try { await setSide([l.id], v); toast("Side saved"); } catch (e) { toastError("Couldn't save: " + e.message); load(); }
      }, { label: "Side" }));
      listEl.appendChild(li);
    });
  }

  $("osBulk").replaceChildren(...SIDES.map(s => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "ghost-btn"; b.textContent = s.label;
    b.onclick = async () => {
      if (!checked.size) { toast("Select some lineups first"); return; }
      try { await setSide([...checked], s.id); toast(`${checked.size} set to ${s.label}`); checked.clear(); draw(); }
      catch (e) { toastError("Couldn't save: " + e.message); }
    };
    return b;
  }));

  async function load() {
    checked.clear();
    try {
      const res = await fetch(`/api/lineups?mapId=${mapId}&t=${Date.now()}`);
      lineups = res.ok ? await res.json() : [];
    } catch { lineups = []; }
    draw();
  }
  mapSel.onchange = () => { mapId = mapSel.value; load(); };
  load();
}
