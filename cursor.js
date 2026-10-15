// Custom cursor for the landing screens only: the home hero (/) and the map
// picker (/maps). A dot that tracks the pointer plus a ring that trails behind
// and swells over links. Everywhere else — the map app, lineup dossiers,
// dialogs, blog and legal pages — the native OS cursor is used: a cursor drawn
// by the page always lands at least a frame behind the hardware cursor, which
// feels laggy where precise clicks matter.
// Loaded only by index.html and the /maps page. Skipped for touch devices and
// reduced motion.
(function () {
  if (!window.matchMedia) return;
  if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  var home = document.querySelector(".home-screen");
  if (!home) return;

  var root = document.documentElement;
  var LINK = "a, button, [role='button'], label[for], summary, .map-card";
  var TEXT = "input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=button]):not([type=submit]), textarea, select, [contenteditable='true']";
  // An open dialog (sign-in, cookie banner...) always gets the native cursor.
  var NATIVE = ".modal-backdrop.show, .modal-backdrop.show *, #consentBanner, #consentBanner *";

  var css = document.createElement("style");
  css.textContent =
    "html.has-cursor,html.has-cursor *{cursor:none!important}" +
    "html.has-cursor :is(" + TEXT + "){cursor:text!important}" +
    ".c-dot,.c-ring{position:fixed;top:0;left:0;z-index:2147483000;pointer-events:none;opacity:0;transition:opacity .2s;will-change:transform;contain:layout style}" +
    "html.has-cursor .c-dot.is-on,html.has-cursor .c-ring.is-on{opacity:1}" +
    ".c-dot.is-text,.c-ring.is-text{opacity:0!important}" +
    ".c-dot::before,.c-ring::before{content:'';position:absolute;border-radius:50%}" +
    ".c-dot::before{width:7px;height:7px;margin:-3.5px 0 0 -3.5px;background:#ffa53e;transition:transform .25s cubic-bezier(.22,1,.36,1),opacity .25s}" +
    ".c-ring::before{width:32px;height:32px;margin:-16px 0 0 -16px;border:1.5px solid #ffa53e;transition:transform .35s cubic-bezier(.22,1,.36,1),background-color .25s}" +
    ".c-ring.is-link::before{transform:scale(1.5);background-color:rgba(255,165,62,.14)}" +
    ".c-dot.is-link::before{transform:scale(.4)}" +
    ".c-ring.is-down::before{transform:scale(.7)}";
  document.head.appendChild(css);

  var dot = document.createElement("div");
  var ring = document.createElement("div");
  dot.className = "c-dot";
  ring.className = "c-ring";
  dot.setAttribute("aria-hidden", "true");
  ring.setAttribute("aria-hidden", "true");
  document.body.append(ring, dot);

  var tx = -100, ty = -100, rx = -100, ry = -100, raf = 0, seen = false, lastTarget = null;

  // On / the SPA hides the home screen when a map opens (or on a ?map= deep
  // link); the custom cursor follows it and switches off.
  function homeVisible() {
    return getComputedStyle(home).display !== "none";
  }

  // The has-cursor class is the single switch: without it the OS cursor shows
  // and the dot/ring are invisible, so the pointer can never vanish.
  function state(t) {
    var on = seen && homeVisible() && !(t && t.closest && t.closest(NATIVE));
    root.classList.toggle("has-cursor", on);
    if (!on || !t || !t.closest) return;
    var isText = !!t.closest(TEXT);
    dot.classList.toggle("is-text", isText);
    ring.classList.toggle("is-text", isText);
    var link = !!t.closest(LINK);
    ring.classList.toggle("is-link", link);
    dot.classList.toggle("is-link", link);
  }

  document.addEventListener("pointerover", function (e) {
    if (e.pointerType && e.pointerType !== "mouse") return;
    lastTarget = e.target;
    state(lastTarget);
    if (!raf) raf = requestAnimationFrame(loop);
  }, { passive: true });

  // Position writes happen once per frame, inside rAF, never inside the event.
  window.addEventListener("pointermove", function (e) {
    if (e.pointerType && e.pointerType !== "mouse") return;
    tx = e.clientX; ty = e.clientY;
    if (!seen) {
      seen = true; rx = tx; ry = ty;
      dot.classList.add("is-on"); ring.classList.add("is-on");
      state(e.target);
    }
    if (!raf) raf = requestAnimationFrame(loop);
  }, { passive: true });

  document.addEventListener("mouseleave", function () {
    dot.classList.remove("is-on");
    ring.classList.remove("is-on");
  });
  document.addEventListener("mouseenter", function () {
    if (seen) { dot.classList.add("is-on"); ring.classList.add("is-on"); }
  });
  window.addEventListener("pointerdown", function () { ring.classList.add("is-down"); });
  window.addEventListener("pointerup", function () { ring.classList.remove("is-down"); });
  // Clicks often open a dialog or leave the home screen under a still pointer,
  // so re-check right away (no pointerover fires until the mouse moves).
  document.addEventListener("click", function () {
    setTimeout(function () { if (seen) state(document.elementFromPoint(tx, ty)); }, 0);
  });
  window.addEventListener("popstate", function () {
    setTimeout(function () { state(document.elementFromPoint(tx, ty)); }, 0);
  });
  // A hidden tab pauses rAF; resync so the ring does not resume from a stale spot.
  document.addEventListener("visibilitychange", function () { rx = tx; ry = ty; });

  function loop() {
    rx += (tx - rx) * 0.3;
    ry += (ty - ry) * 0.3;
    var settled = Math.abs(tx - rx) < 0.1 && Math.abs(ty - ry) < 0.1;
    if (settled) { rx = tx; ry = ty; }
    dot.style.transform = "translate3d(" + tx + "px," + ty + "px,0)";
    ring.style.transform = "translate3d(" + rx.toFixed(1) + "px," + ry.toFixed(1) + "px,0)";
    raf = settled ? 0 : requestAnimationFrame(loop);
  }

  state(null);
})();
