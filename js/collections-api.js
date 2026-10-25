// Thin client for /api/collections. Every call throws an Error carrying the
// server's message, so callers can surface it in a toast and roll back.
import { authHeaders } from "./auth.js";

const URL_BASE = "/api/collections";

async function request(method, query, body) {
  const res = await fetch(URL_BASE + (query || ""), {
    method,
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const e = new Error(err.error || `Request failed (${res.status})`);
    e.status = res.status;
    throw e;
  }
  return res.json();
}

const post = (body) => request("POST", "", body);

export const listMine = (mapId) => request("GET", `?mine=1&mapId=${encodeURIComponent(mapId)}`);
export const getById = (id) => request("GET", `?id=${encodeURIComponent(id)}`);
export const getBySlug = (slug) => request("GET", `?slug=${encodeURIComponent(slug)}`);
export const createCollection = (mapId, name, description = "", items) => post({ action: "create", mapId, name, description, items });
export const updateCollection = (id, patch) => post({ action: "update", id, ...patch });
export const deleteCollection = (id) => request("DELETE", `?id=${encodeURIComponent(id)}`);
export const addItems = (id, items) => post({ action: "add-items", id, items });
export const removeItem = (id, target) => post({ action: "remove-item", id, ...target });
export const reorderItems = (id, order) => post({ action: "reorder", id, order });
export const updateItem = (id, itemId, patch) => post({ action: "update-item", id, itemId, ...patch });
export const forkCollection = (ref) => post({ action: "fork", ...ref });
export const reportCollection = (slug, reason, details) => post({ action: "report", slug, reason, details });

export const shareUrl = (slug) => `${location.origin}/c/${slug}`;
