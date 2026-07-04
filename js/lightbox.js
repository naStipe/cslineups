import { lightboxCaption, lightboxClose, lightboxImage, lightboxModal, lightboxNext, lightboxPrev } from "./dom.js";
import { zoom } from "./pan-zoom.js";
import { resolveImageSrc } from "./private-images.js";

export let lightboxState = { images: [], index: 0, caption: "" };

export let lbZoom = 1, lbPanX = 0, lbPanY = 0;

export let lbDragging = false, lbDragStartX = 0, lbDragStartY = 0, lbDragPanX = 0, lbDragPanY = 0;

export let lbHasDragged = false;

export function lbApplyTransform() {
  // Clamp pan so image can't be dragged too far off screen
  if (lbZoom > 1) {
    const maxPan = (lbZoom - 1) * 300;
    lbPanX = Math.min(maxPan, Math.max(-maxPan, lbPanX));
    lbPanY = Math.min(maxPan, Math.max(-maxPan, lbPanY));
  } else {
    lbPanX = 0; lbPanY = 0;
  }
  lightboxImage.style.transform = `translate(${lbPanX}px, ${lbPanY}px) scale(${lbZoom})`;
  lightboxImage.style.cursor = lbZoom > 1 ? "grab" : "default";
}

export function lbResetZoom() {
  lbZoom = 1; lbPanX = 0; lbPanY = 0;
  lbApplyTransform();
}

export function lbZoomAt(clientX, clientY, factor) {
  const newZoom = Math.min(Math.max(lbZoom * factor, 1), 8);
  if (newZoom === lbZoom) return;
  const rect = lightboxImage.getBoundingClientRect();
  const cx = clientX - (rect.left + rect.width / 2);
  const cy = clientY - (rect.top + rect.height / 2);
  const rf = newZoom / lbZoom;
  lbPanX = lbPanX + cx * (1 - rf);
  lbPanY = lbPanY + cy * (1 - rf);
  lbZoom = newZoom;
  lbApplyTransform();
}

export function openLightbox(images, index, caption) {
  const valid = (images || []).filter(Boolean);
  if (!valid.length) return;
  lightboxState = { images: valid, index, caption: caption || "" };
  lbResetZoom();
  renderLightbox();
  lightboxModal.classList.add("show");
}

let renderToken = 0;

export async function renderLightbox() {
  lbResetZoom();
  const myToken = ++renderToken;
  const raw = lightboxState.images[lightboxState.index];
  lightboxImage.src = "";
  const src = await resolveImageSrc(raw);
  if (myToken !== renderToken) return; // a newer render superseded this one
  lightboxImage.src = src;
  const multi = lightboxState.images.length > 1;
  lightboxPrev.style.display = multi ? "" : "none";
  lightboxNext.style.display = multi ? "" : "none";
  lightboxCaption.textContent = multi
    ? `${lightboxState.caption} — ${lightboxState.index + 1} / ${lightboxState.images.length}`
    : lightboxState.caption;
}

lightboxPrev.onclick = () => {
  lightboxState.index = (lightboxState.index - 1 + lightboxState.images.length) % lightboxState.images.length;
  renderLightbox();
};

lightboxNext.onclick = () => {
  lightboxState.index = (lightboxState.index + 1) % lightboxState.images.length;
  renderLightbox();
};

lightboxClose.onclick = () => lightboxModal.classList.remove("show");

lightboxImage.addEventListener("dblclick", (e) => {
  if (lbZoom > 1) { lbResetZoom(); }
  else { lbZoomAt(e.clientX, e.clientY, 3); }
});

lightboxModal.addEventListener("wheel", (e) => {
  e.preventDefault();
  lbZoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.2 : 1 / 1.2);
}, { passive: false });

lightboxImage.addEventListener("mousedown", (e) => {
  if (lbZoom <= 1) return;
  e.preventDefault();
  lbDragging = true; lbHasDragged = false;
  lbDragStartX = e.clientX; lbDragStartY = e.clientY;
  lbDragPanX = lbPanX; lbDragPanY = lbPanY;
  lightboxImage.style.cursor = "grabbing";
});

window.addEventListener("mousemove", (e) => {
  if (!lbDragging) return;
  const dx = e.clientX - lbDragStartX, dy = e.clientY - lbDragStartY;
  if (Math.hypot(dx, dy) > 3) lbHasDragged = true;
  lbPanX = lbDragPanX + dx; lbPanY = lbDragPanY + dy;
  lbApplyTransform();
});

window.addEventListener("mouseup", () => {
  if (!lbDragging) return;
  lbDragging = false;
  lightboxImage.style.cursor = lbZoom > 1 ? "grab" : "default";
});

lightboxModal.addEventListener("click", (e) => {
  if (lbHasDragged) { lbHasDragged = false; return; }
  if (e.target === lightboxModal) lightboxModal.classList.remove("show");
});

export let lbLastTouchDist = null, lbTouchPanActive = false;

export let lbTouchStartX = 0, lbTouchStartY = 0, lbTouchMoved = false;

lightboxModal.addEventListener("touchstart", (e) => {
  if (e.touches.length === 2) {
    lbLastTouchDist = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY
    );
    lbTouchPanActive = false;
  } else if (e.touches.length === 1) {
    lbTouchStartX = e.touches[0].clientX;
    lbTouchStartY = e.touches[0].clientY;
    lbTouchMoved = false;
    if (lbZoom > 1) {
      lbTouchPanActive = true;
      lbDragPanX = lbPanX; lbDragPanY = lbPanY;
    }
  }
}, { passive: true });

lightboxModal.addEventListener("touchmove", (e) => {
  if (e.touches.length === 2 && lbLastTouchDist) {
    const dist = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY
    );
    const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
    const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    lbZoomAt(midX, midY, dist / lbLastTouchDist);
    lbLastTouchDist = dist;
    e.preventDefault();
  } else if (e.touches.length === 1 && lbTouchPanActive) {
    const dx = e.touches[0].clientX - lbTouchStartX;
    const dy = e.touches[0].clientY - lbTouchStartY;
    if (Math.hypot(dx, dy) > 5) lbTouchMoved = true;
    lbPanX = lbDragPanX + dx; lbPanY = lbDragPanY + dy;
    lbApplyTransform();
    e.preventDefault();
  }
}, { passive: false });

lightboxModal.addEventListener("touchend", (e) => {
  // Double-tap to zoom
  if (!lbTouchMoved && e.changedTouches.length === 1) {
    const now = Date.now();
    if (lightboxModal._lastTap && now - lightboxModal._lastTap < 300) {
      const t = e.changedTouches[0];
      if (lbZoom > 1) lbResetZoom(); else lbZoomAt(t.clientX, t.clientY, 3);
      lightboxModal._lastTap = null;
    } else {
      lightboxModal._lastTap = now;
    }
  }
  // Swipe to next/prev (only when not zoomed)
  if (!lbTouchMoved && lbZoom <= 1) {
    const dx = e.changedTouches[0].clientX - lbTouchStartX;
    if (Math.abs(dx) >= 35) {
      if (dx < 0) lightboxNext.onclick(); else lightboxPrev.onclick();
    }
  }
  lbLastTouchDist = null; lbTouchPanActive = false;
});
