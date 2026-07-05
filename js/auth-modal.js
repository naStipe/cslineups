import { isUsernameAvailable, signInWithGoogle, signInWithPassword, signOut, signUpWithPassword } from "./auth.js";
import { authEmailInput, authError, authGoogleBtn, authModal, authModalTitle, authPasswordConfirmField, authPasswordConfirmInput, authPasswordInput, authSubmitBtn, authSwitchLink, authSwitchText, authUsernameField, authUsernameInput, cancelAuth, signInBtn, signOutBtn } from "./dom.js";
import { closeModal } from "./modal-utils.js";

export let authMode = "signin";

export function openAuthModal(mode) {
  authMode = mode || "signin";
  updateAuthModalMode();
  authError.hidden = true;
  authError.classList.remove("info");
  authEmailInput.value = "";
  authPasswordInput.value = "";
  authUsernameInput.value = "";
  authPasswordConfirmInput.value = "";
  authModal.classList.add("show");
}

export function updateAuthModalMode() {
  const isSignup = authMode === "signup";
  authModalTitle.textContent = isSignup ? "Create account" : "Sign in";
  authSubmitBtn.textContent = isSignup ? "Sign up" : "Sign in";
  authSwitchText.textContent = isSignup ? "Already have an account?" : "Don't have an account?";
  authSwitchLink.textContent = isSignup ? "Sign in" : "Sign up";
  // Username + password-repeat are only asked for when creating an account.
  authUsernameField.hidden = !isSignup;
  authPasswordConfirmField.hidden = !isSignup;
}

authSwitchLink.onclick = (e) => {
  e.preventDefault();
  authMode = authMode === "signup" ? "signin" : "signup";
  updateAuthModalMode();
};

cancelAuth.onclick = () => closeModal(authModal);

function showError(msg) {
  authError.classList.remove("info");
  authError.textContent = msg;
  authError.hidden = false;
}

// Supabase surfaces a failed sign-up trigger (e.g. the username unique index
// rejecting a duplicate that slipped past the look-ahead) as an opaque error
// whose message is empty or "{}". Turn those into something actionable rather
// than showing the user a blank/`{}` error.
function signupErrorMessage(err) {
  const msg = (err && err.message ? String(err.message) : "").trim();
  if (!msg || msg === "{}" || /database error|saving new user|duplicate|unique|constraint/i.test(msg)) {
    return "Couldn't create the account — that username or email may already be in use. Please try another.";
  }
  return msg;
}

authSubmitBtn.onclick = async () => {
  const email = authEmailInput.value.trim();
  const password = authPasswordInput.value;

  if (authMode === "signup") {
    const username = authUsernameInput.value.trim();
    const passwordConfirm = authPasswordConfirmInput.value;
    if (!email || !password) { showError("Enter an email and password."); return; }
    if (!username) { showError("Choose a username."); return; }
    if (username.length < 2) { showError("Username must be at least 2 characters."); return; }
    if (password.length < 6) { showError("Password must be at least 6 characters."); return; }
    if (password !== passwordConfirm) { showError("The passwords don't match."); return; }

    authSubmitBtn.disabled = true;
    try {
      if (!(await isUsernameAvailable(username))) {
        showError("That username is already taken — please pick another.");
        return;
      }
      await signUpWithPassword(email, password, username);
      // Success: the sign-up form's job is done. Flip the modal to the
      // sign-in view (hiding the username/repeat-password fields) with an
      // info banner, so what remains is exactly "confirm your email" + a
      // ready-to-use login form.
      authMode = "signin";
      updateAuthModalMode();
      authPasswordInput.value = "";
      authPasswordConfirmInput.value = "";
      authModalTitle.textContent = "Confirm your email";
      authError.textContent = `We sent a confirmation link to ${email}. Click it, then sign in here.`;
      authError.classList.add("info");
      authError.hidden = false;
    } catch (err) {
      showError(signupErrorMessage(err));
    } finally {
      authSubmitBtn.disabled = false;
    }
    return;
  }

  if (!email || !password) { showError("Enter an email and password."); return; }
  authSubmitBtn.disabled = true;
  try {
    await signInWithPassword(email, password);
    closeModal(authModal);
  } catch (err) {
    showError((err && err.message) || "Something went wrong.");
  } finally {
    authSubmitBtn.disabled = false;
  }
};

authGoogleBtn.onclick = async () => {
  try { await signInWithGoogle(); } catch (err) { alert((err && err.message) || "Google sign-in failed."); }
};

signInBtn.onclick = () => openAuthModal("signin");

signOutBtn.onclick = async () => { await signOut(); };
