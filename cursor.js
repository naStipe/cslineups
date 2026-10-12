// Site-wide custom cursor: a dot that tracks the pointer exactly plus a ring that
// trails behind and swells over interactive elements. Replaces the OS cursor on
// mouse devices. Self-contained (injects its own CSS) so every page — SPA, blog,
// legal and server-rendered pages — can load it with one <script defer> tag.
// Skipped for touch devices and reduced motion, where the native cursor stays.
(function () {
  if (!window.matchMedia) return;
  if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  var root = document.documentElement;
  var LINK = "a, button, [role='button'], label[for], summary, .marker, .map-item, .lineup-item, .filter-chip, .map-card, .lightbox-nav, .tm-upload-trigger";
  var TEXT = "input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=button]):not([type=submit]), textarea, select, [contenteditable='true']";

  var css = document.createElement("style");
  css.textContent =
    "html.has-cursor,html.has-cursor *{cursor:none!important}" +
    "html.has-cursor :is(" + TEXT + "){cursor:text!important}" +
    "html.has-cursor select{cursor:default!important}" +
    ".c-dot,.c-ring{position:fixed;top:0;left:0;z-index:2147483000;pointer-events:none;opacity:0;transition:opacity .25s}" +
    ".c-dot.is-on,.c-ring.is-on{opacity:1}" +
    ".c-dot.is-text,.c-ring.is-text{opacity:0!important}" +
    ".c-dot::before,.c-ring::before{content:'';position:absolute;border-radius:50%}" +
    ".c-dot::before{width:7px;height:7px;margin:-3.5px 0 0 -3.5px;background:#ffa53e;box-shadow:0 0 12px rgba(255,165,62,.7);transition:transform .3s cubic-bezier(.22,1,.36,1),opacity .3s}" +
    ".c-ring::before{width:36px;height:36px;margin:-18px 0 0 -18px;border:1.5px solid #ffa53e;transition:width .45s cubic-bezier(.22,1,.36,1),height .45s cubic-bezier(.22,1,.36,1),margin .45s cubic-bezier(.22,1,.36,1),background .3s,border-color .3s,border-radius .3s}" +
    ".c-ring.is-link::before{width:58px;height:58px;margin:-29px 0 0 -29px;background:rgba(255,165,62,.14)}" +
    ".c-dot.is-link::before{transform:scale(.4)}" +
    ".c-ring.is-down::before{width:24px;height:24px;margin:-12px 0 0 -12px}" +
    ".c-ring.is-big::before{width:84px;height:84px;margin:-42px 0 0 -42px;background:#ffa53e}" +
    ".c-dot.is-big::before{opacity:0}" +
    ".c-label{position:absolute;transform:translate(-50%,-50%);font:700 11px/1 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.1em;text-transform:uppercase;color:#1a150f;white-space:nowrap;opacity:0;transition:opacity .25s}" +
    ".c-ring.is-big .c-label{opacity:1}" +
    /* crosshair while placing a marker; grab while the map is zoomed */
    ".c-ring.is-cross::before{width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;background:radial-gradient(circle,transparent 0 3px,rgba(255,165,62,.0) 3px)}" +
    ".c-ring.is-cross::after{content:'';position:absolute;width:60px;height:60px;margin:-30px 0 0 -30px;background:linear-gradient(#ffa53e,#ffa53e) center/1.5px 100% no-repeat,linear-gradient(#ffa53e,#ffa53e) center/100% 1.5px no-repeat;opacity:.8}" +
    ".c-ring.is-grab::before{border-radius:12px}";
  document.head.appendChild(css);
  root.classList.add("has-cursor");

  var dot = document.createElement("div");
  var ring = document.createElement("div");
  var label = document.createElement("span");
  dot.className = "c-dot";
  ring.className = "c-ring";
  label.className = "c-label";
  dot.setAttribute("aria-hidden", "true");
  ring.setAttribute("aria-hidden", "true");
  ring.appendChild(label);
  document.body.append(ring, dot);

  var tx = -100, ty = -100, rx = -100, ry = -100, raf = 0, seen = false;

  function state(e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var isText = !!t.closest(TEXT);
    dot.classList.toggle("is-text", isText);
    ring.classList.toggle("is-text", isText);
    var cur = t.closest("[data-cursor]");
    var link = !!t.closest(LINK) || !!cur;
    ring.classList.toggle("is-link", link);
    dot.classList.toggle("is-link", link);
    var big = !!cur;
    ring.classList.toggle("is-big", big);
    dot.classList.toggle("is-big", big);
    if (big) label.textContent = cur.getAttribute("data-cursor");
    ring.classList.toggle("is-cross", !!t.closest(".map-frame.add-mode, .addflow-active"));
    var stage = t.closest(".map-stage");
    ring.classList.toggle("is-grab", !!stage && stage.style.cursor === "grab" && !link);
  }

  window.addEventListener("pointermove", function (e) {
    if (e.pointerType && e.pointerType !== "mouse") return;
    tx = e.clientX; ty = e.clientY;
    dot.style.transform = "translate3d(" + tx + "px," + ty + "px,0)";
    if (!seen) { seen = true; rx = tx; ry = ty; }
    dot.classList.add("is-on");
    ring.classList.add("is-on");
    state(e);
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

  function loop() {
    rx += (tx - rx) * 0.17;
    ry += (ty - ry) * 0.17;
    ring.style.transform = "translate3d(" + rx.toFixed(1) + "px," + ry.toFixed(1) + "px,0)";
    if (Math.abs(tx - rx) > 0.1 || Math.abs(ty - ry) > 0.1) raf = requestAnimationFrame(loop);
    else raf = 0;
  }
})();
