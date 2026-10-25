// Undo-able deletes. Instead of asking "are you sure?" up front, a delete
// takes effect in the UI immediately and shows "Deleted · Undo" for a few
// seconds; the real API request only goes out when that window closes. Undo
// just puts the local state back — nothing was sent yet.
//
//   deferDelete({
//     key: `lineup:${id}`,          // one pending delete per key
//     message: "Lineup deleted",
//     apply()   { ...remove locally... },
//     restore() { ...put it back... },
//     request:  { method: "DELETE", url: `/api/lineups?id=${id}` },
//     onError(err) { ... },          // optional; restore() has already run
//   });
//
// `request.body` may be a function, evaluated when the request is actually
// sent, so a deferred lineup save always carries the latest local state.
//
// Pending deletes are flushed (sent immediately) when:
//  - the page is going away (pagehide): sent with fetch keepalive so the
//    request survives the unload, using auth headers resolved up front
//    (there's no time to await a token refresh during unload);
//  - a second deferDelete arrives with the same key (e.g. removing two
//    variants of one lineup back to back): the first goes out right away so
//    the two changes can't race;
//  - flushPendingDeletes() is called, which map-data.js does before every
//    lineup reload so a refetch can never resurrect a not-yet-deleted item.
import { authHeaders } from "./auth.js";
import { toast, toastError } from "./toast.js";

const UNDO_WINDOW_MS = 6000;
const pending = new Map(); // key -> entry

export function deferDelete({ key, message = "Deleted", apply, restore, request, onError, undoLabel = "Undo" }) {
  const prev = pending.get(key);
  if (prev) commit(prev);

  apply();

  const entry = { key, restore, request, onError, headers: null, timer: null, toast: null, done: false };
  pending.set(key, entry);
  // Resolve auth now so a pagehide flush has headers ready synchronously.
  entry.headersReady = authHeaders().then(h => { entry.headers = h; }).catch(() => {});

  entry.toast = toast(message, {
    duration: UNDO_WINDOW_MS,
    action: { label: undoLabel, onClick: () => undo(entry) },
  });
  entry.timer = setTimeout(() => commit(entry), UNDO_WINDOW_MS);
  return { undo: () => undo(entry), commit: () => commit(entry) };
}

function undo(entry) {
  if (entry.done) return;
  entry.done = true;
  clearTimeout(entry.timer);
  pending.delete(entry.key);
  if (entry.toast) entry.toast.dismiss();
  try { entry.restore && entry.restore(); } catch (err) { console.error(err); }
}

function buildInit(entry, extra) {
  const { method = "DELETE", body } = entry.request;
  const payload = typeof body === "function" ? body() : body;
  const headers = { ...(entry.headers || {}) };
  if (payload != null) headers["Content-Type"] = "application/json";
  return { method, headers, body: payload != null ? (typeof payload === "string" ? payload : JSON.stringify(payload)) : undefined, ...extra };
}

async function commit(entry) {
  if (entry.done) return;
  entry.done = true;
  clearTimeout(entry.timer);
  pending.delete(entry.key);
  if (entry.toast) entry.toast.dismiss();
  try {
    await entry.headersReady;
    if (!entry.headers || !entry.headers.Authorization) entry.headers = await authHeaders();
    const res = await fetch(entry.request.url, buildInit(entry));
    if (!res.ok) throw new Error(res.status === 403 ? "You don't have permission to do that." : `Request failed (${res.status})`);
  } catch (err) {
    console.error(err);
    try { entry.restore && entry.restore(); } catch (e) { console.error(e); }
    if (entry.onError) entry.onError(err);
    else toastError("Couldn't delete. It has been restored.");
  }
}

// Send every pending delete now. Resolves once they have all settled.
export function flushPendingDeletes() {
  return Promise.all([...pending.values()].map(commit));
}

export function hasPendingDeletes() {
  return pending.size > 0;
}

window.addEventListener("pagehide", () => {
  for (const entry of pending.values()) {
    if (entry.done) continue;
    entry.done = true;
    clearTimeout(entry.timer);
    try { fetch(entry.request.url, buildInit(entry, { keepalive: true })); } catch (err) { /* page is closing */ }
  }
  pending.clear();
});
