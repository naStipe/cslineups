import { isUsernameAvailable, resetPasswordForEmail, signInWithGoogle, signInWithPassword, signOut, signUpWithPassword } from "./auth.js";
import { authEmailInput, authError, authForgotLink, authForgotWrap, authGoogleBtn, authModal, authModalTitle, authPasswordConfirmField, authPasswordConfirmInput, authPasswordField, authPasswordInput, authSubmitBtn, authSwitchLink, authSwitchText, authTurnstile, authUsernameField, authUsernameInput, cancelAuth, signInBtn, signOutBtn } from "./dom.js";
import { closeModal } from "./modal-utils.js";
import { mountTurnstile } from "./turnstile.js";

const turnstile = mountTurnstile(authTurnstile);

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
  turnstile.reset();
  authModal.classList.add("show");
}

export function updateAuthModalMode() {
  const isSignup = authMode === "signup";
  const isReset = authMode === "reset";
  authModalTitle.textContent = isReset ? "Reset password" : isSignup ? "Create account" : "Sign in";
  authSubmitBtn.textContent = isReset ? "Send reset link" : isSignup ? "Sign up" : "Sign in";
  authSwitchText.textContent = isReset ? "Remembered it?" : isSignup ? "Already have an account?" : "Don't have an account?";
  authSwitchLink.textContent = isReset ? "Sign in" : isSignup ? "Sign in" : "Sign up";
  // Username + password-repeat are only asked for when creating an account.
  authUsernameField.hidden = !isSignup;
  authPasswordField.hidden = isReset;
  authPasswordConfirmField.hidden = !isSignup;
  authForgotWrap.hidden = authMode !== "signin";
  // Password managers should offer a fresh password on sign-up, not the
  // account's existing one.
  authPasswordInput.autocomplete = isSignup ? "new-password" : "current-password";
}

function clearError() {
  authError.hidden = true;
  authError.classList.remove("info");
}

authSwitchLink.onclick = (e) => {
  e.preventDefault();
  authMode = authMode === "signin" ? "signup" : "signin";
  updateAuthModalMode();
  clearError();
  turnstile.reset();
};

authForgotLink.onclick = (e) => {
  e.preventDefault();
  authMode = "reset";
  updateAuthModalMode();
  clearError();
  turnstile.reset();
};

cancelAuth.onclick = () => closeModal(authModal);

// Enter submits the form from any auth field, matching normal browser form
// behavior even though this modal has no <form> element.
[authEmailInput, authPasswordInput, authUsernameInput, authPasswordConfirmInput].forEach(el => {
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !authSubmitBtn.disabled) authSubmitBtn.click();
  });
});

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

  if (authMode === "reset") {
    if (!email) { showError("Enter your email."); return; }
    const captchaToken = turnstile.getToken();
    if (!captchaToken) { showError("Please complete the verification challenge."); return; }
    authSubmitBtn.disabled = true;
    try {
      await resetPasswordForEmail(email, captchaToken);
    } catch {
      // Fall through to the same confirmation either way — surfacing a real
      // error here would let an attacker probe which emails have accounts.
    } finally {
      authSubmitBtn.disabled = false;
      turnstile.reset();
    }
    authModalTitle.textContent = "Check your email";
    authError.textContent = `If an account exists for ${email}, we sent a link to reset its password.`;
    authError.classList.add("info");
    authError.hidden = false;
    return;
  }

  if (authMode === "signup") {
    const username = authUsernameInput.value.trim();
    const passwordConfirm = authPasswordConfirmInput.value;
    if (!email || !password) { showError("Enter an email and password."); return; }
    if (!username) { showError("Choose a username."); return; }
    if (username.length < 2) { showError("Username must be at least 2 characters."); return; }
    if (password.length < 8) { showError("Password must be at least 8 characters."); return; }
    if (password !== passwordConfirm) { showError("The passwords don't match."); return; }
    const captchaToken = turnstile.getToken();
    if (!captchaToken) { showError("Please complete the verification challenge."); return; }

    authSubmitBtn.disabled = true;
    try {
      if (!(await isUsernameAvailable(username))) {
        showError("That username is already taken — please pick another.");
        return;
      }
      await signUpWithPassword(email, password, username, captchaToken);
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
      turnstile.reset();
    }
    return;
  }

  if (!email || !password) { showError("Enter an email and password."); return; }
  const captchaToken = turnstile.getToken();
  if (!captchaToken) { showError("Please complete the verification challenge."); return; }
  authSubmitBtn.disabled = true;
  try {
    await signInWithPassword(email, password, captchaToken);
    closeModal(authModal);
  } catch (err) {
    showError((err && err.message) || "Something went wrong.");
  } finally {
    authSubmitBtn.disabled = false;
    turnstile.reset();
  }
};

authGoogleBtn.onclick = async () => {
  try { await signInWithGoogle(); } catch (err) { alert((err && err.message) || "Google sign-in failed."); }
};

signInBtn.onclick = () => openAuthModal("signin");

signOutBtn.onclick = async () => { await signOut(); };
