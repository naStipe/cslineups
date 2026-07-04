// Standalone admin screenshot-review dashboard (admin.html). Reactive
// moderation: browse the screenshots users have uploaded for their personal
// lineups, approve a lineup (mark it reviewed so it leaves the pending queue)
// or reject content (delete a single screenshot, or a whole lineup). All the
// heavy lifting — signed URLs for private images, owner emails, deletions —
// happens server-side in /api/admin under the service key; this file only
// talks to that endpoint plus Supabase auth for the session token.

import { MAPS, MOVEMENT_LABELS, RANGE_LABELS, TYPES } from "./constants.js";
import { escapeHtml } from "./html-utils.js";

const MAP_NAMES = Object.fromEntries(MAPS.map(m => [m.id, m.name]));
const TYPE_LABELS = Object.fromEntries(TYPES.map(t => [t.id, t.label]));

const el = (id) => document.getElementById(id);
const els = {};
["statusToggle", "adminEmail", "adminSignOut", "adminSignin", "adminError",
 "adminEmailInput", "adminPasswordInput", "adminSigninBtn", "adminGoogleBtn",
 "adminDenied", "adminMain", "adminHint", "adminQueue",
 "adminLightbox", "adminLightboxImg", "adminLightboxClose"].forEach(id => { els[id] = el(id); });

let sb = null;
let status = "unreviewed";

async function loadConfig() {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch("/api/config");
      if (!res.ok) continue;
      const cfg = await res.json();
      if (cfg.supabaseUrl && cfg.supabaseAnonKey) {
        window.__SUPABASE_URL = cfg.supabaseUrl;
        window.__SUPABASE_ANON_KEY = cfg.supabaseAnonKey;
        return true;
      }
    } catch (e) { console.warn("Config attempt", attempt + 1, "failed:", e); }
  }
  return false;
}

async function accessToken() {
  // This page's client is "cold": it adopts the session the main page wrote
  // to localStorage rather than one it minted itself. getSession() can then
  // hand back a token that's already expired (or about to be) before the
  // client's background refresh has run — sending that stale token is what
  // produced a 401 from /api/admin even though the page looked signed in.
  // Force a refresh when the token is within a minute of expiry so the API
  // only ever sees a live token.
  let { data } = await sb.auth.getSession();
  let session = data && data.session;
  if (!session) return null;
  const expMs = (session.expires_at || 0) * 1000;
  if (expMs && expMs - Date.now() < 60_000) {
    const refreshed = await sb.auth.refreshSession();
    if (!refreshed.error && refreshed.data && refreshed.data.session) session = refreshed.data.session;
  }
  return session.access_token || null;
}

async function authHeaders() {
  const token = await accessToken();
  return token ? { "Authorization": `Bearer ${token}` } : {};
}

function show(node, visible) { if (node) node.hidden = !visible; }

// ---- View gating ---------------------------------------------------------

async function render() {
  const { data } = await sb.auth.getSession();
  const session = data && data.session;

  if (!session) {
    show(els.adminSignin, true);
    show(els.adminDenied, false);
    show(els.adminMain, false);
    show(els.statusToggle, false);
    show(els.adminSignOut, false);
    els.adminEmail.textContent = "";
    return;
  }

  els.adminEmail.textContent = session.user.email || "";
  show(els.adminSignOut, true);
  show(els.adminSignin, false);

  // Confirm admin by reading the profile flag directly (the API enforces it
  // too, but this drives which panel to show).
  const { data: profile } = await sb.from("profiles").select("is_admin").eq("id", session.user.id).maybeSingle();
  if (!profile || !profile.is_admin) {
    show(els.adminDenied, true);
    show(els.adminMain, false);
    show(els.statusToggle, false);
    return;
  }

  show(els.adminDenied, false);
  show(els.adminMain, true);
  show(els.statusToggle, true);
  await loadQueue();
}

// ---- Queue ---------------------------------------------------------------

async function loadQueue() {
  els.adminHint.textContent = "Loading…";
  els.adminQueue.innerHTML = "";
  let payload;
  try {
    const res = await fetch(`/api/admin?status=${encodeURIComponent(status)}`, { headers: await authHeaders() });
    if (!res.ok) throw new Error(await res.text().catch(() => `HTTP ${res.status}`));
    payload = await res.json();
  } catch (e) {
    els.adminHint.textContent = `Failed to load queue: ${e.message}`;
    return;
  }

  const items = payload.items || [];
  if (!items.length) {
    els.adminHint.textContent = status === "unreviewed"
      ? "Nothing pending — all uploaded screenshots have been reviewed. 🎉"
      : "No personal lineups with uploaded screenshots yet.";
    return;
  }
  const shots = items.reduce((n, it) => n + it.throws.reduce((m, t) => m + t.images.length, 0), 0);
  els.adminHint.textContent = `${items.length} lineup${items.length === 1 ? "" : "s"} · ${shots} screenshot${shots === 1 ? "" : "s"}`;

  items.forEach(item => els.adminQueue.appendChild(renderCard(item)));
}

const SLOT_LABELS = { standing: "Where to stand", screenshots: "Where to aim", precise: "Precise" };

function renderCard(item) {
  const card = document.createElement("div");
  card.className = "admin-card";
  if (item.reviewedAt) card.classList.add("is-reviewed");

  const mapName = MAP_NAMES[item.mapId] || item.mapId;
  const typeLabel = TYPE_LABELS[item.type] || item.type;
  const date = item.createdAt ? new Date(Number(item.createdAt) || item.createdAt).toLocaleDateString() : "";

  const throwsHtml = item.throws.map(t => {
    const meta = [RANGE_LABELS[t.range] || t.range, MOVEMENT_LABELS[t.movement] || t.movement].filter(Boolean).join(" · ");
    const imgsHtml = t.images.map(img => `
      <figure class="admin-shot" data-slot="${escapeHtml(img.slot)}">
        <img loading="lazy" src="${escapeHtml(img.viewUrl)}" data-full="${escapeHtml(img.viewUrl)}" alt="${escapeHtml(SLOT_LABELS[img.slot] || img.slot)}">
        <figcaption>${escapeHtml(SLOT_LABELS[img.slot] || img.slot)}</figcaption>
        <button class="admin-shot-reject" data-lineup="${escapeHtml(item.id)}" data-url="${escapeHtml(img.url)}" title="Reject this screenshot">✕</button>
      </figure>`).join("");
    return `
      <div class="admin-throw">
        <p class="admin-throw-meta">${escapeHtml(meta)}${t.notes ? ` — <span class="admin-throw-notes">${escapeHtml(t.notes)}</span>` : ""}</p>
        <div class="admin-shots">${imgsHtml}</div>
      </div>`;
  }).join("");

  card.innerHTML = `
    <div class="admin-card-head">
      <div>
        <span class="type-chip">${escapeHtml(typeLabel)}</span>
        <strong class="admin-card-name">${escapeHtml(item.name || "Unnamed position")}</strong>
        <span class="admin-card-sub">${escapeHtml(mapName)}${date ? ` · ${escapeHtml(date)}` : ""}</span>
      </div>
      <div class="admin-card-owner">${escapeHtml(item.ownerEmail || item.ownerId || "unknown")}</div>
    </div>
    ${throwsHtml}
    <div class="admin-card-actions">
      ${item.reviewedAt
        ? `<button class="ghost-btn" data-action="unreview" data-lineup="${escapeHtml(item.id)}">↩ Move back to pending</button>`
        : `<button class="primary-btn" data-action="approve" data-lineup="${escapeHtml(item.id)}">✓ Approve (mark reviewed)</button>`}
      <button class="ghost-btn admin-publish" data-action="publish" data-lineup="${escapeHtml(item.id)}">★ Publish to official map</button>
      <button class="ghost-btn danger" data-action="delete-lineup" data-lineup="${escapeHtml(item.id)}">Delete whole lineup</button>
    </div>`;

  card.querySelectorAll("img[data-full]").forEach(img => {
    img.onclick = () => { els.adminLightboxImg.src = img.dataset.full; els.adminLightbox.classList.add("show"); };
  });
  card.querySelectorAll(".admin-shot-reject").forEach(btn => {
    btn.onclick = () => rejectImage(btn.dataset.lineup, btn.dataset.url, btn.closest(".admin-shot"), card);
  });
  card.querySelector('[data-action="approve"]')?.addEventListener("click", () => markReviewed(item.id, "approve", card));
  card.querySelector('[data-action="unreview"]')?.addEventListener("click", () => markReviewed(item.id, "unreview", card));
  card.querySelector('[data-action="publish"]')?.addEventListener("click", () => publishLineup(item.id, card));
  card.querySelector('[data-action="delete-lineup"]')?.addEventListener("click", () => deleteLineup(item.id, card));

  return card;
}

// ---- Actions -------------------------------------------------------------

// All three actions update the DOM immediately and fire the server request in
// the background — the click feels instant instead of waiting on a round-trip
// (and, for approve, on a full queue reload that re-signs every image URL). If
// the request fails we put the removed node/state back and surface the error.
// Re-inserting the same node preserves its event listeners, so restored cards
// stay fully interactive.

async function sendAction(method, urlSuffix, body) {
  const opts = { method, headers: await authHeaders() };
  if (body) { opts.headers = { "Content-Type": "application/json", ...opts.headers }; opts.body = JSON.stringify(body); }
  const res = await fetch(`/api/admin${urlSuffix}`, opts);
  if (!res.ok) throw new Error(await res.text().catch(() => `HTTP ${res.status}`));
}

// Removes a node now, returning a restore() that puts it back where it was.
function detach(node) {
  const parent = node.parentNode;
  const next = node.nextSibling;
  node.remove();
  return () => { if (parent) parent.insertBefore(node, next); };
}

// Rebuilds a card's reviewed styling + primary action button in place, so we
// don't have to reload the whole queue just to flip one lineup's state.
function setCardReviewed(card, lineupId, reviewed) {
  card.classList.toggle("is-reviewed", reviewed);
  const oldBtn = card.querySelector('[data-action="approve"], [data-action="unreview"]');
  if (!oldBtn) return;
  const btn = document.createElement("button");
  if (reviewed) {
    btn.className = "ghost-btn"; btn.dataset.action = "unreview";
    btn.textContent = "↩ Move back to pending";
    btn.onclick = () => markReviewed(lineupId, "unreview", card);
  } else {
    btn.className = "primary-btn"; btn.dataset.action = "approve";
    btn.textContent = "✓ Approve (mark reviewed)";
    btn.onclick = () => markReviewed(lineupId, "approve", card);
  }
  oldBtn.replaceWith(btn);
}

function rejectImage(lineupId, url, figure, card) {
  if (!confirm("Reject this screenshot? It will be permanently deleted.")) return;
  const restoreFigure = detach(figure);
  // If that was the last screenshot on the whole lineup, the card has nothing
  // left to moderate — drop it too (and be ready to restore it on failure).
  const restoreCard = card.querySelector(".admin-shot") ? null : detach(card);
  refreshCounts();
  sendAction("DELETE", `?lineupId=${encodeURIComponent(lineupId)}&url=${encodeURIComponent(url)}`).catch(e => {
    if (restoreCard) restoreCard();
    restoreFigure();
    refreshCounts();
    alert(`Failed to reject: ${e.message}`);
  });
}

function markReviewed(lineupId, action, card) {
  const reviewed = action === "approve";
  let restore;
  if (status === "unreviewed" && reviewed) {
    // Approving in the pending view: the lineup leaves the queue entirely.
    const put = detach(card);
    refreshCounts();
    restore = () => { put(); refreshCounts(); };
  } else {
    setCardReviewed(card, lineupId, reviewed);
    restore = () => setCardReviewed(card, lineupId, !reviewed);
  }
  sendAction("POST", "", { action, lineupId }).catch(e => {
    restore();
    alert(`Failed: ${e.message}`);
  });
}

function deleteLineup(lineupId, card) {
  if (!confirm("Delete this entire lineup and all its screenshots? This cannot be undone.")) return;
  const restore = detach(card);
  refreshCounts();
  sendAction("DELETE", `?lineupId=${encodeURIComponent(lineupId)}`).catch(e => {
    restore();
    refreshCounts();
    alert(`Failed to delete: ${e.message}`);
  });
}

// Publishing copies every screenshot to the public bucket server-side, so it
// takes a moment — show a busy state and only remove the card on success,
// rather than optimistically (a failure would otherwise flash it out and back).
function publishLineup(lineupId, card) {
  if (!confirm("Publish this lineup and its screenshots to the official public map?\n\nIt becomes visible to everyone, the submitter's private copy is converted, and it leaves your review queue.")) return;
  const buttons = [...card.querySelectorAll(".admin-card-actions button")];
  const publishBtn = card.querySelector('[data-action="publish"]');
  const label = publishBtn ? publishBtn.textContent : "";
  buttons.forEach(b => { b.disabled = true; });
  card.classList.add("is-busy");
  if (publishBtn) publishBtn.textContent = "Publishing…";
  sendAction("POST", "", { action: "publish", lineupId })
    .then(() => { detach(card); refreshCounts(); })
    .catch(e => {
      card.classList.remove("is-busy");
      buttons.forEach(b => { b.disabled = false; });
      if (publishBtn) publishBtn.textContent = label;
      alert(`Failed to publish: ${e.message}`);
    });
}

// Recompute the header count line from what's still on the page (avoids a
// full reload after a single removal).
async function refreshCounts() {
  const cards = els.adminQueue.querySelectorAll(".admin-card");
  if (!cards.length) {
    els.adminHint.textContent = status === "unreviewed"
      ? "Nothing pending — all uploaded screenshots have been reviewed. 🎉"
      : "No personal lineups with uploaded screenshots yet.";
    return;
  }
  const shots = els.adminQueue.querySelectorAll(".admin-shot").length;
  els.adminHint.textContent = `${cards.length} lineup${cards.length === 1 ? "" : "s"} · ${shots} screenshot${shots === 1 ? "" : "s"}`;
}

// ---- Wiring --------------------------------------------------------------

function wireEvents() {
  els.statusToggle.querySelectorAll("button").forEach(btn => {
    btn.onclick = () => {
      status = btn.dataset.status;
      els.statusToggle.querySelectorAll("button").forEach(b => b.classList.toggle("active", b === btn));
      loadQueue();
    };
  });

  els.adminSigninBtn.onclick = async () => {
    els.adminError.hidden = true;
    const email = els.adminEmailInput.value.trim();
    const password = els.adminPasswordInput.value;
    try {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
    } catch (e) {
      els.adminError.textContent = e.message || "Sign in failed";
      els.adminError.hidden = false;
    }
  };
  els.adminPasswordInput.onkeydown = (e) => { if (e.key === "Enter") els.adminSigninBtn.click(); };

  els.adminGoogleBtn.onclick = async () => {
    await sb.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin + window.location.pathname, queryParams: { prompt: "select_account" } },
    });
  };

  els.adminSignOut.onclick = async () => { await sb.auth.signOut(); };

  const closeLightbox = () => els.adminLightbox.classList.remove("show");
  els.adminLightboxClose.onclick = closeLightbox;
  els.adminLightbox.onclick = (e) => { if (e.target === els.adminLightbox) closeLightbox(); };
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeLightbox(); });
}

// ---- Boot ----------------------------------------------------------------

// onAuthStateChange fires more than once for the same signed-in user —
// INITIAL_SESSION on subscribe, then TOKEN_REFRESHED when the cold client
// refreshes the adopted session. Re-running render() (and thus reloading the
// whole queue) on those benign events is what made the pending list flicker
// and load twice. Gate rendering on the actual identity so we only re-render
// when who's signed in genuinely changes.
let renderedUserId = Symbol("unset"); // sentinel: distinct from any uid or null
async function syncAuth() {
  const { data } = await sb.auth.getSession();
  const uid = data && data.session ? data.session.user.id : null;
  if (uid === renderedUserId) return;
  renderedUserId = uid;
  await render();
}

(async function init() {
  els.adminHint.textContent = "Connecting…";
  const ok = await loadConfig();
  if (!ok) { els.adminHint.textContent = "Config unavailable — check SUPABASE_URL / SUPABASE_ANON_KEY."; return; }
  sb = window.supabase.createClient(window.__SUPABASE_URL, window.__SUPABASE_ANON_KEY);
  wireEvents();
  await syncAuth();
  // React to real sign-in/out changes (including OAuth redirect completing).
  sb.auth.onAuthStateChange(() => syncAuth());
})();
