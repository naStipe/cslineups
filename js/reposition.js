// Drag-to-reposition overlay on the full map. Two flavours:
//   • startReposition       — drag a single throw-from spot (landing fixed)
//   • startLandingReposition — drag the landing (all throw-from spots fixed,
//                              their link lines re-anchor live)
// Shared by the throw-creation modal, the dossier's "Reposition" button, and
// the sidebar lineup list's "Move landing" button. The caller supplies the
// coords + an onDone callback and handles persistence / returning to its own
// UI — this module just runs the drag interaction.
//
// Styling is keyed on fixed-vs-draggable, not landing-vs-throw: the draggable
// dot is always a filled disc with a ✥ move glyph + glow ("Drag me"), fixed
// dots are a hollow ring (landing) or a small filled dot (throw). So whichever
// marker you're moving reads as the active one.
import { linkSvg, mapImage, markerLayer, repositionBar, repositionCancel, repositionSave, repositionText } from "./dom.js";
import { getCssVarColor, typeColor } from "./markers.js";
import { state } from "./state.js";

const SVG_NS = "http://www.w3.org/2000/svg";
let active = null;

export function isRepositioning() { return !!active; }

export function startReposition({ typeId, landing, throwPos, onDone }) {
  start({
    typeId, landing, throws: [throwPos], drag: "throw", dragIdx: 0,
    text: "Drag the <b>throw</b> marker to where you throw from, then save.",
    onDone: (r) => onDone(r ? { throwPos: r.throws[0] } : null),
  });
}

export function startLandingReposition({ typeId, landing, throws, onDone }) {
  start({
    typeId, landing, throws: (throws || []).slice(), drag: "landing",
    text: "Drag the <b>landing</b> marker to where the nade lands, then save.",
    onDone: (r) => onDone(r ? { landing: r.landing } : null),
  });
}

function start({ typeId, landing, throws, drag, dragIdx, text, onDone }) {
  active = { landing: { ...landing }, throws: throws.map(t => ({ ...t })), onDone, lines: [] };
  state.reposition = true;

  // We own the marker/link layers while active; renderMarkers is guarded off
  // (state.reposition) so nothing clobbers what we draw here.
  markerLayer.innerHTML = "";
  linkSvg.innerHTML = "";

  const color = getCssVarColor(typeColor(typeId));

  // one link line per throw → landing
  active.throws.forEach(() => {
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("class", "link-line");
    line.setAttribute("stroke", color);
    line.style.color = color;
    linkSvg.appendChild(line);
    active.lines.push(line);
  });

  const landingDraggable = drag === "landing";
  active.landingDot = makeDot("is-landing", color, landingDraggable, "Lands here");
  if (landingDraggable) attachDrag(active.landingDot, (p) => { active.landing = p; });

  active.throwDots = active.throws.map((_, i) => {
    const draggable = drag === "throw" && i === dragIdx;
    const dot = makeDot("is-throw", color, draggable, active.throws.length > 1 ? `Throw ${i + 1}` : "Throw");
    if (draggable) attachDrag(dot, (p) => { active.throws[i] = p; });
    return dot;
  });

  update();
  if (repositionText) repositionText.innerHTML = text;
  repositionBar.hidden = false;
  document.addEventListener("keydown", onKey, true);
}

function makeDot(roleClass, color, draggable, fixedLabel) {
  const el = document.createElement("div");
  el.className = `repos-dot ${roleClass} ${draggable ? "is-drag draggable" : "is-fixed"}`;
  el.style.setProperty("--dot-color", color);
  const label = draggable ? "Drag me" : fixedLabel;
  el.innerHTML = `<span class="repos-label">${label}</span>${draggable ? `<span class="repos-glyph">✥</span>` : ""}`;
  markerLayer.appendChild(el);
  return el;
}

function update() {
  const { landing, throws, throwDots, landingDot, lines } = active;
  landingDot.style.left = landing.x + "%"; landingDot.style.top = landing.y + "%";
  throws.forEach((t, i) => {
    throwDots[i].style.left = t.x + "%"; throwDots[i].style.top = t.y + "%";
    lines[i].setAttribute("x1", t.x + "%"); lines[i].setAttribute("y1", t.y + "%");
    lines[i].setAttribute("x2", landing.x + "%"); lines[i].setAttribute("y2", landing.y + "%");
  });
}

function attachDrag(el, apply) {
  // Swallow mouse/touch starts so the map's own pan/pinch doesn't kick in
  // while grabbing the dot (those are separate event types from pointer*).
  ["mousedown", "touchstart"].forEach(ev => el.addEventListener(ev, e => e.stopPropagation()));

  el.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    el.classList.add("dragging");
    try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }

    const move = (ev) => {
      const rect = mapImage.getBoundingClientRect();
      apply({
        x: Math.max(0, Math.min(100, ((ev.clientX - rect.left) / rect.width) * 100)),
        y: Math.max(0, Math.min(100, ((ev.clientY - rect.top) / rect.height) * 100)),
      });
      update();
    };
    const up = () => {
      el.classList.remove("dragging");
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  });
}

function onKey(e) {
  if (e.key === "Escape") { e.stopPropagation(); finish(false); }
}

function finish(save) {
  if (!active) return;
  const { onDone, landing, throws } = active;
  document.removeEventListener("keydown", onKey, true);
  repositionBar.hidden = true;
  markerLayer.innerHTML = "";
  linkSvg.innerHTML = "";
  state.reposition = false;
  active = null;
  if (onDone) onDone(save ? { landing, throws } : null);
}

if (repositionSave) repositionSave.onclick = () => finish(true);
if (repositionCancel) repositionCancel.onclick = () => finish(false);
