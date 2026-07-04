import { TYPES } from "./constants.js";
import { openDetail } from "./detail-panel.js";
import { linkSvg, markerLayer } from "./dom.js";
import { zoom } from "./pan-zoom.js";
import { state } from "./state.js";

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

export function clusterLineups(list) {
  const THRESHOLD = 3.5 / zoom;
  const clusters = [];
  list.forEach(lineup => {
    const c = clusters.find(cl => Math.hypot(cl.x - lineup.landing.x, cl.y - lineup.landing.y) < THRESHOLD);
    if (c) {
      c.lineups.push(lineup);
      c.x = c.lineups.reduce((s, l) => s + l.landing.x, 0) / c.lineups.length;
      c.y = c.lineups.reduce((s, l) => s + l.landing.y, 0) / c.lineups.length;
    } else {
      clusters.push({ x: lineup.landing.x, y: lineup.landing.y, lineups: [lineup] });
    }
  });
  return clusters;
}

export function clusterKey(cluster) {
  // Include each lineup's throw count so that saving/removing an individual
  // throw position (which changes the marker's badge number) counts as a
  // real change in cluster identity — otherwise the reconciler below sees
  // "same lineup ids here" and leaves the stale marker/badge in place.
  return cluster.lineups.map(l => `${l.id}:${l.throws.length}`).sort().join(",");
}

export function renderClusterFan(cluster, key, animate = true) {
  const count = cluster.lineups.length;
  const radius = 46;
  const lineRadius = 28;
  const startAngle = -90;
  const step = 360 / count;

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
  hub.className = "marker landing fan-hub pinned";
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
    const label = lineup.name || `${typeInfo.label} #${i + 1}`;
    const dot = document.createElement("div");
    dot.className = "fan-petal-dot";
    dot.style.background = typeInfo.color;
    dot.style.color = getCssVarColor(typeInfo.color);  // for the currentColor hover glow
    const labelEl = document.createElement("div");
    labelEl.className = "fan-petal-label";
    labelEl.textContent = label;
    petal.appendChild(dot);
    petal.appendChild(labelEl);
    petal.onclick = (e) => {
      e.stopPropagation();
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
      hub.onclick = (e2) => {
        e2.stopPropagation();
        if (count > 1) { state.openClusterKey = key; renderMarkers(); return; }
        const only = cluster.lineups[0];
        if (state.selectedLineupId === only.id) openDetail(only.id);
        else { state.selectedLineupId = only.id; renderMarkers(); }
      };
      markerLayer.appendChild(hub);

      wrap.remove();
      renderMarkers();               // throw positions for the pick appear immediately
      markerLayer.appendChild(wrap); // put the (now hub-less) fan back on top to collapse
      collapseFan(wrap, lineEls, petalEls, () => wrap.remove());
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
  const visible = state.lineups.filter(l => state.activeFilters.has(l.type));
  const clusters = clusterLineups(visible);

  // Zooming changes the clustering distance threshold, so a cluster that was
  // fanned open can split apart (or a couple of separate markers can merge)
  // between one render and the next. If the fanned-open key no longer
  // matches any current cluster, drop it — otherwise every cluster below
  // gets hidden (each fails the "must match the open fan" check) and the
  // whole stack silently disappears from the map.
  if (state.openClusterKey && !clusters.some(c => clusterKey(c) === state.openClusterKey)) {
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
    if (state.selectedLineupId && !isPinned) continue;
    desiredLandings.set(key, { cluster, isPinned });
    if (isPinned) pinnedCluster = cluster;
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
    markerLayer.appendChild(el);
    if (d.isPinned) pinnedLandingEl = el;
  });

  // --- Throw positions + link lines: only rebuild when the selection changes ---
  const openLineup = pinnedCluster && pinnedCluster.lineups.find(l => l.id === state.selectedLineupId);
  const throwSig = openLineup
    ? openLineup.id + "|" + openLineup.throws.map(t => `${t.pos.x},${t.pos.y}`).join(";")
    : null;
  if (throwSig !== renderedThrowSig) {
    markerLayer.querySelectorAll(":scope > .marker.throwpos").forEach(el => el.remove());
    linkSvg.innerHTML = "";
    if (openLineup && pinnedLandingEl) buildThrows(openLineup, pinnedLandingEl, animate);
    renderedThrowSig = throwSig;
  }
}

export function buildLandingMarker(cluster, key, isPinned, animate) {
  const count = cluster.lineups.length;
  const sameType = count === 1 || cluster.lineups.every(l => l.type === cluster.lineups[0].type);
  const colorClass = sameType ? cluster.lineups[0].type : "multi";

  const landing = document.createElement("div");
  landing.className = `marker landing ${colorClass}${isPinned ? " pinned" : ""}${animate ? " enter" : ""}`;
  if (animate) landing.addEventListener("animationend", () => landing.classList.remove("enter"), { once: true });
  landing.dataset.mkey = key;
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
      : "Click to see throw position";
    if (totalThrows > 1) {
      const badge = document.createElement("span");
      badge.className = "marker-badge sub";
      badge.textContent = totalThrows;
      landing.appendChild(badge);
    }
  }

  landing.onclick = (e) => {
    e.stopPropagation();
    if (count > 1) {
      state.openClusterKey = key;
      renderMarkers();
      return;
    }
    const lineup = cluster.lineups[0];
    if (state.selectedLineupId === lineup.id) {
      openDetail(lineup.id);
    } else {
      state.selectedLineupId = lineup.id;
      renderMarkers();
    }
  };
  return landing;
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
    tp.onclick = (e) => { e.stopPropagation(); openDetail(openLineup.id, throwIdx); };
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
