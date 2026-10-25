// Hover preview for landing markers (mouse devices only): after a short
// delay, a small card shows the lineup's name, type, variant count and its
// result screenshot (or the first screenshot). Purely informational and
// pointer-events:none, so it never gets in the way of clicking the marker.
import { TYPES } from "./constants.js";
import { markerLayer } from "./dom.js";
import { escapeHtml } from "./html-utils.js";
import { hydrateImages } from "./private-images.js";
import { state } from "./state.js";

const DELAY_MS = 250;
const canHover = window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches;

let card = null;
let timer = null;
let currentEl = null;

function firstImage(lineup) {
  for (const t of lineup.throws) {
    const url = t.result || (t.screenshots && t.screenshots[0]) || (t.standing && t.standing[0]) || t.precise;
    if (url) return url;
  }
  return null;
}

function hide() {
  clearTimeout(timer);
  timer = null;
  currentEl = null;
  if (card) card.classList.remove("show");
}

function show(el, lineup) {
  if (!card) {
    card = document.createElement("div");
    card.className = "marker-preview";
    card.setAttribute("aria-hidden", "true");
    document.body.appendChild(card);
  }
  const type = TYPES.find(t => t.id === lineup.type);
  const img = firstImage(lineup);
  const n = lineup.throws.length;
  card.innerHTML =
    (img ? `<img data-real-src="${escapeHtml(img)}" alt="">` : "") +
    `<div class="marker-preview-name">${escapeHtml(lineup.name || "Unnamed position")}</div>` +
    `<div class="marker-preview-meta">${escapeHtml(type ? type.label : lineup.type)} · ${n} variant${n === 1 ? "" : "s"}</div>`;
  hydrateImages(card);

  // Sit to the right of the marker, flipping left / clamping so it stays on screen.
  const r = el.getBoundingClientRect();
  const w = 220, h = card.offsetHeight || 170, gap = 14;
  let x = r.right + gap;
  if (x + w > window.innerWidth - 8) x = r.left - gap - w;
  x = Math.max(8, x);
  const y = Math.min(Math.max(8, r.top + r.height / 2 - h / 2), window.innerHeight - h - 8);
  card.style.left = x + "px";
  card.style.top = y + "px";
  card.classList.add("show");
}

if (canHover) {
  markerLayer.addEventListener("mouseover", (e) => {
    const el = e.target.closest(".marker.landing[data-lid]");
    if (el === currentEl) return;
    hide();
    if (!el || state.addMode || state.reposition) return;
    currentEl = el;
    timer = setTimeout(() => {
      const lineup = state.lineups.find(l => l.id === el.dataset.lid);
      if (lineup && el.isConnected) show(el, lineup);
    }, DELAY_MS);
  });
  markerLayer.addEventListener("mouseleave", hide);
  markerLayer.addEventListener("mousedown", hide);
  window.addEventListener("wheel", hide, { passive: true });
}
