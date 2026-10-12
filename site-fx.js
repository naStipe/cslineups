// Light effects for the static pages (blog, legal, /maps, lineup pages):
// scroll progress bar, sticky-header state and scroll reveals.
// Progressive enhancement: skipped entirely when reduced motion is requested.
(function () {
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  var root = document.documentElement;
  root.classList.add("fx");

  var bar = document.createElement("div");
  bar.className = "fx-progress";
  bar.setAttribute("aria-hidden", "true");
  document.body.appendChild(bar);
  var head = document.querySelector(".site-head");
  var ticking = false;
  function update() {
    ticking = false;
    var max = root.scrollHeight - window.innerHeight;
    bar.style.transform = "scaleX(" + (max > 0 ? Math.min(1, window.scrollY / max) : 0) + ")";
    if (head) head.classList.toggle("is-scrolled", window.scrollY > 8);
  }
  window.addEventListener("scroll", function () {
    if (!ticking) { ticking = true; requestAnimationFrame(update); }
  }, { passive: true });
  update();

  if (!("IntersectionObserver" in window)) return;
  var targets = document.querySelectorAll(
    "main > h1, main > h2, main > h3, main > p, main > ul, main > ol, main > .cta, main > .lede, " +
    ".map-card-item, .throw, ul.plain > li, .shots figure, .crumbs"
  );
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); }
    });
  }, { threshold: 0.08, rootMargin: "0px 0px -4% 0px" });
  Array.prototype.forEach.call(targets, function (el) {
    var siblings = el.parentElement ? el.parentElement.children : [];
    var idx = Array.prototype.indexOf.call(siblings, el);
    el.style.setProperty("--d", Math.min(idx, 8) * 60 + "ms");
    el.classList.add("fx-rv");
    io.observe(el);
  });
})();
