// Touch / pointer gestures for the lineup dossier (js/detail-panel.js), kept
// apart so the panel module stays about *what* is shown, not finger maths.
//
// Gesture ownership inside the dossier, so nothing fights over a touch:
//   - A screenshot frame owns every touch that starts on it: pinch / double-tap
//     zoom, pan while zoomed, single tap = lightbox, and (only when the frame
//     has several photos, shown by its dots/arrows) a horizontal swipe flips
//     photos.
//   - Any other horizontal swipe in the hero (header, labels, notes, a
//     single-photo frame) moves between variants. See attachVariantSwipe.
//   - The variant strip owns its touches: native horizontal scroll, and
//     long-press + drag to reorder for editors. See attachStripReorder.
//   - The sheet handle owns vertical drags: swipe down to close.

import { resolveImageSrc } from "./private-images.js";

const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
export const isSheetLayout = () => window.matchMedia("(max-width: 768px)").matches;

// ── Image loading with a skeleton ─────────────────────────────────────────
// The frame (any ancestor with .img-frame) reserves the 16:9 box and pulses
// while the image resolves (private images go through /api/private-image and
// come back as blob: URLs) and downloads; the image fades in once decoded, or
// the frame shows a quiet "Image unavailable" if it fails. A token guards
// against a slow earlier load landing after a newer one (carousel flips).
export function loadFrameImage(img, raw) {
  const frame = img.closest(".img-frame") || img.parentElement;
  const token = (img._loadToken || 0) + 1;
  img._loadToken = token;
  const settle = (ok) => {
    if (img._loadToken !== token) return;
    frame.classList.remove("is-loading");
    frame.classList.toggle("is-loaded", ok);
    frame.classList.toggle("is-error", !ok);
    if (ok) frame.removeAttribute("title"); else frame.title = "This image couldn't be loaded";
  };
  frame.classList.add("is-loading");
  frame.classList.remove("is-error", "is-loaded");
  img.onload = () => settle(true);
  img.onerror = () => settle(false);
  if (!raw) { settle(false); return Promise.resolve(); }
  return resolveImageSrc(raw)
    .then((src) => {
      if (img._loadToken !== token) return;
      if (!src) { settle(false); return; }
      if (img.getAttribute("src") === src && img.complete) { settle(img.naturalWidth > 0); return; }
      img.src = src;
    })
    .catch(() => settle(false));
}

export function loadFrameImages(root) {
  root.querySelectorAll("img[data-real-src]").forEach(img => loadFrameImage(img, img.dataset.realSrc));
}

// ── Inline zoom on a screenshot frame (touch) ─────────────────────────────
// Pinch to zoom (1x-4x) around the fingers, double-tap to toggle 2.5x at the
// tapped point, one-finger pan while zoomed, single tap -> onTap (lightbox),
// horizontal swipe while not zoomed -> onSwipe (only wired for multi-photo
// frames). The synthetic click after a tap is cancelled so the lightbox
// doesn't open twice; mouse and keyboard keep the plain click path.
const MAX_ZOOM = 4, DOUBLE_TAP_ZOOM = 2.5, TAP_SLOP = 10, DOUBLE_TAP_MS = 280, SWIPE_MIN = 35;

export function attachInlineZoom(frame, img, { onTap, onSwipe } = {}) {
  let scale = 1, tx = 0, ty = 0;
  let mode = null; // "pinch" | "pan" | "tap"
  let startDist = 0, startScale = 1, startTx = 0, startTy = 0, startMid = null;
  let startX = 0, startY = 0, startT = 0, moved = false, multi = false;
  let lastTapT = 0, lastTapX = 0, lastTapY = 0, tapTimer = null;

  const center = () => {
    const r = frame.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };
  const clamp = () => {
    if (scale <= 1.01) { scale = 1; tx = 0; ty = 0; return; }
    const mx = (frame.clientWidth * (scale - 1)) / 2, my = (frame.clientHeight * (scale - 1)) / 2;
    tx = Math.min(mx, Math.max(-mx, tx));
    ty = Math.min(my, Math.max(-my, ty));
  };
  const apply = (animate) => {
    clamp();
    img.style.transition = animate && !reduceMotion() ? "transform .2s ease, opacity .2s ease" : "none";
    img.style.transform = scale > 1 ? `translate(${tx}px, ${ty}px) scale(${scale})` : "";
    frame.classList.toggle("zoomed", scale > 1);
  };
  // Keep the screen point (qx, qy) still while the scale goes s0 -> s1:
  // with transform-origin at the frame centre c, t1 = d - (s1/s0)(d - t0), d = q - c.
  const zoomAround = (s1, qx, qy, s0 = scale, t0x = tx, t0y = ty) => {
    const c = center();
    const dx = qx - c.x, dy = qy - c.y;
    s1 = Math.min(MAX_ZOOM, Math.max(1, s1));
    tx = dx - (s1 / s0) * (dx - t0x);
    ty = dy - (s1 / s0) * (dy - t0y);
    scale = s1;
  };
  const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  const mid = (t) => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 });
  const beginPan = (touch) => {
    mode = "pan"; startX = touch.clientX; startY = touch.clientY; startTx = tx; startTy = ty;
  };

  frame.addEventListener("touchstart", (e) => {
    if (e.touches.length >= 2) {
      clearTimeout(tapTimer); tapTimer = null;
      mode = "pinch"; multi = true; moved = true;
      startDist = dist(e.touches) || 1; startScale = scale; startTx = tx; startTy = ty; startMid = mid(e.touches);
      return;
    }
    const t = e.touches[0];
    multi = false; moved = false; startT = Date.now();
    startX = t.clientX; startY = t.clientY; startTx = tx; startTy = ty;
    mode = scale > 1 ? "pan" : "tap";
  }, { passive: true });

  frame.addEventListener("touchmove", (e) => {
    if (mode === "pinch" && e.touches.length >= 2) {
      e.preventDefault();
      const m = mid(e.touches);
      // Zoom around where the fingers started, then follow their midpoint.
      zoomAround(startScale * (dist(e.touches) / startDist), startMid.x, startMid.y, startScale, startTx, startTy);
      tx += m.x - startMid.x; ty += m.y - startMid.y;
      apply(false);
      return;
    }
    const t = e.touches[0];
    const dx = t.clientX - startX, dy = t.clientY - startY;
    if (Math.hypot(dx, dy) > TAP_SLOP) moved = true;
    if (mode === "pan") {
      e.preventDefault(); // zoomed: the finger pans the image, not the sheet
      tx = startTx + dx; ty = startTy + dy;
      apply(false);
    }
  }, { passive: false });

  frame.addEventListener("touchend", (e) => {
    if (mode === "pinch") {
      if (e.touches.length === 1) { beginPan(e.touches[0]); return; }
      mode = null;
      if (scale < 1.05) { scale = 1; apply(true); }
      return;
    }
    const t = e.changedTouches[0];
    const dx = t.clientX - startX, dy = t.clientY - startY;
    const wasTap = mode && !moved && !multi && Date.now() - startT < 500;
    const wasSwipe = mode === "tap" && !multi && Math.abs(dx) >= SWIPE_MIN && Math.abs(dx) > Math.abs(dy) * 1.2;
    mode = null;
    if (wasSwipe && onSwipe) { onSwipe(dx < 0 ? 1 : -1); return; }
    if (!wasTap) return;
    e.preventDefault(); // no synthetic click: taps are handled right here
    const now = Date.now();
    if (now - lastTapT < DOUBLE_TAP_MS && Math.hypot(t.clientX - lastTapX, t.clientY - lastTapY) < 40) {
      clearTimeout(tapTimer); tapTimer = null; lastTapT = 0;
      if (scale > 1) scale = 1;
      else zoomAround(DOUBLE_TAP_ZOOM, t.clientX, t.clientY);
      apply(true);
      return;
    }
    lastTapT = now; lastTapX = t.clientX; lastTapY = t.clientY;
    clearTimeout(tapTimer);
    tapTimer = setTimeout(() => { tapTimer = null; if (onTap) onTap(); }, DOUBLE_TAP_MS);
  });

  frame.addEventListener("touchcancel", () => { mode = null; });

  const api = {
    reset() { clearTimeout(tapTimer); tapTimer = null; scale = 1; tx = 0; ty = 0; apply(false); },
    get zoomed() { return scale > 1; },
  };
  frame._inlineZoom = api;
  return api;
}

// ── Horizontal swipe between variants ─────────────────────────────────────
// One-finger, mostly-horizontal, quick swipes on `el` call onSwipe(+1 / -1).
// `ignore(target)` vetoes gestures that start on something that owns its own
// horizontal swipes (multi-photo frames, zoomed frames, the strip).
export function attachVariantSwipe(el, { onSwipe, ignore }) {
  let sx = 0, sy = 0, st = 0, active = false;
  el.addEventListener("touchstart", (e) => {
    active = e.touches.length === 1 && !(ignore && ignore(e.target));
    if (!active) return;
    sx = e.touches[0].clientX; sy = e.touches[0].clientY; st = Date.now();
  }, { passive: true });
  el.addEventListener("touchmove", (e) => { if (e.touches.length > 1) active = false; }, { passive: true });
  el.addEventListener("touchcancel", () => { active = false; }, { passive: true });
  el.addEventListener("touchend", (e) => {
    if (!active) return;
    active = false;
    const t = e.changedTouches[0];
    const dx = t.clientX - sx, dy = t.clientY - sy;
    if (Math.abs(dx) >= 50 && Math.abs(dx) > Math.abs(dy) * 1.5 && Date.now() - st < 800) onSwipe(dx < 0 ? 1 : -1);
  }, { passive: true });
}

// ── Swipe the bottom sheet down to close ──────────────────────────────────
// Pointer-driven so it works with touch and mouse alike; only active in the
// sheet layout. The sheet follows the finger, then either snaps back or
// slides out and onClose() runs (which also pops the dossier's history
// entry, exactly like the ✕ button, so Back never reopens it).
export function attachSheetDrag(handle, sheet, { onClose }) {
  let startY = 0, lastY = 0, lastT = 0, velocity = 0, dragging = false, pid = null;
  const clearInline = () => { sheet.style.transition = ""; sheet.style.transform = ""; };
  handle.addEventListener("pointerdown", (e) => {
    if (!isSheetLayout() || (e.pointerType === "mouse" && e.button !== 0)) return;
    dragging = true; pid = e.pointerId;
    startY = lastY = e.clientY; lastT = performance.now(); velocity = 0;
    try { handle.setPointerCapture(pid); } catch {}
    sheet.style.transition = "none";
  });
  handle.addEventListener("pointermove", (e) => {
    if (!dragging || e.pointerId !== pid) return;
    const now = performance.now();
    velocity = (e.clientY - lastY) / Math.max(1, now - lastT);
    lastY = e.clientY; lastT = now;
    const dy = Math.max(0, e.clientY - startY);
    sheet.style.transform = `translateY(${dy}px)`;
  });
  const end = (e) => {
    if (!dragging || e.pointerId !== pid) return;
    dragging = false;
    const dy = Math.max(0, e.clientY - startY);
    const fast = reduceMotion() ? "none" : "transform .2s ease";
    if (dy > 110 || (dy > 30 && velocity > 0.6)) {
      sheet.style.transition = fast;
      sheet.style.transform = "translateY(100%)";
      setTimeout(() => {
        onClose();
        // The panel is fading out now; drop the inline styles once it's gone
        // so the next open starts from the stylesheet's resting state.
        setTimeout(() => { sheet.style.transition = "none"; sheet.style.transform = ""; requestAnimationFrame(clearInline); }, 260);
      }, reduceMotion() ? 0 : 180);
    } else {
      sheet.style.transition = fast;
      sheet.style.transform = "";
      setTimeout(clearInline, 220);
    }
  };
  handle.addEventListener("pointerup", end);
  handle.addEventListener("pointercancel", end);
}

// ── Drag to reorder the variant strip ─────────────────────────────────────
// Mouse/pen: press and move a thumb more than a few px. Touch: long-press
// (~350ms, without moving, so a normal swipe still scrolls the strip), then
// drag. A floating copy follows the pointer, the original stays in the row as
// a dashed placeholder that hops between neighbours (FLIP-animated), and on
// release onReorder(newOrder) gets the old indices in their new order.
const LONG_PRESS_MS = 350, DRAG_SLOP = 6;

export function attachStripReorder(strip, { onReorder }) {
  let pending = null;   // { thumb, x, y, timer, touch }
  let drag = null;      // { thumb, ghost, offX, offY }
  let justDragged = false;

  const thumbs = () => [...strip.querySelectorAll(".detail-strip-thumb")];

  const flip = (mutate) => {
    const before = new Map(thumbs().map(t => [t, t.getBoundingClientRect()]));
    mutate();
    if (reduceMotion()) return;
    thumbs().forEach(t => {
      const a = before.get(t); if (!a || t === drag.thumb) return;
      const b = t.getBoundingClientRect();
      const dx = a.left - b.left, dy = a.top - b.top;
      if (!dx && !dy) return;
      t.style.transition = "none";
      t.style.transform = `translate(${dx}px, ${dy}px)`;
      requestAnimationFrame(() => { t.style.transition = "transform .16s ease"; t.style.transform = ""; });
    });
  };

  const start = (thumb, x, y) => {
    const r = thumb.getBoundingClientRect();
    const ghost = thumb.cloneNode(true);
    ghost.classList.add("drag-ghost");
    ghost.classList.remove("active");
    ghost.removeAttribute("id");
    ghost.setAttribute("aria-hidden", "true");
    Object.assign(ghost.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px` });
    document.body.appendChild(ghost);
    drag = { thumb, ghost, offX: x - r.left, offY: y - r.top, x0: r.left, y0: r.top };
    thumb.classList.add("drag-placeholder");
    strip.classList.add("reordering");
    if (navigator.vibrate) { try { navigator.vibrate(10); } catch {} }
    move(x, y);
  };

  const move = (x, y) => {
    const { ghost, thumb, offX, offY, x0, y0 } = drag;
    ghost.style.transform = `translate(${x - offX - x0}px, ${y - offY - y0}px) scale(1.04)`;
    // Keep the strip scrolling when dragging near its edges (phone layout).
    const sr = strip.getBoundingClientRect();
    if (x < sr.left + 28) strip.scrollLeft -= 10;
    else if (x > sr.right - 28) strip.scrollLeft += 10;
    // Nearest other thumb by centre; drop before or after it by pointer x.
    let best = null, bestD = Infinity;
    thumbs().forEach(t => {
      if (t === thumb) return;
      const r = t.getBoundingClientRect();
      const d = Math.hypot(x - (r.left + r.width / 2), (y - (r.top + r.height / 2)) * 1.5);
      if (d < bestD) { bestD = d; best = { t, r }; }
    });
    if (!best) return;
    const after = x > best.r.left + best.r.width / 2;
    const ref = after ? best.t.nextElementSibling : best.t;
    if (ref === thumb || ref === thumb.nextElementSibling) return; // already there
    flip(() => strip.insertBefore(thumb, ref));
  };

  const finish = (commit) => {
    const { thumb, ghost } = drag;
    ghost.remove();
    thumb.classList.remove("drag-placeholder");
    strip.classList.remove("reordering");
    thumbs().forEach(t => { t.style.transition = ""; t.style.transform = ""; });
    drag = null;
    justDragged = true;
    setTimeout(() => { justDragged = false; }, 0);
    const order = thumbs().map(t => +t.dataset.idx);
    if (commit && order.some((v, i) => v !== i)) onReorder(order);
  };

  const cancelPending = () => { if (pending) { clearTimeout(pending.timer); pending = null; } };

  // Mouse / pen. The window listeners only live for one press, so strips
  // rebuilt on every variant switch don't pile up global handlers.
  const onWinMove = (e) => {
    if (drag && !drag.touch) { move(e.clientX, e.clientY); return; }
    if (pending && !pending.touch && Math.hypot(e.clientX - pending.x, e.clientY - pending.y) > DRAG_SLOP) {
      const { thumb } = pending; pending = null;
      start(thumb, e.clientX, e.clientY);
    }
  };
  const onWinUp = () => {
    window.removeEventListener("pointermove", onWinMove);
    window.removeEventListener("pointerup", onWinUp);
    window.removeEventListener("pointercancel", onWinUp);
    if (drag && !drag.touch) finish(true);
    cancelPending();
  };
  strip.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "touch" || e.button !== 0) return;
    const thumb = e.target.closest(".detail-strip-thumb");
    if (!thumb) return;
    e.preventDefault(); // no text selection / native image drag while dragging
    pending = { thumb, x: e.clientX, y: e.clientY, touch: false };
    window.addEventListener("pointermove", onWinMove);
    window.addEventListener("pointerup", onWinUp);
    window.addEventListener("pointercancel", onWinUp);
  });

  // Touch: long-press, then drag
  strip.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) { cancelPending(); return; }
    const thumb = e.target.closest(".detail-strip-thumb");
    if (!thumb) return;
    const t = e.touches[0];
    pending = { thumb, x: t.clientX, y: t.clientY, touch: true, last: t };
    pending.timer = setTimeout(() => {
      if (!pending) return;
      const { thumb: th, last } = pending; pending = null;
      start(th, last.clientX, last.clientY);
      drag.touch = true;
    }, LONG_PRESS_MS);
  }, { passive: true });
  strip.addEventListener("touchmove", (e) => {
    const t = e.touches[0];
    if (drag && drag.touch) { e.preventDefault(); move(t.clientX, t.clientY); return; }
    if (pending && pending.touch) {
      pending.last = t;
      if (Math.hypot(t.clientX - pending.x, t.clientY - pending.y) > 8) cancelPending(); // it's a scroll
    }
  }, { passive: false });
  const touchEnd = (e) => {
    if (drag && drag.touch) { if (e.cancelable) e.preventDefault(); finish(e.type === "touchend"); return; }
    cancelPending();
  };
  strip.addEventListener("touchend", touchEnd);
  strip.addEventListener("touchcancel", touchEnd);
  // No image callout / context menu on long-press.
  strip.addEventListener("contextmenu", (e) => { if (e.target.closest(".detail-strip-thumb")) e.preventDefault(); });

  return { get justDragged() { return justDragged || !!drag; } };
}
