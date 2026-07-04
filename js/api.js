import { authHeaders } from "./auth.js";
import { state } from "./state.js";

export const API_URL = "/api/lineups";

export const SAVED_URL = "/api/saved-lineups";

export async function dbGetAll() {
  const res = await fetch(`${API_URL}?mapId=${encodeURIComponent(state.mapId)}`);
  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(`Failed to load lineups (${res.status}): ${msg}`);
  }
  return res.json();
}

export async function dbGetAllMaps() {
  // Fetch official lineups across every map, for export
  const res = await fetch(API_URL);
  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(`Failed to fetch all lineups (${res.status}): ${msg}`);
  }
  return res.json();
}

export async function dbGetMine() {
  const headers = await authHeaders();
  const res = await fetch(`${API_URL}?mapId=${encodeURIComponent(state.mapId)}&mine=true`, { headers });
  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(`Failed to load your lineups (${res.status}): ${msg}`);
  }
  return res.json();
}

export async function dbGetSaved() {
  const headers = await authHeaders();
  const res = await fetch(`${SAVED_URL}?mapId=${encodeURIComponent(state.mapId)}`, { headers });
  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(`Failed to load saved lineups (${res.status}): ${msg}`);
  }
  return res.json();
}

export async function dbSaveLineup(lineupId, throwId) {
  const headers = await authHeaders();
  const res = await fetch(SAVED_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ lineupId, throwId }),
  });
  if (!res.ok) throw new Error("Failed to save this throw position to your map");
}

export async function dbUnsaveLineup(lineupId, throwId) {
  const headers = await authHeaders();
  const res = await fetch(`${SAVED_URL}?lineupId=${encodeURIComponent(lineupId)}&throwId=${encodeURIComponent(throwId)}`, {
    method: "DELETE",
    headers,
  });
  if (!res.ok) throw new Error("Failed to remove this throw position from your map");
}

export function throwKey(lineupId, throwId) {
  return `${lineupId}::${throwId}`;
}

export function buildSavedThrowKeys(savedLineups) {
  const keys = new Set();
  savedLineups.forEach(l => l.throws.forEach(t => keys.add(throwKey(l.id, t.id))));
  return keys;
}

export async function dbPut(record, isOfficial) {
  const headers = await authHeaders();
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ ...record, isOfficial: !!isOfficial }),
  });
  if (res.status === 401) throw new Error("SIGN_IN_REQUIRED");
  if (res.status === 403) throw new Error("FORBIDDEN");
  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(`Failed to save lineup (${res.status}): ${msg}`);
  }
  return res.json();
}

export async function dbDelete(id) {
  const headers = await authHeaders();
  const res = await fetch(`${API_URL}?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers,
  });
  if (res.status === 401) throw new Error("SIGN_IN_REQUIRED");
  if (res.status === 403) throw new Error("FORBIDDEN");
  if (!res.ok) throw new Error("Failed to delete lineup");
}

export async function dbImportBulk(records) {
  const headers = await authHeaders();
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ records }),
  });
  if (res.status === 401) throw new Error("SIGN_IN_REQUIRED");
  if (res.status === 403) throw new Error("FORBIDDEN");
  if (!res.ok) throw new Error("Failed to import lineups");
}
