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

// Opt a personal lineup in to (submit = true) or out of publication on the
// public map. Admins can only publish lineups that are submitted.
export async function dbSubmitLineup(id, submit) {
  const headers = await authHeaders();
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ id, action: "submit", submit: !!submit }),
  });
  if (res.status === 401) throw new Error("SIGN_IN_REQUIRED");
  if (res.status === 403) throw new Error("FORBIDDEN");
  if (!res.ok) throw new Error("Failed to update submission");
  return res.json();
}

// Turn link sharing on/off for one of your personal lineups.
export async function dbShareLineup(id, shared) {
  const headers = await authHeaders();
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ id, action: "share", shared: !!shared }),
  });
  if (res.status === 401) throw new Error("SIGN_IN_REQUIRED");
  if (!res.ok) throw new Error("Failed to update sharing");
  return res.json();
}

// One lineup by id: official, yours, or a personal one whose owner shared its
// link. Resolves null when it doesn't exist or isn't shared with you.
export async function dbGetLineup(id) {
  const headers = await authHeaders().catch(() => ({}));
  const res = await fetch(`${API_URL}?id=${encodeURIComponent(id)}`, { headers });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to load the lineup (${res.status})`);
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
