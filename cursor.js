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
    ".c-dot,.c-ring{position:fixed;top:0;left:0;z-index:2147483000;pointer-events:none;opacity:0;transition:opacity .25s;will-change:transform;contain:layout style}" +
    ".c-dot.is-on,.c-ring.is-on{opacity:1}" +
    ".c-dot.is-text,.c-ring.is-text{opacity:0!important}" +
    ".c-dot::before,.c-ring::before{content:'';position:absolute;border-radius:50%}" +
    /* Only transform/opacity are animated, so state changes run on the compositor and never trigger layout. */
    ".c-dot::before{width:7px;height:7px;margin:-3.5px 0 0 -3.5px;background:#ffa53e;transition:transform .3s cubic-bezier(.22,1,.36,1),opacity .3s}" +
    ".c-ring::before{width:36px;height:36px;margin:-18px 0 0 -18px;border:1.5px solid #ffa53e;transition:transform .45s cubic-bezier(.22,1,.36,1),background-color .3s,border-radius .3s}" +
    ".c-ring.is-link::before{transform:scale(1.6);background-color:rgba(255,165,62,.14)}" +
    ".c-dot.is-link::before{transform:scale(.4)}" +
    ".c-ring.is-down::before{transform:scale(.66)}" +
    ".c-ring.is-big::before{transform:scale(2.35);background-color:#ffa53e}" +
    ".c-dot.is-big::before{opacity:0}" +
    ".c-label{position:absolute;transform:translate(-50%,-50%);font:700 11px/1 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.1em;text-transform:uppercase;color:#1a150f;white-space:nowrap;opacity:0;transition:opacity .25s}" +
    ".c-ring.is-big .c-label{opacity:1}" +
    /* crosshair while placing a marker; rounded box while the map is zoomed */
    ".c-ring.is-cross::before{transform:scale(1.2)}" +
    ".c-ring.is-cross::after{content:'';position:absolute;width:60px;height:60px;margin:-30px 0 0 -30px;background:linear-gradient(#ffa53e,#ffa53e) center/1.5px 100% no-repeat,linear-gradient(#ffa53e,#ffa53e) center/100% 1.5px no-repeat;opacity:.8}" +
    ".c-ring.is-grab::before{border-radius:12px}" +
    /* subtle magnifier: a scaled copy of the hovered control shown inside the ring */
    ".c-lens{position:absolute;left:-29px;top:-29px;width:58px;height:58px;border-radius:50%;overflow:hidden;opacity:0;transform:scale(.6);background:rgba(14,11,9,.9);transition:opacity .3s,transform .45s cubic-bezier(.22,1,.36,1)}" +
    ".c-ring.has-lens .c-lens{opacity:1;transform:scale(1)}" +
    ".c-lens-inner{position:absolute;left:29px;top:29px;width:0;height:0;transform-origin:0 0}" +
    ".c-lens-inner *{pointer-events:none!important;transition:none!important;animation:none!important}";
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
  var lens = document.createElement("div");
  var lensInner = document.createElement("div");
  lens.className = "c-lens";
  lensInner.className = "c-lens-inner";
  lens.appendChild(lensInner);
  ring.insertBefore(lens, label);
  document.body.append(ring, dot);

  var tx = -100, ty = -100, rx = -100, ry = -100, raf = 0, seen = false, lastTarget = null;

  // Hit-testing and class toggling only run when the element under the pointer
  // changes (pointerover), not on every mouse move.
  var MAG = 1.14;
  var lensSource = null, lensRect = null, aliveUntil = 0;

  function setLens(el) {
    if (el === lensSource) return;
    lensSource = el;
    lensInner.textContent = "";
    ring.classList.remove("has-lens");
    if (!el) return;
    var r = el.getBoundingClientRect();
    if (r.width > 320 || r.height > 90 || r.width < 8) { lensSource = null; return; }
    var clone = el.cloneNode(true);
    // Computed styles are copied node by node so the copy looks identical outside its original ancestors.
    var src = [el].concat([].slice.call(el.querySelectorAll("*")));
    var dst = [clone].concat([].slice.call(clone.querySelectorAll("*")));
    for (var i = 0; i < src.length && i < dst.length; i++) {
      var cs = getComputedStyle(src[i]);
      for (var k = 0; k < cs.length; k++) {
        var p = cs[k];
        if (p === "transition" || p === "animation" || p.indexOf("transition") === 0 || p.indexOf("animation") === 0) continue;
        dst[i].style.setProperty(p, cs.getPropertyValue(p));
      }
      dst[i].removeAttribute("id");
    }
    clone.setAttribute("aria-hidden", "true");
    clone.removeAttribute("href");
    var s = clone.style;
    s.position = "absolute"; s.left = "0"; s.top = "0"; s.margin = "0";
    s.width = r.width + "px"; s.height = r.height + "px";
    s.transform = "none"; s.translate = "none"; s.opacity = "1"; s.boxSizing = "border-box";
    lensInner.appendChild(clone);
    lensRect = r;
    ring.classList.add("has-lens");
  }

  function placeLens() {
    if (!lensSource) return;
    var r = lensSource.getBoundingClientRect();
    lensInner.style.transform = "scale(" + MAG + ") translate(" + (r.left - rx).toFixed(1) + "px," + (r.top - ry).toFixed(1) + "px)";
  }

  function state(t) {
    if (!t || !t.closest) return;
    var isText = !!t.closest(TEXT);
    dot.classList.toggle("is-text", isText);
    ring.classList.toggle("is-text", isText);
    var cur = t.closest("[data-cursor]");
    var link = !!t.closest(LINK) || !!cur;
    ring.classList.toggle("is-link", link);
    dot.classList.toggle("is-link", link);
    ring.classList.toggle("is-big", !!cur);
    setLens(!cur && link ? t.closest(LINK) : null);
    aliveUntil = performance.now() + 700; // keep the lens tracking through hover animations
    dot.classList.toggle("is-big", !!cur);
    if (cur) label.textContent = cur.getAttribute("data-cursor");
    ring.classList.toggle("is-cross", !!t.closest(".map-frame.add-mode"));
    var stage = t.closest(".map-stage");
    ring.classList.toggle("is-grab", !!stage && stage.style.cursor === "grab" && !link);
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
  window.addEventListener("pointerdown", function () {
    ring.classList.add("is-down");
    state(lastTarget); // zoom/add-mode may have changed the cursor style
  });
  window.addEventListener("pointerup", function () {
    ring.classList.remove("is-down");
    state(lastTarget);
  });
  // A hidden tab pauses rAF; resync so the ring does not resume from a stale spot.
  document.addEventListener("visibilitychange", function () { rx = tx; ry = ty; });

  function loop() {
    // Frame-rate independent smoothing so the ring keeps pace even on dropped frames.
    rx += (tx - rx) * 0.22;
    ry += (ty - ry) * 0.22;
    var settled = Math.abs(tx - rx) < 0.1 && Math.abs(ty - ry) < 0.1;
    if (settled) { rx = tx; ry = ty; }
    dot.style.transform = "translate3d(" + tx + "px," + ty + "px,0)";
    ring.style.transform = "translate3d(" + rx.toFixed(1) + "px," + ry.toFixed(1) + "px,0)";
    placeLens();
    raf = (settled && performance.now() > aliveUntil) ? 0 : requestAnimationFrame(loop);
  }
})();
