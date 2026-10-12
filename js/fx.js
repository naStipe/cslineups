// Visual effects layer for the home / map-chooser screen: scroll progress bar,
// trailing cursor ring, magnetic buttons, word-mask headline, scroll reveals,
// parallax, card spotlight + tilt. Pure progressive enhancement: everything is
// gated on html.fx, which is only set when motion is allowed.

const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

function init() {
  const home = document.getElementById("homeScreen");
  if (!home || reduced) return;
  const root = document.documentElement;
  root.classList.add("fx");

  // ---- Scroll progress + parallax (home screen is the scroll container) ----
  const bar = document.createElement("div");
  bar.className = "fx-progress";
  bar.setAttribute("aria-hidden", "true");
  document.body.appendChild(bar);

  const header = home.querySelector(".home-header");
  const parallax = [...home.querySelectorAll("[data-parallax]")];
  let ticking = false;
  const update = () => {
    ticking = false;
    const max = home.scrollHeight - home.clientHeight;
    bar.style.transform = `scaleX(${max > 0 ? Math.min(1, home.scrollTop / max) : 0})`;
    if (header) header.classList.toggle("is-scrolled", home.scrollTop > 8);
    const vh = home.clientHeight;
    for (const el of parallax) {
      const r = el.getBoundingClientRect();
      if (r.bottom < -100 || r.top > vh + 100) continue;
      const p = (r.top + r.height / 2 - vh / 2) / (vh / 2 + r.height / 2);
      el.style.setProperty("--py", `${(-p * Number(el.dataset.parallax)).toFixed(1)}px`);
    }
  };
  home.addEventListener("scroll", () => {
    if (!ticking) { ticking = true; requestAnimationFrame(update); }
  }, { passive: true });
  window.addEventListener("resize", update);
  update();

  // ---- Hero headline: each word slides up out of a mask ----
  const title = home.querySelector(".hero-title");
  if (title && !title.dataset.split) {
    title.dataset.split = "1";
    const words = title.textContent.trim().split(/\s+/);
    title.setAttribute("aria-label", words.join(" "));
    title.textContent = "";
    words.forEach((w, i) => {
      const line = document.createElement("span");
      line.className = "fx-line";
      line.setAttribute("aria-hidden", "true");
      const word = document.createElement("span");
      word.className = "fx-word";
      word.style.setProperty("--i", i);
      word.textContent = w;
      line.appendChild(word);
      title.appendChild(line);
      title.appendChild(document.createTextNode(" "));
    });
  }

  // ---- Scroll reveals ----
  const targets = home.querySelectorAll("[data-reveal]");
  targets.forEach((el) => {
    const group = el.parentElement;
    const idx = [...group.children].filter((c) => c.hasAttribute("data-reveal")).indexOf(el);
    el.style.setProperty("--d", `${Math.max(0, idx) * 70}ms`);
  });
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); }
    }
  }, { root: home, threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
  targets.forEach((el) => io.observe(el));

  // ---- Count-up numbers ----
  home.querySelectorAll("[data-count]").forEach((el) => {
    const end = Number(el.dataset.count);
    const co = new IntersectionObserver((es) => {
      if (!es[0].isIntersecting) return;
      co.disconnect();
      const t0 = performance.now();
      const tick = (t) => {
        const k = Math.min(1, (t - t0) / 1400);
        el.textContent = Math.round(end * (1 - Math.pow(1 - k, 4)));
        if (k < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, { root: home, threshold: 0.6 });
    co.observe(el);
  });

  if (!finePointer) return;

  // ---- Card spotlight + 3D tilt ----
  home.addEventListener("pointermove", (e) => {
    const card = e.target.closest?.("[data-spot]");
    if (!card) return;
    const r = card.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    card.style.setProperty("--mx", `${x}px`);
    card.style.setProperty("--my", `${y}px`);
    if (card.hasAttribute("data-tilt")) {
      card.style.setProperty("--rx", `${((0.5 - y / r.height) * 6).toFixed(2)}deg`);
      card.style.setProperty("--ry", `${((x / r.width - 0.5) * 8).toFixed(2)}deg`);
    }
  });
  home.addEventListener("pointerout", (e) => {
    const card = e.target.closest?.("[data-tilt]");
    if (card && !card.contains(e.relatedTarget)) {
      card.style.setProperty("--rx", "0deg");
      card.style.setProperty("--ry", "0deg");
    }
  });

  // ---- Magnetic buttons ----
  const MAG = "[data-magnetic]";
  home.addEventListener("pointermove", (e) => {
    const b = e.target.closest?.(MAG);
    if (!b) return;
    const r = b.getBoundingClientRect();
    const dx = (e.clientX - (r.left + r.width / 2)) * 0.28;
    const dy = (e.clientY - (r.top + r.height / 2)) * 0.28;
    b.style.transform = `translate(${Math.max(-10, Math.min(10, dx))}px, ${Math.max(-10, Math.min(10, dy))}px)`;
  });
  home.addEventListener("pointerout", (e) => {
    const b = e.target.closest?.(MAG);
    if (b && !b.contains(e.relatedTarget)) b.style.transform = "";
  });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
