import { mapFrame, mapStage, zoomInBtn, zoomOutBtn, zoomResetBtn } from "./dom.js";
import { renderMarkers } from "./markers.js";
import { state } from "./state.js";

export let zoom = 1;

export let panX = 0, panY = 0;

export let isDragging = false;

export let hasDragged = false;

export let dragStartX, dragStartY, dragPanX, dragPanY;

export const MAX_ZOOM = 6;

export function clampPan() {
  if (zoom <= 1) { panX = 0; panY = 0; return; }
  const sw = mapStage.clientWidth;
  const sh = mapStage.clientHeight;
  const fw = mapFrame.offsetWidth;
  const fh = mapFrame.offsetHeight;
  // Scaled frame size
  const scaledW = fw * zoom;
  const scaledH = fh * zoom;
  // The frame center is at (sw/2 + panX, sh/2 + panY)
  // Keep at least 20% of the frame visible in each direction
  const minVisible = 60; // px of frame that must stay on screen
  const maxPanX = sw / 2 - minVisible + scaledW / 2;
  const minPanX = -(sw / 2 - minVisible + scaledW / 2);
  const maxPanY = sh / 2 - minVisible + scaledH / 2;
  const minPanY = -(sh / 2 - minVisible + scaledH / 2);
  panX = Math.min(maxPanX, Math.max(minPanX, panX));
  panY = Math.min(maxPanY, Math.max(minPanY, panY));
}

export function applyTransform(rerender = true) {
  clampPan();
  mapFrame.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
  // Scale markers inversely so they appear the same size on screen regardless of zoom
  const markerScale = 1 / zoom;
  document.documentElement.style.setProperty("--marker-scale", markerScale);
  mapStage.style.cursor = zoom > 1 ? "grab" : "";
  if (rerender) renderMarkers(false);  // re-cluster on zoom, but no enter/exit animation (avoids flicker)
}

export function resetZoom() {
  zoom = 1; panX = 0; panY = 0;
  applyTransform();
  mapStage.style.cursor = "";
}

export function zoomAt(clientX, clientY, factor) {
  const newZoom = Math.min(Math.max(zoom * factor, 1), MAX_ZOOM);
  if (newZoom === zoom) return;
  const rf = newZoom / zoom;

  // cursor offset from current frame center in screen space
  const r = mapFrame.getBoundingClientRect();
  const cx = clientX - (r.left + r.width / 2);
  const cy = clientY - (r.top + r.height / 2);

  // adjust pan so the point under cursor stays stationary
  panX = panX + cx * (1 - rf);
  panY = panY + cy * (1 - rf);
  zoom = newZoom;

  if (zoom <= 1) { zoom = 1; panX = 0; panY = 0; }
  applyTransform();
}

mapStage.addEventListener("wheel", (e) => {
  e.preventDefault();
  zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.2 : 1 / 1.2);
}, { passive: false });

mapStage.addEventListener("mousedown", (e) => {
  if (e.button !== 0 || zoom <= 1 || state.addMode || state.pendingThrowFor) return;
  isDragging = true;
  hasDragged = false;
  dragStartX = e.clientX; dragStartY = e.clientY;
  dragPanX = panX; dragPanY = panY;
  mapStage.classList.add("panning");
  e.preventDefault();
});

window.addEventListener("mousemove", (e) => {
  if (!isDragging) return;
  const dx = e.clientX - dragStartX;
  const dy = e.clientY - dragStartY;
  if (Math.hypot(dx, dy) > 4) hasDragged = true;
  panX = dragPanX + dx;
  panY = dragPanY + dy;
  applyTransform(false);
});

window.addEventListener("mouseup", () => {
  if (!isDragging) return;
  isDragging = false;
  mapStage.classList.remove("panning");
  mapStage.style.cursor = zoom > 1 ? "grab" : "";
});

export let lastTouchDist = null;

export let touchPanActive = false;

export let touchStartX = 0, touchStartY = 0;

export let hasTouchMoved = false;

mapStage.addEventListener("touchstart", (e) => {
  if (e.touches.length === 2) {
    // Pinch start
    lastTouchDist = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY
    );
    touchPanActive = false;
  } else if (e.touches.length === 1) {
    // Single finger — potential pan or tap
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    hasTouchMoved = false;
    // Allow pan when zoomed (and not in add/throw mode)
    if (zoom > 1 && !state.addMode && !state.pendingThrowFor) {
      touchPanActive = true;
      dragPanX = panX;
      dragPanY = panY;
    }
  }
}, { passive: true });

mapStage.addEventListener("touchmove", (e) => {
  if (e.touches.length === 2 && lastTouchDist) {
    // Pinch zoom
    const dist = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY
    );
    const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
    const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    zoomAt(midX, midY, dist / lastTouchDist);
    lastTouchDist = dist;
    e.preventDefault();
  } else if (e.touches.length === 1 && touchPanActive) {
    // Single-finger pan
    const dx = e.touches[0].clientX - touchStartX;
    const dy = e.touches[0].clientY - touchStartY;
    if (Math.hypot(dx, dy) > 6) hasTouchMoved = true;
    panX = dragPanX + dx;
    panY = dragPanY + dy;
    applyTransform(false);
    e.preventDefault();
  }
}, { passive: false });

mapStage.addEventListener("touchend", () => {
  lastTouchDist = null;
  touchPanActive = false;
});

// Other modules (e.g. add-mode's map-click handler) need to know "did the
// user just drag/pan the map?" so a drag-release isn't mistaken for a
// deselect click, and then clear the flags. Imported bindings can't be
// reassigned from outside this module, so expose that as a function instead.
export function consumeDragFlags() {
  const wasDragOrTouch = hasDragged || hasTouchMoved;
  hasDragged = false;
  hasTouchMoved = false;
  return wasDragOrTouch;
}

zoomInBtn.onclick    = () => { const r = mapStage.getBoundingClientRect(); zoomAt(r.left + r.width/2, r.top + r.height/2, 1.5); };

zoomOutBtn.onclick   = () => { const r = mapStage.getBoundingClientRect(); zoomAt(r.left + r.width/2, r.top + r.height/2, 1/1.5); };

zoomResetBtn.onclick = resetZoom;
