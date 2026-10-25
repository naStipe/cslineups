// Admin tool: draw the named areas (A Site, Mid, B Site, …) on each radar.
// Click on the radar to add a corner to the selected area, drag a corner to
// move it, double-click a corner to delete it. Saves one map at a time through
// PUT /api/areas. Coordinates are percent of the radar image, the same space
// as lineup positions.
import { MAPS } from "./constants.js";
import { confirmDialog } from "./confirm-dialog.js";
import { toast, toastError } from "./toast.js";
import { escapeHtml } from "./html-utils.js";

const SVG_NS = "http://www.w3.org/2000/svg";

export function mountAreaEditor(root, authHeaders) {
  let mapId = MAPS[0].id;
  let levelId = "top";
  let areas = [];      // [{level, kind:"area", slug, name, sort, polygon}]
  let selected = null; // index into areas
  let dirty = false;

  root.innerHTML = `
    <div class="ae-bar">
      <select class="area-select" id="aeMap" aria-label="Map"></select>
      <div class="side-seg" id="aeLevels" role="radiogroup" aria-label="Radar level" hidden></div>
      <input type="text" class="area-select" id="aeName" maxlength="40" placeholder="New area name" aria-label="New area name">
      <button type="button" class="ghost-btn" id="aeNew">Add area</button>
      <button type="button" class="primary-btn" id="aeSave">Save map</button>
    </div>
    <div class="ae-body">
      <ul class="ae-list" id="aeList"></ul>
      <div class="ae-stage" id="aeStage"><img id="aeImg" alt="Radar"><svg id="aeSvg" viewBox="0 0 100 100" preserveAspectRatio="none"></svg></div>
    </div>
    <p class="admin-hint">Click the radar to add a corner · drag a corner to move it · double-click a corner to remove it.</p>`;

  const $ = (id) => root.querySelector("#" + id);
  const mapSel = $("aeMap"), levelsEl = $("aeLevels"), listEl = $("aeList"), img = $("aeImg"), svg = $("aeSvg"), saveBtn = $("aeSave");
  mapSel.innerHTML = MAPS.map(m => `<option value="${m.id}">${escapeHtml(m.name)}</option>`).join("");

  const mapDef = () => MAPS.find(m => m.id === mapId);
  const levelAreas = () => areas.map((a, i) => ({ a, i })).filter(({ a }) => a.level === levelId);

  async function load() {
    const m = mapDef();
    levelId = m.levels ? m.levels[0].id : "top";
    try {
      const res = await fetch(`/api/areas?mapId=${mapId}&t=${Date.now()}`);
      const rows = res.ok ? await res.json() : [];
      areas = rows.filter(r => r.kind === "area").map(r => ({ level: r.level, kind: "area", slug: r.slug, name: r.name, sort: r.sort, polygon: r.polygon || [] }));
      // Callout rows aren't editable here yet; keep them so saving doesn't drop them.
      areas.callouts = rows.filter(r => r.kind === "callout");
    } catch { areas = []; toastError("Couldn't load the areas."); }
    selected = null; dirty = false;
    draw();
  }

  function draw() {
    const m = mapDef();
    const level = m.levels ? m.levels.find(l => l.id === levelId) : null;
    img.src = "/" + (level ? level.file : m.file);

    levelsEl.hidden = !m.levels;
    levelsEl.innerHTML = (m.levels || []).map(l =>
      `<button type="button" class="side-seg-btn${l.id === levelId ? " active" : ""}" data-level="${l.id}" role="radio" aria-checked="${l.id === levelId}">${escapeHtml(l.label)}</button>`).join("");
    levelsEl.querySelectorAll("button").forEach(b => b.onclick = () => { levelId = b.dataset.level; selected = null; draw(); });

    listEl.innerHTML = "";
    levelAreas().forEach(({ a, i }) => {
      const li = document.createElement("li");
      li.className = "ae-item" + (i === selected ? " active" : "");
      li.innerHTML = `<button type="button" class="ae-pick">${escapeHtml(a.name)} <small>${a.polygon.length} pts</small></button>
        <button type="button" class="icon-btn ae-del" aria-label="Delete ${escapeHtml(a.name)}">✕</button>`;
      li.querySelector(".ae-pick").onclick = () => { selected = i; draw(); };
      li.querySelector(".ae-del").onclick = async () => {
        if (!(await confirmDialog({ title: `Delete “${a.name}”?`, body: "It is removed when you save the map.", confirmLabel: "Delete", danger: true }))) return;
        areas.splice(i, 1); selected = null; dirty = true; draw();
      };
      listEl.appendChild(li);
    });
    if (!listEl.children.length) listEl.innerHTML = `<li class="ae-empty">No areas on this level yet.</li>`;

    svg.innerHTML = "";
    levelAreas().forEach(({ a, i }) => {
      const on = i === selected;
      if (a.polygon.length >= 2) {
        const poly = document.createElementNS(SVG_NS, a.polygon.length >= 3 ? "polygon" : "polyline");
        poly.setAttribute("points", a.polygon.map(p => `${p.x},${p.y}`).join(" "));
        poly.setAttribute("class", "ae-poly" + (on ? " active" : ""));
        poly.onclick = (e) => { e.stopPropagation(); selected = i; draw(); };
        svg.appendChild(poly);
      }
      if (on) a.polygon.forEach((p, pi) => svg.appendChild(vertex(a, p, pi)));
    });
  }

  function toPct(e) {
    const r = svg.getBoundingClientRect();
    return { x: Math.min(100, Math.max(0, +(((e.clientX - r.left) / r.width) * 100).toFixed(2))), y: Math.min(100, Math.max(0, +(((e.clientY - r.top) / r.height) * 100).toFixed(2))) };
  }

  function vertex(area, p, pi) {
    const c = document.createElementNS(SVG_NS, "circle");
    c.setAttribute("cx", p.x); c.setAttribute("cy", p.y); c.setAttribute("r", 0.9);
    c.setAttribute("class", "ae-vertex");
    c.onpointerdown = (e) => {
      e.stopPropagation();
      c.setPointerCapture(e.pointerId);
      c.onpointermove = (ev) => {
        const q = toPct(ev); area.polygon[pi] = q; dirty = true;
        c.setAttribute("cx", q.x); c.setAttribute("cy", q.y);
        const poly = svg.querySelector(".ae-poly.active");
        if (poly) poly.setAttribute("points", area.polygon.map(v => `${v.x},${v.y}`).join(" "));
      };
      c.onpointerup = () => { c.onpointermove = null; c.onpointerup = null; };
    };
    c.ondblclick = (e) => { e.stopPropagation(); area.polygon.splice(pi, 1); dirty = true; draw(); };
    return c;
  }

  svg.onclick = (e) => {
    if (selected == null) { toast("Select or create an area first"); return; }
    areas[selected].polygon.push(toPct(e));
    dirty = true; draw();
  };

  $("aeNew").onclick = () => {
    const nameInput = $("aeName");
    const name = nameInput.value.trim().slice(0, 40);
    if (!name) { nameInput.focus(); return; }
    nameInput.value = "";
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "area";
    if (areas.some(a => a.slug === slug && a.level === levelId)) { toastError("An area with that name already exists on this level."); return; }
    areas.push({ level: levelId, kind: "area", slug, name, sort: areas.length + 1, polygon: [] });
    selected = areas.length - 1; dirty = true; draw();
  };

  $("aeName").onkeydown = (e) => { if (e.key === "Enter") $("aeNew").click(); };

  mapSel.onchange = async () => {
    if (dirty && !(await confirmDialog({ title: "Discard unsaved changes?", body: "Switching maps drops the edits to this one.", confirmLabel: "Discard", danger: true }))) { mapSel.value = mapId; return; }
    mapId = mapSel.value; load();
  };

  saveBtn.onclick = async () => {
    const bad = areas.find(a => a.polygon.length < 3);
    if (bad) { toastError(`“${bad.name}” needs at least 3 corners (or delete it).`); return; }
    saveBtn.disabled = true;
    try {
      const body = { areas: [...areas.map((a, i) => ({ ...a, sort: i + 1 })), ...(areas.callouts || [])] };
      const res = await fetch(`/api/areas?mapId=${mapId}`, {
        method: "PUT", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.status);
      dirty = false; toast("Areas saved");
    } catch (e) { toastError("Couldn't save: " + e.message); }
    saveBtn.disabled = false;
  };

  load();
}
