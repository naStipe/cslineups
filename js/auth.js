import { appShell, authEmailLabel, personalViewBtn, profileAvatar } from "./dom.js";
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
  // select("*") rather than naming columns so this keeps working whether or
  // not the email/username migration has been applied yet (naming a missing
  // column would error and knock out is_admin along with it).
  const { data, error } = await sb.from("profiles").select("*").eq("id", authUser.id).maybeSingle();
  authProfile = error
    ? { is_admin: false, username: null, email: null }
    : {
        is_admin: !!(data && data.is_admin),
        username: (data && data.username) || null,
        email:    (data && data.email) || null,
      };
}

export function isAdmin() {
  return !!(authProfile && authProfile.is_admin);
}

// Look-ahead check the sign-up form uses to reject a taken username with a
// clear message. Backed by the username_available() RPC (see
// sql/profiles-username-unique.sql). Fails open — if the check itself errors
// (e.g. the migration hasn't been run yet) we let sign-up proceed, since the
// unique index is the real guarantee and will still reject a true duplicate.
export async function isUsernameAvailable(username) {
  const sb = getAuthClient();
  try {
    const { data, error } = await sb.rpc("username_available", { uname: username });
    if (error) { console.warn("Username availability check failed:", error.message); return true; }
    return data !== false;
  } catch (e) {
    console.warn("Username availability check error:", e);
    return true;
  }
}

export async function signUpWithPassword(email, password, username) {
  const sb = getAuthClient();
  // The username rides along in user metadata; the handle_new_user() trigger
  // (see sql/profiles-email-username.sql) copies it into public.profiles.
  const { data, error } = await sb.auth.signUp({
    email,
    password,
    options: {
      data: { username: username || null },
      // Send the confirmation email's link to our own landing page instead of
      // the site root (the origin is used so localhost testing and the
      // deployed site each return to themselves — must be covered by the
      // Redirect URLs allowlist in Supabase auth settings).
      emailRedirectTo: `${window.location.origin}/confirmed.html`,
    },
  });
  if (error) throw error;
  // When the email is already registered, Supabase deliberately does NOT
  // error (anti-enumeration): it returns a fake-success "obfuscated" user
  // whose identities array is empty. No account is created in that case —
  // surface it as a real error instead of letting the form claim success.
  if (data && data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    throw new Error("An account with this email already exists. Try signing in instead.");
  }
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

  // The session restored from localStorage is taken on faith — its JWT stays
  // "valid" until it expires even if the account was deleted server-side,
  // leaving a ghost login. Revalidate against the auth server and force a
  // sign-out when the server no longer recognizes the user. Only 4xx auth
  // errors count: a network hiccup shouldn't log anyone out.
  if (authUser) {
    const { error } = await sb.auth.getUser();
    if (error && error.status >= 400 && error.status < 500) {
      await sb.auth.signOut();
      authUser = null;
    }
  }

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
  if (authEmailLabel) {
    // Prefer the username; fall back to the email if a profile row somehow
    // has none. The email stays available on hover.
    const name = authUser ? ((authProfile && authProfile.username) || authUser.email) : "";
    authEmailLabel.textContent = name;
    authEmailLabel.title = authUser ? authUser.email : "";
    if (profileAvatar) profileAvatar.textContent = name ? name[0].toUpperCase() : "";
  }
  if (personalViewBtn) personalViewBtn.classList.toggle("hidden", !authUser);
}
