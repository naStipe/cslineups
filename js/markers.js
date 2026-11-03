import { TYPES } from "./constants.js";
import { openDetail } from "./detail-panel.js";
import { linkSvg, mapImage, mapStage, markerLayer } from "./dom.js";
import { syncLineupListSelection } from "./lineup-list.js";
import { zoom } from "./pan-zoom.js";
import { hooks } from "./marker-hooks.js";
import { state } from "./state.js";
import { lineupVisible } from "./visibility.js";

export function typeColor(typeId) {
  return TYPES.find(t => t.id === typeId)?.color || "#fff";
}

export function buildPieGradient(typeCounts) {
  const total = Object.values(typeCounts).reduce((a, b) => a + b, 0);
  let angle = 0;
  const stops = [];
  TYPES.forEach(t => {
    const c = typeCounts[t.id];
    if (!c) return;
    const start = angle;
    angle += (c / total) * 360;
    stops.push(`${t.color} ${start}deg ${angle}deg`);
  });
  return `conic-gradient(${stops.join(", ")})`;
}

export function getCssVarColor(v) {
  if (v.startsWith("var(")) {
    return getComputedStyle(document.documentElement).getPropertyValue(v.slice(4, -1)).trim();
  }
  return v;
}

// Picking a single lineup on the map: with one throw position there's nothing
// to choose between, so go straight to its dossier; with several, show the
// throw spots (and, the first time, a hint that they're clickable).
export function pickLineup(lineup) {
  if (lineup.throws.length === 1) { openDetail(lineup.id, 0); return; }
  state.selectedLineupId = lineup.id;
  renderMarkers();
  maybeShowThrowHint();
}

const THROW_HINT_KEY = "lineupr_throw_hint_seen";
function maybeShowThrowHint() {
  try {
    if (localStorage.getItem(THROW_HINT_KEY)) return;
    localStorage.setItem(THROW_HINT_KEY, "1");
  } catch { return; }
  const el = document.createElement("div");
  el.className = "throw-hint";
  el.setAttribute("role", "status");
  el.textContent = "Click a throw spot to open its lineup";
  mapStage.appendChild(el);
  setTimeout(() => el.classList.add("out"), 4000);
  setTimeout(() => el.remove(), 4400);
}

// Markers are plain divs; make them reachable and operable from the keyboard
// (Enter/Space trigger the same click handler) so dialogs opened from them
// can hand focus back on close.
function makeKeyboardButton(el) {
  el.tabIndex = 0;
  el.setAttribute("role", "button");
}
markerLayer.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const el = e.target.closest(".marker, .fan-petal");
  if (!el) return;
  e.preventDefault();
  el.click();
});

// Marks closer than this on screen (px) are combined, so on a small radar
// (phones) neighbouring marks don't overlap and steal each other's taps.
const MIN_MARK_GAP_PX = 22;

// Groups items whose map position (posOf(item) -> {x,y} in %) is too close to
// tell apart; each cluster sits at the average of its items.
function clusterPoints(items, posOf) {
  // 3.5% of the map at zoom 1 is the desktop spacing; small maps need more.
  const mapPx = mapImage.offsetWidth;
  const minPct = mapPx ? (MIN_MARK_GAP_PX / mapPx) * 100 : 0;
  const THRESHOLD = Math.max(3.5, minPct) / zoom;
  const clusters = [];
  items.forEach(item => {
    const p = posOf(item);
    const c = clusters.find(cl => Math.hypot(cl.x - p.x, cl.y - p.y) < THRESHOLD);
    if (c) {
      c.items.push(item);
      c.x = c.items.reduce((s, it) => s + posOf(it).x, 0) / c.items.length;
      c.y = c.items.reduce((s, it) => s + posOf(it).y, 0) / c.items.length;
    } else {
      clusters.push({ x: p.x, y: p.y, items: [item] });
    }
  });
  return clusters;
}

export function clusterLineups(list) {
  return clusterPoints(list, l => l.landing).map(c => ({ x: c.x, y: c.y, lineups: c.items }));
}

// Throw-spot clusters: `lineups[i]` is thrown from its variant `throwIdxs[i]`
// (one lineup can appear twice when two of its variants stand close together).
function clusterThrowSpots(list) {
  const items = list.flatMap(lineup => lineup.throws.map((t, idx) => ({ lineup, idx, pos: t.pos })));
  return clusterPoints(items, it => it.pos).map(c => ({
    x: c.x, y: c.y,
    lineups: c.items.map(it => it.lineup),
    throwIdxs: c.items.map(it => it.idx),
  }));
}

export function clusterKey(cluster) {
  // Include each lineup's throw count so that saving/removing an individual
  // throw position (which changes the marker's badge number) counts as a
  // real change in cluster identity — otherwise the reconciler below sees
  // "same lineup ids here" and leaves the stale marker/badge in place.
  if (cluster.throwIdxs) {
    return "t:" + cluster.lineups.map((l, i) => `${l.id}#${cluster.throwIdxs[i]}:${l.throws.length}`).sort().join(",");
  }
  return cluster.lineups.map(l => `${l.id}:${l.throws.length}`).sort().join(",");
}

// Which marks the map shows: "landing" (pick a lineup to see where it's thrown
// from), "throws" (every throw spot) or "both". An open collection always
// shows landings, since its step numbers live on the landing marks.
export function markMode() {
  return state.collectionView ? "landing" : state.markMode;
}

// Label shown under a fan petal; unnamed lineups read like the sidebar list.
function petalLabel(lineup) {
  const t = TYPES.find(x => x.id === lineup.type);
  return lineup.name || `Unnamed ${(t ? t.label : "lineup").toLowerCase()}`;
}

// Smallest fan radius (screen px) at which no two petal labels overlap.
// Label boxes are estimated from the text (9px mono, ~5.5px per character
// plus padding) and sit centred about 15px below each petal's centre.
function fanRadius(labels, startAngle, step) {
  const boxes = (r) => labels.map((text, i) => {
    const rad = (startAngle + i * step) * Math.PI / 180;
    const w = text.length * 5.5 + 16, h = 19;
    const x = Math.cos(rad) * r, y = Math.sin(rad) * r + 15;
    return { l: x - w / 2, r: x + w / 2, t: y - h / 2, b: y + h / 2 };
  });
  const clear = (bs) => bs.every((a, i) => bs.every((b, j) => j <= i || a.r <= b.l || b.r <= a.l || a.b <= b.t || b.b <= a.t));
  for (let r = 46; r < 120; r += 4) if (clear(boxes(r))) return r;
  return 120;
}

export function renderClusterFan(cluster, key, animate = true) {
  const count = cluster.lineups.length;
  const isSpot = !!cluster.throwIdxs;
  const startAngle = -90;
  const step = 360 / count;
  // Throw spots name the variant too, matching "VARIANT 0N" in the dossier.
  const labels = cluster.lineups.map((l, i) =>
    isSpot && l.throws.length > 1 ? `${petalLabel(l)} · ${cluster.throwIdxs[i] + 1}` : petalLabel(l));
  // Divide by zoom so the fan's on-screen spread stays constant — the map
  // frame itself is scaled by `zoom`, which would otherwise blow up these
  // pixel offsets and scatter the petals when zoomed in.
  const spread = fanRadius(labels, startAngle, step);
  const radius = spread / zoom;
  const lineRadius = (spread - 18) / zoom;

  const wrap = document.createElement("div");
  wrap.className = "cluster-fan";
  wrap.dataset.mkey = key;
  wrap.style.left = cluster.x + "%";
  wrap.style.top = cluster.y + "%";

  const hub = document.createElement("div");
  // Glow immediately on open, the same as a picked/pinned marker. This way
  // picking a lineup from the fan doesn't introduce any glow change at
  // all — the hub was already glowing, the marker underneath it (revived,
  // not rebuilt — see the reconciliation below) is already glowing too,
  // so nothing visibly flickers or lights up mid-transition.
  hub.className = `marker ${isSpot ? "throwpos spot" : "landing"} fan-hub pinned`;
  makeKeyboardButton(hub);
  hub.setAttribute("aria-label", `Close ${count} ${isSpot ? "throw spots" : "lineups"}`);
  const sameType = cluster.lineups.every(l => l.type === cluster.lineups[0].type);
  if (sameType) {
    hub.classList.add(cluster.lineups[0].type);
  } else {
    hub.classList.add("multi");
    const typeCounts = {};
    cluster.lineups.forEach(l => { typeCounts[l.type] = (typeCounts[l.type] || 0) + 1; });
    hub.style.background = buildPieGradient(typeCounts);
  }
  const badge = document.createElement("span");
  badge.className = "marker-badge";
  badge.textContent = count;
  hub.appendChild(badge);
  wrap.appendChild(hub);

  const lineEls = [];
  const petalEls = [];

  cluster.lineups.forEach((lineup, i) => {
    const angle = startAngle + i * step;
    const rad = angle * Math.PI / 180;
    const dx = Math.round(Math.cos(rad) * radius);
    const dy = Math.round(Math.sin(rad) * radius);

    const openPetal = `translate(-50%,-50%) translate(${dx}px, ${dy}px) scale(1)`;
    const shutPetal = "translate(-50%,-50%) translate(0,0) scale(.3)";

    const line = document.createElement("div");
    line.className = "fan-petal-line";
    line.style.width = lineRadius + "px";
    line.style.transform = `rotate(${angle}deg) scaleX(${animate ? 0 : 1})`;
    wrap.appendChild(line);
    lineEls.push({ el: line, angle });

    const petal = document.createElement("div");
    petal.className = "fan-petal" + (animate ? "" : " show");
    petal.style.transform = animate ? shutPetal : openPetal;
    const typeInfo = TYPES.find(t => t.id === lineup.type);
    const label = labels[i];
    const dot = document.createElement("div");
    dot.className = "fan-petal-dot";
    dot.style.background = typeInfo.color;
    dot.style.color = getCssVarColor(typeInfo.color);  // for the currentColor hover glow
    const labelEl = document.createElement("div");
    labelEl.className = "fan-petal-label";
    labelEl.textContent = label;
    petal.appendChild(dot);
    petal.appendChild(labelEl);
    makeKeyboardButton(petal);
    petal.setAttribute("aria-label", label);
    petal.dataset.lid = lineup.id; // read by multi-select
    if (isSpot) petal.dataset.tidx = String(cluster.throwIdxs[i]); // hover preview shows the stand photo
    petal.onclick = (e) => {
      e.stopPropagation();
      if (isSpot) {
        const throwIdx = cluster.throwIdxs[i];
        // Select mode: toggle this throw and keep the fan open for the next pick.
        if (hooks.interceptThrow && hooks.interceptThrow(e, lineup, throwIdx)) return;
        state.openClusterKey = null;
        wrap.remove();
        renderMarkers();
        markerLayer.appendChild(wrap);
        collapseFan(wrap, lineEls, petalEls, () => wrap.remove());
        openDetail(lineup.id, throwIdx);
        return;
      }
      // Select mode: toggle this lineup and keep the fan open for the next pick.
      if (hooks.intercept && hooks.intercept(e, [lineup])) return;
      state.openClusterKey = null;
      state.selectedLineupId = lineup.id;

      // Promote the hub into the ordinary, permanent landing marker for
      // this spot instead of shrinking it away and letting a separate
      // element fade in underneath. It's the exact same DOM node the
      // whole time — already glowing since the fan opened — so there's
      // nothing for the handoff to flicker between. Only the petals/lines
      // left behind in `wrap` animate back down before being discarded.
      wrap.removeChild(hub);
      hub.classList.remove("fan-hub");
      hub.dataset.mkey = key;
      hub.style.left = cluster.x + "%";
      hub.style.top = cluster.y + "%";
      hub.title = count > 1 ? `${count} lineups here` : "";
      hub.setAttribute("aria-label", `${count} lineups here`);
      hub.onclick = (e2) => {
        e2.stopPropagation();
        if (count > 1) { state.openClusterKey = key; renderMarkers(); return; }
        const only = cluster.lineups[0];
        if (state.selectedLineupId === only.id) openDetail(only.id);
        else pickLineup(only);
      };
      markerLayer.appendChild(hub);

      wrap.remove();
      renderMarkers();               // throw positions for the pick appear immediately
      markerLayer.appendChild(wrap); // put the (now hub-less) fan back on top to collapse
      collapseFan(wrap, lineEls, petalEls, () => wrap.remove());
      if (lineup.throws.length === 1) openDetail(lineup.id, 0);
      else maybeShowThrowHint();
    };
    wrap.appendChild(petal);
    petalEls.push({ el: petal, dx, dy });
  });

  hub.onclick = (e) => {
    e.stopPropagation();
    // Re-show every other marker immediately, then let the petals retract on top.
    state.openClusterKey = null;
    wrap.remove();                    // keep the fan out of the way of the rebuild
    renderMarkers();                  // other markers reappear right away (fade-in)
    markerLayer.appendChild(wrap);    // put the collapsing fan back on top
    collapseFan(wrap, lineEls, petalEls, () => wrap.remove());
  };

  markerLayer.appendChild(wrap);

  if (!animate) {
    // Already rendered in the open position — no entrance animation (e.g. zoom re-cluster).
    wrap.classList.add("open");
    return;
  }

  requestAnimationFrame(() => {
    wrap.classList.add("open");
    lineEls.forEach(({ el, angle }) => { el.style.transform = `rotate(${angle}deg) scaleX(1)`; });
    petalEls.forEach(({ el, dx, dy }) => {
      el.classList.add("show");
      el.style.transform = `translate(-50%,-50%) translate(${dx}px, ${dy}px) scale(1)`;
    });
  });
}

export function collapseFan(wrap, lineEls, petalEls, onDone) {
  wrap.classList.remove("open");
  lineEls.forEach(({ el, angle }) => { el.style.transform = `rotate(${angle}deg) scaleX(0)`; });
  petalEls.forEach(({ el }) => {
    el.classList.remove("show");
    el.style.transform = "translate(-50%,-50%) translate(0,0) scale(.3)";
  });
  setTimeout(onDone, 320);
}

export let renderedThrowSig = null;

// map-data.js needs to reset this cache when switching maps. Imported
// bindings can't be reassigned from outside this module, so expose a setter.
export function resetRenderedThrowSig() {
  renderedThrowSig = null;
}

export function renderMarkers(animate = true) {
  // The reposition overlay owns the marker/link layers while it's active —
  // don't let a stray re-render (zoom, filter toggle, etc.) wipe its dots.
  if (state.reposition) return;
  const visible = state.lineups.filter(lineupVisible);
  const mode = markMode();
  // A picked lineup always shows its landing and numbered throw spots, so
  // "throws" mode still draws the one landing for the selection. Its spots
  // then come from buildThrows below rather than the all-spots layer.
  const clusters = clusterLineups(mode === "throws" ? visible.filter(l => l.id === state.selectedLineupId) : visible);
  const spotClusters = mode === "landing" ? [] : clusterThrowSpots(visible.filter(l => l.id !== state.selectedLineupId));

  // Zooming changes the clustering distance threshold, so a cluster that was
  // fanned open can split apart (or a couple of separate markers can merge)
  // between one render and the next. If the fanned-open key no longer
  // matches any current cluster, drop it — otherwise every cluster below
  // gets hidden (each fails the "must match the open fan" check) and the
  // whole stack silently disappears from the map.
  if (state.openClusterKey && ![...clusters, ...spotClusters].some(c => clusterKey(c) === state.openClusterKey)) {
    state.openClusterKey = null;
  }

  // Work out what should be on the map right now.
  const desiredLandings = new Map();   // key -> { cluster, isPinned }
  let desiredFanKey = null, fanCluster = null;
  let pinnedCluster = null;

  for (const cluster of clusters) {
    const key = clusterKey(cluster);
    if (state.openClusterKey && state.openClusterKey !== key) continue;
    if (cluster.lineups.length > 1 && state.openClusterKey === key) {
      desiredFanKey = key; fanCluster = cluster; continue;
    }
    const isPinned = cluster.lineups.some(l => l.id === state.selectedLineupId);
    // While one lineup's throw lines are shown the rest stay on the map,
    // dimmed, so the user keeps their bearings (and can still switch).
    desiredLandings.set(key, { cluster, isPinned, dimmed: !!state.selectedLineupId && !isPinned });
    if (isPinned) pinnedCluster = cluster;
  }
  const desiredSpots = new Map();      // key -> cluster
  for (const cluster of spotClusters) {
    const key = clusterKey(cluster);
    if (state.openClusterKey && state.openClusterKey !== key) continue;
    if (cluster.lineups.length > 1 && state.openClusterKey === key) {
      desiredFanKey = key; fanCluster = cluster; continue;
    }
    desiredSpots.set(key, cluster);
  }

  // --- Fan wrap ---
  let fanKept = false;
  markerLayer.querySelectorAll(":scope > .cluster-fan").forEach(el => {
    if (el.dataset.mkey === desiredFanKey) fanKept = true;
    else el.remove();
  });
  if (desiredFanKey && !fanKept) renderClusterFan(fanCluster, desiredFanKey, animate);

  // --- Landing markers: keep matching keys, drop the rest, add the new ones ---
  let pinnedLandingEl = null;
  const seen = new Set();
  markerLayer.querySelectorAll(":scope > .marker.landing:not(.fan-hub)").forEach(el => {
    const key = el.dataset.mkey;
    const d = desiredLandings.get(key);
    if (d && !seen.has(key)) {
      // Keep it, or revive one that was mid fade-out (e.g. rapid fan open→close),
      // so we don't stack a second fading-in copy on top of it.
      seen.add(key);
      if (el._leaveTimer) { clearTimeout(el._leaveTimer); el._leaveTimer = null; }
      el.classList.remove("leaving");
      el.classList.toggle("pinned", !!d.isPinned);
      el.classList.toggle("dimmed", !!d.dimmed);
      if (hooks.badge) hooks.badge(el, d.cluster);
      if (d.isPinned) pinnedLandingEl = el;
    } else {
      if (el.classList.contains("leaving")) return;  // already fading out
      if (animate) { el.classList.add("leaving"); el._leaveTimer = setTimeout(() => el.remove(), 200); }
      else el.remove();
    }
  });
  desiredLandings.forEach((d, key) => {
    if (seen.has(key)) return;
    const el = buildLandingMarker(d.cluster, key, d.isPinned, animate);
    if (d.dimmed) el.classList.add("dimmed");
    markerLayer.appendChild(el);
    if (d.isPinned) pinnedLandingEl = el;
  });

  // --- Throw positions + link lines: only rebuild when the selection changes ---
  const openLineup = pinnedCluster && pinnedCluster.lineups.find(l => l.id === state.selectedLineupId);
  const throwSig = openLineup
    ? openLineup.id + "|" + openLineup.throws.map(t => `${t.pos.x},${t.pos.y}`).join(";")
    : null;
  if (throwSig !== renderedThrowSig) {
    markerLayer.querySelectorAll(":scope > .marker.throwpos:not(.spot)").forEach(el => el.remove());
    linkSvg.innerHTML = "";
    if (openLineup && pinnedLandingEl) buildThrows(openLineup, pinnedLandingEl, animate);
    renderedThrowSig = throwSig;
  }

  renderSpots(desiredSpots, mode === "both", !!state.selectedLineupId, animate);

  // Keep the sidebar lineup list's highlight in step with map selection.
  syncLineupListSelection();
  if (hooks.afterRender) hooks.afterRender();
}

export function buildLandingMarker(cluster, key, isPinned, animate) {
  const count = cluster.lineups.length;
  const sameType = count === 1 || cluster.lineups.every(l => l.type === cluster.lineups[0].type);
  const colorClass = sameType ? cluster.lineups[0].type : "multi";

  const landing = document.createElement("div");
  landing.className = `marker landing ${colorClass}${isPinned ? " pinned" : ""}${animate ? " enter" : ""}`;
  if (animate) landing.addEventListener("animationend", () => landing.classList.remove("enter"), { once: true });
  landing.dataset.mkey = key;
  landing.dataset.lids = cluster.lineups.map(l => l.id).join(",");  // read by multi-select
  if (count === 1) landing.dataset.lid = cluster.lineups[0].id; // read by the hover preview
  makeKeyboardButton(landing);
  landing.style.left = cluster.x + "%";
  landing.style.top = cluster.y + "%";

  if (!sameType) {
    const typeCounts = {};
    cluster.lineups.forEach(l => { typeCounts[l.type] = (typeCounts[l.type] || 0) + 1; });
    landing.style.background = buildPieGradient(typeCounts);
  }

  if (count > 1) {
    landing.title = `${count} lineups here`;
    const badge = document.createElement("span");
    badge.className = "marker-badge";
    badge.textContent = count;
    landing.appendChild(badge);
  } else {
    const totalThrows = cluster.lineups[0].throws.length;
    landing.title = totalThrows > 1
      ? `${totalThrows} throw positions for this lineup`
      : "Click to open this lineup";
    if (totalThrows > 1) {
      const badge = document.createElement("span");
      badge.className = "marker-badge sub";
      badge.textContent = totalThrows;
      landing.appendChild(badge);
    }
  }

  landing.setAttribute("aria-label", count > 1 ? `${count} lineups here` : (cluster.lineups[0].name || "Lineup") + " — " + landing.title);
  if (hooks.badge) hooks.badge(landing, cluster);
  landing.onclick = (e) => {
    e.stopPropagation();
    if (hooks.intercept && hooks.intercept(e, cluster.lineups)) return;
    if (count > 1) {
      state.openClusterKey = key;
      renderMarkers();
      return;
    }
    const lineup = cluster.lineups[0];
    if (state.selectedLineupId === lineup.id) openDetail(lineup.id);
    else pickLineup(lineup);
  };
  return landing;
}

// The all-spots layer of the "throws" and "both" modes, reconciled by cluster
// key like the landing marks so a re-render doesn't flicker them. In "both"
// each spot also gets a faint path to its landing, lit while hovered.
function renderSpots(desired, withLines, dimmed, animate) {
  const live = new Map();
  markerLayer.querySelectorAll(":scope > .marker.spot:not(.fan-hub)").forEach(el => {
    const key = el.dataset.mkey;
    const cluster = desired.get(key);
    if (cluster && !live.has(key)) {
      if (el._leaveTimer) { clearTimeout(el._leaveTimer); el._leaveTimer = null; }
      el.classList.remove("leaving");
      el.style.left = cluster.x + "%";
      el.style.top = cluster.y + "%";
      live.set(key, el);
    } else {
      if (el.classList.contains("leaving")) return;
      if (animate) { el.classList.add("leaving"); el._leaveTimer = setTimeout(() => el.remove(), 200); }
      else el.remove();
    }
  });
  desired.forEach((cluster, key) => {
    if (live.has(key)) return;
    const el = buildSpotMarker(cluster, key, animate);
    markerLayer.appendChild(el);
    live.set(key, el);
  });

  linkSvg.querySelectorAll(":scope > .spot-line").forEach(l => l.remove());
  live.forEach((el, key) => {
    el.classList.toggle("dimmed", dimmed);
    const cluster = desired.get(key);
    const lines = !withLines ? [] : cluster.lineups.map((lineup, i) => {
      const pos = lineup.throws[cluster.throwIdxs[i]].pos;
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", pos.x + "%");
      line.setAttribute("y1", pos.y + "%");
      line.setAttribute("x2", lineup.landing.x + "%");
      line.setAttribute("y2", lineup.landing.y + "%");
      const linkColor = getCssVarColor(typeColor(lineup.type));
      line.setAttribute("stroke", linkColor);
      line.style.color = linkColor;
      line.setAttribute("class", "link-line spot-line" + (dimmed ? " dimmed" : ""));
      linkSvg.appendChild(line);
      return line;
    });
    el.onmouseenter = () => lines.forEach(l => l.classList.add("glow"));
    el.onmouseleave = () => lines.forEach(l => l.classList.remove("glow"));
  });
}

function buildSpotMarker(cluster, key, animate) {
  const count = cluster.lineups.length;
  const sameType = cluster.lineups.every(l => l.type === cluster.lineups[0].type);

  const spot = document.createElement("div");
  spot.className = `marker throwpos spot ${sameType ? cluster.lineups[0].type : "multi"}${animate ? " enter" : ""}`;
  if (animate) spot.addEventListener("animationend", () => spot.classList.remove("enter"), { once: true });
  spot.dataset.mkey = key;
  spot.style.left = cluster.x + "%";
  spot.style.top = cluster.y + "%";
  makeKeyboardButton(spot);

  if (!sameType) {
    const typeCounts = {};
    cluster.lineups.forEach(l => { typeCounts[l.type] = (typeCounts[l.type] || 0) + 1; });
    spot.style.background = buildPieGradient(typeCounts);
  }

  if (count > 1) {
    spot.title = `${count} throw spots here`;
    spot.setAttribute("aria-label", spot.title);
    const badge = document.createElement("span");
    badge.className = "marker-badge";
    badge.textContent = count;
    spot.appendChild(badge);
    spot.onclick = (e) => {
      e.stopPropagation();
      state.openClusterKey = key;
      renderMarkers();
    };
    return spot;
  }

  const lineup = cluster.lineups[0];
  const throwIdx = cluster.throwIdxs[0];
  spot.dataset.lid = lineup.id;          // read by the hover preview and multi-select
  spot.dataset.tidx = String(throwIdx);
  spot.title = "Click to open this lineup";
  if (lineup.throws.length > 1) {
    const num = document.createElement("span");
    num.className = "throw-num";
    num.setAttribute("aria-hidden", "true");
    num.textContent = String(throwIdx + 1);
    spot.appendChild(num);
  }
  spot.setAttribute("aria-label", `Open ${lineup.name || "lineup"}, throw position ${throwIdx + 1}`);
  spot.onclick = (e) => {
    e.stopPropagation();
    if (hooks.interceptThrow && hooks.interceptThrow(e, lineup, throwIdx)) return;
    openDetail(lineup.id, throwIdx);
  };
  return spot;
}

export function buildThrows(openLineup, landingEl, animate) {
  const lines = [];
  openLineup.throws.forEach((t, throwIdx) => {
    const tp = document.createElement("div");
    tp.className = `marker throwpos ${openLineup.type}${animate ? " enter" : ""}`;
    if (animate) tp.addEventListener("animationend", () => tp.classList.remove("enter"), { once: true });
    tp.style.left = t.pos.x + "%";
    tp.style.top = t.pos.y + "%";
    tp.title = "Click to open this lineup";
    tp.dataset.lid = openLineup.id;     // read by the hover preview
    tp.dataset.tidx = String(throwIdx);
    // Variant number, so the spots on the map match "VARIANT 0N" in the dossier.
    if (openLineup.throws.length > 1) {
      const num = document.createElement("span");
      num.className = "throw-num";
      num.setAttribute("aria-hidden", "true");
      num.textContent = String(throwIdx + 1);
      tp.appendChild(num);
    }
    makeKeyboardButton(tp);
    tp.setAttribute("aria-label", `Open ${openLineup.name || "lineup"}, throw position ${throwIdx + 1}`);
    tp.onclick = (e) => {
      e.stopPropagation();
      if (hooks.interceptThrow && hooks.interceptThrow(e, openLineup, throwIdx)) return;
      openDetail(openLineup.id, throwIdx);
    };
    markerLayer.appendChild(tp);

    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", t.pos.x + "%");
    line.setAttribute("y1", t.pos.y + "%");
    line.setAttribute("x2", openLineup.landing.x + "%");
    line.setAttribute("y2", openLineup.landing.y + "%");
    const linkColor = getCssVarColor(typeColor(openLineup.type));
    line.setAttribute("stroke", linkColor);
    line.style.color = linkColor;
    line.setAttribute("class", "link-line");
    linkSvg.appendChild(line);
    lines.push(line);

    // Glow only the path for the hovered throw position.
    tp.onmouseenter = () => line.classList.add("glow");
    tp.onmouseleave = () => line.classList.remove("glow");
  });

  // Hovering the lineup marker itself glows all of its paths (onmouseenter
  // property assignment overwrites cleanly if the landing element is reused).
  landingEl.onmouseenter = () => lines.forEach(l => l.classList.add("glow"));
  landingEl.onmouseleave = () => lines.forEach(l => l.classList.remove("glow"));
}

// The clustering distance depends on the rendered map size, so re-cluster
// when the window (and with it the radar) changes size.
let resizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (state.lineups.length) renderMarkers(false); }, 150);
});
