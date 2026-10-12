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
    ".c-lens{position:absolute;left:-29px;top:-29px;width:58px;height:58px;border-radius:50%;overflow:hidden;opacity:0;transform:scale(.6);background:rgba(14,11,9,.94);transition:opacity .3s,transform .45s cubic-bezier(.22,1,.36,1)}" +
    ".c-ring.has-lens .c-lens{opacity:1;transform:scale(.62)}" +
    ".c-ring.is-link.has-lens .c-lens{transform:scale(1)}" +
    ".c-ring.is-down.has-lens .c-lens{transform:scale(.42)}" +
    ".c-ring.is-big .c-lens{opacity:0}" +
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
  var MAG = 1.2;
  var lensSource = null, lensScale = 1, aliveUntil = 0, refreshTimer = 0;
  // Only layout/paint-relevant properties are copied (not the full ~350), so building a copy stays cheap.
  var PROPS = ["display","position","box-sizing","width","height","min-width","min-height","max-width","max-height",
    "top","left","right","bottom","margin","padding","border","border-radius","outline","background","background-color",
    "background-image","background-size","background-position","background-repeat","background-clip","color","opacity",
    "font-family","font-size","font-weight","font-style","font-stretch","line-height","letter-spacing","text-transform",
    "text-align","text-decoration","text-shadow","-webkit-text-stroke","-webkit-text-fill-color","white-space","overflow",
    "text-overflow","flex","flex-direction","flex-wrap","align-items","justify-content","gap","grid-template-columns",
    "grid-template-rows","z-index","transform","transform-origin","translate","scale","rotate","box-shadow","filter","clip-path",
    "object-fit","object-position","fill","stroke","stroke-width","stroke-dasharray","stroke-linecap","vertical-align",
    "list-style","visibility","aspect-ratio","mix-blend-mode","-webkit-background-clip"];

  // Picks what to magnify: the whole map frame (radar + markers), otherwise the largest
  // modest-sized ancestor of the hovered element so the lens shows real surrounding context.
  function pickSource(t) {
    var frame = t.closest(".map-frame");
    if (frame) return frame;
    var best = t, el = t;
    for (var i = 0; i < 5; i++) {
      var p = el.parentElement;
      if (!p || p === document.body || p === document.documentElement) break;
      var r = p.getBoundingClientRect();
      if (r.width > 520 || r.height > 300 || p.getElementsByTagName("*").length > 220) break;
      best = p; el = p;
    }
    return best;
  }

  function buildLens(el) {
    lensInner.textContent = "";
    var w = el.offsetWidth, h = el.offsetHeight, r = el.getBoundingClientRect();
    if (!w || !h) { w = r.width; h = r.height; }
    if (!w || !h || el.getElementsByTagName("*").length > 700) { lensSource = null; ring.classList.remove("has-lens"); return; }
    lensScale = r.width / w || 1;
    var clone = el.cloneNode(true);
    var src = [el].concat([].slice.call(el.querySelectorAll("*")));
    var dst = [clone].concat([].slice.call(clone.querySelectorAll("*")));
    for (var i = 0; i < src.length && i < dst.length; i++) {
      var d = dst[i];
      if (d.tagName === "IFRAME" || d.tagName === "SCRIPT" || d.tagName === "VIDEO" || d.tagName === "CANVAS") { d.remove(); continue; }
      var cs = getComputedStyle(src[i]);
      for (var k = 0; k < PROPS.length; k++) d.style.setProperty(PROPS[k], cs.getPropertyValue(PROPS[k]));
      var pos = cs.position;
      if (pos === "fixed" || pos === "sticky") d.style.position = "absolute";
      d.removeAttribute("id");
      d.removeAttribute("href");
      d.removeAttribute("loading");
    }
    clone.setAttribute("aria-hidden", "true");
    var s = clone.style;
    s.position = "absolute"; s.left = "0"; s.top = "0"; s.margin = "0"; s.transform = "none"; s.translate = "none";
    s.width = w + "px"; s.height = h + "px"; s.opacity = "1"; s.transformOrigin = "0 0";
    lensInner.appendChild(clone);
    ring.classList.add("has-lens");
  }

  function setLens(el) {
    if (el === lensSource) return;
    lensSource = el;
    clearInterval(refreshTimer);
    if (!el) { lensInner.textContent = ""; ring.classList.remove("has-lens"); return; }
    buildLens(el);
    // Rebuild periodically so hover states, markers and animations in the copy stay current.
    refreshTimer = setInterval(function () { if (lensSource && seen) buildLens(lensSource); }, 700);
  }

  function placeLens() {
    if (!lensSource) return;
    var r = lensSource.getBoundingClientRect();
    lensInner.style.transform = "scale(" + MAG + ") translate(" + (r.left - rx).toFixed(1) + "px," + (r.top - ry).toFixed(1) + "px) scale(" + lensScale + ")";
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
    setLens(cur || isText ? null : pickSource(t));
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
