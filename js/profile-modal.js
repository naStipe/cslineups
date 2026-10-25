// Profile modal: opened from the avatar button in the sidebar footer.
// Username changes and account deletion go through /api/profile (they need
// the service key server-side); password changes go straight to Supabase
// auth with the user's own session.

import { applyAuthState, authHeaders, authProfile, authUser, getAuthClient, isAdmin, refreshProfile, signOut } from "./auth.js";
import {
  changePasswordBtn, closeProfile, deleteAccountBtn, deleteMsg, passwordMsg,
  profileAccountCount, profileAccountsLink, profileBtn, profileModal, profileModalAvatar, profileModalEmail,
  profileModalName, profileNewPassword, profileNewPassword2,
  profileUsernameInput, saveUsernameBtn, usernameMsg,
} from "./dom.js";
import { closeModal } from "./modal-utils.js";
import { confirmDialog } from "./confirm-dialog.js";
import { setBusy } from "./ui-utils.js";

function displayName() {
  return (authProfile && authProfile.username) || (authUser && authUser.email) || "";
}

export function avatarLetter() {
  const name = displayName();
  return name ? name[0].toUpperCase() : "";
}

function setMsg(el, text, isError) {
  el.textContent = text;
  el.classList.toggle("error", !!isError);
  el.hidden = !text;
}

function clearMsgs() {
  [usernameMsg, passwordMsg, deleteMsg].forEach(m => { m.hidden = true; m.textContent = ""; });
}

function fillProfileModal() {
  profileModalAvatar.textContent = avatarLetter();
  profileModalName.textContent = displayName();
  profileModalEmail.textContent = authUser ? authUser.email : "";
  profileUsernameInput.value = (authProfile && authProfile.username) || "";
  profileNewPassword.value = "";
  profileNewPassword2.value = "";
}

// Admin-only: number of registered accounts, fetched fresh on every open.
async function loadAccountCount() {
  profileAccountCount.hidden = !isAdmin();
  profileAccountsLink.hidden = !isAdmin();
  if (!isAdmin()) return;
  profileAccountCount.textContent = "Accounts: …";
  try {
    const res = await fetch("/api/admin?stats=1", { headers: await authHeaders() });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    profileAccountCount.textContent = `Accounts: ${body.accounts.toLocaleString()}`;
  } catch {
    profileAccountCount.textContent = "Accounts: unavailable";
  }
}

profileBtn.onclick = () => {
  if (!authUser) return;
  clearMsgs();
  fillProfileModal();
  loadAccountCount();
  profileModal.classList.add("show");
};

closeProfile.onclick = () => closeModal(profileModal);

// ---- Change username ------------------------------------------------------

saveUsernameBtn.onclick = async () => {
  const username = profileUsernameInput.value.trim();
  const current = (authProfile && authProfile.username) || "";
  if (!username) { setMsg(usernameMsg, "Username can't be empty.", true); return; }
  if (username === current) { setMsg(usernameMsg, "That's already your username.", false); return; }

  setBusy(saveUsernameBtn, true, "Saving…");
  setMsg(usernameMsg, "", false);
  try {
    const res = await fetch("/api/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify({ username }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    await refreshProfile();
    applyAuthState();
    fillProfileModal();
    setMsg(usernameMsg, "Username updated ✓", false);
  } catch (e) {
    setMsg(usernameMsg, e.message || "Failed to update username.", true);
  } finally {
    setBusy(saveUsernameBtn, false);
  }
};

// ---- Change password -------------------------------------------------------

changePasswordBtn.onclick = async () => {
  const pw = profileNewPassword.value;
  const pw2 = profileNewPassword2.value;
  if (pw.length < 8) { setMsg(passwordMsg, "Password must be at least 8 characters.", true); return; }
  if (pw !== pw2) { setMsg(passwordMsg, "The passwords don't match.", true); return; }

  setBusy(changePasswordBtn, true, "Updating…");
  setMsg(passwordMsg, "", false);
  try {
    const sb = getAuthClient();
    const { error } = await sb.auth.updateUser({ password: pw });
    if (error) throw error;
    profileNewPassword.value = "";
    profileNewPassword2.value = "";
    setMsg(passwordMsg, "Password changed ✓", false);
  } catch (e) {
    setMsg(passwordMsg, e.message || "Failed to change password.", true);
  } finally {
    setBusy(changePasswordBtn, false);
  }
};

// ---- Delete account ---------------------------------------------------------

deleteAccountBtn.onclick = async () => {
  // Truly unrecoverable, so a real confirmation (with a typed word) rather
  // than the undo toast used for lineup deletes.
  const ok = await confirmDialog({
    title: "Delete your account?",
    body: "Your personal lineups, bookmarks and screenshots will be permanently removed. This cannot be undone.",
    confirmLabel: "Delete account",
    danger: true,
    requireText: "DELETE",
  });
  if (!ok) return;

  setBusy(deleteAccountBtn, true, "Deleting…");
  setMsg(deleteMsg, "Deleting your account…", false);
  try {
    const res = await fetch("/api/profile", { method: "DELETE", headers: await authHeaders() });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    await signOut();
    window.location.href = "/";
  } catch (e) {
    setMsg(deleteMsg, e.message || "Failed to delete the account.", true);
    setBusy(deleteAccountBtn, false);
  }
};
