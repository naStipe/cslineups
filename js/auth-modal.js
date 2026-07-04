import { signInWithGoogle, signInWithPassword, signOut, signUpWithPassword } from "./auth.js";
import { authEmailInput, authError, authGoogleBtn, authModal, authModalTitle, authPasswordInput, authSubmitBtn, authSwitchLink, authSwitchText, cancelAuth, signInBtn, signOutBtn } from "./dom.js";
import { closeModal } from "./modal-utils.js";

export let authMode = "signin";

export function openAuthModal(mode) {
  authMode = mode || "signin";
  updateAuthModalMode();
  authError.hidden = true;
  authError.classList.remove("info");
  authEmailInput.value = "";
  authPasswordInput.value = "";
  authModal.classList.add("show");
}

export function updateAuthModalMode() {
  const isSignup = authMode === "signup";
  authModalTitle.textContent = isSignup ? "Create account" : "Sign in";
  authSubmitBtn.textContent = isSignup ? "Sign up" : "Sign in";
  authSwitchText.textContent = isSignup ? "Already have an account?" : "Don't have an account?";
  authSwitchLink.textContent = isSignup ? "Sign in" : "Sign up";
}

authSwitchLink.onclick = (e) => {
  e.preventDefault();
  authMode = authMode === "signup" ? "signin" : "signup";
  updateAuthModalMode();
};

cancelAuth.onclick = () => closeModal(authModal);

authSubmitBtn.onclick = async () => {
  const email = authEmailInput.value.trim();
  const password = authPasswordInput.value;
  if (!email || !password) {
    authError.textContent = "Enter an email and password.";
    authError.hidden = false;
    return;
  }
  authSubmitBtn.disabled = true;
  try {
    if (authMode === "signup") {
      await signUpWithPassword(email, password);
      authError.textContent = "Check your email to confirm your account, then sign in.";
      authError.classList.add("info");
      authError.hidden = false;
    } else {
      await signInWithPassword(email, password);
      closeModal(authModal);
    }
  } catch (err) {
    authError.classList.remove("info");
    authError.textContent = (err && err.message) || "Something went wrong.";
    authError.hidden = false;
  } finally {
    authSubmitBtn.disabled = false;
  }
};

authGoogleBtn.onclick = async () => {
  try { await signInWithGoogle(); } catch (err) { alert((err && err.message) || "Google sign-in failed."); }
};

signInBtn.onclick = () => openAuthModal("signin");

signOutBtn.onclick = async () => { await signOut(); };
