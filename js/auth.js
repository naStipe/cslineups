import { appShell, authEmailLabel, personalViewBtn } from "./dom.js";
import { loadLineups } from "./map-data.js";
import { state } from "./state.js";
import { setViewMode } from "./view-mode.js";

export let sbClient = null;      // supabase-js client, created once config is loaded

export let authUser = null;      // current auth.users row (or null when signed out)

export let authProfile = null;   // { is_admin } from public.profiles

export let authReady = false;    // true once the initial session restore has resolved

export function getAuthClient() {
  if (!sbClient) {
    sbClient = window.supabase.createClient(window.__SUPABASE_URL, window.__SUPABASE_ANON_KEY);
  }
  return sbClient;
}

export async function getAccessToken() {
  if (!authUser) return null;
  const sb = getAuthClient();
  const { data } = await sb.auth.getSession();
  return data && data.session ? data.session.access_token : null;
}

export function authHeaders() {
  return getAccessToken().then(token => token ? { "Authorization": `Bearer ${token}` } : {});
}

export async function refreshProfile() {
  if (!authUser) { authProfile = null; return; }
  const sb = getAuthClient();
  const { data, error } = await sb.from("profiles").select("is_admin").eq("id", authUser.id).maybeSingle();
  authProfile = error ? { is_admin: false } : { is_admin: !!(data && data.is_admin) };
}

export function isAdmin() {
  return !!(authProfile && authProfile.is_admin);
}

export async function signUpWithPassword(email, password) {
  const sb = getAuthClient();
  const { error } = await sb.auth.signUp({ email, password });
  if (error) throw error;
}

export async function signInWithPassword(email, password) {
  const sb = getAuthClient();
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function signInWithGoogle() {
  const sb = getAuthClient();
  const { error } = await sb.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: window.location.origin + window.location.pathname,
      queryParams: { prompt: "select_account" },
    },
  });
  if (error) throw error;
}

export async function signOut() {
  const sb = getAuthClient();
  await sb.auth.signOut();
}

export async function initAuth() {
  const sb = getAuthClient();
  const { data } = await sb.auth.getSession();
  authUser = data && data.session ? data.session.user : null;
  await refreshProfile();
  authReady = true;
  applyAuthState();

  sb.auth.onAuthStateChange(async (_event, session) => {
    authUser = session ? session.user : null;
    await refreshProfile();
    applyAuthState();
    // Personal view depends entirely on being signed in — bounce back to
    // the official view (and reload) whenever auth state changes under it.
    if (state.viewMode === "personal" && !authUser) setViewMode("official");
    else if (appShell && !appShell.hasAttribute("hidden")) loadLineups();
  });
}

export function applyAuthState() {
  document.body.classList.toggle("signed-in", !!authUser);
  document.body.classList.toggle("is-admin", isAdmin());
  if (authEmailLabel) authEmailLabel.textContent = authUser ? authUser.email : "";
  if (personalViewBtn) personalViewBtn.classList.toggle("hidden", !authUser);
}
