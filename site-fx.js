// Light effects for the static pages (blog, legal, /maps, lineup pages):
// scroll progress bar, sticky-header state and scroll reveals.
// Progressive enhancement: skipped entirely when reduced motion is requested.
(function () {
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  var root = document.documentElement;
  // /maps reuses the SPA home-screen, which is its own scroll container
  var scroller = document.querySelector(".home-screen");
  // Reveal targets already on screen are shown at once, before html.fx
  // exists, so they never blink out and fade back in.
  var REVEAL = "main > h1, main > h2, main > h3, main > p, main > ul, main > ol, main > .cta, main > .lede, " +
    ".map-card-item, .throw, ul.plain > li, .shots figure, .crumbs, [data-reveal]";
  var viewH = window.innerHeight;
  Array.prototype.forEach.call(document.querySelectorAll(REVEAL), function (el) {
    if (el.getBoundingClientRect().top < viewH) el.classList.add("is-in");
  });
  root.classList.add("fx");

  var bar = document.createElement("div");
  bar.className = "fx-progress";
  bar.setAttribute("aria-hidden", "true");
  document.body.appendChild(bar);
  var head = document.querySelector(".site-head, .home-header");
  var ticking = false;
  function update() {
    ticking = false;
    var top = scroller ? scroller.scrollTop : window.scrollY;
    var max = scroller ? scroller.scrollHeight - scroller.clientHeight : root.scrollHeight - window.innerHeight;
    bar.style.transform = "scaleX(" + (max > 0 ? Math.min(1, top / max) : 0) + ")";
    if (head) head.classList.toggle("is-scrolled", top > 8);
  }
  (scroller || window).addEventListener("scroll", function () {
    if (!ticking) { ticking = true; requestAnimationFrame(update); }
  }, { passive: true });
  update();

  if (!("IntersectionObserver" in window)) return;
  var targets = document.querySelectorAll(REVEAL);
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); }
    });
  }, { root: scroller || null, threshold: 0.08, rootMargin: "0px 0px -4% 0px" });
  Array.prototype.forEach.call(targets, function (el) {
    var siblings = el.parentElement ? el.parentElement.children : [];
    var idx = Array.prototype.indexOf.call(siblings, el);
    el.style.setProperty("--d", Math.min(idx, 8) * 60 + "ms");
    el.classList.add("fx-rv");
    if (el.hasAttribute("data-reveal")) el.style.setProperty("--d", Math.min(idx, 11) * 70 + "ms");
    io.observe(el);
  });

  // Card spotlight + tilt (data-spot / data-tilt)
  if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
    document.addEventListener("pointermove", function (e) {
      var card = e.target.closest && e.target.closest("[data-spot]");
      if (!card) return;
      var r = card.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      card.style.setProperty("--mx", x + "px");
      card.style.setProperty("--my", y + "px");
      if (card.hasAttribute("data-tilt")) {
        card.style.setProperty("--rx", ((0.5 - y / r.height) * 7).toFixed(2) + "deg");
        card.style.setProperty("--ry", ((x / r.width - 0.5) * 9).toFixed(2) + "deg");
      }
    });
    document.addEventListener("pointerout", function (e) {
      var card = e.target.closest && e.target.closest("[data-tilt]");
      if (card && !card.contains(e.relatedTarget)) {
        card.style.setProperty("--rx", "0deg");
        card.style.setProperty("--ry", "0deg");
      }
    });
  }
})();
