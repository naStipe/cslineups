// One shared tooltip for the whole app. Any element with data-tip="Text"
// (optional data-tip-key="→" shown as <kbd>, data-tip-pos="top|bottom|left|right")
// gets one; elements created later by JS need no wiring (document-level
// delegation). Mouse: shown after a short hover. Keyboard: instantly on
// :focus-visible. Touch: no hover; a long-press shows it and swallows the click.
// Escape only hides the tip (it is never consumed), so js/shortcuts.js layers
// keep working. The tip lives on <body> with position:fixed, so no
// overflow:hidden ancestor can clip it.
//
//   import { setTip } from "./tooltip.js";   setTip(btn, "Open lineup", { key: "O" });

const HOVER_DELAY = 350;
const WARM_DELAY = 60;      // moving between neighbouring triggers feels instant
const LONG_PRESS = 500;
const TOUCH_SHOW_MS = 2500;
const MARGIN = 8;
const GAP = 9;

export function setTip(el, text, { key, pos } = {}) {
  if (!el) return el;
  if (text) el.dataset.tip = text; else delete el.dataset.tip;
  if (key) el.dataset.tipKey = key; else delete el.dataset.tipKey;
  if (pos) el.dataset.tipPos = pos; else delete el.dataset.tipPos;
  if (el.hasAttribute("title")) el.removeAttribute("title");
  return el;
}

let tipEl = null;
let current = null;       // trigger the tip is showing for
let showTimer = 0;
let hideTimer = 0;
let lastHiddenAt = 0;
let observer = null;
let pressTimer = 0;
let pressStart = null;
let swallowClick = false;
let swallowTimer = 0;
let describedBefore = null;

function ensureEl() {
  if (tipEl) return tipEl;
  tipEl = document.createElement("div");
  tipEl.className = "tooltip";
  tipEl.id = "appTooltip";
  tipEl.setAttribute("role", "tooltip");
  tipEl.innerHTML = '<span class="tooltip-text"></span><kbd class="tooltip-key" hidden></kbd><span class="tooltip-arrow"></span>';
  document.body.appendChild(tipEl);
  return tipEl;
}

function trigger(target) {
  return target instanceof Element ? target.closest("[data-tip]") : null;
}

function fill(el) {
  const t = ensureEl();
  t.querySelector(".tooltip-text").textContent = el.dataset.tip;
  const k = t.querySelector(".tooltip-key");
  const key = el.dataset.tipKey;
  k.hidden = !key;
  k.textContent = key || "";
}

function place(el) {
  const t = tipEl;
  const r = el.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  t.style.left = "0px"; t.style.top = "0px";
  const w = t.offsetWidth, h = t.offsetHeight;
  const room = {
    top: r.top - MARGIN, bottom: vh - r.bottom - MARGIN,
    left: r.left - MARGIN, right: vw - r.right - MARGIN,
  };
  const need = { top: h + GAP, bottom: h + GAP, left: w + GAP, right: w + GAP };
  const opposite = { top: "bottom", bottom: "top", left: "right", right: "left" };
  let pos = ["top", "bottom", "left", "right"].includes(el.dataset.tipPos) ? el.dataset.tipPos : "top";
  if (room[pos] < need[pos]) {
    const alt = opposite[pos];
    if (room[alt] >= need[alt]) pos = alt;
    else {
      // Neither fits: take the roomiest side so the tip never covers the trigger.
      pos = Object.keys(room).sort((a, b) => (room[b] - need[b]) - (room[a] - need[a]))[0];
    }
  }
  let x, y;
  if (pos === "top" || pos === "bottom") {
    x = r.left + r.width / 2 - w / 2;
    y = pos === "top" ? r.top - h - GAP : r.bottom + GAP;
  } else {
    y = r.top + r.height / 2 - h / 2;
    x = pos === "left" ? r.left - w - GAP : r.right + GAP;
  }
  x = Math.max(MARGIN, Math.min(x, vw - w - MARGIN));
  y = Math.max(MARGIN, Math.min(y, vh - h - MARGIN));
  t.style.left = Math.round(x) + "px";
  t.style.top = Math.round(y) + "px";
  t.dataset.pos = pos;
  // Point the arrow at the trigger's centre even when the tip was clamped.
  if (pos === "top" || pos === "bottom") {
    const ax = Math.max(10, Math.min(w - 10, r.left + r.width / 2 - x));
    t.style.setProperty("--arrow-x", ax + "px");
  } else {
    const ay = Math.max(10, Math.min(h - 10, r.top + r.height / 2 - y));
    t.style.setProperty("--arrow-y", ay + "px");
  }
}

function show(el, autoHideMs) {
  if (!el.isConnected || !el.dataset.tip) return;
  const rect = el.getBoundingClientRect();
  if (!rect.width && !rect.height) return;
  const again = current === el; // hover + focus on the same trigger: keep the original aria-describedby
  if (current && !again) release(current);
  current = el;
  fill(el);
  ensureEl().classList.remove("tooltip-show");
  place(el);
  // Next frame so the transition runs from the hidden state.
  requestAnimationFrame(() => { if (current === el) tipEl.classList.add("tooltip-show"); });
  if (!again) {
    describedBefore = el.getAttribute("aria-describedby");
    el.setAttribute("aria-describedby", describedBefore ? describedBefore + " appTooltip" : "appTooltip");
  }
  clearTimeout(hideTimer);
  if (autoHideMs) hideTimer = setTimeout(hide, autoHideMs);
  watch();
}

function release(el) {
  if (describedBefore) el.setAttribute("aria-describedby", describedBefore);
  else el.removeAttribute("aria-describedby");
  describedBefore = null;
}

export function hideTooltip() { hide(); }

function hide() {
  clearTimeout(showTimer); clearTimeout(hideTimer);
  if (observer) { observer.disconnect(); observer = null; }
  if (!current) return;
  release(current);
  current = null;
  lastHiddenAt = performance.now();
  if (tipEl) tipEl.classList.remove("tooltip-show");
}

// Hide when the trigger is re-rendered away; follow text edits while shown.
function watch() {
  if (observer) observer.disconnect();
  observer = new MutationObserver((records) => {
    if (records.every(r => tipEl && tipEl.contains(r.target))) return;
    if (!current || !current.isConnected || !current.dataset.tip) { hide(); return; }
    const r = current.getBoundingClientRect();
    if (!r.width && !r.height) { hide(); return; }
    fill(current); place(current);
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-tip", "data-tip-key", "hidden", "class"] });
}

function schedule(el) {
  clearTimeout(showTimer);
  const warm = performance.now() - lastHiddenAt < 300;
  showTimer = setTimeout(() => show(el), warm ? WARM_DELAY : HOVER_DELAY);
}

document.addEventListener("pointerover", (e) => {
  if (e.pointerType === "touch") return;
  const el = trigger(e.target);
  if (!el || el === current) return;
  if (el.contains(e.relatedTarget) && el === trigger(e.relatedTarget)) return;
  schedule(el);
});

document.addEventListener("pointerout", (e) => {
  if (e.pointerType === "touch") return;
  const el = trigger(e.target);
  if (!el) return;
  if (e.relatedTarget instanceof Node && el.contains(e.relatedTarget)) return;
  clearTimeout(showTimer);
  if (el === current) hide();
});

document.addEventListener("focusin", (e) => {
  const el = trigger(e.target);
  if (!el) return;
  let visible = false;
  try { visible = el.matches(":focus-visible"); } catch { visible = true; }
  if (visible) show(el);
});
document.addEventListener("focusout", hide);

// Touch long-press: shows the tip and swallows the click that follows.
document.addEventListener("pointerdown", (e) => {
  hide();
  clearTimeout(pressTimer);
  if (e.pointerType !== "touch") return;
  const el = trigger(e.target);
  if (!el) return;
  pressStart = { x: e.clientX, y: e.clientY };
  pressTimer = setTimeout(() => {
    pressTimer = 0;
    swallowClick = true;
    show(el, TOUCH_SHOW_MS);
  }, LONG_PRESS);
}, true);
document.addEventListener("pointermove", (e) => {
  if (!pressTimer || !pressStart) return;
  if (Math.hypot(e.clientX - pressStart.x, e.clientY - pressStart.y) > 10) { clearTimeout(pressTimer); pressTimer = 0; }
}, true);
const endPress = () => {
  clearTimeout(pressTimer); pressTimer = 0;
  if (swallowClick) { clearTimeout(swallowTimer); swallowTimer = setTimeout(() => { swallowClick = false; }, 600); }
};
document.addEventListener("pointerup", endPress, true);
document.addEventListener("pointercancel", () => { clearTimeout(pressTimer); pressTimer = 0; swallowClick = false; }, true);
document.addEventListener("click", (e) => {
  if (!swallowClick) return;
  swallowClick = false;
  e.preventDefault(); e.stopImmediatePropagation();
}, true);
document.addEventListener("contextmenu", (e) => {
  if ((pressTimer || swallowClick) && trigger(e.target)) e.preventDefault();
}, true);

document.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); }, true);
document.addEventListener("scroll", hide, true);
window.addEventListener("blur", hide);
window.addEventListener("resize", hide);
