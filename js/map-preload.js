import { MAPS } from "./constants.js";
import { state } from "./state.js";

// Warms the HTTP cache and decodes every radar image up front so switching maps
// shows the new radar instantly — only the lineup fetch is left to hide behind
// the switch animation. The Image objects are kept referenced so the decoded
// bitmaps are not garbage collected before they are needed.
const kept = [];

function radarFiles() {
  const files = [];
  for (const m of MAPS) {
    files.push(m.file);
    if (Array.isArray(m.levels)) m.levels.forEach(l => files.push(l.file));
  }
  return [...new Set(files)];
}

function load(src) {
  return new Promise(resolve => {
    const img = new Image();
    img.decoding = "async";
    const done = () => {
      // Decode in the background; never block the queue on it (decode() can stall
      // for off-screen images in some browsers).
      if (img.decode) img.decode().catch(() => {});
      resolve();
    };
    img.onload = done;
    img.onerror = resolve;
    setTimeout(resolve, 5000); // a stalled request must not hold up the rest
    img.src = src;
    kept.push(img);
  });
}

export function preloadMapImages() {
  const current = MAPS.find(m => m.id === state.mapId);
  const rest = radarFiles().filter(f => !current || f !== current.file);
  const run = async () => {
    for (const src of rest) await load(src); // one at a time so the visible map's requests aren't starved
  };
  // Wait until the browser is idle so the first map and lineups win the bandwidth.
  if ("requestIdleCallback" in window) requestIdleCallback(run, { timeout: 3000 });
  else setTimeout(run, 1200);
}
